import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Canvas } from "@hudsonkit/canvas";
import type { Agent, MeshStatus } from "../lib/types.ts";
import {
  useMeshViewStore,
  setMeshSelection,
  setProbeEntry,
  type ProbeEntry,
  type ProbeResult,
  type ProbeAgent,
} from "../lib/mesh-view-store.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import { timeAgo } from "../lib/time.ts";
import { api } from "../lib/api.ts";

type NodeInfo = {
  id: string;
  label: string;
  sublabel: string;
  kind: "local" | "mesh" | "tailnet";
  online: boolean;
  discoverable?: boolean;
};

type EdgeInfo = {
  fromId: string;
  toId: string;
  transport: "mesh" | "tailnet";
  online: boolean;
};

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

function shortName(s?: string | null): string {
  if (!s) return "";
  return s.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].split(".")[0] || s.slice(0, 8);
}

function cleanIp(addr: string): string {
  return addr.split("/")[0];
}

function fanPositions(nodePos: Pos, count: number, radius = 130, spreadDeg = 90): Pos[] {
  if (count === 0) return [];
  const isAtOrigin = Math.abs(nodePos.x) < 10 && Math.abs(nodePos.y) < 10;
  const baseAngle = isAtOrigin ? 0 : Math.atan2(nodePos.y, nodePos.x);
  const spreadRad = (spreadDeg * Math.PI) / 180;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const angle = baseAngle + t * spreadRad;
    return {
      x: nodePos.x + Math.round(radius * Math.cos(angle)),
      y: nodePos.y + Math.round(radius * Math.sin(angle)),
    };
  });
}

function buildGraph(mesh: MeshStatus): { nodes: NodeInfo[]; edges: EdgeInfo[] } {
  const localId = mesh.localNode?.id;
  const nodes: NodeInfo[] = [];
  const edges: EdgeInfo[] = [];

  if (mesh.localNode) {
    nodes.push({
      id: mesh.localNode.id,
      label: shortName(mesh.localNode.hostName) || mesh.localNode.name,
      sublabel: "this node",
      kind: "local",
      online: mesh.health.reachable,
      discoverable: mesh.identity.discoverable,
    });
  }

  const allMeshNodes = Object.values(mesh.nodes);
  const remoteMesh = allMeshNodes.filter((n) => n.id !== localId);
  const meshHostNames = new Set(
    allMeshNodes.flatMap((n) => [shortName(n.hostName), shortName(n.brokerUrl)]).filter(Boolean),
  );

  for (const node of remoteMesh) {
    nodes.push({
      id: node.id,
      label: shortName(node.hostName) || node.name || node.id.slice(0, 8),
      sublabel: node.advertiseScope === "mesh" ? "mesh peer" : "local only",
      kind: "mesh",
      online: node.advertiseScope === "mesh",
    });
    if (localId) {
      edges.push({ fromId: localId, toId: node.id, transport: "mesh", online: node.advertiseScope === "mesh" });
    }
  }

  for (const peer of mesh.tailscale.peers) {
    const label = shortName(peer.hostName) || shortName(peer.name);
    if (label && meshHostNames.has(label)) continue;
    const peerId = `tailnet:${peer.id}`;
    nodes.push({ id: peerId, label: label || "tailnet", sublabel: "tailnet only", kind: "tailnet", online: peer.online });
    if (localId) {
      edges.push({ fromId: localId, toId: peerId, transport: "tailnet", online: peer.online });
    }
  }

  return { nodes, edges };
}

function layoutNodes(nodes: NodeInfo[]): Map<string, Pos> {
  const map = new Map<string, Pos>();
  const local = nodes.find((n) => n.kind === "local");
  if (local) map.set(local.id, { x: 0, y: 0 });

  const meshPeers = nodes.filter((n) => n.kind === "mesh");
  const tailnetPeers = nodes.filter((n) => n.kind === "tailnet");
  const hasBoth = meshPeers.length > 0 && tailnetPeers.length > 0;
  const meshR = 170;
  const tailR = hasBoth ? 260 : 170;

  meshPeers.forEach((node, i) => {
    const angle = (i / meshPeers.length) * Math.PI * 2 - Math.PI / 2;
    map.set(node.id, { x: Math.round(meshR * Math.cos(angle)), y: Math.round(meshR * Math.sin(angle)) });
  });

  const tailOffset = hasBoth ? Math.PI / Math.max(tailnetPeers.length, 1) : 0;
  tailnetPeers.forEach((node, i) => {
    const angle = (i / Math.max(tailnetPeers.length, 1)) * Math.PI * 2 - Math.PI / 2 + tailOffset;
    map.set(node.id, { x: Math.round(tailR * Math.cos(angle)), y: Math.round(tailR * Math.sin(angle)) });
  });

  const hasPeers = meshPeers.length > 0 || tailnetPeers.length > 0;
  if (!hasPeers) map.set("__placeholder", { x: 200, y: 0 });

  return map;
}

function NodeCard({ node, isSelected }: { node: NodeInfo; isSelected: boolean }) {
  const isLocal = node.kind === "local";

  let cardClass = "mesh-card";
  if (isLocal) cardClass += " mesh-card--local";
  else if (node.kind === "mesh") cardClass += node.online ? " mesh-card--mesh-online" : " mesh-card--mesh-offline";
  else cardClass += node.online ? " mesh-card--tailnet-online" : " mesh-card--tailnet-offline";
  if (isSelected) cardClass += " mesh-card--selected";

  let dotClass = "mesh-card-dot";
  if (isLocal) dotClass += " mesh-card-dot--local";
  else if (node.kind === "mesh") dotClass += node.online ? " mesh-card-dot--green" : " mesh-card-dot--dim";
  else dotClass += node.online ? " mesh-card-dot--sky" : " mesh-card-dot--dim";

  return (
    <div className={cardClass} data-interactive="true">
      <span className={dotClass} />
      <div className="mesh-card-body">
        <span className="mesh-card-name">{node.label}</span>
        <span className="mesh-card-sub">{node.sublabel}</span>
      </div>
    </div>
  );
}

function AgentSubNode({ agent, pos, index }: { agent: ProbeAgent; pos: Pos; index: number }) {
  const state = agent.state === "working" ? "working" : agent.state === "available" ? "available" : "offline";
  return (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        animationName: "meshAgentPopIn",
        animationDuration: "0.4s",
        animationTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        animationDelay: `${index * 55}ms`,
        animationFillMode: "both",
      }}
    >
      <div className="mesh-agent-sub">
        <span className={`mesh-agent-sub-dot mesh-agent-sub-dot--${state}`} />
        <span className="mesh-agent-sub-name">{agent.title}</span>
      </div>
    </div>
  );
}

function NodeDetailPanel({
  selectedId,
  mesh,
  agents,
  positions,
  probeEntry,
}: {
  selectedId: string;
  mesh: MeshStatus;
  agents: Agent[];
  positions: Map<string, Pos>;
  probeEntry: ProbeEntry | null;
}) {
  const pos = positions.get(selectedId);
  if (!pos) return null;

  const isLocal = mesh.localNode?.id === selectedId;
  const isTailnet = selectedId.startsWith("tailnet:");
  const tailnetPeerId = isTailnet ? selectedId.slice("tailnet:".length) : null;
  const tailnetPeer = tailnetPeerId ? mesh.tailscale.peers.find((p) => p.id === tailnetPeerId) : null;
  const meshNode = !isLocal && !isTailnet ? mesh.nodes[selectedId] : null;

  const tailnetIp = tailnetPeer?.addresses?.[0] ? cleanIp(tailnetPeer.addresses[0]) : null;

  const allCaps = isLocal
    ? [...new Set(agents.flatMap((a) => a.capabilities ?? []))].slice(0, 6)
    : [];
  const topAgents = isLocal
    ? [...agents]
        .sort((a, b) => {
          const rank: Record<string, number> = { working: 0, available: 1 };
          return (rank[normalizeAgentState(a.state)] ?? 2) - (rank[normalizeAgentState(b.state)] ?? 2);
        })
        .slice(0, 5)
    : [];

  return (
    <div
      className="mesh-node-detail"
      style={{
        position: "absolute",
        left: pos.x + 78,
        top: pos.y,
        transform: "translate(0, -50%)",
      }}
    >
      {isLocal && (
        <>
          {topAgents.length > 0 && (
            <div className="mesh-detail-section">
              <div className="mesh-detail-label">agents</div>
              {topAgents.map((agent) => {
                const state = normalizeAgentState(agent.state);
                return (
                  <div key={agent.id} className="mesh-detail-agent">
                    <span className={`mesh-detail-dot mesh-detail-dot--${state}`} />
                    <div className="mesh-detail-agent-body">
                      <span className="mesh-detail-agent-name">{agent.handle ?? agent.name}</span>
                    </div>
                    <span className={`mesh-detail-agent-state mesh-detail-agent-state--${state}`}>{state}</span>
                  </div>
                );
              })}
            </div>
          )}
          {topAgents.length === 0 && (
            <div className="mesh-detail-section">
              <div className="mesh-detail-label">agents</div>
              <div className="mesh-detail-empty">none running</div>
            </div>
          )}
          {allCaps.length > 0 && (
            <div className="mesh-detail-section">
              <div className="mesh-detail-label">capabilities</div>
              <div className="mesh-detail-caps">
                {allCaps.map((cap) => (
                  <span key={cap} className="mesh-detail-cap">{cap}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {meshNode && (
        <div className="mesh-detail-section">
          <div className="mesh-detail-label">broker</div>
          {meshNode.brokerUrl && (
            <div className="mesh-detail-row">
              <span className="mesh-detail-key">url</span>
              <code className="mesh-detail-val">{shortName(meshNode.brokerUrl)}</code>
            </div>
          )}
          <div className="mesh-detail-row">
            <span className="mesh-detail-key">scope</span>
            <span className="mesh-detail-val">{meshNode.advertiseScope === "mesh" ? "announced" : "local only"}</span>
          </div>
          {meshNode.lastSeenAt && (
            <div className="mesh-detail-row">
              <span className="mesh-detail-key">last seen</span>
              <span className="mesh-detail-val">{timeAgo(meshNode.lastSeenAt)}</span>
            </div>
          )}
        </div>
      )}

      {tailnetPeer && (
        <>
          <div className="mesh-detail-section">
            <div className="mesh-detail-label">tailnet peer</div>
            {tailnetIp && (
              <div className="mesh-detail-row">
                <span className="mesh-detail-key">address</span>
                <code className="mesh-detail-val">{tailnetIp}</code>
              </div>
            )}
            {tailnetPeer.os && (
              <div className="mesh-detail-row">
                <span className="mesh-detail-key">platform</span>
                <span className="mesh-detail-val">{tailnetPeer.os}</span>
              </div>
            )}
          </div>

          {(!probeEntry || probeEntry.status === "loading") && (
            <div className="mesh-detail-section">
              <div className="mesh-detail-empty">Connecting to broker…</div>
            </div>
          )}

          {probeEntry?.status === "error" && (
            <div className="mesh-detail-section">
              <div className="mesh-detail-empty">{probeEntry.result?.error ?? "Broker unreachable"}</div>
            </div>
          )}

          {probeEntry?.status === "done" && probeEntry.result?.node?.capabilities?.length && (
            <div className="mesh-detail-section">
              <div className="mesh-detail-label">capabilities</div>
              <div className="mesh-detail-caps">
                {probeEntry.result.node.capabilities.map((cap) => (
                  <span key={cap} className="mesh-detail-cap">{cap}</span>
                ))}
              </div>
            </div>
          )}

          {probeEntry?.status === "done" && probeEntry.result?.home && (
            <div className="mesh-detail-section">
              <div className="mesh-detail-empty" style={{ fontStyle: "normal", opacity: 0.5 }}>
                {probeEntry.result.home.agents.length} agent{probeEntry.result.home.agents.length !== 1 ? "s" : ""} ↗
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function MeshCanvas({ mesh, agents = [] }: { mesh: MeshStatus; agents?: Agent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [canvas, dispatch] = useReducer(canvasReducer, { pan: { x: 0, y: 0 }, scale: 1 });
  const { selectedId, probeCache } = useMeshViewStore();

  const probeCacheRef = useRef<Record<string, ProbeEntry>>({});
  useEffect(() => { probeCacheRef.current = probeCache; }, [probeCache]);

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

  // Auto-probe tailnet nodes on selection
  useEffect(() => {
    if (!selectedId?.startsWith("tailnet:")) return;
    const cached = probeCacheRef.current[selectedId];
    if (cached && cached.status !== "loading" && Date.now() - cached.fetchedAt < 30_000) return;

    const peerId = selectedId.slice("tailnet:".length);
    const peer = mesh.tailscale.peers.find((p) => p.id === peerId);
    const ip = peer?.addresses?.[0] ? cleanIp(peer.addresses[0]) : null;
    if (!ip) return;

    setProbeEntry(selectedId, { status: "loading", result: null, fetchedAt: Date.now() });

    void (async () => {
      try {
        const result = await api<ProbeResult>("/api/mesh/tailnet-probe", {
          method: "POST",
          body: JSON.stringify({ ip }),
        });
        setProbeEntry(selectedId, {
          status: result.reachable ? "done" : "error",
          result,
          fetchedAt: Date.now(),
        });
      } catch (e) {
        setProbeEntry(selectedId, {
          status: "error",
          result: { reachable: false, home: null, node: null, error: e instanceof Error ? e.message : String(e) },
          fetchedAt: Date.now(),
        });
      }
    })();
  }, [selectedId, mesh]);

  const { nodes, edges } = buildGraph(mesh);
  const positions = layoutNodes(nodes);
  const hasPeers = nodes.some((n) => n.kind !== "local");
  const { pan, scale } = canvas;
  const cx = size.w / 2;
  const cy = size.h / 2;

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (nodeId === "__placeholder") return;
      setMeshSelection(selectedId === nodeId ? null : nodeId, selectedId === nodeId ? null : "node");
    },
    [selectedId],
  );

  // Compute fan positions for probed tailnet agents
  const probeEntry = selectedId ? probeCache[selectedId] ?? null : null;
  const fanAgents: Array<{ agent: ProbeAgent; pos: Pos }> = [];
  if (
    selectedId?.startsWith("tailnet:") &&
    probeEntry?.status === "done" &&
    probeEntry.result?.home?.agents?.length
  ) {
    const nodePos = positions.get(selectedId) ?? { x: 0, y: 0 };
    const agentList = probeEntry.result.home.agents;
    const fanPos = fanPositions(nodePos, agentList.length, 135, 90);
    agentList.forEach((agent, i) => {
      fanAgents.push({ agent, pos: fanPos[i] });
    });
  }

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

      {/* World-space transform — all content lives here */}
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
        {/* Edges */}
        <svg style={{ position: "absolute", overflow: "visible", left: 0, top: 0, width: 0, height: 0 }} fill="none">
          {edges.map((edge) => {
            const from = positions.get(edge.fromId);
            const to = positions.get(edge.toId);
            if (!from || !to) return null;
            const color =
              edge.transport === "mesh"
                ? edge.online ? "#4ade80" : "#3f3f46"
                : edge.online ? "#38bdf8" : "#27272a";
            return (
              <line
                key={`${edge.fromId}-${edge.toId}`}
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={color}
                strokeWidth={edge.transport === "mesh" ? 1.5 : 1}
                strokeDasharray={edge.transport === "tailnet" ? "6 4" : undefined}
                opacity={edge.online ? 0.45 : 0.15}
              />
            );
          })}

          {!hasPeers &&
            (() => {
              const localNode = nodes.find((n) => n.kind === "local");
              const from = localNode ? positions.get(localNode.id) : undefined;
              const to = positions.get("__placeholder");
              if (!from || !to) return null;
              return (
                <line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke="#3f3f46"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  opacity={0.2}
                />
              );
            })()}

          {/* Detail panel connector */}
          {selectedId && (() => {
            const pos = positions.get(selectedId);
            if (!pos) return null;
            return (
              <line
                x1={pos.x + 10} y1={pos.y}
                x2={pos.x + 74} y2={pos.y}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={1}
              />
            );
          })()}

          {/* Agent fan connector lines */}
          {fanAgents.map(({ agent, pos: aPos }) => {
            const nodePos = selectedId ? positions.get(selectedId) : null;
            if (!nodePos) return null;
            return (
              <line
                key={`fan-line-${agent.id}`}
                x1={nodePos.x} y1={nodePos.y}
                x2={aPos.x} y2={aPos.y}
                stroke="rgba(56, 189, 248, 0.18)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
            );
          })}
        </svg>

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          return (
            <div
              key={node.id}
              style={{ position: "absolute", left: pos.x, top: pos.y, transform: "translate(-50%, -50%)", pointerEvents: "all" }}
              onClick={() => handleNodeClick(node.id)}
            >
              <NodeCard node={node} isSelected={selectedId === node.id} />
            </div>
          );
        })}

        {/* Agent fan sub-nodes */}
        {fanAgents.map(({ agent, pos }, i) => (
          <AgentSubNode key={agent.id} agent={agent} pos={pos} index={i} />
        ))}

        {/* Node detail panel */}
        {selectedId && (
          <NodeDetailPanel
            selectedId={selectedId}
            mesh={mesh}
            agents={agents}
            positions={positions}
            probeEntry={probeEntry}
          />
        )}

        {/* No-peers placeholder */}
        {!hasPeers &&
          (() => {
            const pos = positions.get("__placeholder");
            if (!pos) return null;
            return (
              <div
                style={{ position: "absolute", left: pos.x, top: pos.y, transform: "translate(-50%, -50%)", pointerEvents: "none" }}
              >
                <div className="mesh-card mesh-card--placeholder">
                  <span className="mesh-card-name" style={{ opacity: 0.35 }}>no peers</span>
                </div>
              </div>
            );
          })()}
      </div>

      {/* Zoom hint */}
      <div className="mesh-canvas-hint">scroll to zoom · drag to pan</div>
    </div>
  );
}
