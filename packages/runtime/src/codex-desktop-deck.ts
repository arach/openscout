import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Socket } from "node:net";
import { promisify } from "node:util";

import type { SessionState } from "@openscout/agent-sessions";

import { buildCodexRolloutSessionSnapshot } from "./codex-app-server.js";

const execFileAsync = promisify(execFile);

const MAX_FRAME_BYTES = 256 * 1024 * 1024;
const FOLLOW_VERSION = 1;
const STREAM_VERSION = 11;
const START_TURN_VERSION = 1;
const STEER_TURN_VERSION = 1;
const INTERRUPT_TURN_VERSION = 3;
const SNAPSHOT_TIMEOUT_MS = 2_500;
const OWNER_SETTLE_MS = 80;
const REQUEST_TIMEOUT_MS = 30_000;
const BINDING_FILE = "codex-desktop-deck.json";

type DesktopResponse = {
  type: "response";
  requestId: string;
  resultType: "success" | "error";
  result?: Record<string, unknown>;
  error?: string;
};

type DesktopBroadcast = {
  type: "broadcast";
  method: string;
  sourceClientId: string;
  version: number;
  params?: Record<string, unknown>;
};

type DesktopMessage = DesktopResponse | DesktopBroadcast;

type DesktopConversationState = Record<string, unknown> & {
  id?: string;
  title?: string;
  cwd?: string;
  rolloutPath?: string;
};

type DesktopTaskCandidate = {
  id: string;
  cwd: string;
};

type PersistedDesktopBinding = {
  threadId: string;
  cwd: string;
  title: string;
  rolloutPath: string;
};

export type CodexDesktopDeckTask = PersistedDesktopBinding;

export type CodexDesktopDeckOptions = {
  agentId: string;
  agentName: string;
  cwd: string;
  runtimeDirectory: string;
};

type PendingRequest = {
  resolve: (response: DesktopResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

function desktopSocketPath(): string {
  return join(codexHome(), "ipc", "ipc.sock");
}

function bindingPath(options: CodexDesktopDeckOptions): string {
  return join(options.runtimeDirectory, BINDING_FILE);
}

function normalizePath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function assertPrivateDesktopSocket(socketPath: string): void {
  let socket;
  let directory;
  try {
    socket = lstatSync(socketPath);
    directory = lstatSync(dirname(socketPath));
  } catch {
    throw new Error("Codex Desktop is not available. Open Codex Desktop and the task you want this lane to control.");
  }

  if (!socket.isSocket() || socket.uid !== process.getuid?.()) {
    throw new Error("Codex Desktop IPC socket is not a private socket owned by this user.");
  }
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o022) !== 0) {
    throw new Error("Codex Desktop IPC directory is not private.");
  }
}

function assertPrivateRolloutPath(rolloutPath: string, threadId: string): string {
  const sessionsRoot = resolve(codexHome(), "sessions");
  const resolved = resolve(rolloutPath);
  if (!resolved.startsWith(`${sessionsRoot}/`) || !resolved.split("/").at(-1)?.includes(threadId)) {
    throw new Error("Codex Desktop returned an unsafe task transcript path.");
  }

  const info = lstatSync(resolved);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.()) {
    throw new Error("Codex Desktop task transcript is not a private user-owned file.");
  }
  return resolved;
}

function frame(message: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length === 0 || body.length > MAX_FRAME_BYTES) {
    throw new Error("Codex Desktop IPC message is too large.");
  }
  const output = Buffer.allocUnsafe(body.length + 4);
  output.writeUInt32LE(body.length, 0);
  body.copy(output, 4);
  return output;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readPersistedBinding(options: CodexDesktopDeckOptions): Promise<PersistedDesktopBinding | null> {
  try {
    const parsed = JSON.parse(await readFile(bindingPath(options), "utf8")) as Partial<PersistedDesktopBinding>;
    if (
      typeof parsed.threadId === "string"
      && typeof parsed.cwd === "string"
      && typeof parsed.title === "string"
      && typeof parsed.rolloutPath === "string"
      && samePath(parsed.cwd, options.cwd)
    ) {
      return parsed as PersistedDesktopBinding;
    }
  } catch {
    // A missing or stale binding simply means task discovery must run again.
  }
  return null;
}

async function writePersistedBinding(options: CodexDesktopDeckOptions, binding: PersistedDesktopBinding): Promise<void> {
  await mkdir(options.runtimeDirectory, { recursive: true });
  await writeFile(bindingPath(options), `${JSON.stringify(binding, null, 2)}\n`, "utf8");
}

function sqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function listDesktopTaskCandidates(cwd: string, preferredThreadId?: string | null): Promise<DesktopTaskCandidate[]> {
  const database = join(codexHome(), "state_5.sqlite");
  if (!existsSync(database)) {
    throw new Error("The Codex task store is unavailable in the operator Codex home.");
  }

  const query = `
    SELECT id, cwd
    FROM threads
    WHERE archived = 0 AND cwd = ${sqliteString(cwd)}
    ORDER BY recency_at_ms DESC, updated_at_ms DESC
    LIMIT 48;
  `;
  const executable = process.env.OPENSCOUT_SQLITE3_BIN?.trim() || "/usr/bin/sqlite3";
  const { stdout } = await execFileAsync(executable, ["-readonly", "-json", database, query], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout || "[]") as Array<Partial<DesktopTaskCandidate>>;
  const candidates = parsed.filter((candidate): candidate is DesktopTaskCandidate => (
    typeof candidate.id === "string"
    && candidate.id.length > 0
    && typeof candidate.cwd === "string"
    && samePath(candidate.cwd, cwd)
  ));

  if (!preferredThreadId) return candidates;
  const preferred = candidates.find((candidate) => candidate.id === preferredThreadId);
  return preferred
    ? [preferred, ...candidates.filter((candidate) => candidate.id !== preferredThreadId)]
    : candidates;
}

class CodexDesktopIPCClient {
  private readonly socketPath: string;
  private readonly socket = new Socket();
  private clientId = "initializing-client";
  private buffer = Buffer.alloc(0);
  private connected = false;
  private pending = new Map<string, PendingRequest>();
  private followedThreadIds = new Set<string>();
  private selectedThreadId: string | null = null;
  private selectedOwnerClientId: string | null = null;
  private selectedState: DesktopConversationState | null = null;
  private snapshotObserver: ((message: DesktopBroadcast) => void) | null = null;

  constructor(socketPath = desktopSocketPath()) {
    this.socketPath = socketPath;
  }

  get isConnected(): boolean {
    return this.connected && this.socket.writable;
  }

  get state(): DesktopConversationState | null {
    return this.selectedState;
  }

  async connect(): Promise<void> {
    assertPrivateDesktopSocket(this.socketPath);
    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("error", (error) => this.rejectAll(error));
    this.socket.on("close", () => {
      this.connected = false;
      this.rejectAll(new Error("Codex Desktop IPC connection closed."));
    });

    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.socket.once("connect", () => resolvePromise());
      this.socket.once("error", rejectPromise);
      this.socket.connect(this.socketPath);
    });
    this.connected = true;

    const initialized = await this.request("initialize", { clientType: "openscout-deck" }, {
      allowUninitialized: true,
      version: 0,
      timeoutMs: 5_000,
    });
    const clientId = stringValue(recordValue(initialized.result)?.clientId);
    if (initialized.resultType !== "success" || !clientId) {
      throw new Error("Codex Desktop rejected the Scout Deck follower connection.");
    }
    this.clientId = clientId;
  }

  async followCandidates(candidates: readonly DesktopTaskCandidate[]): Promise<CodexDesktopDeckTask> {
    if (candidates.length === 0) {
      throw new Error("No Codex task exists for this lane's workspace. Open one in Codex Desktop, then reconnect.");
    }

    const candidateIndex = new Map(candidates.map((candidate, index) => [candidate.id, index]));
    const observed = new Map<string, { ownerClientId: string; state: DesktopConversationState }>();

    const selected = await new Promise<{ threadId: string; ownerClientId: string; state: DesktopConversationState }>((resolvePromise, rejectPromise) => {
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      const timeout = setTimeout(() => {
        this.snapshotObserver = null;
        rejectPromise(new Error(
          `No matching Codex Desktop task is open for ${candidates[0]?.cwd}. Open the task in Codex Desktop, then reconnect this lane.`,
        ));
      }, SNAPSHOT_TIMEOUT_MS);

      const finish = () => {
        const winner = [...observed.entries()]
          .sort(([left], [right]) => (candidateIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (candidateIndex.get(right) ?? Number.MAX_SAFE_INTEGER))[0];
        if (!winner) return;
        clearTimeout(timeout);
        this.snapshotObserver = null;
        const [threadId, value] = winner;
        resolvePromise({ threadId, ...value });
      };

      this.snapshotObserver = (message) => {
        const params = message.params;
        const threadId = stringValue(params?.conversationId);
        const change = recordValue(params?.change);
        const state = recordValue(change?.conversationState) as DesktopConversationState | null;
        if (
          message.version !== STREAM_VERSION
          || params?.hostId !== "local"
          || !threadId
          || !candidateIndex.has(threadId)
          || change?.type !== "snapshot"
          || !state
        ) return;

        observed.set(threadId, { ownerClientId: message.sourceClientId, state });
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, OWNER_SETTLE_MS);
      };

      for (const candidate of candidates) {
        this.followedThreadIds.add(candidate.id);
        this.broadcast("thread-stream-following-changed", {
          conversationId: candidate.id,
          hostId: "local",
          following: true,
        }, FOLLOW_VERSION);
      }
    });

    this.selectedThreadId = selected.threadId;
    this.selectedOwnerClientId = selected.ownerClientId;
    this.selectedState = selected.state;
    for (const threadId of this.followedThreadIds) {
      if (threadId !== selected.threadId) {
        this.broadcast("thread-stream-following-changed", {
          conversationId: threadId,
          hostId: "local",
          following: false,
        }, FOLLOW_VERSION);
      }
    }
    this.followedThreadIds = new Set([selected.threadId]);

    const stateThreadId = stringValue(selected.state.id);
    const rolloutPath = stringValue(selected.state.rolloutPath);
    const cwd = stringValue(selected.state.cwd);
    if (stateThreadId !== selected.threadId || !rolloutPath || !cwd) {
      throw new Error("Codex Desktop returned an incomplete or mismatched task snapshot.");
    }

    return {
      threadId: selected.threadId,
      cwd,
      title: stringValue(selected.state.title) ?? "Untitled Codex task",
      rolloutPath: assertPrivateRolloutPath(rolloutPath, selected.threadId),
    };
  }

  async startTurn(text: string): Promise<string> {
    const { threadId, ownerClientId } = this.requireSelection();
    const response = await this.request("thread-follower-start-turn", {
      conversationId: threadId,
      turnStartParams: {
        input: [{ type: "text", text, text_elements: [] }],
        attachments: [],
      },
    }, {
      targetClientId: ownerClientId,
      version: START_TURN_VERSION,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const result = recordValue(response.result);
    const nestedResult = recordValue(result?.result);
    const turn = recordValue(nestedResult?.turn);
    const turnId = stringValue(turn?.id);
    if (response.resultType !== "success" || !turnId) {
      throw new Error(`Codex Desktop could not start the turn${response.error ? `: ${response.error}` : "."}`);
    }
    return turnId;
  }

  async steerTurn(text: string): Promise<void> {
    const { threadId, ownerClientId } = this.requireSelection();
    const state = this.selectedState ?? {};
    const clientUserMessageId = randomUUID();
    const cwd = stringValue(state.cwd) ?? "/";
    const response = await this.request("thread-follower-steer-turn", {
      conversationId: threadId,
      input: [{ type: "text", text, text_elements: [] }],
      restoreMessage: {
        id: clientUserMessageId,
        text,
        context: {
          prompt: text,
          workspaceRoots: cwd === "/" ? [] : [cwd],
          collaborationMode: state.latestCollaborationMode ?? null,
          commentAttachments: [],
          imageAttachments: [],
          fileAttachments: [],
          pastedTextAttachments: [],
          addedFiles: [],
          appshotContexts: [],
          mcpAppModelContextAttachments: [],
        },
        cwd,
        createdAt: Date.now(),
      },
      serviceTier: null,
      attachments: [],
      clientUserMessageId,
    }, {
      targetClientId: ownerClientId,
      version: STEER_TURN_VERSION,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (response.resultType !== "success") {
      throw new Error(`Codex Desktop could not steer the active turn${response.error ? `: ${response.error}` : "."}`);
    }
  }

  async interruptTurn(): Promise<void> {
    const { threadId, ownerClientId } = this.requireSelection();
    const response = await this.request("thread-follower-interrupt-turn", {
      conversationId: threadId,
      mode: "user-stop",
    }, {
      targetClientId: ownerClientId,
      version: INTERRUPT_TURN_VERSION,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (response.resultType !== "success") {
      throw new Error(`Codex Desktop could not interrupt the active turn${response.error ? `: ${response.error}` : "."}`);
    }
  }

  close(): void {
    if (this.clientId !== "initializing-client" && this.socket.writable) {
      for (const threadId of this.followedThreadIds) {
        this.broadcast("thread-stream-following-changed", {
          conversationId: threadId,
          hostId: "local",
          following: false,
        }, FOLLOW_VERSION);
      }
    }
    this.connected = false;
    this.socket.end();
  }

  private requireSelection(): { threadId: string; ownerClientId: string } {
    if (!this.isConnected || !this.selectedThreadId || !this.selectedOwnerClientId) {
      throw new Error("This lane is not connected to an open Codex Desktop task.");
    }
    return { threadId: this.selectedThreadId, ownerClientId: this.selectedOwnerClientId };
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    options: {
      allowUninitialized?: boolean;
      targetClientId?: string;
      timeoutMs: number;
      version: number;
    },
  ): Promise<DesktopResponse> {
    if (!options.allowUninitialized && this.clientId === "initializing-client") {
      return Promise.reject(new Error("Codex Desktop IPC is not initialized."));
    }
    const requestId = randomUUID();
    return new Promise<DesktopResponse>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        rejectPromise(new Error(`Timed out waiting for Codex Desktop ${method}.`));
      }, options.timeoutMs);
      this.pending.set(requestId, { resolve: resolvePromise, reject: rejectPromise, timer });
      this.send({
        type: "request",
        requestId,
        sourceClientId: this.clientId,
        ...(options.targetClientId ? { targetClientId: options.targetClientId } : {}),
        version: options.version,
        method,
        params,
        timeoutMs: options.timeoutMs,
      });
    });
  }

  private broadcast(method: string, params: Record<string, unknown>, version: number): void {
    this.send({ type: "broadcast", method, sourceClientId: this.clientId, params, version });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.socket.writable) throw new Error("Codex Desktop IPC is not connected.");
    this.socket.write(frame(message));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        this.rejectAll(new Error(`Invalid Codex Desktop IPC frame length: ${length}.`));
        this.socket.destroy();
        return;
      }
      if (this.buffer.length < length + 4) return;
      let message: DesktopMessage;
      try {
        message = JSON.parse(this.buffer.subarray(4, length + 4).toString("utf8")) as DesktopMessage;
      } catch {
        this.rejectAll(new Error("Codex Desktop sent an unreadable IPC message."));
        this.socket.destroy();
        return;
      }
      this.buffer = this.buffer.subarray(length + 4);
      this.onMessage(message);
    }
  }

  private onMessage(message: DesktopMessage): void {
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      pending.resolve(message);
      return;
    }
    if (message.method !== "thread-stream-state-changed") return;
    this.snapshotObserver?.(message);

    const params = message.params;
    const change = recordValue(params?.change);
    const state = recordValue(change?.conversationState) as DesktopConversationState | null;
    if (
      message.version === STREAM_VERSION
      && params?.hostId === "local"
      && params?.conversationId === this.selectedThreadId
      && change?.type === "snapshot"
      && state
    ) {
      this.selectedOwnerClientId = message.sourceClientId;
      this.selectedState = state;
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

type ActiveDeckConnection = {
  client: CodexDesktopIPCClient;
  options: CodexDesktopDeckOptions;
  task: CodexDesktopDeckTask;
};

const connections = new Map<string, ActiveDeckConnection>();
const connectionPromises = new Map<string, Promise<CodexDesktopDeckTask>>();

export async function connectCodexDesktopDeckTask(options: CodexDesktopDeckOptions): Promise<CodexDesktopDeckTask> {
  const existing = connections.get(options.agentId);
  if (existing?.client.isConnected && samePath(existing.options.cwd, options.cwd)) {
    return existing.task;
  }

  const inFlight = connectionPromises.get(options.agentId);
  if (inFlight) return inFlight;

  const operation = (async () => {
    existing?.client.close();
    connections.delete(options.agentId);
    const persisted = await readPersistedBinding(options);
    const candidates = await listDesktopTaskCandidates(options.cwd, persisted?.threadId);
    const client = new CodexDesktopIPCClient();
    try {
      await client.connect();
      const task = await client.followCandidates(candidates);
      if (!samePath(task.cwd, options.cwd)) {
        throw new Error(`Codex Desktop returned a task for ${task.cwd}, not ${options.cwd}.`);
      }
      await writePersistedBinding(options, task);
      connections.set(options.agentId, { client, options, task });
      return task;
    } catch (error) {
      client.close();
      throw error;
    }
  })();
  connectionPromises.set(options.agentId, operation);
  try {
    return await operation;
  } finally {
    connectionPromises.delete(options.agentId);
  }
}

export function isCodexDesktopDeckTaskConnected(options: CodexDesktopDeckOptions): boolean {
  const connection = connections.get(options.agentId);
  return Boolean(connection?.client.isConnected && samePath(connection.options.cwd, options.cwd));
}

export async function getCodexDesktopDeckTaskSnapshot(options: CodexDesktopDeckOptions): Promise<SessionState | null> {
  const connection = connections.get(options.agentId);
  if (!connection?.client.isConnected || !samePath(connection.options.cwd, options.cwd)) {
    return null;
  }

  const raw = await readFile(connection.task.rolloutPath, "utf8");
  const snapshot = buildCodexRolloutSessionSnapshot(
    raw,
    { agentName: options.agentName, sessionId: connection.task.threadId, cwd: options.cwd },
    connection.task.threadId,
    connection.task.rolloutPath,
  );
  if (!snapshot) return null;
  snapshot.session.name = connection.task.title;
  snapshot.session.adapterType = "codex_desktop";
  snapshot.session.providerMeta = {
    ...(snapshot.session.providerMeta ?? {}),
    desktopOwned: true,
    desktopTaskTitle: connection.task.title,
  };
  return snapshot;
}

export async function startCodexDesktopDeckTurn(options: CodexDesktopDeckOptions, prompt: string): Promise<string> {
  const connection = connections.get(options.agentId);
  if (!connection?.client.isConnected) {
    throw new Error("Connect this lane to an open Codex Desktop task before starting a turn.");
  }
  return connection.client.startTurn(prompt);
}

export async function steerCodexDesktopDeckTurn(options: CodexDesktopDeckOptions, prompt: string): Promise<void> {
  const connection = connections.get(options.agentId);
  if (!connection?.client.isConnected) {
    throw new Error("Connect this lane to an open Codex Desktop task before steering it.");
  }
  await connection.client.steerTurn(prompt);
}

export async function interruptCodexDesktopDeckTurn(options: CodexDesktopDeckOptions): Promise<void> {
  const connection = connections.get(options.agentId);
  if (!connection?.client.isConnected) {
    throw new Error("Connect this lane to an open Codex Desktop task before interrupting it.");
  }
  await connection.client.interruptTurn();
}
