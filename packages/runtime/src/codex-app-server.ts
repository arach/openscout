import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildCodexAppServerSessionSnapshot,
  buildCodexRolloutSessionSnapshot,
  buildScoutMcpCodexLaunchArgs,
  buildUnsupportedCodexServerRequestError as buildUnsupportedServerRequestError,
  codexErrorMessage as errorMessage,
  isCodexNotification as isNotification,
  isCodexResponse as isResponse,
  isCodexServerRequest as isServerRequest,
  normalizeCodexAppServerLaunchArgs,
  parseCodexJsonLine as parseJsonLine,
  parseCodexJsonRecord as parseJsonRecord,
  parseCodexMaybeJson,
  readCodexAppServerModelFromLaunchArgs,
  readCodexAppServerReasoningEffortFromLaunchArgs,
  type SessionState,
  type CodexNotification,
  type CodexResponse,
  type CodexServerRequest,
} from "@openscout/agent-sessions";
import { resolveCodexExecutable } from "@openscout/agent-sessions/codex-executable";
import type { ScoutReplyContext } from "@openscout/protocol";
import { buildManagedAgentEnvironment } from "./managed-agent-environment.js";
import type { CodexApprovalPolicy, CodexSandboxMode } from "./permission-policy.js";
import { RequesterWaitTimeoutError } from "./requester-timeout.js";

export {
  buildCodexAppServerSessionSnapshot,
  buildCodexRolloutSessionSnapshot,
  normalizeCodexAppServerLaunchArgs,
  readCodexAppServerModelFromLaunchArgs,
  readCodexAppServerReasoningEffortFromLaunchArgs,
} from "@openscout/agent-sessions";
export {
  resolveCodexExecutableCandidates,
  resolveCodexExecutableInventory,
} from "@openscout/agent-sessions/codex-executable";

type SessionRequestOptions = {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs?: string[];
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandboxMode;
  threadId?: string;
  requireExistingThread?: boolean;
};

type InvocationOptions = SessionRequestOptions & {
  prompt: string;
  timeoutMs?: number;
  replyContext?: ScoutReplyContext | null;
};

type SteerOptions = SessionRequestOptions & {
  prompt: string;
};

type InterruptOptions = SessionRequestOptions;

type ThreadStartResult = {
  thread: {
    id: string;
    path?: string | null;
  };
};

type ThreadResumeResult = ThreadStartResult;

type TurnStartResult = {
  turn: {
    id: string;
  };
};

type TurnCompletedParams = {
  threadId: string;
  turn: {
    id: string;
    status: "completed" | "interrupted" | "failed" | "inProgress";
    error?: {
      message?: string;
      additionalDetails?: string | null;
    } | null;
  };
};

type ActiveTurn = {
  turnId: string;
  startedAt: number;
  messageOrder: string[];
  messageByItemId: Map<string, string>;
  resolve: (output: string) => void;
  reject: (error: Error) => void;
  watchers: Array<{
    resolve: (output: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout | null;
  }>;
};

export type CodexAppServerExitKind =
  | "proactive_shutdown"
  | "external_sigterm"
  | "unexpected_exit";

export class CodexAppServerExitError extends Error {
  readonly code = "CODEX_APP_SERVER_EXIT";

  readonly exitKind: CodexAppServerExitKind;

  readonly agentName: string;

  readonly exitCode: number | null;

  readonly signal: NodeJS.Signals | null;

  readonly reason: string | null;

  readonly noteworthy: boolean;

  constructor(input: {
    agentName: string;
    exitKind?: CodexAppServerExitKind;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    reason?: string | null;
  }) {
    const exitKind: CodexAppServerExitKind = input.exitKind ?? (input.signal === "SIGTERM"
      ? "external_sigterm"
      : "unexpected_exit");
    super(codexAppServerExitMessage({
      ...input,
      exitKind,
    }));
    this.name = "CodexAppServerExitError";
    this.exitKind = exitKind;
    this.agentName = input.agentName;
    this.exitCode = input.exitCode;
    this.signal = input.signal;
    this.reason = input.reason ?? null;
    this.noteworthy = exitKind !== "unexpected_exit";
  }
}

export function isCodexAppServerExitError(error: unknown): error is CodexAppServerExitError {
  return error instanceof CodexAppServerExitError
    || Boolean(
      error
        && typeof error === "object"
        && (error as { code?: unknown }).code === "CODEX_APP_SERVER_EXIT",
    );
}

function codexAppServerExitMessage(input: {
  agentName: string;
  exitKind: CodexAppServerExitKind;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reason?: string | null;
}): string {
  if (input.exitKind === "proactive_shutdown") {
    return `Codex app-server session for ${input.agentName} was stopped by OpenScout`
      + (input.reason ? `: ${input.reason}` : "")
      + ".";
  }

  if (input.exitKind === "external_sigterm") {
    return `Codex app-server for ${input.agentName} was interrupted by SIGTERM.`;
  }

  return `Codex app-server exited for ${input.agentName}`
    + (input.exitCode !== null ? ` with code ${input.exitCode}` : "")
    + (input.signal ? ` (${input.signal})` : "");
}

export type CodexAppServerShutdownOptions = {
  resetThread?: boolean;
  reason?: string;
};

type ProactiveCodexAppServerShutdown = {
  reason: string;
};

export type CodexSessionSnapshotOptions = Pick<
  SessionRequestOptions,
  "agentName" | "sessionId" | "cwd"
>;

function resolveRequesterTimeoutMs(timeoutMs: number | undefined): number | null {
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  return null;
}

function waitForRequesterResult<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
): Promise<T> {
  const effectiveTimeoutMs = resolveRequesterTimeoutMs(timeoutMs);
  if (effectiveTimeoutMs === null) {
    return promise;
  }

  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RequesterWaitTimeoutError({ label, timeoutMs: effectiveTimeoutMs }));
    }, effectiveTimeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function sessionKey(options: SessionRequestOptions): string {
  return `${options.agentName}:${options.sessionId}`;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function metadataRecord(metadata: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = metadata?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
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

async function readOptionalJsonRecord(filePath: string): Promise<Record<string, unknown> | null> {
  const raw = await readOptionalFile(filePath);
  return raw ? parseJsonRecord(raw) : null;
}

type CodexSessionCatalogEntry = {
  id: string;
  startedAt: number;
  endedAt?: number;
  cwd: string;
  harness?: string;
  transport?: string;
  model?: string | null;
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandboxMode;
};

type CodexSessionCatalog = {
  activeSessionId: string | null;
  sessions: CodexSessionCatalogEntry[];
};

const SESSION_CATALOG_FILENAME = "session-catalog.json";
const SESSION_CATALOG_MAX_ENTRIES = 64;
const CODEX_ROLLOUT_STALE_ACTIVE_TURN_MS = 10 * 60 * 1000;

type CodexRolloutSnapshotProjectionOptions = {
  nowMs?: number;
  staleActiveTurnMs?: number;
};

async function readCodexSessionCatalog(runtimeDirectory: string): Promise<CodexSessionCatalog> {
  const raw = await readOptionalFile(join(runtimeDirectory, SESSION_CATALOG_FILENAME));
  if (!raw) {
    return { activeSessionId: null, sessions: [] };
  }

  const parsed = parseCodexMaybeJson(raw) as Partial<CodexSessionCatalog> | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { activeSessionId: null, sessions: [] };
  }

  return {
    activeSessionId: typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : null,
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter((entry): entry is CodexSessionCatalogEntry => (
      Boolean(entry)
      && typeof entry === "object"
      && typeof (entry as CodexSessionCatalogEntry).id === "string"
      && typeof (entry as CodexSessionCatalogEntry).startedAt === "number"
      && typeof (entry as CodexSessionCatalogEntry).cwd === "string"
    )) : [],
  };
}

async function writeCodexSessionCatalog(runtimeDirectory: string, catalog: CodexSessionCatalog): Promise<void> {
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(join(runtimeDirectory, SESSION_CATALOG_FILENAME), JSON.stringify(catalog, null, 2) + "\n");
}

async function recordCodexSessionCatalog(
  runtimeDirectory: string,
  threadId: string,
  input: {
    cwd: string;
    harness: string;
    transport: string;
    model: string | null;
    approvalPolicy: CodexApprovalPolicy;
    sandbox: CodexSandboxMode;
  },
): Promise<void> {
  const catalog = await readCodexSessionCatalog(runtimeDirectory);
  const now = Date.now();
  const sessions = catalog.sessions.map((session) =>
    session.id === catalog.activeSessionId && session.id !== threadId && !session.endedAt
      ? { ...session, endedAt: now }
      : session
  );

  if (!sessions.some((session) => session.id === threadId)) {
    sessions.push({
      id: threadId,
      startedAt: now,
      cwd: input.cwd,
      harness: input.harness,
      transport: input.transport,
      model: input.model,
      approvalPolicy: input.approvalPolicy,
      sandbox: input.sandbox,
    });
  }

  while (sessions.length > SESSION_CATALOG_MAX_ENTRIES) {
    sessions.shift();
  }

  await writeCodexSessionCatalog(runtimeDirectory, {
    activeSessionId: threadId,
    sessions,
  });
}

async function closeCodexSessionCatalog(runtimeDirectory: string, threadId: string | null): Promise<void> {
  const catalog = await readCodexSessionCatalog(runtimeDirectory);
  const now = Date.now();
  const activeSessionId = threadId ?? catalog.activeSessionId;
  const sessions = catalog.sessions.map((session) =>
    session.id === activeSessionId && !session.endedAt
      ? { ...session, endedAt: now }
      : session
  );
  await writeCodexSessionCatalog(runtimeDirectory, {
    activeSessionId: null,
    sessions,
  });
}

function isMissingCodexRolloutError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("no rollout found for thread id");
}

class CodexAppServerSession {
  private readonly key: string;

  private readonly threadIdPath: string;

  private readonly statePath: string;

  private readonly replyContextPath: string;

  private readonly stdoutLogPath: string;

  private readonly stderrLogPath: string;

  private process: ChildProcessWithoutNullStreams | null = null;

  private lineBuffer = "";

  private nextRequestId = 1;

  private readonly pendingRequests = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  private serialized = Promise.resolve();

  private starting: Promise<void> | null = null;

  private activeTurn: ActiveTurn | null = null;

  private threadId: string | null = null;

  private threadPath: string | null = null;

  private proactiveShutdown: ProactiveCodexAppServerShutdown | null = null;

  private lastConfigSignature: string;

  constructor(private options: SessionRequestOptions) {
    this.key = sessionKey(options);
    this.threadIdPath = join(options.runtimeDirectory, "codex-thread-id.txt");
    this.statePath = join(options.runtimeDirectory, "state.json");
    this.replyContextPath = join(options.runtimeDirectory, "scout-reply-context.json");
    this.stdoutLogPath = join(options.logsDirectory, "stdout.log");
    this.stderrLogPath = join(options.logsDirectory, "stderr.log");
    this.lastConfigSignature = this.configSignature(options);
  }

  matches(options: SessionRequestOptions): boolean {
    return this.lastConfigSignature === this.configSignature(options);
  }

  update(options: SessionRequestOptions): void {
    this.options = options;
    this.lastConfigSignature = this.configSignature(options);
  }

  isAlive(): boolean {
    return Boolean(this.process && !this.process.killed && this.process.exitCode === null);
  }

  async ensureOnline(): Promise<{ threadId: string }> {
    await this.ensureStarted();
    if (!this.threadId) {
      throw new Error(`Codex app-server session for ${this.options.agentName} has no active thread.`);
    }

    return {
      threadId: this.threadId,
    };
  }

  async invoke(
    prompt: string,
    timeoutMs?: number,
    replyContext?: ScoutReplyContext | null,
  ): Promise<{ output: string; threadId: string }> {
    return this.enqueue(async () => {
      await this.ensureStarted();
      if (!this.threadId) {
        throw new Error(`Codex app-server session for ${this.options.agentName} has no active thread.`);
      }

      const outputPromise = new Promise<string>(async (resolve, reject) => {
        const turn = this.createActiveTurn(resolve, reject);

        try {
          await this.writeReplyContext(replyContext ?? null);
          const response = await this.request<TurnStartResult>("turn/start", {
            threadId: this.threadId,
            cwd: this.options.cwd,
            input: [
              {
                type: "text",
                text: prompt,
                text_elements: [],
              },
            ],
          });
          turn.turnId = response.turn.id;
          await this.persistState();
        } catch (error) {
          await this.clearReplyContext();
          this.clearActiveTurn(turn);
          reject(error instanceof Error ? error : new Error(errorMessage(error)));
        }
      });
      const output = await waitForRequesterResult(outputPromise, timeoutMs, this.options.agentName);

      return {
        output,
        threadId: this.threadId,
      };
    });
  }

  hasActiveTurn(): boolean {
    return Boolean(this.activeTurn);
  }

  async steerAndWait(prompt: string, timeoutMs?: number): Promise<{ output: string; threadId: string }> {
    await this.ensureStarted();
    if (!this.threadId) {
      throw new Error(`Codex app-server session for ${this.options.agentName} has no active thread.`);
    }

    const activeTurn = this.activeTurn;
    if (!activeTurn?.turnId) {
      return this.invoke(prompt, timeoutMs);
    }

    const output = await new Promise<string>(async (resolve, reject) => {
      const watcher = this.addTurnWatcher(activeTurn, resolve, reject, timeoutMs);
      try {
        await this.request("turn/steer", {
          threadId: this.threadId,
          expectedTurnId: activeTurn.turnId,
          input: [
            {
              type: "text",
              text: prompt,
              text_elements: [],
            },
          ],
        });
      } catch (error) {
        this.removeTurnWatcher(activeTurn, watcher);
        reject(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });

    return {
      output,
      threadId: this.threadId,
    };
  }

  async steer(prompt: string): Promise<void> {
    await this.ensureStarted();
    if (!this.threadId || !this.activeTurn?.turnId) {
      throw new Error(`Codex app-server session for ${this.options.agentName} has no active turn to steer.`);
    }

    await this.request("turn/steer", {
      threadId: this.threadId,
      expectedTurnId: this.activeTurn.turnId,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: [],
        },
      ],
    });
  }

  async interrupt(): Promise<void> {
    await this.ensureStarted();
    if (!this.threadId || !this.activeTurn?.turnId) {
      return;
    }

    await this.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.activeTurn.turnId,
    });
  }

  async shutdown(options: CodexAppServerShutdownOptions = {}): Promise<void> {
    this.proactiveShutdown = {
      reason: options.reason
        ?? (options.resetThread ? "OpenScout reset the app-server session" : "OpenScout stopped the app-server session"),
    };
    const stoppedError = new CodexAppServerExitError({
      agentName: this.options.agentName,
      exitKind: "proactive_shutdown",
      exitCode: null,
      signal: null,
      reason: this.proactiveShutdown.reason,
    });

    const activeTurn = this.activeTurn;
    this.activeTurn = null;
    if (activeTurn) {
      activeTurn.reject(stoppedError);
    }

    for (const pending of this.pendingRequests.values()) {
      pending.reject(stoppedError);
    }
    this.pendingRequests.clear();

    const child = this.process;
    this.process = null;
    this.starting = null;
    this.lineBuffer = "";

    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }

    if (options.resetThread) {
      await closeCodexSessionCatalog(this.options.runtimeDirectory, this.threadId);
      this.threadId = null;
      this.threadPath = null;
      await rm(this.threadIdPath, { force: true });
    }

    await this.persistState();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.serialized.then(task, task);
    this.serialized = next.then(() => undefined, () => undefined);
    return next;
  }

  private configSignature(options: SessionRequestOptions): string {
    return JSON.stringify({
      cwd: options.cwd,
      sessionId: options.sessionId,
      systemPrompt: options.systemPrompt,
      approvalPolicy: options.approvalPolicy ?? "never",
      sandbox: options.sandbox ?? "danger-full-access",
      threadId: options.threadId ?? null,
      requireExistingThread: options.requireExistingThread === true,
      launchArgs: normalizeCodexAppServerLaunchArgs(options.launchArgs),
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.isAlive() && this.threadId) {
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
    await mkdir(this.options.runtimeDirectory, { recursive: true });
    await mkdir(this.options.logsDirectory, { recursive: true });
    await writeFile(join(this.options.runtimeDirectory, "prompt.txt"), this.options.systemPrompt);
    this.proactiveShutdown = null;

    const codexExecutable = resolveCodexExecutable();
    const launchArgs = normalizeCodexAppServerLaunchArgs(this.options.launchArgs);
    const env = buildManagedAgentEnvironment({
      agentName: this.options.agentName,
      currentDirectory: this.options.cwd,
      baseEnv: process.env,
    });
    env.OPENSCOUT_REPLY_CONTEXT_FILE = this.replyContextPath;
    const child = spawn(codexExecutable, [
      "app-server",
      ...buildScoutMcpCodexLaunchArgs({
        currentDirectory: this.options.cwd,
        env,
      }),
      ...launchArgs,
    ], {
      cwd: this.options.cwd,
      env,
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
      this.failSession(new Error(`Codex app-server failed for ${this.options.agentName}: ${errorMessage(error)}`));
    });
    child.once("exit", (code, signal) => {
      const proactiveShutdown = this.proactiveShutdown;
      if (proactiveShutdown) {
        this.handleProactiveProcessExit(child, proactiveShutdown, code, signal);
        return;
      }

      this.failSession(new CodexAppServerExitError({
        agentName: this.options.agentName,
        exitCode: code,
        signal,
      }));
    });

    await this.request("initialize", {
      clientInfo: {
        name: "openscout-runtime",
        title: "OpenScout Runtime",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized");

    await this.resumeOrStartThread();
    await this.persistState();
  }

  private async resumeOrStartThread(): Promise<void> {
    const requestedThreadId = this.options.threadId?.trim() || null;
    const storedThreadId = requestedThreadId ?? await readOptionalFile(this.threadIdPath);
    if (storedThreadId) {
      try {
        const resumed = await this.request<ThreadResumeResult>("thread/resume", {
          threadId: storedThreadId,
          cwd: this.options.cwd,
          approvalPolicy: this.options.approvalPolicy ?? "never",
          sandbox: this.options.sandbox ?? "danger-full-access",
          baseInstructions: this.options.systemPrompt,
          persistExtendedHistory: true,
        });
        this.threadId = resumed.thread.id;
        this.threadPath = resumed.thread.path ?? null;
        await this.persistThreadId();
        await recordCodexSessionCatalog(this.options.runtimeDirectory, this.threadId, this.catalogRuntimeMeta());
        return;
      } catch (error) {
        await appendFile(
          this.stderrLogPath,
          `[openscout] failed to resume stored Codex thread ${storedThreadId}: ${errorMessage(error)}\n`,
        ).catch(() => undefined);
        if (!requestedThreadId && isMissingCodexRolloutError(error)) {
          await rm(this.threadIdPath, { force: true }).catch(() => undefined);
        }
        if (requestedThreadId || this.options.requireExistingThread) {
          throw new Error(`Failed to resume requested Codex thread ${storedThreadId}: ${errorMessage(error)}`);
        }
      }
    }

    if (this.options.requireExistingThread) {
      const detail = requestedThreadId
        ? ` for requested thread ${requestedThreadId}`
        : "";
      throw new Error(`Codex app-server session for ${this.options.agentName} requires an existing thread${detail}.`);
    }

    const started = await this.request<ThreadStartResult>("thread/start", {
      cwd: this.options.cwd,
      approvalPolicy: this.options.approvalPolicy ?? "never",
      sandbox: this.options.sandbox ?? "danger-full-access",
      baseInstructions: this.options.systemPrompt,
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });
    this.threadId = started.thread.id;
    this.threadPath = started.thread.path ?? null;
    await this.persistThreadId();
    await recordCodexSessionCatalog(this.options.runtimeDirectory, this.threadId, this.catalogRuntimeMeta());
  }

  private catalogRuntimeMeta(): {
    cwd: string;
    harness: string;
    transport: string;
    model: string | null;
    approvalPolicy: CodexApprovalPolicy;
    sandbox: CodexSandboxMode;
  } {
    return {
      cwd: this.options.cwd,
      harness: "codex",
      transport: "codex_app_server",
      model: readCodexAppServerModelFromLaunchArgs(this.options.launchArgs),
      approvalPolicy: this.options.approvalPolicy ?? "never",
      sandbox: this.options.sandbox ?? "danger-full-access",
    };
  }

  private createActiveTurn(
    resolve: (output: string) => void,
    reject: (error: Error) => void,
  ): ActiveTurn {
    if (this.activeTurn) {
      throw new Error(`Codex app-server session for ${this.options.agentName} already has an active turn.`);
    }

    const turn: ActiveTurn = {
      turnId: "",
      startedAt: Date.now(),
      messageOrder: [],
      messageByItemId: new Map<string, string>(),
      resolve,
      reject,
      watchers: [],
    };

    this.activeTurn = turn;
    return turn;
  }

  private addTurnWatcher(
    turn: ActiveTurn,
    resolve: (output: string) => void,
    reject: (error: Error) => void,
    timeoutMs: number | undefined,
  ): ActiveTurn["watchers"][number] {
    const watcher: ActiveTurn["watchers"][number] = {
      resolve,
      reject,
      timer: null,
    };
    const effectiveTimeoutMs = resolveRequesterTimeoutMs(timeoutMs);
    if (effectiveTimeoutMs !== null) {
      watcher.timer = setTimeout(() => {
        this.removeTurnWatcher(turn, watcher);
        reject(new RequesterWaitTimeoutError({
          label: this.options.agentName,
          timeoutMs: effectiveTimeoutMs,
        }));
      }, effectiveTimeoutMs);
    }
    turn.watchers.push(watcher);
    return watcher;
  }

  private removeTurnWatcher(turn: ActiveTurn, watcher: ActiveTurn["watchers"][number]): void {
    if (watcher.timer) {
      clearTimeout(watcher.timer);
    }
    turn.watchers = turn.watchers.filter((candidate) => candidate !== watcher);
  }

  private drainTurnWatchers(turn: ActiveTurn): ActiveTurn["watchers"] {
    const watchers = turn.watchers;
    turn.watchers = [];
    for (const watcher of watchers) {
      if (watcher.timer) {
        clearTimeout(watcher.timer);
      }
    }
    return watchers;
  }

  private clearActiveTurn(turn: ActiveTurn): void {
    if (this.activeTurn === turn) {
      this.activeTurn = null;
    }
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

  private async writeReplyContext(context: ScoutReplyContext | null): Promise<void> {
    if (!context) {
      await this.clearReplyContext();
      return;
    }

    await mkdir(this.options.runtimeDirectory, { recursive: true });
    await writeFile(this.replyContextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
  }

  private async clearReplyContext(): Promise<void> {
    await rm(this.replyContextPath, { force: true }).catch(() => undefined);
  }

  private handleNotification(message: CodexNotification): void {
    const method = message.method;
    const params = message.params ?? {};

    if (method === "thread/started" || method === "thread/name/updated") {
      const thread = params.thread as { id?: string; path?: string | null } | undefined;
      if (thread?.id) {
        this.threadId = thread.id;
      }
      if ("path" in (thread ?? {})) {
        this.threadPath = thread?.path ?? null;
      }
      void this.persistThreadId();
      return;
    }

    if (method === "turn/started") {
      const turn = params.turn as { id?: string } | undefined;
      if (this.activeTurn && turn?.id && !this.activeTurn.turnId) {
        this.activeTurn.turnId = turn.id;
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      const turnId = typeof params.turnId === "string" ? params.turnId : null;
      const itemId = typeof params.itemId === "string" ? params.itemId : null;
      const delta = typeof params.delta === "string" ? params.delta : "";
      if (!this.activeTurn || !turnId || !itemId) {
        return;
      }
      if (this.activeTurn.turnId && this.activeTurn.turnId !== turnId) {
        return;
      }
      if (!this.activeTurn.messageByItemId.has(itemId)) {
        this.activeTurn.messageOrder.push(itemId);
        this.activeTurn.messageByItemId.set(itemId, "");
      }
      this.activeTurn.messageByItemId.set(itemId, (this.activeTurn.messageByItemId.get(itemId) ?? "") + delta);
      return;
    }

    if (method === "item/completed") {
      const turnId = typeof params.turnId === "string" ? params.turnId : null;
      const item = params.item as { type?: string; id?: string; text?: string } | undefined;
      if (!this.activeTurn || !turnId || item?.type !== "agentMessage" || !item.id) {
        return;
      }
      if (this.activeTurn.turnId && this.activeTurn.turnId !== turnId) {
        return;
      }
      if (!this.activeTurn.messageByItemId.has(item.id)) {
        this.activeTurn.messageOrder.push(item.id);
      }
      this.activeTurn.messageByItemId.set(item.id, item.text ?? this.activeTurn.messageByItemId.get(item.id) ?? "");
      return;
    }

    if (method === "turn/completed") {
      void this.clearReplyContext();
      this.completeTurn(params as unknown as TurnCompletedParams);
      return;
    }

    if (method === "error") {
      const willRetry = params.willRetry === true;
      if (willRetry) {
        return;
      }
      const errorPayload = metadataRecord(params, "error");
      const message = metadataString(errorPayload, "message")
        ?? metadataString(params, "message")
        ?? "Codex app-server reported an error.";
      const codexErrorInfo = metadataString(errorPayload, "codexErrorInfo")
        ?? metadataString(params, "codexErrorInfo");
      const additionalDetails = metadataString(errorPayload, "additionalDetails")
        ?? metadataString(params, "additionalDetails");
      const detail = [codexErrorInfo, additionalDetails]
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
        .join("; ");
      const error = detail.length > 0 ? `${message} (${detail})` : message;
      if (this.activeTurn) {
        const activeTurn = this.activeTurn;
        this.clearActiveTurn(activeTurn);
        activeTurn.reject(new Error(error));
      }
    }
  }

  private completeTurn(params: TurnCompletedParams): void {
    const activeTurn = this.activeTurn;
    if (!activeTurn) {
      return;
    }

    if (activeTurn.turnId && activeTurn.turnId !== params.turn.id) {
      return;
    }

    this.clearActiveTurn(activeTurn);

    if (params.turn.status === "failed") {
      const message = params.turn.error?.message || params.turn.error?.additionalDetails || `Turn failed for ${this.options.agentName}.`;
      for (const watcher of this.drainTurnWatchers(activeTurn)) {
        watcher.reject(new Error(message));
      }
      activeTurn.reject(new Error(message));
      return;
    }

    if (params.turn.status === "interrupted") {
      for (const watcher of this.drainTurnWatchers(activeTurn)) {
        watcher.reject(new Error(`Turn interrupted for ${this.options.agentName}.`));
      }
      activeTurn.reject(new Error(`Turn interrupted for ${this.options.agentName}.`));
      return;
    }

    const output = activeTurn.messageOrder
      .map((itemId) => activeTurn.messageByItemId.get(itemId) ?? "")
      .join("\n\n")
      .trim();

    if (!output) {
      for (const watcher of this.drainTurnWatchers(activeTurn)) {
        watcher.reject(new Error(`Codex completed without producing a final response for ${this.options.agentName}.`));
      }
      activeTurn.reject(new Error(`Codex completed without producing a final response for ${this.options.agentName}.`));
      return;
    }

    for (const watcher of this.drainTurnWatchers(activeTurn)) {
      watcher.resolve(output);
    }
    activeTurn.resolve(output);
  }

  private failSession(error: Error): void {
    if (this.process) {
      this.process.removeAllListeners();
      this.process.stdout.removeAllListeners();
      this.process.stderr.removeAllListeners();
    }
    this.process = null;
    this.starting = null;

    const activeTurn = this.activeTurn;
    this.activeTurn = null;
    const pendingRequests = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();

    const rejectSessionWaiters = () => {
      if (activeTurn) {
        for (const watcher of this.drainTurnWatchers(activeTurn)) {
          watcher.reject(error);
        }
        activeTurn.reject(error);
      }

      for (const pending of pendingRequests) {
        pending.reject(error);
      }
    };

    void appendFile(this.stderrLogPath, `[openscout] ${error.message}\n`)
      .catch(() => undefined)
      .finally(rejectSessionWaiters);
    void this.persistState();
  }

  private handleProactiveProcessExit(
    child: ChildProcessWithoutNullStreams,
    shutdown: ProactiveCodexAppServerShutdown,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.process === child) {
      this.process = null;
    }
    this.proactiveShutdown = null;
    this.starting = null;

    const exitDetail = [
      code !== null ? `code ${code}` : null,
      signal,
    ].filter(Boolean).join(", ");
    const detail = exitDetail ? ` (${exitDetail})` : "";
    void appendFile(
      this.stderrLogPath,
      `[openscout] Codex app-server stopped for ${this.options.agentName}: ${shutdown.reason}${detail}\n`,
    ).catch(() => undefined);
    void this.persistState();
  }

  private async persistThreadId(): Promise<void> {
    if (!this.threadId) {
      await rm(this.threadIdPath, { force: true });
      return;
    }

    await writeFile(this.threadIdPath, `${this.threadId}\n`);
    await this.persistState();
  }

  private async persistState(): Promise<void> {
    await writeFile(
      this.statePath,
      JSON.stringify({
        agentId: this.options.agentName,
        transport: "codex_app_server",
        sessionId: this.options.sessionId,
        projectRoot: this.options.cwd,
        cwd: this.options.cwd,
        threadId: this.threadId,
        threadPath: this.threadPath,
        requestedThreadId: this.options.threadId ?? null,
        requireExistingThread: this.options.requireExistingThread === true,
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
        this.writeMessage({
          id,
          method,
          params,
        });
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
      throw new Error(`Codex app-server session for ${this.options.agentName} is not running.`);
    }

    child.stdin.write(`${JSON.stringify(message)}\n`);
  }
}

const sessions = new Map<string, CodexAppServerSession>();

function getOrCreateSession(options: SessionRequestOptions): CodexAppServerSession {
  const key = sessionKey(options);
  const existing = sessions.get(key);
  if (existing) {
    if (existing.matches(options)) {
      return existing;
    }

    void existing.shutdown({
      resetThread: true,
      reason: "OpenScout replaced the app-server session after its launch options changed",
    });
    sessions.delete(key);
  }

  const session = new CodexAppServerSession(options);
  sessions.set(key, session);
  return session;
}

export async function ensureCodexAppServerAgentOnline(options: SessionRequestOptions): Promise<{ threadId: string }> {
  const session = getOrCreateSession(options);
  session.update(options);
  return session.ensureOnline();
}

export async function invokeCodexAppServerAgent(options: InvocationOptions): Promise<{ output: string; threadId: string }> {
  const session = getOrCreateSession(options);
  session.update(options);
  return session.invoke(options.prompt, options.timeoutMs, options.replyContext);
}

export async function sendCodexAppServerAgent(options: InvocationOptions): Promise<{ output: string; threadId: string }> {
  const session = getOrCreateSession(options);
  session.update(options);
  if (session.hasActiveTurn()) {
    return session.steerAndWait(options.prompt, options.timeoutMs);
  }
  return session.invoke(options.prompt, options.timeoutMs, options.replyContext);
}

export async function steerCodexAppServerAgent(options: SteerOptions): Promise<void> {
  const session = getOrCreateSession(options);
  session.update(options);
  await session.steer(options.prompt);
}

export async function interruptCodexAppServerAgent(options: InterruptOptions): Promise<void> {
  const key = sessionKey(options);
  const session = sessions.get(key);
  if (!session) {
    return;
  }

  session.update(options);
  await session.interrupt();
}

export function isCodexAppServerAgentAlive(options: SessionRequestOptions): boolean {
  const session = sessions.get(sessionKey(options));
  return Boolean(session?.isAlive());
}

export async function getCodexAppServerAgentSnapshot(
  options: SessionRequestOptions,
): Promise<SessionState | null> {
  const stdoutLogPath = join(options.logsDirectory, "stdout.log");
  const threadIdPath = join(options.runtimeDirectory, "codex-thread-id.txt");
  const statePath = join(options.runtimeDirectory, "state.json");
  const [rawLog, persistedThreadId, persistedState] = await Promise.all([
    readOptionalFile(stdoutLogPath),
    readOptionalFile(threadIdPath),
    readOptionalJsonRecord(statePath),
  ]);
  const resolvedThreadId = options.threadId
    ?? persistedThreadId
    ?? metadataString(persistedState ?? undefined, "threadId")
    ?? undefined;
  const persistedThreadPath = metadataString(persistedState ?? undefined, "threadPath");

  if (persistedThreadPath) {
    const rawRollout = await readOptionalFile(persistedThreadPath);
    if (rawRollout) {
      const rolloutSnapshot = buildCodexRolloutSessionSnapshot(
        rawRollout,
        options,
        resolvedThreadId,
        persistedThreadPath,
      );
      if (rolloutSnapshot) {
        return rolloutSnapshot;
      }
    }
  }

  if (!rawLog) {
    return null;
  }

  return buildCodexAppServerSessionSnapshot(rawLog, options, resolvedThreadId);
}

export async function shutdownCodexAppServerAgent(
  options: SessionRequestOptions,
  shutdownOptions: CodexAppServerShutdownOptions = {},
): Promise<void> {
  const key = sessionKey(options);
  const session = sessions.get(key);
  if (!session) {
    if (shutdownOptions.resetThread) {
      const runtimeDirectory = options.runtimeDirectory;
      const threadId = await readOptionalFile(join(runtimeDirectory, "codex-thread-id.txt"));
      await closeCodexSessionCatalog(runtimeDirectory, threadId);
      await rm(join(runtimeDirectory, "codex-thread-id.txt"), { force: true });
    }
    return;
  }

  sessions.delete(key);
  await session.shutdown(shutdownOptions);
}
