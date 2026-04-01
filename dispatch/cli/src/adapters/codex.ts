// Codex adapter — connects to the Codex app-server over stdio.
//
// Unlike Claude Code (which spawns a fresh process per prompt), Codex runs
// as a persistent app-server.  The adapter spawns `codex app-server` once
// on start(), then sends JSON-RPC requests for each prompt and maps the
// streaming notifications back to Dispatch primitives.
//
// Codex notification events (from remodex analysis):
//   turn/started              → turn:start
//   turn/completed            → turn:end
//   item/started              → block:start (placeholder)
//   item/agentMessage/delta   → block:delta (text)
//   item/reasoning/*          → block:delta (reasoning)
//   item/fileChange/outputDelta → block:action:output (file_change)
//   item/commandExecution/outputDelta → block:action:output (command)
//   item/toolCall/outputDelta → block:action:output (tool_call)
//   item/completed            → block:end
//   thread/started            → session info update
//   thread/name/updated       → session name update

import { BaseAdapter } from "../protocol/adapter.ts";
import type { AdapterConfig } from "../protocol/adapter.ts";
import type {
  Action,
  Block,
  BlockStatus,
  Prompt,
  Turn,
  TurnStatus,
} from "../protocol/primitives.ts";
import type { Subprocess } from "bun";

// ---------------------------------------------------------------------------
// JSON-RPC helpers for Codex app-server communication
// ---------------------------------------------------------------------------

interface CodexRPCMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class CodexAdapter extends BaseAdapter {
  readonly type = "codex";

  private process: Subprocess | null = null;
  private currentTurn: Turn | null = null;
  private currentThreadId: string | null = null;
  private blockIndex = 0;
  private rpcIdCounter = 1;
  private pendingRPCs = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  // Track active blocks by itemId so deltas can target the right block.
  private blockByItemId = new Map<string, Block>();
  // Track the "current" streaming text/reasoning block for deltas that don't carry an itemId.
  private currentTextBlock: Block | null = null;
  private currentReasoningBlock: Block | null = null;

  constructor(config: AdapterConfig) {
    super(config);
  }

  async start(): Promise<void> {
    const codex = Bun.spawn(["codex", "app-server"], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    this.process = codex;
    this.readStdout();
    this.readStderr();

    codex.exited.then((code) => {
      if (code !== 0 && this.session.status !== "closed") {
        this.emit("error", new Error(`codex app-server exited with code ${code}`));
        this.setStatus("error");
      }
    });

    this.setStatus("active");
  }

  send(prompt: Prompt): void {
    this.blockIndex = 0;
    this.blockByItemId.clear();
    this.currentTextBlock = null;
    this.currentReasoningBlock = null;

    if (this.currentThreadId) {
      // Existing thread — send a new turn.
      this.sendRPC("turn/start", {
        threadId: this.currentThreadId,
        message: prompt.text,
      });
    } else {
      // First prompt — create a thread.
      this.sendRPC("thread/start", {
        message: prompt.text,
        cwd: this.config.cwd,
      });
    }
  }

  interrupt(): void {
    if (this.currentTurn) {
      // Send interrupt to codex.
      if (this.currentThreadId) {
        this.sendRPC("turn/interrupt", {
          threadId: this.currentThreadId,
        });
      }
      this.endTurn(this.currentTurn, "stopped");
    }
  }

  async shutdown(): Promise<void> {
    this.process?.kill();
    this.process = null;
    this.setStatus("closed");
  }

  // ---------------------------------------------------------------------------
  // Stdio reading
  // ---------------------------------------------------------------------------

  private async readStdout(): Promise<void> {
    const stdout = this.process?.stdout;
    if (!stdout || typeof stdout === "number") return;

    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg: CodexRPCMessage = JSON.parse(trimmed);
            this.handleCodexMessage(msg);
          } catch { /* skip malformed */ }
        }
      }
    } catch { /* stream closed */ }
  }

  private async readStderr(): Promise<void> {
    const stderr = this.process?.stderr;
    if (!stderr || typeof stderr === "number") return;

    const reader = stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Stderr is diagnostic only — ignore during normal operation.
        decoder.decode(value, { stream: true });
      }
    } catch { /* stream closed */ }
  }

  // ---------------------------------------------------------------------------
  // RPC send
  // ---------------------------------------------------------------------------

  private sendRPC(method: string, params?: any): string {
    const id = String(this.rpcIdCounter++);
    const msg: CodexRPCMessage = { jsonrpc: "2.0", id, method, params };
    const line = JSON.stringify(msg) + "\n";

    const stdin = this.process?.stdin;
    if (stdin && typeof stdin !== "number") {
      stdin.write(line);
      stdin.flush();
    }

    return id;
  }

  // ---------------------------------------------------------------------------
  // Message router — Codex JSON-RPC notifications → Dispatch primitives
  // ---------------------------------------------------------------------------

  private handleCodexMessage(msg: CodexRPCMessage): void {
    // RPC response (to our requests).
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRPCs.get(String(msg.id));
      if (pending) {
        this.pendingRPCs.delete(String(msg.id));
        if (msg.error) {
          pending.reject(new Error(msg.error.message ?? "RPC error"));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Notification (server-initiated).
    if (!msg.method) return;
    const method = msg.method;
    const params = msg.params ?? {};

    switch (method) {
      // -- Thread lifecycle ---------------------------------------------------
      case "thread/started": {
        this.currentThreadId = params.threadId ?? params.thread?.id;
        if (params.thread?.name) {
          (this.session as any).name = params.thread.name;
          this.setStatus("active");
        }
        break;
      }

      case "thread/name/updated": {
        if (params.name) {
          (this.session as any).name = params.name;
          this.emit("event", {
            event: "session:update",
            session: { ...this.session },
          });
        }
        break;
      }

      // -- Turn lifecycle -----------------------------------------------------
      case "turn/started": {
        const turnId = params.turnId ?? params.turn?.id ?? crypto.randomUUID();
        const turn: Turn = {
          id: turnId,
          sessionId: this.session.id,
          status: "started",
          startedAt: new Date().toISOString(),
          blocks: [],
        };
        this.currentTurn = turn;
        this.blockIndex = 0;
        this.emit("event", {
          event: "turn:start",
          sessionId: this.session.id,
          turn,
        });
        break;
      }

      case "turn/completed": {
        if (this.currentTurn) {
          this.closeOpenBlocks();
          this.endTurn(this.currentTurn, "completed");
        }
        break;
      }

      // -- Item lifecycle (blocks) --------------------------------------------
      case "item/started": {
        // A new content item is starting. Create a placeholder block.
        // The actual type (text, reasoning, action) will be determined by
        // subsequent delta events.
        const itemId = params.itemId ?? params.item?.id;
        if (itemId && this.currentTurn) {
          // We'll create the block lazily on the first delta.
          // Just record that this item is active.
        }
        break;
      }

      case "item/completed": {
        const itemId = params.itemId ?? params.item?.id;
        if (itemId) {
          const block = this.blockByItemId.get(itemId);
          if (block && this.currentTurn) {
            this.emitBlockEnd(this.currentTurn, block, "completed");
            this.blockByItemId.delete(itemId);
            if (block === this.currentTextBlock) this.currentTextBlock = null;
            if (block === this.currentReasoningBlock) this.currentReasoningBlock = null;
          }
        }

        // Also handle completed text from the item payload.
        const text = params.item?.content?.[0]?.text ?? params.text;
        if (text && typeof text === "string" && this.currentTurn) {
          const existingBlock = itemId ? this.blockByItemId.get(itemId) : null;
          if (!existingBlock) {
            // Final text arrived without prior deltas — emit as a complete block.
            const block = this.startBlock(this.currentTurn, {
              type: "text",
              text,
              status: "completed",
            });
            this.emitBlockEnd(this.currentTurn, block, "completed");
          }
        }
        break;
      }

      // -- Text deltas --------------------------------------------------------
      case "item/agentMessage/delta": {
        if (!this.currentTurn) break;
        const delta = this.extractDeltaText(params);
        if (!delta) break;

        const itemId = params.itemId;
        let block = itemId ? this.blockByItemId.get(itemId) : this.currentTextBlock;

        if (!block) {
          block = this.startBlock(this.currentTurn, {
            type: "text",
            text: "",
            status: "streaming",
          });
          this.currentTextBlock = block;
          if (itemId) this.blockByItemId.set(itemId, block);
        }

        this.emit("event", {
          event: "block:delta",
          sessionId: this.session.id,
          turnId: this.currentTurn.id,
          blockId: block.id,
          text: delta,
        });
        break;
      }

      // -- Reasoning deltas ---------------------------------------------------
      case "item/reasoning/delta":
      case "item/reasoning/summaryTextDelta": {
        if (!this.currentTurn) break;
        const delta = this.extractDeltaText(params);
        if (!delta) break;

        const itemId = params.itemId;
        let block = itemId ? this.blockByItemId.get(itemId) : this.currentReasoningBlock;

        if (!block) {
          block = this.startBlock(this.currentTurn, {
            type: "reasoning",
            text: "",
            status: "streaming",
          });
          this.currentReasoningBlock = block;
          if (itemId) this.blockByItemId.set(itemId, block);
        }

        this.emit("event", {
          event: "block:delta",
          sessionId: this.session.id,
          turnId: this.currentTurn.id,
          blockId: block.id,
          text: delta,
        });
        break;
      }

      // -- File change deltas -------------------------------------------------
      case "item/fileChange/outputDelta": {
        if (!this.currentTurn) break;
        const itemId = params.itemId;
        const delta = params.delta ?? params.output ?? "";

        let block = itemId ? this.blockByItemId.get(itemId) : null;

        if (!block) {
          const action: Action = {
            kind: "file_change",
            path: params.filePath ?? params.path ?? "",
            diff: "",
            status: "running",
            output: "",
          };
          block = this.startBlock(this.currentTurn, {
            type: "action",
            action,
            status: "streaming",
          });
          if (itemId) this.blockByItemId.set(itemId, block);
        }

        this.emit("event", {
          event: "block:action:output",
          sessionId: this.session.id,
          turnId: this.currentTurn.id,
          blockId: block.id,
          output: typeof delta === "string" ? delta : JSON.stringify(delta),
        });
        break;
      }

      // -- Command execution deltas -------------------------------------------
      case "item/commandExecution/outputDelta": {
        if (!this.currentTurn) break;
        const itemId = params.itemId;
        const delta = params.delta ?? params.output ?? "";

        let block = itemId ? this.blockByItemId.get(itemId) : null;

        if (!block) {
          const action: Action = {
            kind: "command",
            command: params.command ?? "",
            status: "running",
            output: "",
          };
          block = this.startBlock(this.currentTurn, {
            type: "action",
            action,
            status: "streaming",
          });
          if (itemId) this.blockByItemId.set(itemId, block);
        }

        this.emit("event", {
          event: "block:action:output",
          sessionId: this.session.id,
          turnId: this.currentTurn.id,
          blockId: block.id,
          output: typeof delta === "string" ? delta : JSON.stringify(delta),
        });
        break;
      }

      // -- Tool call deltas ---------------------------------------------------
      case "item/toolCall/outputDelta": {
        if (!this.currentTurn) break;
        const itemId = params.itemId;
        const delta = params.delta ?? params.output ?? "";

        let block = itemId ? this.blockByItemId.get(itemId) : null;

        if (!block) {
          const action: Action = {
            kind: "tool_call",
            toolName: params.toolName ?? params.name ?? "unknown",
            toolCallId: params.toolCallId ?? itemId ?? crypto.randomUUID(),
            status: "running",
            output: "",
          };
          block = this.startBlock(this.currentTurn, {
            type: "action",
            action,
            status: "streaming",
          });
          if (itemId) this.blockByItemId.set(itemId, block);
        }

        this.emit("event", {
          event: "block:action:output",
          sessionId: this.session.id,
          turnId: this.currentTurn.id,
          blockId: block.id,
          output: typeof delta === "string" ? delta : JSON.stringify(delta),
        });
        break;
      }

      // -- Command terminal interaction (status update) -----------------------
      case "item/commandExecution/terminalInteraction": {
        if (!this.currentTurn) break;
        const itemId = params.itemId;
        const block = itemId ? this.blockByItemId.get(itemId) : null;
        if (!block) break;

        const exitCode = params.exitCode ?? params.status?.exitCode;
        const status = exitCode === 0 ? "completed" : "failed";

        this.emit("event", {
          event: "block:action:status",
          sessionId: this.session.id,
          turnId: this.currentTurn.id,
          blockId: block.id,
          status,
          meta: exitCode !== undefined ? { exitCode } : undefined,
        });
        break;
      }

      // -- Errors -------------------------------------------------------------
      case "error":
      case "turn/failed": {
        const message = params.message ?? params.error?.message ?? "Unknown error";
        if (this.currentTurn) {
          this.emitError(this.currentTurn, message);
          this.endTurn(this.currentTurn, "failed");
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractDeltaText(params: any): string | null {
    if (typeof params.delta === "string") return params.delta;
    if (typeof params.text === "string") return params.text;
    if (params.delta?.text) return params.delta.text;
    if (params.content?.[0]?.text) return params.content[0].text;
    return null;
  }

  private closeOpenBlocks(): void {
    if (!this.currentTurn) return;
    for (const [itemId, block] of this.blockByItemId) {
      this.emitBlockEnd(this.currentTurn, block, "completed");
    }
    this.blockByItemId.clear();
    this.currentTextBlock = null;
    this.currentReasoningBlock = null;
  }

  private startBlock(
    turn: Turn,
    partial: Record<string, unknown> & { type: string; status: BlockStatus },
  ): Block {
    const block: Block = {
      ...partial,
      id: crypto.randomUUID(),
      turnId: turn.id,
      index: this.blockIndex++,
    } as Block;

    turn.blocks.push(block);

    this.emit("event", {
      event: "block:start",
      sessionId: this.session.id,
      turnId: turn.id,
      block,
    });

    return block;
  }

  private emitBlockEnd(turn: Turn, block: Block, status: BlockStatus): void {
    this.emit("event", {
      event: "block:end",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId: block.id,
      status,
    });
  }

  private emitError(turn: Turn, message: string): void {
    const block = this.startBlock(turn, {
      type: "error",
      message,
      status: "completed",
    });
    this.emitBlockEnd(turn, block, "completed");
  }

  private endTurn(turn: Turn, status: TurnStatus): void {
    turn.status = status;
    turn.endedAt = new Date().toISOString();
    this.currentTurn = null;
    this.emit("event", {
      event: "turn:end",
      sessionId: this.session.id,
      turnId: turn.id,
      status,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory export
// ---------------------------------------------------------------------------

export const createAdapter = (config: AdapterConfig) => new CodexAdapter(config);
