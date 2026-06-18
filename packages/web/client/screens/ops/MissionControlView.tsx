import "./mission-control.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronDown, ChevronUp, Crosshair, Maximize2 } from "lucide-react";
import { actorColor } from "../../lib/colors.ts";
import { api } from "../../lib/api.ts";
import { useCanvasMinimapRegistration } from "../../lib/canvas-minimap.tsx";
import { useFocusTrap } from "../../lib/keyboard-nav.ts";
import { timeAgo } from "../../lib/time.ts";
import { statusOnHover } from "../../lib/page-status.ts";
import {
  MISSION_RECENT_WINDOWS,
  missionAgentMatchesQuery,
  clearMissionCanvasFocusRequest,
  setMissionActivityFilter,
  setMissionFocusedId,
  setMissionGroupMode,
  setMissionQuery,
  setMissionRecentWindow,
  setMissionSourceFilter,
  setMissionVisibleAgents,
  toggleMissionSelected,
  clearMissionSelection,
  useMissionControlStore,
  type MissionActivityState,
  type MissionGroupMode,
} from "../../lib/mission-control-store.ts";
import { normalizeAgentState, agentStateLabel, isAgentBusy } from "../../lib/agent-state.ts";
import {
  summarizeObserveEvent,
  useObservePolling,
  type ObserveCacheEntry,
} from "../../lib/observe.ts";
import { conversationForAgent } from "../../lib/router.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import { DictationMic } from "../../components/DictationMic.tsx";
import { VantageHandoffButton } from "../../components/VantageHandoffButton.tsx";
import { type SessionObserveData } from "../sessions/SessionObserve.tsx";
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

/* ── Constants ── */

const TILE_W = 420;
const TILE_H = 320;
const TILE_GAP = 20;
const GROUP_GAP_X = 48;
const GROUP_GAP_Y = 36;
const GROUP_LABEL_H = 28;
const CANVAS_PAD = 40;
const FOCUS_TILE_MARGIN = 72;
const MIN_FOCUS_ZOOM = 0.35;
const MAX_FOCUS_ZOOM = 1.15;

const MINIMAP_FALLBACK_W = 244;
const MINIMAP_MAX_H = 160;
const ACTIVE_EVENT_WINDOW_MS = 60_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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
type CanvasLayout = { groups: LayoutGroup[]; canvasW: number; canvasH: number };
type CanvasSubject = {
  id: string;
  name: string;
  group: string;
  stateRank: number;
  activity: MissionActivityState;
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

function computeLayout(
  subjects: CanvasSubject[],
  groupMode: MissionGroupMode,
  recentLabel: string,
): CanvasLayout {
  const groups = groupSubjects(subjects, groupMode, recentLabel);
  if (groups.length === 0) return { groups: [], canvasW: 0, canvasH: 0 };

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

type SubjectGroup = { label: string; subjects: CanvasSubject[] };

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

function subjectGroupLabel(
  subject: CanvasSubject,
  groupMode: MissionGroupMode,
  recentLabel: string,
): string {
  if (groupMode === "workspace") return subject.group;
  if (subject.activity === "active") return "Active now";
  if (subject.activity === "recent") return `Recent ${recentLabel}`;
  return subject.group;
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
    if (group.label === "Active now") return 0;
    if (group.label.startsWith("Recent ")) return 1;
  }
  return Math.min(...group.subjects.map((subject) => activityRank(subject.activity)));
}

function groupSubjects(
  subjects: CanvasSubject[],
  groupMode: MissionGroupMode,
  recentLabel: string,
): SubjectGroup[] {
  const sorted = [...subjects].sort((a, b) => {
    return sortSubjectsByPriority(a, b);
  });

  const byGroup = new Map<string, CanvasSubject[]>();
  for (const subject of sorted) {
    const label = subjectGroupLabel(subject, groupMode, recentLabel);
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
): CanvasSubject {
  const stateOrder: Record<string, number> = { in_turn: 0, in_flight: 1, callable: 2, blocked: 3 };
  const state = normalizeAgentState(agent.state);
  const activityState = activity?.current ? "active" : activity?.recent ? "recent" : "idle";
  return {
    id: agent.id,
    name: agent.name,
    group: agent.project ?? "unassigned",
    stateRank: stateOrder[state] ?? 1,
    activity: activityState,
    lastActiveAt: activity?.lastActiveAt ?? agent.updatedAt ?? 0,
  };
}

function nativeSubject(session: NativeSessionModel): CanvasSubject {
  return {
    id: session.id,
    name: session.agent.name,
    group: `native ${session.transcript.source}`,
    stateRank: session.current ? 0 : 1,
    activity: session.current ? "active" : session.recent ? "recent" : "idle",
    lastActiveAt: session.lastActiveAt,
  };
}

function sessionCountsByAgent(sessions: SessionEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (!session.agentId) continue;
    counts.set(session.agentId, (counts.get(session.agentId) ?? 0) + 1);
  }
  return counts;
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
): boolean {
  return (
    isAgentBusy(agent.state) ||
    observe?.data.live === true ||
    (observe?.data.events ?? []).some((event) => event.live === true)
  );
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

function tailEventKindToObserveKind(kind: TailEvent["kind"]): ObserveEvent["kind"] {
  switch (kind) {
    case "assistant":
      return "message";
    case "tool":
    case "tool-result":
      return "tool";
    case "user":
      return "ask";
    case "system":
      return "system";
    default:
      return "note";
  }
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
  const tail = events.slice(-12);
  const observeEvents = tail.map((event, index): ObserveEvent => ({
    id: event.id,
    t: index,
    kind: tailEventKindToObserveKind(event.kind),
    text: event.summary,
    tool: event.kind === "tool" || event.kind === "tool-result" ? event.source : undefined,
    detail: `${event.source} · ${event.harness}`,
    live: current && index === tail.length - 1,
  }));

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
    wakePolicy: null,
    capabilities: [],
    project: transcript.project,
    branch: transcript.harness === "unattributed" ? "native session" : transcript.harness,
    role: "native session",
    model: null,
    harnessSessionId: transcript.sessionId,
    harnessLogPath: transcript.transcriptPath,
    conversationId: nativeSessionId(transcript),
    homeNodeId: null,
    homeNodeName: null,
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
  };
}

/* ── Mini event helpers ── */

const KIND_COLOR: Record<string, string> = {
  think: "var(--dim)",
  tool: "var(--accent)",
  ask: "var(--amber)",
  message: "var(--muted)",
  note: "var(--green)",
  system: "var(--dim)",
  boot: "var(--dim)",
};

const KIND_LABEL: Record<string, string> = {
  think: "think",
  tool: "tool",
  ask: "ask",
  message: "msg",
  note: "note",
  system: "sys",
  boot: "boot",
};

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
    recentWindowMs,
    groupMode,
    query,
    focusedId,
    canvasFocusRequest,
  } = mc;
  const setActivityFilter = setMissionActivityFilter;
  const setSourceFilter = setMissionSourceFilter;
  const setRecentWindowMs = setMissionRecentWindow;
  const setGroupMode = setMissionGroupMode;
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

  const sessionCounts = useMemo(() => sessionCountsByAgent(sessions), [sessions]);
  const sessionsLastAt = useMemo(() => sessionLastActivityByAgent(sessions), [sessions]);

  const activityByAgent = useMemo(() => {
    const map = new Map<string, ActivityInfo>();
    for (const agent of agents) {
      const observe = observeCache[agent.id];
      const lastActiveAt = agentLastActivityAt(agent, observe, sessionsLastAt);
      const current = isAgentCurrentlyActive(agent, observe);
      map.set(agent.id, {
        lastActiveAt,
        current,
        recent: current || (lastActiveAt > 0 && now - lastActiveAt <= recentWindowMs),
      });
    }
    return map;
  }, [agents, now, observeCache, recentWindowMs, sessionsLastAt]);

  const nativeSessions = useMemo(() => {
    const agentSessionIds = new Set(
      agents
        .map((agent) => agent.harnessSessionId?.trim())
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
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
        const recent = current || (lastActiveAt > 0 && now - lastActiveAt <= recentWindowMs);
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
  }, [agents, now, recentWindowMs, tailDiscovery?.transcripts, tailEvents]);

  const visibleAgents = useMemo(() => {
    if (sourceFilter === "native") return [];
    let list = agents;
    if (activityFilter !== "all") {
      list = list.filter((agent) => {
        const activity = activityByAgent.get(agent.id);
        return activityFilter === "active" ? activity?.current : activity?.recent;
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
        activityFilter === "active" ? session.current : session.recent
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

  const recentWindowLabel = useMemo(
    () => MISSION_RECENT_WINDOWS.find((option) => option.value === recentWindowMs)?.label ?? "recent",
    [recentWindowMs],
  );

  const canvasSubjects = useMemo(
    () => [
      ...visibleAgents.map((agent) => agentSubject(agent, activityByAgent.get(agent.id))),
      ...visibleNativeSessions.map(nativeSubject),
    ],
    [activityByAgent, visibleAgents, visibleNativeSessions],
  );

  const layout = useMemo(
    () => computeLayout(canvasSubjects, groupMode, recentWindowLabel),
    [canvasSubjects, groupMode, recentWindowLabel],
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

  const activeCount =
    visibleAgents.filter((agent) => activityByAgent.get(agent.id)?.current).length +
    visibleNativeSessions.filter((session) => session.current).length;
  const recentCount =
    (sourceFilter === "native" ? 0 : agents.filter((agent) => activityByAgent.get(agent.id)?.recent).length) +
    (sourceFilter === "scout" ? 0 : nativeSessions.filter((session) => session.recent).length);
  const visibleSessionCount =
    visibleAgents.reduce((count, agent) => count + (sessionCounts.get(agent.id) ?? 0), 0) +
    visibleNativeSessions.length;
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

  const selectedScoutAgentIds = useMemo(() => {
    const scoutIds = new Set(agents.map((agent) => agent.id));
    return mc.selectedIds.filter((id) => scoutIds.has(id));
  }, [agents, mc.selectedIds]);
  const selectedNativeSessionIds = useMemo(() => {
    const nativeIds = new Set(visibleNativeSessions.map((session) => session.id));
    return mc.selectedIds.filter((id) => nativeIds.has(id));
  }, [mc.selectedIds, visibleNativeSessions]);
  const selectedNativeCount = selectedNativeSessionIds.length;
  const selectedLaunchableCount = selectedScoutAgentIds.length + selectedNativeSessionIds.length;
  const groupNoun = groupMode === "activity" ? "group" : "workspace";

  return (
    <div className="s-mission">
      <div className="s-mission-bar">
        <span className="s-mission-bar-label">
          {visibleTileCount}/{totalTileCount} tile{totalTileCount !== 1 ? "s" : ""} ·{" "}
          {visibleSessionCount} session{visibleSessionCount !== 1 ? "s" : ""} ·{" "}
          {layout.groups.length} {groupNoun}{layout.groups.length !== 1 ? "s" : ""}
        </span>
        <span className={`s-mission-bar-live${activeCount === 0 ? " s-mission-bar-live--idle" : ""}`}>
          <span className="s-mission-bar-live-dot" />
          {activeCount} active now
        </span>
        <div className="s-mission-bar-search">
          <input
            type="text"
            className="s-mission-bar-search-input"
            placeholder="Search agents…  (press /)"
            value={query}
            onChange={(event) => setMissionQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                if (query) {
                  setMissionQuery("");
                } else {
                  (event.target as HTMLInputElement).blur();
                }
              }
            }}
          />
        </div>
        <div className="s-mission-controls" role="group" aria-label="Agent activity filter">
          <button
            type="button"
            className={`s-mission-filter${activityFilter === "all" ? " s-mission-filter--active" : ""}`}
            onClick={() => setActivityFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`s-mission-filter${activityFilter === "active" ? " s-mission-filter--active" : ""}`}
            onClick={() => setActivityFilter("active")}
          >
            Active now
          </button>
          <button
            type="button"
            className={`s-mission-filter${activityFilter === "recent" ? " s-mission-filter--active" : ""}`}
            onClick={() => setActivityFilter("recent")}
          >
            Recent {recentCount}
          </button>
        </div>
        <div className="s-mission-controls" role="group" aria-label="Session source filter">
          <button
            type="button"
            className={`s-mission-filter${sourceFilter === "all" ? " s-mission-filter--active" : ""}`}
            onClick={() => setSourceFilter("all")}
          >
            All sources
          </button>
          <button
            type="button"
            className={`s-mission-filter${sourceFilter === "scout" ? " s-mission-filter--active" : ""}`}
            onClick={() => setSourceFilter("scout")}
          >
            Scout
          </button>
          <button
            type="button"
            className={`s-mission-filter${sourceFilter === "native" ? " s-mission-filter--active" : ""}`}
            onClick={() => setSourceFilter("native")}
          >
            Native {nativeSessions.length}
          </button>
        </div>
        <div className="s-mission-controls" role="group" aria-label="Canvas grouping">
          <button
            type="button"
            className={`s-mission-filter${groupMode === "activity" ? " s-mission-filter--active" : ""}`}
            onClick={() => setGroupMode("activity")}
          >
            Activity first
          </button>
          <button
            type="button"
            className={`s-mission-filter${groupMode === "workspace" ? " s-mission-filter--active" : ""}`}
            onClick={() => setGroupMode("workspace")}
          >
            Workspace
          </button>
        </div>
        {activityFilter === "recent" && (
          <div className="s-mission-controls" role="group" aria-label="Recent activity window">
            {MISSION_RECENT_WINDOWS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`s-mission-filter s-mission-filter--compact${recentWindowMs === option.value ? " s-mission-filter--active" : ""}`}
                onClick={() => setRecentWindowMs(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <div className="s-mission-hotkeys">
          {mc.selectedIds.length > 0 && (
            <div className="s-mission-selection" role="group" aria-label="Selected agent actions">
              <span className="s-mission-selection-count">
                {mc.selectedIds.length} selected
              </span>
              {selectedNativeCount > 0 && (
                <span className="s-mission-selection-note">
                  {selectedScoutAgentIds.length} Scout · {selectedNativeCount} native
                </span>
              )}
              <VantageHandoffButton
                agentIds={selectedScoutAgentIds}
                nativeSessionIds={selectedNativeSessionIds}
                className="s-mission-selection-action s-mission-selection-action--vantage"
                statusClassName="s-mission-selection-status"
                label="Open in Vantage"
                openingLabel="Opening..."
                disabled={selectedLaunchableCount === 0}
                title={selectedLaunchableCount > 0
                  ? "Open selected sessions in the native Vantage canvas"
                  : "Select Scout agents or native sessions to open in Vantage"}
              />
              <button
                type="button"
                className="s-mission-selection-action"
                onClick={clearMissionSelection}
              >
                Clear
              </button>
            </div>
          )}
          <button
            className="s-mission-hotkey s-mission-hotkey--btn"
            onClick={() => triggerEntry(false)}
            title="Reset to overview"
          >
            <kbd>H</kbd> Home
          </button>
          <span className="s-mission-hotkey"><kbd>Esc</kbd> Close focus</span>
        </div>
      </div>

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
                  g.label === "Active now" && "s-mission-group-label--active",
                  g.label.startsWith("Recent ") && "s-mission-group-label--recent",
                ].filter(Boolean).join(" ")}
                style={{ left: g.x, top: g.y }}
              >
                {g.label}
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
            await api<unknown>(mode === "ask" ? "/api/ask" : "/api/send", {
              method: "POST",
              body: JSON.stringify({
                body,
                conversationId: conversationForAgent(focusedAgent.id),
              }),
            });
          }}
          onOpenConversation={() => {
            setFocusedId(null);
            navigate({
              view: "conversation",
              conversationId: conversationForAgent(focusedAgent.id),
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
            navigate({ view: "agents", agentId: focusedAgent.id });
          }}
        />
      )}
    </div>
  );
}

/* ── Observe tile ── */

function ObserveTile({
  agent,
  observe,
  x,
  y,
  selected = false,
  canvasFocused = false,
  onToggleSelected,
  onClick,
}: {
  agent: Agent;
  observe: SessionObserveData | null;
  x: number;
  y: number;
  selected?: boolean;
  canvasFocused?: boolean;
  onToggleSelected: () => void;
  onClick: (e: ReactMouseEvent) => void;
}) {
  const streamRef = useRef<HTMLDivElement>(null);
  const state = normalizeAgentState(agent.state);
  const color = actorColor(agent.name);
  const events = observe?.events ?? [];
  const tail = events.slice(-8);
  const isLive = observe?.live === true;
  const hasAsk = events.some((e) => e.kind === "ask" && !e.answer);

  const ctxUsage = observe?.contextUsage;
  const ctxPct = ctxUsage && ctxUsage.length > 0
    ? Math.round(ctxUsage[ctxUsage.length - 1] * 100)
    : null;

  const toolCount = events.filter((e) => e.kind === "tool").length;
  const editCount = events.filter((e) => e.kind === "tool" && e.tool === "edit").length;

  const hoverHandlers = statusOnHover({
    label: `Focus ${agent.handle ?? agent.name}`,
    route: `/ops/control · ${agent.id}`,
  });

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div
      className={[
        "s-mission-tile",
        state === "in_turn" || state === "in_flight" ? "s-mission-tile--working" : null,
        hasAsk ? "s-mission-tile--asking" : null,
        selected ? "s-mission-tile--selected" : null,
        canvasFocused ? "s-mission-tile--canvas-focused" : null,
      ].filter(Boolean).join(" ")}
      style={{ left: x, top: y, height: TILE_H }}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onPointerEnter={hoverHandlers.onPointerEnter}
      onPointerLeave={hoverHandlers.onPointerLeave}
    >
      <div className="s-mission-tile-header">
        <button
          type="button"
          className={`s-mission-select${selected ? " s-mission-select--selected" : ""}`}
          aria-pressed={selected}
          title={selected ? "Remove from selection" : "Select for batch actions"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected();
          }}
        />
        <div
          className="s-ops-avatar"
          style={{ "--size": "22px", background: color } as React.CSSProperties}
        >
          {agent.name[0]?.toUpperCase()}
        </div>
        <div className="s-mission-tile-identity">
          <div className="s-mission-tile-name">
            {agent.name}
            <span className="s-mission-tile-handle">
              {agent.handle ? `@${agent.handle}` : ""}
            </span>
          </div>
          <div className="s-mission-tile-meta">
            {agent.project ?? "—"} · {agent.branch ?? "main"}
          </div>
        </div>
        <span className="s-ops-state-chip" style={{ color: stateChipColor(state) }}>
          {agentStateLabel(agent.state).toUpperCase()}
        </span>
      </div>

      <div className="s-mission-tile-stream" ref={streamRef}>
        {tail.length === 0 ? (
          <div className="s-mission-tile-stream-inner">
            <div className="s-mission-evt">
              <span className="s-mission-evt-bead" style={{ background: "var(--dim)" }} />
              <span className="s-mission-evt-text" style={{ color: "var(--dim)" }}>
                {state === "blocked" ? "No session data" : "Waiting for events…"}
              </span>
            </div>
          </div>
        ) : (
          <div className="s-mission-tile-stream-inner">
            {tail.map((evt) => (
              <div key={evt.id} className="s-mission-evt">
                <span
                  className="s-mission-evt-bead"
                  style={{ background: KIND_COLOR[evt.kind] ?? "var(--dim)" }}
                />
                <span className="s-mission-evt-kind">
                  {KIND_LABEL[evt.kind] ?? evt.kind}
                </span>
                <span className={`s-mission-evt-text s-mission-evt-text--${evt.kind}`}>
                  {summarizeObserveEvent(evt)}
                  {evt.live && <span className="s-observe-cursor" />}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="s-mission-tile-footer">
        {ctxPct !== null && (
          <div className="s-mission-tile-ctx" title={`Context: ${ctxPct}%`}>
            <div className="s-mission-tile-ctx-fill" style={{ width: `${ctxPct}%` }} />
          </div>
        )}
        <div className="s-mission-tile-stats">
          {toolCount > 0 && <span>{toolCount} tools</span>}
          {editCount > 0 && <span>{editCount} edits</span>}
        </div>
        {isLive && (
          <span className="s-mission-tile-live">
            <span className="s-mission-tile-live-dot" />
            LIVE
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Focus overlay — full SessionObserve ── */

type FocusTab = "profile" | "activity" | "message";

function FocusOverlay({
  agent,
  observe,
  onClose,
  onSend,
  onOpenConversation,
  onTail,
  onProfile,
}: {
  agent: Agent;
  observe: SessionObserveData | null;
  onClose: () => void;
  onSend: (body: string, mode: "tell" | "ask") => Promise<void>;
  onOpenConversation: () => void;
  onTail: () => void;
  onProfile: () => void;
}) {
  const color = actorColor(agent.name);
  const { ref: dialogRef, onKeyDown: onTrapKeyDown } = useFocusTrap<HTMLDivElement>();
  const [tab, setTab] = useState<FocusTab>("profile");

  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onTrapKeyDown(e);
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    const inEditable = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || (target?.isContentEditable ?? false);
    if (inEditable) return;
    if (e.key === "1") { e.preventDefault(); setTab("profile"); }
    else if (e.key === "2") { e.preventDefault(); setTab("activity"); }
    else if (e.key === "3") { e.preventDefault(); setTab("message"); }
  };

  return (
    <div className="s-mission-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-overlay-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        tabIndex={-1}
        className="s-mission-overlay-dialog"
      >
        <div className="s-mission-overlay-header">
          <div
            className="s-ops-avatar"
            style={{ "--size": "28px", background: color } as React.CSSProperties}
          >
            {agent.name[0]?.toUpperCase()}
          </div>
          <div className="s-mission-overlay-identity">
            <div className="s-mission-overlay-name" id="mission-overlay-title">
              {agent.name}{" "}
              <span className="s-mission-overlay-handle">
                {agent.handle ? `@${agent.handle}` : ""}
              </span>
            </div>
            <div className="s-mission-overlay-meta">
              {agent.project ?? "—"} · {agent.branch ?? "main"} · {agentStateLabel(agent.state)}
            </div>
          </div>
          <button
            className="s-mission-overlay-close"
            onClick={onClose}
            aria-label="Close (Esc)"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="s-mission-overlay-tabs" role="tablist">
          <div className="s-mission-overlay-tabs-group">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "profile"}
              className={`s-mission-overlay-tab${tab === "profile" ? " s-mission-overlay-tab--active" : ""}`}
              onClick={() => setTab("profile")}
            >
              Profile
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "activity"}
              className={`s-mission-overlay-tab${tab === "activity" ? " s-mission-overlay-tab--active" : ""}`}
              onClick={() => setTab("activity")}
            >
              Activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "message"}
              className={`s-mission-overlay-tab${tab === "message" ? " s-mission-overlay-tab--active" : ""}`}
              onClick={() => setTab("message")}
            >
              Message
            </button>
          </div>
          <div className="s-mission-overlay-tabs-action">
            {tab === "profile" && (
              <button
                type="button"
                className="s-mission-overlay-jump"
                onClick={onProfile}
                {...statusOnHover({
                  label: `Open profile · ${agent.handle ?? agent.name}`,
                  route: `/agents/${agent.id}`,
                })}
              >
                Open profile ↗
              </button>
            )}
            {tab === "activity" && (
              <button
                type="button"
                className="s-mission-overlay-jump"
                onClick={onTail}
                {...statusOnHover({
                  label: `Tail · ${agent.handle ?? agent.name}`,
                  route: `/ops/tail?q=${encodeURIComponent(agent.handle ?? agent.name)}`,
                })}
              >
                Open in Tail ↗
              </button>
            )}
            {tab === "message" && (
              <button
                type="button"
                className="s-mission-overlay-jump"
                onClick={onOpenConversation}
                {...statusOnHover({
                  label: `Open conversation with ${agent.handle ?? agent.name}`,
                  route: `/c/${agent.conversationId}`,
                })}
              >
                Open conversation ↗
              </button>
            )}
          </div>
        </div>

        <div className="s-mission-overlay-body">
          {tab === "profile" && <FocusProfileTab agent={agent} />}
          {tab === "activity" && (
            <FocusActivityTab
              agent={agent}
              observe={observe}
              onOpenConversation={onOpenConversation}
              onMessage={() => setTab("message")}
            />
          )}
          {tab === "message" && (
            <FocusMessageTab
              agent={agent}
              onSend={onSend}
              onOpenConversation={onOpenConversation}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FocusProfileTab({ agent }: { agent: Agent }) {
  const rows: Array<[string, string]> = [
    ["MODEL", [agent.harness, agent.model].filter(Boolean).join("/") || "—"],
    ["AT", [agent.project, agent.branch].filter(Boolean).join("/") || "—"],
    ["CWD", agent.cwd || agent.projectRoot || "—"],
    ["AGENT", agent.agentClass || "—"],
    ["ROLE", agent.role || agent.transport || "—"],
    ["MACHINE", agent.authorityNodeName ?? agent.homeNodeName ?? agent.authorityNodeId ?? agent.homeNodeId ?? "—"],
    ["OWNER", agent.ownerHandle ?? agent.ownerName ?? agent.ownerId ?? "—"],
    ["SPAWNED", agent.createdAt ? timeAgo(agent.createdAt) : "—"],
    ["STATE", agentStateLabel(agent.state)],
  ];
  return (
    <div className="s-focus-tab">
      <dl className="s-focus-spec">
        {rows.map(([k, v]) => (
          <div key={k} className="s-focus-spec-row">
            <dt className="s-focus-spec-label">{k}</dt>
            <dd className="s-focus-spec-value" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const ACTIVITY_PREVIEW_LIMIT = 14;

const KIND_GLYPH: Record<string, string> = {
  tool: "▸",
  think: "·",
  ask: "?",
  message: "✉",
  note: "•",
  system: "◇",
  boot: "↑",
};

function formatEventAge(secondsFromStart: number, sessionStart?: number | null): string {
  if (sessionStart) {
    const ms = Date.now() - (sessionStart + secondsFromStart * 1000);
    if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
    return `${Math.round(ms / 86_400_000)}d`;
  }
  const s = Math.max(0, Math.round(secondsFromStart));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function eventSummary(event: ObserveEvent): string {
  if (event.kind === "tool") {
    const head = event.tool ?? "tool";
    return event.arg ? `${head} · ${event.arg}` : head;
  }
  if (event.kind === "ask") {
    return event.text || "asked something";
  }
  return event.text || event.detail || KIND_LABEL[event.kind] || event.kind;
}

function FocusActivityTab({
  agent,
  observe,
  onOpenConversation,
  onMessage,
}: {
  agent: Agent;
  observe: SessionObserveData | null;
  onOpenConversation: () => void;
  onMessage: () => void;
}) {
  const events = observe?.events ?? [];
  const usage = observe?.metadata?.usage;
  const sessionStart = typeof (observe?.metadata?.session as Record<string, unknown> | undefined)?.["sessionStart"] === "number"
    ? ((observe?.metadata?.session as Record<string, unknown>)["sessionStart"] as number)
    : null;

  const recent = events.slice(-ACTIVITY_PREVIEW_LIMIT).reverse();

  const turnCount = usage?.assistantMessages ?? events.filter((e) => e.kind === "message").length;
  const toolCount = events.filter((e) => e.kind === "tool").length;
  const editCount = events.filter(
    (e) => e.kind === "tool" && (e.tool === "edit" || e.tool === "write"),
  ).length;
  const ctxPct = observe?.contextUsage && observe.contextUsage.length > 0
    ? Math.round(observe.contextUsage[observe.contextUsage.length - 1] * 100)
    : null;
  const ctxLabel = ctxPct !== null
    ? `${ctxPct}%`
    : usage?.contextWindowTokens && usage?.totalTokens
      ? `${Math.round((usage.totalTokens / usage.contextWindowTokens) * 100)}%`
      : "—";

  return (
    <div className="s-focus-tab s-focus-tab--activity-preview">
      <dl className="s-focus-stats">
        <Stat label="Turns" value={turnCount || "—"} />
        <Stat label="Tools" value={toolCount || "—"} />
        <Stat label="Edits" value={editCount || "—"} />
        <Stat label="Context" value={ctxLabel} />
      </dl>

      {recent.length === 0 ? (
        <FocusActivityEmpty
          agent={agent}
          onOpenConversation={onOpenConversation}
          onMessage={onMessage}
        />
      ) : (
        <ul className="s-focus-activity-list">
          {recent.map((event) => (
            <li key={event.id} className={`s-focus-activity-row s-focus-activity-row--${event.kind}`}>
              <span className="s-focus-activity-time">{formatEventAge(event.t, sessionStart)}</span>
              <span className="s-focus-activity-glyph" aria-hidden>
                {KIND_GLYPH[event.kind] ?? "·"}
              </span>
              <span className="s-focus-activity-kind">{KIND_LABEL[event.kind] ?? event.kind}</span>
              <span className="s-focus-activity-text">{eventSummary(event)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FocusActivityEmpty({
  agent,
  onOpenConversation,
  onMessage,
}: {
  agent: Agent;
  onOpenConversation: () => void;
  onMessage: () => void;
}) {
  const role = agent.role?.trim();
  const harness = [agent.harness, agent.model].filter(Boolean).join("/");
  const where = [agent.project, agent.branch].filter(Boolean).join("/");
  const state = normalizeAgentState(agent.state);
  const stateLabel = agentStateLabel(state);
  const spawned = agent.createdAt ? timeAgo(agent.createdAt) : null;
  const lastSeen = agent.updatedAt ? timeAgo(agent.updatedAt) : null;
  const home = agent.homeNodeName ?? agent.homeNodeId;

  const owner = agent.ownerHandle ?? agent.ownerName ?? agent.ownerId;

  const facts: { label: string; value: string }[] = [];
  if (role) facts.push({ label: "Role", value: role });
  if (harness) facts.push({ label: "Stack", value: harness });
  if (where) facts.push({ label: "At", value: where });
  if (home) facts.push({ label: "Home", value: home });
  if (owner) facts.push({ label: "Owner", value: owner });
  if (spawned) facts.push({ label: "Spawned", value: spawned });
  facts.push({ label: "State", value: stateLabel });
  if (lastSeen) facts.push({ label: "Last seen", value: lastSeen });

  return (
    <div className="s-focus-activity-empty s-focus-activity-empty--rich">
      <div className="s-focus-activity-empty-head">
        <span className="s-focus-activity-empty-eyebrow">No tool or turn events recorded</span>
        <span className="s-focus-activity-empty-title">{agent.handle ?? agent.name}</span>
      </div>
      <dl className="s-focus-activity-empty-facts">
        {facts.map((f) => (
          <div key={f.label} className="s-focus-activity-empty-fact">
            <dt>{f.label}</dt>
            <dd title={f.value}>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="s-focus-activity-empty-actions">
        <button
          type="button"
          className="s-focus-activity-empty-btn"
          onClick={onOpenConversation}
          {...statusOnHover({
            label: `Open conversation with ${agent.handle ?? agent.name}`,
            route: `/c/${agent.conversationId}`,
          })}
        >
          Open conversation ↗
        </button>
        <button
          type="button"
          className="s-focus-activity-empty-btn s-focus-activity-empty-btn--primary"
          onClick={onMessage}
          {...statusOnHover({
            label: `Compose message · ${agent.handle ?? agent.name}`,
          })}
        >
          Send a message
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="s-focus-stat">
      <dt className="s-focus-stat-label">{label}</dt>
      <dd className="s-focus-stat-value">{value}</dd>
    </div>
  );
}

function FocusMessageTab({
  agent,
  onSend,
  onOpenConversation,
}: {
  agent: Agent;
  onSend: (body: string, mode: "tell" | "ask") => Promise<void>;
  onOpenConversation: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<"tell" | "ask" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const send = async (mode: "tell" | "ask") => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(body, mode);
      setDraft("");
      setSent(mode);
      setTimeout(() => setSent(null), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) void send("ask");
      else void send("tell");
    }
  };

  const name = agent.handle ?? agent.name;
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <div className="s-focus-tab">
      <div className="s-focus-compose">
        <label className="s-focus-compose-label" htmlFor="s-focus-compose-input">
          Message <span className="s-focus-compose-target">@{name}</span>
        </label>
        <textarea
          id="s-focus-compose-input"
          ref={textareaRef}
          className="s-focus-compose-input"
          placeholder={`Steer @${name}…   (⌘↩ to Steer · ⌘⇧↩ to Ask)`}
          rows={6}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
        />
        <div className="s-focus-compose-foot">
          <div className="s-focus-compose-hint">
            {error ? (
              <span className="s-focus-compose-error">Send failed: {error}</span>
            ) : sent === "tell" ? (
              <span className="s-focus-compose-ok">Steered ↗ <button type="button" className="s-focus-compose-link" onClick={onOpenConversation}>Open thread</button></span>
            ) : sent === "ask" ? (
              <span className="s-focus-compose-ok">Asked ↗ <button type="button" className="s-focus-compose-link" onClick={onOpenConversation}>Open thread</button></span>
            ) : (
              <>
                <strong>Steer</strong> redirects what they're doing. <strong>Ask</strong> waits for a structured answer.
              </>
            )}
          </div>
          <div className="s-focus-compose-actions">
            <DictationMic
              onAppend={(text) =>
                setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
              }
            />
            <button
              type="button"
              className="s-ops-btn"
              onClick={() => void send("ask")}
              disabled={!canSend}
            >
              Ask
            </button>
            <button
              type="button"
              className="s-ops-btn s-ops-btn--primary"
              onClick={() => void send("tell")}
              disabled={!canSend}
            >
              Steer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Minimap ── */

function Minimap({
  layout,
  agents,
  pan,
  zoom,
  viewportRef,
  isCollapsed,
  onToggleCollapse,
  onFitAll,
  onHome,
  onClick,
}: {
  layout: CanvasLayout;
  agents: Agent[];
  pan: { x: number; y: number };
  zoom: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onFitAll: () => void;
  onHome: () => void;
  onClick: (point: { x: number; y: number }) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [measuredMapW, setMeasuredMapW] = useState(0);
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;

    const updateWidth = () => setMeasuredMapW(element.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (layout.canvasW === 0) return null;

  const mapW = measuredMapW || MINIMAP_FALLBACK_W;
  const mmScale = Math.min(mapW / layout.canvasW, MINIMAP_MAX_H / layout.canvasH);
  const mmW = layout.canvasW * mmScale;
  const mmH = layout.canvasH * mmScale;
  const mapOffsetX = Math.max(0, (mapW - mmW) / 2);

  const vp = viewportRef.current;
  const vpW = vp?.clientWidth ?? 0;
  const vpH = vp?.clientHeight ?? 0;
  const vx = (-pan.x / zoom) * mmScale;
  const vy = (-pan.y / zoom) * mmScale;
  const vw = (vpW / zoom) * mmScale;
  const vh = (vpH / zoom) * mmScale;
  const handleCanvasClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = Math.max(0, Math.min(mmW, e.clientX - rect.left - mapOffsetX));
      const my = Math.max(0, Math.min(mmH, e.clientY - rect.top));
      onClick({ x: mx / mmScale, y: my / mmScale });
    },
    [mapOffsetX, mmH, mmScale, mmW, onClick],
  );

  if (isCollapsed) {
    return (
      <div className="s-mission-minimap s-mission-minimap--collapsed">
        <div className="s-mission-minimap-header">
          <span className="s-mission-minimap-title">
            <span className="s-mission-minimap-title-mark" aria-hidden />
            MAP
          </span>
          <button
            type="button"
            className="s-mission-minimap-action"
            title="Expand map"
            aria-label="Expand map"
            onClick={onToggleCollapse}
          >
            <ChevronUp size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="s-mission-minimap">
      <div className="s-mission-minimap-header">
        <span className="s-mission-minimap-title">
          <span className="s-mission-minimap-title-mark" aria-hidden />
          MAP
        </span>
        <div className="s-mission-minimap-actions">
          <button
            type="button"
            className="s-mission-minimap-action"
            title="Fit all"
            aria-label="Fit all"
            onClick={onFitAll}
          >
            <Maximize2 size={12} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="s-mission-minimap-action"
            title="Recenter"
            aria-label="Recenter"
            onClick={onHome}
          >
            <Crosshair size={12} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="s-mission-minimap-action"
            title="Minimize map"
            aria-label="Minimize map"
            onClick={onToggleCollapse}
          >
            <ChevronDown size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div ref={mapRef} className="s-mission-minimap-canvas" style={{ height: mmH }} onClick={handleCanvasClick} aria-hidden="true">
        {layout.groups.flatMap((g) =>
          g.tiles.map((t) => {
            const agent = agents.find((a) => a.id === t.agentId);
            return (
              <div
                key={t.agentId}
                className="s-mission-minimap-tile"
                style={{
                  left: mapOffsetX + t.x * mmScale,
                  top: t.y * mmScale,
                  width: TILE_W * mmScale,
                  height: TILE_H * mmScale,
                  background: agent ? actorColor(agent.name) : "var(--dim)",
                  opacity: agent && isAgentBusy(agent.state) ? 0.8 : 0.35,
                }}
              />
            );
          }),
        )}
        <div
          className="s-mission-minimap-viewport"
          style={{
            left: mapOffsetX + Math.max(0, vx),
            top: Math.max(0, vy),
            width: Math.min(vw, mmW),
            height: Math.min(vh, mmH),
          }}
        >
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function stateChipColor(state: string): string {
  switch (state) {
    case "working": return "var(--green)";
    case "ready": return "var(--accent)";
    default: return "var(--dim)";
  }
}
