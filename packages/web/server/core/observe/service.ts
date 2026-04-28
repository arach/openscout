import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  createHistorySessionSnapshot,
  supportsHistorySessionSnapshotForPath,
  type Block,
  type HistorySessionEvent,
  type PairingEvent,
  type SessionState,
} from "@openscout/agent-sessions";
import {
  getLocalAgentEndpointSessionSnapshot,
} from "@openscout/runtime/local-agents";
import type { RuntimeRegistrySnapshot } from "@openscout/runtime/registry";
import type { AgentEndpoint } from "@openscout/protocol";

import type { WebAgent } from "../../db-queries.ts";
import { queryAgents } from "../../db-queries.ts";
import { getScoutWebPairingSessionSnapshot } from "../../pairing.ts";
import { loadScoutBrokerContext } from "../broker/service.ts";

export type ObserveEventKind =
  | "think"
  | "tool"
  | "ask"
  | "message"
  | "note"
  | "system"
  | "boot";

export interface ObserveEvent {
  id: string;
  t: number;
  kind: ObserveEventKind;
  text: string;
  tool?: string;
  arg?: string;
  diff?: { add: number; del: number; preview: string };
  result?: Record<string, string | number>;
  stream?: string[];
  live?: boolean;
  to?: string;
  answer?: string;
  answerT?: number;
  detail?: string;
}

export interface ObserveFile {
  path: string;
  state: "read" | "created" | "modified";
  touches: number;
  lastT: number;
}

export interface ObserveUsageMeta {
  assistantMessages?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalTokens?: number;
  contextWindowTokens?: number;
  webSearchRequests?: number;
  webFetchRequests?: number;
  serviceTier?: string;
  speed?: string;
  planType?: string;
}

export interface ObserveSessionMeta {
  adapterType?: string;
  model?: string;
  cwd?: string;
  turnCount?: number;
  externalSessionId?: string;
  threadId?: string;
  threadPath?: string;
  gitBranch?: string;
  cliVersion?: string;
  entrypoint?: string;
  originator?: string;
  source?: string;
  permissionMode?: string;
  approvalPolicy?: string;
  sandbox?: string;
  userType?: string;
  effort?: string;
  modelProvider?: string;
  timezone?: string;
}

export interface ObserveMetadata {
  session?: ObserveSessionMeta;
  usage?: ObserveUsageMeta;
}

export interface ObserveData {
  events: ObserveEvent[];
  files: ObserveFile[];
  contextUsage?: number[];
  live?: boolean;
  metadata?: ObserveMetadata;
}

export interface AgentObservePayload {
  agentId: string;
  source: "history" | "live" | "unavailable";
  fidelity: "timestamped" | "synthetic";
  historyPath: string | null;
  sessionId: string | null;
  updatedAt: number;
  data: ObserveData;
}

type TimestampedPairingEvent = {
  timestamp: number;
  event: PairingEvent;
};

type ObserveBrokerContext = Awaited<ReturnType<typeof loadScoutBrokerContext>>;

type SnapshotSource =
  | {
      source: "history";
      historyPath: string;
      snapshot: SessionState;
      timedEvents: TimestampedPairingEvent[];
      live: boolean;
      sessionId: string | null;
    }
  | {
      source: "live";
      historyPath: string | null;
      snapshot: SessionState;
      timedEvents: TimestampedPairingEvent[];
      live: boolean;
      sessionId: string | null;
    }
  | {
      source: "unavailable";
      historyPath: null;
      live: false;
      sessionId: null;
    };

type HistorySnapshotResult = {
  historyPath: string;
  snapshot: SessionState;
  timedEvents: TimestampedPairingEvent[];
};

type HistorySnapshotCacheEntry = HistorySnapshotResult & {
  adapterType: "claude-code" | "codex";
  mtimeMs: number;
  size: number;
};

const HISTORY_SNAPSHOT_CACHE_LIMIT = 128;
const historySnapshotCache = new Map<string, HistorySnapshotCacheEntry>();
const OBSERVE_SUMMARY_TAIL_SIZE = 8;

function activeEndpoint(
  snapshot: RuntimeRegistrySnapshot,
  agentId: string,
): AgentEndpoint | null {
  const candidates = Object.values(snapshot.endpoints ?? {}).filter(
    (endpoint) => endpoint.agentId === agentId,
  );
  const rank = (state: string | undefined) => {
    switch (state) {
      case "active":
        return 0;
      case "idle":
        return 1;
      case "waiting":
        return 2;
      case "offline":
        return 5;
      default:
        return 4;
    }
  };

  return [...candidates].sort((left, right) => rank(left.state) - rank(right.state))[0] ?? null;
}

function expandHome(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function encodeClaudeProjectsSlug(absolutePath: string): string {
  const normalized = resolve(absolutePath);
  return `-${normalized.replace(/^\//u, "").replace(/\//gu, "-")}`;
}

function resolveClaudeHistoryPath(
  cwd: string | null | undefined,
  sessionId: string | null | undefined,
): string | null {
  const normalizedCwd = expandHome(cwd)?.trim();
  if (!normalizedCwd) {
    return null;
  }
  const projectDir = join(
    homedir(),
    ".claude",
    "projects",
    encodeClaudeProjectsSlug(normalizedCwd),
  );
  const normalizedSessionId = sessionId?.trim().replace(/\.jsonl$/u, "") || "";
  if (normalizedSessionId) {
    const exactPath = join(projectDir, `${normalizedSessionId}.jsonl`);
    if (existsSync(exactPath)) {
      return exactPath;
    }
  }
  // Fallback: find the most recently modified .jsonl in the project dir
  return findMostRecentJsonl(projectDir);
}

function findMostRecentJsonl(dir: string): string | null {
  if (!existsSync(dir)) return null;
  try {
    let best: { path: string; mtime: number } | null = null;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".jsonl")) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (!best || st.mtimeMs > best.mtime) {
        best = { path: full, mtime: st.mtimeMs };
      }
    }
    return best?.path ?? null;
  } catch {
    return null;
  }
}

function historyAdapterAlias(
  value: string | null | undefined,
): "claude-code" | "codex" | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claude_stream_json") {
    return "claude-code";
  }
  if (normalized === "codex" || normalized === "codex_app_server") {
    return "codex";
  }
  return null;
}

function snapshotProviderMeta(snapshot: SessionState): Record<string, unknown> {
  const providerMeta = snapshot.session.providerMeta;
  return providerMeta && typeof providerMeta === "object" ? providerMeta : {};
}

function metadataRecord(
  metadata: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = metadata?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function metadataNumber(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildObserveMetadata(snapshot: SessionState): ObserveMetadata | undefined {
  const providerMeta = snapshotProviderMeta(snapshot);
  const observeRuntime = metadataRecord(providerMeta, "observeRuntime");
  const observeUsage = metadataRecord(providerMeta, "observeUsage");

  const sessionMeta: ObserveSessionMeta = {};
  if (snapshot.session.adapterType) sessionMeta.adapterType = snapshot.session.adapterType;
  if (snapshot.session.model) sessionMeta.model = snapshot.session.model;
  if (snapshot.session.cwd) sessionMeta.cwd = snapshot.session.cwd;
  if (snapshot.turns.length > 0) sessionMeta.turnCount = snapshot.turns.length;
  if (metadataString(providerMeta, "externalSessionId")) {
    sessionMeta.externalSessionId = metadataString(providerMeta, "externalSessionId");
  }
  if (metadataString(providerMeta, "threadId")) {
    sessionMeta.threadId = metadataString(providerMeta, "threadId");
  }
  if (metadataString(providerMeta, "threadPath")) {
    sessionMeta.threadPath = metadataString(providerMeta, "threadPath");
  }
  if (metadataString(observeRuntime, "gitBranch")) {
    sessionMeta.gitBranch = metadataString(observeRuntime, "gitBranch");
  }
  if (metadataString(observeRuntime, "cliVersion")) {
    sessionMeta.cliVersion = metadataString(observeRuntime, "cliVersion");
  }
  if (metadataString(observeRuntime, "entrypoint")) {
    sessionMeta.entrypoint = metadataString(observeRuntime, "entrypoint");
  }
  if (metadataString(observeRuntime, "originator")) {
    sessionMeta.originator = metadataString(observeRuntime, "originator");
  }
  if (metadataString(observeRuntime, "source")) {
    sessionMeta.source = metadataString(observeRuntime, "source");
  }
  if (metadataString(observeRuntime, "permissionMode")) {
    sessionMeta.permissionMode = metadataString(observeRuntime, "permissionMode");
  }
  if (metadataString(observeRuntime, "approvalPolicy")) {
    sessionMeta.approvalPolicy = metadataString(observeRuntime, "approvalPolicy");
  }
  if (metadataString(observeRuntime, "sandbox")) {
    sessionMeta.sandbox = metadataString(observeRuntime, "sandbox");
  }
  if (metadataString(observeRuntime, "userType")) {
    sessionMeta.userType = metadataString(observeRuntime, "userType");
  }
  if (metadataString(observeRuntime, "effort")) {
    sessionMeta.effort = metadataString(observeRuntime, "effort");
  }
  if (metadataString(observeRuntime, "modelProvider")) {
    sessionMeta.modelProvider = metadataString(observeRuntime, "modelProvider");
  }
  if (metadataString(observeRuntime, "timezone")) {
    sessionMeta.timezone = metadataString(observeRuntime, "timezone");
  }

  const usageMeta: ObserveUsageMeta = {};
  if (metadataNumber(observeUsage, "assistantMessages") !== undefined) {
    usageMeta.assistantMessages = metadataNumber(observeUsage, "assistantMessages");
  }
  if (metadataNumber(observeUsage, "inputTokens") !== undefined) {
    usageMeta.inputTokens = metadataNumber(observeUsage, "inputTokens");
  }
  if (metadataNumber(observeUsage, "outputTokens") !== undefined) {
    usageMeta.outputTokens = metadataNumber(observeUsage, "outputTokens");
  }
  if (metadataNumber(observeUsage, "reasoningOutputTokens") !== undefined) {
    usageMeta.reasoningOutputTokens = metadataNumber(observeUsage, "reasoningOutputTokens");
  }
  if (metadataNumber(observeUsage, "cacheReadInputTokens") !== undefined) {
    usageMeta.cacheReadInputTokens = metadataNumber(observeUsage, "cacheReadInputTokens");
  }
  if (metadataNumber(observeUsage, "cacheCreationInputTokens") !== undefined) {
    usageMeta.cacheCreationInputTokens = metadataNumber(observeUsage, "cacheCreationInputTokens");
  }
  if (metadataNumber(observeUsage, "totalTokens") !== undefined) {
    usageMeta.totalTokens = metadataNumber(observeUsage, "totalTokens");
  }
  if (metadataNumber(observeUsage, "contextWindowTokens") !== undefined) {
    usageMeta.contextWindowTokens = metadataNumber(observeUsage, "contextWindowTokens");
  }
  if (metadataNumber(observeUsage, "webSearchRequests") !== undefined) {
    usageMeta.webSearchRequests = metadataNumber(observeUsage, "webSearchRequests");
  }
  if (metadataNumber(observeUsage, "webFetchRequests") !== undefined) {
    usageMeta.webFetchRequests = metadataNumber(observeUsage, "webFetchRequests");
  }
  if (metadataString(observeUsage, "serviceTier")) {
    usageMeta.serviceTier = metadataString(observeUsage, "serviceTier");
  }
  if (metadataString(observeUsage, "speed")) {
    usageMeta.speed = metadataString(observeUsage, "speed");
  }
  if (metadataString(observeUsage, "planType")) {
    usageMeta.planType = metadataString(observeUsage, "planType");
  }

  const hasSessionMeta = Object.keys(sessionMeta).length > 0;
  const hasUsageMeta = Object.keys(usageMeta).length > 0;
  if (!hasSessionMeta && !hasUsageMeta) {
    return undefined;
  }

  return {
    ...(hasSessionMeta ? { session: sessionMeta } : {}),
    ...(hasUsageMeta ? { usage: usageMeta } : {}),
  };
}

function firstString(
  ...values: Array<unknown>
): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function resolveHistoryCandidate(
  agent: WebAgent,
  snapshot: SessionState | null,
): { path: string; adapterType: "claude-code" | "codex" } | null {
  const snapshotAdapter = historyAdapterAlias(snapshot?.session.adapterType);
  const agentAdapter = historyAdapterAlias(agent.harness);
  const providerMeta = snapshot ? snapshotProviderMeta(snapshot) : {};

  const directPath = firstString(
    providerMeta.resumeSessionPath,
    providerMeta.threadPath,
  );
  if (directPath) {
    const adapterType = snapshotAdapter ?? agentAdapter;
    if (adapterType) {
      return { path: directPath, adapterType };
    }
  }

  const claudeSessionId = firstString(
    providerMeta.transportSessionId,
    agent.harnessSessionId,
  );
  const claudeCwd = firstString(
    snapshot?.session.cwd,
    agent.cwd,
    agent.projectRoot,
  );
  if ((snapshotAdapter ?? agentAdapter) === "claude-code") {
    const path = resolveClaudeHistoryPath(claudeCwd, claudeSessionId);
    if (path) {
      return { path, adapterType: "claude-code" };
    }
  }

  return null;
}

function normalizeTimedEvents(
  events: HistorySessionEvent[] | undefined,
): TimestampedPairingEvent[] {
  if (!events) {
    return [];
  }
  return events.map((entry) => ({
    timestamp: entry.capturedAt,
    event: entry.event,
  }));
}

function readHistorySnapshot(
  candidate: { path: string; adapterType: "claude-code" | "codex" } | null,
): HistorySnapshotResult | null {
  if (!candidate) {
    return null;
  }
  if (!supportsHistorySessionSnapshotForPath(candidate.path, candidate.adapterType)) {
    return null;
  }
  if (!existsSync(candidate.path)) {
    return null;
  }

  const stat = statSync(candidate.path);
  const cached = historySnapshotCache.get(candidate.path);
  if (
    cached
    && cached.adapterType === candidate.adapterType
    && cached.mtimeMs === stat.mtimeMs
    && cached.size === stat.size
  ) {
    return {
      historyPath: cached.historyPath,
      snapshot: cached.snapshot,
      timedEvents: cached.timedEvents,
    };
  }
  const replay = createHistorySessionSnapshot({
    path: candidate.path,
    content: readFileSync(candidate.path, "utf8"),
    adapterType: candidate.adapterType,
    baseTimestampMs: stat.mtimeMs,
  });

  const nextEntry: HistorySnapshotCacheEntry = {
    historyPath: candidate.path,
    snapshot: replay.snapshot,
    timedEvents: normalizeTimedEvents(replay.events),
    adapterType: candidate.adapterType,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
  historySnapshotCache.set(candidate.path, nextEntry);
  if (historySnapshotCache.size > HISTORY_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = historySnapshotCache.keys().next().value;
    if (typeof oldestKey === "string") {
      historySnapshotCache.delete(oldestKey);
    }
  }

  return {
    historyPath: nextEntry.historyPath,
    snapshot: nextEntry.snapshot,
    timedEvents: nextEntry.timedEvents,
  };
}

async function readLiveSnapshot(endpoint: AgentEndpoint | null): Promise<SessionState | null> {
  if (!endpoint?.sessionId) {
    return null;
  }
  if (endpoint.transport === "pairing_bridge") {
    return await getScoutWebPairingSessionSnapshot(endpoint.sessionId);
  }
  if (endpoint.transport === "codex_app_server" || endpoint.transport === "claude_stream_json") {
    return await getLocalAgentEndpointSessionSnapshot(endpoint);
  }
  return null;
}

function summarizeCommandOutput(output: string): string[] | undefined {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return undefined;
  }
  return lines.slice(-12);
}

function truncatePreview(value: string, maxLines = 6, maxChars = 400): string {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(0, maxLines);
  const joined = lines.join("\n");
  return joined.length <= maxChars ? joined : `${joined.slice(0, maxChars - 1).trimEnd()}…`;
}

function countDiffStats(value: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const line of value.split(/\r?\n/u)) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      add += 1;
    } else if (line.startsWith("-")) {
      del += 1;
    }
  }
  return { add, del };
}

function toolArgSummary(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "";
  }
  const record = input as Record<string, unknown>;
  const preferred = firstString(
    record.file_path,
    record.path,
    record.command,
    record.pattern,
    record.query,
    record.glob,
    record.prompt,
    record.description,
  );
  if (preferred) {
    return preferred;
  }
  try {
    return JSON.stringify(record);
  } catch {
    return "";
  }
}

function normalizeToolName(toolName: string): string {
  switch (toolName.trim().toLowerCase()) {
    case "read":
    case "view":
      return "read";
    case "grep":
    case "glob":
    case "search":
      return "grep";
    case "edit":
    case "multiedit":
      return "edit";
    case "write":
      return "write";
    case "bash":
      return "bash";
    case "agent":
      return "agent";
    default:
      return toolName.trim().toLowerCase() || "tool";
  }
}

function fileStatePriority(state: ObserveFile["state"]): number {
  switch (state) {
    case "created":
      return 3;
    case "modified":
      return 2;
    case "read":
      return 1;
  }
}

function addTouchedFile(
  files: Map<string, ObserveFile>,
  path: string,
  state: ObserveFile["state"],
  lastT: number,
): void {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return;
  }
  const existing = files.get(normalizedPath);
  if (!existing) {
    files.set(normalizedPath, {
      path: normalizedPath,
      state,
      touches: 1,
      lastT,
    });
    return;
  }

  existing.touches += 1;
  existing.lastT = Math.max(existing.lastT, lastT);
  if (fileStatePriority(state) > fileStatePriority(existing.state)) {
    existing.state = state;
  }
}

function detectFileTouches(
  block: Block,
  t: number,
  files: Map<string, ObserveFile>,
): void {
  if (block.type !== "action") {
    return;
  }

  const { action } = block;
  if (action.kind === "file_change" && action.path.trim()) {
    addTouchedFile(files, action.path, "modified", t);
    return;
  }

  if (action.kind !== "tool_call") {
    return;
  }

  const toolName = normalizeToolName(action.toolName);
  const input = action.input as Record<string, unknown> | undefined;
  const path = firstString(input?.file_path, input?.path);
  if (!path) {
    return;
  }

  if (toolName === "read" || toolName === "grep") {
    addTouchedFile(files, path, "read", t);
    return;
  }

  if (toolName === "write") {
    addTouchedFile(files, path, "created", t);
    return;
  }

  if (toolName === "edit") {
    addTouchedFile(files, path, "modified", t);
  }
}

function buildTimingLookup(
  snapshot: SessionState,
  timedEvents: TimestampedPairingEvent[],
): {
  baseTimestampMs: number;
  bootTimestampMs: number;
  turnStartedAtMs: Map<string, number>;
  turnEndedAtMs: Map<string, number>;
  blockStartedAtMs: Map<string, number>;
  questionAnsweredAtMs: Map<string, number>;
} {
  const turnStartedAtMs = new Map<string, number>();
  const turnEndedAtMs = new Map<string, number>();
  const blockStartedAtMs = new Map<string, number>();
  const questionAnsweredAtMs = new Map<string, number>();

  let bootTimestampMs = Number.POSITIVE_INFINITY;

  for (const entry of timedEvents) {
    if (entry.event.event === "session:update") {
      bootTimestampMs = Math.min(bootTimestampMs, entry.timestamp);
      continue;
    }
    if (entry.event.event === "turn:start") {
      turnStartedAtMs.set(entry.event.turn.id, entry.timestamp);
      bootTimestampMs = Math.min(bootTimestampMs, entry.timestamp);
      continue;
    }
    if (entry.event.event === "turn:end" || entry.event.event === "turn:error") {
      turnEndedAtMs.set(entry.event.turnId, entry.timestamp);
      continue;
    }
    if (entry.event.event === "block:start") {
      blockStartedAtMs.set(entry.event.block.id, entry.timestamp);
      continue;
    }
    if (entry.event.event === "block:question:answer") {
      questionAnsweredAtMs.set(entry.event.blockId, entry.timestamp);
    }
  }

  for (const turn of snapshot.turns) {
    if (!turnStartedAtMs.has(turn.id) && Number.isFinite(turn.startedAt)) {
      turnStartedAtMs.set(turn.id, turn.startedAt);
    }
    if (!turnEndedAtMs.has(turn.id) && Number.isFinite(turn.endedAt ?? NaN)) {
      turnEndedAtMs.set(turn.id, turn.endedAt!);
    }
    bootTimestampMs = Math.min(bootTimestampMs, turnStartedAtMs.get(turn.id) ?? Number.POSITIVE_INFINITY);
  }

  if (!Number.isFinite(bootTimestampMs)) {
    bootTimestampMs = Date.now();
  }

  return {
    baseTimestampMs: bootTimestampMs,
    bootTimestampMs,
    turnStartedAtMs,
    turnEndedAtMs,
    blockStartedAtMs,
    questionAnsweredAtMs,
  };
}

function blockTimestampMs(
  turnId: string,
  block: Block,
  turnBlockCount: number,
  timing: ReturnType<typeof buildTimingLookup>,
): number {
  const explicit = timing.blockStartedAtMs.get(block.id);
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }

  const turnStart = timing.turnStartedAtMs.get(turnId) ?? timing.baseTimestampMs;
  const turnEnd = timing.turnEndedAtMs.get(turnId)
    ?? (turnStart + Math.max(3_000, turnBlockCount * 2_000));
  const duration = Math.max(1_000, turnEnd - turnStart);
  const step = duration / Math.max(1, turnBlockCount + 1);
  return Math.round(turnStart + step * (block.index + 1));
}

function timelineSeconds(values: number[], baseTimestampMs: number): number[] {
  let last = 0;
  return values.map((timestamp) => {
    const seconds = Math.max(0, Math.round((timestamp - baseTimestampMs) / 1000));
    last = Math.max(last, seconds);
    return last;
  });
}

function syntheticContextUsage(eventCount: number): number[] {
  if (eventCount <= 0) {
    return [];
  }
  const length = Math.max(2, Math.min(eventCount, 24));
  return Array.from({ length }, (_, index) => {
    const progress = length <= 1 ? 1 : index / (length - 1);
    return Math.min(0.92, 0.08 + progress * 0.66);
  });
}

export function buildObserveDataFromSnapshot(
  snapshot: SessionState,
  timedEvents: TimestampedPairingEvent[] = [],
  live = false,
): ObserveData {
  const timing = buildTimingLookup(snapshot, timedEvents);
  const files = new Map<string, ObserveFile>();
  const eventDrafts: Array<{
    timestampMs: number;
    block?: Block;
    build: (t: number) => ObserveEvent;
  }> = [
    {
      timestampMs: timing.bootTimestampMs,
      build: (t) => ({
      id: `${snapshot.session.id}:boot`,
      t,
      kind: "boot",
      text: `Session started · ${snapshot.session.model ?? snapshot.session.adapterType}`,
      detail: [
        snapshot.session.cwd ? `workspace: ${snapshot.session.cwd}` : null,
        `turns: ${snapshot.turns.length}`,
        `status: ${snapshot.session.status}`,
      ].filter(Boolean).join(" · "),
      }),
    },
  ];

  for (const turn of snapshot.turns) {
    const turnBlockCount = turn.blocks.length;
    for (const blockState of turn.blocks) {
      const { block } = blockState;
      const timestampMs = blockTimestampMs(turn.id, block, turnBlockCount, timing);
      eventDrafts.push({
        timestampMs,
        block,
        build: (t) => {
        switch (block.type) {
          case "reasoning":
            return {
              id: block.id,
              t,
              kind: "think",
              text: block.text.trim(),
              live: live && snapshot.currentTurnId === turn.id && blockState.status === "streaming",
            };
          case "text":
            return {
              id: block.id,
              t,
              kind: "message",
              text: block.text.trim(),
              to: "human",
            };
          case "question": {
            const answeredAt = timing.questionAnsweredAtMs.get(block.id);
            return {
              id: block.id,
              t,
              kind: "ask",
              text: block.question.trim(),
              to: "human",
              answer: block.answer?.join(", "),
              answerT: answeredAt
                ? Math.max(t, Math.round((answeredAt - timing.baseTimestampMs) / 1000))
                : undefined,
            };
          }
          case "error":
            return {
              id: block.id,
              t,
              kind: "system",
              text: block.message,
              detail: block.code,
            };
          case "file":
            return {
              id: block.id,
              t,
              kind: "note",
              text: block.name ? `Generated file ${block.name}` : "Generated file artifact",
            };
          case "action": {
            if (block.action.kind === "command") {
              return {
                id: block.id,
                t,
                kind: "tool",
                text: "",
                tool: "bash",
                arg: block.action.command,
                stream: summarizeCommandOutput(block.action.output),
              };
            }
            if (block.action.kind === "file_change") {
              const diffBody = block.action.diff?.trim() || block.action.output.trim();
              const diff = diffBody
                ? {
                    ...countDiffStats(diffBody),
                    preview: truncatePreview(diffBody),
                  }
                : undefined;
              return {
                id: block.id,
                t,
                kind: "tool",
                text: "",
                tool: block.action.path ? "edit" : "write",
                arg: block.action.path,
                ...(diff ? { diff } : {}),
              };
            }
            if (block.action.kind === "subagent") {
              return {
                id: block.id,
                t,
                kind: "tool",
                text: "",
                tool: "agent",
                arg: block.action.agentName ?? block.action.agentId,
                stream: summarizeCommandOutput(block.action.output),
              };
            }

            return {
              id: block.id,
              t,
              kind: "tool",
              text: "",
              tool: normalizeToolName(block.action.toolName),
              arg: toolArgSummary(block.action.input),
              stream: summarizeCommandOutput(block.action.output),
            };
          }
        }
        },
      });
    }
  }

  const seconds = timelineSeconds(
    eventDrafts.map((draft) => draft.timestampMs),
    timing.baseTimestampMs,
  );
  const builtEntries = eventDrafts
    .map((draft, index) => ({
      draft,
      event: draft.build(seconds[index] ?? 0),
    }))
    .filter(({ event }) => event.text.length > 0 || event.kind === "tool" || event.kind === "boot");
  const events = builtEntries.map((entry) => entry.event);

  for (const { draft, event } of builtEntries) {
    if (draft.block) {
      detectFileTouches(draft.block, event.t, files);
    }
  }

  return {
    events,
    files: [...files.values()].sort((left, right) => right.lastT - left.lastT || left.path.localeCompare(right.path)),
    contextUsage: syntheticContextUsage(events.length),
    live,
    metadata: buildObserveMetadata(snapshot),
  };
}

function unavailableObserveData(agent: WebAgent): ObserveData {
  return {
    events: [
      {
        id: `${agent.id}:unavailable`,
        t: 0,
        kind: "system",
        text: "No session trace is available for this agent yet.",
        detail: agent.harness
          ? `${agent.harness} · waiting for a live session or a readable history file`
          : "waiting for a live session or a readable history file",
      },
    ],
    files: [],
    contextUsage: [],
    live: false,
  };
}

async function resolveSnapshotSource(
  agent: WebAgent,
  broker: ObserveBrokerContext,
): Promise<SnapshotSource> {
  const endpoint = broker ? activeEndpoint(broker.snapshot, agent.id) : null;
  const liveSnapshot = await readLiveSnapshot(endpoint);
  const live = Boolean(
    liveSnapshot
    && (liveSnapshot.currentTurnId || liveSnapshot.session.status === "active"),
  );

  const historyCandidate = resolveHistoryCandidate(agent, liveSnapshot);
  const historySnapshot = readHistorySnapshot(historyCandidate);
  if (historySnapshot) {
    return {
      source: "history",
      historyPath: historySnapshot.historyPath,
      snapshot: historySnapshot.snapshot,
      timedEvents: historySnapshot.timedEvents,
      live,
      sessionId: liveSnapshot?.session.id ?? endpoint?.sessionId ?? null,
    };
  }

  if (liveSnapshot) {
    return {
      source: "live",
      historyPath: historyCandidate?.path ?? null,
      snapshot: liveSnapshot,
      timedEvents: [],
      live,
      sessionId: liveSnapshot.session.id,
    };
  }

  const agentHistorySnapshot = readHistorySnapshot(resolveHistoryCandidate(agent, null));
  if (agentHistorySnapshot) {
    return {
      source: "history",
      historyPath: agentHistorySnapshot.historyPath,
      snapshot: agentHistorySnapshot.snapshot,
      timedEvents: agentHistorySnapshot.timedEvents,
      live: false,
      sessionId: null,
    };
  }

  return {
    source: "unavailable",
    historyPath: null,
    live: false,
    sessionId: null,
  };
}

async function buildAgentObservePayload(
  agent: WebAgent,
  broker: ObserveBrokerContext,
): Promise<AgentObservePayload> {
  const source = await resolveSnapshotSource(agent, broker);
  if (source.source === "unavailable") {
    return {
      agentId: agent.id,
      source: "unavailable",
      fidelity: "synthetic",
      historyPath: null,
      sessionId: null,
      updatedAt: Date.now(),
      data: unavailableObserveData(agent),
    };
  }

  const fidelity = source.timedEvents.length > 0 ? "timestamped" : "synthetic";
  return {
    agentId: agent.id,
    source: source.source,
    fidelity,
    historyPath: source.historyPath,
    sessionId: source.sessionId,
    updatedAt: Date.now(),
    data: buildObserveDataFromSnapshot(source.snapshot, source.timedEvents, source.live),
  };
}

async function loadAgentObservePayloadsInternal(
  agentIds?: string[],
): Promise<AgentObservePayload[]> {
  const agents = queryAgents(200);
  const filteredAgents = agentIds && agentIds.length > 0
    ? agents.filter((agent) => agentIds.includes(agent.id))
    : agents;
  if (filteredAgents.length === 0) {
    return [];
  }

  const broker = await loadScoutBrokerContext();
  return await Promise.all(filteredAgents.map((agent) => buildAgentObservePayload(agent, broker)));
}

function summarizeAgentObservePayload(
  payload: AgentObservePayload,
): AgentObservePayload {
  return {
    ...payload,
    data: {
      ...payload.data,
      events: payload.data.events.slice(-OBSERVE_SUMMARY_TAIL_SIZE),
      files: [],
    },
  };
}

export async function loadAgentObserveSummaries(
  agentIds?: string[],
): Promise<AgentObservePayload[]> {
  const payloads = await loadAgentObservePayloadsInternal(agentIds);
  return payloads.map(summarizeAgentObservePayload);
}

export async function loadAgentObservePayload(
  agentId: string,
): Promise<AgentObservePayload | null> {
  const payloads = await loadAgentObservePayloadsInternal([agentId]);
  return payloads[0] ?? null;
}
