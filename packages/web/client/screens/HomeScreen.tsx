import "./fleet-home.css";
import "./activity-stream.css";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, ExternalLink, Settings, X } from "lucide-react";
import HomeHero, {
  type HomeHeroBriefObservation,
  type HomeHeroSignal,
  type ServiceGauge,
} from "./HomeHero.tsx";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import {
  compareTimestampsDesc,
  normalizeTimestampMs,
  timeAgo,
} from "../lib/time.ts";
import { actorColor } from "../lib/colors.ts";
import { isOpsEnabled } from "../lib/feature-flags.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import {
  startHomeBriefSpeech,
  stopHomeBriefSpeech,
  useHomeBriefPlayerState,
} from "../lib/home-brief-player.ts";
import { usePersistentNumber, usePersistentString } from "../lib/persistent-state.ts";
import { useScout } from "../scout/Provider.tsx";
import { conversationForAgent, routeMachineId } from "../lib/router.ts";
import {
  filterAgentsByMachineScope,
  filterFleetByMachineScope,
  machineScopedAgentIds,
} from "../lib/machine-scope.ts";
import { dismissOperatorAttention } from "../lib/operator-attention.ts";
import type {
  Agent,
  FleetActivity,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  OperatorAttentionAction,
  OperatorAttentionItem,
  OperatorAttentionState,
  Route,
} from "../lib/types.ts";

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
const FLEET_BRIEF_REFRESH_MS = 5 * 60_000;
const MOVING_ACTIVE_WINDOW_MS = 30 * 60_000;
const STALE_MOTION_INACTIVE_KEY = "openscout.home.staleMotionInactive.v1";
const STALE_MOTION_INACTIVE_LIMIT = 200;

type FleetHomeBrief = {
  id: string;
  statement: string;
  observations?: HomeHeroBriefObservation[];
  preparedAt: number;
  expiresAt: number;
  ttlMs: number;
  sourceBriefId?: string;
};

type BriefingKind = "fleet-home" | "tour";

type BriefingSummary = {
  id: string;
  kind: BriefingKind;
  title: string;
  summary: string;
  recommendation: string | null;
  preparedAt: number;
  ttlMs: number;
  observationCount: number;
  hasMarkdown: boolean;
  createdAt: number;
};

const BRIEFING_KIND_LABEL: Record<BriefingKind, string> = {
  "fleet-home": "fleet",
  tour: "tour",
};

type StaleMotionItem = {
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

function formatTimeUntil(timestamp: number | null | undefined, nowMs: number): string {
  const timestampMs = normalizeTimestampMs(timestamp);
  if (timestampMs === null) return "unknown";
  const seconds = Math.floor((timestampMs - nowMs) / 1000);
  if (seconds <= 0) return "expired";
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

function isFreshMovingTimestamp(
  timestamp: number | null | undefined,
  nowMs: number,
): boolean {
  const timestampMs = normalizeTimestampMs(timestamp);
  return timestampMs !== null && nowMs - timestampMs <= MOVING_ACTIVE_WINDOW_MS;
}

function parseStaleMotionInactive(raw: string): Record<string, number> {
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

function encodeStaleMotionInactive(inactive: Record<string, number>): string {
  const trimmed = Object.entries(inactive)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .sort((a, b) => b[1] - a[1])
    .slice(0, STALE_MOTION_INACTIVE_LIMIT);
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

function staleMotionSourceLabel(item: StaleMotionItem): string {
  const parts: string[] = [];
  if (item.hasAgentState) parts.push("agent state");
  if (item.askCount > 0) {
    parts.push(`${item.askCount} ask${item.askCount === 1 ? "" : "s"}`);
  }
  return parts.join(" + ") || "stale state";
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
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

export function HomeScreen({
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
  const [attention, setAttention] = useState<OperatorAttentionState | null>(null);
  const [heartrate, setHeartrate] = useState<HeartrateBucketView[]>([]);
  const [heartrateWindow, setHeartrateWindow] = useState("trailing 7d");
  const [heartrateBucketLabel, setHeartrateBucketLabel] = useState("3h buckets");
  const [serviceGauges, setServiceGauges] = useState<ServiceGauge[]>([]);
  const [fleetBrief, setFleetBrief] = useState<FleetHomeBrief | null>(null);
  const [latestBriefing, setLatestBriefing] = useState<BriefingSummary | null>(null);
  const [briefArchiveLoaded, setBriefArchiveLoaded] = useState(false);
  const [briefRefreshing, setBriefRefreshing] = useState(false);
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

    const [fleetResult, attentionResult, heartrateResult, agentsResult] =
      await Promise.allSettled([
        api<FleetState>(`/api/fleet?${fleetQuery}`),
        api<OperatorAttentionState>("/api/operator-attention"),
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
    if (attentionResult.status === "fulfilled") {
      setAttention(attentionResult.value);
    }
    if (heartrateResult.status === "fulfilled") {
      setHeartrate(heartrateResult.value.buckets);
      setHeartrateWindow(heartrateResult.value.windowLabel);
      setHeartrateBucketLabel(heartrateResult.value.bucketLabel ?? "");
    }

    const errors = [
      settledError(fleetResult),
      settledError(attentionResult),
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
        const result = await api<{ gauges: ServiceGauge[] }>("/api/service-budgets");
        if (!cancelled) setServiceGauges(result.gauges ?? []);
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
  }, []);

  const fetchLatestBriefing = useCallback(async () => {
    try {
      const result = await api<{ briefings: BriefingSummary[] }>("/api/briefings?limit=1");
      setLatestBriefing(result.briefings[0] ?? null);
      setBriefArchiveLoaded(true);
    } catch {
      setBriefArchiveLoaded(true);
      // Silent: the archive is a fallback for the live generated brief.
    }
  }, []);

  const fetchFleetBrief = useCallback(async (force = false) => {
    if (force) setBriefRefreshing(true);
    try {
      const path = force ? "/api/fleet/brief?refresh=1" : "/api/fleet/brief";
      const result = await api<FleetHomeBrief>(path);
      setFleetBrief(result);
      void fetchLatestBriefing();
    } catch {
      // Silent: the generated brief is additive; the computed status line remains available.
    } finally {
      if (force) setBriefRefreshing(false);
    }
  }, [fetchLatestBriefing]);

  const briefPlayer = useHomeBriefPlayerState();

  useEffect(() => {
    void fetchLatestBriefing();
    void fetchFleetBrief();
    const id = setInterval(() => void fetchFleetBrief(), FLEET_BRIEF_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchFleetBrief, fetchLatestBriefing]);

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
  const [staleMotionInactiveRaw, setStaleMotionInactiveRaw] = usePersistentString(
    STALE_MOTION_INACTIVE_KEY,
    "{}",
  );
  const staleMotionInactive = useMemo(
    () => parseStaleMotionInactive(staleMotionInactiveRaw),
    [staleMotionInactiveRaw],
  );

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const waiting = useMemo(
    () =>
      agents.filter((a) => {
        const s = normalizeAgentState(a.state);
        return s === "available";
      }),
    [agents],
  );
  const offline = useMemo(
    () => agents.filter((a) => normalizeAgentState(a.state) === "offline"),
    [agents],
  );

  const needsYouAsks = useMemo(
    () =>
      [...(scopedFleet?.activeAsks ?? []), ...(scopedFleet?.recentCompleted ?? [])].filter(
        (a) => a.status === "needs_attention" || a.status === "failed",
      ),
    [scopedFleet],
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
  const needsYouItems = useMemo(() => scopedFleet?.needsAttention ?? [], [scopedFleet]);
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
  const staleWorkingAgents = useMemo(
    () =>
      agents.filter((agent) =>
        normalizeAgentState(agent.state) === "working" && !activeIds.has(agent.id)
      ),
    [activeIds, agents],
  );
  const staleMovingAsks = useMemo(
    () => movingAsks.filter((ask) => !isFreshMovingTimestamp(ask.updatedAt, nowMs)),
    [movingAsks, nowMs],
  );
  const staleMotionItems = useMemo<StaleMotionItem[]>(() => {
    const byAgent = new Map<string, StaleMotionItem>();
    const upsert = (item: StaleMotionItem) => {
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

    for (const agent of staleWorkingAgents) {
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

    for (const ask of staleMovingAsks) {
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
  }, [staleMovingAsks, staleWorkingAgents]);
  const visibleStaleMotionItems = useMemo(
    () =>
      staleMotionItems.filter(
        (item) => (staleMotionInactive[item.agentId] ?? -1) < item.updatedAtMs,
      ),
    [staleMotionInactive, staleMotionItems],
  );
  const movingAsksWithoutActiveAgent = useMemo(
    () =>
      freshMovingAsks.filter(
        (ask) => !active.some((agent) => agent.id === ask.agentId),
      ),
    [active, freshMovingAsks],
  );

  const totalNeedsYou = needsYouAsks.length + needsYouItems.length;
  const attentionItems = useMemo(
    () => scopedAgentIds
      ? (attention?.items ?? []).filter((item) => item.agentId && scopedAgentIds.has(item.agentId))
      : attention?.items ?? [],
    [attention?.items, scopedAgentIds],
  );
  const totalOperatorQueue = machineId
    ? totalNeedsYou + attentionItems.length
    : attention?.totals.all ?? totalNeedsYou;
  const oldestNeedsTs = useMemo(() => {
    const stamps = [
      ...needsYouAsks.map((a) => a.updatedAt),
      ...needsYouItems.map((w) => w.updatedAt),
      ...attentionItems.map((item) => item.updatedAt),
    ]
      .map(normalizeTimestampMs)
      .filter((value): value is number => value !== null);
    return stamps.length > 0 ? Math.min(...stamps) : null;
  }, [attentionItems, needsYouAsks, needsYouItems]);

  const sinceMs = nowMs - lookbackMs;
  const liveActivity = useMemo<FleetActivity[]>(() => {
    const items = scopedFleet?.activity ?? [];
    return items.filter(
      (item) => (normalizeTimestampMs(item.ts) ?? 0) >= sinceMs,
    );
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
  const opsEnabled = isOpsEnabled();
  const operatorName =
    onboarding?.operatorName?.trim()
    || onboarding?.operatorNameSuggestion?.trim()
    || "operator";

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

  const fleetBriefExpiresAtMs = normalizeTimestampMs(fleetBrief?.expiresAt);
  const fleetBriefIsFresh =
    fleetBriefExpiresAtMs !== null && fleetBriefExpiresAtMs > nowMs;

  const markStaleMotionInactive = useCallback((item: StaleMotionItem) => {
    setStaleMotionInactiveRaw(encodeStaleMotionInactive({
      ...staleMotionInactive,
      [item.agentId]: item.updatedAtMs,
    }));
  }, [setStaleMotionInactiveRaw, staleMotionInactive]);

  const markAllStaleMotionInactive = useCallback(() => {
    const next = { ...staleMotionInactive };
    for (const item of visibleStaleMotionItems) {
      next[item.agentId] = item.updatedAtMs;
    }
    setStaleMotionInactiveRaw(encodeStaleMotionInactive(next));
  }, [setStaleMotionInactiveRaw, staleMotionInactive, visibleStaleMotionItems]);

  const scrollToStaleMotion = useCallback(() => {
    document.getElementById("home-stale-motion")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const systemSignals = useMemo<HomeHeroSignal[]>(() => {
    const signals: HomeHeroSignal[] = [];

    if (totalOperatorQueue > 0) {
      signals.push({
        id: "attention-age",
        label: "needs you",
        value: oldestNeedsTs
          ? `oldest item has waited ${timeAgo(oldestNeedsTs)}`
          : "operator queue has waiting work",
        tone: "warn",
      });
    } else {
      signals.push({
        id: "attention-clear",
        label: "needs you",
        value: "no human-only queue in the current snapshot",
        tone: "ok",
      });
    }

    if (movingAsksWithoutActiveAgent.length > 0) {
      signals.push({
        id: "unanchored-work",
        label: "hidden motion",
        value: `${movingAsksWithoutActiveAgent.length} moving ask${movingAsksWithoutActiveAgent.length === 1 ? "" : "s"} without an active registered agent`,
        tone: "warn",
        route: { view: "activity" },
      });
    } else if (visibleStaleMotionItems.length > 0) {
      const count = visibleStaleMotionItems.length;
      signals.push({
        id: "stale-motion",
        label: "stale motion",
        value: `${count} old state${count === 1 ? "" : "s"} ready to mark inactive`,
        tone: "dim",
        onClick: scrollToStaleMotion,
      });
    } else if (observedActiveActors.length > 0) {
      signals.push({
        id: "organic-work",
        label: "organic work",
        value: `${observedActiveActors.length} recent actor${observedActiveActors.length === 1 ? "" : "s"} outside the managed roster`,
        tone: "ok",
        route: { view: "activity" },
      });
    } else {
      signals.push({
        id: "hidden-clear",
        label: "hidden motion",
        value: "no recent untracked movement detected",
        tone: "dim",
      });
    }

    const stressedGauge = serviceGauges.find((g) =>
      g.kind === "status"
        ? g.tone === "warn" || g.tone === "err"
        : g.fill >= 0.75,
    );
    if (stressedGauge) {
      signals.push({
        id: "service-pressure",
        label: "service pressure",
        value: stressedGauge.kind === "status"
          ? `${stressedGauge.label} reports ${stressedGauge.statusLabel.toLowerCase()}`
          : `${stressedGauge.label} is at ${Math.round(stressedGauge.fill * 100)}% of ${stressedGauge.unitLabel}`,
        tone: stressedGauge.kind === "status" ? stressedGauge.tone : "warn",
        route: { view: "ops" },
      });
    } else {
      signals.push({
        id: "service-pressure",
        label: "service pressure",
        value: "no usage pressure above threshold",
        tone: "ok",
        route: { view: "ops" },
      });
    }

    const briefArchiveRoute: Route = latestBriefing
      ? { view: "briefings", briefingId: latestBriefing.id }
      : fleetBrief?.sourceBriefId
        ? { view: "briefings", briefingId: fleetBrief.sourceBriefId }
        : { view: "briefings" };
    const briefMemoryValue = fleetBrief
      ? `prepared ${timeAgo(fleetBrief.preparedAt)} · expires ${formatTimeUntil(fleetBrief.expiresAt, nowMs)}`
      : latestBriefing
        ? `latest ${BRIEFING_KIND_LABEL[latestBriefing.kind]} prepared ${timeAgo(latestBriefing.preparedAt)} · archived`
        : briefArchiveLoaded
          ? "no generated brief loaded yet"
          : "checking brief archive...";

    signals.push({
      id: "brief-memory",
      label: "brief memory",
      value: briefMemoryValue,
      tone: fleetBriefIsFresh || latestBriefing || !briefArchiveLoaded ? "dim" : "warn",
      route: briefArchiveRoute,
    });

    return signals;
  }, [
    fleetBrief,
    fleetBriefIsFresh,
    briefArchiveLoaded,
    latestBriefing,
    movingAsksWithoutActiveAgent.length,
    nowMs,
    observedActiveActors.length,
    oldestNeedsTs,
    scrollToStaleMotion,
    serviceGauges,
    totalOperatorQueue,
    visibleStaleMotionItems.length,
  ]);

  const narrativeParts = useMemo(() => {
    const parts: string[] = [];
    if (active.length > 0)
      parts.push(`${active.length} agent${active.length === 1 ? " is" : "s are"} working now`);
    if (waiting.length > 0)
      parts.push(`${waiting.length} agent${waiting.length === 1 ? " is" : "s are"} available`);
    if (totalOperatorQueue > 0)
      parts.push(`${totalOperatorQueue} thing${totalOperatorQueue === 1 ? "" : "s"} need${totalOperatorQueue === 1 ? "s" : ""} you`);
    if (parts.length === 0 && agents.length > 0)
      parts.push(`${agents.length} agent${agents.length === 1 ? " is" : "s are"} registered`);
    if (parts.length === 0)
      parts.push("no agents are connected yet");
    return parts;
  }, [active, waiting, totalOperatorQueue, agents]);
  const syncLabel = loading
    ? "syncing"
    : error
      ? `sync issue · ${lastLoadedAt ? timeAgo(lastLoadedAt) : "waiting"}`
      : lastLoadedAt
        ? `updated ${timeAgo(lastLoadedAt)}`
        : "waiting";

  const briefSpeechText = useMemo(() => {
    if (!fleetBrief || !fleetBriefIsFresh) return "";
    const parts: string[] = [];
    const statement = fleetBrief.statement?.trim();
    if (statement) parts.push(statement);
    for (const obs of fleetBrief.observations ?? []) {
      const text = obs.text?.trim();
      if (text) parts.push(text);
    }
    return parts.join(". ");
  }, [fleetBrief, fleetBriefIsFresh]);

  const speakBrief = useCallback(() => {
    if (briefPlayer.speaking) {
      stopHomeBriefSpeech();
      return;
    }
    if (!fleetBrief || !briefSpeechText) return;
    startHomeBriefSpeech({ briefId: fleetBrief.id, text: briefSpeechText });
  }, [briefPlayer.speaking, briefSpeechText, fleetBrief]);

  const briefSpeakable = Boolean(briefSpeechText);
  const briefIsNew = Boolean(
    fleetBrief
      && fleetBriefIsFresh
      && fleetBrief.id !== briefPlayer.lastSpokenBriefId,
  );

  const heroProps = {
    now,
    greeting,
    operatorName,
    syncLabel,
    error,
    loading,
    refreshing,
    briefRefreshing,
    onRefresh: () => void load("manual"),
    onRegenerateBrief: () => void fetchFleetBrief(true),
    onSpeakBrief: briefSpeakable || briefPlayer.speaking ? speakBrief : undefined,
    briefSpeaking: briefPlayer.speaking,
    briefIsNew,
    totalOperatorQueue,
    narrativeParts,
    briefStatement: fleetBrief && fleetBriefIsFresh ? fleetBrief.statement : null,
    briefObservations: fleetBrief && fleetBriefIsFresh ? fleetBrief.observations ?? [] : [],
    navigate,
    opsEnabled,
    onReviewQueue: () => {
      const target = document.getElementById("home-needs-you");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    heartrate,
    heartrateWindow,
    heartrateBucketLabel,
    serviceGauges,
    systemSignals,
  };

  return (
    <div className="s-fleet-home">
      <div className="s-fleet-home-inner">
        {/* ── Hero briefing ──────────────────────────────────────── */}
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

        {/* ── Stale motion review ────────────────────────────────── */}
        {visibleStaleMotionItems.length > 0 && (
          <div className="s-fleet-section" id="home-stale-motion">
            <SectionRule
              label={`Stale motion · ${visibleStaleMotionItems.length}`}
              right={
                <button
                  type="button"
                  className="s-link-btn"
                  onClick={markAllStaleMotionInactive}
                >
                  mark all inactive
                </button>
              }
            />
            <div className="s-stale-motion-list">
              {visibleStaleMotionItems.map((item) => (
                <StaleMotionRow
                  key={item.agentId}
                  item={item}
                  navigate={navigate}
                  onMarkInactive={() => markStaleMotionInactive(item)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Activity stream ────────────────────────────────────── */}
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

        {/* ── Network signals (only when something demands attention) ─ */}
        {totalOperatorQueue > 0 && (
          <div className="s-fleet-section" id="home-needs-you">
            <SectionRule
              label={`Network signals · ${totalOperatorQueue}`}
              right={
                oldestNeedsTs !== null ? (
                  <span style={{ color: "var(--amber)" }}>
                    oldest {timeAgo(oldestNeedsTs)}
                  </span>
                ) : null
              }
            />

            {attentionItems.length > 0 ? (
              <OperatorAttentionQueue
                items={attentionItems}
                navigate={navigate}
                onResolved={(next) => setAttention(next)}
              />
            ) : needsYouAsks.length > 0 && (
              <div className="s-ask-grid">
                {needsYouAsks.slice(0, 4).map((ask) => (
                  <AskBlock
                    key={ask.invocationId}
                    ask={ask}
                    agents={agents}
                    navigate={navigate}
                    operatorName={operatorName}
                    pending
                  />
                ))}
              </div>
            )}

            {attentionItems.length === 0 && needsYouItems.length > 0 && (
              <div className="s-attention-list">
                {needsYouItems.map((item) => (
                  <AttentionRow
                    key={item.recordId}
                    item={item}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
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

function OperatorAttentionQueue({
  items,
  navigate,
  onResolved,
}: {
  items: OperatorAttentionItem[];
  navigate: (r: Route) => void;
  onResolved: (next: OperatorAttentionState) => void;
}) {
  return (
    <div className="s-operator-queue">
      <div className="s-operator-queue-head">
        <div>
          <div className="s-operator-queue-title">Operator queue</div>
          <div className="s-operator-queue-subtitle">
            Permissions, questions, and setup blockers in one place.
          </div>
        </div>
        <div className="s-operator-queue-count">{items.length}</div>
      </div>
      <div className="s-operator-queue-list">
        {items.map((item) => (
          <OperatorAttentionCard
            key={item.id}
            item={item}
            navigate={navigate}
            onResolved={onResolved}
          />
        ))}
      </div>
    </div>
  );
}

function severityLabel(severity: OperatorAttentionItem["severity"]): string {
  switch (severity) {
    case "critical":
      return "blocked";
    case "warning":
      return "needs input";
    default:
      return "review";
  }
}

function fallbackRouteFromAttention(item: OperatorAttentionItem): Route | null {
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

type RoutedOperatorAttentionAction = OperatorAttentionAction & { route: Route };

function routedAttentionActions(item: OperatorAttentionItem): RoutedOperatorAttentionAction[] {
  const explicit = item.actions.filter((action): action is RoutedOperatorAttentionAction =>
    (action.kind === "open" || action.kind === "configure") && Boolean(action.route),
  );
  if (explicit.length > 0) return explicit;

  const route = fallbackRouteFromAttention(item);
  return route ? [{ kind: "open", label: "Open", route }] : [];
}

function OperatorAttentionCard({
  item,
  navigate,
  onResolved,
}: {
  item: OperatorAttentionItem;
  navigate: (r: Route) => void;
  onResolved: (next: OperatorAttentionState) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | "dismiss" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyAction = item.actions.find((action) => action.kind === "copy" && action.value);
  const approve = item.actions.find((action) => action.kind === "approve");
  const deny = item.actions.find((action) => action.kind === "deny");
  const dismiss = item.actions.find((action) => action.kind === "dismiss");
  const routeActions = routedAttentionActions(item);

  const decide = async (decision: "approve" | "deny") => {
    if (!item.approval) return;
    setBusy(decision);
    setError(null);
    try {
      const next = await api<OperatorAttentionState>("/api/operator-attention/approvals/decide", {
        method: "POST",
        body: JSON.stringify({
          sessionId: item.approval.sessionId,
          turnId: item.approval.turnId,
          blockId: item.approval.blockId,
          version: item.approval.version,
          decision,
        }),
      });
      onResolved(next);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : String(decisionError));
    } finally {
      setBusy(null);
    }
  };

  const copyFix = () => {
    if (!copyAction?.value) return;
    void navigator.clipboard.writeText(copyAction.value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  const dismissItem = async () => {
    if (!dismiss?.unblockRequestId && !dismiss?.flightId && (!dismiss?.recordKind || !dismiss.recordId)) {
      setError("This queue item cannot be dismissed from here yet.");
      return;
    }
    setBusy("dismiss");
    setError(null);
    try {
      if (dismiss.unblockRequestId) {
        await dismissOperatorAttention({
          unblockRequestId: dismiss.unblockRequestId,
          itemUpdatedAt: item.updatedAt,
        });
      } else if (dismiss.flightId) {
        await dismissOperatorAttention({ flightId: dismiss.flightId, itemUpdatedAt: item.updatedAt });
      } else {
        const recordKind = dismiss.recordKind;
        const recordId = dismiss.recordId;
        if (!recordKind || !recordId) {
          throw new Error("This queue item cannot be dismissed from here yet.");
        }
        await dismissOperatorAttention({
          recordKind,
          recordId,
          itemUpdatedAt: item.updatedAt,
        });
      }
      const next = await api<OperatorAttentionState>("/api/operator-attention");
      onResolved(next);
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : String(dismissError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`s-operator-card s-operator-card--${item.severity}`}>
      <div className="s-operator-card-main">
        <div className="s-operator-card-top">
          <span className="s-eyebrow">{item.sourceLabel}</span>
          <span className="s-operator-card-severity">{severityLabel(item.severity)}</span>
          <span className="s-operator-card-age">{timeAgo(item.updatedAt)}</span>
        </div>
        <div className="s-operator-card-title">{item.title}</div>
        {item.summary && <div className="s-operator-card-summary">{item.summary}</div>}
        {item.detail && <div className="s-operator-card-detail">{item.detail}</div>}
        {item.agentName && (
          <div className="s-operator-card-meta">{item.agentName}</div>
        )}
        {error && <div className="s-operator-card-error">{error}</div>}
      </div>
      <div className="s-operator-card-actions">
        {approve && (
          <button
            type="button"
            className="s-icon-btn s-icon-btn--primary"
            disabled={Boolean(busy)}
            title="Approve"
            onClick={() => void decide("approve")}
          >
            <Check size={14} aria-hidden="true" />
            <span>{busy === "approve" ? "Approving" : approve.label}</span>
          </button>
        )}
        {deny && (
          <button
            type="button"
            className="s-icon-btn"
            disabled={Boolean(busy)}
            title="Deny"
            onClick={() => void decide("deny")}
          >
            <X size={14} aria-hidden="true" />
            <span>{busy === "deny" ? "Denying" : deny.label}</span>
          </button>
        )}
        {copyAction && (
          <button
            type="button"
            className="s-icon-btn"
            title={copyAction.label}
            onClick={copyFix}
          >
            <Copy size={14} aria-hidden="true" />
            <span>{copied ? "Copied" : copyAction.label}</span>
          </button>
        )}
        {routeActions.map((action, index) => (
          <button
            key={`${action.kind}:${action.label}:${index}`}
            type="button"
            className="s-icon-btn"
            title={action.label}
            onClick={() => navigate(action.route)}
          >
            {action.kind === "configure"
              ? <Settings size={14} aria-hidden="true" />
              : <ExternalLink size={14} aria-hidden="true" />}
            <span>{action.label}</span>
          </button>
        ))}
        {dismiss && (
          <button
            type="button"
            className="s-icon-btn"
            disabled={Boolean(busy)}
            title="Dismiss from queue"
            onClick={() => void dismissItem()}
          >
            <X size={14} aria-hidden="true" />
            <span>{busy === "dismiss" ? "Dismissing" : dismiss.label}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function AskBlock({
  ask,
  agents,
  navigate,
  operatorName,
  pending,
}: {
  ask: FleetAsk;
  agents: Agent[];
  navigate: (r: Route) => void;
  operatorName: string;
  pending: boolean;
}) {
  const fromAgent = agents.find((a) => a.id === ask.agentId);
  const fromName = fromAgent?.name ?? ask.agentName ?? ask.agentId;
  const route: Route = ask.conversationId
    ? { view: "conversation", conversationId: ask.conversationId }
    : { view: "agents", agentId: ask.agentId };

  return (
    <div
      className={`s-ask-block${pending ? " s-ask-block--pending" : ""}`}
      style={{ cursor: "pointer" }}
      onClick={() => navigate(route)}
    >
      <div className="s-ask-header">
        <span className="s-eyebrow s-ask-label">
          {pending ? "◌ ASK — ATTENTION" : "● ASK"}
        </span>
        <span style={{ flex: 1 }} />
        <span className="s-eyebrow">{timeAgo(ask.updatedAt)}</span>
      </div>
      <div className="s-ask-body">
        <div
          className="s-avatar s-avatar-sm"
          style={{ background: actorColor(fromName) }}
        >
          {fromName[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="s-ask-body-copy">
          <div className="s-ask-route">
            <span className="s-ask-route-name">{fromName}</span>
            <span> → </span>
            <span style={{ color: "var(--accent)" }}>{operatorName}</span>
          </div>
          <div className="s-ask-text">
            "{ask.summary ?? ask.task}"
          </div>
        </div>
      </div>
      {pending && (
        <div className="s-ask-actions">
          <button className="s-btn-fleet s-btn-fleet--primary">Answer</button>
          <button className="s-btn-fleet">Defer</button>
          <button className="s-btn-fleet">Route…</button>
          <span className="s-ask-thinking">
            <span className="s-thinking-strip" />
          </span>
        </div>
      )}
    </div>
  );
}

function AttentionRow({
  item,
  navigate,
}: {
  item: FleetAttentionItem;
  navigate: (r: Route) => void;
}) {
  const route: Route | null =
    item.kind === "work_item" && item.recordId
      ? { view: "work", workId: item.recordId }
      : item.conversationId
        ? { view: "conversation", conversationId: item.conversationId }
        : item.agentId
          ? { view: "agents", agentId: item.agentId }
          : null;

  const stateLabel =
    item.kind === "question" ? "question" : item.state.replace(/_/g, " ");
  const responseLabel =
    item.acceptanceState !== "none"
      ? item.kind === "question"
        ? item.acceptanceState.replace(/_/g, " ")
        : "agent-owned"
      : item.kind === "question"
        ? "awaiting answer"
        : "surfaced";
  const actionLabel =
    item.kind === "question"
      ? "answer"
      : item.state === "review"
        ? "view plan"
        : item.acceptanceState === "pending"
          ? "view signal"
          : "open work";

  return (
    <div
      className={`s-attention-row${route ? " s-attention-row--clickable" : ""}`}
      onClick={route ? () => navigate(route) : undefined}
    >
      <div className="s-attention-row-title">{item.title}</div>
      <div className="s-attention-row-meta">
        <span className="s-eyebrow">
          {item.kind === "work_item" ? "WORK ITEM" : "QUESTION"}
        </span>
        {item.agentName && <span>{item.agentName}</span>}
        <span>{stateLabel}</span>
        <span style={{ color: "var(--amber)" }}>{responseLabel}</span>
        <span style={{ marginLeft: "auto" }}>{timeAgo(item.updatedAt)}</span>
        {route && <span className="s-attention-row-action">{actionLabel} ↗</span>}
      </div>
      {item.summary && (
        <p className="s-attention-row-summary">{item.summary}</p>
      )}
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

function StaleMotionRow({
  item,
  navigate,
  onMarkInactive,
}: {
  item: StaleMotionItem;
  navigate: (r: Route) => void;
  onMarkInactive: () => void;
}) {
  const age = item.updatedAtMs > 0 ? timeAgo(item.updatedAtMs) : "unknown";
  const source = staleMotionSourceLabel(item);
  const summary = summarize(item.summary, 180);

  return (
    <div className="s-stale-motion-row">
      <button
        type="button"
        className="s-stale-motion-main"
        onClick={() => navigate(item.route)}
      >
        <span
          className="s-avatar s-avatar-sm"
          style={{ background: actorColor(item.agentName) }}
        >
          {item.agentName[0]?.toUpperCase() ?? "?"}
        </span>
        <span className="s-stale-motion-copy">
          <span className="s-stale-motion-name">{item.agentName}</span>
          <span className="s-stale-motion-meta">
            <span>last signal {age}</span>
            <span>{source}</span>
            <span>hidden after {formatLookback(MOVING_ACTIVE_WINDOW_MS)} idle</span>
          </span>
          {summary && <span className="s-stale-motion-summary">{summary}</span>}
        </span>
      </button>
      <div className="s-stale-motion-actions">
        <button
          type="button"
          className="s-icon-btn"
          title="Open stale source"
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
