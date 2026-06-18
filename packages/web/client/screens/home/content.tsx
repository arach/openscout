import "./fleet-home.css";
import "./activity-stream.css";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ExternalLink, Send } from "lucide-react";
import HomeHero, {
  type ServiceGauge,
} from "./HomeHero.tsx";
import { TailView } from "../shared/TailView.tsx";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import {
  compareTimestampsDesc,
  normalizeTimestampMs,
  timeAgo,
} from "../../lib/time.ts";
import { actorColor } from "../../lib/colors.ts";
import { useOptionalFlag } from "hudsonkit/flags";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { usePersistentNumber, usePersistentString } from "../../lib/persistent-state.ts";
import { useScout } from "../../scout/Provider.tsx";
import { conversationForAgent, routeMachineId } from "../../lib/router.ts";
import {
  filterAgentsByMachineScope,
  filterFleetByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import type {
  Agent,
  FleetActivity,
  FleetAsk,
  FleetState,
  Route,
  TailEvent,
} from "../../lib/types.ts";

type LookbackOption = { label: string; value: number; activityLimit: number };

// Live context for an active agent, pulled from the observe summary endpoint
// (the bulk /api/agents list doesn't carry session/model/token usage).
type ActiveAgentContext = {
  sessionId: string | null;
  model: string | null;
  contextPct: number | null;
};

type ObserveAgentSummary = {
  agentId: string;
  data?: {
    metadata?: {
      session?: {
        externalSessionId?: string | null;
        model?: string | null;
        turnCount?: number | null;
      };
      // Real token usage. `data.contextUsage` is deliberately ignored — it's a
      // synthetic ramp (syntheticContextUsage), not actual window utilization.
      usage?: {
        totalTokens?: number | null;
        contextWindowTokens?: number | null;
      };
    };
  };
};

const LOOKBACK_WINDOWS: LookbackOption[] = [
  { label: "30m", value: 30 * 60_000, activityLimit: 80 },
  { label: "6h", value: 6 * 60 * 60_000, activityLimit: 250 },
  { label: "24h", value: 24 * 60 * 60_000, activityLimit: 800 },
];
const DEFAULT_LOOKBACK_MS = LOOKBACK_WINDOWS[2].value;
const LOOKBACK_STORAGE_KEY = "openscout.home.lookbackMs.v1";
// Service-budget data (claude/codex/github usage) is expensive to compute
// and doesn't change minute-to-minute. Refresh once an hour; the server
// caches the same window. Easy to tune later if we want fresher numbers.
const SERVICE_BUDGETS_REFRESH_MS = 60 * 60_000;
const MOVING_ACTIVE_WINDOW_MS = 30 * 60_000;
const NO_RECENT_SIGNAL_INACTIVE_KEY = "openscout.home.noRecentSignalInactive.v1";
const NO_RECENT_SIGNAL_INACTIVE_LIMIT = 200;
const LOCAL_TAIL_RECENT_LIMIT = 1000;
const LOCAL_TAIL_REFRESH_MS = 30_000;
const HEARTRATE_COMBINED_EVENT_THRESHOLD = 3;

type NoRecentSignalItem = {
  agentId: string;
  agentName: string;
  updatedAtMs: number;
  summary: string;
  route: Route;
  hasAgentState: boolean;
  askCount: number;
};

function formatAge(timestamp: number | null | undefined, nowMs: number): string {
  const timestampMs = normalizeTimestampMs(timestamp);
  if (timestampMs === null) return "—";
  const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function summarize(text: string | null | undefined, max = 140): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function activityVerb(kind: string): string {
  const map: Record<string, string> = {
    handoff_sent: "handed off",
    handoff_received: "received handoff",
    flight_updated: "replied",
    ask_sent: "asked",
    ask_replied: "answered",
    message_sent: "said",
    message_received: "received",
  };
  return map[kind] ?? kind.replace(/[._]/g, " ");
}

function fleetActivityRoute(item: FleetActivity): Route | null {
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.recordId) return { view: "work", workId: item.recordId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

function formatLookback(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

type ActivityShape = {
  count: number;
  lastAgoMs: number;
  longestGapMs: number;
};

function computeActivityShape(
  items: FleetActivity[],
  lookbackMs: number,
  nowMs: number,
): ActivityShape | null {
  if (items.length === 0) return null;
  const stamps = items
    .map((it) => normalizeTimestampMs(it.ts))
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a);
  if (stamps.length === 0) return null;
  const newest = stamps[0]!;
  const oldest = stamps[stamps.length - 1]!;
  let longestGap = 0;
  for (let i = 1; i < stamps.length; i++) {
    longestGap = Math.max(longestGap, stamps[i - 1]! - stamps[i]!);
  }
  // Trailing silence: from window start to oldest visible event.
  const windowStart = nowMs - lookbackMs;
  longestGap = Math.max(longestGap, oldest - windowStart);
  return {
    count: items.length,
    lastAgoMs: Math.max(0, nowMs - newest),
    longestGapMs: Math.max(0, longestGap),
  };
}

function smoothHeartrateCounts(counts: number[]): number[] {
  const energy = counts.map((count) => Math.sqrt(count));
  const weights = [0.56, 0.28, 0.11, 0.05];

  return energy.map((_, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -3; offset <= 3; offset++) {
      const nextIndex = index + offset;
      if (nextIndex < 0 || nextIndex >= energy.length) continue;
      const weight = weights[Math.abs(offset)] ?? 0;
      total += energy[nextIndex]! * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? total / weightTotal : 0;
  });
}

function combineHeartrateWithTailEvents(
  heartrate: HeartrateBucketView[],
  tailEvents: TailEvent[],
  nowMs: number,
): HeartrateBucketView[] {
  if (heartrate.length < 2 || tailEvents.length === 0) return heartrate;

  const bucketMs = Math.max(1, heartrate[1]!.ts - heartrate[0]!.ts);
  const startMs = heartrate[0]!.ts;
  const endMs = heartrate[heartrate.length - 1]!.ts + bucketMs;
  const counts = heartrate.map((bucket) => bucket.count);

  for (const event of tailEvents) {
    const eventTs = normalizeTimestampMs(event.ts);
    if (eventTs === null || eventTs < startMs || eventTs > nowMs || eventTs >= endMs) {
      continue;
    }
    const index = Math.floor((eventTs - startMs) / bucketMs);
    if (index >= 0 && index < counts.length) {
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }

  const smoothed = smoothHeartrateCounts(counts);
  const peak = Math.max(1, ...smoothed);
  return heartrate.map((bucket, index) => ({
    ...bucket,
    count: counts[index] ?? bucket.count,
    value: (smoothed[index] ?? 0) / peak,
  }));
}

function isFreshMovingTimestamp(
  timestamp: number | null | undefined,
  nowMs: number,
): boolean {
  const timestampMs = normalizeTimestampMs(timestamp);
  return timestampMs !== null && nowMs - timestampMs <= MOVING_ACTIVE_WINDOW_MS;
}

function parseNoRecentSignalInactive(raw: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const inactive: Record<string, number> = {};
    for (const [agentId, value] of Object.entries(parsed)) {
      const timestamp = typeof value === "number" ? value : Number(value);
      if (agentId && Number.isFinite(timestamp)) {
        inactive[agentId] = timestamp;
      }
    }
    return inactive;
  } catch {
    return {};
  }
}

function encodeNoRecentSignalInactive(inactive: Record<string, number>): string {
  const trimmed = Object.entries(inactive)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .sort((a, b) => b[1] - a[1])
    .slice(0, NO_RECENT_SIGNAL_INACTIVE_LIMIT);
  return JSON.stringify(Object.fromEntries(trimmed));
}

function routeForFleetAsk(ask: FleetAsk): Route {
  if (ask.conversationId) return { view: "conversation", conversationId: ask.conversationId };
  if (ask.collaborationRecordId) return { view: "work", workId: ask.collaborationRecordId };
  return { view: "agents", agentId: ask.agentId };
}

// ── Active-agent card helpers ───────────────────────────────────────────────
function middleTruncate(value: string, max = 118): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.58);
  const tail = Math.floor((max - 1) * 0.42);
  return `${value.slice(0, head).trimEnd()}…${value.slice(value.length - tail).trimStart()}`;
}

function compactPath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("/Users/")) return `~/${path.split("/").slice(3).join("/")}`;
  return path;
}

function compactSessionId(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const withoutExtension = raw.endsWith(".jsonl") ? raw.slice(0, -".jsonl".length) : raw;
  const segment = withoutExtension.split(/[/:]/u).filter(Boolean).pop() ?? withoutExtension;
  // UUID-like ids read best as head…tail (e.g. 019e93aa…ee4f07), matching the
  // observe panel; everything else falls back to a middle truncation.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(segment)) {
    return `${segment.slice(0, 8)}…${segment.slice(-6)}`;
  }
  return middleTruncate(segment, 22);
}

function shortModelLabel(value: string | null | undefined): string | null {
  const model = value?.trim();
  if (!model) return null;
  return model
    .replace(/^claude-/iu, "")
    .replace(/^gpt-/iu, "gpt ")
    .replace(/\s*\([^)]*\)\s*/u, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contextLabelFromModel(value: string | null | undefined): string | null {
  const match = value?.match(/(\d+(?:\.\d+)?\s*[km])\s*context/iu);
  return match?.[1]?.replace(/\s+/g, "").toUpperCase() ?? null;
}

function compactNode(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  return raw.replace(/\.local$/iu, "").replace(/-local$/iu, "");
}

function handleContextCardKey(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

type WorkingCardTaskStatus = FleetAsk["status"] | "working";
type WorkingCardExecutionState = "working" | "idle" | "queued" | "delivered" | "failed";

type AgentWorkingCardData = {
  agentId: string;
  agentName: string;
  agentHandle: string | null;
  harness: string | null;
  model: string | null;
  branch: string | null;
  cwd: string | null;
  task: {
    invocationId: string | null;
    title: string;
    summary: string | null;
    openedAt: number | null;
    status: WorkingCardTaskStatus;
  };
  execution: {
    state: WorkingCardExecutionState;
    lastEventAt: number | null;
    startedAt: number | null;
  };
  checkpoint: { line: string; at: number } | null;
  reply: { state: "none" | "delivered"; deliveredAt: number | null };
};

function meaningfulCheckpoint(
  ask: FleetAsk | null | undefined,
  taskTitle: string,
): AgentWorkingCardData["checkpoint"] {
  const raw = ask?.summary?.trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, " ");
  if (!compact || compact === taskTitle) return null;
  if (/acknowledged via|queued for local execution|received the message/i.test(compact)) return null;
  const at = normalizeTimestampMs(ask?.updatedAt) ?? Date.now();
  return { line: summarize(compact, 120), at };
}

function buildAgentWorkingCardData(
  agent: Agent,
  ask: FleetAsk | null | undefined,
  nowMs: number,
): AgentWorkingCardData {
  const openedAt = normalizeTimestampMs(ask?.startedAt)
    ?? normalizeTimestampMs(ask?.acknowledgedAt)
    ?? normalizeTimestampMs(ask?.updatedAt)
    ?? null;
  const lastEventAt = normalizeTimestampMs(agent.updatedAt);
  const startedAt = normalizeTimestampMs(ask?.startedAt) ?? normalizeTimestampMs(agent.createdAt);
  const taskTitle = ask?.task?.trim()
    || agent.cwd
    || agent.project
    || `Working in ${agent.project ?? "workspace"}`;
  const askStatus: WorkingCardTaskStatus = ask?.status ?? "working";
  const agentWorking = normalizeAgentState(agent.state) === "working";
  const executionState: WorkingCardExecutionState =
    askStatus === "completed" ? "delivered"
      : askStatus === "failed" ? "failed"
        : askStatus === "queued" ? "queued"
          : agentWorking ? "working"
            : "idle";

  return {
    agentId: agent.id,
    agentName: agent.name,
    agentHandle: agent.handle,
    harness: ask?.harness ?? agent.harness,
    model: agent.model,
    branch: agent.branch ?? "main",
    cwd: agent.cwd,
    task: {
      invocationId: ask?.invocationId ?? null,
      title: taskTitle,
      summary: ask?.summary ?? null,
      openedAt,
      status: askStatus,
    },
    execution: { state: executionState, lastEventAt, startedAt },
    checkpoint: meaningfulCheckpoint(ask, taskTitle),
    reply: {
      state: askStatus === "completed" ? "delivered" : "none",
      deliveredAt: normalizeTimestampMs(ask?.completedAt),
    },
  };
}

function workingCardLiveLabel(card: AgentWorkingCardData, nowMs: number): string {
  if (card.reply.state === "delivered") {
    const age = card.reply.deliveredAt ? formatAge(card.reply.deliveredAt, nowMs) : null;
    return age ? `delivered · ${age}` : "delivered";
  }
  if (card.execution.state === "queued") return "queued";
  if (card.execution.state === "failed") return "failed";
  const age = card.execution.lastEventAt ? formatAge(card.execution.lastEventAt, nowMs) : null;
  if (card.execution.state === "idle") return age ? `idle · ${age}` : "idle";
  return age ? `live · ${age}` : "live";
}

function noRecentSignalSourceLabel(item: NoRecentSignalItem): string {
  const parts: string[] = [];
  if (item.hasAgentState) parts.push("agent state");
  if (item.askCount > 0) {
    parts.push(`${item.askCount} ask${item.askCount === 1 ? "" : "s"}`);
  }
  return parts.join(" + ") || "no recent signal";
}

type HeartrateBucketView = {
  ts: number;
  count: number;
  value: number;
};

type LoadMode = "initial" | "background" | "manual";

function greetingFor(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function settledError(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === "fulfilled") return null;
  return friendlySyncError(result.reason instanceof Error ? result.reason.message : String(result.reason));
}

function friendlySyncError(message: string): string {
  return /failed to fetch|networkerror|load failed|couldn't connect|connection refused/i.test(message)
    ? "Scout server is unreachable"
    : message;
}

function isOfflineSyncError(message: string | null): boolean {
  return message === "Scout server is unreachable";
}

export function HomeContent({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const { agents: allAgents, onboarding, reload, route } = useScout();
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(allAgents, machineId),
    [allAgents, machineId],
  );
  const agents = useMemo(
    () => filterAgentsByMachineScope(allAgents, machineId),
    [allAgents, machineId],
  );
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [heartrate, setHeartrate] = useState<HeartrateBucketView[]>([]);
  const [heartrateWindow, setHeartrateWindow] = useState("trailing 7d");
  const [heartrateBucketLabel, setHeartrateBucketLabel] = useState("3h buckets");
  const [tailEvents, setTailEvents] = useState<TailEvent[]>([]);
  const [serviceGauges, setServiceGauges] = useState<ServiceGauge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const lastForegroundRefreshAtRef = useRef(0);
  const fleetRef = useRef<FleetState | null>(null);

  useEffect(() => {
    fleetRef.current = fleet;
  }, [fleet]);

  const fetchServiceGauges = useCallback(async (forceRefresh = false): Promise<ServiceGauge[]> => {
    const suffix = forceRefresh ? "?refresh=1" : "";
    const result = await api<{ gauges: ServiceGauge[] }>(`/api/service-budgets${suffix}`);
    return result.gauges ?? [];
  }, []);

  const scopedFleet = useMemo(
    () => filterFleetByMachineScope(fleet, scopedAgentIds),
    [fleet, scopedAgentIds],
  );

  const [lookbackMs, setLookbackMs] = usePersistentNumber(
    LOOKBACK_STORAGE_KEY,
    DEFAULT_LOOKBACK_MS,
  );
  const lookbackOption = useMemo<LookbackOption>(
    () =>
      LOOKBACK_WINDOWS.find((opt) => opt.value === lookbackMs)
        ?? LOOKBACK_WINDOWS[LOOKBACK_WINDOWS.length - 1]!,
    [lookbackMs],
  );

  const load = useCallback(async (mode: LoadMode = "initial") => {
    const requestId = ++requestIdRef.current;
    const hasSnapshot = fleetRef.current !== null;

    if (!hasSnapshot && mode !== "background") {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
    }

    const fleetQuery = new URLSearchParams({
      activityLookbackMs: String(lookbackOption.value),
      activityLimit: String(lookbackOption.activityLimit),
    }).toString();

    const [fleetResult, heartrateResult, agentsResult] =
      await Promise.allSettled([
        api<FleetState>(`/api/fleet?${fleetQuery}`),
        api<{
          windowLabel: string;
          bucketLabel?: string;
          buckets: HeartrateBucketView[];
        }>("/api/heartrate"),
        reload(),
      ]);

    if (requestId !== requestIdRef.current) return;

    if (fleetResult.status === "fulfilled") {
      fleetRef.current = fleetResult.value;
      setFleet(fleetResult.value);
    }
    if (heartrateResult.status === "fulfilled") {
      setHeartrate(heartrateResult.value.buckets);
      setHeartrateWindow(heartrateResult.value.windowLabel);
      setHeartrateBucketLabel(heartrateResult.value.bucketLabel ?? "");
    }

    const errors = [
      settledError(fleetResult),
      settledError(heartrateResult),
      settledError(agentsResult),
    ].filter((message): message is string => Boolean(message));
    setError(errors[0] ?? null);
    if (errors.length < 4) {
      setLastLoadedAt(Date.now());
    }
    setLoading(false);
    setRefreshing(false);
  }, [reload, lookbackOption]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void load("background");
    }, 250);
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [load]);
  useBrokerEvents(scheduleRefresh);

  useEffect(() => {
    let cancelled = false;
    const fetchBudgets = async () => {
      try {
        const gauges = await fetchServiceGauges();
        if (!cancelled) setServiceGauges(gauges);
      } catch {
        // Silent: gauges are best-effort. If the endpoint fails, we just hide them.
      }
    };
    void fetchBudgets();
    const id = setInterval(fetchBudgets, SERVICE_BUDGETS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchServiceGauges]);

  const loadLocalTailSnapshot = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(LOCAL_TAIL_RECENT_LIMIT),
        transcripts: "true",
      });
      const recent = await api<{ events: TailEvent[] }>(`/api/tail/recent?${params.toString()}`);
      setTailEvents(recent.events ?? []);
    } catch {
      // Silent: the embedded Tail view owns the visible error/empty state.
    }
  }, []);

  useEffect(() => {
    void loadLocalTailSnapshot();
    const id = setInterval(() => void loadLocalTailSnapshot(), LOCAL_TAIL_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadLocalTailSnapshot]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load("background");
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundRefreshAtRef.current < 1000) {
        return;
      }
      lastForegroundRefreshAtRef.current = now;
      void load("background");
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [noRecentSignalInactiveRaw, setNoRecentSignalInactiveRaw] = usePersistentString(
    NO_RECENT_SIGNAL_INACTIVE_KEY,
    "{}",
  );
  const noRecentSignalInactive = useMemo(
    () => parseNoRecentSignalInactive(noRecentSignalInactiveRaw),
    [noRecentSignalInactiveRaw],
  );

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const waiting = useMemo(
    () =>
      agents.filter((a) => {
        const s = normalizeAgentState(a.state);
        return s === "ready";
      }),
    [agents],
  );

  const movingAsks = useMemo(
    () =>
      (scopedFleet?.activeAsks ?? []).filter(
        (a) => a.status === "queued" || a.status === "working",
      ),
    [scopedFleet],
  );
  const freshMovingAsks = useMemo(
    () => movingAsks.filter((ask) => isFreshMovingTimestamp(ask.updatedAt, nowMs)),
    [movingAsks, nowMs],
  );
  const activeAskByAgent = useMemo(() => {
    const byAgent = new Map<string, FleetAsk>();
    for (const ask of freshMovingAsks) {
      const current = byAgent.get(ask.agentId);
      const askUpdatedAt = normalizeTimestampMs(ask.updatedAt) ?? 0;
      const currentUpdatedAt = normalizeTimestampMs(current?.updatedAt) ?? 0;
      if (!current || askUpdatedAt > currentUpdatedAt) {
        byAgent.set(ask.agentId, ask);
      }
    }
    return byAgent;
  }, [freshMovingAsks]);
  const active = useMemo(
    () =>
      agents.filter((agent) =>
        normalizeAgentState(agent.state) === "working" &&
        (isFreshMovingTimestamp(agent.updatedAt, nowMs) || activeAskByAgent.has(agent.id))
      ),
    [activeAskByAgent, agents, nowMs],
  );
  const activeIds = useMemo(() => new Set(active.map((agent) => agent.id)), [active]);

  // Enrich active cards with live session id, model, and context-window usage.
  // One batched observe-summary call covers every active agent (only a handful).
  const activeIdsKey = useMemo(
    () => active.map((agent) => agent.id).sort().join(","),
    [active],
  );
  const [activeContext, setActiveContext] = useState<Record<string, ActiveAgentContext>>({});
  useEffect(() => {
    if (!activeIdsKey) {
      setActiveContext({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      const summaries = await api<ObserveAgentSummary[]>(
        `/api/observe/agents?ids=${encodeURIComponent(activeIdsKey)}`,
      ).catch(() => null);
      if (cancelled || !summaries) return;
      const next: Record<string, ActiveAgentContext> = {};
      for (const summary of summaries) {
        const session = summary?.data?.metadata?.session;
        const usage = summary?.data?.metadata?.usage;
        // Only a REAL window utilization (tokens-in-context / window) — never the
        // synthetic ramp. Null when the harness doesn't report both numbers.
        const total = usage?.totalTokens;
        const window = usage?.contextWindowTokens;
        const contextPct = typeof total === "number" && typeof window === "number" && window > 0
          ? Math.min(100, Math.round((total / window) * 100))
          : null;
        next[summary.agentId] = {
          sessionId: session?.externalSessionId ?? null,
          model: session?.model ?? null,
          contextPct,
        };
      }
      setActiveContext(next);
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeIdsKey]);
  const workingAgentsWithoutRecentSignal = useMemo(
    () =>
      agents.filter((agent) =>
        normalizeAgentState(agent.state) === "working" && !activeIds.has(agent.id)
      ),
    [activeIds, agents],
  );
  const movingAsksWithoutRecentSignal = useMemo(
    () => movingAsks.filter((ask) => !isFreshMovingTimestamp(ask.updatedAt, nowMs)),
    [movingAsks, nowMs],
  );
  const noRecentSignalItems = useMemo<NoRecentSignalItem[]>(() => {
    const byAgent = new Map<string, NoRecentSignalItem>();
    const upsert = (item: NoRecentSignalItem) => {
      const current = byAgent.get(item.agentId);
      if (!current) {
        byAgent.set(item.agentId, item);
        return;
      }
      const useNextDetail = item.updatedAtMs >= current.updatedAtMs;
      byAgent.set(item.agentId, {
        agentId: item.agentId,
        agentName: current.agentName || item.agentName,
        updatedAtMs: Math.max(current.updatedAtMs, item.updatedAtMs),
        summary: useNextDetail ? item.summary : current.summary,
        route: useNextDetail ? item.route : current.route,
        hasAgentState: current.hasAgentState || item.hasAgentState,
        askCount: current.askCount + item.askCount,
      });
    };

    for (const agent of workingAgentsWithoutRecentSignal) {
      upsert({
        agentId: agent.id,
        agentName: agent.name,
        updatedAtMs: normalizeTimestampMs(agent.updatedAt) ?? 0,
        summary: agent.cwd ?? agent.projectRoot ?? agent.project ?? agent.branch ?? "Registered as working",
        route: { view: "agents", agentId: agent.id, tab: "profile" },
        hasAgentState: true,
        askCount: 0,
      });
    }

    for (const ask of movingAsksWithoutRecentSignal) {
      upsert({
        agentId: ask.agentId,
        agentName: ask.agentName ?? ask.agentId,
        updatedAtMs: normalizeTimestampMs(ask.updatedAt) ?? 0,
        summary: ask.summary ?? ask.task ?? ask.statusLabel,
        route: routeForFleetAsk(ask),
        hasAgentState: false,
        askCount: 1,
      });
    }

    return [...byAgent.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [movingAsksWithoutRecentSignal, workingAgentsWithoutRecentSignal]);
  const visibleNoRecentSignalItems = useMemo(
    () =>
      noRecentSignalItems.filter(
        (item) => (noRecentSignalInactive[item.agentId] ?? -1) < item.updatedAtMs,
      ),
    [noRecentSignalInactive, noRecentSignalItems],
  );
  const movingAsksWithoutActiveAgent = useMemo(
    () =>
      freshMovingAsks.filter(
        (ask) => !active.some((agent) => agent.id === ask.agentId),
      ),
    [active, freshMovingAsks],
  );

  const sinceMs = nowMs - lookbackMs;
  const liveActivity = useMemo<FleetActivity[]>(() => {
    const items = (scopedFleet?.activity ?? []).filter(
      (item) => (normalizeTimestampMs(item.ts) ?? 0) >= sinceMs,
    );
    // Collapse machine echoes: the firehose logs some events twice with
    // identical copy but different kinds (e.g. `ask opened` immediately
    // followed by `invocation recorded`). The feed is newest-first, so drop a
    // row when the one just above it says the same thing at the same time —
    // keeps the first (more human-readable) line, hides the duplicate.
    return items.filter((item, i) => {
      const prev = items[i - 1];
      if (!prev) return true;
      const sameContent =
        prev.title === item.title
        && prev.summary === item.summary
        && prev.conversationId === item.conversationId
        && Math.abs((normalizeTimestampMs(prev.ts) ?? 0) - (normalizeTimestampMs(item.ts) ?? 0)) <= 5_000;
      return !sameContent;
    });
  }, [scopedFleet?.activity, sinceMs]);
  const activityShape = useMemo(
    () => computeActivityShape(liveActivity, lookbackMs, nowMs),
    [liveActivity, lookbackMs, nowMs],
  );
  const activityCapReached = liveActivity.length >= lookbackOption.activityLimit;
  const nextLookbackOption = useMemo<LookbackOption | null>(() => {
    const idx = LOOKBACK_WINDOWS.findIndex((opt) => opt.value === lookbackMs);
    return idx >= 0 && idx < LOOKBACK_WINDOWS.length - 1
      ? LOOKBACK_WINDOWS[idx + 1]!
      : null;
  }, [lookbackMs]);

  const now = new Date();
  const greeting = greetingFor(now.getHours());
  const opsEnabled = useOptionalFlag("ops.control", true);
  const operatorName =
    onboarding?.operatorName?.trim()
    || onboarding?.operatorNameSuggestion?.trim()
    || "operator";
  const combinedHeartrate = useMemo(
    () => combineHeartrateWithTailEvents(heartrate, tailEvents, nowMs),
    [heartrate, tailEvents, nowMs],
  );

  // Native/unmanaged actors observed via the activity firehose in the last 10 minutes.
  // Anything Scout already tracks as a managed agent is excluded — those render as NowCard.
  const observedActiveActors = useMemo<FleetActivity[]>(() => {
    const ACTIVE_WINDOW_MS = 10 * 60_000;
    const cutoff = nowMs - ACTIVE_WINDOW_MS;
    const items = scopedFleet?.activity ?? [];
    const managedNames = new Set(agents.map((a) => a.name.toLowerCase()));
    const managedIds = new Set(agents.map((a) => a.id));
    const interestingKinds = new Set([
      "agent_message",
      "status_message",
      "ask_opened",
      "ask_working",
      "ask_failed",
      "handoff_sent",
      "collaboration_event",
    ]);
    const byActor = new Map<string, FleetActivity>();
    for (const item of items) {
      const itemTs = normalizeTimestampMs(item.ts);
      if (itemTs === null || itemTs < cutoff) continue;
      if (!interestingKinds.has(item.kind)) continue;
      const name = item.actorName?.trim();
      if (!name) continue;
      if (name.toLowerCase() === operatorName.toLowerCase()) continue;
      if (managedNames.has(name.toLowerCase())) continue;
      if (item.agentId && managedIds.has(item.agentId)) continue;
      const key = name.toLowerCase();
      const current = byActor.get(key);
      const currentTs = normalizeTimestampMs(current?.ts) ?? 0;
      if (!current || itemTs > currentTs) byActor.set(key, item);
    }
    return [...byActor.values()].sort((a, b) =>
      compareTimestampsDesc(a.ts, b.ts),
    );
  }, [scopedFleet?.activity, nowMs, agents, operatorName]);

  const markNoRecentSignalInactive = useCallback((item: NoRecentSignalItem) => {
    setNoRecentSignalInactiveRaw(encodeNoRecentSignalInactive({
      ...noRecentSignalInactive,
      [item.agentId]: item.updatedAtMs,
    }));
  }, [setNoRecentSignalInactiveRaw, noRecentSignalInactive]);

  const markAllNoRecentSignalInactive = useCallback(() => {
    const next = { ...noRecentSignalInactive };
    for (const item of visibleNoRecentSignalItems) {
      next[item.agentId] = item.updatedAtMs;
    }
    setNoRecentSignalInactiveRaw(encodeNoRecentSignalInactive(next));
  }, [setNoRecentSignalInactiveRaw, noRecentSignalInactive, visibleNoRecentSignalItems]);

  const narrativeParts = useMemo(() => {
    const parts: string[] = [];
    if (active.length > 0)
      parts.push(`${active.length} agent${active.length === 1 ? " is" : "s are"} working now`);
    if (waiting.length > 0)
      parts.push(`${waiting.length} agent${waiting.length === 1 ? " is" : "s are"} ready`);
    if (parts.length === 0 && agents.length > 0)
      parts.push(`${agents.length} agent${agents.length === 1 ? " is" : "s are"} registered`);
    if (parts.length === 0)
      parts.push("no agents are connected yet");
    return parts;
  }, [active, waiting, agents]);
  const syncLabel = loading
    ? "syncing"
    : error
      ? `${isOfflineSyncError(error) ? "offline" : "sync issue"} · ${lastLoadedAt ? timeAgo(lastLoadedAt) : "waiting"}`
      : lastLoadedAt
        ? `updated ${timeAgo(lastLoadedAt)}`
        : "waiting";
  const handleRefresh = useCallback(() => {
    void load("manual");
    void fetchServiceGauges(true)
      .then((gauges) => setServiceGauges(gauges))
      .catch(() => {});
  }, [fetchServiceGauges, load]);

  const heroProps = {
    now,
    greeting,
    operatorName,
    syncLabel,
    error,
    loading,
    refreshing,
    onRefresh: handleRefresh,
    narrativeParts,
    navigate,
    opsEnabled,
    heartrate: combinedHeartrate,
    heartrateWindow,
    heartrateBucketLabel,
    heartrateVisibleEventThreshold: HEARTRATE_COMBINED_EVENT_THRESHOLD,
    serviceGauges,
  };
  const hideEmptyActivityModule =
    !loading &&
    !error &&
    liveActivity.length === 0 &&
    lookbackMs >= DEFAULT_LOOKBACK_MS;
  const showQuietStart =
    !loading &&
    !error &&
    liveActivity.length === 0;
  const showActivitySection =
    loading ||
    liveActivity.length > 0 ||
    Boolean(error) ||
    !hideEmptyActivityModule;

  return (
    <div className="s-fleet-home">
      <div className="s-fleet-home-inner">
        {/* ── Home status ─────────────────────────────────────────── */}
        <HomeHero {...heroProps} />

        {/* ── What's moving ──────────────────────────────────────── */}
        {(active.length > 0 || observedActiveActors.length > 0 || movingAsksWithoutActiveAgent.length > 0) && (
          <div className="s-fleet-section">
            <SectionRule
              label={`What's moving · ${active.length + observedActiveActors.length + movingAsksWithoutActiveAgent.length}`}
              right={
                <button
                  className="s-link-btn"
                  onClick={() => navigate({ view: "mesh" })}
                >
                  open mesh ↗
                </button>
              }
            />
            {(active.length > 0 || observedActiveActors.length > 0) && (
              <div
                className="s-now-grid"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(active.length + observedActiveActors.length, 3)}, 1fr)`,
                }}
              >
                {active.map((agent) => (
                  <NowCard
                    key={agent.id}
                    agent={agent}
                    ask={activeAskByAgent.get(agent.id) ?? null}
                    context={activeContext[agent.id] ?? null}
                    nowMs={nowMs}
                    navigate={navigate}
                  />
                ))}
                {observedActiveActors.map((actor) => (
                  <ObservedActorCard
                    key={actor.id}
                    actor={actor}
                    nowMs={nowMs}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
            {movingAsksWithoutActiveAgent.length > 0 && (
              <div className="s-moving-ask-list">
                {movingAsksWithoutActiveAgent.map((ask) => (
                  <MovingAskRow
                    key={ask.invocationId}
                    ask={ask}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── No recent signal review ─────────────────────────────── */}
        {visibleNoRecentSignalItems.length > 0 && (
          <div className="s-fleet-section" id="home-no-recent-signal">
            <SectionRule
              label={`No recent signal · ${visibleNoRecentSignalItems.length}`}
              right={
                <button
                  type="button"
                  className="s-link-btn"
                  onClick={markAllNoRecentSignalInactive}
                >
                  mark all inactive
                </button>
              }
            />
            <div className="s-no-recent-signal-list">
              {visibleNoRecentSignalItems.map((item) => (
                <NoRecentSignalRow
                  key={item.agentId}
                  item={item}
                  navigate={navigate}
                  onMarkInactive={() => markNoRecentSignalInactive(item)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Activity stream ────────────────────────────────────── */}
        {showActivitySection && (
          <div className="s-fleet-section">
            <SectionRule
              label={`Live activity · ${liveActivity.length}${activityCapReached ? "+" : ""}`}
              right={
                <LookbackPicker
                  value={lookbackMs}
                  onChange={setLookbackMs}
                  refreshing={refreshing && !loading}
                />
              }
            />
            {activityShape && (
              <div className="s-fleet-live-shape">
                <span>last {formatDuration(activityShape.lastAgoMs)} ago</span>
                <span>·</span>
                <span>longest gap {formatDuration(activityShape.longestGapMs)}</span>
                {activityCapReached && (
                  <>
                    <span>·</span>
                    <span style={{ color: "var(--amber)" }}>
                      showing {Math.min(liveActivity.length, 30)} of {lookbackOption.activityLimit}+ (capped)
                    </span>
                  </>
                )}
                {!activityCapReached && liveActivity.length > 30 && (
                  <>
                    <span>·</span>
                    <span>showing 30 of {liveActivity.length}</span>
                  </>
                )}
              </div>
            )}
            {loading && liveActivity.length === 0 ? (
              <ActivityStreamSkeleton />
            ) : liveActivity.length === 0 ? (
              <LiveActivityEmpty
                lookbackMs={lookbackMs}
                nextOption={nextLookbackOption}
                onWiden={(opt) => setLookbackMs(opt.value)}
                loadedAt={lastLoadedAt}
                nowMs={nowMs}
                error={error}
                onRetry={() => void load("manual")}
              />
            ) : (
              <div className="s-mc-stream s-fleet-live-stream">
                {liveActivity.slice(0, 30).map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    nowMs={nowMs}
                    onOpen={() => {
                      const route = fleetActivityRoute(item);
                      if (route) navigate(route);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {showQuietStart && (
          <div className="s-fleet-section s-fleet-section--quiet-start">
            <QuietStartPanel
              agents={agents}
              navigate={navigate}
            />
          </div>
        )}

      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────── */

function SectionRule({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="s-section-rule">
      <span className="s-eyebrow">{label}</span>
      <span className="s-section-rule-line" />
      {right && <span className="s-section-rule-right">{right}</span>}
    </div>
  );
}

function NowCard({
  agent,
  ask,
  context,
  nowMs,
  navigate,
}: {
  agent: Agent;
  ask?: FleetAsk | null;
  context?: ActiveAgentContext | null;
  nowMs: number;
  navigate: (r: Route) => void;
}) {
  const card = buildAgentWorkingCardData(agent, ask, nowMs);
  const fullRoot = agent.projectRoot ?? agent.cwd ?? undefined;
  const rootLabel = compactPath(fullRoot) ?? "no workspace";
  const branchLabel = card.branch ?? "no branch";
  const runtimeLabel = card.harness ?? null;
  // Model + the real harness session id come from the live observe summary;
  // the bulk agent record only carries the relay descriptor in harnessSessionId.
  const modelLabel = shortModelLabel(context?.model ?? card.model);
  const sessionLabel = compactSessionId(context?.sessionId ?? agent.harnessSessionId);
  const contextPct = context?.contextPct ?? null;
  const machineLabel = compactNode(agent.homeNodeName ?? agent.nodeQualifier);
  const uptime = agent.createdAt ? formatAge(agent.createdAt, nowMs) : null;
  const turnAge = card.task.openedAt ? formatAge(card.task.openedAt, nowMs) : "new";
  const liveLabel = workingCardLiveLabel(card, nowMs);
  const liveTone = card.execution.state === "failed"
    ? "failed"
    : card.reply.state === "delivered"
      ? "delivered"
      : card.execution.state === "queued"
        ? "queued"
        : card.execution.state === "idle"
          ? "idle"
          : "live";
  const checkpoint = card.reply.state === "delivered" && card.reply.deliveredAt
    ? `reply ready · ${formatAge(card.reply.deliveredAt, nowMs)}`
    : card.checkpoint?.line ?? null;

  // Identity meta, inline next to the name — path · branch · runtime · model · context.
  // Branch renders in full (no truncation cap); the row wraps when it needs the room.
  const metaParts: { key: string; text: string; title?: string; mono?: boolean }[] = [
    { key: "root", text: rootLabel, title: fullRoot, mono: true },
    { key: "branch", text: branchLabel, title: branchLabel, mono: true },
  ];
  if (runtimeLabel) metaParts.push({ key: "runtime", text: runtimeLabel });
  if (agent.role) metaParts.push({ key: "role", text: agent.role });
  if (modelLabel) metaParts.push({ key: "model", text: modelLabel });

  // Relevant at-a-glance tiles — only the signals we actually have data for.
  // Liveness is carried by the pulse + border tone, so no redundant state tile.
  const tiles: { key: string; label: string; value: string; tone?: "work" | "warn" | "dim" }[] = [
    { key: "turn", label: "turn", value: turnAge, tone: card.task.openedAt ? "work" : "dim" },
  ];
  if (contextPct !== null) {
    tiles.push({
      key: "context",
      label: "context",
      value: `${contextPct}%`,
      tone: contextPct >= 80 ? "warn" : "work",
    });
  } else if (uptime) {
    tiles.push({ key: "uptime", label: "up", value: uptime });
  }
  if (sessionLabel) tiles.push({ key: "session", label: "session", value: sessionLabel });
  if (machineLabel) tiles.push({ key: "machine", label: "machine", value: machineLabel });

  const open = () =>
    navigate({
      view: "agents",
      agentId: agent.id,
      conversationId: conversationForAgent(agent.id),
      tab: "observe",
    });

  return (
    <div
      role="button"
      tabIndex={0}
      className={`s-now-card s-now-card--${liveTone}`}
      onClick={open}
      onKeyDown={(event) => handleContextCardKey(event, open)}
    >
      <div className="s-now-card-top">
        <span
          className={`s-now-card-pulse s-now-card-pulse--${liveTone}`}
          aria-hidden="true"
        />
        <span className="s-now-card-name" title={card.agentName}>
          {card.agentName}
        </span>
      </div>

      <div className="s-now-card-idline">
        {metaParts.map((part, index) => (
          <span key={part.key} className="s-now-card-idgroup">
            {index > 0 && (
              <span className="s-now-card-idsep" aria-hidden="true">·</span>
            )}
            <span
              className={`s-now-card-idpart${part.mono ? " s-now-card-idpart--mono" : ""}`}
              title={part.title}
            >
              {part.text}
            </span>
          </span>
        ))}
      </div>

      <div className="s-now-card-task">{card.task.title}</div>

      {checkpoint && (
        <div className="s-now-card-checkpoint">
          <span aria-hidden="true">↳</span>
          <span>{checkpoint}</span>
        </div>
      )}

      <div
        className="s-now-card-metrics"
        style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}
        aria-label={`${card.agentName} signals`}
      >
        {tiles.map((tile) => (
          <MetricTile key={tile.key} label={tile.label} value={tile.value} tone={tile.tone} />
        ))}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = "dim",
}: {
  label: string;
  value: string;
  tone?: "work" | "warn" | "dim";
}) {
  return (
    <span className={`s-metric-tile s-metric-tile--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

function ObservedActorCard({
  actor,
  nowMs,
  navigate,
}: {
  actor: FleetActivity;
  nowMs: number;
  navigate: (r: Route) => void;
}) {
  const name = actor.actorName ?? "—";
  const initial = name[0]?.toUpperCase() ?? "?";
  const verb = activityVerb(actor.kind);
  const text = summarize(actor.title ?? actor.summary, 140);
  const route: Route | null = actor.conversationId
    ? { view: "conversation", conversationId: actor.conversationId }
    : actor.recordId
      ? { view: "work", workId: actor.recordId }
      : actor.agentId
        ? { view: "agents", agentId: actor.agentId }
        : null;
  const sourceTag = inferActorSource(name);

  return (
    <div
      className="s-now-card s-now-card--observed"
      style={{ cursor: route ? "pointer" : "default" }}
      onClick={() => {
        if (route) navigate(route);
      }}
    >
      <div className="s-now-card-head">
        <div
          className="s-avatar s-avatar-sm"
          style={{ background: actorColor(name) }}
        >
          {initial}
        </div>
        <div className="s-now-card-copy">
          <div className="s-now-card-name">{name}</div>
          <div className="s-now-card-meta">
            observed{sourceTag ? ` · ${sourceTag}` : ""} · {verb}
          </div>
        </div>
        <span className="s-now-card-live s-now-card-live--observed">
          <span className="s-now-card-live-dot" aria-hidden="true" />
          live
        </span>
      </div>

      <div className="s-now-card-task">{text || "(no recent text)"}</div>

      <div className="s-now-card-ticker">
        <span className="s-now-card-ticker-prompt">›</span>
        <span className="s-now-card-ticker-text">{actor.kind.replace(/[._]/g, " ")}</span>
        <span className="s-now-card-ticker-dots" aria-hidden="true">
          <span /><span /><span />
        </span>
      </div>

      <div className="s-now-card-footer">
        <span>updated {formatAge(actor.ts, nowMs)}</span>
        <span>unmanaged</span>
      </div>
    </div>
  );
}

function inferActorSource(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("codex")) return "codex";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("hudson")) return "hudson";
  return null;
}

function MovingAskRow({
  ask,
  navigate,
}: {
  ask: FleetAsk;
  navigate: (r: Route) => void;
}) {
  const route = routeForFleetAsk(ask);

  return (
    <button
      className="s-moving-ask-row"
      onClick={() => navigate(route)}
    >
      <span className="s-moving-ask-agent">
        {ask.agentName ?? ask.agentId}
      </span>
      <span className="s-moving-ask-title">
        {ask.summary ?? ask.task}
      </span>
      <span className="s-moving-ask-state">
        {ask.statusLabel}
      </span>
      <span className="s-moving-ask-time">
        {timeAgo(ask.updatedAt)}
      </span>
    </button>
  );
}

function NoRecentSignalRow({
  item,
  navigate,
  onMarkInactive,
}: {
  item: NoRecentSignalItem;
  navigate: (r: Route) => void;
  onMarkInactive: () => void;
}) {
  const age = item.updatedAtMs > 0 ? timeAgo(item.updatedAtMs) : "unknown";
  const source = noRecentSignalSourceLabel(item);
  const summary = summarize(item.summary, 180);

  return (
    <div className="s-no-recent-signal-row">
      <button
        type="button"
        className="s-no-recent-signal-main"
        onClick={() => navigate(item.route)}
      >
        <span
          className="s-avatar s-avatar-sm"
          style={{ background: actorColor(item.agentName) }}
        >
          {item.agentName[0]?.toUpperCase() ?? "?"}
        </span>
        <span className="s-no-recent-signal-copy">
          <span className="s-no-recent-signal-name">{item.agentName}</span>
          <span className="s-no-recent-signal-meta">
            <span>last signal {age}</span>
            <span>{source}</span>
            <span>hidden after {formatLookback(MOVING_ACTIVE_WINDOW_MS)} idle</span>
          </span>
          {summary && <span className="s-no-recent-signal-summary">{summary}</span>}
        </span>
      </button>
      <div className="s-no-recent-signal-actions">
        <button
          type="button"
          className="s-icon-btn"
          title="Open source"
          onClick={() => navigate(item.route)}
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>Open</span>
        </button>
        <button
          type="button"
          className="s-icon-btn"
          title="Mark inactive"
          onClick={onMarkInactive}
        >
          <Check size={14} aria-hidden="true" />
          <span>Mark inactive</span>
        </button>
      </div>
    </div>
  );
}

function LookbackPicker({
  value,
  onChange,
  refreshing,
}: {
  value: number;
  onChange: (next: number) => void;
  refreshing?: boolean;
}) {
  return (
    <div className="s-mc-window" role="group" aria-label="Lookback window">
      <span className="s-mc-window-label">
        Lookback
        {refreshing && <span className="s-mc-window-refreshing" aria-label="refreshing" />}
      </span>
      <div className="s-mc-window-tabs">
        {LOOKBACK_WINDOWS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`s-mc-window-tab${opt.value === value ? " is-active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActivityStreamSkeleton() {
  return (
    <div className="s-mc-stream s-fleet-live-stream s-fleet-live-stream--skeleton" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="s-fleet-live-skeleton-row">
          <span className="s-fleet-live-skeleton-time" />
          <span className="s-fleet-live-skeleton-actor" />
          <span className="s-fleet-live-skeleton-text" />
        </div>
      ))}
    </div>
  );
}

function LiveActivityEmpty({
  lookbackMs,
  nextOption,
  onWiden,
  loadedAt,
  nowMs,
  error,
  onRetry,
}: {
  lookbackMs: number;
  nextOption: LookbackOption | null;
  onWiden: (opt: LookbackOption) => void;
  loadedAt: number | null;
  nowMs: number;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="s-mc-empty s-fleet-live-empty">
        <div className="s-fleet-live-empty-title">Couldn’t load activity.</div>
        <div className="s-fleet-live-empty-detail">{error}</div>
        <div className="s-fleet-live-empty-actions">
          <button type="button" className="s-link-btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const polledLabel = loadedAt
    ? `Polled ${formatDuration(Math.max(0, nowMs - loadedAt))} ago.`
    : "Polling…";
  return (
    <div className="s-mc-empty s-fleet-live-empty">
      <div className="s-fleet-live-empty-title">
        Quiet — no activity in the last {formatLookback(lookbackMs)}.
      </div>
      <div className="s-fleet-live-empty-detail">{polledLabel}</div>
      {nextOption && (
        <div className="s-fleet-live-empty-actions">
          <button
            type="button"
            className="s-link-btn"
            onClick={() => onWiden(nextOption)}
          >
            Widen to {nextOption.label} →
          </button>
        </div>
      )}
    </div>
  );
}

type QuietAskResult = {
  conversationId?: string;
  flight?: {
    targetAgentId?: string | null;
  };
};

function sortedCatchupAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aState = normalizeAgentState(a.state);
    const bState = normalizeAgentState(b.state);
    const aRank = aState === "ready" ? 0 : aState === "working" ? 1 : 2;
    const bRank = bState === "ready" ? 0 : bState === "working" ? 1 : 2;
    return aRank - bRank || a.name.localeCompare(b.name);
  });
}

function buildHarnessOptions(agent: Agent | null): string[] {
  const options = new Set<string>();
  const harness = agent?.harness?.trim();
  if (harness) options.add(harness);
  options.add("claude");
  options.add("codex");
  options.add("pi");
  return [...options];
}

function buildModelOptions(agent: Agent | null): string[] {
  const options = new Set<string>();
  const model = agent?.model?.trim();
  if (model) options.add(model);
  return [...options];
}

function QuietStartPanel({
  agents,
  navigate,
}: {
  agents: Agent[];
  navigate: (r: Route) => void;
}) {
  const catchupAgents = useMemo(() => sortedCatchupAgents(agents), [agents]);
  const [agentId, setAgentId] = useState(() => catchupAgents[0]?.id ?? "");
  const selectedAgent = catchupAgents.find((agent) => agent.id === agentId) ?? null;
  const harnessOptions = useMemo(() => buildHarnessOptions(selectedAgent), [selectedAgent]);
  const modelOptions = useMemo(() => buildModelOptions(selectedAgent), [selectedAgent]);
  const [prompt, setPrompt] = useState("");
  const [harness, setHarness] = useState(selectedAgent?.harness?.trim() ?? "");
  const [model, setModel] = useState(selectedAgent?.model?.trim() ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    if (catchupAgents.some((agent) => agent.id === agentId)) return;
    setAgentId(catchupAgents[0]?.id ?? "");
  }, [agentId, catchupAgents]);

  useEffect(() => {
    setHarness(selectedAgent?.harness?.trim() ?? "");
    setModel(selectedAgent?.model?.trim() ?? "");
  }, [selectedAgent?.id]);

  const submitAsk = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!selectedAgent || !trimmed) return;
    setSubmitting(true);
    setAskError(null);
    try {
      const result = await api<QuietAskResult>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          body: trimmed,
          targetAgentId: selectedAgent.id,
          targetLabel: selectedAgent.name,
          execution: {
            harness: harness || undefined,
            model: model || undefined,
          },
        }),
      });
      navigate({
        view: "conversation",
        conversationId: result.conversationId ?? selectedAgent.conversationId ?? conversationForAgent(selectedAgent.id),
      });
    } catch (submitError) {
      setAskError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="s-quiet-start">
      <div className="s-quiet-panel s-quiet-panel--tail">
        <div className="s-quiet-panel-head">
          <span className="s-eyebrow">Local tail</span>
          <button
            type="button"
            className="s-icon-btn"
            title="Open tail"
            onClick={() => navigate({ view: "ops", mode: "tail" })}
          >
            <ExternalLink size={14} aria-hidden="true" />
            <span>Open tail</span>
          </button>
        </div>
        <div className="s-quiet-tail-frame">
          <TailView navigate={navigate} chrome="embedded" />
        </div>
      </div>

      <form className="s-quiet-panel s-quiet-panel--ask" onSubmit={submitAsk}>
        <div className="s-quiet-panel-head">
          <span className="s-eyebrow">Ask</span>
          <button
            type="submit"
            className="s-icon-btn s-icon-btn--primary"
            title="Ask selected agent"
            disabled={submitting || !selectedAgent || !prompt.trim()}
          >
            <Send size={14} aria-hidden="true" />
            <span>{submitting ? "Asking" : "Ask"}</span>
          </button>
        </div>
        <div className="s-quiet-target-row">
          <label className="s-quiet-label" htmlFor="home-catchup-agent">
            To
          </label>
          <select
            id="home-catchup-agent"
            className="s-quiet-select s-quiet-select--target"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            disabled={catchupAgents.length === 0 || submitting}
          >
            {catchupAgents.length === 0 ? (
              <option value="">No registered agents</option>
            ) : catchupAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="s-quiet-textarea"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Type a message..."
          aria-label="Message"
          rows={4}
          disabled={submitting || !selectedAgent}
        />
        <div className="s-quiet-controls">
          <select
            className="s-quiet-select"
            value={harness}
            onChange={(event) => setHarness(event.target.value)}
            disabled={submitting || !selectedAgent}
            aria-label="Harness"
          >
            <option value="">default harness</option>
            {harnessOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <select
            className="s-quiet-select"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={submitting || !selectedAgent}
            aria-label="Model"
          >
            <option value="">default model</option>
            {modelOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        {askError && <div className="s-quiet-error">{askError}</div>}
      </form>
    </div>
  );
}

function ActivityRow({
  item,
  nowMs,
  onOpen,
}: {
  item: FleetActivity;
  nowMs: number;
  onOpen: () => void;
}) {
  const actor = item.actorName ?? "—";
  const verb = activityVerb(item.kind);
  const text = summarize(item.title ?? item.summary, 110);
  return (
    <button type="button" className="s-mc-stream-row" onClick={onOpen}>
      <span className="s-mc-stream-time">{formatAge(item.ts, nowMs)}</span>
      <span className="s-mc-stream-actor">{actor}</span>
      <span className="s-mc-stream-verb">{verb}</span>
      <span className="s-mc-stream-text">{text}</span>
    </button>
  );
}

/** @deprecated Use HomeContent */
export { HomeContent as HomeScreen };
