import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Canvas } from "@hudsonkit/canvas";
import type { Agent, MeshStatus } from "../lib/types.ts";
import {
  useMeshViewStore,
  type MeshDensity,
} from "../lib/mesh-view-store.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import { stateColor } from "../lib/colors.ts";
import { timeAgo } from "../lib/time.ts";
import { useScout } from "../scout/Provider.tsx";
import { useAgentHoverCard } from "../components/useAgentHoverCard.tsx";

type TileBindings = ReturnType<ReturnType<typeof useAgentHoverCard>["bind"]>;

type Pos = { x: number; y: number };

type CanvasState = { pan: Pos; scale: number };
type CanvasAction =
  | { type: "pan"; delta: Pos }
  | { type: "zoom"; factor: number; mx: number; my: number; cx: number; cy: number };

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  if (action.type === "pan") {
    return { ...state, pan: { x: state.pan.x + action.delta.x, y: state.pan.y + action.delta.y } };
  }
  if (action.type === "zoom") {
    const newScale = Math.max(0.25, Math.min(4, state.scale * action.factor));
    const { mx, my, cx, cy } = action;
    const worldX = (mx - cx) / state.scale - state.pan.x;
    const worldY = (my - cy) / state.scale - state.pan.y;
    return { scale: newScale, pan: { x: (mx - cx) / newScale - worldX, y: (my - cy) / newScale - worldY } };
  }
  return state;
}

function shortHost(s?: string | null): string {
  if (!s) return "";
  return s.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].split(".")[0] || s.slice(0, 8);
}

type AgentCluster = {
  key: string;
  label: string;
  instances: Agent[];
};

function clusterKey(agent: Agent): { key: string; label: string } {
  const raw =
    (agent.name && agent.name.trim()) ||
    (agent.handle && agent.handle.trim()) ||
    (agent.harness && agent.harness.trim()) ||
    "agent";
  return { key: raw.toLowerCase(), label: raw };
}

function groupAgentsByName(agents: Agent[]): AgentCluster[] {
  const byKey = new Map<string, AgentCluster>();
  for (const agent of agents) {
    const { key, label } = clusterKey(agent);
    let cluster = byKey.get(key);
    if (!cluster) {
      cluster = { key, label, instances: [] };
      byKey.set(key, cluster);
    }
    cluster.instances.push(agent);
  }
  // Stable order: alphabetical by label, total instance count as tiebreaker.
  // Working/available state never reorders clusters, so the map doesn't reshuffle on refresh.
  return Array.from(byKey.values())
    .map((c) => {
      c.instances.sort((a, b) => {
        const byId = a.id.localeCompare(b.id);
        return byId;
      });
      return c;
    })
    .sort((a, b) => {
      const byLabel = a.label.localeCompare(b.label);
      if (byLabel !== 0) return byLabel;
      return b.instances.length - a.instances.length;
    });
}

type DensityMetrics = {
  density: MeshDensity;
  instanceW: number;
  instanceH: number;
  stepX: number;
  stepY: number;
  clusterPadX: number;
  clusterPadY: number;
  labelH: number;
  clusterGap: number;
};

function densityMetrics(density: MeshDensity): DensityMetrics {
  switch (density) {
    case "compact":
      return { density, instanceW: 138, instanceH: 32, stepX: 144, stepY: 38, clusterPadX: 12, clusterPadY: 12, labelH: 22, clusterGap: 16 };
    case "spacious":
      return { density, instanceW: 260, instanceH: 68, stepX: 268, stepY: 76, clusterPadX: 14, clusterPadY: 14, labelH: 26, clusterGap: 16 };
    default:
      return { density: "comfortable", instanceW: 210, instanceH: 52, stepX: 218, stepY: 60, clusterPadX: 12, clusterPadY: 12, labelH: 24, clusterGap: 14 };
  }
}

type ClusterLayout = {
  cluster: AgentCluster;
  x: number;
  y: number;
  width: number;
  height: number;
  cols: number;
};

function chooseCols(count: number, targetAspect: number): number {
  // targetAspect = width / height. Want cols/rows ≈ targetAspect for a single cluster.
  // cols * rows >= count, cols = sqrt(count * targetAspect).
  return Math.max(1, Math.round(Math.sqrt(count * targetAspect)));
}

function packClusters(
  clusters: AgentCluster[],
  m: DensityMetrics,
  viewportAspect: number,
): ClusterLayout[] {
  if (clusters.length === 0) return [];

  // Per-cluster size: cols proportional to sqrt(count) with viewport aspect bias.
  const sized = clusters.map((c) => {
    const count = c.instances.length;
    const cols = chooseCols(count, Math.max(0.6, Math.min(viewportAspect, 2.0)));
    const rows = Math.ceil(count / cols);
    const innerW = cols * m.stepX - (m.stepX - m.instanceW);
    const innerH = rows * m.stepY - (m.stepY - m.instanceH);
    return {
      cluster: c,
      cols,
      width: innerW + m.clusterPadX * 2,
      height: innerH + m.clusterPadY * 2 + m.labelH,
    };
  });

  // Choose canvas target width to roughly match viewport aspect after wrapping.
  const totalArea = sized.reduce((acc, s) => acc + s.width * s.height, 0);
  const targetWidth = Math.max(
    Math.max(...sized.map((s) => s.width)),
    Math.sqrt(totalArea * viewportAspect),
  );

  const gap = m.clusterGap;
  const placed: ClusterLayout[] = [];
  let rowX = 0;
  let rowY = 0;
  let rowH = 0;

  for (const s of sized) {
    if (rowX > 0 && rowX + s.width > targetWidth) {
      rowY += rowH + gap;
      rowX = 0;
      rowH = 0;
    }
    placed.push({
      cluster: s.cluster,
      x: rowX,
      y: rowY,
      width: s.width,
      height: s.height,
      cols: s.cols,
    });
    rowX += s.width + gap;
    rowH = Math.max(rowH, s.height);
  }

  // Re-center on origin.
  const minX = Math.min(...placed.map((r) => r.x));
  const maxX = Math.max(...placed.map((r) => r.x + r.width));
  const minY = Math.min(...placed.map((r) => r.y));
  const maxY = Math.max(...placed.map((r) => r.y + r.height));
  const dx = -((minX + maxX) / 2);
  const dy = -((minY + maxY) / 2);
  return placed.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
}

function instanceCoord(index: number, cols: number, m: DensityMetrics): Pos {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: m.clusterPadX + col * m.stepX,
    y: m.labelH + m.clusterPadY + row * m.stepY,
  };
}

function harnessModel(agent: Agent): string {
  const h = agent.harness?.trim();
  const m = agent.model?.trim();
  if (h && m) return `${h}/${m}`;
  return h || m || "—";
}

function cwdBranch(agent: Agent): string {
  const project = agent.project?.trim();
  const branch = agent.branch?.trim();
  if (project && branch) return `${project}/${branch}`;
  return project || branch || "—";
}

function cwdFull(agent: Agent): string {
  return agent.cwd || agent.projectRoot || "—";
}

function SpecRow({ label, value, path }: { label: string; value: string; path?: boolean }) {
  return (
    <span className="mesh-sheet-row">
      <span className="mesh-sheet-row-label">{label}</span>
      <span className={`mesh-sheet-row-value${path ? " mesh-sheet-row-value--path" : ""}`} title={value}>{value}</span>
    </span>
  );
}

function OpenBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="mesh-sheet-open"
      title="Open agent view"
      aria-label="Open agent view"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      ↗
    </button>
  );
}

function AgentSpec({
  agent,
  onOpen,
  bindings,
  active,
}: {
  agent: Agent;
  onOpen: () => void;
  bindings: TileBindings | null;
  active: boolean;
}) {
  const state = normalizeAgentState(agent.state);
  const isOrganic = agent.agentClass === "organic";
  const time = agent.updatedAt ? timeAgo(agent.updatedAt) : "";
  const primary = harnessModel(agent);
  const secondary = cwdBranch(agent);
  return (
    <div
      {...(bindings ?? {})}
      className={`mesh-instance-spec mesh-instance-spec--${state}${isOrganic ? " mesh-instance-spec--organic" : ""}${active ? " mesh-instance--active" : ""}`}
      style={{ "--state-stripe": stateColor(agent.state) } as React.CSSProperties}
      title={`${primary} — ${secondary}`}
    >
      <span className="mesh-instance-spec-row">
        <span className="mesh-instance-spec-primary">{primary}</span>
        {time && <span className="mesh-instance-spec-time">{time}</span>}
      </span>
      <span className="mesh-instance-spec-row">
        <span className="mesh-instance-spec-secondary">{secondary}</span>
        <OpenBtn onClick={onOpen} />
      </span>
    </div>
  );
}

function AgentChip({
  agent,
  onOpen,
  bindings,
  active,
}: {
  agent: Agent;
  onOpen: () => void;
  bindings: TileBindings | null;
  active: boolean;
}) {
  const state = normalizeAgentState(agent.state);
  const isOrganic = agent.agentClass === "organic";
  const time = agent.updatedAt ? timeAgo(agent.updatedAt) : "—";
  const identity = `${harnessModel(agent)} · ${cwdBranch(agent)}`;
  return (
    <div
      {...(bindings ?? {})}
      className={`mesh-instance-sheet mesh-instance-sheet--${state}${isOrganic ? " mesh-instance-sheet--organic" : ""}${active ? " mesh-instance--active" : ""}`}
      style={{ "--state-stripe": stateColor(agent.state) } as React.CSSProperties}
      title={`${identity}\n${cwdFull(agent)}`}
    >
      <span className="mesh-sheet-line mesh-sheet-line--head">
        <span className="mesh-sheet-id">{identity}</span>
        <span className="mesh-sheet-time">{time}</span>
        <OpenBtn onClick={onOpen} />
      </span>
      <span className="mesh-sheet-line">
        <span className="mesh-sheet-path">{cwdFull(agent)}</span>
        <span className="mesh-sheet-ctx"><span className="mesh-sheet-ctx-label">CTX</span> —</span>
      </span>
    </div>
  );
}

function AgentCard({
  agent,
  onOpen,
  bindings,
  active,
}: {
  agent: Agent;
  onOpen: () => void;
  bindings: TileBindings | null;
  active: boolean;
}) {
  const state = normalizeAgentState(agent.state);
  const isOrganic = agent.agentClass === "organic";
  const time = agent.updatedAt ? timeAgo(agent.updatedAt) : "—";
  const identity = `${harnessModel(agent)} · ${cwdBranch(agent)}`;
  const agentClass = agent.agentClass?.trim();
  return (
    <div
      {...(bindings ?? {})}
      className={`mesh-instance-sheet mesh-instance-sheet--spacious mesh-instance-sheet--${state}${isOrganic ? " mesh-instance-sheet--organic" : ""}${active ? " mesh-instance--active" : ""}`}
      style={{ "--state-stripe": stateColor(agent.state) } as React.CSSProperties}
      title={`${identity}\n${cwdFull(agent)}`}
    >
      <span className="mesh-sheet-line mesh-sheet-line--head">
        <span className="mesh-sheet-id">{identity}</span>
        <span className="mesh-sheet-time">{time}</span>
        <OpenBtn onClick={onOpen} />
      </span>
      <span className="mesh-sheet-line">
        <span className="mesh-sheet-path">{cwdFull(agent)}</span>
      </span>
      <span className="mesh-sheet-line">
        <span className="mesh-sheet-ctx"><span className="mesh-sheet-ctx-label">CTX</span> —</span>
        {agentClass && <span className="mesh-sheet-tag">{agentClass}</span>}
      </span>
    </div>
  );
}

function ClusterRegion({
  layout,
  metrics,
  onAgentOpen,
  bindFor,
  activeId,
}: {
  layout: ClusterLayout;
  metrics: DensityMetrics;
  onAgentOpen: (agent: Agent) => void;
  bindFor: (agentId: string) => TileBindings | null;
  activeId: string | null;
}) {
  const { cluster, x, y, width, height, cols } = layout;
  const counts = useMemo(() => {
    const acc = { working: 0, available: 0, offline: 0 };
    for (const agent of cluster.instances) {
      acc[normalizeAgentState(agent.state)] += 1;
    }
    return acc;
  }, [cluster.instances]);

  return (
    <div
      className="mesh-cluster"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
      }}
    >
      <div className="mesh-cluster-header" style={{ height: metrics.labelH }}>
        <span className="mesh-cluster-name">{cluster.label}</span>
        <span className="mesh-cluster-count">{cluster.instances.length}</span>
        <span className="mesh-cluster-states">
          {counts.working > 0 && (
            <span className="mesh-cluster-state mesh-cluster-state--working">
              <span className="mesh-cluster-state-dot" />
              {counts.working}
            </span>
          )}
          {counts.available > 0 && (
            <span className="mesh-cluster-state mesh-cluster-state--available">
              <span className="mesh-cluster-state-dot" />
              {counts.available}
            </span>
          )}
          {counts.offline > 0 && (
            <span className="mesh-cluster-state mesh-cluster-state--offline">
              <span className="mesh-cluster-state-dot" />
              {counts.offline}
            </span>
          )}
        </span>
      </div>
      {cluster.instances.map((agent, i) => {
        const coord = instanceCoord(i, cols, metrics);
        return (
          <div
            key={agent.id}
            style={{
              position: "absolute",
              left: coord.x,
              top: coord.y,
              width: metrics.instanceW,
              height: metrics.instanceH,
            }}
          >
            {metrics.density === "compact" ? (
              <AgentSpec
                agent={agent}
                onOpen={() => onAgentOpen(agent)}
                bindings={bindFor(agent.id)}
                active={activeId === agent.id}
              />
            ) : metrics.density === "spacious" ? (
              <AgentCard
                agent={agent}
                onOpen={() => onAgentOpen(agent)}
                bindings={bindFor(agent.id)}
                active={activeId === agent.id}
              />
            ) : (
              <AgentChip
                agent={agent}
                onOpen={() => onAgentOpen(agent)}
                bindings={bindFor(agent.id)}
                active={activeId === agent.id}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function HostFrame({
  hostLabel,
  totalAgents,
  workingAgents,
}: {
  hostLabel: string;
  totalAgents: number;
  workingAgents: number;
}) {
  return (
    <div className="mesh-host-frame">
      <span className="mesh-host-frame-eyebrow">Local host</span>
      <span className="mesh-host-frame-name">{hostLabel}</span>
      <span className="mesh-host-frame-stats">
        <span className="mesh-host-frame-stat">{totalAgents} agent{totalAgents === 1 ? "" : "s"}</span>
        {workingAgents > 0 && (
          <span className="mesh-host-frame-stat mesh-host-frame-stat--working">{workingAgents} working</span>
        )}
      </span>
    </div>
  );
}

export function MeshCanvas({ mesh, agents = [] }: { mesh: MeshStatus; agents?: Agent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [canvas, dispatch] = useReducer(canvasReducer, { pan: { x: 0, y: 0 }, scale: 1 });
  const { density, query, stateFilter } = useMeshViewStore();
  const { navigate } = useScout();

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const rect = el.getBoundingClientRect();
      dispatch({ type: "zoom", factor, mx: e.clientX - rect.left, my: e.clientY - rect.top, cx: rect.width / 2, cy: rect.height / 2 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const metrics = useMemo(() => densityMetrics(density), [density]);
  const filteredAgents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agents.filter((a) => {
      if (stateFilter !== "all" && normalizeAgentState(a.state) !== stateFilter) return false;
      if (!needle) return true;
      const hay = `${a.name ?? ""} ${a.handle ?? ""} ${a.harness ?? ""} ${a.project ?? ""} ${a.branch ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [agents, query, stateFilter]);
  const clusters = useMemo(() => groupAgentsByName(filteredAgents), [filteredAgents]);

  const viewportAspect = size.w > 0 && size.h > 0 ? size.w / size.h : 1.6;
  const layouts = useMemo(
    () => packClusters(clusters, metrics, viewportAspect),
    [clusters, metrics, viewportAspect],
  );

  const handleAgentOpen = useCallback(
    (agent: Agent) => {
      if (agent.agentClass === "organic") return;
      navigate({ view: "agents", agentId: agent.id });
    },
    [navigate],
  );

  const hoverableAgents = useMemo(
    () => filteredAgents.filter((a) => a.agentClass !== "organic"),
    [filteredAgents],
  );
  const hoverableIds = useMemo(() => hoverableAgents.map((a) => a.id), [hoverableAgents]);

  const hover = useAgentHoverCard({
    agents: hoverableAgents,
    orderedIds: hoverableIds,
    navigate,
    selectMode: "preview",
  });

  const bindFor = useCallback(
    (agentId: string): TileBindings | null => {
      if (!hoverableIds.includes(agentId)) return null;
      return hover.bind(agentId);
    },
    [hover, hoverableIds],
  );
  const activeId = hover.activeAgent?.id ?? null;

  const { pan, scale } = canvas;
  const cx = size.w / 2;
  const cy = size.h / 2;

  const totalAgents = agents.length;
  const workingAgents = useMemo(
    () => agents.filter((a) => normalizeAgentState(a.state) === "working").length,
    [agents],
  );
  const hostLabel = shortHost(mesh.localNode?.hostName) || mesh.localNode?.name || "this host";

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {size.w > 0 && (
        <Canvas
          panOffset={pan}
          scale={scale}
          onPan={(delta) => dispatch({ type: "pan", delta })}
          gridOpacity={0.7}
        />
      )}

      {/* World-space content */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `translate(${cx}px, ${cy}px) translate(${pan.x * scale}px, ${pan.y * scale}px) scale(${scale})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
        }}
      >
        {layouts.length === 0 ? (
          <div
            style={{
              position: "absolute",
              left: -120,
              top: -20,
              width: 240,
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <div className="mesh-empty-pill">no local agents</div>
          </div>
        ) : (
          layouts.map((layout) => (
            <div key={layout.cluster.key} style={{ position: "absolute", pointerEvents: "all" }}>
              <ClusterRegion
                layout={layout}
                metrics={metrics}
                onAgentOpen={handleAgentOpen}
                bindFor={bindFor}
                activeId={activeId}
              />
            </div>
          ))
        )}
      </div>

      <HostFrame hostLabel={hostLabel} totalAgents={totalAgents} workingAgents={workingAgents} />

      {/* Zoom hint */}
      <div className="mesh-canvas-hint">scroll to zoom · drag to pan</div>

      {hover.card}
    </div>
  );
}
