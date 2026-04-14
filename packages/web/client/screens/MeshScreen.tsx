import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { timeAgo } from "../lib/time.ts";
import type { MeshStatus, Route } from "../lib/types.ts";

export function MeshScreen({ navigate: _navigate }: { navigate: (r: Route) => void }) {
  const [mesh, setMesh] = useState<MeshStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<MeshStatus>("/api/mesh");
      setMesh(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Poll every 10s — mesh state changes slowly
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <div className="s-mesh-screen">
        <div className="s-sessions-header">
          <h2 className="s-page-title">Mesh</h2>
        </div>
        <p className="s-error">{error}</p>
      </div>
    );
  }

  if (!mesh) {
    return (
      <div className="s-mesh-screen">
        <div className="s-sessions-header">
          <h2 className="s-page-title">Mesh</h2>
        </div>
        <div className="s-empty" style={{ textAlign: "center" }}>
          <p>Loading mesh status...</p>
        </div>
      </div>
    );
  }

  const nodes = Object.values(mesh.nodes);
  const localId = mesh.localNode?.id;
  const remoteNodes = nodes.filter((n) => n.id !== localId);

  return (
    <div className="s-mesh-screen">
      <div className="s-sessions-header">
        <h2 className="s-page-title">Mesh</h2>
        <span className="s-meta">
          {nodes.length} node{nodes.length !== 1 ? "s" : ""}
          {mesh.tailscale.available ? ` · ${mesh.tailscale.onlineCount} Tailscale peers` : ""}
        </span>
      </div>

      {/* Status card */}
      <div className="s-mesh-status-card">
        <div className="s-home-card-row">
          <span className="s-home-card-row-label">Broker</span>
          <span className="s-home-card-row-value">
            <span className="s-dot" style={{ background: mesh.health.reachable ? "var(--green)" : "var(--red)" }} />
            {mesh.health.reachable ? "Online" : "Unreachable"}
          </span>
        </div>
        {mesh.localNode && (
          <div className="s-home-card-row">
            <span className="s-home-card-row-label">Local Node</span>
            <span className="s-home-card-row-value">{mesh.localNode.name}</span>
          </div>
        )}
        {mesh.meshId && (
          <div className="s-home-card-row">
            <span className="s-home-card-row-label">Mesh ID</span>
            <span className="s-home-card-row-value s-meta">{mesh.meshId}</span>
          </div>
        )}
        <div className="s-home-card-row">
          <span className="s-home-card-row-label">Broker URL</span>
          <span className="s-home-card-row-value s-meta">{mesh.brokerUrl}</span>
        </div>
      </div>

      {/* Warnings */}
      {mesh.warnings.length > 0 && (
        <div className="s-mesh-warnings">
          {mesh.warnings.map((w, i) => (
            <div key={i} className="s-mesh-warning">{w}</div>
          ))}
        </div>
      )}

      {/* Nodes */}
      <div className="s-mesh-section">
        <h3 className="s-mesh-section-title">
          Nodes
          <span className="s-meta" style={{ marginLeft: 8 }}>{nodes.length}</span>
        </h3>

        {nodes.length === 0 ? (
          <div className="s-empty" style={{ textAlign: "center" }}>
            <p>No nodes registered</p>
          </div>
        ) : (
          <div className="s-mesh-nodes">
            {/* Local node first */}
            {mesh.localNode && (
              <div className="s-mesh-node s-mesh-node-local">
                <div className="s-mesh-node-header">
                  <span className="s-dot" style={{ background: "var(--green)" }} />
                  <span className="s-mesh-node-name">{mesh.localNode.name}</span>
                  <span className="s-badge">local</span>
                </div>
                {mesh.localNode.hostName && (
                  <div className="s-mesh-node-detail">{mesh.localNode.hostName}</div>
                )}
                {mesh.localNode.brokerUrl && (
                  <div className="s-mesh-node-detail s-meta">{mesh.localNode.brokerUrl}</div>
                )}
              </div>
            )}

            {/* Remote nodes */}
            {remoteNodes.map((node) => (
              <div key={node.id} className="s-mesh-node">
                <div className="s-mesh-node-header">
                  <span className="s-dot" style={{ background: "var(--muted)" }} />
                  <span className="s-mesh-node-name">{node.name}</span>
                  <span className="s-badge">remote</span>
                </div>
                {node.hostName && (
                  <div className="s-mesh-node-detail">{node.hostName}</div>
                )}
                {node.brokerUrl && (
                  <div className="s-mesh-node-detail s-meta">{node.brokerUrl}</div>
                )}
                {node.registeredAt && (
                  <div className="s-mesh-node-detail s-meta">
                    Registered {timeAgo(node.registeredAt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tailscale peers */}
      {mesh.tailscale.available && (
        <div className="s-mesh-section">
          <h3 className="s-mesh-section-title">
            Tailscale Peers
            <span className="s-meta" style={{ marginLeft: 8 }}>
              {mesh.tailscale.onlineCount} online
            </span>
          </h3>

          <div className="s-mesh-nodes">
            {mesh.tailscale.peers.map((peer) => (
              <div key={peer.id} className="s-mesh-node">
                <div className="s-mesh-node-header">
                  <span className="s-dot" style={{ background: peer.online ? "var(--green)" : "var(--dim)" }} />
                  <span className="s-mesh-node-name">{peer.hostName || peer.name}</span>
                  {peer.os && <span className="s-badge">{peer.os}</span>}
                  {peer.online && <span className="s-badge">online</span>}
                </div>
                {peer.addresses?.[0] && (
                  <div className="s-mesh-node-detail s-meta">{peer.addresses[0]}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
