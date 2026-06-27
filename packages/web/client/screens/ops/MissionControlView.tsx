import "./mission-control.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { api } from "../../lib/api.ts";
import { useCanvasMinimapRegistration } from "../../lib/canvas-minimap.tsx";
import {
  missionAgentMatchesQuery,
  clearMissionCanvasFocusRequest,
  clearMissionSelection,
  setMissionFocusedId,
  setMissionVisibleAgents,
  toggleMissionSelected,
  useMissionControlStore,
  type MissionActivityState,
  type MissionGroupMode,
} from "../../lib/mission-control-store.ts";
import { normalizeAgentState, isAgentBusy } from "../../lib/agent-state.ts";
import {
  useObservePolling,
  type ObserveCacheEntry,
} from "../../lib/observe.ts";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import {
  filterTailEventsForDisplay,
  observeKindFromTailEvent,
  observeTextFromTailEvent,
  observeToolFieldsFromTailEvent,
  tailObserveEventDetail,
} from "../../lib/tail-display.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import type {
  Agent,
  ObserveData,
  ObserveEvent,
  Route,
  SessionEntry,
  TailDiscoveredTranscript,
  TailDiscoverySnapshot,
  TailEvent,
} from "../../lib/types.ts";
import { FocusOverlay, Minimap, ObserveTile, type CanvasLayout } from "./MissionControlCanvas.tsx";
import {
  ACTIVE_EVENT_WINDOW_MS,
  CANVAS_PAD,
  FOCUS_TILE_MARGIN,
  GROUP_GAP_X,
  GROUP_GAP_Y,
  GROUP_LABEL_H,
  MAX_FOCUS_ZOOM,
  MIN_FOCUS_ZOOM,
  TILE_GAP,
  TILE_H,
  TILE_W,
  clamp,
} from "./mission-control-model.ts";

/* ── Viewport persistence ── */

const VP_KEY = "scout_mc_vp";

function saveViewport(vp: { pan: { x: number; y: number }; zoom: number }) {
  try {
    localStorage.setItem(VP_KEY, JSON.stringify(vp));
  } catch {}
}

function loadViewport(): { pan: { x: number; y: number }; zoom: number } | null {
  try {
    const raw = localStorage.getItem(VP_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (
      typeof v?.zoom === "number" &&
      typeof v?.pan?.x === "number" &&
      typeof v?.pan?.y === "number"
    ) {
      return v;
    }
  } catch {}
  return null;
}

/* ── Layout engine ── */

type LayoutTile = { agentId: string; x: number; y: number };
type LayoutGroup = { label: string; x: number; y: number; w: number; h: number; tiles: LayoutTile[] };
type CanvasSubject = {
  id: string;
  name: string;
  group: string;
  stateRank: number;
  activity: MissionActivityState;
  bandLabel: string;
  bandRank: number;
  lastActiveAt: number;
};
type NativeSessionModel = {
  id: string;
  transcript: TailDiscoveredTranscript;
  events: TailEvent[];
  agent: Agent;
  observe: ObserveData;
  lastActiveAt: number;
  current: boolean;
  recent: boolean;
};
type SubjectGroup = { label: string; subjects: CanvasSubject[] };

const ACTIVITY_CLUSTER_MAX_ROWS = 2;

function computeLayout(
  subjects: CanvasSubject[],
  groupMode: MissionGroupMode,
): CanvasLayout {
  const groups = groupSubjects(subjects, groupMode);
  if (groups.length === 0) return { groups: [], canvasW: 0, canvasH: 0 };
  if (groupMode === "activity") return computeActivityLayout(groups);

  return computeMasonryLayout(groups);
}

function computeMasonryLayout(groups: SubjectGroup[]): CanvasLayout {
  const targetCols = Math.max(1, Math.round(Math.sqrt(groups.length * 1.2)));
  const laid: LayoutGroup[] = [];
  const colHeights = new Array(targetCols).fill(CANVAS_PAD);
  const colX = Array.from({ length: targetCols }, (_, i) =>
    CANVAS_PAD + i * (TILE_W * 2 + TILE_GAP + GROUP_GAP_X),
  );

  for (const group of groups) {
    const shortestCol = colHeights.indexOf(Math.min(...colHeights));
    const x = colX[shortestCol];
    const y = colHeights[shortestCol];

    const cols = Math.min(2, group.subjects.length);
    const rows = Math.ceil(group.subjects.length / cols);
    const groupW = cols * TILE_W + (cols - 1) * TILE_GAP;
    const groupH = GROUP_LABEL_H + rows * TILE_H + (rows - 1) * TILE_GAP;

    const tiles: LayoutTile[] = group.subjects.map((subject, i) => ({
      agentId: subject.id,
      x: x + (i % cols) * (TILE_W + TILE_GAP),
      y: y + GROUP_LABEL_H + Math.floor(i / cols) * (TILE_H + TILE_GAP),
    }));

    laid.push({ label: group.label, x, y, w: groupW, h: groupH, tiles });
    colHeights[shortestCol] = y + groupH + GROUP_GAP_Y;
  }

  const canvasW = Math.max(...colX.map((cx) => cx + TILE_W * 2 + TILE_GAP)) + CANVAS_PAD;
  const canvasH = Math.max(...colHeights) + CANVAS_PAD;
  return { groups: laid, canvasW, canvasH };
}

function computeActivityLayout(groups: SubjectGroup[]): CanvasLayout {
  const laid: LayoutGroup[] = [];
  let y = CANVAS_PAD;
  let canvasW = CANVAS_PAD;

  for (const group of groups) {
    const rows = group.subjects.length <= ACTIVITY_CLUSTER_MAX_ROWS
      ? 1
      : ACTIVITY_CLUSTER_MAX_ROWS;
    const cols = Math.max(1, Math.ceil(group.subjects.length / rows));
    const groupW = cols * TILE_W + (cols - 1) * TILE_GAP;
    const groupH = GROUP_LABEL_H + rows * TILE_H + (rows - 1) * TILE_GAP;
    const x = CANVAS_PAD;

    const tiles: LayoutTile[] = group.subjects.map((subject, i) => ({
      agentId: subject.id,
      x: x + (i % cols) * (TILE_W + TILE_GAP),
      y: y + GROUP_LABEL_H + Math.floor(i / cols) * (TILE_H + TILE_GAP),
    }));

    laid.push({ label: group.label, x, y, w: groupW, h: groupH, tiles });
    canvasW = Math.max(canvasW, x + groupW);
    y += groupH + GROUP_GAP_Y;
  }

  return {
    groups: laid,
    canvasW: canvasW + CANVAS_PAD,
    canvasH: y - GROUP_GAP_Y + CANVAS_PAD,
  };
}

function activityRank(activity: MissionActivityState): number {
  switch (activity) {
    case "active":
      return 0;
    case "recent":
      return 1;
    default:
      return 2;
  }
}

function activityBand(
  current: boolean,
  lastActiveAt: number,
  now: number,
): { label: string; rank: number; activity: MissionActivityState } {
  if (current) return { label: "Live now", rank: 0, activity: "active" };
  if (lastActiveAt <= 0) return { label: "Idle", rank: 5, activity: "idle" };
  const age = Math.max(0, now - lastActiveAt);
  if (age <= 5 * 60_000) return { label: "Last 5m", rank: 1, activity: "recent" };
  if (age <= 30 * 60_000) return { label: "5-30m", rank: 2, activity: "recent" };
  if (age <= 4 * 60 * 60_000) return { label: "30m-4h", rank: 3, activity: "recent" };
  if (age <= 24 * 60 * 60_000) return { label: "4-24h", rank: 4, activity: "recent" };
  return { label: "Idle", rank: 5, activity: "idle" };
}

function subjectGroupLabel(
  subject: CanvasSubject,
  groupMode: MissionGroupMode,
): string {
  if (groupMode === "workspace") return subject.group;
  return subject.bandLabel;
}

function sortSubjectsByPriority(a: CanvasSubject, b: CanvasSubject): number {
  const ar = activityRank(a.activity);
  const br = activityRank(b.activity);
  if (ar !== br) return ar - br;
  if (a.lastActiveAt !== b.lastActiveAt) return b.lastActiveAt - a.lastActiveAt;
  if (a.stateRank !== b.stateRank) return a.stateRank - b.stateRank;
  return a.name.localeCompare(b.name);
}

function groupSortRank(group: SubjectGroup, groupMode: MissionGroupMode): number {
  if (groupMode === "activity") {
    return Math.min(...group.subjects.map((subject) => subject.bandRank));
  }
  return Math.min(...group.subjects.map((subject) => activityRank(subject.activity)));
}

function groupSubjects(
  subjects: CanvasSubject[],
  groupMode: MissionGroupMode,
): SubjectGroup[] {
  const sorted = [...subjects].sort((a, b) => {
    return sortSubjectsByPriority(a, b);
  });

  const byGroup = new Map<string, CanvasSubject[]>();
  for (const subject of sorted) {
    const label = subjectGroupLabel(subject, groupMode);
    if (!byGroup.has(label)) byGroup.set(label, []);
    byGroup.get(label)!.push(subject);
  }

  const groups: SubjectGroup[] = [];
  for (const [label, group] of byGroup) {
    groups.push({ label, subjects: group });
  }
  groups.sort((a, b) => {
    const rank = groupSortRank(a, groupMode) - groupSortRank(b, groupMode);
    if (rank !== 0) return rank;
    const activity = Math.max(...b.subjects.map((subject) => subject.lastActiveAt))
      - Math.max(...a.subjects.map((subject) => subject.lastActiveAt));
    if (activity !== 0) return activity;
    if (b.subjects.length !== a.subjects.length) return b.subjects.length - a.subjects.length;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

function agentSubject(
  agent: Agent,
  activity: { current: boolean; recent: boolean; lastActiveAt: number } | undefined,
  now: number,
): CanvasSubject {
  const stateOrder: Record<string, number> = { in_turn: 0, in_flight: 1, callable: 2, blocked: 3 };
  const state = normalizeAgentState(agent.state);
  const lastActiveAt = activity?.lastActiveAt ?? agent.updatedAt ?? 0;
  const band = activityBand(Boolean(activity?.current), lastActiveAt, now);
  return {
    id: agent.id,
    name: agent.name,
    group: agent.project ?? "unassigned",
    stateRank: stateOrder[state] ?? 1,
    activity: band.activity,
    bandLabel: band.label,
    bandRank: band.rank,
    lastActiveAt,
  };
}

function nativeSubject(session: NativeSessionModel, now: number): CanvasSubject {
  const band = activityBand(session.current, session.lastActiveAt, now);
  return {
    id: session.id,
    name: session.agent.name,
    group: `native ${session.transcript.source}`,
    stateRank: session.current ? 0 : 1,
    activity: band.activity,
    bandLabel: band.label,
    bandRank: band.rank,
    lastActiveAt: session.lastActiveAt,
  };
}

function sessionLastActivityByAgent(sessions: SessionEntry[]): Map<string, number> {
  const activity = new Map<string, number>();
  for (const session of sessions) {
    if (!session.agentId || !session.lastMessageAt) continue;
    activity.set(
      session.agentId,
      Math.max(activity.get(session.agentId) ?? 0, session.lastMessageAt),
    );
  }
  return activity;
}

function observeLastEventAt(observe: ObserveCacheEntry | undefined): number {
  const lastEventAt = Math.max(
    0,
    ...(observe?.data.events ?? [])
      .map((event) => event.at ?? 0)
      .filter((at) => Number.isFinite(at)),
  );
  if (lastEventAt > 0) return lastEventAt;

  const sessionStart = observe?.data.metadata?.session?.sessionStart;
  if (typeof sessionStart !== "number" || !Number.isFinite(sessionStart)) return 0;
  const lastEventT = Math.max(0, ...(observe?.data.events ?? []).map((event) => event.t));
  return lastEventT > 0 ? sessionStart + lastEventT * 1000 : sessionStart;
}

function agentLastActivityAt(
  agent: Agent,
  observe: ObserveCacheEntry | undefined,
  sessionsLastAt: Map<string, number>,
): number {
  return Math.max(
    sessionsLastAt.get(agent.id) ?? 0,
    observeLastEventAt(observe),
    isAgentBusy(agent.state) ? agent.updatedAt ?? 0 : 0,
  );
}

function isAgentCurrentlyActive(
  agent: Agent,
  observe: ObserveCacheEntry | undefined,
  now: number,
  lastActiveAt: number,
): boolean {
  const hasLiveSignal =
    isAgentBusy(agent.state) ||
    observe?.data.live === true ||
    (observe?.data.events ?? []).some((event) => event.live === true);
  return hasLiveSignal && lastActiveAt > 0 && now - lastActiveAt <= ACTIVE_EVENT_WINDOW_MS;
}

type ActivityInfo = { lastActiveAt: number; current: boolean; recent: boolean };

function missionActivityState(activity: ActivityInfo | undefined): MissionActivityState {
  if (activity?.current) return "active";
  if (activity?.recent) return "recent";
  return "idle";
}

function compareActivity(
  a: ActivityInfo | undefined,
  b: ActivityInfo | undefined,
): number {
  const rank = activityRank(missionActivityState(a)) - activityRank(missionActivityState(b));
  if (rank !== 0) return rank;
  return (b?.lastActiveAt ?? 0) - (a?.lastActiveAt ?? 0);
}

function compareAgentsByActivity(
  a: Agent,
  b: Agent,
  activityByAgent: Map<string, ActivityInfo>,
): number {
  const activity = compareActivity(activityByAgent.get(a.id), activityByAgent.get(b.id));
  if (activity !== 0) return activity;
  const stateOrder: Record<string, number> = { in_turn: 0, in_flight: 1, callable: 2, blocked: 3 };
  const state = (stateOrder[normalizeAgentState(a.state)] ?? 1)
    - (stateOrder[normalizeAgentState(b.state)] ?? 1);
  if (state !== 0) return state;
  return a.name.localeCompare(b.name);
}

function compareNativeSessionsByActivity(a: NativeSessionModel, b: NativeSessionModel): number {
  const activity = compareActivity(a, b);
  if (activity !== 0) return activity;
  return a.agent.name.localeCompare(b.agent.name);
}

function shortId(value: string | null | undefined): string {
  if (!value) return "session";
  return value.replace(/\.jsonl$/u, "").slice(0, 8);
}

function titleCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : "Native";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function nativeSessionId(transcript: TailDiscoveredTranscript): string {
  const sessionId = transcript.sessionId?.trim() || "session";
  return `native:${transcript.source}:${sessionId}:${stableHash(transcript.transcriptPath)}`;
}

// Only show the "transcript discovered" placeholder while the file is still
// genuinely fresh. Otherwise it reads as motion that isn't there — the same
// idle transcript keeps re-firing on every discovery poll, inflating the
// "something just happened" sentiment on /ops/control.
const NATIVE_DISCOVERED_FRESH_MS = 5 * 60_000;

function nativeObserveData(
  transcript: TailDiscoveredTranscript,
  events: TailEvent[],
  current: boolean,
): ObserveData {
  const tail = filterTailEventsForDisplay(events, "work").slice(-12);
  const observeEvents = tail.map((event, index): ObserveEvent => {
    const toolFields = observeToolFieldsFromTailEvent(event);
    return {
      id: event.id,
      t: index,
      kind: observeKindFromTailEvent(event),
      text: observeTextFromTailEvent(event, toolFields),
      tool: toolFields.tool,
      arg: toolFields.arg,
      result: toolFields.result,
      detail: tailObserveEventDetail(event, transcript),
      live: current && index === tail.length - 1,
    };
  });

  const placeholderEvents: ObserveEvent[] = observeEvents.length > 0
    ? observeEvents
    : (Date.now() - transcript.mtimeMs <= NATIVE_DISCOVERED_FRESH_MS
        ? [{
            id: `${nativeSessionId(transcript)}:discovered`,
            t: 0,
            kind: "system",
            text: `Native ${transcript.source} transcript discovered.`,
            detail: transcript.cwd ?? transcript.transcriptPath,
          }]
        : []);

  return {
    events: placeholderEvents,
    files: [],
    live: current,
    metadata: {
      session: {
        adapterType: transcript.source,
        externalSessionId: transcript.sessionId ?? undefined,
        threadPath: transcript.transcriptPath,
        cwd: transcript.cwd ?? undefined,
        originator: transcript.harness,
        source: "tail",
      },
    },
  };
}

function nativeSessionAgent(
  transcript: TailDiscoveredTranscript,
  lastActiveAt: number,
  current: boolean,
): Agent {
  return {
    id: nativeSessionId(transcript),
    definitionId: nativeSessionId(transcript),
    name: `${titleCase(transcript.source)} · ${transcript.project}`,
    handle: shortId(transcript.sessionId),
    agentClass: "native-session",
    harness: transcript.source,
    state: current ? "working" : "ready",
    projectRoot: transcript.cwd,
    cwd: transcript.cwd,
    updatedAt: lastActiveAt,
    createdAt: null,
    transport: "tail",
    selector: null,
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: null,
    capabilities: [],
    project: transcript.project,
    branch: transcript.harness === "unattributed" ? "native session" : transcript.harness,
    role: "native session",
    model: null,
    harnessSessionId: transcript.sessionId,
    terminalSurface: null,
    harnessLogPath: transcript.transcriptPath,
    conversationId: nativeSessionId(transcript),
    homeNodeId: null,
    homeNodeName: null,
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
    staleLocalRegistration: false,
    retiredFromFleet: false,
    replacedByAgentId: null,
  };
}

/* ── Main component ── */

export function MissionControlView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const mc = useMissionControlStore();
  const {
    activityFilter,
    sourceFilter,
    activityWindowMs,
    groupMode,
    query,
    focusedId,
    canvasFocusRequest,
  } = mc;
  const setFocusedId = setMissionFocusedId;
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [tailDiscovery, setTailDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [tailEvents, setTailEvents] = useState<TailEvent[]>([]);
  const [now, setNow] = useState(Date.now());
  const observeCache = useObservePolling(agents);

  useTailEvents((event) => {
    setTailEvents((previous) => {
      const next = previous.length >= 500
        ? [...previous.slice(previous.length - 499), event]
        : [...previous, event];
      return next;
    });
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [sessionResult, discoveryResult, recentTailResult] = await Promise.allSettled([
          api<SessionEntry[]>("/api/conversations"),
          api<TailDiscoverySnapshot>("/api/tail/discover"),
          api<{ events: TailEvent[] }>("/api/tail/recent?limit=500"),
        ]);
        if (cancelled) return;
        if (sessionResult.status === "fulfilled") setSessions(sessionResult.value);
        else setSessions([]);
        if (discoveryResult.status === "fulfilled") setTailDiscovery(discoveryResult.value);
        if (recentTailResult.status === "fulfilled") setTailEvents(recentTailResult.value.events ?? []);
      } catch {
        if (!cancelled) {
          setSessions([]);
          setTailDiscovery(null);
        }
      }
    };
    void load();
    // Server-side discovery cache is 30s and tail events arrive live via
    // `useTailEvents` — a 10s poll just triplicates the same snapshot.
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  /* ── Pan / zoom ── */
  const viewportRef = useRef<HTMLDivElement>(null);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const hasAnimated = useRef(false);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(([entry]) => {
      setVpSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  const sessionsLastAt = useMemo(() => sessionLastActivityByAgent(sessions), [sessions]);

  const activityByAgent = useMemo(() => {
    const map = new Map<string, ActivityInfo>();
    for (const agent of agents) {
      const observe = observeCache[agent.id];
      const lastActiveAt = agentLastActivityAt(agent, observe, sessionsLastAt);
      const current = isAgentCurrentlyActive(agent, observe, now, lastActiveAt);
      map.set(agent.id, {
        lastActiveAt,
        current,
        recent: current || (lastActiveAt > 0 && now - lastActiveAt <= activityWindowMs),
      });
    }
    return map;
  }, [activityWindowMs, agents, now, observeCache, sessionsLastAt]);

  const nativeSessions = useMemo(() => {
    const agentSessionIds = new Set(
      agents.flatMap((agent) => {
        const observe = observeCache[agent.id];
        return [
          agent.harnessSessionId?.trim(),
          observe?.sessionId?.trim(),
          observe?.data.metadata?.session?.externalSessionId?.trim(),
        ].filter((sessionId): sessionId is string => Boolean(sessionId));
      }),
    );
    const eventsBySession = new Map<string, TailEvent[]>();
    for (const event of tailEvents) {
      const bucket = eventsBySession.get(event.sessionId) ?? [];
      bucket.push(event);
      eventsBySession.set(event.sessionId, bucket);
    }

    return (tailDiscovery?.transcripts ?? [])
      .filter((transcript) => transcript.harness !== "scout-managed")
      .filter((transcript) => {
        const sessionId = transcript.sessionId?.trim();
        return !sessionId || !agentSessionIds.has(sessionId);
      })
      .slice(0, 80)
      .map((transcript): NativeSessionModel => {
        const events = transcript.sessionId ? eventsBySession.get(transcript.sessionId) ?? [] : [];
        const eventLastAt = Math.max(0, ...events.map((event) => event.ts));
        const lastActiveAt = Math.max(eventLastAt, transcript.mtimeMs);
        const current = lastActiveAt > 0 && now - lastActiveAt <= ACTIVE_EVENT_WINDOW_MS;
        const recent = current || (lastActiveAt > 0 && now - lastActiveAt <= activityWindowMs);
        const observe = nativeObserveData(transcript, events, current);
        return {
          id: nativeSessionId(transcript),
          transcript,
          events,
          agent: nativeSessionAgent(transcript, lastActiveAt, current),
          observe,
          lastActiveAt,
          current,
          recent,
        };
      });
  }, [activityWindowMs, agents, now, observeCache, tailDiscovery?.transcripts, tailEvents]);

  const visibleAgents = useMemo(() => {
    if (sourceFilter === "native") return [];
    let list = agents;
    if (activityFilter !== "all") {
      list = list.filter((agent) => {
        const activity = activityByAgent.get(agent.id);
        return activityFilter === "live" ? activity?.current : activity?.recent;
      });
    }
    if (query.trim()) {
      list = list.filter((agent) =>
        missionAgentMatchesQuery(
          {
            name: agent.name,
            handle: agent.handle,
            project: agent.project,
            branch: agent.branch,
            harness: agent.harness,
            id: agent.id,
          },
          query,
        ),
      );
    }
    return [...list].sort((a, b) => compareAgentsByActivity(a, b, activityByAgent));
  }, [activityByAgent, activityFilter, agents, query, sourceFilter]);

  const visibleNativeSessions = useMemo(() => {
    if (sourceFilter === "scout") return [];
    let list = nativeSessions;
    if (activityFilter !== "all") {
      list = list.filter((session) =>
        activityFilter === "live" ? session.current : session.recent
      );
    }
    if (query.trim()) {
      list = list.filter((session) =>
        missionAgentMatchesQuery(
          {
            name: session.agent.name,
            handle: session.agent.handle,
            project: session.agent.project,
            branch: session.agent.branch,
            harness: session.agent.harness,
            id: session.agent.id,
          },
          query,
        ),
      );
    }
    return [...list].sort(compareNativeSessionsByActivity);
  }, [activityFilter, nativeSessions, query, sourceFilter]);

  useEffect(() => {
    const merged = [
      ...visibleAgents.map((a) => ({
        activity: missionActivityState(activityByAgent.get(a.id)),
        lastActiveAt: activityByAgent.get(a.id)?.lastActiveAt ?? null,
        id: a.id,
        name: a.name,
        handle: a.handle,
        harness: a.harness,
        branch: a.branch,
        project: a.project,
        model: a.model,
        state: a.state,
        agentClass: a.agentClass,
        updatedAt: a.updatedAt,
        source: "scout" as const,
      })),
      ...visibleNativeSessions.map((s) => ({
        activity: s.current ? "active" as const : s.recent ? "recent" as const : "idle" as const,
        lastActiveAt: s.lastActiveAt,
        id: s.agent.id,
        name: s.agent.name,
        handle: s.agent.handle,
        harness: s.agent.harness,
        branch: s.agent.branch,
        project: s.agent.project,
        model: s.agent.model,
        state: s.agent.state,
        agentClass: s.agent.agentClass,
        updatedAt: s.agent.updatedAt,
        source: "native" as const,
      })),
    ].sort((a, b) => {
      const activity = compareActivity(
        { current: a.activity === "active", recent: a.activity !== "idle", lastActiveAt: a.lastActiveAt ?? 0 },
        { current: b.activity === "active", recent: b.activity !== "idle", lastActiveAt: b.lastActiveAt ?? 0 },
      );
      if (activity !== 0) return activity;
      return a.name.localeCompare(b.name);
    });
    setMissionVisibleAgents(merged);
  }, [activityByAgent, visibleAgents, visibleNativeSessions]);

  const canvasSubjects = useMemo(
    () => [
      ...visibleAgents.map((agent) => agentSubject(agent, activityByAgent.get(agent.id), now)),
      ...visibleNativeSessions.map((session) => nativeSubject(session, now)),
    ],
    [activityByAgent, now, visibleAgents, visibleNativeSessions],
  );

  const layout = useMemo(
    () => computeLayout(canvasSubjects, groupMode),
    [canvasSubjects, groupMode],
  );

  const animTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [canvasFocusHighlightId, setCanvasFocusHighlightId] = useState<string | null>(null);
  const consumedCanvasFocusSerialRef = useRef<number | null>(null);

  const triggerEntry = useCallback((useSaved = true) => {
    if (layout.canvasW === 0 || vpSize.w === 0) return;
    animTimers.current.forEach(clearTimeout);
    setCanvasFocusHighlightId(null);

    const fitZoom = Math.min(1, vpSize.w / layout.canvasW, vpSize.h / layout.canvasH);
    const overviewZoom = Math.max(0.15, Math.min(1, fitZoom * 0.92));
    setIsTransitioning(false);
    setZoom(overviewZoom);
    setPan({
      x: (vpSize.w - layout.canvasW * overviewZoom) / 2,
      y: Math.max(8, (vpSize.h - layout.canvasH * overviewZoom) / 2),
    });

    const t1 = setTimeout(() => {
      setIsTransitioning(true);
      const saved = useSaved ? loadViewport() : null;
      if (saved) {
        setPan(saved.pan);
        setZoom(saved.zoom);
      } else {
        setPan({ x: 24, y: 24 });
        setZoom(0.55);
      }
    }, 700);

    const t2 = setTimeout(() => setIsTransitioning(false), 1700);
    animTimers.current = [t1, t2];
  }, [layout, vpSize]);

  const fitAll = useCallback(() => {
    if (layout.canvasW === 0 || vpSize.w === 0) return;
    animTimers.current.forEach(clearTimeout);
    setCanvasFocusHighlightId(null);

    const fitZoom = Math.min(1, vpSize.w / layout.canvasW, vpSize.h / layout.canvasH);
    const overviewZoom = Math.max(0.15, Math.min(1, fitZoom * 0.92));
    setIsTransitioning(true);
    setZoom(overviewZoom);
    setPan({
      x: (vpSize.w - layout.canvasW * overviewZoom) / 2,
      y: Math.max(8, (vpSize.h - layout.canvasH * overviewZoom) / 2),
    });

    const timeout = setTimeout(() => setIsTransitioning(false), 500);
    animTimers.current = [timeout];
  }, [layout, vpSize]);

  useEffect(() => {
    if (layout.canvasW === 0 || vpSize.w === 0) return;
    if (hasAnimated.current) return;
    hasAnimated.current = true;
    triggerEntry(false);
  }, [layout, vpSize, triggerEntry]);

  /* ── Passive viewport save ── */
  useEffect(() => {
    const id = setInterval(() => {
      saveViewport({ pan, zoom });
    }, 30_000);
    return () => clearInterval(id);
  }, [pan, zoom]);

  const onPointerDown = useCallback(
    (e: ReactMouseEvent) => {
      if ((e.target as HTMLElement).closest(".s-mission-tile")) return;
      dragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const onPointerMove = useCallback((e: ReactMouseEvent) => {
    if (!dragging.current) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newZoom = Math.max(0.2, Math.min(2, zoom * factor));
      const ratio = newZoom / zoom;
      setPan((p) => ({
        x: mx - (mx - p.x) * ratio,
        y: my - (my - p.y) * ratio,
      }));
      setZoom(newZoom);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoom]);

  /* ── Keyboard shortcuts ── */
  const focusedAgent = focusedId
    ? (agents.find((a) => a.id === focusedId)
        ?? visibleNativeSessions.find((s) => s.agent.id === focusedId)?.agent
        ?? null)
    : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inEditable = target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.isContentEditable;
      if (inEditable) return;
      if (e.key === "Escape") {
        if (focusedId) {
          setFocusedId(null);
        } else if (mc.selectedIds.length > 0) {
          clearMissionSelection();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        if (mc.visibleAgents.length === 0) return;
        e.preventDefault();
        const ids = mc.visibleAgents.map((a) => a.id);
        // toggle: if everything already selected, clear; otherwise select all
        const allSelected = ids.length > 0 && ids.every((id) => mc.selectedIds.includes(id));
        if (allSelected) {
          clearMissionSelection();
        } else {
          for (const id of ids) {
            if (!mc.selectedIds.includes(id)) toggleMissionSelected(id);
          }
        }
        return;
      }
      if (e.key === "h" || e.key === "H") triggerEntry(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedAgent, focusedId, mc.selectedIds, mc.visibleAgents, triggerEntry]);

  /* ── Minimap click ── */
  const onMinimapClick = useCallback(
    (point: { x: number; y: number }) => {
      const vp = viewportRef.current;
      if (!vp) return;
      animTimers.current.forEach(clearTimeout);
      setCanvasFocusHighlightId(null);
      setPan({
        x: vp.clientWidth / 2 - point.x * zoom,
        y: vp.clientHeight / 2 - point.y * zoom,
      });
    },
    [zoom],
  );

  const tilePositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const g of layout.groups) {
      for (const t of g.tiles) map[t.agentId] = { x: t.x, y: t.y };
    }
    return map;
  }, [layout]);

  const focusCanvasSubject = useCallback((id: string): boolean => {
    const pos = tilePositions[id];
    if (!pos || vpSize.w === 0 || vpSize.h === 0) return false;

    animTimers.current.forEach(clearTimeout);
    const horizontalZoom = (vpSize.w - FOCUS_TILE_MARGIN * 2) / TILE_W;
    const verticalZoom = (vpSize.h - FOCUS_TILE_MARGIN * 2) / TILE_H;
    const nextZoom = clamp(
      Math.min(horizontalZoom, verticalZoom),
      MIN_FOCUS_ZOOM,
      MAX_FOCUS_ZOOM,
    );
    const nextPan = {
      x: vpSize.w / 2 - (pos.x + TILE_W / 2) * nextZoom,
      y: vpSize.h / 2 - (pos.y + TILE_H / 2) * nextZoom,
    };

    setIsTransitioning(true);
    setZoom(nextZoom);
    setPan(nextPan);
    setCanvasFocusHighlightId(id);

    const settle = setTimeout(() => setIsTransitioning(false), 650);
    const clearHighlight = setTimeout(() => setCanvasFocusHighlightId(null), 1800);
    animTimers.current = [settle, clearHighlight];
    return true;
  }, [tilePositions, vpSize]);

  useEffect(() => {
    if (!canvasFocusRequest) return;
    if (consumedCanvasFocusSerialRef.current === canvasFocusRequest.serial) return;
    if (!focusCanvasSubject(canvasFocusRequest.id)) return;
    consumedCanvasFocusSerialRef.current = canvasFocusRequest.serial;
    clearMissionCanvasFocusRequest(canvasFocusRequest.serial);
  }, [canvasFocusRequest, focusCanvasSubject]);

  const visibleTileCount = visibleAgents.length + visibleNativeSessions.length;
  const totalTileCount = agents.length + nativeSessions.length;
  const minimapAgents = useMemo(
    () => [...visibleAgents, ...visibleNativeSessions.map((session) => session.agent)],
    [visibleAgents, visibleNativeSessions],
  );
  const minimapRegistration = useMemo(
    () => visibleTileCount > 0 ? {
      id: "ops-control",
      render: ({ isCollapsed, onToggleCollapse }: { isCollapsed: boolean; onToggleCollapse: () => void }) => (
        <Minimap
          layout={layout}
          agents={minimapAgents}
          pan={pan}
          zoom={zoom}
          viewportRef={viewportRef}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
          onFitAll={fitAll}
          onHome={() => triggerEntry(false)}
          onClick={onMinimapClick}
        />
      ),
    } : null,
    [fitAll, layout, minimapAgents, onMinimapClick, pan, triggerEntry, visibleTileCount, zoom],
  );
  useCanvasMinimapRegistration(minimapRegistration);

  return (
    <div className="s-mission">
      <div
        ref={viewportRef}
        className="s-mission-viewport"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
      >
        {totalTileCount === 0 ? (
          <div className="s-mission-empty">
            <div className="s-mission-empty-title">No agents connected</div>
            <div className="s-mission-empty-sub">
              Agents appear here as they join the mesh.
            </div>
            <div className="s-mission-empty-hint">
              <code>scout watch --as myagent</code>
            </div>
          </div>
        ) : visibleTileCount === 0 ? (
          <div className="s-mission-empty">
            <div className="s-mission-empty-title">No matching sessions</div>
            <div className="s-mission-empty-sub">
              Try another activity filter or recent window.
            </div>
          </div>
        ) : (
          <div
            className="s-mission-canvas"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: isTransitioning
                ? "transform 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
                : "none",
            }}
          >
            {layout.groups.map((g) => (
              <div
                key={g.label}
                className={[
                  "s-mission-group-label",
                  g.label === "Live now" && "s-mission-group-label--active",
                  ["Last 5m", "5-30m", "30m-4h", "4-24h"].includes(g.label) && "s-mission-group-label--recent",
                ].filter(Boolean).join(" ")}
                style={{ left: g.x, top: g.y }}
              >
                {g.label} · {g.tiles.length}
              </div>
            ))}

            {visibleAgents.map((agent) => {
              const pos = tilePositions[agent.id];
              if (!pos) return null;
              const cached = observeCache[agent.id];
              const isSelected = mc.selectedIds.includes(agent.id);
              return (
                <ObserveTile
                  key={agent.id}
                  agent={agent}
                  observe={cached?.data ?? null}
                  x={pos.x}
                  y={pos.y}
                  selected={isSelected}
                  canvasFocused={canvasFocusHighlightId === agent.id}
                  onToggleSelected={() => toggleMissionSelected(agent.id)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) {
                      toggleMissionSelected(agent.id);
                    } else {
                      setFocusedId(agent.id);
                    }
                  }}
                />
              );
            })}
            {visibleNativeSessions.map((session) => {
              const pos = tilePositions[session.id];
              if (!pos) return null;
              const isSelected = mc.selectedIds.includes(session.id);
              return (
                <ObserveTile
                  key={session.id}
                  agent={session.agent}
                  observe={session.observe}
                  x={pos.x}
                  y={pos.y}
                  selected={isSelected}
                  canvasFocused={canvasFocusHighlightId === session.id}
                  onToggleSelected={() => toggleMissionSelected(session.id)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) {
                      toggleMissionSelected(session.id);
                    } else {
                      setFocusedId(session.id);
                    }
                  }}
                />
              );
            })}
          </div>
        )}

      </div>

      {focusedAgent && (
        <FocusOverlay
          agent={focusedAgent}
          observe={observeCache[focusedAgent.id]?.data ?? null}
          onClose={() => setFocusedId(null)}
          onSend={async (body, mode) => {
            if (mode === "ask") {
              await api<unknown>("/api/ask", {
                method: "POST",
                body: JSON.stringify({
                  body,
                  targetAgentId: focusedAgent.id,
                  targetLabel: focusedAgent.name,
                }),
              });
              return;
            }
            const conversationId = await ensureAgentChat(focusedAgent);
            await api<unknown>("/api/send", {
              method: "POST",
              body: JSON.stringify({
                body,
                chatId: conversationId,
              }),
            });
          }}
          onOpenConversation={() => {
            setFocusedId(null);
            void ensureAgentChat(focusedAgent)
              .then((conversationId) => {
                navigate({
                  view: "conversation",
                  conversationId,
                });
              })
              .catch(() => {
                navigate({
                  view: "agents-v2",
                  agentId: focusedAgent.id,
                  tab: "message",
                });
              });
          }}
          onTail={() => {
            setFocusedId(null);
            navigate({
              view: "ops",
              mode: "tail",
              tailQuery: focusedAgent.handle ?? focusedAgent.name,
            });
          }}
          onProfile={() => {
            setFocusedId(null);
            navigate({ view: "agents-v2", agentId: focusedAgent.id });
          }}
        />
      )}
    </div>
  );
}
