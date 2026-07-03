import { isAgentBusy } from "../../lib/agent-state.ts";
import type { ObserveCacheEntry } from "../../lib/observe.ts";
import { normalizeTimestampMs } from "../../lib/time.ts";
import type {
  Agent,
  FleetAsk,
  ObserveData,
  TailDiscoveredProcess,
  TailDiscoveredTranscript,
  TailEvent,
} from "../../lib/types.ts";
import {
  buildAgentLanes,
  isAgentLaneLive,
  observeLastSubstantiveActivityAt,
  shouldPollAgentForLaneObserve,
  type AgentLane,
} from "../ops/agent-lanes-model.ts";

export const HOME_MOVING_WINDOW_MS = 30 * 60_000;
export const HOME_MOVING_HORIZON = "30m" as const;

export type WorkingAgentContext = {
  sessionId: string | null;
  model: string | null;
  contextPct: number | null;
};

export function isFreshHomeMovingTimestamp(
  timestamp: number | null | undefined,
  nowMs: number,
  windowMs = HOME_MOVING_WINDOW_MS,
): boolean {
  const timestampMs = normalizeTimestampMs(timestamp);
  return timestampMs !== null && nowMs - timestampMs <= windowMs;
}

/** Map Scout harness ids to tail `source` labels (e.g. grok-acp/pi → grok). */
export function harnessTailSource(harness: string | null | undefined): string | null {
  const normalized = harness?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "pi" || normalized === "grok-acp" || normalized === "grok") return "grok";
  return normalized;
}

export function isHomeObserveCandidate(
  agent: Agent,
  nowMs: number,
  hasMovingAsk: boolean,
  tailEvents: TailEvent[] = [],
): boolean {
  if (hasMovingAsk) return true;
  if (isAgentBusy(agent.state)) return true;
  if (shouldPollAgentForLaneObserve(agent, nowMs, HOME_MOVING_HORIZON)) return true;
  if (agentHasRecentTailActivity(agent, tailEvents, nowMs)) return true;
  return false;
}

function tailEventMatchesAgentHarness(agent: Agent, event: TailEvent): boolean {
  const agentSource = harnessTailSource(agent.harness);
  if (!agentSource) return false;
  return agentSource === event.source?.trim().toLowerCase();
}

export function agentHasRecentTailActivity(
  agent: Agent,
  tailEvents: TailEvent[],
  nowMs: number,
  windowMs = HOME_MOVING_WINDOW_MS,
): boolean {
  const sessionId = agent.harnessSessionId?.trim();
  if (!sessionId) return false;

  const cutoff = nowMs - windowMs;
  return tailEvents.some((event) => {
    const ts = normalizeTimestampMs(event.ts);
    if (ts === null || ts < cutoff) return false;
    if (!tailEventMatchesAgentHarness(agent, event)) return false;
    const eventSessionId = event.sessionId?.trim();
    return Boolean(eventSessionId && eventSessionId === sessionId);
  });
}

export function isHomeAgentMoving(input: {
  agent: Agent;
  observeEntry?: ObserveCacheEntry | null;
  tailEvents: TailEvent[];
  nowMs: number;
  movingAsk?: FleetAsk | null;
  windowMs?: number;
}): boolean {
  const {
    agent,
    observeEntry,
    tailEvents,
    nowMs,
    movingAsk,
    windowMs = HOME_MOVING_WINDOW_MS,
  } = input;

  if (movingAsk) return true;

  const observeData = observeEntry?.data;
  if (isAgentLaneLive(observeData)) return true;

  const observeAt = observeLastSubstantiveActivityAt(observeData);
  if (observeAt !== null && nowMs - observeAt <= windowMs) return true;

  if (agentHasRecentTailActivity(agent, tailEvents, nowMs, windowMs)) return true;

  if (isAgentBusy(agent.state) && isFreshHomeMovingTimestamp(agent.updatedAt, nowMs, windowMs)) {
    return true;
  }

  return false;
}

export function workingContextFromObserve(
  observeData: ObserveData | null | undefined,
  fallback?: { sessionId?: string | null; model?: string | null },
): WorkingAgentContext {
  const session = observeData?.metadata?.session;
  const usage = observeData?.metadata?.usage;
  const contextInput = usage?.contextInputTokens;
  const window = usage?.contextWindowTokens;
  const contextPct = typeof contextInput === "number" && typeof window === "number" && window > 0
    ? Math.min(100, Math.round((contextInput / window) * 100))
    : null;
  return {
    sessionId: session?.externalSessionId ?? fallback?.sessionId ?? null,
    model: session?.model ?? fallback?.model ?? null,
    contextPct,
  };
}

export function workingContextFromLane(lane: AgentLane): WorkingAgentContext {
  return workingContextFromObserve(lane.observe, {
    sessionId: lane.agent.harnessSessionId,
    model: lane.facts?.model ?? lane.agent.model,
  });
}

/** Identity of the underlying harness session an observe payload resolved to. */
export function observedSessionKey(
  entry: Pick<ObserveCacheEntry, "sessionId" | "historyPath" | "data"> | null | undefined,
): string | null {
  if (!entry) return null;
  const sessionId = entry.sessionId?.trim()
    || entry.data?.metadata?.session?.externalSessionId?.trim();
  if (sessionId) return `session:${sessionId}`;
  const historyPath = entry.historyPath?.trim()
    || entry.data?.metadata?.session?.threadPath?.trim();
  if (historyPath) return `history:${historyPath}`;
  return null;
}

export function laneObservedSessionKey(lane: AgentLane): string | null {
  const session = lane.observe?.metadata?.session;
  const sessionId = session?.externalSessionId?.trim();
  if (sessionId) return `session:${sessionId}`;
  const threadPath = session?.threadPath?.trim();
  if (threadPath) return `history:${threadPath}`;
  return null;
}

function agentOwnsObservedSession(
  agent: Agent,
  entry: ObserveCacheEntry | undefined,
): boolean {
  const observed = entry?.sessionId?.trim()
    || entry?.data?.metadata?.session?.externalSessionId?.trim();
  const own = agent.harnessSessionId?.trim();
  return Boolean(observed && own && observed === own);
}

/* Stale agent records in a project all fall back to the same newest discovered
   transcript, so without this they render as N identical rows (same context %,
   same last line). One observed session gets one row: the agent that actually
   owns the session wins, else the caller's order (recency) decides. Agents
   whose observe payload has no session identity pass through untouched. */
export function dedupeWorkingAgentsByObservedSession(
  agents: Agent[],
  observeCache: Record<string, ObserveCacheEntry | undefined>,
): Agent[] {
  const keptIndexByKey = new Map<string, number>();
  const result: Agent[] = [];
  for (const agent of agents) {
    const entry = observeCache[agent.id];
    const key = observedSessionKey(entry);
    if (!key) {
      result.push(agent);
      continue;
    }
    const keptIndex = keptIndexByKey.get(key);
    if (keptIndex === undefined) {
      keptIndexByKey.set(key, result.length);
      result.push(agent);
      continue;
    }
    const kept = result[keptIndex]!;
    if (!agentOwnsObservedSession(kept, observeCache[kept.id]) && agentOwnsObservedSession(agent, entry)) {
      result[keptIndex] = agent;
    }
  }
  return result;
}

export function homeMovingRecencyMs(
  agent: Agent,
  input: {
    observeEntry?: ObserveCacheEntry | null;
    tailEvents: TailEvent[];
    nowMs: number;
    movingAsk?: FleetAsk | null;
  },
): number {
  const { observeEntry, tailEvents, nowMs, movingAsk } = input;
  if (movingAsk) {
    return normalizeTimestampMs(movingAsk.updatedAt) ?? nowMs;
  }
  if (isAgentLaneLive(observeEntry?.data)) return nowMs;
  const observeAt = observeLastSubstantiveActivityAt(observeEntry?.data);
  if (observeAt !== null) return observeAt;
  const sessionId = agent.harnessSessionId?.trim();
  const agentSource = harnessTailSource(agent.harness);
  let latestTail = 0;
  if (sessionId) {
    for (const event of tailEvents) {
      if (agentSource && event.source !== agentSource) continue;
      if (event.sessionId?.trim() !== sessionId) continue;
      const ts = normalizeTimestampMs(event.ts);
      if (ts !== null) latestTail = Math.max(latestTail, ts);
    }
  }
  if (latestTail > 0) return latestTail;
  return normalizeTimestampMs(agent.updatedAt) ?? 0;
}

export const HOME_MOVING_CARD_LIMIT = 9;

export type HomeMovingDisplayCounts = {
  working: number;
  native: number;
  observed: number;
  cardCount: number;
  totalCount: number;
};

export function homeMovingDisplayCounts(input: {
  working: number;
  native: number;
  observed: number;
  movingAsks?: number;
  limit?: number;
}): HomeMovingDisplayCounts {
  const limit = Math.max(0, input.limit ?? HOME_MOVING_CARD_LIMIT);
  const workingTotal = Math.max(0, input.working);
  const nativeTotal = Math.max(0, input.native);
  const observedTotal = Math.max(0, input.observed);
  const movingAskTotal = Math.max(0, input.movingAsks ?? 0);
  const working = Math.min(workingTotal, limit);
  const native = Math.min(nativeTotal, Math.max(0, limit - working));
  const observed = Math.min(observedTotal, Math.max(0, limit - working - native));

  return {
    working,
    native,
    observed,
    cardCount: working + native + observed,
    totalCount: workingTotal + nativeTotal + observedTotal + movingAskTotal,
  };
}

export function buildHomeNativeMovingLanes(input: {
  agents: Agent[];
  tailEvents: TailEvent[];
  transcripts: TailDiscoveredTranscript[];
  processes?: TailDiscoveredProcess[];
  observeCache?: Record<string, ObserveCacheEntry | undefined>;
  nowMs: number;
}): AgentLane[] {
  const { lanes } = buildAgentLanes({
    transcripts: input.transcripts,
    tailEvents: input.tailEvents,
    processes: input.processes ?? [],
    scoutAgents: input.agents,
    observeCache: input.observeCache ?? {},
    now: input.nowMs,
    workingOnly: true,
    horizon: HOME_MOVING_HORIZON,
  });
  return lanes.filter((lane) => lane.source === "native");
}
