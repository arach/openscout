// Codex adapter — delegates to the working OpenScout app-server harness.
//
// Dispatch previously carried a second Codex app-server implementation here.
// That protocol drifted and stopped producing turn events, which is why
// prompts could be accepted while nothing ever showed up in the iOS timeline.
//
// Instead of maintaining two app-server clients, Dispatch now reuses the
// runtime's Codex harness and maps its final response back into Dispatch
// turn/block events.

import { homedir } from "node:os";
import { join } from "node:path";

import {
  ensureCodexAppServerAgentOnline,
  interruptCodexAppServerAgent,
  invokeCodexAppServerAgent,
  shutdownCodexAppServerAgent,
} from "../../../../packages/runtime/src/codex-app-server.ts";
import { BaseAdapter } from "../protocol/adapter.ts";
import type { AdapterConfig } from "../protocol/adapter.ts";
import type { Block, BlockStatus, Prompt, Turn, TurnStatus } from "../protocol/primitives.ts";

type CodexSessionOptions = {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
};

export class CodexAdapter extends BaseAdapter {
  readonly type = "codex";

  private currentTurn: Turn | null = null;
  private currentThreadId: string | null = null;
  private blockIndex = 0;
  private inFlight = false;

  constructor(config: AdapterConfig) {
    super(config);
  }

  async start(): Promise<void> {
    const { threadId } = await ensureCodexAppServerAgentOnline(this.codexOptions);
    this.currentThreadId = threadId;
    this.setStatus("active");
  }

  send(prompt: Prompt): void {
    if (this.inFlight) {
      this.emit("error", new Error("Codex adapter already has an active turn."));
      return;
    }

    const turn: Turn = {
      id: crypto.randomUUID(),
      sessionId: this.session.id,
      status: "started",
      startedAt: new Date().toISOString(),
      blocks: [],
    };

    this.currentTurn = turn;
    this.blockIndex = 0;
    this.inFlight = true;

    this.emit("event", {
      event: "turn:start",
      sessionId: this.session.id,
      turn,
    });

    const textBlock = this.startBlock(turn, {
      type: "text",
      text: "",
      status: "streaming",
    });

    void invokeCodexAppServerAgent({
      ...this.codexOptions,
      prompt: prompt.text,
      timeoutMs: 5 * 60_000,
    }).then(({ output, threadId }) => {
      this.currentThreadId = threadId;
      if (!this.currentTurn || this.currentTurn.id != turn.id) {
        return;
      }

      if (output.trim().length > 0) {
        this.emit("event", {
          event: "block:delta",
          sessionId: this.session.id,
          turnId: turn.id,
          blockId: textBlock.id,
          text: output,
        });
      }

      this.emitBlockEnd(turn, textBlock, "completed");
      this.endTurn(turn, "completed");
    }).catch((error) => {
      if (!this.currentTurn || this.currentTurn.id != turn.id) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("interrupted")) {
        this.emitBlockEnd(turn, textBlock, "failed");
        this.endTurn(turn, "stopped");
        return;
      }

      const errorBlock = this.startBlock(turn, {
        type: "error",
        message,
        status: "completed",
      });
      this.emitBlockEnd(turn, textBlock, "failed");
      this.emitBlockEnd(turn, errorBlock, "completed");
      this.endTurn(turn, "failed");
      this.emit("error", error instanceof Error ? error : new Error(message));
    });
  }

  interrupt(): void {
    const turn = this.currentTurn;
    if (!turn) {
      return;
    }

    void interruptCodexAppServerAgent(this.codexOptions).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    await shutdownCodexAppServerAgent(this.codexOptions);
    this.currentTurn = null;
    this.inFlight = false;
    this.setStatus("closed");
  }

  private get codexOptions(): CodexSessionOptions {
    const runtimeRoot = join(homedir(), ".dispatch", "codex", this.session.id);
    return {
      agentName: this.session.name,
      sessionId: this.session.id,
      cwd: this.config.cwd ?? process.cwd(),
      systemPrompt: this.systemPrompt,
      runtimeDirectory: join(runtimeRoot, "runtime"),
      logsDirectory: join(runtimeRoot, "logs"),
    };
  }

  private get systemPrompt(): string {
    const raw = this.config.options?.systemPrompt;
    return typeof raw === "string" && raw.trim().length > 0
      ? raw
      : "You are a helpful agent working through Dispatch.";
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
      block: block,
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

  private endTurn(turn: Turn, status: TurnStatus): void {
    turn.status = status;
    turn.endedAt = new Date().toISOString();
    this.currentTurn = null;
    this.inFlight = false;
    this.emit("event", {
      event: "turn:end",
      sessionId: this.session.id,
      turnId: turn.id,
      status,
    });
  }
}

export const createAdapter = (config: AdapterConfig) => new CodexAdapter(config);
