import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, appendFile, constants, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

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

type SessionRequestOptions = {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs?: string[];
};

type InvocationOptions = SessionRequestOptions & {
  prompt: string;
  timeoutMs?: number;
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
  timer: NodeJS.Timeout | null;
  messageOrder: string[];
  messageByItemId: Map<string, string>;
  resolve: (output: string) => void;
  reject: (error: Error) => void;
};

function sessionKey(options: SessionRequestOptions): string {
  return `${options.agentName}:${options.sessionId}`;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

function parseJsonLine(line: string): CodexResponse | CodexNotification | CodexServerRequest | null {
  try {
    return JSON.parse(line) as CodexResponse | CodexNotification | CodexServerRequest;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

class CodexAppServerSession {
  private readonly key: string;

  private readonly threadIdPath: string;

  private readonly statePath: string;

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

  private lastConfigSignature: string;

  constructor(private options: SessionRequestOptions) {
    this.key = sessionKey(options);
    this.threadIdPath = join(options.runtimeDirectory, "codex-thread-id.txt");
    this.statePath = join(options.runtimeDirectory, "state.json");
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

  async invoke(prompt: string, timeoutMs = 5 * 60_000): Promise<{ output: string; threadId: string }> {
    return this.enqueue(async () => {
      await this.ensureStarted();
      if (!this.threadId) {
        throw new Error(`Codex app-server session for ${this.options.agentName} has no active thread.`);
      }

      const output = await new Promise<string>(async (resolve, reject) => {
        const turn = this.createActiveTurn(resolve, reject, timeoutMs);

        try {
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
          this.clearActiveTurn(turn);
          reject(error instanceof Error ? error : new Error(errorMessage(error)));
        }
      });

      return {
        output,
        threadId: this.threadId,
      };
    });
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

  async shutdown(options: { resetThread?: boolean } = {}): Promise<void> {
    const activeTurn = this.activeTurn;
    this.activeTurn = null;
    if (activeTurn) {
      if (activeTurn.timer) {
        clearTimeout(activeTurn.timer);
      }
      activeTurn.reject(new Error(`Codex app-server session for ${this.options.agentName} was shut down.`));
    }

    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error(`Codex app-server session for ${this.options.agentName} was shut down.`));
    }
    this.pendingRequests.clear();

    const child = this.process;
    this.process = null;
    this.starting = null;
    this.lineBuffer = "";

    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
    }

    if (options.resetThread) {
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
      launchArgs: Array.isArray(options.launchArgs) ? options.launchArgs : [],
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

    const codexExecutable = await resolveCodexExecutable();
    const child = spawn(codexExecutable, ["app-server"], {
      cwd: this.options.cwd,
      env: process.env,
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
      this.failSession(
        new Error(
          `Codex app-server exited for ${this.options.agentName}`
          + (code !== null ? ` with code ${code}` : "")
          + (signal ? ` (${signal})` : ""),
        ),
      );
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
    const storedThreadId = await readOptionalFile(this.threadIdPath);
    if (storedThreadId) {
      try {
        const resumed = await this.request<ThreadResumeResult>("thread/resume", {
          threadId: storedThreadId,
          cwd: this.options.cwd,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          baseInstructions: this.options.systemPrompt,
          persistExtendedHistory: true,
        });
        this.threadId = resumed.thread.id;
        this.threadPath = resumed.thread.path ?? null;
        await this.persistThreadId();
        return;
      } catch (error) {
        await appendFile(
          this.stderrLogPath,
          `[openscout] failed to resume stored Codex thread ${storedThreadId}: ${errorMessage(error)}\n`,
        ).catch(() => undefined);
      }
    }

    const started = await this.request<ThreadStartResult>("thread/start", {
      cwd: this.options.cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      baseInstructions: this.options.systemPrompt,
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });
    this.threadId = started.thread.id;
    this.threadPath = started.thread.path ?? null;
    await this.persistThreadId();
  }

  private createActiveTurn(
    resolve: (output: string) => void,
    reject: (error: Error) => void,
    timeoutMs: number,
  ): ActiveTurn {
    if (this.activeTurn) {
      throw new Error(`Codex app-server session for ${this.options.agentName} already has an active turn.`);
    }

    const turn: ActiveTurn = {
      turnId: "",
      startedAt: Date.now(),
      timer: null,
      messageOrder: [],
      messageByItemId: new Map<string, string>(),
      resolve,
      reject,
    };
    turn.timer = setTimeout(() => {
      void this.interrupt().catch(() => undefined);
      if (this.activeTurn === turn) {
        this.activeTurn = null;
      }
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${this.options.agentName}.`));
    }, timeoutMs);

    this.activeTurn = turn;
    return turn;
  }

  private clearActiveTurn(turn: ActiveTurn): void {
    if (turn.timer) {
      clearTimeout(turn.timer);
    }
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
      error: {
        message: `Unsupported server request: ${message.method}`,
      },
    });
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
      this.completeTurn(params as unknown as TurnCompletedParams);
      return;
    }

    if (method === "error") {
      const error = metadataString(params, "message") ?? "Codex app-server reported an error.";
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
      activeTurn.reject(new Error(message));
      return;
    }

    if (params.turn.status === "interrupted") {
      activeTurn.reject(new Error(`Turn interrupted for ${this.options.agentName}.`));
      return;
    }

    const output = activeTurn.messageOrder
      .map((itemId) => activeTurn.messageByItemId.get(itemId) ?? "")
      .join("\n\n")
      .trim();

    if (!output) {
      activeTurn.reject(new Error(`Codex completed without producing a final response for ${this.options.agentName}.`));
      return;
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
    if (activeTurn) {
      if (activeTurn.timer) {
        clearTimeout(activeTurn.timer);
      }
      activeTurn.reject(error);
    }

    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();

    void appendFile(this.stderrLogPath, `[openscout] ${error.message}\n`).catch(() => undefined);
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

    void existing.shutdown({ resetThread: true });
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
  return session.invoke(options.prompt, options.timeoutMs);
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

export async function shutdownCodexAppServerAgent(
  options: SessionRequestOptions,
  shutdownOptions: { resetThread?: boolean } = {},
): Promise<void> {
  const key = sessionKey(options);
  const session = sessions.get(key);
  if (!session) {
    if (shutdownOptions.resetThread) {
      const runtimeDirectory = options.runtimeDirectory;
      await rm(join(runtimeDirectory, "codex-thread-id.txt"), { force: true });
    }
    return;
  }

  sessions.delete(key);
  await session.shutdown(shutdownOptions);
}
