import { homedir } from "node:os";
import { join } from "node:path";

import {
  CodexAppServerTransport,
  type CodexAppServerNotification,
  type CodexAppServerSessionOptions,
} from "../../local/transports/codex-app-server.js";
import { BaseAdapter } from "../../protocol/adapter.js";
import type { AdapterConfig } from "../../protocol/adapter.js";
import { OBSERVED_HARNESS_TOPOLOGY_META_KEY } from "../../protocol/primitives.js";
import type {
  Action,
  ActionBlock,
  Block,
  BlockStatus,
  Prompt,
  SessionStatus,
  Turn,
  TurnStatus,
} from "../../protocol/primitives.js";
import {
  projectCodexAssistantStreamText,
  projectCodexAssistantText,
  type CodexHostMetadata,
} from "./host-metadata.js";
import { CodexObservedTopologyTracker } from "./topology.js";

type TurnCompletedParams = {
  threadId?: string;
  turn: {
    id: string;
    status: "completed" | "interrupted" | "failed" | "inProgress";
    error?: {
      message?: string;
      additionalDetails?: string | null;
    } | null;
  };
};

type ActiveTurnState = {
  turn: Turn;
  blocksByItemId: Map<string, Block>;
};

type AgentMessageStreamState = {
  rawText: string;
  emittedText: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractReasoningText(item: Record<string, unknown>): string {
  const summary = Array.isArray(item.summary) ? item.summary : [];
  const content = Array.isArray(item.content) ? item.content : [];

  const summaryText = summary
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const record = entry as Record<string, unknown>;
      if (typeof record.text === "string") {
        return record.text;
      }
      if (typeof record.summary === "string") {
        return record.summary;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const contentText = content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const record = entry as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n");

  return [summaryText, contentText].filter(Boolean).join("\n\n").trim();
}

function extractTextDelta(params: Record<string, unknown>): string {
  if (typeof params.delta === "string") {
    return params.delta;
  }

  if (typeof params.text === "string") {
    return params.text;
  }

  const delta = params.delta as Record<string, unknown> | undefined;
  if (typeof delta?.text === "string") {
    return delta.text;
  }

  const content = Array.isArray(params.content) ? params.content : [];
  const first = content[0] as Record<string, unknown> | undefined;
  if (typeof first?.text === "string") {
    return first.text;
  }

  return "";
}

function renderActionOutput(item: Record<string, unknown>): string {
  if (typeof item.text === "string" && item.text.trim()) {
    return item.text;
  }

  if (item.action !== undefined) {
    return stringifyValue(item.action);
  }

  if (item.output !== undefined) {
    return stringifyValue(item.output);
  }

  return stringifyValue(item);
}

function threadStatusToSessionStatus(status: string | undefined): SessionStatus {
  switch (status) {
    case "active":
      return "active";
    case "idle":
      return "idle";
    case "error":
      return "error";
    default:
      return "connecting";
  }
}

export class CodexAdapter extends BaseAdapter {
  readonly type = "codex";

  private transport: CodexAppServerTransport | null = null;
  private removeTransportNotificationListener: (() => void) | null = null;
  private removeTransportErrorListener: (() => void) | null = null;
  private serialized = Promise.resolve();
  private starting: Promise<void> | null = null;

  private currentThreadId: string | null = null;
  private currentThreadPath: string | null = null;
  private currentTurnState: ActiveTurnState | null = null;
  private codexHostMetadataRaw = new Set<string>();
  private agentMessageStreams = new Map<string, AgentMessageStreamState>();
  private blockIndex = 0;
  private readonly observedTopology: CodexObservedTopologyTracker;

  constructor(config: AdapterConfig) {
    super(config);
    this.observedTopology = new CodexObservedTopologyTracker({
      cwd: config.cwd ?? process.cwd(),
      homeDir: config.env?.HOME,
      sessionName: config.name ?? config.sessionId,
    });
  }

  async start(): Promise<void> {
    await this.ensureStarted();
  }

  send(prompt: Prompt): void {
    void this.enqueue(async () => {
      try {
        await this.ensureStarted();
        const transport = this.requireTransport();
        if (!transport.currentThreadId) {
          throw new Error(`Codex adapter for ${this.session.name} has no active thread.`);
        }

        if (this.currentTurnState?.turn.id) {
          await transport.steerTurn(prompt.text, this.currentTurnState.turn.id);
          return;
        }

        await transport.startTurn(prompt.text);
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  }

  interrupt(): void {
    void this.enqueue(async () => {
      try {
        await this.ensureStarted();
        const transport = this.requireTransport();
        if (!transport.currentThreadId || !this.currentTurnState?.turn.id) {
          return;
        }

        await transport.interruptTurn(this.currentTurnState.turn.id);
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  }

  async shutdown(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    this.starting = null;
    this.removeTransportNotificationListener?.();
    this.removeTransportNotificationListener = null;
    this.removeTransportErrorListener?.();
    this.removeTransportErrorListener = null;

    const turnState = this.currentTurnState;
    this.currentTurnState = null;
    if (turnState) {
      this.closeOpenBlocks(turnState, "failed");
      this.finishTurn(turnState, "stopped");
    }

    if (transport) {
      await transport.shutdown({ reason: `Codex adapter for ${this.session.name} was shut down` });
    }

    this.setStatus("closed");
  }

  private get codexOptions(): CodexAppServerSessionOptions {
    const runtimeRoot = join(homedir(), ".scout/pairing", "codex", this.session.id);
    const configuredThreadId = this.config.options?.["threadId"] as string | undefined;
    const requireExistingThread = this.config.options?.["requireExistingThread"] as boolean | undefined;
    const rawLaunchArgs = this.config.options?.["launchArgs"];
    const launchArgs = Array.isArray(rawLaunchArgs)
      ? rawLaunchArgs.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const approvalPolicy = this.config.options?.["approvalPolicy"];
    const sandbox = this.config.options?.["sandbox"];

    return {
      agentName: this.session.name,
      sessionId: this.session.id,
      cwd: this.config.cwd ?? process.cwd(),
      systemPrompt: this.systemPrompt,
      runtimeDirectory: join(runtimeRoot, "runtime"),
      logsDirectory: join(runtimeRoot, "logs"),
      env: this.config.env,
      launchArgs,
      threadId: typeof configuredThreadId === "string" && configuredThreadId.trim().length > 0
        ? configuredThreadId.trim()
        : undefined,
      requireExistingThread: requireExistingThread ?? Boolean(configuredThreadId),
      approvalPolicy: approvalPolicy === "untrusted" || approvalPolicy === "on-request" || approvalPolicy === "on-failure" || approvalPolicy === "never"
        ? approvalPolicy
        : undefined,
      sandbox: sandbox === "read-only" || sandbox === "workspace-write" || sandbox === "danger-full-access"
        ? sandbox
        : undefined,
      clientInfo: {
        name: "openscout-pairing",
        title: "OpenScout Pairing",
        version: "0.0.0",
      },
    };
  }

  private get systemPrompt(): string {
    const raw = this.config.options?.systemPrompt;
    return typeof raw === "string" && raw.trim().length > 0
      ? raw
      : "You are a helpful agent working through Pairing.";
  }

  private get stdoutLogPath(): string {
    return this.transport?.stdoutLogFile ?? join(this.codexOptions.logsDirectory, "stdout.log");
  }

  private get stderrLogPath(): string {
    return this.transport?.stderrLogFile ?? join(this.codexOptions.logsDirectory, "stderr.log");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.serialized.then(task, task);
    this.serialized = next.then(() => undefined, () => undefined);
    return next;
  }

  private requireTransport(): CodexAppServerTransport {
    if (!this.transport) {
      throw new Error(`Codex app-server for ${this.session.name} is not running.`);
    }
    return this.transport;
  }

  private async ensureStarted(): Promise<void> {
    if (this.transport?.isAlive() && this.transport.currentThreadId) {
      return;
    }

    if (this.starting) {
      return this.starting;
    }

    this.starting = this.startSession();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startSession(): Promise<void> {
    const options = this.codexOptions;
    this.removeTransportNotificationListener?.();
    this.removeTransportErrorListener?.();
    const transport = new CodexAppServerTransport(options);
    this.transport = transport;
    this.removeTransportNotificationListener = transport.onNotification((message) => this.handleNotification(message));
    this.removeTransportErrorListener = transport.onError((error) => this.failSession(error));

    await transport.ensureOnline();
    if (transport.currentThreadId || transport.currentThreadPath) {
      this.updateSessionFromThread({
        ...(transport.currentThreadId ? { id: transport.currentThreadId } : {}),
        ...(transport.currentThreadPath ? { path: transport.currentThreadPath } : {}),
        cwd: options.cwd,
      });
    }
    this.setStatus("idle");
  }

  private handleNotification(message: CodexAppServerNotification): void {
    const params = message.params ?? {};
    const turnId = typeof params.turnId === "string" ? params.turnId : null;

    switch (message.method) {
      case "thread/started":
      case "thread/name/updated": {
        const thread = params.thread as Record<string, unknown> | undefined;
        if (thread) {
          this.updateSessionFromThread(thread);
        }
        return;
      }
      case "thread/status/changed": {
        const status = (params.status as Record<string, unknown> | undefined)?.type;
        this.setStatus(threadStatusToSessionStatus(typeof status === "string" ? status : undefined));
        return;
      }
      case "turn/started": {
        const turn = params.turn as Record<string, unknown> | undefined;
        const startedTurnId = typeof turn?.id === "string" ? turn.id : turnId;
        if (!startedTurnId) {
          return;
        }
        this.ensureTurn(startedTurnId);
        this.setStatus("active");
        return;
      }
      case "item/started":
        this.handleItemStarted(params);
        return;
      case "item/agentMessage/delta":
        this.handleAgentMessageDelta(params);
        return;
      case "item/reasoning/delta":
      case "item/reasoning/summaryTextDelta":
        this.handleReasoningDelta(params);
        return;
      case "item/fileChange/outputDelta":
      case "item/commandExecution/outputDelta":
      case "item/toolCall/outputDelta":
        this.handleActionOutputDelta(message.method, params);
        return;
      case "item/commandExecution/terminalInteraction":
        this.handleActionTerminalInteraction(params);
        return;
      case "item/completed":
        this.handleItemCompleted(params);
        return;
      case "turn/completed":
        this.handleTurnCompleted(params as TurnCompletedParams);
        return;
      case "error": {
        const detail = typeof params.message === "string" ? params.message : "Codex app-server reported an error.";
        this.emit("error", new Error(detail));
        return;
      }
      default:
        return;
    }
  }

  private handleItemStarted(params: Record<string, unknown>): void {
    const item = params.item as Record<string, unknown> | undefined;
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    const itemId = typeof item?.id === "string" ? item.id : null;
    const itemType = typeof item?.type === "string" ? item.type : null;

    if (!turnId || !item || !itemId || !itemType || itemType === "userMessage") {
      return;
    }

    if (this.observedTopology.observeItem(item, "started")) {
      this.emitObservedTopologyUpdate();
    }

    const turnState = this.ensureTurn(turnId);
    switch (itemType) {
      case "agentMessage": {
        const initialText = typeof item.text === "string" ? this.projectAgentMessageStreamText(itemId, item.text) : "";
        this.ensureTextBlock(turnState, itemId, initialText);
        return;
      }
      case "reasoning": {
        const text = extractReasoningText(item);
        if (text) {
          this.ensureReasoningBlock(turnState, itemId, text);
        }
        return;
      }
      default:
        this.ensureActionBlock(turnState, itemId, this.buildActionFromItem(item, itemId));
    }
  }

  private handleAgentMessageDelta(params: Record<string, unknown>): void {
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    const itemId = typeof params.itemId === "string" ? params.itemId : null;
    const delta = extractTextDelta(params);

    if (!turnId || !itemId || !delta) {
      return;
    }

    const turnState = this.ensureTurn(turnId);
    const block = this.ensureTextBlock(turnState, itemId);
    const nextText = this.projectAgentMessageStreamText(itemId, delta, { append: true });
    if (nextText.startsWith(block.text)) {
      this.emitTextDelta(turnState.turn, block, nextText.slice(block.text.length));
    }
  }

  private handleReasoningDelta(params: Record<string, unknown>): void {
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    const itemId = typeof params.itemId === "string" ? params.itemId : null;
    const delta = extractTextDelta(params);

    if (!turnId || !itemId || !delta) {
      return;
    }

    const turnState = this.ensureTurn(turnId);
    const block = this.ensureReasoningBlock(turnState, itemId);
    this.emitTextDelta(turnState.turn, block, delta);
  }

  private handleActionOutputDelta(method: string, params: Record<string, unknown>): void {
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    const itemId = typeof params.itemId === "string" ? params.itemId : null;
    const output = extractTextDelta(params) || stringifyValue(params.output);

    if (!turnId || !itemId || !output) {
      return;
    }

    const turnState = this.ensureTurn(turnId);
    const block = this.ensureActionBlock(turnState, itemId, this.buildActionFromMethod(method, params, itemId));
    this.emitActionOutput(turnState.turn, block, output);
  }

  private handleActionTerminalInteraction(params: Record<string, unknown>): void {
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    const itemId = typeof params.itemId === "string" ? params.itemId : null;
    if (!turnId || !itemId) {
      return;
    }

    const turnState = this.ensureTurn(turnId);
    const block = turnState.blocksByItemId.get(itemId);
    if (block?.type !== "action") {
      return;
    }

    const exitCode = typeof params.exitCode === "number"
      ? params.exitCode
      : typeof (params.status as Record<string, unknown> | undefined)?.exitCode === "number"
        ? Number((params.status as Record<string, unknown>).exitCode)
        : undefined;
    this.emitActionStatus(turnState.turn, block, exitCode === 0 ? "completed" : "failed", exitCode === undefined ? undefined : { exitCode });
  }

  private handleItemCompleted(params: Record<string, unknown>): void {
    const item = params.item as Record<string, unknown> | undefined;
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    const itemId = typeof item?.id === "string" ? item.id : null;
    const itemType = typeof item?.type === "string" ? item.type : null;

    if (!turnId || !item || !itemId || !itemType || itemType === "userMessage") {
      return;
    }

    if (this.observedTopology.observeItem(item, "completed")) {
      this.emitObservedTopologyUpdate();
    }

    const turnState = this.ensureTurn(turnId);
    switch (itemType) {
      case "agentMessage": {
        const block = this.ensureTextBlock(turnState, itemId);
        const finalText = typeof item.text === "string" ? this.projectAgentMessageText(item.text) : "";
        this.emitMissingText(turnState.turn, block, finalText);
        this.completeBlock(turnState.turn, block);
        turnState.blocksByItemId.delete(itemId);
        this.agentMessageStreams.delete(itemId);
        return;
      }
      case "reasoning": {
        const finalText = extractReasoningText(item);
        if (!finalText && !turnState.blocksByItemId.has(itemId)) {
          return;
        }
        const block = this.ensureReasoningBlock(turnState, itemId);
        this.emitMissingText(turnState.turn, block, finalText);
        this.completeBlock(turnState.turn, block);
        turnState.blocksByItemId.delete(itemId);
        return;
      }
      default: {
        const block = this.ensureActionBlock(turnState, itemId, this.buildActionFromItem(item, itemId));
        this.emitMissingActionOutput(turnState.turn, block, renderActionOutput(item));
        this.emitActionStatus(turnState.turn, block, "completed", this.buildActionMeta(item));
        this.completeBlock(turnState.turn, block);
        turnState.blocksByItemId.delete(itemId);
      }
    }
  }

  private handleTurnCompleted(params: TurnCompletedParams): void {
    const turnId = params.turn.id;
    const turnState = this.currentTurnState;
    if (!turnState || turnState.turn.id !== turnId) {
      return;
    }

    switch (params.turn.status) {
      case "failed": {
        const message = params.turn.error?.message
          || params.turn.error?.additionalDetails
          || `Turn failed for ${this.session.name}.`;
        this.emitErrorBlock(turnState.turn, message);
        this.closeOpenBlocks(turnState, "failed");
        this.finishTurn(turnState, "failed");
        this.setStatus("error");
        return;
      }
      case "interrupted":
        this.closeOpenBlocks(turnState, "failed");
        this.finishTurn(turnState, "stopped");
        this.setStatus("idle");
        return;
      default:
        this.closeOpenBlocks(turnState, "completed");
        this.finishTurn(turnState, "completed");
        this.setStatus("idle");
    }
  }

  private ensureTurn(turnId: string): ActiveTurnState {
    const current = this.currentTurnState;
    if (current?.turn.id === turnId) {
      return current;
    }

    if (current) {
      this.closeOpenBlocks(current, "failed");
      this.finishTurn(current, "stopped");
    }

    const turn: Turn = {
      id: turnId,
      sessionId: this.session.id,
      status: "started",
      startedAt: new Date().toISOString(),
      blocks: [],
    };
    const nextState: ActiveTurnState = {
      turn,
      blocksByItemId: new Map(),
    };

    this.currentTurnState = nextState;
    this.blockIndex = 0;
    this.emit("event", {
      event: "turn:start",
      sessionId: this.session.id,
      turn,
    });
    return nextState;
  }

  private ensureTextBlock(turnState: ActiveTurnState, itemId: string, initialText = ""): Extract<Block, { type: "text" }> {
    const existing = turnState.blocksByItemId.get(itemId);
    if (existing?.type === "text") {
      return existing;
    }

    const block = this.startBlock<Extract<Block, { type: "text" }>>(turnState, {
      id: itemId,
      type: "text",
      text: initialText,
      status: "streaming",
    });
    turnState.blocksByItemId.set(itemId, block);
    return block;
  }

  private ensureReasoningBlock(turnState: ActiveTurnState, itemId: string, initialText = ""): Extract<Block, { type: "reasoning" }> {
    const existing = turnState.blocksByItemId.get(itemId);
    if (existing?.type === "reasoning") {
      return existing;
    }

    const block = this.startBlock<Extract<Block, { type: "reasoning" }>>(turnState, {
      id: itemId,
      type: "reasoning",
      text: initialText,
      status: "streaming",
    });
    turnState.blocksByItemId.set(itemId, block);
    return block;
  }

  private ensureActionBlock(turnState: ActiveTurnState, itemId: string, action: Action): ActionBlock {
    const existing = turnState.blocksByItemId.get(itemId);
    if (existing?.type === "action") {
      return existing;
    }

    const block = this.startBlock<ActionBlock>(turnState, {
      id: itemId,
      type: "action",
      action,
      status: "streaming",
    });
    turnState.blocksByItemId.set(itemId, block);
    return block;
  }

  private startBlock<T extends Block>(
    turnState: ActiveTurnState,
    partial: Omit<T, "turnId" | "index">,
  ): T {
    const block = {
      ...partial,
      turnId: turnState.turn.id,
      index: this.blockIndex++,
    } as T;

    turnState.turn.blocks.push(block);
    this.emit("event", {
      event: "block:start",
      sessionId: this.session.id,
      turnId: turnState.turn.id,
      block,
    });
    return block;
  }

  private emitTextDelta(
    turn: Turn,
    block: Extract<Block, { type: "text" | "reasoning" }>,
    text: string,
  ): void {
    if (!text) {
      return;
    }

    block.text += text;
    block.status = "streaming";
    this.emit("event", {
      event: "block:delta",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId: block.id,
      text,
    });
  }

  private emitMissingText(
    turn: Turn,
    block: Extract<Block, { type: "text" | "reasoning" }>,
    finalText: string,
  ): void {
    if (!finalText || block.text === finalText) {
      return;
    }

    if (!block.text) {
      this.emitTextDelta(turn, block, finalText);
      return;
    }

    if (finalText.startsWith(block.text)) {
      this.emitTextDelta(turn, block, finalText.slice(block.text.length));
    }
  }

  private projectAgentMessageText(rawText: string): string {
    const projected = projectCodexAssistantText(rawText);
    if (this.recordCodexHostMetadata(projected.hostMetadata)) {
      this.emitSessionUpdate();
    }
    return projected.text;
  }

  private projectAgentMessageStreamText(itemId: string, text: string, options: { append?: boolean } = {}): string {
    const state = this.agentMessageStreams.get(itemId) ?? {
      rawText: "",
      emittedText: "",
    };
    state.rawText = options.append ? state.rawText + text : text;

    const projected = projectCodexAssistantStreamText(state.rawText);
    if (this.recordCodexHostMetadata(projected.hostMetadata)) {
      this.emitSessionUpdate();
    }
    if (projected.text.startsWith(state.emittedText)) {
      state.emittedText = projected.text;
    }
    this.agentMessageStreams.set(itemId, state);
    return state.emittedText;
  }

  private recordCodexHostMetadata(entries: CodexHostMetadata[]): boolean {
    if (entries.length === 0) {
      return false;
    }

    const fresh = entries.filter((entry) => {
      if (this.codexHostMetadataRaw.has(entry.raw)) {
        return false;
      }
      this.codexHostMetadataRaw.add(entry.raw);
      return true;
    });
    if (fresh.length === 0) {
      return false;
    }

    const providerMeta: Record<string, unknown> = {
      ...(this.session.providerMeta ?? {}),
    };
    const metadata = typeof providerMeta.observeHostMetadata === "object" && providerMeta.observeHostMetadata !== null && !Array.isArray(providerMeta.observeHostMetadata)
      ? providerMeta.observeHostMetadata as Record<string, unknown>
      : {};
    const directives = Array.isArray(metadata.directives)
      ? metadata.directives.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
      : [];
    const memoryCitations = Array.isArray(metadata.memoryCitations)
      ? metadata.memoryCitations.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
      : [];

    for (const entry of fresh) {
      if (entry.kind === "directive") {
        directives.push({
          name: entry.name,
          raw: entry.raw,
        });
      } else {
        memoryCitations.push({
          raw: entry.raw,
          citationEntries: entry.citationEntries,
          rolloutIds: entry.rolloutIds,
        });
      }
    }

    if (directives.length > 0) {
      metadata.directives = directives;
    }
    if (memoryCitations.length > 0) {
      metadata.memoryCitations = memoryCitations;
    }
    providerMeta.observeHostMetadata = metadata;
    this.session.providerMeta = providerMeta;
    return true;
  }

  private emitActionOutput(turn: Turn, block: ActionBlock, output: string): void {
    if (!output) {
      return;
    }

    block.action.output += output;
    block.action.status = "running";
    this.emit("event", {
      event: "block:action:output",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId: block.id,
      output,
    });
  }

  private emitMissingActionOutput(turn: Turn, block: ActionBlock, finalOutput: string): void {
    if (!finalOutput || block.action.output === finalOutput) {
      return;
    }

    if (!block.action.output) {
      this.emitActionOutput(turn, block, finalOutput);
      return;
    }

    if (finalOutput.startsWith(block.action.output)) {
      this.emitActionOutput(turn, block, finalOutput.slice(block.action.output.length));
    }
  }

  private emitActionStatus(
    turn: Turn,
    block: ActionBlock,
    status: Action["status"],
    meta?: Record<string, unknown>,
  ): void {
    block.action.status = status;
    this.emit("event", {
      event: "block:action:status",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId: block.id,
      status,
      ...(meta ? { meta } : {}),
    });
  }

  private completeBlock(turn: Turn, block: Block, status: BlockStatus = "completed"): void {
    block.status = status;
    this.emit("event", {
      event: "block:end",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId: block.id,
      status,
    });
  }

  private closeOpenBlocks(turnState: ActiveTurnState, actionStatus: Extract<Action["status"], "completed" | "failed">): void {
    const seen = new Set<string>();
    for (const block of turnState.blocksByItemId.values()) {
      if (seen.has(block.id)) {
        continue;
      }
      seen.add(block.id);

      if (block.type === "action" && block.action.status !== actionStatus) {
        this.emitActionStatus(turnState.turn, block, actionStatus);
      }
      this.completeBlock(turnState.turn, block, actionStatus === "completed" ? "completed" : "failed");
    }
    turnState.blocksByItemId.clear();
  }

  private emitErrorBlock(turn: Turn, message: string): void {
    const turnState = this.currentTurnState;
    if (!turnState || turnState.turn.id !== turn.id) {
      return;
    }

    const block = this.startBlock<Extract<Block, { type: "error" }>>(turnState, {
      id: crypto.randomUUID(),
      type: "error",
      message,
      status: "completed",
    });
    this.completeBlock(turn, block, "completed");
  }

  private finishTurn(turnState: ActiveTurnState, status: TurnStatus): void {
    turnState.turn.status = status;
    turnState.turn.endedAt = new Date().toISOString();
    if (this.currentTurnState?.turn.id === turnState.turn.id) {
      this.currentTurnState = null;
    }
    this.emit("event", {
      event: "turn:end",
      sessionId: this.session.id,
      turnId: turnState.turn.id,
      status,
    });
  }

  private buildActionFromItem(item: Record<string, unknown>, itemId: string): Action {
    const itemType = typeof item.type === "string" ? item.type : "toolCall";

    switch (itemType) {
      case "commandExecution":
        return {
          kind: "command",
          command: typeof item.command === "string" ? item.command : "",
          output: "",
          status: "running",
        };
      case "fileChange":
        return {
          kind: "file_change",
          path: typeof item.filePath === "string"
            ? item.filePath
            : typeof item.path === "string"
              ? item.path
              : "",
          diff: typeof item.diff === "string" ? item.diff : undefined,
          output: "",
          status: "running",
        };
      case "subagent":
        return {
          kind: "subagent",
          agentId: typeof item.agentId === "string" ? item.agentId : itemId,
          agentName: typeof item.agentName === "string" ? item.agentName : undefined,
          prompt: typeof item.prompt === "string" ? item.prompt : undefined,
          output: "",
          status: "running",
        };
      default:
        return {
          kind: "tool_call",
          toolName: itemType,
          toolCallId: itemId,
          input: item,
          output: "",
          status: "running",
        };
    }
  }

  private buildActionFromMethod(method: string, params: Record<string, unknown>, itemId: string): Action {
    if (method === "item/commandExecution/outputDelta") {
      return {
        kind: "command",
        command: typeof params.command === "string" ? params.command : "",
        output: "",
        status: "running",
      };
    }

    if (method === "item/fileChange/outputDelta") {
      return {
        kind: "file_change",
        path: typeof params.filePath === "string"
          ? params.filePath
          : typeof params.path === "string"
            ? params.path
            : "",
        output: "",
        status: "running",
      };
    }

    return {
      kind: "tool_call",
      toolName: typeof params.toolName === "string"
        ? params.toolName
        : typeof params.name === "string"
          ? params.name
          : method.replace(/^item\//, "").replace(/\/outputDelta$/, ""),
      toolCallId: typeof params.toolCallId === "string" ? params.toolCallId : itemId,
      input: params.input,
      output: "",
      status: "running",
    };
  }

  private buildActionMeta(item: Record<string, unknown>): Record<string, unknown> | undefined {
    const exitCode = typeof item.exitCode === "number"
      ? item.exitCode
      : typeof (item.status as Record<string, unknown> | undefined)?.exitCode === "number"
        ? Number((item.status as Record<string, unknown>).exitCode)
        : undefined;
    if (exitCode !== undefined) {
      return { exitCode };
    }
    return undefined;
  }

  private updateSessionFromThread(thread: Record<string, unknown>): void {
    const threadId = typeof thread.id === "string" ? thread.id : null;
    const threadPath = typeof thread.path === "string" ? thread.path : null;
    const threadName = typeof thread.name === "string" && thread.name.trim().length > 0
      ? thread.name.trim()
      : null;
    const cwd = typeof thread.cwd === "string" && thread.cwd.trim().length > 0
      ? thread.cwd.trim()
      : null;

    if (threadId) {
      this.currentThreadId = threadId;
    }
    if (threadPath !== null) {
      this.currentThreadPath = threadPath;
    }
    if (threadName) {
      this.session.name = threadName;
    }
    if (cwd) {
      this.session.cwd = cwd;
    }
    this.observedTopology.updateThread(thread);

    const nextProviderMeta: Record<string, unknown> = {
      ...(this.session.providerMeta ?? {}),
    };
    if (this.currentThreadId) {
      nextProviderMeta.threadId = this.currentThreadId;
    }
    if (this.currentThreadPath) {
      nextProviderMeta.threadPath = this.currentThreadPath;
    }
    nextProviderMeta.stdoutLogFile = this.stdoutLogPath;
    nextProviderMeta.stderrLogFile = this.stderrLogPath;
    this.refreshObservedTopologyMeta(nextProviderMeta);
    this.emitSessionUpdate();
  }

  private refreshObservedTopologyMeta(providerMeta: Record<string, unknown> = { ...(this.session.providerMeta ?? {}) }): void {
    const topology = this.observedTopology.toTopology();
    if (topology) {
      providerMeta[OBSERVED_HARNESS_TOPOLOGY_META_KEY] = topology;
    } else {
      delete providerMeta[OBSERVED_HARNESS_TOPOLOGY_META_KEY];
    }
    this.session.providerMeta = Object.keys(providerMeta).length > 0 ? providerMeta : undefined;
  }

  private emitObservedTopologyUpdate(): void {
    this.refreshObservedTopologyMeta();
    this.emitSessionUpdate();
  }

  private emitSessionUpdate(): void {
    (this.session as { adapterType: string }).adapterType = this.type;
    this.emit("event", {
      event: "session:update",
      session: {
        ...this.session,
        providerMeta: this.session.providerMeta ? { ...this.session.providerMeta } : undefined,
      },
    });
  }

  private failSession(error: Error): void {
    this.starting = null;

    const turnState = this.currentTurnState;
    this.currentTurnState = null;
    if (turnState) {
      this.emitErrorBlock(turnState.turn, error.message);
      this.closeOpenBlocks(turnState, "failed");
      this.finishTurn(turnState, "failed");
    }

    this.emit("error", error);
    this.setStatus("error");
  }
}

export const createAdapter = (config: AdapterConfig) => new CodexAdapter(config);
