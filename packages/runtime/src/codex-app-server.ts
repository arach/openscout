import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import {
  buildScoutMcpCodexLaunchArgs,
  type ActionBlock,
  type BlockState,
  type ReasoningBlock,
  type SessionState,
  type TextBlock,
  type TurnState,
} from "@openscout/agent-sessions";
import type { ScoutReplyContext } from "@openscout/protocol";
import { buildManagedAgentEnvironment } from "./managed-agent-environment.js";

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

function normalizeCodexModelValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeCodexReasoningEffortValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function encodeCodexModelConfig(model: string): string {
  return `model=${JSON.stringify(model)}`;
}

function encodeCodexReasoningEffortConfig(reasoningEffort: string): string {
  return `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`;
}

function parseCodexConfigValue(value: string | null | undefined, expectedKey: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (key !== expectedKey) {
    return null;
  }

  const rawValue = trimmed.slice(separatorIndex + 1).trim();
  if (!rawValue) {
    return null;
  }

  if (
    (rawValue.startsWith("\"") && rawValue.endsWith("\""))
    || (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1) || null;
  }

  return rawValue;
}

function parseCodexModelConfig(value: string | null | undefined): string | null {
  return parseCodexConfigValue(value, "model");
}

function parseCodexReasoningEffortConfig(value: string | null | undefined): string | null {
  return parseCodexConfigValue(value, "model_reasoning_effort");
}

export function normalizeCodexAppServerLaunchArgs(launchArgs?: string[]): string[] {
  const args = Array.isArray(launchArgs)
    ? launchArgs.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const normalized: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? "";
    if (current === "--model" || current === "-m") {
      const model = normalizeCodexModelValue(args[index + 1]);
      if (model) {
        normalized.push("-c", encodeCodexModelConfig(model));
        index += 1;
        continue;
      }
      normalized.push(current);
      continue;
    }

    if (current.startsWith("--model=")) {
      const model = normalizeCodexModelValue(current.slice("--model=".length));
      if (model) {
        normalized.push("-c", encodeCodexModelConfig(model));
        continue;
      }
    }

    if (current.startsWith("-m=")) {
      const model = normalizeCodexModelValue(current.slice(3));
      if (model) {
        normalized.push("-c", encodeCodexModelConfig(model));
        continue;
      }
    }

    if (current === "--reasoning-effort" || current === "--effort") {
      const reasoningEffort = normalizeCodexReasoningEffortValue(args[index + 1]);
      if (reasoningEffort) {
        normalized.push("-c", encodeCodexReasoningEffortConfig(reasoningEffort));
        index += 1;
        continue;
      }
      normalized.push(current);
      continue;
    }

    if (current.startsWith("--reasoning-effort=")) {
      const reasoningEffort = normalizeCodexReasoningEffortValue(current.slice("--reasoning-effort=".length));
      if (reasoningEffort) {
        normalized.push("-c", encodeCodexReasoningEffortConfig(reasoningEffort));
        continue;
      }
    }

    if (current.startsWith("--effort=")) {
      const reasoningEffort = normalizeCodexReasoningEffortValue(current.slice("--effort=".length));
      if (reasoningEffort) {
        normalized.push("-c", encodeCodexReasoningEffortConfig(reasoningEffort));
        continue;
      }
    }

    if (current === "-c" || current === "--config") {
      const next = args[index + 1];
      if (typeof next === "string") {
        const model = parseCodexModelConfig(next);
        const reasoningEffort = parseCodexReasoningEffortConfig(next);
        normalized.push(
          current === "--config" ? "--config" : "-c",
          model
            ? encodeCodexModelConfig(model)
            : reasoningEffort
              ? encodeCodexReasoningEffortConfig(reasoningEffort)
              : next,
        );
        index += 1;
        continue;
      }
    }

    if (current.startsWith("--config=")) {
      const value = current.slice("--config=".length);
      const model = parseCodexModelConfig(value);
      const reasoningEffort = parseCodexReasoningEffortConfig(value);
      normalized.push(
        model
          ? `--config=${encodeCodexModelConfig(model)}`
          : reasoningEffort
            ? `--config=${encodeCodexReasoningEffortConfig(reasoningEffort)}`
            : current,
      );
      continue;
    }

    normalized.push(current);
  }

  return normalized;
}

export function readCodexAppServerModelFromLaunchArgs(launchArgs?: string[]): string | null {
  const normalized = normalizeCodexAppServerLaunchArgs(launchArgs);

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] ?? "";
    if (current === "-c" || current === "--config") {
      const model = parseCodexModelConfig(normalized[index + 1]);
      if (model) {
        return model;
      }
      index += 1;
      continue;
    }

    if (current.startsWith("--config=")) {
      const model = parseCodexModelConfig(current.slice("--config=".length));
      if (model) {
        return model;
      }
    }
  }

  return null;
}

export function readCodexAppServerReasoningEffortFromLaunchArgs(launchArgs?: string[]): string | null {
  const normalized = normalizeCodexAppServerLaunchArgs(launchArgs);

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] ?? "";
    if (current === "-c" || current === "--config") {
      const reasoningEffort = parseCodexReasoningEffortConfig(normalized[index + 1]);
      if (reasoningEffort) {
        return reasoningEffort;
      }
      index += 1;
      continue;
    }

    if (current.startsWith("--config=")) {
      const reasoningEffort = parseCodexReasoningEffortConfig(current.slice("--config=".length));
      if (reasoningEffort) {
        return reasoningEffort;
      }
    }
  }

  return null;
}

type CodexErrorResponse = {
  code: number;
  message: string;
  data?: unknown;
};

type SessionRequestOptions = {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs?: string[];
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
      reject(new Error(`Timed out after ${effectiveTimeoutMs}ms waiting for ${label}.`));
    }, effectiveTimeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function isCodexThreadGlobalMessage(message: Record<string, unknown>): boolean {
  const result = message.result as Record<string, unknown> | undefined;
  const thread = result?.thread as Record<string, unknown> | undefined;
  return typeof thread?.id === "string";
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

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

export function resolveCodexExecutableCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicitCandidates = [
    env.OPENSCOUT_CODEX_BIN,
    env.CODEX_BIN,
  ].filter(Boolean) as string[];
  const pathEntries = (env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  const commonDirectories = [
    `${env.HOME ?? ""}/.local/bin`,
    `${env.HOME ?? ""}/.bun/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(Boolean);
  const pathCandidates = [...pathEntries, ...commonDirectories]
    .map((directory) => join(directory, "codex"));
  const bundledCandidates = [
    "/Applications/Codex.app/Contents/Resources/codex",
    join(env.HOME ?? "", "Applications", "Codex.app", "Contents", "Resources", "codex"),
  ].filter(Boolean);

  return Array.from(new Set([
    ...explicitCandidates,
    ...pathCandidates,
    ...bundledCandidates,
    "codex",
  ]));
}

async function resolveCodexExecutable(): Promise<string> {
  for (const candidate of resolveCodexExecutableCandidates()) {
    if (candidate === "codex" || await isExecutable(candidate)) {
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

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
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
};

type CodexSessionCatalog = {
  activeSessionId: string | null;
  sessions: CodexSessionCatalogEntry[];
};

const SESSION_CATALOG_FILENAME = "session-catalog.json";
const SESSION_CATALOG_MAX_ENTRIES = 64;

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

function codexThreadStatusToSessionStatus(status: string | undefined): SessionState["session"]["status"] {
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

function codexTurnStatusToTurnStatus(status: string | undefined): TurnState["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "interrupted":
      return "interrupted";
    case "failed":
      return "error";
    default:
      return "streaming";
  }
}

function stringifyCodexItem(value: unknown): string {
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

function parseCodexTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parseCodexMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function extractCodexReasoningText(item: Record<string, unknown>): string {
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

function extractCodexMessageText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const record = entry as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractCodexUserMessageText(item: Record<string, unknown>): string {
  const text = extractCodexMessageText(item);
  if (text) {
    return text;
  }
  return typeof item.text === "string" ? item.text.trim() : "";
}

function renderCodexActionOutput(item: Record<string, unknown>): string {
  if (typeof item.text === "string" && item.text.trim()) {
    return item.text;
  }

  if (item.action !== undefined) {
    return stringifyCodexItem(item.action);
  }

  return stringifyCodexItem(item);
}

function buildCodexActionBlock(
  item: Record<string, unknown>,
  turnId: string,
  index: number,
): ActionBlock {
  return {
    id: typeof item.id === "string" ? item.id : `${turnId}:action:${index}`,
    turnId,
    index,
    type: "action",
    status: "streaming",
    action: {
      kind: "tool_call",
      toolName: typeof item.type === "string" ? item.type : "unknown",
      toolCallId: typeof item.id === "string" ? item.id : `${turnId}:action:${index}`,
      input: item,
      output: "",
      status: "running",
    },
  };
}

function buildCodexRolloutActionBlock(
  item: Record<string, unknown>,
  turnId: string,
  index: number,
): ActionBlock {
  const itemType = typeof item.type === "string" ? item.type : "tool_call";
  const toolCallId = typeof item.call_id === "string"
    ? item.call_id
    : `${turnId}:action:${index}`;
  const toolName = typeof item.name === "string"
    ? item.name
    : itemType === "web_search_call"
      ? "web_search"
      : itemType;
  const input = itemType === "function_call"
    ? parseCodexMaybeJson(item.arguments)
    : itemType === "custom_tool_call"
      ? item.input
      : item;

  return {
    id: toolCallId,
    turnId,
    index,
    type: "action",
    status: "streaming",
    action: {
      kind: "tool_call",
      toolName,
      toolCallId,
      input,
      output: "",
      status: "running",
    },
  };
}

function finalizeCodexTurnBlocks(
  turn: TurnState & { nextBlockIndex: number },
  status: "completed" | "interrupted" | "error",
): void {
  for (const blockState of turn.blocks) {
    if (blockState.status === "completed") {
      continue;
    }

    blockState.status = "completed";
    blockState.block.status = "completed";
    if (blockState.block.type === "action") {
      blockState.block.action.status = status === "completed" ? "completed" : "failed";
    }
  }
}

function setCodexProviderMeta(
  snapshot: SessionState,
  threadId: string | null,
  threadPath: string | null,
): void {
  if (!threadId && !threadPath) {
    return;
  }

  snapshot.session.providerMeta = {
    ...(snapshot.session.providerMeta ?? {}),
    ...(threadId ? { threadId } : {}),
    ...(threadPath ? { threadPath } : {}),
  };
}

function ensureCodexProviderMetaRecord(
  snapshot: SessionState,
  key: string,
): Record<string, unknown> {
  const providerMeta = snapshot.session.providerMeta && typeof snapshot.session.providerMeta === "object"
    ? snapshot.session.providerMeta
    : {};
  snapshot.session.providerMeta = providerMeta;

  const existing = metadataRecord(providerMeta, key);
  if (existing) {
    return existing;
  }

  const next: Record<string, unknown> = {};
  providerMeta[key] = next;
  return next;
}

function setObserveString(target: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === "string" && value.trim().length > 0) {
    target[key] = value.trim();
  }
}

function setObserveNumber(target: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
  }
}

export function buildCodexAppServerSessionSnapshot(
  raw: string,
  options: CodexSessionSnapshotOptions,
  targetThreadId?: string | null,
): SessionState | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let resolvedThreadId = targetThreadId?.trim() || null;
  if (!resolvedThreadId) {
    for (const line of lines) {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        const resultThread = (message.result as Record<string, unknown> | undefined)?.thread as Record<string, unknown> | undefined;
        const paramsThread = (message.params as Record<string, unknown> | undefined)?.thread as Record<string, unknown> | undefined;
        const params = message.params as Record<string, unknown> | undefined;
        const nextThreadId = typeof resultThread?.id === "string"
          ? resultThread.id
          : typeof paramsThread?.id === "string"
            ? paramsThread.id
            : typeof params?.threadId === "string"
              ? params.threadId
            : null;
        if (nextThreadId) {
          resolvedThreadId = nextThreadId;
        }
      } catch {
        // Ignore malformed lines in snapshot mode.
      }
    }
  }

  const snapshot: SessionState = {
    session: {
      id: options.sessionId,
      name: options.agentName,
      adapterType: "codex_app_server",
      status: resolvedThreadId ? "idle" : "connecting",
      cwd: options.cwd,
      providerMeta: resolvedThreadId ? { threadId: resolvedThreadId } : undefined,
    },
    turns: [],
  };

  const turnsById = new Map<string, TurnState & { nextBlockIndex: number }>();
  const blocksById = new Map<string, BlockState>();

  const ensureTurn = (turnId: string) => {
    const existing = turnsById.get(turnId);
    if (existing) {
      return existing;
    }

    const turn: TurnState & { nextBlockIndex: number } = {
      id: turnId,
      status: "streaming",
      blocks: [],
      startedAt: Date.now(),
      nextBlockIndex: 0,
    };
    turnsById.set(turnId, turn);
    snapshot.turns.push(turn);
    snapshot.currentTurnId = turnId;
    snapshot.session.status = "active";
    return turn;
  };

  const completeBlock = (blockState: BlockState | undefined) => {
    if (!blockState) {
      return;
    }

    blockState.status = "completed";
    blockState.block.status = "completed";
  };

  for (const line of lines) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const params = message.params as Record<string, unknown> | undefined;
    const result = message.result as Record<string, unknown> | undefined;
    const paramsThread = params?.thread as Record<string, unknown> | undefined;
    const resultThread = result?.thread as Record<string, unknown> | undefined;
    const lineThreadId = typeof params?.threadId === "string"
      ? params.threadId
      : typeof paramsThread?.id === "string"
        ? paramsThread.id
        : typeof resultThread?.id === "string"
          ? resultThread.id
          : null;
    if (resolvedThreadId) {
      if (lineThreadId && lineThreadId !== resolvedThreadId) {
        continue;
      }
      if (!lineThreadId && !isCodexThreadGlobalMessage(message)) {
        continue;
      }
    }

    const resultModel = typeof result?.model === "string" ? result.model : null;
    if (resultThread && resultModel) {
      snapshot.session.model = resultModel;
    }
    if (typeof resultThread?.path === "string") {
      snapshot.session.providerMeta = {
        ...(snapshot.session.providerMeta ?? {}),
        threadId: resolvedThreadId ?? resultThread.id,
        threadPath: resultThread.path,
      };
    }
    if (typeof resultThread?.cwd === "string") {
      snapshot.session.cwd = resultThread.cwd;
    }

    if (message.method === "thread/started" || message.method === "thread/name/updated") {
      if (typeof paramsThread?.path === "string") {
        snapshot.session.providerMeta = {
          ...(snapshot.session.providerMeta ?? {}),
          threadId: resolvedThreadId ?? paramsThread.id,
          threadPath: paramsThread.path,
        };
      }
      if (typeof paramsThread?.cwd === "string") {
        snapshot.session.cwd = paramsThread.cwd;
      }
      if (typeof paramsThread?.name === "string" && paramsThread.name.trim()) {
        snapshot.session.name = paramsThread.name;
      }
      continue;
    }

    if (message.method === "thread/status/changed") {
      const status = (params?.status as Record<string, unknown> | undefined)?.type;
      snapshot.session.status = codexThreadStatusToSessionStatus(typeof status === "string" ? status : undefined);
      continue;
    }

    if (message.method === "turn/started") {
      const turn = params?.turn as Record<string, unknown> | undefined;
      if (typeof turn?.id === "string") {
        ensureTurn(turn.id);
      }
      continue;
    }

    if (message.method === "item/started") {
      const item = params?.item as Record<string, unknown> | undefined;
      const turnId = typeof params?.turnId === "string" ? params.turnId : null;
      const itemType = typeof item?.type === "string" ? item.type : "";
      const itemId = typeof item?.id === "string" ? item.id : null;
      if (!turnId || !item || !itemId || !itemType) {
        continue;
      }

      const turn = ensureTurn(turnId);
      if (itemType === "userMessage") {
        const block: TextBlock = {
          id: itemId,
          turnId,
          index: turn.nextBlockIndex++,
          type: "text",
          text: extractCodexUserMessageText(item),
          status: "streaming",
        };
        const blockState: BlockState = { block, status: "streaming" };
        turn.blocks.push(blockState);
        blocksById.set(itemId, blockState);
        continue;
      }

      if (itemType === "agentMessage") {
        const block: TextBlock = {
          id: itemId,
          turnId,
          index: turn.nextBlockIndex++,
          type: "text",
          text: typeof item.text === "string" ? item.text : "",
          status: "streaming",
        };
        const blockState: BlockState = { block, status: "streaming" };
        turn.blocks.push(blockState);
        blocksById.set(itemId, blockState);
        continue;
      }

      if (itemType === "reasoning") {
        const text = extractCodexReasoningText(item);
        if (!text) {
          continue;
        }

        const block: ReasoningBlock = {
          id: itemId,
          turnId,
          index: turn.nextBlockIndex++,
          type: "reasoning",
          text,
          status: "streaming",
        };
        const blockState: BlockState = { block, status: "streaming" };
        turn.blocks.push(blockState);
        blocksById.set(itemId, blockState);
        continue;
      }

      const block = buildCodexActionBlock(item, turnId, turn.nextBlockIndex++);
      const blockState: BlockState = { block, status: "streaming" };
      turn.blocks.push(blockState);
      blocksById.set(block.id, blockState);
      continue;
    }

    if (message.method === "item/agentMessage/delta") {
      const itemId = typeof params?.itemId === "string" ? params.itemId : null;
      const delta = typeof params?.delta === "string" ? params.delta : "";
      const blockState = itemId ? blocksById.get(itemId) : undefined;
      if (blockState?.block.type === "text") {
        (blockState.block as TextBlock).text += delta;
      }
      continue;
    }

    if (message.method === "item/completed") {
      const item = params?.item as Record<string, unknown> | undefined;
      const turnId = typeof params?.turnId === "string" ? params.turnId : null;
      const itemType = typeof item?.type === "string" ? item.type : "";
      const itemId = typeof item?.id === "string" ? item.id : null;
      if (!turnId || !item || !itemId || !itemType) {
        continue;
      }

      if (itemType === "userMessage") {
        const turn = ensureTurn(turnId);
        let blockState = blocksById.get(itemId);
        if (!blockState) {
          const block: TextBlock = {
            id: itemId,
            turnId,
            index: turn.nextBlockIndex++,
            type: "text",
            text: "",
            status: "streaming",
          };
          blockState = { block, status: "streaming" };
          turn.blocks.push(blockState);
          blocksById.set(itemId, blockState);
        }
        if (blockState.block.type === "text") {
          (blockState.block as TextBlock).text = extractCodexUserMessageText(item);
        }
        completeBlock(blockState);
        continue;
      }

      if (itemType === "agentMessage") {
        const turn = ensureTurn(turnId);
        let blockState = blocksById.get(itemId);
        if (!blockState) {
          const block: TextBlock = {
            id: itemId,
            turnId,
            index: turn.nextBlockIndex++,
            type: "text",
            text: "",
            status: "streaming",
          };
          blockState = { block, status: "streaming" };
          turn.blocks.push(blockState);
          blocksById.set(itemId, blockState);
        }
        if (blockState.block.type === "text" && typeof item.text === "string" && item.text.length > 0) {
          (blockState.block as TextBlock).text = item.text;
        }
        completeBlock(blockState);
        continue;
      }

      if (itemType === "reasoning") {
        const text = extractCodexReasoningText(item);
        if (!text) {
          continue;
        }

        const turn = ensureTurn(turnId);
        let blockState = blocksById.get(itemId);
        if (!blockState) {
          const block: ReasoningBlock = {
            id: itemId,
            turnId,
            index: turn.nextBlockIndex++,
            type: "reasoning",
            text,
            status: "streaming",
          };
          blockState = { block, status: "streaming" };
          turn.blocks.push(blockState);
          blocksById.set(itemId, blockState);
        }
        if (blockState.block.type === "reasoning" && text) {
          (blockState.block as ReasoningBlock).text = text;
        }
        completeBlock(blockState);
        continue;
      }

      const turn = ensureTurn(turnId);
      let blockState = blocksById.get(itemId);
      if (!blockState) {
        const block = buildCodexActionBlock(item, turnId, turn.nextBlockIndex++);
        blockState = { block, status: "streaming" };
        turn.blocks.push(blockState);
        blocksById.set(itemId, blockState);
      }
      if (blockState.block.type === "action") {
        blockState.block.action.output = renderCodexActionOutput(item);
        blockState.block.action.status = "completed";
      }
      completeBlock(blockState);
      continue;
    }

    if (message.method === "turn/completed") {
      const turn = params?.turn as Record<string, unknown> | undefined;
      if (!turn || typeof turn.id !== "string") {
        continue;
      }

      const turnState = ensureTurn(turn.id);
      turnState.status = codexTurnStatusToTurnStatus(typeof turn.status === "string" ? turn.status : undefined);
      turnState.endedAt = Date.now();
      if (snapshot.currentTurnId === turn.id) {
        snapshot.currentTurnId = undefined;
      }
      snapshot.session.status = turnState.status === "error" ? "error" : "idle";
      continue;
    }

    if (message.method === "error") {
      snapshot.session.status = "error";
    }
  }

  if (!resolvedThreadId && snapshot.turns.length === 0) {
    return null;
  }

  return snapshot;
}

export function buildCodexRolloutSessionSnapshot(
  raw: string,
  options: CodexSessionSnapshotOptions,
  targetThreadId?: string | null,
  rolloutPath?: string | null,
): SessionState | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let resolvedThreadId = targetThreadId?.trim() || null;
  const snapshot: SessionState = {
    session: {
      id: options.sessionId,
      name: options.agentName,
      adapterType: "codex_app_server",
      status: resolvedThreadId ? "idle" : "connecting",
      cwd: options.cwd,
    },
    turns: [],
  };
  setCodexProviderMeta(snapshot, resolvedThreadId, rolloutPath ?? null);

  const turnsById = new Map<string, TurnState & { nextBlockIndex: number }>();
  const blocksByCallId = new Map<string, BlockState>();
  let currentTurnId: string | null = null;

  const ensureTurn = (turnId: string, startedAt?: number) => {
    const existing = turnsById.get(turnId);
    if (existing) {
      if (startedAt && !existing.startedAt) {
        existing.startedAt = startedAt;
      }
      return existing;
    }

    const turn: TurnState & { nextBlockIndex: number } = {
      id: turnId,
      status: "streaming",
      blocks: [],
      startedAt: startedAt ?? Date.now(),
      nextBlockIndex: 0,
    };
    turnsById.set(turnId, turn);
    snapshot.turns.push(turn);
    snapshot.currentTurnId = turnId;
    snapshot.session.status = "active";
    return turn;
  };

  for (const line of lines) {
    const message = parseJsonRecord(line);
    if (!message) {
      continue;
    }

    const timestamp = parseCodexTimestamp(message.timestamp) ?? Date.now();
    const entryType = typeof message.type === "string" ? message.type : "";
    const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
      ? message.payload as Record<string, unknown>
      : undefined;
    if (!payload) {
      continue;
    }

    if (entryType === "session_meta") {
      const sessionThreadId = typeof payload.id === "string" ? payload.id : null;
      if (sessionThreadId) {
        if (resolvedThreadId && sessionThreadId !== resolvedThreadId) {
          return null;
        }
        resolvedThreadId = sessionThreadId;
      }
      if (typeof payload.cwd === "string" && payload.cwd.trim()) {
        snapshot.session.cwd = payload.cwd;
      }
      setCodexProviderMeta(snapshot, resolvedThreadId, rolloutPath ?? null);
      snapshot.session.status = resolvedThreadId ? "idle" : snapshot.session.status;

      const runtime = ensureCodexProviderMetaRecord(snapshot, "observeRuntime");
      setObserveString(runtime, "originator", payload.originator);
      setObserveString(runtime, "cliVersion", payload.cli_version);
      setObserveString(runtime, "modelProvider", payload.model_provider);
      setObserveString(runtime, "source", typeof payload.source === "string" ? payload.source : undefined);
      const git = metadataRecord(payload, "git");
      setObserveString(runtime, "gitBranch", git?.branch);
      continue;
    }

    if (entryType === "turn_context") {
      if (typeof payload.cwd === "string" && payload.cwd.trim()) {
        snapshot.session.cwd = payload.cwd;
      }
      if (typeof payload.model === "string" && payload.model.trim()) {
        snapshot.session.model = payload.model;
      }

      const runtime = ensureCodexProviderMetaRecord(snapshot, "observeRuntime");
      setObserveString(runtime, "approvalPolicy", payload.approval_policy);
      setObserveString(runtime, "effort", payload.effort);
      setObserveString(runtime, "timezone", payload.timezone);
      const sandboxPolicy = metadataRecord(payload, "sandbox_policy");
      setObserveString(runtime, "sandbox", sandboxPolicy?.type);
      continue;
    }

    if (entryType === "event_msg") {
      const payloadType = typeof payload.type === "string" ? payload.type : "";
      if (payloadType === "task_started") {
        const turnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
        if (!turnId) {
          continue;
        }
        currentTurnId = turnId;
        ensureTurn(turnId, parseCodexTimestamp(payload.started_at) ?? timestamp);
        snapshot.currentTurnId = turnId;
        snapshot.session.status = "active";

        const usage = ensureCodexProviderMetaRecord(snapshot, "observeUsage");
        setObserveNumber(usage, "contextWindowTokens", payload.model_context_window);
        continue;
      }

      if (payloadType === "token_count") {
        const usage = ensureCodexProviderMetaRecord(snapshot, "observeUsage");
        const info = metadataRecord(payload, "info");
        const totalTokenUsage = metadataRecord(info, "total_token_usage");
        setObserveNumber(usage, "inputTokens", totalTokenUsage?.input_tokens);
        setObserveNumber(usage, "cacheReadInputTokens", totalTokenUsage?.cached_input_tokens);
        setObserveNumber(usage, "outputTokens", totalTokenUsage?.output_tokens);
        setObserveNumber(usage, "reasoningOutputTokens", totalTokenUsage?.reasoning_output_tokens);
        setObserveNumber(usage, "totalTokens", totalTokenUsage?.total_tokens);
        setObserveNumber(usage, "contextWindowTokens", info?.model_context_window);

        const rateLimits = metadataRecord(payload, "rate_limits");
        setObserveString(usage, "planType", rateLimits?.plan_type);
      }

      if (payloadType === "task_complete" || payloadType === "turn_aborted") {
        const turnId: string | null = typeof payload.turn_id === "string" ? payload.turn_id : currentTurnId;
        if (!turnId) {
          continue;
        }

        const turn = ensureTurn(turnId);
        turn.status = payloadType === "task_complete"
          ? "completed"
          : payload.reason === "interrupted"
            ? "interrupted"
            : "error";
        turn.endedAt = parseCodexTimestamp(payload.completed_at) ?? timestamp;
        finalizeCodexTurnBlocks(turn, turn.status);

        if (snapshot.currentTurnId === turnId) {
          snapshot.currentTurnId = undefined;
        }
        currentTurnId = currentTurnId === turnId ? null : currentTurnId;
        snapshot.session.status = turn.status === "error" ? "error" : "idle";
      }
      continue;
    }

    if (entryType !== "response_item" || !currentTurnId) {
      continue;
    }

    const turn = ensureTurn(currentTurnId);
    const payloadType = typeof payload.type === "string" ? payload.type : "";

    if (payloadType === "message" && payload.role === "user") {
      const text = extractCodexMessageText(payload);
      if (!text) {
        continue;
      }

      const block: TextBlock = {
        id: `${turn.id}:text:${turn.nextBlockIndex}`,
        turnId: turn.id,
        index: turn.nextBlockIndex++,
        type: "text",
        text,
        status: "completed",
      };
      turn.blocks.push({ block, status: "completed" });
      continue;
    }

    if (payloadType === "message" && payload.role === "assistant") {
      const text = extractCodexMessageText(payload);
      if (!text) {
        continue;
      }

      const block: TextBlock = {
        id: `${turn.id}:text:${turn.nextBlockIndex}`,
        turnId: turn.id,
        index: turn.nextBlockIndex++,
        type: "text",
        text,
        status: "completed",
      };
      turn.blocks.push({ block, status: "completed" });
      continue;
    }

    if (payloadType === "reasoning") {
      const text = extractCodexReasoningText(payload);
      if (!text) {
        continue;
      }

      const block: ReasoningBlock = {
        id: `${turn.id}:reasoning:${turn.nextBlockIndex}`,
        turnId: turn.id,
        index: turn.nextBlockIndex++,
        type: "reasoning",
        text,
        status: "completed",
      };
      turn.blocks.push({ block, status: "completed" });
      continue;
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call" || payloadType === "web_search_call") {
      const block = buildCodexRolloutActionBlock(payload, turn.id, turn.nextBlockIndex++);
      const blockState: BlockState = { block, status: "streaming" };
      turn.blocks.push(blockState);
      blocksByCallId.set(block.id, blockState);
      continue;
    }

    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : null;
      if (!callId) {
        continue;
      }

      let blockState = blocksByCallId.get(callId);
      if (!blockState) {
        const block = buildCodexRolloutActionBlock({
          type: "tool_call",
          call_id: callId,
          name: "unknown",
        }, turn.id, turn.nextBlockIndex++);
        blockState = { block, status: "streaming" };
        turn.blocks.push(blockState);
        blocksByCallId.set(callId, blockState);
      }

      if (blockState.block.type === "action") {
        blockState.block.action.output = stringifyCodexItem(payload.output);
        blockState.block.action.status = "completed";
      }
      blockState.status = "completed";
      blockState.block.status = "completed";
    }
  }

  if (!resolvedThreadId && snapshot.turns.length === 0) {
    return null;
  }

  setCodexProviderMeta(snapshot, resolvedThreadId, rolloutPath ?? null);
  snapshot.session.status = snapshot.currentTurnId ? "active" : snapshot.session.status;
  return snapshot;
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

  async shutdown(options: { resetThread?: boolean } = {}): Promise<void> {
    const activeTurn = this.activeTurn;
    this.activeTurn = null;
    if (activeTurn) {
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

    const codexExecutable = await resolveCodexExecutable();
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
    const requestedThreadId = this.options.threadId?.trim() || null;
    const storedThreadId = requestedThreadId ?? await readOptionalFile(this.threadIdPath);
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
    await recordCodexSessionCatalog(this.options.runtimeDirectory, this.threadId, this.catalogRuntimeMeta());
  }

  private catalogRuntimeMeta(): {
    cwd: string;
    harness: string;
    transport: string;
    model: string | null;
  } {
    return {
      cwd: this.options.cwd,
      harness: "codex",
      transport: "codex_app_server",
      model: readCodexAppServerModelFromLaunchArgs(this.options.launchArgs),
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
        reject(new Error(`Timed out after ${effectiveTimeoutMs}ms waiting for ${this.options.agentName}.`));
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
    if (activeTurn) {
      for (const watcher of this.drainTurnWatchers(activeTurn)) {
        watcher.reject(error);
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
  shutdownOptions: { resetThread?: boolean } = {},
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
