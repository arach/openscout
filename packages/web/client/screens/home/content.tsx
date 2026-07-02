import "./fleet-home.css";
import "./activity-stream.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Send } from "lucide-react";
import HomeHero, {
  type ServiceGauge,
} from "./HomeHero.tsx";
import { TailView } from "../shared/TailView.tsx";
import { api } from "../../lib/api.ts";
import { useObservePolling } from "../../lib/observe.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import {
  compareTimestampsDesc,
  normalizeTimestampMs,
  timeAgo,
} from "../../lib/time.ts";
import { actorColor } from "../../lib/colors.ts";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { usePersistentNumber } from "../../lib/persistent-state.ts";
import { useScout } from "../../scout/Provider.tsx";
import { routeMachineId } from "../../lib/router.ts";
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
  TailDiscoverySnapshot,
  TailEvent,
} from "../../lib/types.ts";
import {
  buildHomeNativeMovingLanes,
  HOME_MOVING_CARD_LIMIT,
  HOME_MOVING_WINDOW_MS,
  homeMovingDisplayCounts,
  homeMovingRecencyMs,
  isFreshHomeMovingTimestamp,
  isHomeAgentMoving,
  isHomeObserveCandidate,
  workingContextFromLane,
  workingContextFromObserve,
  type WorkingAgentContext,
} from "./home-moving.ts";
import { homeMovingGridClass, homeMovingLayout } from "./home-moving-layout.ts";
import { NowCard } from "./home-now-card.tsx";
import { isAgentLaneLive, type AgentLane } from "../ops/agent-lanes-model.ts";

type LookbackOption = { label: string; value: number; activityLimit: number };

const LOOKBACK_WINDOWS: LookbackOption[] = [
  { label: "30m", value: 30 * 60_000, activityLimit: 80 },
  { label: "6h", value: 6 * 60 * 60_000, activityLimit: 250 },
  { label: "24h", value: 24 * 60 * 60_000, activityLimit: 800 },
];
const DEFAULT_LOOKBACK_MS = LOOKBACK_WINDOWS[2].value;
const LOOKBACK_STORAGE_KEY = "openscout.home.lookbackMs.v1";
// Service-budget data is cached server-side, but short quota windows can reset
// while Home stays open. Poll lightly so reset chips do not sit expired.
const SERVICE_BUDGETS_REFRESH_MS = 5 * 60_000;
const LOCAL_TAIL_RECENT_LIMIT = 1000;
const LOCAL_TAIL_REFRESH_MS = 30_000;
const HEARTRATE_COMBINED_EVENT_THRESHOLD = 3;

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
  if (item.agentId) return { view: "agents-v2", agentId: item.agentId };
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

function routeForFleetAsk(ask: FleetAsk): Route {
  if (ask.conversationId) return { view: "conversation", conversationId: ask.conversationId };
  if (ask.collaborationRecordId) return { view: "work", workId: ask.collaborationRecordId };
  return { view: "agents-v2", agentId: ask.agentId };
}

type HeartrateBucketView = {
  ts: number;
  count: number;
  value: number;
};

type LoadMode = "initial" | "background" | "manual";

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
  const [tailDiscovery, setTailDiscovery] = useState<TailDiscoverySnapshot | null>(null);
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
      const [recent, discovery] = await Promise.all([
        api<{ events: TailEvent[] }>(`/api/tail/recent?${params.toString()}`),
        api<TailDiscoverySnapshot>("/api/tail/discover").catch(() => null),
      ]);
      setTailEvents(recent.events ?? []);
      if (discovery) setTailDiscovery(discovery);
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

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const movingAsks = useMemo(
    () =>
      (scopedFleet?.activeAsks ?? []).filter(
        (a) => a.status === "queued" || a.status === "working",
      ),
    [scopedFleet],
  );
  const freshMovingAsks = useMemo(
    () => movingAsks.filter((ask) => isFreshHomeMovingTimestamp(ask.updatedAt, nowMs)),
    [movingAsks, nowMs],
  );
  const movingAskByAgent = useMemo(() => {
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
  const observeCandidates = useMemo(
    () =>
      agents.filter((agent) =>
        isHomeObserveCandidate(
          agent,
          nowMs,
          movingAskByAgent.has(agent.id),
          tailEvents,
        ),
      ),
    [agents, movingAskByAgent, nowMs, tailEvents],
  );
  const observeCache = useObservePolling(observeCandidates);
  const workingAgents = useMemo(() => {
    const moving = agents.filter((agent) =>
      isHomeAgentMoving({
        agent,
        observeEntry: observeCache[agent.id],
        tailEvents,
        nowMs,
        movingAsk: movingAskByAgent.get(agent.id),
        windowMs: HOME_MOVING_WINDOW_MS,
      }),
    );
    return moving
      .sort((left, right) =>
        homeMovingRecencyMs(right, {
          observeEntry: observeCache[right.id],
          tailEvents,
          nowMs,
          movingAsk: movingAskByAgent.get(right.id),
        })
        - homeMovingRecencyMs(left, {
          observeEntry: observeCache[left.id],
          tailEvents,
          nowMs,
          movingAsk: movingAskByAgent.get(left.id),
        }),
      );
  }, [agents, movingAskByAgent, observeCache, tailEvents, nowMs]);
  const workingContext = useMemo(() => {
    const next: Record<string, WorkingAgentContext> = {};
    for (const agent of workingAgents) {
      next[agent.id] = workingContextFromObserve(observeCache[agent.id]?.data);
    }
    return next;
  }, [observeCache, workingAgents]);
  const workingAgentIds = useMemo(
    () => new Set(workingAgents.map((agent) => agent.id)),
    [workingAgents],
  );
  const nativeMovingLanes = useMemo<AgentLane[]>(() => {
    const lanes = buildHomeNativeMovingLanes({
      agents,
      tailEvents,
      transcripts: tailDiscovery?.transcripts ?? [],
      processes: tailDiscovery?.processes ?? [],
      observeCache,
      nowMs,
    });
    return lanes
      .filter((lane) => !workingAgentIds.has(lane.agent.id))
      .sort((left, right) => right.lastActiveAt - left.lastActiveAt);
  }, [agents, observeCache, nowMs, tailDiscovery, tailEvents, workingAgentIds]);
  const movingAsksWithoutWorkingAgent = useMemo(
    () =>
      freshMovingAsks.filter(
        (ask) => !workingAgents.some((agent) => agent.id === ask.agentId),
      ),
    [workingAgents, freshMovingAsks],
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
  const observedMovingActors = useMemo<FleetActivity[]>(() => {
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
    operatorName,
    syncLabel,
    error,
    loading,
    refreshing,
    onRefresh: handleRefresh,
    navigate,
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
  const movingDisplayCounts = homeMovingDisplayCounts({
    working: workingAgents.length,
    native: nativeMovingLanes.length,
    observed: observedMovingActors.length,
    movingAsks: movingAsksWithoutWorkingAgent.length,
    limit: HOME_MOVING_CARD_LIMIT,
  });
  const visibleWorkingAgents = workingAgents.slice(0, movingDisplayCounts.working);
  const visibleNativeMovingLanes = nativeMovingLanes.slice(0, movingDisplayCounts.native);
  const visibleObservedMovingActors = observedMovingActors.slice(0, movingDisplayCounts.observed);
  const movingCardCount = movingDisplayCounts.cardCount;
  const totalMovingCount = movingDisplayCounts.totalCount;
  const movingSectionLabel =
    totalMovingCount > movingCardCount && movingCardCount > 0
      ? `What's moving · ${movingCardCount} of ${totalMovingCount}`
      : `What's moving · ${totalMovingCount}`;
  const movingLayout = homeMovingLayout(movingCardCount);

  return (
    <div className="s-fleet-home">
      <div className="s-fleet-home-inner">
        {/* ── Home header ─────────────────────────────────────────── */}
        <HomeHero {...heroProps} />

        {/* ── What's moving ──────────────────────────────────────── */}
        {totalMovingCount > 0 && (
          <div className="s-fleet-section">
            <SectionRule
              label={movingSectionLabel}
              right={
                <button
                  className="s-link-btn"
                  onClick={() => navigate({ view: "mesh" })}
                >
                  open mesh ↗
                </button>
              }
            />
            {movingCardCount > 0 && (
              <HorizontalScrollFrame
                enabled={movingLayout === "strip"}
                className={homeMovingGridClass(movingLayout)}
                ariaLabel="Moving agents"
              >
                {visibleWorkingAgents.map((agent) => (
                  <NowCard
                    key={agent.id}
                    agent={agent}
                    ask={movingAskByAgent.get(agent.id) ?? null}
                    context={workingContext[agent.id] ?? null}
                    observeData={observeCache[agent.id]?.data ?? null}
                    observeLive={isAgentLaneLive(observeCache[agent.id]?.data)}
                    layout={movingLayout}
                    nowMs={nowMs}
                    navigate={navigate}
                  />
                ))}
                {visibleNativeMovingLanes.map((lane) => (
                  <NowCard
                    key={lane.id}
                    agent={lane.agent}
                    ask={null}
                    context={workingContextFromLane(lane)}
                    observeData={lane.observe}
                    observeLive={isAgentLaneLive(lane.observe)}
                    layout={movingLayout}
                    nowMs={nowMs}
                    navigate={navigate}
                  />
                ))}
                {visibleObservedMovingActors.map((actor) => (
                  <ObservedActorCard
                    key={actor.id}
                    actor={actor}
                    nowMs={nowMs}
                    navigate={navigate}
                  />
                ))}
              </HorizontalScrollFrame>
            )}
            {movingAsksWithoutWorkingAgent.length > 0 && (
              <div className="s-moving-ask-list">
                {movingAsksWithoutWorkingAgent.map((ask) => (
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

function HorizontalScrollFrame({
  enabled,
  className,
  ariaLabel,
  children,
}: {
  enabled: boolean;
  className: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ canLeft: false, canRight: false });

  const syncScrollState = useCallback(() => {
    const node = scrollerRef.current;
    if (!node || !enabled) {
      setScrollState({ canLeft: false, canRight: false });
      return;
    }

    const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
    setScrollState({
      canLeft: node.scrollLeft > 2,
      canRight: node.scrollLeft < maxScrollLeft - 2,
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const node = scrollerRef.current;
    if (!node) return;

    syncScrollState();
    node.addEventListener("scroll", syncScrollState, { passive: true });
    window.addEventListener("resize", syncScrollState);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncScrollState);
    resizeObserver?.observe(node);

    return () => {
      node.removeEventListener("scroll", syncScrollState);
      window.removeEventListener("resize", syncScrollState);
      resizeObserver?.disconnect();
    };
  }, [enabled, syncScrollState, children]);

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    const distance = Math.max(280, Math.floor(node.clientWidth * 0.82));
    node.scrollBy({ left: distance * direction, behavior: "smooth" });
    window.requestAnimationFrame(syncScrollState);
    window.setTimeout(syncScrollState, 260);
  }, [syncScrollState]);

  if (!enabled) {
    return (
      <div className={className} aria-label={ariaLabel}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={[
        "s-moving-scroll",
        scrollState.canLeft && "s-moving-scroll--can-left",
        scrollState.canRight && "s-moving-scroll--can-right",
      ].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        className="s-moving-scroll-btn s-moving-scroll-btn--left"
        aria-label="Scroll moving agents left"
        disabled={!scrollState.canLeft}
        onClick={() => scrollByPage(-1)}
      >
        <ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <div ref={scrollerRef} className={className} aria-label={ariaLabel}>
        {children}
      </div>
      <button
        type="button"
        className="s-moving-scroll-btn s-moving-scroll-btn--right"
        aria-label="Scroll moving agents right"
        disabled={!scrollState.canRight}
        onClick={() => scrollByPage(1)}
      >
        <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}

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
        ? { view: "agents-v2", agentId: actor.agentId }
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
  if (lower.includes("grok")) return "grok";
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
    const aRank = aState === "callable" ? 0 : (aState === "in_turn" || aState === "in_flight") ? 1 : 2;
    const bRank = bState === "callable" ? 0 : (bState === "in_turn" || bState === "in_flight") ? 1 : 2;
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
      const conversationId = result.conversationId ?? selectedAgent.conversationId;
      navigate(conversationId
        ? { view: "conversation", conversationId }
        : { view: "agents-v2", agentId: selectedAgent.id, tab: "message" });
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
