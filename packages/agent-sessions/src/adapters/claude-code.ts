// Claude Code adapter — persistent process with bidirectional stream-json.
//
// Ownership boundary: Claude Code owns its own ecosystem. This adapter may read
// Claude-owned state to resolve or explain sessions, but it must not write
// `.claude` project files, agent definitions, team config, task lists, or MCP
// settings. Setup flows that intentionally install Scout into a Claude host live
// outside this adapter and must be explicit user actions.
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

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { BaseAdapter } from "../protocol/adapter.js";
import type { AdapterConfig } from "../protocol/adapter.js";
import { OBSERVED_HARNESS_TOPOLOGY_META_KEY } from "../protocol/primitives.js";
import type {
  Action,
  Block,
  BlockStatus,
  Prompt,
  QuestionAnswer,
  Turn,
  TurnStatus,
} from "../protocol/primitives.js";
import { readClaudeAgentTeamTopology } from "./claude-code/team-topology.js";
import type { Subprocess } from "bun";

type TextualBlock = Extract<Block, { type: "text" | "reasoning" }>;

interface ClaudeResumeContext {
  cwd: string;
  resumeId: string;
  sessionPath: string;
}

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

  // Track pending question blocks: toolCallId → blockId
  private questionBlockMap = new Map<string, string>();

  // Resolvers waiting for the user's answer: blockId → resolve fn
  private pendingAnswers = new Map<string, (answer: string[]) => void>();

  private activeStreamBlocks = new Map<number, TextualBlock>();
  private sawStreamTextThisTurn = false;

  constructor(config: AdapterConfig) {
    const resumeContext = resolveClaudeResumeContext(config);
    const resolvedConfig: AdapterConfig = resumeContext
      ? {
          ...config,
          cwd: resumeContext.cwd,
          options: {
            ...config.options,
            resume: resumeContext.resumeId,
          },
        }
      : config;

    super(resolvedConfig);

    if (resumeContext) {
      this.session.providerMeta = {
        ...(this.session.providerMeta ?? {}),
        resumeSessionPath: resumeContext.sessionPath,
        resumeProjectCwd: resumeContext.cwd,
      };
    }
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

    const env = { ...process.env, ...this.config.env };
    const claudeExecutable = resolveExecutableFromPath("claude", env);

    this.process = Bun.spawn([claudeExecutable, ...args], {
      cwd: this.config.cwd,
      env,
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
    this.activeStreamBlocks.clear();
    this.sawStreamTextThisTurn = false;

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
          if (typeof event.cwd === "string" && event.cwd.trim()) {
            this.session.cwd = event.cwd;
          }
          if (typeof event.model === "string" && event.model.trim()) {
            this.session.model = event.model;
          }
          this.refreshObservedTopologyAndEmit();
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

      case "stream_event": {
        this.handleStreamEvent(event);
        break;
      }

      case "result": {
        this.completeOpenStreamBlocks();

        // Surface any permission-denied AskUserQuestion calls as denied blocks.
        const denials: any[] = Array.isArray(event.permission_denials) ? event.permission_denials : [];
        for (const denial of denials) {
          if (denial.tool_name === "AskUserQuestion" && this.currentTurn) {
            const input = denial.tool_input ?? {};
            const questions: any[] = Array.isArray(input.questions) ? input.questions : [];
            const first = questions[0] ?? {};
            const options = Array.isArray(first.options)
              ? first.options.map((o: any) => ({ label: o.label ?? String(o), description: o.description }))
              : [];
            const block = this.startBlock(this.currentTurn, {
              type: "question",
              header: first.header,
              question: first.question ?? "",
              options,
              multiSelect: first.multiSelect ?? false,
              questionStatus: "denied",
              status: "completed",
            });
            this.emitBlockEnd(this.currentTurn, block, "completed");
          }
        }

        // Turn complete — the stream continues for the next turn.
        if (this.currentTurn && this.currentTurn.status !== "stopped") {
          this.refreshObservedTopologyAndEmit();
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

      // rate_limit_event, etc. — ignore for now.
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleAssistant(event: any): void {
    if (!this.currentTurn) return;
    if (this.sawStreamTextThisTurn) return;

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

  private handleStreamEvent(event: any): void {
    if (!this.currentTurn) return;

    const streamEvent = event.event;
    if (!streamEvent || typeof streamEvent !== "object") return;

    const streamType = typeof streamEvent.type === "string" ? streamEvent.type : "";
    if (streamType === "message_start") {
      this.activeStreamBlocks.clear();
      this.sawStreamTextThisTurn = false;
      return;
    }

    if (streamType === "content_block_start") {
      const index = typeof streamEvent.index === "number" ? streamEvent.index : 0;
      const contentBlock = streamEvent.content_block;
      if (!contentBlock || typeof contentBlock !== "object") return;

      const contentType = typeof contentBlock.type === "string" ? contentBlock.type : "";
      if (contentType !== "text" && contentType !== "thinking") {
        return;
      }

      const block = this.startBlock(this.currentTurn, {
        type: contentType === "thinking" ? "reasoning" : "text",
        text: "",
        status: "streaming",
      }) as TextualBlock;

      this.activeStreamBlocks.set(index, block);
      this.sawStreamTextThisTurn = true;

      const initialText = contentType === "thinking"
        ? typeof contentBlock.thinking === "string" ? contentBlock.thinking : ""
        : typeof contentBlock.text === "string" ? contentBlock.text : "";
      this.appendTextDelta(block, initialText);
      return;
    }

    if (streamType === "content_block_delta") {
      const index = typeof streamEvent.index === "number" ? streamEvent.index : 0;
      const block = this.activeStreamBlocks.get(index);
      const delta = streamEvent.delta;
      if (!block || !delta || typeof delta !== "object") return;

      const deltaType = typeof delta.type === "string" ? delta.type : "";
      if (deltaType === "text_delta") {
        this.appendTextDelta(block, typeof delta.text === "string" ? delta.text : "");
        return;
      }

      if (deltaType === "thinking_delta") {
        this.appendTextDelta(block, typeof delta.thinking === "string" ? delta.thinking : "");
      }
      return;
    }

    if (streamType === "content_block_stop") {
      const index = typeof streamEvent.index === "number" ? streamEvent.index : 0;
      const block = this.activeStreamBlocks.get(index);
      if (!block || !this.currentTurn) return;

      this.emitBlockEnd(this.currentTurn, block, "completed");
      this.activeStreamBlocks.delete(index);
    }
  }

  private handleToolUse(event: any): void {
    if (!this.currentTurn) return;

    const toolName: string = event.tool_name ?? event.name ?? "unknown";
    const toolCallId: string = event.tool_use_id ?? event.id ?? crypto.randomUUID();

    let action: Action;

    if (toolName === "AskUserQuestion") {
      const input = event.input ?? {};
      const questions: any[] = Array.isArray(input.questions) ? input.questions : [];
      const first = questions[0] ?? {};
      const options = Array.isArray(first.options)
        ? first.options.map((o: any) => ({ label: o.label ?? String(o), description: o.description }))
        : [];

      const block = this.startBlock(this.currentTurn, {
        type: "question",
        header: first.header,
        question: first.question ?? "",
        options,
        multiSelect: first.multiSelect ?? false,
        questionStatus: "awaiting_answer",
        answer: undefined,
        status: "streaming",
      });

      this.toolBlockMap.set(toolCallId, block.id);
      this.questionBlockMap.set(toolCallId, block.id);

      // Wait asynchronously for the user's answer, then write it back to stdin.
      void this.awaitAndSendAnswer(block.id, toolCallId);
      return;
    }

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
  // Interactive question handling
  // ---------------------------------------------------------------------------

  /**
   * Called by the bridge when the user answers a QuestionBlock.
   * Resolves the pending promise so awaitAndSendAnswer can write stdin.
   */
  answerQuestion(answer: QuestionAnswer): void {
    const resolve = this.pendingAnswers.get(answer.blockId);
    if (!resolve) return;
    this.pendingAnswers.delete(answer.blockId);
    resolve(answer.answer);

    // Emit the answer delta so all surfaces update.
    const turn = this.currentTurn;
    if (turn) {
      this.emit("event", {
        event: "block:question:answer",
        sessionId: this.session.id,
        turnId: turn.id,
        blockId: answer.blockId,
        questionStatus: "answered",
        answer: answer.answer,
      });
    }
  }

  private async awaitAndSendAnswer(blockId: string, toolCallId: string): Promise<void> {
    const answer = await new Promise<string[]>((resolve) => {
      this.pendingAnswers.set(blockId, resolve);
    });

    // Write the answer back to Claude Code's stdin as a tool_result.
    if (!this.process?.stdin || typeof this.process.stdin === "number") return;
    const response = JSON.stringify({
      type: "tool_result",
      tool_use_id: toolCallId,
      content: answer.join(", "),
    });
    this.process.stdin.write(response + "\n");
    await this.process.stdin.flush();
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
    this.activeStreamBlocks.clear();
    this.sawStreamTextThisTurn = false;
    this.emit("event", {
      event: "turn:end",
      sessionId: this.session.id,
      turnId: turn.id,
      status,
    });
  }

  private appendTextDelta(block: TextualBlock, text: string): void {
    if (!text || !this.currentTurn) return;

    block.text += text;
    this.emit("event", {
      event: "block:delta",
      sessionId: this.session.id,
      turnId: this.currentTurn.id,
      blockId: block.id,
      text,
    });
  }

  private refreshObservedTopology(): void {
    const topology = readClaudeAgentTeamTopology({
      cwd: this.session.cwd ?? this.config.cwd,
      claudeSessionId: this.claudeSessionId,
    });
    const providerMeta = { ...(this.session.providerMeta ?? {}) };

    if (topology) {
      providerMeta[OBSERVED_HARNESS_TOPOLOGY_META_KEY] = topology;
    } else {
      delete providerMeta[OBSERVED_HARNESS_TOPOLOGY_META_KEY];
    }

    this.session.providerMeta = Object.keys(providerMeta).length > 0 ? providerMeta : undefined;
  }

  private emitSessionUpdate(): void {
    this.emit("event", { event: "session:update", session: { ...this.session } });
  }

  private refreshObservedTopologyAndEmit(): void {
    this.refreshObservedTopology();
    this.emitSessionUpdate();
  }

  private completeOpenStreamBlocks(): void {
    if (!this.currentTurn) return;

    for (const block of this.activeStreamBlocks.values()) {
      this.emitBlockEnd(this.currentTurn, block, "completed");
    }
    this.activeStreamBlocks.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory export
// ---------------------------------------------------------------------------

export const createAdapter = (config: AdapterConfig) => new ClaudeCodeAdapter(config);

function resolveClaudeResumeContext(config: AdapterConfig): ClaudeResumeContext | null {
  const rawResumeId = config.options?.["resume"];
  const resumeId = typeof rawResumeId === "string" ? rawResumeId.trim().replace(/\.jsonl$/u, "") : "";
  if (!resumeId) {
    return null;
  }

  const projectsRoot = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsRoot)) {
    return null;
  }

  let projectSlugs: string[];
  try {
    projectSlugs = readdirSync(projectsRoot);
  } catch {
    return null;
  }

  for (const slug of projectSlugs) {
    const sessionPath = join(projectsRoot, slug, `${resumeId}.jsonl`);
    if (!existsSync(sessionPath)) {
      continue;
    }

    const cwd = decodeClaudeProjectsSlug(slug);
    if (!cwd) {
      continue;
    }

    try {
      if (!statSync(cwd).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    return {
      cwd,
      resumeId,
      sessionPath,
    };
  }

  return null;
}

function decodeClaudeProjectsSlug(slug: string): string | null {
  if (!slug.startsWith("-")) {
    return null;
  }

  const tail = slug.slice(1);
  if (!tail) {
    return null;
  }

  return `/${tail.replace(/-/g, "/")}`;
}

function resolveExecutableFromPath(command: string, env: Record<string, string | undefined>): string {
  if (command.includes("/")) {
    return command;
  }

  const pathValue = env.PATH ?? process.env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Keep searching.
    }
  }

  return command;
}
