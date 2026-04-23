import "./mission-control.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { actorColor } from "../lib/colors.ts";
import { normalizeAgentState, agentStateLabel } from "../lib/agent-state.ts";
import { summarizeObserveEvent, useObservePolling } from "../lib/observe.ts";
import { conversationForAgent } from "../lib/router.ts";
import { SessionObserve, type SessionObserveData } from "./SessionObserve.tsx";
import type { Agent, Route } from "../lib/types.ts";

/* ── Constants ── */

const TILE_W = 420;
const TILE_H = 320;
const TILE_GAP = 20;
const GROUP_GAP_X = 48;
const GROUP_GAP_Y = 36;
const GROUP_LABEL_H = 28;
const CANVAS_PAD = 40;

const MINIMAP_W = 180;
const MINIMAP_MAX_H = 140;

/* ── Layout engine ── */

type LayoutTile = { agentId: string; x: number; y: number };
type LayoutGroup = { label: string; x: number; y: number; w: number; h: number; tiles: LayoutTile[] };
type CanvasLayout = { groups: LayoutGroup[]; canvasW: number; canvasH: number };

function computeLayout(agents: Agent[]): CanvasLayout {
  const groups = groupAgents(agents);
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

    const cols = Math.min(2, group.agents.length);
    const rows = Math.ceil(group.agents.length / cols);
    const groupW = cols * TILE_W + (cols - 1) * TILE_GAP;
    const groupH = GROUP_LABEL_H + rows * TILE_H + (rows - 1) * TILE_GAP;

    const tiles: LayoutTile[] = group.agents.map((a, i) => ({
      agentId: a.id,
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

type AgentGroup = { label: string; agents: Agent[] };

function groupAgents(agents: Agent[]): AgentGroup[] {
  const stateOrder: Record<string, number> = { working: 0, available: 1, offline: 2 };
  const sorted = [...agents].sort((a, b) => {
    const sa = stateOrder[normalizeAgentState(a.state)] ?? 1;
    const sb = stateOrder[normalizeAgentState(b.state)] ?? 1;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  const byProject = new Map<string, Agent[]>();
  for (const a of sorted) {
    const key = a.project ?? "unassigned";
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(a);
  }

  const groups: AgentGroup[] = [];
  for (const [project, group] of byProject) {
    groups.push({ label: project, agents: group });
  }
  groups.sort((a, b) => b.agents.length - a.agents.length);
  return groups;
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
  const observeCache = useObservePolling(agents);

  /* ── Pan / zoom ── */
  const viewportRef = useRef<HTMLDivElement>(null);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(([entry]) => {
      setVpSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => computeLayout(agents), [agents]);

  useEffect(() => {
    if (layout.canvasW === 0 || vpSize.w === 0) return;
    const fitZoom = Math.min(1, vpSize.w / layout.canvasW, vpSize.h / layout.canvasH);
    const z = Math.max(0.15, Math.min(1, fitZoom * 0.92));
    setPan({
      x: (vpSize.w - layout.canvasW * z) / 2,
      y: Math.max(8, (vpSize.h - layout.canvasH * z) / 2),
    });
    setZoom(z);
  }, [layout, vpSize]);

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

  /* ── Escape to close overlay ── */
  const focusedAgent = focusedId ? agents.find((a) => a.id === focusedId) : null;
  useEffect(() => {
    if (!focusedAgent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedAgent]);

  /* ── Minimap click ── */
  const onMinimapClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const mmScale = Math.min(MINIMAP_W / layout.canvasW, MINIMAP_MAX_H / layout.canvasH);
      const canvasX = mx / mmScale;
      const canvasY = my / mmScale;
      const vp = viewportRef.current;
      if (!vp) return;
      setPan({
        x: vp.clientWidth / 2 - canvasX * zoom,
        y: vp.clientHeight / 2 - canvasY * zoom,
      });
    },
    [layout, zoom],
  );

  const tilePositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const g of layout.groups) {
      for (const t of g.tiles) map[t.agentId] = { x: t.x, y: t.y };
    }
    return map;
  }, [layout]);

  const liveCount = agents.filter((a) => normalizeAgentState(a.state) === "working").length;

  return (
    <div className="s-mission">
      <div className="s-mission-bar">
        <span className="s-mission-bar-label">
          {agents.length} agent{agents.length !== 1 ? "s" : ""} ·{" "}
          {layout.groups.length} workspace{layout.groups.length !== 1 ? "s" : ""}
        </span>
        {liveCount > 0 && (
          <span className="s-mission-bar-live">
            <span className="s-mission-bar-live-dot" />
            {liveCount} active
          </span>
        )}
        <div className="s-mission-hotkeys">
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
        {agents.length === 0 ? (
          <div className="s-mission-empty">
            <div className="s-mission-empty-title">Mission Control</div>
            <div className="s-mission-empty-sub">
              Connect agents to observe their sessions here.
            </div>
          </div>
        ) : (
          <div
            className="s-mission-canvas"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
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

            {agents.map((agent) => {
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
          </div>
        )}

        {agents.length > 0 && (
          <Minimap
            layout={layout}
            agents={agents}
            pan={pan}
            zoom={zoom}
            viewportRef={viewportRef}
            onClick={onMinimapClick}
          />
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
  onClick,
}: {
  layout: CanvasLayout;
  agents: Agent[];
  pan: { x: number; y: number };
  zoom: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  if (layout.canvasW === 0) return null;

  const mmScale = Math.min(MINIMAP_W / layout.canvasW, MINIMAP_MAX_H / layout.canvasH);
  const mmW = layout.canvasW * mmScale;
  const mmH = layout.canvasH * mmScale;

  const vp = viewportRef.current;
  const vpW = vp?.clientWidth ?? 0;
  const vpH = vp?.clientHeight ?? 0;
  const vx = (-pan.x / zoom) * mmScale;
  const vy = (-pan.y / zoom) * mmScale;
  const vw = (vpW / zoom) * mmScale;
  const vh = (vpH / zoom) * mmScale;

  return (
    <div className="s-mission-minimap" style={{ width: mmW, height: mmH }} onClick={onClick}>
      {layout.groups.map((g) => (
        <div
          key={g.label}
          className="s-mission-minimap-group"
          style={{ left: g.x * mmScale, top: g.y * mmScale }}
        >
          {g.label}
        </div>
      ))}
      {layout.groups.flatMap((g) =>
        g.tiles.map((t) => {
          const agent = agents.find((a) => a.id === t.agentId);
          return (
            <div
              key={t.agentId}
              className="s-mission-minimap-tile"
              style={{
                left: t.x * mmScale,
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
          left: Math.max(0, vx),
          top: Math.max(0, vy),
          width: Math.min(vw, mmW),
          height: Math.min(vh, mmH),
        }}
      />
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
