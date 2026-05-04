import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, appendFile, constants, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

import { buildScoutMcpCodexLaunchArgs } from "../codex-launch-config.js";
import { BaseAdapter } from "../protocol/adapter.js";
import type { AdapterConfig } from "../protocol/adapter.js";
import type {
  Action,
  ActionBlock,
  Block,
  BlockStatus,
  Prompt,
  SessionStatus,
  Turn,
  TurnStatus,
} from "../protocol/primitives.js";

type CodexRequest = {
  id: string | number;
  method: string;
  params?: unknown;
};

type CodexResponse = {
  id: string | number;
  result?: unknown;
  error?: {
    message?: string;
    code?: string | number;
    data?: unknown;
  };
};

type CodexNotification = {
  method: string;
  params?: Record<string, unknown>;
};

type CodexServerRequest = {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type CodexErrorResponse = {
  code: number;
  message: string;
  data?: unknown;
};

type ThreadStartResult = {
  thread: {
    id: string;
    path?: string | null;
    cwd?: string | null;
    name?: string | null;
  };
};

type ThreadResumeResult = ThreadStartResult;

type TurnStartResult = {
  turn: {
    id: string;
  };
};

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

type CodexSessionOptions = {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs: string[];
  approvalPolicy?: "untrusted" | "on-request" | "on-failure" | "never";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  threadId?: string;
  requireExistingThread?: boolean;
};

type ActiveTurnState = {
  turn: Turn;
  blocksByItemId: Map<string, Block>;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function parseJsonLine(line: string): CodexResponse | CodexNotification | CodexServerRequest | null {
  try {
    return JSON.parse(line) as CodexResponse | CodexNotification | CodexServerRequest;
  } catch {
    return null;
  }
}

function buildUnsupportedServerRequestError(message: CodexServerRequest): CodexErrorResponse {
  if (message.method === "item/tool/call") {
    const tool = typeof message.params?.tool === "string" ? message.params.tool : null;
    const toolLabel = tool ? `dynamic tool call \`${tool}\`` : "dynamic tool call";
    return {
      code: -32000,
      message: `${toolLabel} is not supported by openscout-runtime`,
    };
  }

  return {
    code: -32000,
    message: `Unsupported server request: ${message.method}`,
  };
}

function isResponse(message: unknown): message is CodexResponse {
  return Boolean(
    message
    && typeof message === "object"
    && "id" in message
    && ("result" in message || "error" in message),
  );
}

function isServerRequest(message: unknown): message is CodexServerRequest {
  return Boolean(
    message
    && typeof message === "object"
    && "id" in message
    && "method" in message
    && !("result" in message)
    && !("error" in message),
  );
}

function isNotification(message: unknown): message is CodexNotification {
  return Boolean(
    message
    && typeof message === "object"
    && "method" in message
    && !("id" in message),
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed || null;
  } catch {
    return null;
  }
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

function isMissingCodexRolloutError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes("no rollout found for thread id");
}

async function isExecutable(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCodexExecutable(): Promise<string> {
  const explicitCandidates = [
    process.env.OPENSCOUT_CODEX_BIN,
    process.env.CODEX_BIN,
  ].filter(Boolean) as string[];

  for (const candidate of explicitCandidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  const commonDirectories = [
    `${process.env.HOME ?? ""}/.local/bin`,
    `${process.env.HOME ?? ""}/.bun/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(Boolean);

  for (const directory of [...pathEntries, ...commonDirectories]) {
    const candidate = join(directory, "codex");
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return "codex";
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

  private process: ChildProcessWithoutNullStreams | null = null;
  private lineBuffer = "";
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<string | number, PendingRequest>();
  private serialized = Promise.resolve();
  private starting: Promise<void> | null = null;

  private currentThreadId: string | null = null;
  private currentThreadPath: string | null = null;
  private currentTurnState: ActiveTurnState | null = null;
  private blockIndex = 0;

  constructor(config: AdapterConfig) {
    super(config);
  }

  async start(): Promise<void> {
    await this.ensureStarted();
  }

  send(prompt: Prompt): void {
    void this.enqueue(async () => {
      try {
        await this.ensureStarted();
        if (!this.currentThreadId) {
          throw new Error(`Codex adapter for ${this.session.name} has no active thread.`);
        }

        const input = [
          {
            type: "text",
            text: prompt.text,
            text_elements: [],
          },
        ];

        if (this.currentTurnState?.turn.id) {
          await this.request("turn/steer", {
            threadId: this.currentThreadId,
            expectedTurnId: this.currentTurnState.turn.id,
            input,
          });
          return;
        }

        await this.request<TurnStartResult>("turn/start", {
          threadId: this.currentThreadId,
          cwd: this.codexOptions.cwd,
          input,
        });
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  }

  interrupt(): void {
    void this.enqueue(async () => {
      try {
        await this.ensureStarted();
        if (!this.currentThreadId || !this.currentTurnState?.turn.id) {
          return;
        }

        await this.request("turn/interrupt", {
          threadId: this.currentThreadId,
          turnId: this.currentTurnState.turn.id,
        });
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  }

  async shutdown(): Promise<void> {
    const child = this.process;
    this.process = null;
    this.starting = null;
    this.lineBuffer = "";

    const turnState = this.currentTurnState;
    this.currentTurnState = null;
    if (turnState) {
      this.closeOpenBlocks(turnState, "failed");
      this.finishTurn(turnState, "stopped");
    }

    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error(`Codex adapter for ${this.session.name} was shut down.`));
    }
    this.pendingRequests.clear();

    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
    }

    this.setStatus("closed");
    await this.persistState();
  }

  private get codexOptions(): CodexSessionOptions {
    const runtimeRoot = join(homedir(), ".scout/pairing", "codex", this.session.id);
    const configuredThreadId = this.config.options?.["threadId"] as string | undefined;
    const requireExistingThread = this.config.options?.["requireExistingThread"] as boolean | undefined;
    const rawLaunchArgs = this.config.options?.["launchArgs"];
    const launchArgs = Array.isArray(rawLaunchArgs)
      ? rawLaunchArgs.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    return {
      agentName: this.session.name,
      sessionId: this.session.id,
      cwd: this.config.cwd ?? process.cwd(),
      systemPrompt: this.systemPrompt,
      runtimeDirectory: join(runtimeRoot, "runtime"),
      logsDirectory: join(runtimeRoot, "logs"),
      launchArgs,
      threadId: typeof configuredThreadId === "string" && configuredThreadId.trim().length > 0
        ? configuredThreadId.trim()
        : undefined,
      requireExistingThread: requireExistingThread ?? Boolean(configuredThreadId),
    };
  }

  private get systemPrompt(): string {
    const raw = this.config.options?.systemPrompt;
    return typeof raw === "string" && raw.trim().length > 0
      ? raw
      : "You are a helpful agent working through Pairing.";
  }

  private get threadIdPath(): string {
    return join(this.codexOptions.runtimeDirectory, "codex-thread-id.txt");
  }

  private get statePath(): string {
    return join(this.codexOptions.runtimeDirectory, "state.json");
  }

  private get stdoutLogPath(): string {
    return join(this.codexOptions.logsDirectory, "stdout.log");
  }

  private get stderrLogPath(): string {
    return join(this.codexOptions.logsDirectory, "stderr.log");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.serialized.then(task, task);
    this.serialized = next.then(() => undefined, () => undefined);
    return next;
  }

  private async ensureStarted(): Promise<void> {
    if (this.process && !this.process.killed && this.process.exitCode === null && this.currentThreadId) {
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
    await mkdir(options.runtimeDirectory, { recursive: true });
    await mkdir(options.logsDirectory, { recursive: true });
    await writeFile(join(options.runtimeDirectory, "prompt.txt"), options.systemPrompt);

    const codexExecutable = await resolveCodexExecutable();
    const childEnv = {
      ...process.env,
      ...(this.config.env ?? {}),
    };
    const child = spawn(codexExecutable, [
      "app-server",
      ...buildScoutMcpCodexLaunchArgs({
        currentDirectory: options.cwd,
        env: childEnv,
      }),
      ...options.launchArgs,
    ], {
      cwd: options.cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process = child;
    this.lineBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      void appendFile(this.stdoutLogPath, chunk).catch(() => undefined);
      this.handleStdoutChunk(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      void appendFile(this.stderrLogPath, chunk).catch(() => undefined);
    });
    child.once("error", (error) => {
      this.failSession(new Error(`Codex app-server failed for ${this.session.name}: ${errorMessage(error)}`));
    });
    child.once("exit", (code, signal) => {
      if (this.session.status === "closed") {
        return;
      }
      this.failSession(
        new Error(
          `Codex app-server exited for ${this.session.name}`
          + (code !== null ? ` with code ${code}` : "")
          + (signal ? ` (${signal})` : ""),
        ),
      );
    });

    await this.request("initialize", {
      clientInfo: {
        name: "openscout-pairing",
        title: "OpenScout Pairing",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized");

    await this.resumeOrStartThread();
    this.setStatus("idle");
    await this.persistState();
  }

  private async resumeOrStartThread(): Promise<void> {
    const options = this.codexOptions;
    const requestedThreadId = options.threadId?.trim() || null;
    const storedThreadId = requestedThreadId ?? await readOptionalFile(this.threadIdPath);

    if (storedThreadId) {
      try {
        const resumed = await this.request<ThreadResumeResult>("thread/resume", {
          threadId: storedThreadId,
          cwd: options.cwd,
          approvalPolicy: options.approvalPolicy ?? "never",
          sandbox: options.sandbox ?? "danger-full-access",
          baseInstructions: options.systemPrompt,
          persistExtendedHistory: true,
        });
        this.currentThreadId = resumed.thread.id;
        this.currentThreadPath = resumed.thread.path ?? null;
        this.updateSessionFromThread(resumed.thread);
        await this.persistThreadId();
        return;
      } catch (error) {
        await appendFile(
          this.stderrLogPath,
          `[openscout] failed to resume stored Codex thread ${storedThreadId}: ${errorMessage(error)}\n`,
        ).catch(() => undefined);

        if (!requestedThreadId && isMissingCodexRolloutError(error)) {
          await rm(this.threadIdPath, { force: true }).catch(() => undefined);
        }

        if (requestedThreadId || options.requireExistingThread) {
          throw new Error(`Failed to resume requested Codex thread ${storedThreadId}: ${errorMessage(error)}`);
        }
      }
    }

    if (options.requireExistingThread) {
      const detail = requestedThreadId
        ? ` for requested thread ${requestedThreadId}`
        : "";
      throw new Error(`Codex adapter for ${this.session.name} requires an existing thread${detail}.`);
    }

    const started = await this.request<ThreadStartResult>("thread/start", {
      cwd: options.cwd,
      approvalPolicy: options.approvalPolicy ?? "never",
      sandbox: options.sandbox ?? "danger-full-access",
      baseInstructions: options.systemPrompt,
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });
    this.currentThreadId = started.thread.id;
    this.currentThreadPath = started.thread.path ?? null;
    this.updateSessionFromThread(started.thread);
    await this.persistThreadId();
  }

  private handleStdoutChunk(chunk: string): void {
    this.lineBuffer += chunk;
    while (true) {
      const newlineIndex = this.lineBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      const message = parseJsonLine(line);
      if (!message) {
        void appendFile(this.stderrLogPath, `[openscout] unparsable app-server output: ${line}\n`).catch(() => undefined);
        continue;
      }

      if (isResponse(message)) {
        this.handleResponse(message);
        continue;
      }

      if (isServerRequest(message)) {
        this.handleServerRequest(message);
        continue;
      }

      if (isNotification(message)) {
        this.handleNotification(message);
      }
    }
  }

  private handleResponse(message: CodexResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || `Codex app-server request failed: ${String(message.id)}`));
      return;
    }

    pending.resolve(message.result);
  }

  private handleServerRequest(message: CodexServerRequest): void {
    this.writeMessage({
      id: message.id,
      error: buildUnsupportedServerRequestError(message),
    });
  }

  private handleNotification(message: CodexNotification): void {
    const params = message.params ?? {};
    const turnId = typeof params.turnId === "string" ? params.turnId : null;

    switch (message.method) {
      case "thread/started":
      case "thread/name/updated": {
        const thread = params.thread as Record<string, unknown> | undefined;
        if (thread) {
          this.updateSessionFromThread(thread);
          void this.persistThreadId();
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

    const turnState = this.ensureTurn(turnId);
    switch (itemType) {
      case "agentMessage":
        this.ensureTextBlock(turnState, itemId, typeof item.text === "string" ? item.text : "");
        return;
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
    this.emitTextDelta(turnState.turn, block, delta);
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

    const turnState = this.ensureTurn(turnId);
    switch (itemType) {
      case "agentMessage": {
        const block = this.ensureTextBlock(turnState, itemId);
        const finalText = typeof item.text === "string" ? item.text : "";
        this.emitMissingText(turnState.turn, block, finalText);
        this.completeBlock(turnState.turn, block);
        turnState.blocksByItemId.delete(itemId);
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
    this.session.providerMeta = nextProviderMeta;
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
    if (this.process) {
      this.process.removeAllListeners();
      this.process.stdout.removeAllListeners();
      this.process.stderr.removeAllListeners();
    }
    this.process = null;
    this.starting = null;

    const turnState = this.currentTurnState;
    this.currentTurnState = null;
    if (turnState) {
      this.emitErrorBlock(turnState.turn, error.message);
      this.closeOpenBlocks(turnState, "failed");
      this.finishTurn(turnState, "failed");
    }

    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();

    this.emit("error", error);
    this.setStatus("error");
    void appendFile(this.stderrLogPath, `[openscout] ${error.message}\n`).catch(() => undefined);
    void this.persistState();
  }

  private async persistThreadId(): Promise<void> {
    if (!this.currentThreadId) {
      await rm(this.threadIdPath, { force: true });
      return;
    }

    await writeFile(this.threadIdPath, `${this.currentThreadId}\n`);
    await this.persistState();
  }

  private async persistState(): Promise<void> {
    const options = this.codexOptions;
    await writeFile(
      this.statePath,
      JSON.stringify({
        agentId: options.agentName,
        transport: "codex_app_server",
        sessionId: options.sessionId,
        projectRoot: options.cwd,
        cwd: options.cwd,
        threadId: this.currentThreadId,
        threadPath: this.currentThreadPath,
        requestedThreadId: options.threadId ?? null,
        requireExistingThread: options.requireExistingThread === true,
        pid: this.process?.pid ?? null,
        stdoutLogFile: this.stdoutLogPath,
        stderrLogFile: this.stderrLogPath,
        updatedAt: new Date().toISOString(),
      }, null, 2) + "\n",
    );
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    const id = String(this.nextRequestId++);

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });

      try {
        const request: CodexRequest = { id, method, params };
        this.writeMessage(request);
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  }

  private notify(method: string, params?: unknown): void {
    this.writeMessage(params === undefined ? { method } : { method, params });
  }

  private writeMessage(message: Record<string, unknown>): void {
    const child = this.process;
    if (!child || child.killed || child.exitCode !== null) {
      throw new Error(`Codex app-server for ${this.session.name} is not running.`);
    }

    child.stdin.write(`${JSON.stringify(message)}\n`);
  }
}

export const createAdapter = (config: AdapterConfig) => new CodexAdapter(config);
