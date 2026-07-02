import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  OBSERVED_HARNESS_TOPOLOGY_META_KEY,
  createHistorySessionSnapshot,
  supportsHistorySessionSnapshotForPath,
  type ObservedHarnessTopology,
  type Block,
  type HistorySessionEvent,
  type PairingEvent,
  type SessionState,
} from "@openscout/agent-sessions";
import {
  getLocalAgentEndpointSessionSnapshot,
  getLocalAgentSessionSnapshot,
} from "@openscout/runtime/local-agents";
import { getTailDiscovery, readTailEventsForSession } from "@openscout/runtime/tail";
import type { AgentEndpoint } from "@openscout/protocol";

import type { WebAgent } from "../../db-queries.ts";
import { queryAgents } from "../../db-queries.ts";
import { getScoutWebPairingSessionSnapshot } from "../../pairing.ts";
import {
  endpointMetadataRecord,
  endpointSessionAliases,
  selectPreferredAgentEndpoint,
} from "../agent-endpoints.ts";
import { loadScoutBrokerContext } from "../broker/service.ts";
import { buildObserveDataFromTail } from "./tail-observe.ts";

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
  at?: number;
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
  contextInputTokens?: number;
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
  sessionStart?: number;
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
  adapterType: "claude-code" | "codex" | "pi";
  mtimeMs: number;
  size: number;
};

const HISTORY_SNAPSHOT_CACHE_LIMIT = 128;
const historySnapshotCache = new Map<string, HistorySnapshotCacheEntry>();
const OBSERVE_SUMMARY_TAIL_SIZE = 8;
const SESSION_REF_LOOKUP_TTL_MS = 10_000;

type SessionRefLookupEntry = {
  refId: string;
  historyPath: string;
  adapterType: "claude-code" | "codex" | "pi";
  mtimeMs: number;
  size: number;
};

type SessionRefLookupCache = {
  generatedAt: number;
  entries: Map<string, SessionRefLookupEntry>;
};

let sessionRefLookupCache: SessionRefLookupCache | null = null;

export type SessionRefObservePayload =
  | {
      kind: "agent";
      refId: string;
      agentId: string;
      source: AgentObservePayload["source"];
      fidelity: AgentObservePayload["fidelity"];
      historyPath: string | null;
      sessionId: string | null;
      updatedAt: number;
      data: ObserveData;
    }
  | {
      kind: "history";
      refId: string;
      agentId: null;
      source: "history";
      fidelity: "timestamped" | "synthetic";
      historyPath: string;
      sessionId: string;
      updatedAt: number;
      data: ObserveData;
    }
  | {
      kind: "tail";
      refId: string;
      agentId: null;
      source: "tail";
      fidelity: "synthetic";
      historyPath: string;
      sessionId: string;
      updatedAt: number;
      data: ObserveData;
    }
  | {
      kind: "broker";
      refId: string;
      agentId: null;
      source: "broker";
      fidelity: "synthetic";
      historyPath: null;
      sessionId: string;
      updatedAt: number;
      data: ObserveData;
    };

function normalizedComparableString(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizedSessionAlias(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

function normalizedFilesystemPath(value: string | null | undefined): string | null {
  const expanded = expandHome(value)?.trim();
  return expanded ? resolve(expanded) : null;
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

function claudeProjectsRoot(): string {
  return process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT?.trim()
    || join(homedir(), ".claude", "projects");
}

function resolveClaudeHistoryPath(
  cwd: string | null | undefined,
  sessionId: string | null | undefined,
  options: { allowMostRecentFallback?: boolean } = {},
): string | null {
  const normalizedCwd = expandHome(cwd)?.trim();
  if (!normalizedCwd) {
    return null;
  }
  const projectDir = join(
    claudeProjectsRoot(),
    encodeClaudeProjectsSlug(normalizedCwd),
  );
  const normalizedSessionId = sessionId?.trim().replace(/\.jsonl$/u, "") || "";
  if (normalizedSessionId) {
    const exactPath = join(projectDir, `${normalizedSessionId}.jsonl`);
    if (existsSync(exactPath)) {
      return exactPath;
    }
  }
  if (options.allowMostRecentFallback === false) {
    return null;
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

function normalizeSessionRefId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const leaf = basename(trimmed);
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

function addSessionRefLookupEntry(
  entries: Map<string, SessionRefLookupEntry>,
  entry: SessionRefLookupEntry,
): void {
  const current = entries.get(entry.refId);
  if (!current || entry.mtimeMs > current.mtimeMs) {
    entries.set(entry.refId, entry);
  }
}

function buildClaudeSessionRefLookup(): Map<string, SessionRefLookupEntry> {
  const entries = new Map<string, SessionRefLookupEntry>();
  const projectsRoot = claudeProjectsRoot();
  if (!existsSync(projectsRoot)) {
    return entries;
  }

  try {
    for (const projectEntry of readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) {
        continue;
      }
      const projectDir = join(projectsRoot, projectEntry.name);
      for (const historyEntry of readdirSync(projectDir, { withFileTypes: true })) {
        if (!historyEntry.isFile() || !historyEntry.name.endsWith(".jsonl")) {
          continue;
        }
        const refId = normalizeSessionRefId(historyEntry.name);
        if (!refId) {
          continue;
        }
        const historyPath = join(projectDir, historyEntry.name);
        const stat = statSync(historyPath);
        addSessionRefLookupEntry(entries, {
          refId,
          historyPath,
          adapterType: "claude-code",
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      }
    }
  } catch {
    return entries;
  }

  return entries;
}

function sessionRefLookup(): Map<string, SessionRefLookupEntry> {
  const now = Date.now();
  if (
    sessionRefLookupCache
    && now - sessionRefLookupCache.generatedAt < SESSION_REF_LOOKUP_TTL_MS
  ) {
    return sessionRefLookupCache.entries;
  }
  const entries = buildClaudeSessionRefLookup();
  sessionRefLookupCache = { generatedAt: now, entries };
  return entries;
}

function adapterTypeFromTailSource(source: string): "claude-code" | "codex" | "pi" | null {
  const normalized = source.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code") {
    return "claude-code";
  }
  if (normalized === "codex") {
    return "codex";
  }
  if (normalized === "pi" || normalized === "pi_rpc") {
    return "pi";
  }
  return null;
}

async function findTailSessionRefLookupEntry(
  normalizedRef: string,
): Promise<SessionRefLookupEntry | null> {
  const discovery = await getTailDiscovery().catch(() => null);
  if (!discovery?.transcripts.length) {
    return null;
  }

  for (const transcript of discovery.transcripts) {
    const adapterType = adapterTypeFromTailSource(transcript.source);
    if (!adapterType || !supportsHistorySessionSnapshotForPath(transcript.transcriptPath, adapterType)) {
      continue;
    }
    const refs = [
      normalizeSessionRefId(transcript.sessionId),
      normalizeSessionRefId(transcript.transcriptPath),
    ].filter((ref): ref is string => Boolean(ref));
    if (!refs.includes(normalizedRef)) {
      continue;
    }
    return {
      refId: normalizedRef,
      historyPath: transcript.transcriptPath,
      adapterType,
      mtimeMs: transcript.mtimeMs,
      size: transcript.size,
    };
  }

  return null;
}

function historyAdapterAlias(
  value: string | null | undefined,
): "claude-code" | "codex" | "pi" | null {
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
  if (normalized === "pi" || normalized === "pi_rpc") {
    return "pi";
  }
  return null;
}

function historyAdapterForEndpoint(
  endpoint: AgentEndpoint | null | undefined,
): "claude-code" | "codex" | "pi" | null {
  return historyAdapterAlias(endpoint?.harness) ?? historyAdapterAlias(endpoint?.transport);
}

function historyAdapterForAgent(
  agent: WebAgent,
): "claude-code" | "codex" | "pi" | null {
  return historyAdapterAlias(agent.harness) ?? historyAdapterAlias(agent.transport);
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

function buildObserveMetadata(
  snapshot: SessionState,
  sessionStart?: number,
): ObserveMetadata | undefined {
  const providerMeta = snapshotProviderMeta(snapshot);
  const observeRuntime = metadataRecord(providerMeta, "observeRuntime");
  const observeUsage = metadataRecord(providerMeta, "observeUsage");

  const sessionMeta: ObserveSessionMeta = {};
  if (snapshot.session.adapterType) sessionMeta.adapterType = snapshot.session.adapterType;
  if (snapshot.session.model) sessionMeta.model = snapshot.session.model;
  if (snapshot.session.cwd) sessionMeta.cwd = snapshot.session.cwd;
  if (typeof sessionStart === "number" && Number.isFinite(sessionStart)) {
    sessionMeta.sessionStart = sessionStart;
  }
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
  if (metadataNumber(observeUsage, "contextInputTokens") !== undefined) {
    usageMeta.contextInputTokens = metadataNumber(observeUsage, "contextInputTokens");
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

  const observedTopology =
    metadataRecord(providerMeta, OBSERVED_HARNESS_TOPOLOGY_META_KEY) as ObservedHarnessTopology | undefined;
  const hasSessionMeta = Object.keys(sessionMeta).length > 0;
  const hasUsageMeta = Object.keys(usageMeta).length > 0;
  if (!hasSessionMeta && !hasUsageMeta && !observedTopology) {
    return undefined;
  }

  return {
    ...(hasSessionMeta ? { session: sessionMeta } : {}),
    ...(hasUsageMeta ? { usage: usageMeta } : {}),
    ...(observedTopology ? { topology: observedTopology } : {}),
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

function directRuntimeEndpointRequiresSessionMatch(
  endpoint: AgentEndpoint | null | undefined,
): boolean {
  if (!endpoint) {
    return false;
  }
  const endpointMeta = endpointMetadataRecord(endpoint);
  const runtimeMode = metadataString(endpointMeta, "runtimeMode")?.toLowerCase();
  const transport = normalizedComparableString(endpoint.transport);
  return runtimeMode === "direct_session"
    || transport === "codex_app_server"
    || transport === "claude_stream_json"
    || transport === "pi_rpc";
}

function historyPathSessionId(path: string): string | null {
  const name = basename(path).trim();
  if (!name) {
    return null;
  }
  return name.replace(/\.(jsonl|json)$/u, "") || null;
}

function historySnapshotSessionId(history: HistorySnapshotResult): string | null {
  const providerMeta = snapshotProviderMeta(history.snapshot);
  const snapshotSessionId = history.snapshot.session.id?.startsWith("history:")
    ? null
    : history.snapshot.session.id;
  return firstString(
    providerMeta.externalSessionId,
    providerMeta.threadId,
    providerMeta.transportSessionId,
    providerMeta.nativeSessionId,
    snapshotSessionId,
    historyPathSessionId(history.historyPath),
  );
}

function resolveHistoryCandidate(
  agent: WebAgent,
  snapshot: SessionState | null,
  endpoint?: AgentEndpoint | null,
  options: AgentObserveOptions = {},
): { path: string; adapterType: "claude-code" | "codex" | "pi" } | null {
  const snapshotAdapter = historyAdapterAlias(snapshot?.session.adapterType);
  const endpointAdapter = historyAdapterForEndpoint(endpoint);
  const agentAdapter = historyAdapterForAgent(agent);
  const providerMeta = snapshot ? snapshotProviderMeta(snapshot) : {};
  const endpointMeta = endpointMetadataRecord(endpoint);
  const requireSessionMatch = directRuntimeEndpointRequiresSessionMatch(endpoint);
  const allowCwdHistoryFallback = options.allowCwdHistoryFallback !== false;

  const directPath = firstString(
    providerMeta.resumeSessionPath,
    providerMeta.threadPath,
    endpointMeta.threadPath,
  );
  if (directPath) {
    const adapterType = snapshotAdapter ?? endpointAdapter ?? agentAdapter;
    if (adapterType) {
      return { path: directPath, adapterType };
    }
  }

  const claudeSessionId = firstString(
    providerMeta.transportSessionId,
    providerMeta.externalSessionId,
    providerMeta.threadId,
    providerMeta.nativeSessionId,
    endpoint?.sessionId,
    endpointMeta.sessionId,
    endpointMeta.runtimeSessionId,
    endpointMeta.runtimeInstanceId,
    endpointMeta.threadId,
    endpointMeta.externalSessionId,
    endpointMeta.nativeSessionId,
    agent.harnessSessionId,
  );
  const claudeCwd = firstString(
    snapshot?.session.cwd,
    agent.cwd,
    agent.projectRoot,
  );
  if ((snapshotAdapter ?? endpointAdapter ?? agentAdapter) === "claude-code") {
    const path = resolveClaudeHistoryPath(claudeCwd, claudeSessionId, {
      allowMostRecentFallback: !requireSessionMatch && allowCwdHistoryFallback,
    });
    if (path) {
      return { path, adapterType: "claude-code" };
    }
  }

  return null;
}

function collectSessionRefs(
  agent: WebAgent,
  snapshot: SessionState | null,
  endpoint: AgentEndpoint | null | undefined,
): Set<string> {
  const providerMeta = snapshot ? snapshotProviderMeta(snapshot) : {};
  const refs = new Set([
    snapshot?.session.id,
    providerMeta.transportSessionId,
    providerMeta.externalSessionId,
    providerMeta.threadId,
    providerMeta.nativeSessionId,
    agent.harnessSessionId,
  ].map(normalizedSessionAlias).filter((ref): ref is string => Boolean(ref)));
  if (endpoint) {
    for (const alias of endpointSessionAliases(endpoint)) {
      refs.add(alias);
    }
  }
  return refs;
}

function collectAgentCwdRefs(agent: WebAgent, snapshot: SessionState | null, endpoint: AgentEndpoint | null | undefined): Set<string> {
  return new Set([
    normalizedFilesystemPath(snapshot?.session.cwd),
    normalizedFilesystemPath(endpoint?.cwd),
    normalizedFilesystemPath(endpoint?.projectRoot),
    normalizedFilesystemPath(agent.cwd),
    normalizedFilesystemPath(agent.projectRoot),
  ].filter((path): path is string => Boolean(path)));
}

function setsIntersect<T>(left: Set<T>, right: Set<T>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function allowsCwdHistoryFallback(agent: WebAgent, agents: WebAgent[]): boolean {
  const adapterType = historyAdapterForAgent(agent);
  if (!adapterType) {
    return false;
  }

  const cwdRefs = collectAgentCwdRefs(agent, null, null);
  if (cwdRefs.size === 0) {
    return false;
  }

  return !agents.some((candidate) => {
    if (candidate.id === agent.id) {
      return false;
    }
    if (historyAdapterForAgent(candidate) !== adapterType) {
      return false;
    }
    return setsIntersect(cwdRefs, collectAgentCwdRefs(candidate, null, null));
  });
}

async function resolveDiscoveredHistoryCandidate(
  agent: WebAgent,
  snapshot: SessionState | null,
  endpoint?: AgentEndpoint | null,
  options: AgentObserveOptions = {},
): Promise<{ path: string; adapterType: "claude-code" | "codex" | "pi" } | null> {
  const adapterType = historyAdapterAlias(snapshot?.session.adapterType)
    ?? historyAdapterForEndpoint(endpoint)
    ?? historyAdapterForAgent(agent);
  if (!adapterType) {
    return null;
  }

  const discovery = await getTailDiscovery().catch(() => null);
  if (!discovery?.transcripts.length) {
    return null;
  }

  const sessionRefs = collectSessionRefs(agent, snapshot, endpoint);
  const cwdRefs = collectAgentCwdRefs(agent, snapshot, endpoint);
  const agentProject = normalizedComparableString(agent.project);
  const requireSessionMatch = directRuntimeEndpointRequiresSessionMatch(endpoint);
  const allowCwdHistoryFallback = options.allowCwdHistoryFallback !== false;
  const candidates = discovery.transcripts
    .filter((transcript) => adapterTypeFromTailSource(transcript.source) === adapterType)
    .map((transcript) => {
      const sessionMatch = Boolean(transcript.sessionId && sessionRefs.has(transcript.sessionId.trim().toLowerCase()));
      const cwd = normalizedFilesystemPath(transcript.cwd);
      const cwdMatch = Boolean(cwd && cwdRefs.has(cwd));
      const projectMatch = Boolean(
        agentProject
        && normalizedComparableString(transcript.project) === agentProject
        && cwdRefs.size > 0,
      );
      return {
        transcript,
        sessionMatch,
        cwdMatch,
        projectMatch,
      };
    })
    .filter(({ sessionMatch, cwdMatch, projectMatch }) => (
      sessionMatch || (!requireSessionMatch && allowCwdHistoryFallback && (cwdMatch || projectMatch))
    ))
    .sort((left, right) => {
      const leftTuple = [
        left.sessionMatch ? 0 : 1,
        left.cwdMatch ? 0 : 1,
        left.projectMatch ? 0 : 1,
        -left.transcript.mtimeMs,
        -left.transcript.size,
      ];
      const rightTuple = [
        right.sessionMatch ? 0 : 1,
        right.cwdMatch ? 0 : 1,
        right.projectMatch ? 0 : 1,
        -right.transcript.mtimeMs,
        -right.transcript.size,
      ];
      for (let index = 0; index < leftTuple.length; index += 1) {
        const leftValue = leftTuple[index]!;
        const rightValue = rightTuple[index]!;
        if (leftValue < rightValue) {
          return -1;
        }
        if (leftValue > rightValue) {
          return 1;
        }
      }
      return left.transcript.transcriptPath.localeCompare(right.transcript.transcriptPath);
    });

  for (const { transcript } of candidates) {
    if (supportsHistorySessionSnapshotForPath(transcript.transcriptPath, adapterType)) {
      return { path: transcript.transcriptPath, adapterType };
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
  candidate: { path: string; adapterType: "claude-code" | "codex" | "pi" } | null,
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
  if (replay.events.length === 0) {
    return null;
  }

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

async function readLiveSnapshot(agent: WebAgent, endpoint: AgentEndpoint | null): Promise<SessionState | null> {
  const configuredSnapshot = await getLocalAgentSessionSnapshot(agent.id).catch(() => null);
  if (configuredSnapshot) {
    return configuredSnapshot;
  }

  if (!endpoint?.sessionId) {
    return null;
  }
  if (endpoint.transport === "pairing_bridge") {
    return await getScoutWebPairingSessionSnapshot(endpoint.sessionId);
  }
  if (endpoint.transport === "codex_app_server" || endpoint.transport === "claude_stream_json" || endpoint.transport === "pi_rpc") {
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
      event: {
        ...draft.build(seconds[index] ?? 0),
        at: draft.timestampMs,
      },
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
    metadata: buildObserveMetadata(snapshot, timing.baseTimestampMs),
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

function isLiveSessionSnapshot(snapshot: SessionState | null | undefined): boolean {
  return Boolean(
    snapshot
    && (
      snapshot.currentTurnId
      || snapshot.session.status === "active"
      || snapshot.turns.some((turn) => (
        turn.status === "streaming"
        || turn.blocks.some((block) => block.status === "streaming")
      ))
    ),
  );
}

type AgentObserveOptions = {
  sessionId?: string | null;
  allowCwdHistoryFallback?: boolean;
};

async function resolveSnapshotSource(
  agent: WebAgent,
  broker: ObserveBrokerContext,
  options: AgentObserveOptions = {},
): Promise<SnapshotSource> {
  const endpoint = broker ? selectPreferredAgentEndpoint(broker.snapshot, agent.id, {
    harness: agent.harness,
    transport: agent.transport,
    sessionId: options.sessionId ?? agent.harnessSessionId,
    cwd: agent.cwd,
    projectRoot: agent.projectRoot,
  }) : null;
  const liveSnapshot = await readLiveSnapshot(agent, endpoint);
  const live = isLiveSessionSnapshot(liveSnapshot);

  let historyCandidate = resolveHistoryCandidate(agent, liveSnapshot, endpoint, options);
  let historySnapshot = readHistorySnapshot(historyCandidate);
  if (!historySnapshot) {
    const discoveredCandidate = await resolveDiscoveredHistoryCandidate(agent, liveSnapshot, endpoint, options);
    const discoveredSnapshot = readHistorySnapshot(discoveredCandidate);
    if (discoveredSnapshot) {
      historyCandidate = discoveredCandidate;
      historySnapshot = discoveredSnapshot;
    }
  }
  if (historySnapshot) {
    const historySessionId = historySnapshotSessionId(historySnapshot);
    return {
      source: "history",
      historyPath: historySnapshot.historyPath,
      snapshot: historySnapshot.snapshot,
      timedEvents: historySnapshot.timedEvents,
      live: live || isLiveSessionSnapshot(historySnapshot.snapshot),
      sessionId: liveSnapshot?.session.id ?? historySessionId ?? endpoint?.sessionId ?? null,
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

  let agentHistoryCandidate = resolveHistoryCandidate(agent, null, endpoint, options);
  let agentHistorySnapshot = readHistorySnapshot(agentHistoryCandidate);
  if (!agentHistorySnapshot) {
    const discoveredCandidate = await resolveDiscoveredHistoryCandidate(agent, null, endpoint, options);
    const discoveredSnapshot = readHistorySnapshot(discoveredCandidate);
    if (discoveredSnapshot) {
      agentHistoryCandidate = discoveredCandidate;
      agentHistorySnapshot = discoveredSnapshot;
    }
  }
  if (agentHistorySnapshot) {
    const historySessionId = historySnapshotSessionId(agentHistorySnapshot);
    return {
      source: "history",
      historyPath: agentHistorySnapshot.historyPath,
      snapshot: agentHistorySnapshot.snapshot,
      timedEvents: agentHistorySnapshot.timedEvents,
      live: false,
      sessionId: historySessionId ?? endpoint?.sessionId ?? null,
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
  options: AgentObserveOptions = {},
): Promise<AgentObservePayload> {
  const source = await resolveSnapshotSource(agent, broker, options);
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
  options: AgentObserveOptions = {},
): Promise<AgentObservePayload[]> {
  const agents = queryAgents(200);
  const filteredAgents = agentIds && agentIds.length > 0
    ? agents.filter((agent) => agentIds.includes(agent.id))
    : agents;
  if (filteredAgents.length === 0) {
    return [];
  }

  const broker = await loadScoutBrokerContext();
  return await Promise.all(filteredAgents.map((agent) => buildAgentObservePayload(agent, broker, {
    ...options,
    allowCwdHistoryFallback:
      options.allowCwdHistoryFallback
      ?? (!options.sessionId && allowsCwdHistoryFallback(agent, agents)),
  })));
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
  options: AgentObserveOptions = {},
): Promise<AgentObservePayload | null> {
  const payloads = await loadAgentObservePayloadsInternal([agentId], options);
  return payloads[0] ?? null;
}

function endpointRefAliases(endpoint: AgentEndpoint): string[] {
  const metadata = endpointMetadataRecord(endpoint);
  return [
    endpoint.agentId,
    endpoint.sessionId,
    metadataString(metadata, "handle"),
    metadataString(metadata, "externalSessionId"),
    metadataString(metadata, "threadId"),
    metadataString(metadata, "runtimeSessionId"),
    metadataString(metadata, "runtimeInstanceId"),
  ].filter((value): value is string => Boolean(value));
}

function brokerSessionObserveData(input: {
  refId: string;
  endpoint: AgentEndpoint;
  actorName?: string | null;
}): ObserveData {
  const metadata = endpointMetadataRecord(input.endpoint);
  const startedAt = Number(metadata.startedAt);
  const sessionStart = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Date.now();
  const handle = metadataString(metadata, "handle");
  const displayName = input.actorName?.trim() || metadataString(metadata, "displayName") || handle || input.refId;
  const externalSessionId = metadataString(metadata, "externalSessionId");
  const pending = metadata.pendingExternalSession === true && !externalSessionId;
  return {
    events: [
      {
        id: `${input.refId}:registered`,
        t: 0,
        at: sessionStart,
        kind: "boot",
        text: `Session registered - ${displayName}`,
        detail: [
          input.endpoint.harness,
          metadataString(metadata, "model"),
          input.endpoint.cwd,
        ].filter(Boolean).join(" - "),
      },
      {
        id: `${input.refId}:handoff`,
        t: 1,
        at: Date.now(),
        kind: "system",
        text: pending
          ? "Waiting for the harness to attach and emit its first turn."
          : "Harness session attached; waiting for trace events.",
        detail: externalSessionId ? `external session: ${externalSessionId}` : "broker endpoint is live",
      },
    ],
    files: [],
    contextUsage: [],
    live: true,
    metadata: {
      session: {
        adapterType: input.endpoint.harness,
        model: metadataString(metadata, "model"),
        cwd: input.endpoint.cwd ?? input.endpoint.projectRoot,
        sessionStart,
        externalSessionId,
        threadId: metadataString(metadata, "threadId"),
        source: "broker",
      },
    },
  };
}

async function loadBrokerSessionRefObservePayload(
  refId: string,
): Promise<SessionRefObservePayload | null> {
  const normalizedRef = normalizeSessionRefId(refId);
  if (!normalizedRef) {
    return null;
  }
  const broker = await loadScoutBrokerContext().catch(() => null);
  if (!broker) {
    return null;
  }
  const endpoint = Object.values(broker.snapshot.endpoints)
    .find((candidate) => endpointRefAliases(candidate)
      .map((alias) => normalizeSessionRefId(alias))
      .includes(normalizedRef));
  if (!endpoint) {
    return null;
  }
  const actor = broker.snapshot.actors[endpoint.agentId];
  return {
    kind: "broker",
    refId: normalizedRef,
    agentId: null,
    source: "broker",
    fidelity: "synthetic",
    historyPath: null,
    sessionId: endpoint.agentId,
    updatedAt: Date.now(),
    data: brokerSessionObserveData({
      refId: normalizedRef,
      endpoint,
      actorName: actor?.displayName ?? null,
    }),
  };
}

export async function loadSessionRefObservePayload(
  refId: string,
): Promise<SessionRefObservePayload | null> {
  const normalizedRef = normalizeSessionRefId(refId);
  if (!normalizedRef) {
    return null;
  }

  const matchedAgent = queryAgents(200).find(
    (agent) => normalizeSessionRefId(agent.harnessSessionId) === normalizedRef,
  );
  if (matchedAgent) {
    const payload = await loadAgentObservePayload(matchedAgent.id);
    if (payload) {
      return {
        kind: "agent",
        refId: normalizedRef,
        agentId: matchedAgent.id,
        source: payload.source,
        fidelity: payload.fidelity,
        historyPath: payload.historyPath,
        sessionId: payload.sessionId,
        updatedAt: payload.updatedAt,
        data: payload.data,
      };
    }
  }

  const brokerPayload = await loadBrokerSessionRefObservePayload(normalizedRef);
  if (brokerPayload) {
    return brokerPayload;
  }

  let historyEntry = sessionRefLookup().get(normalizedRef) ?? null;
  if (!historyEntry) {
    historyEntry = await findTailSessionRefLookupEntry(normalizedRef);
  }
  const historySnapshot = historyEntry
    ? readHistorySnapshot({
        path: historyEntry.historyPath,
        adapterType: historyEntry.adapterType,
      })
    : null;
  if (historyEntry && historySnapshot) {
    return {
      kind: "history",
      refId: normalizedRef,
      agentId: null,
      source: "history",
      fidelity: historySnapshot.timedEvents.length > 0 ? "timestamped" : "synthetic",
      historyPath: historySnapshot.historyPath,
      sessionId: normalizedRef,
      updatedAt: Date.now(),
      data: buildObserveDataFromSnapshot(
        historySnapshot.snapshot,
        historySnapshot.timedEvents,
        false,
      ),
    };
  }

  let nativeTail = await readTailEventsForSession(normalizedRef).catch(() => null);
  if (!nativeTail) {
    nativeTail = await readTailEventsForSession(normalizedRef, { forceDiscovery: true }).catch(() => null);
  }
  if (!nativeTail) {
    return null;
  }

  const sessionId = nativeTail.transcript.sessionId?.trim() || normalizedRef;
  const current = Date.now() - nativeTail.transcript.mtimeMs <= 5 * 60_000;
  return {
    kind: "tail",
    refId: normalizedRef,
    agentId: null,
    source: "tail",
    fidelity: "synthetic",
    historyPath: nativeTail.transcript.transcriptPath,
    sessionId,
    updatedAt: Date.now(),
    data: buildObserveDataFromTail(nativeTail.transcript, nativeTail.events, current),
  };
}
