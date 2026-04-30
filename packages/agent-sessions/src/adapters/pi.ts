// Pi adapter — persistent process with bidirectional RPC.
//
// Spawns `pi --mode rpc` as a persistent process. The Pi coding agent streams
// structured JSON events for the full turn lifecycle: agent_start, turn_start,
// message_start, message_update (text_delta, tool_use, tool_result, thinking),
// message_end, turn_end, agent_end.
//
// Pi RPC commands:
//   prompt       — send a user message (starts a turn)
//   steer        — inject mid-turn guidance (maps to Proposal 002)
//   follow_up    — queue a follow-up after current turn
//   abort        — interrupt the current turn
//   get_state    — get session state
//   new_session  — start a fresh session
//   switch_session / fork — session management
//
// Faithful harness: Pi's extensions, skills, and prompt templates are loaded
// from the project's config unless explicitly disabled. The adapter deliberately
// does not inherit the full environment; it forwards only runtime basics and
// credentials for the selected provider.

import { BaseAdapter } from "../protocol/adapter.js";
import type { AdapterConfig } from "../protocol/adapter.js";
import type {
  Action,
  Block,
  BlockStatus,
  Prompt,
  Turn,
  TurnStatus,
} from "../protocol/primitives.js";
import type { Subprocess } from "bun";

const BASE_PROCESS_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
] as const;

type EnvSource = Record<string, string | undefined>;

type CredentialEnvMapping = {
  outputKey: string;
  sourceKeys?: readonly string[];
};

const PROVIDER_CREDENTIAL_ENV: Record<string, readonly CredentialEnvMapping[]> = {
  anthropic: [
    { outputKey: "ANTHROPIC_API_KEY" },
    { outputKey: "ANTHROPIC_OAUTH_TOKEN" },
  ],
  azure: [
    { outputKey: "AZURE_OPENAI_API_KEY" },
    { outputKey: "AZURE_OPENAI_BASE_URL" },
    { outputKey: "AZURE_OPENAI_RESOURCE_NAME" },
    { outputKey: "AZURE_OPENAI_API_VERSION" },
    { outputKey: "AZURE_OPENAI_DEPLOYMENT_NAME_MAP" },
  ],
  bedrock: [
    { outputKey: "AWS_ACCESS_KEY_ID" },
    { outputKey: "AWS_SECRET_ACCESS_KEY" },
    { outputKey: "AWS_SESSION_TOKEN" },
    { outputKey: "AWS_REGION" },
    { outputKey: "AWS_DEFAULT_REGION" },
    { outputKey: "AWS_PROFILE" },
  ],
  cerebras: [{ outputKey: "CEREBRAS_API_KEY" }],
  gemini: [{ outputKey: "GEMINI_API_KEY" }],
  google: [{ outputKey: "GEMINI_API_KEY" }],
  groq: [{ outputKey: "GROQ_API_KEY" }],
  kimi: [{ outputKey: "KIMI_API_KEY" }],
  minimax: [{
    outputKey: "MINIMAX_API_KEY",
    sourceKeys: ["MINIMAX_API_KEY", "MINIMAX_TOKEN"],
  }],
  mistral: [{ outputKey: "MISTRAL_API_KEY" }],
  moonshot: [{ outputKey: "KIMI_API_KEY" }],
  openai: [{ outputKey: "OPENAI_API_KEY" }],
  openrouter: [{ outputKey: "OPENROUTER_API_KEY" }],
  opencode: [{ outputKey: "OPENCODE_API_KEY" }],
  vercel: [{ outputKey: "AI_GATEWAY_API_KEY" }],
  xai: [{ outputKey: "XAI_API_KEY" }],
  zai: [{ outputKey: "ZAI_API_KEY" }],
};

function readEnvValue(source: EnvSource | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function copyFirstValue(
  target: Record<string, string>,
  outputKey: string,
  keys: readonly string[],
  sources: readonly EnvSource[],
): void {
  for (const source of sources) {
    for (const key of keys) {
      const value = readEnvValue(source, key);
      if (value) {
        target[outputKey] = value;
        return;
      }
    }
  }
}

function normalizeProvider(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "azure-openai") return "azure";
  if (normalized === "aws" || normalized === "aws-bedrock") return "bedrock";
  if (normalized === "ai-gateway" || normalized === "ai_gateway") return "vercel";
  if (normalized === "grok") return "xai";
  return normalized;
}

function inferProviderFromModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const normalized = model.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("/")) {
    return normalizeProvider(normalized.split("/", 1)[0]);
  }
  if (normalized.startsWith("minimax")) return "minimax";
  if (normalized.startsWith("claude")) return "anthropic";
  if (
    normalized.startsWith("gpt")
    || normalized.startsWith("o1")
    || normalized.startsWith("o3")
    || normalized.startsWith("o4")
  ) return "openai";
  if (normalized.startsWith("gemini")) return "google";
  if (normalized.startsWith("mistral") || normalized.startsWith("codestral")) return "mistral";
  return undefined;
}

function selectedProvider(options: AdapterConfig["options"] | undefined): string | undefined {
  const provider = typeof options?.provider === "string" ? options.provider : undefined;
  const model = typeof options?.model === "string" ? options.model : undefined;
  return normalizeProvider(provider) ?? inferProviderFromModel(model);
}

export function buildPiProcessEnv(
  config: Pick<AdapterConfig, "env" | "options">,
  sourceEnv: EnvSource = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  const sources = [config.env ?? {}, sourceEnv];

  for (const key of BASE_PROCESS_ENV_KEYS) {
    copyFirstValue(env, key, [key], sources);
  }

  const provider = selectedProvider(config.options);
  const credentialMappings = provider ? PROVIDER_CREDENTIAL_ENV[provider] : undefined;
  if (!credentialMappings) {
    return env;
  }

  for (const mapping of credentialMappings) {
    copyFirstValue(env, mapping.outputKey, mapping.sourceKeys ?? [mapping.outputKey], sources);
  }

  return env;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PiAdapter extends BaseAdapter {
  readonly type = "pi";

  private process: Subprocess | null = null;
  private currentTurn: Turn | null = null;
  private blockIndex = 0;

  // Track streaming blocks for delta accumulation.
  private currentTextBlock: Block | null = null;
  private currentReasoningBlock: Block | null = null;
  private toolBlockByIndex = new Map<number, Block>();

  constructor(config: AdapterConfig) {
    super(config);
  }

  async start(): Promise<void> {
    const args = ["--mode", "rpc"];

    // Model override.
    const model = this.config.options?.["model"] as string | undefined;
    if (model) args.push("--model", model);

    // Provider override.
    const provider = this.config.options?.["provider"] as string | undefined;
    if (provider) args.push("--provider", provider);

    // Thinking level.
    const thinking = this.config.options?.["thinking"] as string | undefined;
    if (thinking) args.push("--thinking", thinking);

    // Resume a previous session.
    const resume = this.config.options?.["resume"] as boolean | undefined;
    if (resume) args.push("--continue");

    // Session path.
    const sessionPath = this.config.options?.["session"] as string | undefined;
    if (sessionPath) args.push("--session", sessionPath);

    // Additional extensions.
    const extensions = this.config.options?.["extensions"] as string[] | undefined;
    if (extensions) {
      for (const ext of extensions) args.push("--extension", ext);
    }

    // Note: we do NOT pass --no-extensions or --no-skills by default.
    // Faithful harness behavior comes from Pi's project config, not shell-wide
    // credential inheritance.

    const env = buildPiProcessEnv(this.config);

    this.process = Bun.spawn(["pi", ...args], {
      cwd: this.config.cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    this.readStdout();

    this.process.exited.then((code) => {
      if (code !== 0 && this.session.status !== "closed") {
        this.emit("error", new Error(`pi exited with code ${code}`));
        this.setStatus("error");
      }
    });

    this.setStatus("active");
  }

  send(prompt: Prompt): void {
    this.sendRPC({
      type: "prompt",
      message: prompt.text,
      images: prompt.images?.map((img) => ({
        mimeType: img.mimeType,
        data: img.data,
      })),
    });
  }

  interrupt(): void {
    this.sendRPC({ type: "abort" });
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
  // RPC send
  // ---------------------------------------------------------------------------

  private sendRPC(command: Record<string, unknown>): void {
    const stdin = this.process?.stdin;
    if (!stdin || typeof stdin === "number") return;
    stdin.write(JSON.stringify(command) + "\n");
    stdin.flush();
  }

  // ---------------------------------------------------------------------------
  // Stdout reader
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

    if (this.currentTurn && this.currentTurn.status !== "stopped") {
      this.endTurn(this.currentTurn, "completed");
    }
  }

  // ---------------------------------------------------------------------------
  // Event router — Pi RPC events → Pairing primitives
  // ---------------------------------------------------------------------------

  private handleEvent(event: any): void {
    switch (event.type) {
      case "turn_start": {
        this.blockIndex = 0;
        this.currentTextBlock = null;
        this.currentReasoningBlock = null;
        this.toolBlockByIndex.clear();

        const turn: Turn = {
          id: crypto.randomUUID(),
          sessionId: this.session.id,
          status: "started",
          startedAt: new Date().toISOString(),
          blocks: [],
        };
        this.currentTurn = turn;
        this.emit("event", { event: "turn:start", sessionId: this.session.id, turn });
        break;
      }

      case "turn_end": {
        this.closeOpenBlocks();
        if (this.currentTurn) {
          this.endTurn(this.currentTurn, "completed");
        }
        break;
      }

      case "message_update": {
        this.handleMessageUpdate(event);
        break;
      }

      case "message_end": {
        // Close any open blocks when a message ends.
        if (event.message?.role === "assistant") {
          this.closeOpenBlocks();
        }
        break;
      }

      case "message_start": {
        // Extract model info from assistant message start.
        if (event.message?.role === "assistant" && event.message?.model) {
          (this.session as any).model = event.message.model;
        }
        break;
      }

      case "response": {
        // RPC response — check for errors.
        if (!event.success && event.error) {
          if (this.currentTurn) {
            this.emitError(this.currentTurn, event.error);
          }
        }
        break;
      }

      // agent_start, agent_end — session-level, no action needed.
    }
  }

  // ---------------------------------------------------------------------------
  // Message update handler — the core streaming logic
  // ---------------------------------------------------------------------------

  private handleMessageUpdate(event: any): void {
    if (!this.currentTurn) return;

    const ame = event.assistantMessageEvent;
    if (!ame) return;

    switch (ame.type) {
      // -- Text streaming ---------------------------------------------------
      case "text_start": {
        this.currentTextBlock = this.startBlock(this.currentTurn, {
          type: "text",
          text: "",
          status: "streaming",
        });
        break;
      }

      case "text_delta": {
        if (this.currentTextBlock) {
          this.emit("event", {
            event: "block:delta",
            sessionId: this.session.id,
            turnId: this.currentTurn.id,
            blockId: this.currentTextBlock.id,
            text: ame.delta ?? "",
          });
        }
        break;
      }

      case "text_end": {
        if (this.currentTextBlock) {
          this.emitBlockEnd(this.currentTurn, this.currentTextBlock, "completed");
          this.currentTextBlock = null;
        }
        break;
      }

      // -- Thinking/reasoning streaming -------------------------------------
      case "thinking_start": {
        this.currentReasoningBlock = this.startBlock(this.currentTurn, {
          type: "reasoning",
          text: "",
          status: "streaming",
        });
        break;
      }

      case "thinking_delta": {
        if (this.currentReasoningBlock) {
          this.emit("event", {
            event: "block:delta",
            sessionId: this.session.id,
            turnId: this.currentTurn.id,
            blockId: this.currentReasoningBlock.id,
            text: ame.delta ?? "",
          });
        }
        break;
      }

      case "thinking_end": {
        if (this.currentReasoningBlock) {
          this.emitBlockEnd(this.currentTurn, this.currentReasoningBlock, "completed");
          this.currentReasoningBlock = null;
        }
        break;
      }

      // -- Tool use ---------------------------------------------------------
      case "tool_start": {
        const contentIndex: number = ame.contentIndex ?? 0;
        const toolName: string = ame.content?.name ?? ame.name ?? "unknown";
        const toolId: string = ame.content?.id ?? crypto.randomUUID();
        const input = ame.content?.input;

        let action: Action;

        if (toolName === "edit") {
          action = {
            kind: "file_change",
            path: input?.file_path ?? input?.path ?? "",
            diff: "",
            status: "running",
            output: "",
          };
        } else if (toolName === "bash") {
          action = {
            kind: "command",
            command: input?.command ?? "",
            status: "running",
            output: "",
          };
        } else {
          action = {
            kind: "tool_call",
            toolName,
            toolCallId: toolId,
            input,
            status: "running",
            output: "",
          };
        }

        const block = this.startBlock(this.currentTurn, {
          type: "action",
          action,
          status: "streaming",
        });

        this.toolBlockByIndex.set(contentIndex, block);
        break;
      }

      case "tool_delta": {
        const contentIndex: number = ame.contentIndex ?? 0;
        const block = this.toolBlockByIndex.get(contentIndex);
        if (block) {
          this.emit("event", {
            event: "block:action:output",
            sessionId: this.session.id,
            turnId: this.currentTurn.id,
            blockId: block.id,
            output: ame.delta ?? "",
          });
        }
        break;
      }

      case "tool_end": {
        const contentIndex: number = ame.contentIndex ?? 0;
        const block = this.toolBlockByIndex.get(contentIndex);
        if (block) {
          this.emit("event", {
            event: "block:action:status",
            sessionId: this.session.id,
            turnId: this.currentTurn.id,
            blockId: block.id,
            status: "completed",
          });
          this.emitBlockEnd(this.currentTurn, block, "completed");
          this.toolBlockByIndex.delete(contentIndex);
        }
        break;
      }

      // -- Tool result (separate from tool_end in some flows) ---------------
      case "tool_result_start":
      case "tool_result_delta": {
        const contentIndex: number = ame.contentIndex ?? 0;
        const block = this.toolBlockByIndex.get(contentIndex);
        if (block && ame.delta) {
          this.emit("event", {
            event: "block:action:output",
            sessionId: this.session.id,
            turnId: this.currentTurn.id,
            blockId: block.id,
            output: ame.delta,
          });
        }
        break;
      }

      case "tool_result_end": {
        const contentIndex: number = ame.contentIndex ?? 0;
        const block = this.toolBlockByIndex.get(contentIndex);
        if (block) {
          const isError = ame.content?.is_error ?? false;
          this.emit("event", {
            event: "block:action:status",
            sessionId: this.session.id,
            turnId: this.currentTurn.id,
            blockId: block.id,
            status: isError ? "failed" : "completed",
          });
          this.emitBlockEnd(this.currentTurn, block, isError ? "failed" : "completed");
          this.toolBlockByIndex.delete(contentIndex);
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private closeOpenBlocks(): void {
    if (!this.currentTurn) return;

    if (this.currentTextBlock) {
      this.emitBlockEnd(this.currentTurn, this.currentTextBlock, "completed");
      this.currentTextBlock = null;
    }

    if (this.currentReasoningBlock) {
      this.emitBlockEnd(this.currentTurn, this.currentReasoningBlock, "completed");
      this.currentReasoningBlock = null;
    }

    for (const [idx, block] of this.toolBlockByIndex) {
      this.emitBlockEnd(this.currentTurn, block, "completed");
    }
    this.toolBlockByIndex.clear();
  }

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

export const createAdapter = (config: AdapterConfig) => new PiAdapter(config);
