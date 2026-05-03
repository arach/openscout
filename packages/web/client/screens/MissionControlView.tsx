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
import { actorColor } from "../lib/colors.ts";
import { api } from "../lib/api.ts";
import { useCanvasMinimapRegistration } from "../lib/canvas-minimap.tsx";
import { normalizeAgentState, agentStateLabel } from "../lib/agent-state.ts";
import {
  summarizeObserveEvent,
  useObservePolling,
  type ObserveCacheEntry,
} from "../lib/observe.ts";
import { conversationForAgent } from "../lib/router.ts";
import { useTailEvents } from "../lib/tail-events.ts";
import { SessionObserve, type SessionObserveData } from "./SessionObserve.tsx";
import type {
  Agent,
  ObserveData,
  ObserveEvent,
  Route,
  SessionEntry,
  TailDiscoveredTranscript,
  TailDiscoverySnapshot,
  TailEvent,
} from "../lib/types.ts";

/* ── Constants ── */

const TILE_W = 420;
const TILE_H = 320;
const TILE_GAP = 20;
const GROUP_GAP_X = 48;
const GROUP_GAP_Y = 36;
const GROUP_LABEL_H = 28;
const CANVAS_PAD = 40;

const MINIMAP_FALLBACK_W = 244;
const MINIMAP_MAX_H = 160;
const ACTIVE_EVENT_WINDOW_MS = 2 * 60_000;
const RECENT_WINDOW_OPTIONS = [
  { label: "15m", value: 15 * 60_000 },
  { label: "1h", value: 60 * 60_000 },
  { label: "24h", value: 24 * 60 * 60_000 },
] as const;

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
type MissionActivityFilter = "all" | "active" | "recent";
type MissionSourceFilter = "all" | "scout" | "native";
type CanvasSubject = {
  id: string;
  name: string;
  group: string;
  stateRank: number;
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

function computeLayout(subjects: CanvasSubject[]): CanvasLayout {
  const groups = groupSubjects(subjects);
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

function groupSubjects(subjects: CanvasSubject[]): SubjectGroup[] {
  const sorted = [...subjects].sort((a, b) => {
    if (a.stateRank !== b.stateRank) return a.stateRank - b.stateRank;
    return a.name.localeCompare(b.name);
  });

  const byGroup = new Map<string, CanvasSubject[]>();
  for (const subject of sorted) {
    if (!byGroup.has(subject.group)) byGroup.set(subject.group, []);
    byGroup.get(subject.group)!.push(subject);
  }

  const groups: SubjectGroup[] = [];
  for (const [label, group] of byGroup) {
    groups.push({ label, subjects: group });
  }
  groups.sort((a, b) => b.subjects.length - a.subjects.length);
  return groups;
}

function agentSubject(agent: Agent): CanvasSubject {
  const stateOrder: Record<string, number> = { working: 0, available: 1, offline: 2 };
  const state = normalizeAgentState(agent.state);
  return {
    id: agent.id,
    name: agent.name,
    group: agent.project ?? "unassigned",
    stateRank: stateOrder[state] ?? 1,
  };
}

function nativeSubject(session: NativeSessionModel): CanvasSubject {
  return {
    id: session.id,
    name: session.agent.name,
    group: `native ${session.transcript.source}`,
    stateRank: session.current ? 0 : 1,
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

function agentLastActivityAt(
  agent: Agent,
  observe: ObserveCacheEntry | undefined,
  sessionsLastAt: Map<string, number>,
): number {
  return Math.max(
    sessionsLastAt.get(agent.id) ?? 0,
    observe?.updatedAt ?? 0,
    normalizeAgentState(agent.state) === "working" ? agent.updatedAt ?? 0 : 0,
  );
}

function isAgentCurrentlyActive(
  agent: Agent,
  observe: ObserveCacheEntry | undefined,
  lastActiveAt: number,
  now: number,
): boolean {
  return (
    normalizeAgentState(agent.state) === "working" ||
    observe?.data.live === true ||
    (lastActiveAt > 0 && now - lastActiveAt <= ACTIVE_EVENT_WINDOW_MS)
  );
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

  return {
    events: observeEvents.length > 0
      ? observeEvents
      : [{
          id: `${nativeSessionId(transcript)}:discovered`,
          t: 0,
          kind: "system",
          text: `Native ${transcript.source} transcript discovered.`,
          detail: transcript.cwd ?? transcript.transcriptPath,
        }],
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
    state: current ? "working" : "available",
    projectRoot: transcript.cwd,
    cwd: transcript.cwd,
    updatedAt: lastActiveAt,
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
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<MissionActivityFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<MissionSourceFilter>("all");
  const [recentWindowMs, setRecentWindowMs] = useState<(typeof RECENT_WINDOW_OPTIONS)[number]["value"]>(
    RECENT_WINDOW_OPTIONS[1].value,
  );
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
          api<SessionEntry[]>("/api/sessions"),
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
    const timer = setInterval(() => void load(), 10_000);
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
    const map = new Map<string, { lastActiveAt: number; current: boolean; recent: boolean }>();
    for (const agent of agents) {
      const observe = observeCache[agent.id];
      const lastActiveAt = agentLastActivityAt(agent, observe, sessionsLastAt);
      const current = isAgentCurrentlyActive(agent, observe, lastActiveAt, now);
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
    if (activityFilter === "all") return agents;
    return agents.filter((agent) => {
      const activity = activityByAgent.get(agent.id);
      return activityFilter === "active" ? activity?.current : activity?.recent;
    });
  }, [activityByAgent, activityFilter, agents, sourceFilter]);

  const visibleNativeSessions = useMemo(() => {
    if (sourceFilter === "scout") return [];
    if (activityFilter === "all") return nativeSessions;
    return nativeSessions.filter((session) =>
      activityFilter === "active" ? session.current : session.recent
    );
  }, [activityFilter, nativeSessions, sourceFilter]);

  const canvasSubjects = useMemo(
    () => [
      ...visibleAgents.map(agentSubject),
      ...visibleNativeSessions.map(nativeSubject),
    ],
    [visibleAgents, visibleNativeSessions],
  );

  const layout = useMemo(() => computeLayout(canvasSubjects), [canvasSubjects]);

  const animTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const triggerEntry = useCallback((useSaved = true) => {
    if (layout.canvasW === 0 || vpSize.w === 0) return;
    animTimers.current.forEach(clearTimeout);

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
    triggerEntry(true);
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
  const focusedAgent = focusedId ? agents.find((a) => a.id === focusedId) : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "Escape") setFocusedId(null);
      if (e.key === "h" || e.key === "H") triggerEntry(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedAgent, triggerEntry]);

  /* ── Minimap click ── */
  const onMinimapClick = useCallback(
    (point: { x: number; y: number }) => {
      const vp = viewportRef.current;
      if (!vp) return;
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

  return (
    <div className="s-mission">
      <div className="s-mission-bar">
        <span className="s-mission-bar-label">
          {visibleTileCount}/{totalTileCount} tile{totalTileCount !== 1 ? "s" : ""} ·{" "}
          {visibleSessionCount} session{visibleSessionCount !== 1 ? "s" : ""} ·{" "}
          {layout.groups.length} workspace{layout.groups.length !== 1 ? "s" : ""}
        </span>
        {activeCount > 0 && (
          <span className="s-mission-bar-live">
            <span className="s-mission-bar-live-dot" />
            {activeCount} active
          </span>
        )}
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
        {activityFilter === "recent" && (
          <div className="s-mission-controls" role="group" aria-label="Recent activity window">
            {RECENT_WINDOW_OPTIONS.map((option) => (
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
                className="s-mission-group-label"
                style={{ left: g.x, top: g.y }}
              >
                {g.label}
              </div>
            ))}

            {visibleAgents.map((agent) => {
              const pos = tilePositions[agent.id];
              if (!pos) return null;
              const cached = observeCache[agent.id];
              return (
                <ObserveTile
                  key={agent.id}
                  agent={agent}
                  observe={cached?.data ?? null}
                  x={pos.x}
                  y={pos.y}
                  onClick={() => setFocusedId(agent.id)}
                />
              );
            })}
            {visibleNativeSessions.map((session) => {
              const pos = tilePositions[session.id];
              if (!pos) return null;
              return (
                <ObserveTile
                  key={session.id}
                  agent={session.agent}
                  observe={session.observe}
                  x={pos.x}
                  y={pos.y}
                  onClick={() => navigate({ view: "ops", mode: "tail" })}
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
          onTell={() => {
            setFocusedId(null);
            navigate({
              view: "conversation",
              conversationId: conversationForAgent(focusedAgent.id),
              composeMode: "tell",
            });
          }}
          onAsk={() => {
            setFocusedId(null);
            navigate({
              view: "conversation",
              conversationId: conversationForAgent(focusedAgent.id),
              composeMode: "ask",
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
  onClick,
}: {
  agent: Agent;
  observe: SessionObserveData | null;
  x: number;
  y: number;
  onClick: () => void;
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

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div
      className={`s-mission-tile${state === "working" ? " s-mission-tile--working" : ""}${hasAsk ? " s-mission-tile--asking" : ""}`}
      style={{ left: x, top: y, height: TILE_H }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <div className="s-mission-tile-header">
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
                {state === "offline" ? "No session data" : "Waiting for events…"}
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

function FocusOverlay({
  agent,
  observe,
  onClose,
  onTell,
  onAsk,
  onProfile,
}: {
  agent: Agent;
  observe: SessionObserveData | null;
  onClose: () => void;
  onTell: () => void;
  onAsk: () => void;
  onProfile: () => void;
}) {
  const color = actorColor(agent.name);

  return (
    <div className="s-mission-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "contents" }}>
        <div className="s-mission-overlay-header">
          <div
            className="s-ops-avatar"
            style={{ "--size": "28px", background: color } as React.CSSProperties}
          >
            {agent.name[0]?.toUpperCase()}
          </div>
          <div>
            <div className="s-mission-overlay-name">
              {agent.name}{" "}
              <span style={{ color: "var(--dim)", fontSize: 11 }}>
                {agent.handle ? `@${agent.handle}` : ""}
              </span>
            </div>
            <div className="s-mission-overlay-meta">
              {agent.project ?? "—"} · {agent.branch ?? "main"} · {agentStateLabel(agent.state)}
            </div>
          </div>
          <div className="s-mission-overlay-actions">
            <button className="s-ops-btn s-ops-btn--primary" onClick={onTell}>Tell</button>
            <button className="s-ops-btn" onClick={onAsk}>Ask</button>
            <button className="s-ops-btn" onClick={onProfile}>Profile ↗</button>
            <button className="s-ops-btn" onClick={onClose}>ESC</button>
          </div>
        </div>
        <div className="s-mission-overlay-body">
          <SessionObserve data={observe ?? undefined} agentId={agent.id} />
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
      <div ref={mapRef} className="s-mission-minimap-canvas" style={{ height: mmH }} onClick={handleCanvasClick}>
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
                  opacity: agent && normalizeAgentState(agent.state) === "working" ? 0.8 : 0.35,
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
    case "available": return "var(--accent)";
    default: return "var(--dim)";
  }
}
