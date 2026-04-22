import "./conductor-view.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor } from "../lib/colors.ts";
import { normalizeAgentState, agentStateLabel } from "../lib/agent-state.ts";
import type { Agent, FleetState, Route } from "../lib/types.ts";

/* ── Constants ── */

const TILE_W = 340;
const TILE_H = 220;
const TILE_GAP = 16;
const GROUP_GAP_X = 48;
const GROUP_GAP_Y = 36;
const GROUP_LABEL_H = 28;
const CANVAS_PAD = 40;

const MINIMAP_W = 180;
const MINIMAP_MAX_H = 140;

/* ── Layout engine ── */

type LayoutTile = { agentId: string; x: number; y: number };
type LayoutGroup = { label: string; x: number; y: number; w: number; h: number; tiles: LayoutTile[] };
type CanvasLayout = {
  groups: LayoutGroup[];
  canvasW: number;
  canvasH: number;
};

function computeLayout(agents: Agent[]): CanvasLayout {
  const groups = groupAgents(agents);
  if (groups.length === 0) {
    return { groups: [], canvasW: 0, canvasH: 0 };
  }

  const targetCols = Math.max(1, Math.round(Math.sqrt(groups.length * 1.4)));
  const laid: LayoutGroup[] = [];
  const colHeights = new Array(targetCols).fill(CANVAS_PAD);
  const colX = Array.from({ length: targetCols }, (_, i) => CANVAS_PAD + i * (TILE_W * 2 + TILE_GAP + GROUP_GAP_X));

  for (const group of groups) {
    const shortestCol = colHeights.indexOf(Math.min(...colHeights));
    const x = colX[shortestCol];
    const y = colHeights[shortestCol];

    const cols = Math.min(2, group.agents.length);
    const rows = Math.ceil(group.agents.length / cols);
    const groupW = cols * TILE_W + (cols - 1) * TILE_GAP;
    const groupH = GROUP_LABEL_H + rows * TILE_H + (rows - 1) * TILE_GAP;

    const tiles: LayoutTile[] = group.agents.map((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        agentId: a.id,
        x: x + col * (TILE_W + TILE_GAP),
        y: y + GROUP_LABEL_H + row * (TILE_H + TILE_GAP),
      };
    });

    laid.push({ label: group.label, x, y, w: groupW, h: groupH, tiles });
    colHeights[shortestCol] = y + groupH + GROUP_GAP_Y;
  }

  const canvasW = Math.max(...colX.map((x, i) => x + TILE_W * 2 + TILE_GAP)) + CANVAS_PAD;
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
  // Sort groups: largest first for better packing
  groups.sort((a, b) => b.agents.length - a.agents.length);
  return groups;
}

/* ── Helpers ── */

function terminalLinesForAgent(agent: Agent, taskSummary: string | null): string[] {
  const project = agent.project ?? "workspace";
  const branch = agent.branch ?? "main";
  const state = normalizeAgentState(agent.state);

  if (state === "working") {
    return [
      `$ cd ${project}`,
      `→ on branch ${branch}`,
      ...(taskSummary ? [`working: ${taskSummary}`] : []),
    ];
  }
  if (state === "available") {
    return [`$ cd ${project}`, `→ on branch ${branch}`, "idle — awaiting instruction"];
  }
  return ["offline"];
}

function stateChipColor(state: string | null): string {
  switch (normalizeAgentState(state)) {
    case "working":
      return "var(--green)";
    case "available":
      return "var(--accent)";
    default:
      return "var(--dim)";
  }
}

function Sparkline({ agentId, color }: { agentId: string; color: string }) {
  const points = useMemo(() => {
    const seed = agentId.charCodeAt(0);
    return Array.from({ length: 40 }, (_, i) =>
      0.5 + 0.35 * Math.sin(i * 0.5 + seed) + 0.15 * Math.cos(i * 1.1 + seed * 0.3),
    );
  }, [agentId]);

  const pts = points
    .map((v, i) => `${(i / (points.length - 1)) * 100},${20 - v * 18 - 1}`)
    .join(" ");

  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{ width: 80, height: 16 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1" />
    </svg>
  );
}

type AgentTask = { agentId: string; task: string; summary: string | null };

/* ── Conductor (main) ── */

export function ConductorView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [fleet, setFleet] = useState<FleetState | null>(null);

  /* ── Pan / zoom state ── */
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
      const { width, height } = entry.contentRect;
      setVpSize({ w: width, h: height });
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(async () => {
    try {
      setFleet(await api<FleetState>("/api/fleet"));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  const tasksByAgent = useMemo(() => {
    const map: Record<string, AgentTask> = {};
    for (const ask of fleet?.activeAsks ?? []) {
      map[ask.agentId] = { agentId: ask.agentId, task: ask.task, summary: ask.summary ?? null };
    }
    return map;
  }, [fleet]);

  const layout = useMemo(() => computeLayout(agents), [agents]);

  /* ── Center canvas on mount / agent change ── */
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

  /* ── Pan handlers ── */
  const onPointerDown = useCallback(
    (e: ReactMouseEvent) => {
      if ((e.target as HTMLElement).closest(".s-conductor-tile")) return;
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

  /* ── Zoom via wheel ── */
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

  /* ── Minimap click → pan ── */
  const onMinimapClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const mmScale = Math.min(
        MINIMAP_W / layout.canvasW,
        MINIMAP_MAX_H / layout.canvasH,
      );
      const canvasX = mx / mmScale;
      const canvasY = my / mmScale;
      const vpW = vp.clientWidth;
      const vpH = vp.clientHeight;
      setPan({
        x: vpW / 2 - canvasX * zoom,
        y: vpH / 2 - canvasY * zoom,
      });
    },
    [layout, zoom],
  );

  /* ── Tile position lookup ── */
  const tilePositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const g of layout.groups) {
      for (const t of g.tiles) {
        map[t.agentId] = { x: t.x, y: t.y };
      }
    }
    return map;
  }, [layout]);

  return (
    <div className="s-conductor">
      <div className="s-conductor-bar">
        <span className="s-conductor-bar-label">
          {agents.length} agent{agents.length !== 1 ? "s" : ""} ·{" "}
          {layout.groups.length} workspace{layout.groups.length !== 1 ? "s" : ""}
        </span>
        <div className="s-conductor-hotkeys">
          <span className="s-conductor-hotkey"><kbd>F</kbd> Freeze all</span>
          <span className="s-conductor-hotkey"><kbd>B</kbd> Broadcast</span>
          <span className="s-conductor-hotkey"><kbd>R</kbd> Route ask</span>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="s-conductor-viewport"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
      >
        <div
          className="s-conductor-canvas"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {/* Group labels */}
          {layout.groups.map((g) => (
            <div
              key={g.label}
              className="s-conductor-group-label"
              style={{ left: g.x, top: g.y }}
            >
              {g.label}
            </div>
          ))}

          {/* Tiles */}
          {agents.map((agent) => {
            const pos = tilePositions[agent.id];
            if (!pos) return null;
            return (
              <ConductorTile
                key={agent.id}
                agent={agent}
                task={tasksByAgent[agent.id] ?? null}
                x={pos.x}
                y={pos.y}
                onClick={() => setFocusedId(agent.id)}
              />
            );
          })}
        </div>

        {/* Minimap */}
        <Minimap
          layout={layout}
          agents={agents}
          pan={pan}
          zoom={zoom}
          viewportRef={viewportRef}
          onClick={onMinimapClick}
        />
      </div>

      {/* Focus overlay */}
      {focusedAgent && (
        <FocusOverlay
          agent={focusedAgent}
          task={tasksByAgent[focusedAgent.id] ?? null}
          onClose={() => setFocusedId(null)}
          onOpenProfile={() => {
            setFocusedId(null);
            navigate({ view: "agents", agentId: focusedAgent.id });
          }}
        />
      )}
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
  if (layout.canvasW === 0 || agents.length === 0) return null;

  const mmScale = Math.min(
    MINIMAP_W / layout.canvasW,
    MINIMAP_MAX_H / layout.canvasH,
  );
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
    <div
      className="s-conductor-minimap"
      style={{ width: mmW, height: mmH, opacity: 0.85 }}
      onClick={onClick}
    >
      {/* Group labels */}
      {layout.groups.map((g) => (
        <div
          key={g.label}
          className="s-conductor-minimap-group"
          style={{ left: g.x * mmScale, top: g.y * mmScale }}
        >
          {g.label}
        </div>
      ))}

      {/* Tile rects */}
      {layout.groups.flatMap((g) =>
        g.tiles.map((t) => {
          const agent = agents.find((a) => a.id === t.agentId);
          return (
            <div
              key={t.agentId}
              className="s-conductor-minimap-tile"
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

      {/* Viewport indicator */}
      <div
        className="s-conductor-minimap-viewport"
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

/* ── Focus overlay ── */

function FocusOverlay({
  agent,
  task,
  onClose,
  onOpenProfile,
}: {
  agent: Agent;
  task: AgentTask | null;
  onClose: () => void;
  onOpenProfile: () => void;
}) {
  const lines = terminalLinesForAgent(agent, task?.summary ?? null);

  return (
    <div className="s-conductor-overlay" onClick={onClose}>
      <div className="s-conductor-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="s-conductor-overlay-header">
          <div
            className="s-ops-avatar"
            style={{ "--size": "32px", background: actorColor(agent.name) } as React.CSSProperties}
          >
            {agent.name[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>
              {agent.name}{" "}
              <span style={{ color: "var(--dim)", fontSize: 12 }}>
                {agent.handle ? `@${agent.handle}` : ""}
              </span>
            </div>
            <div className="s-conductor-tile-meta">
              {agent.project ?? "—"} · {agent.branch ?? "main"}
            </div>
          </div>
          <span style={{ flex: 1 }} />
          <button className="s-ops-btn" onClick={onClose}>ESC</button>
        </div>
        <div className="s-conductor-overlay-body">
          <div className="s-conductor-overlay-task">
            {task?.task ?? "No active task"}
          </div>
          <div className="s-conductor-overlay-detail">
            › {task?.summary ?? agentStateLabel(agent.state)}
          </div>
          <div className="s-conductor-terminal" style={{ height: "auto", minHeight: 160 }}>
            {lines.map((line, i) => (
              <div
                key={i}
                className={`s-conductor-terminal-line${
                  line.startsWith("$") ? " s-conductor-terminal-line--cmd" : ""
                }${line.startsWith("→") || line.startsWith("+") ? " s-conductor-terminal-line--result" : ""}`}
              >
                {line}
              </div>
            ))}
            {normalizeAgentState(agent.state) === "working" && (
              <span className="s-conductor-terminal-cursor" />
            )}
          </div>
        </div>
        <div className="s-conductor-overlay-footer">
          <button className="s-ops-btn s-ops-btn--primary">Send instruction</button>
          <button className="s-ops-btn">Freeze</button>
          <button className="s-ops-btn">Route ask</button>
          <span style={{ flex: 1 }} />
          <button className="s-ops-btn" onClick={onOpenProfile}>
            Open profile ↗
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Tile ── */

function ConductorTile({
  agent,
  task,
  x,
  y,
  onClick,
}: {
  agent: Agent;
  task: AgentTask | null;
  x: number;
  y: number;
  onClick: () => void;
}) {
  const color = actorColor(agent.name);
  const chipColor = stateChipColor(agent.state);
  const stateLabel = agentStateLabel(agent.state).toUpperCase();
  const lines = terminalLinesForAgent(agent, task?.summary ?? null);
  const isWorking = normalizeAgentState(agent.state) === "working";

  return (
    <div
      className="s-conductor-tile"
      style={{ left: x, top: y, height: TILE_H }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div className="s-conductor-tile-identity">
        <div
          className="s-ops-avatar"
          style={{ "--size": "24px", background: color } as React.CSSProperties}
        >
          {agent.name[0]?.toUpperCase()}
        </div>
        <div className="s-conductor-tile-identity-copy">
          <div className="s-conductor-tile-name">
            {agent.name}
            <span className="s-conductor-tile-handle">
              {agent.handle ? `@${agent.handle}` : ""}
            </span>
          </div>
          <div className="s-conductor-tile-meta">
            {agent.project ?? "—"} · {agent.branch ?? "main"}
          </div>
        </div>
        <span className="s-ops-state-chip" style={{ color: chipColor }}>
          {stateLabel}
        </span>
      </div>

      <div className="s-conductor-tile-task">
        {task?.task ?? "No active task"}
      </div>

      <div className="s-conductor-terminal">
        {lines.slice(-4).map((line, i) => (
          <div
            key={i}
            className={`s-conductor-terminal-line${
              line.startsWith("$") ? " s-conductor-terminal-line--cmd" : ""
            }${line.startsWith("→") || line.startsWith("+") ? " s-conductor-terminal-line--result" : ""}`}
            style={{ opacity: (i + 1) / Math.min(4, lines.length) }}
          >
            {line}
          </div>
        ))}
        {isWorking && <span className="s-conductor-terminal-cursor" />}
      </div>

      <div className="s-conductor-tile-footer">
        <Sparkline agentId={agent.id} color={color} />
        <span className="s-conductor-tile-detail">
          {task?.summary ?? agentStateLabel(agent.state)}
        </span>
        {isWorking && <span className="s-conductor-terminal-cursor" />}
      </div>
    </div>
  );
}
