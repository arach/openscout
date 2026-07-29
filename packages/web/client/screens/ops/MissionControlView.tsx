import "./mission-control.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import {
  clearMissionRevealRequest,
  clearMissionSelection,
  setMissionFocusedId,
  setMissionVisibleAgents,
  toggleMissionSelected,
  useMissionControlStore,
  type MissionActivityState,
} from "../../lib/mission-control-store.ts";
import { useObservePolling } from "../../lib/observe.ts";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import { filterTailEventsForDisplay } from "../../lib/tail-display.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import type {
  Agent,
  ObserveData,
  Route,
  TailDiscoverySnapshot,
  TailEvent,
} from "../../lib/types.ts";
import { FocusOverlay } from "./MissionFocusOverlay.tsx";
import { MissionLogPane } from "./MissionLogPane.tsx";
import { ACTIVE_EVENT_WINDOW_MS } from "./mission-control-model.ts";
import {
  WALL_GAP,
  buildMissionLogs,
  computeWallTiling,
  filterMissionLogs,
  missionLogShortId,
  missionLogTitle,
  sortMissionLogs,
  type MissionAgentRef,
  type MissionLog,
} from "./mission-wall.ts";

/** Firehose retention across the whole wall (per-pane retention is separate). */
const TAIL_BUFFER = 4_000;
/** Live events arrive one at a time; repaint the wall on a fixed cadence instead. */
const FLUSH_INTERVAL_MS = 250;
const DISCOVERY_REFRESH_MS = 30_000;
const RECENT_TAIL_LIMIT = 1_500;
const REVEAL_FLASH_MS = 1_800;

/* ── Identity ── */

function agentRefs(
  agents: Agent[],
  sessionIdsByAgent: Map<string, string[]>,
): MissionAgentRef[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    state: agent.state,
    project: agent.project,
    branch: agent.branch,
    harness: agent.harness,
    model: agent.model,
    sessionIds: sessionIdsByAgent.get(agent.id) ?? [],
  }));
}

/**
 * A log without a registered Scout agent still needs an `Agent` to drive the
 * focus overlay (profile, activity, steer). Synthesize one from the log.
 */
function syntheticAgent(log: MissionLog): Agent {
  return {
    id: `native:${log.source}:${log.sessionId}`,
    definitionId: `native:${log.source}:${log.sessionId}`,
    name: `${log.source} · ${log.project}`,
    handle: log.sessionId.slice(0, 8),
    agentClass: "native-session",
    harness: log.source,
    state: log.live ? "working" : "ready",
    projectRoot: log.cwd,
    cwd: log.cwd,
    updatedAt: log.lastActiveAt,
    createdAt: null,
    transport: "tail",
    selector: null,
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: null,
    capabilities: [],
    project: log.project,
    branch: log.attribution === "unattributed" ? "native session" : log.attribution,
    role: "native session",
    model: null,
    harnessSessionId: log.sessionId,
    terminalSurface: null,
    harnessLogPath: log.logPath,
    conversationId: null,
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

function isNativeSessionAgent(agent: Agent): boolean {
  return agent.agentClass === "native-session" || agent.id.startsWith("native:");
}

function nativeSessionInstructionsPayload(agent: Agent, instructions: string) {
  const sessionId = agent.harnessSessionId?.trim();
  if (!sessionId) {
    throw new Error("This native session has no session id to continue.");
  }
  const projectPath = agent.projectRoot?.trim() || agent.cwd?.trim();
  if (!projectPath) {
    throw new Error("This native session has no project path to route from.");
  }
  const harness = agent.harness?.trim();
  const model = agent.model?.trim();
  return {
    target: { projectPath },
    execution: {
      session: "existing",
      targetSessionId: sessionId,
      ...(harness ? { harness } : {}),
      ...(model ? { model } : {}),
    },
    agent: {
      persistence: "one_time",
      ...(agent.handle?.trim() ? { handle: agent.handle.trim() } : {}),
    },
    seed: { instructions },
  };
}

async function sendToFocusedAgentSession(agent: Agent, body: string): Promise<void> {
  if (isNativeSessionAgent(agent)) {
    await api<unknown>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(nativeSessionInstructionsPayload(agent, body)),
    });
    return;
  }

  const conversationId = await ensureAgentChat(agent);
  await api<unknown>("/api/send", {
    method: "POST",
    body: JSON.stringify({
      body,
      chatId: conversationId,
      execution: {
        ...(agent.harness?.trim() ? { harness: agent.harness.trim() } : {}),
        ...(agent.model?.trim() ? { model: agent.model.trim() } : {}),
      },
    }),
  });
}

function missionActivity(log: MissionLog, now: number, windowMs: number): MissionActivityState {
  if (log.live) return "active";
  if (log.lastActiveAt > 0 && now - log.lastActiveAt <= windowMs) return "recent";
  return "idle";
}

/* ── Wall ── */

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
    revealRequest,
  } = mc;

  const [tailEvents, setTailEvents] = useState<TailEvent[]>([]);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const observeCache = useObservePolling(agents);

  /* ── Firehose ── */

  const pendingRef = useRef<TailEvent[]>([]);
  useTailEvents((event) => {
    pendingRef.current.push(event);
  });

  useEffect(() => {
    const timer = setInterval(() => {
      if (pendingRef.current.length === 0) return;
      const incoming = pendingRef.current;
      pendingRef.current = [];
      setTailEvents((previous) => {
        // Replayed events are dropped here as well as in buildMissionLogs, so
        // a re-read transcript can't evict live lines out of the buffer.
        const seen = new Set(previous.map((event) => event.id));
        const fresh = incoming.filter((event) => !event.id || !seen.has(event.id));
        if (fresh.length === 0) return previous;
        const next = previous.concat(fresh);
        return next.length > TAIL_BUFFER ? next.slice(next.length - TAIL_BUFFER) : next;
      });
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Backfill runs exactly once: it is a multi-second scan, and once it lands the
  // WebSocket keeps every pane current. Re-running it on a poll would re-read
  // the same history and stall the wall.
  useEffect(() => {
    let cancelled = false;
    void api<{ events: TailEvent[] }>(`/api/tail/recent?limit=${RECENT_TAIL_LIMIT}`)
      .then((payload) => {
        if (cancelled) return;
        const seed = payload.events ?? [];
        setTailEvents((previous) => {
          // Live events that arrived during the backfill win over the snapshot.
          const seen = new Set(previous.map((event) => event.id));
          const merged = seed.filter((event) => !seen.has(event.id)).concat(previous);
          return merged.length > TAIL_BUFFER ? merged.slice(merged.length - TAIL_BUFFER) : merged;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Discovery only supplies identity (which file a session writes to), so it can
  // poll cheaply and independently.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const snapshot = await api<TailDiscoverySnapshot>("/api/tail/discover");
        if (!cancelled) setDiscovery(snapshot);
      } catch {}
    };
    void load();
    const timer = setInterval(() => void load(), DISCOVERY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  /* ── Logs ── */

  const sessionIdsByAgent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const agent of agents) {
      const observe = observeCache[agent.id];
      const ids = [
        agent.harnessSessionId,
        observe?.sessionId,
        observe?.data.metadata?.session?.externalSessionId,
      ]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id));
      map.set(agent.id, [...new Set(ids)]);
    }
    return map;
  }, [agents, observeCache]);

  const logs = useMemo(
    () =>
      buildMissionLogs({
        events: filterTailEventsForDisplay(tailEvents, "work"),
        transcripts: discovery?.transcripts ?? [],
        agents: agentRefs(agents, sessionIdsByAgent),
        now,
        liveWindowMs: ACTIVE_EVENT_WINDOW_MS,
      }),
    [agents, discovery?.transcripts, now, sessionIdsByAgent, tailEvents],
  );

  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const visible = sortMissionLogs(
      filterMissionLogs(logs, {
        sourceFilter,
        activityFilter,
        query,
        now,
        activeWindowMs: activityWindowMs,
      }),
      groupMode,
    );
    if (!pinnedId) return visible;
    const pinned = visible.find((log) => log.id === pinnedId);
    if (!pinned) return visible;
    return [pinned, ...visible.filter((log) => log.id !== pinnedId)];
  }, [activityFilter, activityWindowMs, groupMode, logs, now, pinnedId, query, sourceFilter]);

  /* ── Tiling ── */

  const wallRef = useRef<HTMLDivElement>(null);
  const [wallSize, setWallSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const node = wallRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWallSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const tiling = useMemo(
    () => computeWallTiling(ordered.length, wallSize),
    [ordered.length, wallSize],
  );
  const shown = useMemo(() => ordered.slice(0, tiling.shown), [ordered, tiling.shown]);

  /* ── Left-rail mirror ── */

  useEffect(() => {
    setMissionVisibleAgents(ordered.map((log) => ({
      id: log.id,
      name: log.agent?.name ?? missionLogTitle(log),
      handle: log.agent?.handle ?? missionLogShortId(log),
      harness: log.source,
      branch: log.agent?.branch ?? null,
      project: log.project,
      model: log.agent?.model ?? null,
      state: log.agent?.state ?? null,
      agentClass: log.agent ? "agent" : "native-session",
      updatedAt: log.lastActiveAt,
      source: log.agent || log.attribution === "scout-managed" ? "scout" : "native",
      activity: missionActivity(log, now, activityWindowMs),
      lastActiveAt: log.lastActiveAt,
    })));
  }, [activityWindowMs, now, ordered]);

  /* ── Reveal from the left rail ── */

  const [revealedId, setRevealedId] = useState<string | null>(null);
  const consumedRevealRef = useRef<number | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!revealRequest) return;
    if (consumedRevealRef.current === revealRequest.serial) return;
    consumedRevealRef.current = revealRequest.serial;
    // Pinning guarantees the pane is inside the wall's cap, not just highlighted.
    setPinnedId(revealRequest.id);
    setRevealedId(revealRequest.id);
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => setRevealedId(null), REVEAL_FLASH_MS);
    clearMissionRevealRequest(revealRequest.serial);
  }, [revealRequest]);

  useEffect(() => () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
  }, []);

  /* ── Focus ── */

  const focusedLog = focusedId ? logs.find((log) => log.id === focusedId) ?? null : null;
  const focusedAgent = useMemo(() => {
    if (!focusedLog) return null;
    if (focusedLog.agent) {
      const registered = agents.find((agent) => agent.id === focusedLog.agent!.id);
      if (registered) return registered;
    }
    return syntheticAgent(focusedLog);
  }, [agents, focusedLog]);
  const focusedObserve: ObserveData | null = focusedLog?.agent
    ? observeCache[focusedLog.agent.id]?.data ?? null
    : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (e.key === "Escape") {
        if (focusedId) setMissionFocusedId(null);
        else if (mc.selectedIds.length > 0) clearMissionSelection();
        else if (pinnedId) setPinnedId(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        if (mc.visibleAgents.length === 0) return;
        e.preventDefault();
        const ids = mc.visibleAgents.map((a) => a.id);
        const allSelected = ids.every((id) => mc.selectedIds.includes(id));
        if (allSelected) {
          clearMissionSelection();
          return;
        }
        for (const id of ids) {
          if (!mc.selectedIds.includes(id)) toggleMissionSelected(id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, mc.selectedIds, mc.visibleAgents, pinnedId]);

  const openLog = useCallback(
    (log: MissionLog) => {
      navigate({ view: "ops", mode: "tail", tailQuery: log.sessionId });
    },
    [navigate],
  );

  const streamingLines = shown.reduce((total, log) => total + log.lines.length, 0);
  const quiet = logs.length - ordered.length;

  return (
    <div className="s-wall">
      <div className="s-wall-status">
        <span className="s-wall-status-key">logs</span>
        <span className="s-wall-status-value">
          {tiling.shown}/{ordered.length}
        </span>
        <span className="s-wall-status-key">grid</span>
        <span className="s-wall-status-value">
          {tiling.cols > 0 ? `${tiling.cols}×${tiling.rows}` : "—"}
        </span>
        <span className="s-wall-status-key">lines</span>
        <span className="s-wall-status-value">{streamingLines}</span>
        {tiling.hidden > 0 && (
          <span className="s-wall-status-hidden" title="Least recently active logs are withheld to keep panes readable">
            {tiling.hidden} withheld
          </span>
        )}
        {quiet > 0 && (
          <span className="s-wall-status-hidden" title="Sessions discovery knows of that have produced no output to tail">
            {quiet} quiet
          </span>
        )}
        {pinnedId && (
          <button type="button" className="s-wall-status-pin" onClick={() => setPinnedId(null)}>
            unpin
          </button>
        )}
      </div>

      <div
        ref={wallRef}
        className="s-wall-grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, tiling.cols)}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${Math.max(1, tiling.rows)}, minmax(0, 1fr))`,
          gap: WALL_GAP,
        }}
      >
        {shown.length === 0 ? (
          <div className="s-wall-empty">
            <div className="s-wall-empty-title">
              {logs.length === 0 ? "No logs on the wire" : "No matching logs"}
            </div>
            <div className="s-wall-empty-sub">
              {logs.length === 0
                ? "Panes appear as sessions start writing to their transcripts."
                : "Widen the activity window or clear the filter."}
            </div>
          </div>
        ) : (
          shown.map((log) => (
            <MissionLogPane
              key={log.id}
              log={log}
              selected={mc.selectedIds.includes(log.id)}
              revealed={revealedId === log.id}
              onOpen={() => setMissionFocusedId(log.id)}
              onToggleSelected={() => toggleMissionSelected(log.id)}
              onOpenLog={() => openLog(log)}
            />
          ))
        )}
      </div>

      {focusedAgent && (
        <FocusOverlay
          agent={focusedAgent}
          observe={focusedObserve}
          onClose={() => setMissionFocusedId(null)}
          onSend={(body) => sendToFocusedAgentSession(focusedAgent, body)}
          onOpenConversation={() => {
            setMissionFocusedId(null);
            if (isNativeSessionAgent(focusedAgent) && focusedAgent.harnessSessionId) {
              navigate({ view: "sessions", sessionId: focusedAgent.harnessSessionId });
              return;
            }
            void ensureAgentChat(focusedAgent)
              .then((conversationId) => navigate({ view: "conversation", conversationId }))
              .catch(() => navigate({
                view: "agents-v2",
                agentId: focusedAgent.id,
                tab: "message",
              }));
          }}
          onTail={() => {
            setMissionFocusedId(null);
            navigate({
              view: "ops",
              mode: "tail",
              tailQuery: focusedAgent.harnessSessionId ?? focusedAgent.handle ?? focusedAgent.name,
            });
          }}
          onProfile={() => {
            setMissionFocusedId(null);
            navigate({ view: "agents-v2", agentId: focusedAgent.id });
          }}
        />
      )}
    </div>
  );
}
