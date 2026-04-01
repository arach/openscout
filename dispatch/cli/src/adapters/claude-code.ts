// Claude Code adapter — persistent process with bidirectional stream-json.
//
// Spawns `claude --print --input-format stream-json --output-format stream-json`
// once on start(), keeps it alive, and sends turns by writing JSON messages to
// stdin.  Claude Code streams responses on stdout as newline-delimited JSON.
//
// Input format:
//   {"type":"user","message":{"role":"user","content":"..."},"session_id":"","parent_tool_use_id":null}
//
// Output events:
//   system (init, hooks)  → session metadata
//   assistant             → text/reasoning blocks
//   tool_use              → action blocks
//   tool_result           → action output/completion
//   stream_event          → partial deltas
//   result                → turn complete
//   error                 → error blocks

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
// Adapter
// ---------------------------------------------------------------------------

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly type = "claude-code";

  private process: Subprocess | null = null;
  private currentTurn: Turn | null = null;
  private blockIndex = 0;
  private claudeSessionId: string | null = null;

  // Track active blocks by tool call ID for result correlation.
  private toolBlockMap = new Map<string, string>();

  constructor(config: AdapterConfig) {
    super(config);
  }

  async start(): Promise<void> {
    const args = [
      "--print",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
    ];

    const model = this.config.options?.["model"] as string | undefined;
    if (model) {
      args.push("--model", model);
    }

    // Resume an existing Claude Code session if specified.
    const resumeId = this.config.options?.["resume"] as string | undefined;
    if (resumeId) {
      args.push("--resume", resumeId);
    }

    this.process = Bun.spawn(["claude", ...args], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Start reading stdout — runs for the lifetime of the process.
    this.readStdout();

    this.process.exited.then((code) => {
      if (code !== 0 && this.session.status !== "closed") {
        this.emit("error", new Error(`claude exited with code ${code}`));
        this.setStatus("error");
      }
    });

    this.setStatus("active");
  }

  send(prompt: Prompt): void {
    if (!this.process?.stdin || typeof this.process.stdin === "number") {
      this.emit("error", new Error("Claude Code process not running"));
      return;
    }

    this.blockIndex = 0;
    this.toolBlockMap.clear();

    const turn: Turn = {
      id: crypto.randomUUID(),
      sessionId: this.session.id,
      status: "started",
      startedAt: new Date().toISOString(),
      blocks: [],
    };
    this.currentTurn = turn;
    this.emit("event", { event: "turn:start", sessionId: this.session.id, turn });

    // Build the content — text or array with images/files.
    let content: string | Array<Record<string, unknown>> = prompt.text;

    if (prompt.images?.length || prompt.files?.length) {
      const parts: Array<Record<string, unknown>> = [];
      parts.push({ type: "text", text: prompt.text });

      if (prompt.images?.length) {
        for (const img of prompt.images) {
          parts.push({
            type: "image",
            source: { type: "base64", media_type: img.mimeType, data: img.data },
          });
        }
      }

      if (prompt.files?.length) {
        parts.push({ type: "text", text: `\n\nReferenced files: ${prompt.files.join(", ")}` });
      }

      content = parts;
    }

    // Write the user message to stdin.
    const msg = JSON.stringify({
      type: "user",
      session_id: this.claudeSessionId ?? "",
      message: { role: "user", content },
      parent_tool_use_id: null,
    }) + "\n";

    this.process.stdin.write(msg);
    this.process.stdin.flush();
  }

  interrupt(): void {
    // Send interrupt signal to the process — Claude Code handles SIGINT.
    if (this.process && !this.process.killed) {
      this.process.kill("SIGINT");
    }
    if (this.currentTurn) {
      this.endTurn(this.currentTurn, "stopped");
    }
  }

  async shutdown(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.setStatus("closed");
  }

  // ---------------------------------------------------------------------------
  // Persistent stdout reader
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
            this.handleEvent(JSON.parse(trimmed));
          } catch { /* skip malformed */ }
        }
      }
    } catch { /* stream closed */ }

    // Process exited — if there's an active turn, end it.
    if (this.currentTurn && this.currentTurn.status !== "stopped") {
      this.endTurn(this.currentTurn, "completed");
    }
  }

  // ---------------------------------------------------------------------------
  // Event router
  // ---------------------------------------------------------------------------

  private handleEvent(event: any): void {
    switch (event.type) {
      case "system": {
        if (event.subtype === "init") {
          const sid = event.session_id ?? event.sessionId;
          if (sid) this.claudeSessionId = sid;
        }
        // Skip hooks and other system events.
        break;
      }

      case "assistant": {
        this.handleAssistant(event);
        break;
      }

      case "tool_use": {
        this.handleToolUse(event);
        break;
      }

      case "tool_result": {
        this.handleToolResult(event);
        break;
      }

      case "result": {
        // Turn complete — the stream continues for the next turn.
        if (this.currentTurn && this.currentTurn.status !== "stopped") {
          this.endTurn(this.currentTurn, event.subtype === "error" ? "failed" : "completed");
        }
        break;
      }

      case "error": {
        if (this.currentTurn) {
          this.emitError(this.currentTurn, event.error?.message ?? event.message ?? "Unknown error");
          this.endTurn(this.currentTurn, "failed");
        }
        break;
      }

      // stream_event, rate_limit_event, etc. — ignore for now.
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleAssistant(event: any): void {
    if (!this.currentTurn) return;

    const content = event.message?.content ?? event.content;
    if (!Array.isArray(content)) return;

    for (const part of content) {
      if (part.type === "thinking" || part.type === "reasoning") {
        const block = this.startBlock(this.currentTurn, {
          type: "reasoning",
          text: part.thinking ?? part.text ?? "",
          status: "completed",
        });
        this.emitBlockEnd(this.currentTurn, block, "completed");
      } else if (part.type === "text") {
        const block = this.startBlock(this.currentTurn, {
          type: "text",
          text: part.text ?? "",
          status: "completed",
        });
        this.emitBlockEnd(this.currentTurn, block, "completed");
      }
    }
  }

  private handleToolUse(event: any): void {
    if (!this.currentTurn) return;

    const toolName: string = event.tool_name ?? event.name ?? "unknown";
    const toolCallId: string = event.tool_use_id ?? event.id ?? crypto.randomUUID();

    let action: Action;

    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") {
      action = {
        kind: "file_change",
        path: event.input?.file_path ?? event.input?.path ?? "",
        diff: "",
        status: "running",
        output: "",
      };
    } else if (toolName === "Bash") {
      action = {
        kind: "command",
        command: event.input?.command ?? "",
        status: "running",
        output: "",
      };
    } else if (toolName === "Agent") {
      action = {
        kind: "subagent",
        agentId: toolCallId,
        agentName: event.input?.description ?? undefined,
        prompt: event.input?.prompt ?? undefined,
        status: "running",
        output: "",
      };
    } else {
      action = {
        kind: "tool_call",
        toolName,
        toolCallId,
        input: event.input,
        status: "running",
        output: "",
      };
    }

    const block = this.startBlock(this.currentTurn, {
      type: "action",
      action,
      status: "streaming",
    });

    this.toolBlockMap.set(toolCallId, block.id);
  }

  private handleToolResult(event: any): void {
    if (!this.currentTurn) return;

    const toolCallId: string = event.tool_use_id ?? event.id ?? "";
    const blockId = this.toolBlockMap.get(toolCallId);
    if (!blockId) return;

    const output = typeof event.content === "string"
      ? event.content
      : JSON.stringify(event.content ?? "");

    this.emit("event", {
      event: "block:action:output",
      sessionId: this.session.id,
      turnId: this.currentTurn.id,
      blockId,
      output,
    });

    const status = event.is_error ? "failed" : "completed";
    this.emit("event", {
      event: "block:action:status",
      sessionId: this.session.id,
      turnId: this.currentTurn.id,
      blockId,
      status,
    });

    this.emit("event", {
      event: "block:end",
      sessionId: this.session.id,
      turnId: this.currentTurn.id,
      blockId,
      status: status === "failed" ? "failed" : "completed",
    });
  }

  // ---------------------------------------------------------------------------
  // Block helpers
  // ---------------------------------------------------------------------------

  private startBlock(turn: Turn, partial: Record<string, unknown> & { type: string; status: BlockStatus }): Block {
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

export const createAdapter = (config: AdapterConfig) => new ClaudeCodeAdapter(config);
