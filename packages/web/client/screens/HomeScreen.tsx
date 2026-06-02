import "./fleet-home.css";
import "./activity-stream.css";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, ExternalLink, Loader2, Send, Settings, X } from "lucide-react";
import HomeHero, {
  type HomeHeroBriefObservation,
  type HomeHeroSignal,
  type ServiceGauge,
} from "./HomeHero.tsx";
import { DictationMic } from "../components/DictationMic.tsx";
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
import { usePersistentNumber } from "../lib/persistent-state.ts";
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
  ProjectLandscapeItem,
  ProjectLandscapeState,
  Route,
} from "../lib/types.ts";

type LookbackOption = { label: string; value: number; activityLimit: number };

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

type FleetHomeBrief = {
  id: string;
  statement: string;
  observations?: HomeHeroBriefObservation[];
  preparedAt: number;
  expiresAt: number;
  ttlMs: number;
  sourceBriefId?: string;
};

type FleetHomeAskResult = {
  ok: boolean;
  targetLabel: string;
  conversationId: string | null;
  messageId: string | null;
  flightId: string | null;
  invocationId: string | null;
  targetAgentId: string | null;
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
  return middleTruncate(segment, 24);
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

function diffFileLabel(changed: number | null | undefined): string {
  if (typeof changed !== "number") return "unknown";
  if (changed === 0) return "clean";
  return `${changed} changed`;
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

function routeForFleetAsk(ask: FleetAsk): Route {
  if (ask.conversationId) return { view: "conversation", conversationId: ask.conversationId };
  if (ask.collaborationRecordId) return { view: "work", workId: ask.collaborationRecordId };
  return { view: "agents", agentId: ask.agentId };
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
    flightId: string | null;
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
  checkpoint: {
    line: string;
    at: number;
  } | null;
  reply: {
    state: "none" | "delivered";
    deliveredAt: number | null;
  };
  routes: {
    open: Route;
    observe: Route | null;
  };
};

function compactIdentityLabel(agent: Agent | null | undefined, ask?: FleetAsk | null): string {
  if (agent?.handle) return `@${agent.handle}`;
  if (agent?.name) return agent.name;
  return ask?.agentName ?? ask?.agentId ?? "agent";
}

function formatElapsedCompact(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 10 && remSeconds > 0) return `${minutes}m${remSeconds}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 10 && remMinutes > 0) return `${hours}h${remMinutes}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function middleTruncate(value: string, max = 118): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.58);
  const tail = Math.floor((max - 1) * 0.42);
  return `${value.slice(0, head).trimEnd()}…${value.slice(value.length - tail).trimStart()}`;
}

function meaningfulCheckpoint(ask: FleetAsk | null | undefined, taskTitle: string): AgentWorkingCardData["checkpoint"] {
  const raw = ask?.summary?.trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, " ");
  if (!compact || compact === taskTitle) return null;
  if (/acknowledged via|queued for local execution|received the message/i.test(compact)) return null;
  const at = normalizeTimestampMs(ask?.updatedAt) ?? Date.now();
  return {
    line: summarize(compact, 120),
    at,
  };
}

function movingAskPriority(status: FleetAsk["status"]): number {
  if (status === "working") return 2;
  if (status === "queued") return 1;
  return 0;
}

function sortLaunchAgents(agents: Agent[]): Agent[] {
  return [...agents]
    .filter((agent) => !agent.retiredFromFleet)
    .sort((left, right) => {
      const leftState = normalizeAgentState(left.state);
      const rightState = normalizeAgentState(right.state);
      const leftRank = leftState === "available" ? 0 : leftState === "working" ? 1 : 2;
      const rightRank = rightState === "available" ? 0 : rightState === "working" ? 1 : 2;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.name.localeCompare(right.name);
    });
}

function buildAgentWorkingCardData(agent: Agent, ask: FleetAsk | null | undefined, nowMs: number): AgentWorkingCardData {
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
  const askStatus = ask?.status ?? "working";
  const agentWorking = normalizeAgentState(agent.state) === "working";
  const executionState: WorkingCardExecutionState =
    askStatus === "completed" ? "delivered"
      : askStatus === "failed" ? "failed"
        : askStatus === "queued" ? "queued"
          : agentWorking ? "working"
            : "idle";
  const openRoute = ask ? routeForFleetAsk(ask) : {
    view: "agents" as const,
    agentId: agent.id,
    conversationId: conversationForAgent(agent.id),
    tab: "observe" as const,
  };

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
      flightId: ask?.flightId ?? null,
      title: taskTitle,
      summary: ask?.summary ?? null,
      openedAt,
      status: askStatus,
    },
    execution: {
      state: executionState,
      lastEventAt,
      startedAt,
    },
    checkpoint: meaningfulCheckpoint(ask, taskTitle),
    reply: {
      state: askStatus === "completed" ? "delivered" : "none",
      deliveredAt: normalizeTimestampMs(ask?.completedAt),
    },
    routes: {
      open: openRoute,
      observe: {
        view: "agents",
        agentId: agent.id,
        conversationId: conversationForAgent(agent.id),
        tab: "observe",
      },
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

type HeartrateBucketView = {
  ts: number;
  count: number;
  value: number;
};

type LoadMode = "initial" | "background" | "manual";

function settledError(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === "fulfilled") return null;
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

export function HomeScreen({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const { agents: allAgents, onboarding, reload, route, setHomeContextSelection } = useScout();
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
  const [projectLandscape, setProjectLandscape] = useState<ProjectLandscapeState | null>(null);
  const [fleetBrief, setFleetBrief] = useState<FleetHomeBrief | null>(null);
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

    const [fleetResult, attentionResult, heartrateResult, agentsResult, landscapeResult] =
      await Promise.allSettled([
        api<FleetState>(`/api/fleet?${fleetQuery}`),
        api<OperatorAttentionState>("/api/operator-attention"),
        api<{
          windowLabel: string;
          bucketLabel?: string;
          buckets: HeartrateBucketView[];
        }>("/api/heartrate"),
        reload(),
        api<ProjectLandscapeState>("/api/project-landscape?limit=12"),
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
    if (landscapeResult.status === "fulfilled") {
      setProjectLandscape(landscapeResult.value);
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

  const fetchFleetBrief = useCallback(async (force = false) => {
    if (force) setBriefRefreshing(true);
    try {
      const path = force ? "/api/fleet/brief?refresh=1" : "/api/fleet/brief";
      const result = await api<FleetHomeBrief>(path);
      setFleetBrief(result);
    } catch {
      // Silent: the generated brief is additive; the computed status line remains available.
    } finally {
      if (force) setBriefRefreshing(false);
    }
  }, []);

  const briefPlayer = useHomeBriefPlayerState();

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

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
  const needsYouItems = useMemo(() => scopedFleet?.needsAttention ?? [], [scopedFleet]);
  const activeAskByAgent = useMemo(() => {
    const byAgent = new Map<string, FleetAsk>();
    for (const ask of movingAsks) {
      const current = byAgent.get(ask.agentId);
      const askPriority = movingAskPriority(ask.status);
      const currentPriority = current ? movingAskPriority(current.status) : -1;
      const askUpdatedAt = normalizeTimestampMs(ask.updatedAt) ?? 0;
      const currentUpdatedAt = normalizeTimestampMs(current?.updatedAt) ?? 0;
      if (!current || askPriority > currentPriority || (askPriority === currentPriority && askUpdatedAt > currentUpdatedAt)) {
        byAgent.set(ask.agentId, ask);
      }
    }
    return byAgent;
  }, [movingAsks]);
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const launchAgents = useMemo(
    () => sortLaunchAgents(agents),
    [agents],
  );
  const projectByAgentId = useMemo(() => {
    const projects = projectLandscape?.projects ?? [];
    const map = new Map<string, ProjectLandscapeItem>();
    for (const project of projects) {
      for (const agentId of project.agentIds) {
        map.set(agentId, project);
      }
    }
    return map;
  }, [projectLandscape?.projects]);
  const active = useMemo(
    () =>
      agents.filter((agent) =>
        normalizeAgentState(agent.state) === "working"
        || activeAskByAgent.get(agent.id)?.status === "working"
      ),
    [activeAskByAgent, agents],
  );
  const activeAgentIds = useMemo(
    () => new Set(active.map((agent) => agent.id)),
    [active],
  );
  const openAsksWithoutWorkingAgent = useMemo(
    () =>
      movingAsks.filter(
        (ask) => ask.status === "queued" || !activeAgentIds.has(ask.agentId),
      ),
    [activeAgentIds, movingAsks],
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

  const systemSignals = useMemo<HomeHeroSignal[]>(() => {
    const signals: HomeHeroSignal[] = [];

    if (totalOperatorQueue > 0) {
      signals.push({
        id: "attention-age",
        label: "needs review",
        value: oldestNeedsTs
          ? `oldest waiting ${timeAgo(oldestNeedsTs)}`
          : "operator queue has work",
        tone: "warn",
      });
    }

    if (openAsksWithoutWorkingAgent.length > 0) {
      signals.push({
        id: "open-tasks",
        label: openAsksWithoutWorkingAgent.length === 1 ? "open ask" : "open asks",
        value: openAsksWithoutWorkingAgent.length === 1
          ? "1 ask waiting for reply"
          : `${openAsksWithoutWorkingAgent.length} asks waiting for replies`,
        tone: "warn",
        onClick: () => {
          const firstAsk = openAsksWithoutWorkingAgent[0];
          setHomeContextSelection(firstAsk
            ? { kind: "ask", invocationId: firstAsk.invocationId }
            : { kind: "activity-log" });
        },
      });
    } else if (observedActiveActors.length > 0) {
      signals.push({
        id: "organic-work",
        label: observedActiveActors.length === 1 ? "organic actor" : "organic actors",
        value: `${observedActiveActors.length} outside managed roster`,
        tone: "ok",
        onClick: () => {
          const firstActor = observedActiveActors[0];
          setHomeContextSelection(firstActor
            ? { kind: "activity", activityId: firstActor.id }
            : { kind: "activity-log" });
        },
      });
    }

    return signals;
  }, [
    observedActiveActors.length,
    openAsksWithoutWorkingAgent.length,
    openAsksWithoutWorkingAgent,
    oldestNeedsTs,
    setHomeContextSelection,
    totalOperatorQueue,
    observedActiveActors,
  ]);

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
        {/* ── Token summary + recent activity ────────────────────── */}
        <HomeHero {...heroProps} />

        {/* ── Active agents ──────────────────────────────────────── */}
        <div className="s-fleet-section">
          <SectionRule
            label={`Active agents · ${active.length + observedActiveActors.length}`}
            right={
              <button
                className="s-link-btn"
                onClick={() => navigate({ view: "mesh" })}
              >
                open mesh ↗
              </button>
            }
          />
          {active.length > 0 || observedActiveActors.length > 0 ? (
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
                  project={projectByAgentId.get(agent.id) ?? null}
                  nowMs={nowMs}
                  onSelect={() => setHomeContextSelection({ kind: "agent", agentId: agent.id })}
                />
              ))}
              {observedActiveActors.map((actor) => (
                <ObservedActorCard
                  key={actor.id}
                  actor={actor}
                  nowMs={nowMs}
                  onSelect={() => setHomeContextSelection({ kind: "activity", activityId: actor.id })}
                />
              ))}
            </div>
          ) : (
            <ActiveAgentsLauncher
              agents={launchAgents}
              onCreated={(result, fallbackAgentId) => {
                const invocationId = result.invocationId?.trim();
                const targetAgentId = result.targetAgentId?.trim() || fallbackAgentId;
                if (invocationId) {
                  setHomeContextSelection({ kind: "ask", invocationId });
                } else if (targetAgentId) {
                  setHomeContextSelection({ kind: "agent", agentId: targetAgentId });
                }
                void load("manual");
              }}
            />
          )}
        </div>

        {/* ── Open jobs ───────────────────────────────────────────── */}
        {openAsksWithoutWorkingAgent.length > 0 && (
          <div className="s-fleet-section">
            <SectionRule
              label={`Open jobs · ${openAsksWithoutWorkingAgent.length}`}
            />
            <div className="s-moving-ask-list">
              {openAsksWithoutWorkingAgent.map((ask) => (
                <OpenAskRow
                  key={ask.invocationId}
                  ask={ask}
                  agent={agentById.get(ask.agentId) ?? null}
                  nowMs={nowMs}
                  onSelect={() => setHomeContextSelection({ kind: "ask", invocationId: ask.invocationId })}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Activity log ───────────────────────────────────────── */}
        <div className="s-fleet-section">
          <SectionRule
            label={`Activity log · ${liveActivity.length}${activityCapReached ? "+" : ""}`}
            right={
              <LookbackPicker
                value={lookbackMs}
                onChange={setLookbackMs}
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
                  onOpen={() => setHomeContextSelection({ kind: "activity", activityId: item.id })}
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
                    onSelect={() => setHomeContextSelection({ kind: "ask", invocationId: ask.invocationId })}
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
                    onSelect={() => setHomeContextSelection({ kind: "attention", recordId: item.recordId })}
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

function ActiveAgentsLauncher({
  agents,
  onCreated,
}: {
  agents: Agent[];
  onCreated: (result: FleetHomeAskResult, fallbackAgentId: string) => void;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState(() => agents[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agents[0]?.id ?? "");
  }, [agents, selectedAgentId]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    };
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (isEditable(event.target) && event.target !== textareaRef.current) return;
      const node = textareaRef.current;
      if (!node) return;
      event.preventDefault();
      node.focus();
      node.select();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const canSubmit = Boolean(selectedAgent && draft.trim() && !sending);
  const label = selectedAgent?.handle ?? selectedAgent?.name ?? selectedAgent?.id ?? "agent";
  const chipTitle = selectedAgent
    ? selectedAgent.name && selectedAgent.name !== label
      ? `${selectedAgent.name} (@${label})`
      : `@${label}`
    : "No agents available";
  const dataState: "idle" | "focus" | "typed" | "sending" | "error" = error
    ? "error"
    : sending
      ? "sending"
      : draft.trim()
        ? "typed"
        : "idle";

  const submit = async () => {
    if (!selectedAgent || !draft.trim() || sending) return;
    const body = draft.trim();
    setSending(true);
    setError(null);
    try {
      const result = await api<FleetHomeAskResult>("/api/scoutbot/actions/ask", {
        method: "POST",
        body: JSON.stringify({
          targetAgentId: selectedAgent.id,
          targetLabel: selectedAgent.handle ?? selectedAgent.name ?? selectedAgent.id,
          body,
        }),
      });
      setDraft("");
      onCreated(result, selectedAgent.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="s-active-empty"
      data-state={dataState}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="s-active-empty-main" title={chipTitle}>
        <span className="s-active-empty-led" aria-hidden="true" />
        <span className="s-active-empty-at" aria-hidden="true">@</span>
        <select
          className="s-active-empty-agent"
          value={selectedAgentId}
          onChange={(event) => setSelectedAgentId(event.target.value)}
          disabled={sending || agents.length === 0}
          aria-label="Agent"
        >
          {agents.length === 0 ? (
            <option value="">No agents</option>
          ) : agents.slice(0, 24).map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.handle || agent.name || agent.id}
            </option>
          ))}
        </select>
        <span className="s-active-empty-caret" aria-hidden="true">▾</span>
      </label>
      <textarea
        ref={textareaRef}
        className="s-active-empty-input"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && draft) {
            event.preventDefault();
            setDraft("");
            return;
          }
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void submit();
        }}
        rows={1}
        disabled={sending || agents.length === 0}
        placeholder={selectedAgent ? `Ask @${label}…` : "Start an ask…"}
      />
      <div className="s-active-empty-actions">
        <DictationMic
          className="s-active-empty-mic"
          disabled={sending || agents.length === 0}
          onAppend={(text) => setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))}
        />
        <button
          type="submit"
          className="s-active-empty-submit"
          disabled={!canSubmit}
          aria-label={selectedAgent ? `Ask @${label}` : "Ask agent"}
          title={selectedAgent ? `Ask @${label}` : "Ask agent"}
        >
          {sending ? (
            <Loader2 size={14} strokeWidth={1.8} className="s-active-empty-spin" aria-hidden="true" />
          ) : (
            <Send size={14} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      </div>
      {error && (
        <p className="s-active-empty-error" role="alert">{error}</p>
      )}
      <p className="s-active-empty-hint" aria-hidden="true">
        <kbd>↵</kbd> send · <kbd>⇧↵</kbd> newline · <kbd>⌘K</kbd> focus
      </p>
    </form>
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
  onSelect,
  operatorName,
  pending,
}: {
  ask: FleetAsk;
  agents: Agent[];
  navigate: (r: Route) => void;
  onSelect: () => void;
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
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => handleContextCardKey(event, onSelect)}
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
          <button
            type="button"
            className="s-btn-fleet s-btn-fleet--primary"
            onClick={(event) => {
              event.stopPropagation();
              navigate(route);
            }}
          >
            Answer
          </button>
          <button
            type="button"
            className="s-btn-fleet"
            onClick={(event) => event.stopPropagation()}
          >
            Defer
          </button>
          <button
            type="button"
            className="s-btn-fleet"
            onClick={(event) => {
              event.stopPropagation();
              navigate(route);
            }}
          >
            Route…
          </button>
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
  onSelect,
}: {
  item: FleetAttentionItem;
  navigate: (r: Route) => void;
  onSelect: () => void;
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
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => handleContextCardKey(event, onSelect)}
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
        {route && (
          <button
            type="button"
            className="s-attention-row-action"
            onClick={(event) => {
              event.stopPropagation();
              navigate(route);
            }}
          >
            {actionLabel} ↗
          </button>
        )}
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
  project,
  nowMs,
  onSelect,
}: {
  agent: Agent;
  ask?: FleetAsk | null;
  project?: ProjectLandscapeItem | null;
  nowMs: number;
  onSelect: () => void;
}) {
  const card = buildAgentWorkingCardData(agent, ask, nowMs);
  const projectRoot = project?.root ?? agent.projectRoot ?? card.cwd;
  const rootLabel = compactPath(projectRoot) ?? "no workspace root";
  const sessionLabel = compactSessionId(agent.harnessSessionId) ?? "none";
  const modelLabel = shortModelLabel(card.model);
  const contextLabel = contextLabelFromModel(card.model);
  const runtimeValue = contextLabel ?? modelLabel ?? card.harness ?? "unknown";
  const runtimeLabel = contextLabel ? "context" : modelLabel ? "model" : "runtime";
  const changedFiles = project?.diff?.changedFiles;
  const diffTone = project?.diff?.status === "dirty"
    ? "dirty"
    : project?.diff?.status === "clean"
      ? "clean"
      : "unknown";
  const diffMain = project?.diff?.error
    ? project.diff.error
    : typeof changedFiles === "number" && changedFiles > 0
      ? `${changedFiles} file${changedFiles === 1 ? "" : "s"} changed`
      : project?.diff?.status === "clean"
        ? "working tree clean"
        : "diff unavailable";
  const branchLabel = card.branch ?? project?.diff?.branch ?? project?.branches[0] ?? "no branch";
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

  return (
    <div
      role="button"
      tabIndex={0}
      className={`s-now-card s-now-card--${diffTone}`}
      onClick={onSelect}
      onKeyDown={(event) => handleContextCardKey(event, onSelect)}
    >
      <div className="s-now-card-top">
        <div className="s-now-card-main">
          <span className="s-now-card-kicker">
            {card.execution.state === "queued" ? "queued agent" : "active agent"}
          </span>
          <span className="s-now-card-name">{card.agentName}</span>
          <span className="s-now-card-root" title={projectRoot ?? undefined}>
            {rootLabel}
          </span>
        </div>
        <span className={`s-now-card-live s-now-card-live--${liveTone}`} title={liveLabel}>
          <span className="s-now-card-live-dot" aria-hidden="true" />
          {liveLabel}
        </span>
      </div>

      <div className="s-now-card-metrics" aria-label={`${card.agentName} active agent metrics`}>
        <MetricTile label="session" value={sessionLabel} />
        <MetricTile label="turn" value={turnAge} tone={card.task.openedAt ? "work" : "dim"} />
        <MetricTile
          label="repo diff"
          value={diffFileLabel(changedFiles)}
          tone={typeof changedFiles === "number" && changedFiles > 0 ? "warn" : "dim"}
        />
        <MetricTile label={runtimeLabel} value={runtimeValue} />
      </div>

      <div className="s-now-card-task">
        {card.task.title}
      </div>

      {checkpoint && (
        <div className="s-now-card-checkpoint">
          <span aria-hidden="true">↳</span>
          <span>{checkpoint}</span>
        </div>
      )}

      <div className="s-now-card-diff-row">
        <span className={`s-now-card-diff-led s-now-card-diff-led--${diffTone}`} aria-hidden="true" />
        <span className="s-now-card-diff-main">{diffMain}</span>
        <span className="s-now-card-branch" title={branchLabel}>{branchLabel}</span>
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
  onSelect,
}: {
  actor: FleetActivity;
  nowMs: number;
  onSelect: () => void;
}) {
  const name = actor.actorName ?? "—";
  const verb = activityVerb(actor.kind);
  const text = summarize(actor.title ?? actor.summary, 140);
  const sourceTag = inferActorSource(name);

  return (
    <div
      className="s-now-card s-now-card--observed s-now-card--unknown"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => handleContextCardKey(event, onSelect)}
    >
      <div className="s-now-card-top">
        <div className="s-now-card-main">
          <span className="s-now-card-kicker">observed actor</span>
          <span className="s-now-card-name">{name}</span>
          <span className="s-now-card-root">
            {sourceTag ? `${sourceTag} · ${verb}` : verb}
          </span>
        </div>
        <span className="s-now-card-live s-now-card-live--observed">
          <span className="s-now-card-live-dot" aria-hidden="true" />
          live
        </span>
      </div>

      <div className="s-now-card-metrics" aria-label={`${name} observed actor metrics`}>
        <MetricTile label="updated" value={formatAge(actor.ts, nowMs)} tone="work" />
        <MetricTile label="source" value={sourceTag ?? "unknown"} />
        <MetricTile label="kind" value={actor.kind.replace(/[._]/g, " ")} />
        <MetricTile label="session" value={compactSessionId(actor.sessionId) ?? "none"} />
      </div>

      <div className="s-now-card-task">{text || "(no recent text)"}</div>

      <div className="s-now-card-diff-row">
        <span className="s-now-card-diff-led s-now-card-diff-led--unknown" aria-hidden="true" />
        <span className="s-now-card-diff-main">unmanaged activity</span>
        <span className="s-now-card-branch">external</span>
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

function OpenAskRow({
  ask,
  agent,
  nowMs,
  onSelect,
}: {
  ask: FleetAsk;
  agent?: Agent | null;
  nowMs: number;
  onSelect: () => void;
}) {
  const openedAt = normalizeTimestampMs(ask.startedAt)
    ?? normalizeTimestampMs(ask.acknowledgedAt)
    ?? normalizeTimestampMs(ask.updatedAt);
  const elapsed = openedAt === null ? null : formatElapsedCompact(nowMs - openedAt);
  const branch = agent?.branch && agent.branch !== "main" ? agent.branch : null;
  const identity = [
    compactIdentityLabel(agent, ask),
    branch,
    ask.harness ?? agent?.harness,
  ].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className="s-moving-ask-row"
      onClick={onSelect}
    >
      <span className="s-moving-ask-agent">
        <span className={`s-moving-ask-dot s-moving-ask-dot--${ask.status}`} aria-hidden="true" />
        {identity}
      </span>
      <span className="s-moving-ask-title">
        {middleTruncate(ask.task)}
      </span>
      <span className="s-moving-ask-state">
        {ask.status === "queued" ? "queued" : "open"}
      </span>
      <span className="s-moving-ask-time">
        {elapsed ?? timeAgo(ask.updatedAt)}
      </span>
    </button>
  );
}

function LookbackPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="s-mc-window" role="group" aria-label="Lookback window">
      <span className="s-mc-window-label">
        Lookback
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
