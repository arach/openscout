import { useState, useCallback } from "react";
import { useMeshViewStore, setMeshSelection, setMeshSnapshot } from "../../lib/mesh-view-store.ts";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import type { MeshStatus } from "../../lib/types.ts";
import "../../screens/system-surfaces-redesign.css";
import "../../screens/mesh-screen.css";

function shortHost(input?: string | null): string {
  if (!input) return "Unavailable";
  return input.replace(/^https?:\/\//, "").split("/")[0] ?? input;
}

function cleanIp(addr: string): string {
  return addr.split("/")[0];
}

export function MeshInspectorPanel() {
  const { meshSnapshot, selectedId, selectedType, probeCache } = useMeshViewStore();
  const [announcing, setAnnouncing] = useState(false);

  const handleAnnounce = useCallback(async () => {
    setAnnouncing(true);
    try {
      const data = await api<MeshStatus>("/api/mesh/announce", { method: "POST", body: "{}" });
      setMeshSnapshot(data);
    } finally {
      setAnnouncing(false);
    }
  }, []);

  if (!meshSnapshot) {
    return (
      <div className="sys-inspector-empty">
        <p>Loading mesh…</p>
      </div>
    );
  }

  // ── Tailnet peer selected ──
  if (selectedId?.startsWith("tailnet:") && selectedType === "node") {
    const peerId = selectedId.slice("tailnet:".length);
    const peer = meshSnapshot.tailscale.peers.find((p) => p.id === peerId);
    const entry = probeCache[selectedId] ?? null;
    const tailnetIp = peer?.addresses?.[0] ? cleanIp(peer.addresses[0]) : null;
    const label = peer?.hostName?.split(".")[0] ?? peer?.hostName ?? "Tailnet peer";

    return (
      <div className="sys-inspector-content">
        <div className="sys-inspector-head">
          <h3 className="sys-inspector-title">{label}</h3>
          <span className={`sys-chip sys-chip-${peer?.online ? "success" : "failed"}`}>
            {peer?.online ? "Online" : "Offline"}
          </span>
        </div>

        <div className="sys-detail-grid">
          {tailnetIp && (
            <div className="sys-detail-card">
              <span className="sys-detail-label">Address</span>
              <code className="sys-detail-value">{tailnetIp}</code>
            </div>
          )}
          {peer?.os && (
            <div className="sys-detail-card">
              <span className="sys-detail-label">Platform</span>
              <span className="sys-detail-value">{peer.os}</span>
            </div>
          )}
          {entry?.result?.node?.meshId && (
            <div className="sys-detail-card">
              <span className="sys-detail-label">Mesh ID</span>
              <code className="sys-detail-value">{entry.result.node.meshId.slice(0, 14)}…</code>
            </div>
          )}
          {entry?.result?.node?.name && (
            <div className="sys-detail-card">
              <span className="sys-detail-label">Node name</span>
              <span className="sys-detail-value">{entry.result.node.name}</span>
            </div>
          )}
        </div>

        {/* Broker probe state */}
        {(!entry || entry.status === "loading") && (
          <div className="sys-banner sys-banner-muted" style={{ marginTop: 8 }}>
            <span>Connecting to Scout broker…</span>
          </div>
        )}

        {entry?.status === "error" && (
          <div className="sys-banner sys-banner-warning" style={{ marginTop: 8 }}>
            <strong>Broker unreachable.</strong>
            <span>{entry.result?.error ?? "Could not reach the remote broker."}</span>
          </div>
        )}

        {entry?.status === "done" && entry.result?.node?.capabilities?.length && (
          <div style={{ marginTop: 10 }}>
            <div className="sys-inspector-section-label">Capabilities</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {entry.result.node.capabilities.map((cap) => (
                <span key={cap} className="sys-chip sys-chip-neutral">{cap}</span>
              ))}
            </div>
          </div>
        )}

        {entry?.status === "done" && entry.result?.home && (
          <div style={{ marginTop: 14 }}>
            <div className="sys-inspector-section-label">
              Agents — {entry.result.home.agents.length} registered
            </div>
            {entry.result.home.agents.length === 0 ? (
              <div className="sys-list-empty" style={{ marginTop: 4 }}>
                <p>No agents registered on this broker.</p>
              </div>
            ) : (
              <div className="mesh-agent-table" style={{ marginTop: 4 }}>
                {entry.result.home.agents.map((agent) => {
                  const state = agent.state === "working" ? "working"
                    : agent.state === "available" ? "available"
                    : "offline";
                  return (
                    <div key={agent.id} className="mesh-detail-agent" style={{ padding: "4px 0" }}>
                      <span className={`mesh-detail-dot mesh-detail-dot--${state}`} />
                      <div className="mesh-detail-agent-body">
                        <span className="mesh-detail-agent-name" style={{ fontSize: 12 }}>{agent.title}</span>
                        {agent.activeTask && (
                          <span className="mesh-detail-agent-task">{agent.activeTask}</span>
                        )}
                      </div>
                      <span className={`mesh-detail-agent-state mesh-detail-agent-state--${state}`}>{agent.statusLabel || state}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="s-btn"
          style={{ marginTop: 14 }}
          onClick={() => setMeshSelection(null, null)}
        >
          Clear selection
        </button>
      </div>
    );
  }

  // ── Mesh / local node selected ──
  if (selectedId && selectedType === "node") {
    const allNodes = Object.values(meshSnapshot.nodes);
    const node =
      allNodes.find((n) => n.id === selectedId) ??
      (meshSnapshot.localNode?.id === selectedId ? meshSnapshot.localNode : null);
    const isLocal = meshSnapshot.localNode?.id === selectedId;

    if (!node) {
      return (
        <div className="sys-inspector-empty">
          <p>Node not found.</p>
          <button type="button" className="s-btn" onClick={() => setMeshSelection(null, null)}>
            Clear
          </button>
        </div>
      );
    }

    return (
      <div className="sys-inspector-content">
        <div className="sys-inspector-head">
          <h3 className="sys-inspector-title">
            {node.hostName?.split(".")[0] ?? node.name ?? "Node"}
          </h3>
          {isLocal && <span className="sys-chip sys-chip-neutral">this broker</span>}
        </div>

        <div className="sys-detail-grid">
          <div className="sys-detail-card">
            <span className="sys-detail-label">Node ID</span>
            <code className="sys-detail-value">{node.id.slice(0, 16)}…</code>
          </div>
          {node.brokerUrl && (
            <div className="sys-detail-card">
              <span className="sys-detail-label">Broker URL</span>
              <code className="sys-detail-value">{shortHost(node.brokerUrl)}</code>
            </div>
          )}
          {node.hostName && (
            <div className="sys-detail-card">
              <span className="sys-detail-label">Host</span>
              <span className="sys-detail-value">{node.hostName}</span>
            </div>
          )}
          {!isLocal && "lastSeenAt" in node && typeof node.lastSeenAt === "number" && (
            <div className="sys-detail-card">
              <span className="sys-detail-label">Last seen</span>
              <span className="sys-detail-value">{timeAgo(node.lastSeenAt)}</span>
            </div>
          )}
          {!isLocal && (
            <div className="sys-detail-card">
              <span className="sys-detail-label">Scope</span>
              <span className="sys-detail-value">
                {node.advertiseScope === "mesh" ? "Announced to mesh" : "Local only"}
              </span>
            </div>
          )}
        </div>

        {isLocal && meshSnapshot.issues.length > 0 && (
          <div className="sys-issue-grid" style={{ marginTop: 12 }}>
            {meshSnapshot.issues.map((issue, i) => (
              <article
                key={i}
                className={`sys-issue-card sys-issue-card-${issue.severity === "error" ? "error" : "warning"}`}
              >
                <div className="sys-issue-head">
                  <h3 className="sys-issue-title">{issue.title}</h3>
                </div>
                <p className="sys-issue-body">{issue.summary}</p>
                {issue.actionCommand && (
                  <div className="sys-issue-action">
                    <code className="sys-code-inline">{issue.actionCommand}</code>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        <button
          type="button"
          className="s-btn"
          style={{ marginTop: 12 }}
          onClick={() => setMeshSelection(null, null)}
        >
          Clear selection
        </button>
      </div>
    );
  }

  // ── Default: this broker ──
  const mesh = meshSnapshot;
  const hasIssues = mesh.issues.length > 0 || mesh.warnings.length > 0;

  return (
    <div className="sys-inspector-content">
      <div className="sys-inspector-head">
        <h3 className="sys-inspector-title">This broker</h3>
        <span className={`sys-chip sys-chip-${mesh.identity.discoverable ? "success" : "warning"}`}>
          {mesh.identity.discoverable ? "Discoverable" : "Not discoverable"}
        </span>
      </div>

      <div className="sys-detail-grid">
        <div className="sys-detail-card">
          <span className="sys-detail-label">Name</span>
          <span className="sys-detail-value">
            {mesh.identity.name ?? mesh.localNode?.name ?? "—"}
          </span>
        </div>
        <div className="sys-detail-card">
          <span className="sys-detail-label">Mode</span>
          <span className="sys-detail-value">{mesh.identity.modeLabel}</span>
        </div>
        <div className="sys-detail-card">
          <span className="sys-detail-label">Mesh ID</span>
          <code className="sys-detail-value">{mesh.identity.meshId ?? "Unassigned"}</code>
        </div>
        <div className="sys-detail-card">
          <span className="sys-detail-label">Announced As</span>
          <code className="sys-detail-value">{mesh.identity.announceUrl ?? "Not announced"}</code>
        </div>
      </div>

      <div
        className={`sys-banner ${mesh.identity.discoverable ? "sys-banner-success" : "sys-banner-muted"}`}
        style={{ marginTop: 8 }}
      >
        <strong>How peers find you.</strong>
        <span>{mesh.identity.discoveryDetail}</span>
      </div>

      {!mesh.identity.discoverable && mesh.health.reachable && (
        <div className="sys-inline-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="s-btn"
            disabled={announcing}
            onClick={() => void handleAnnounce()}
          >
            {announcing ? "Announcing…" : "Announce on mesh"}
          </button>
        </div>
      )}

      {hasIssues && (
        <div style={{ marginTop: 12 }}>
          <div className="sys-inspector-section-label">Health notices</div>
          <div className="sys-issue-grid">
            {mesh.issues.map((issue, i) => (
              <article
                key={i}
                className={`sys-issue-card sys-issue-card-${issue.severity === "error" ? "error" : "warning"}`}
              >
                <div className="sys-issue-head">
                  <h3 className="sys-issue-title">{issue.title}</h3>
                </div>
                <p className="sys-issue-body">{issue.summary}</p>
                {issue.actionCommand && (
                  <div className="sys-issue-action">
                    <code className="sys-code-inline">{issue.actionCommand}</code>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {!hasIssues && (
        <div className="sys-list-empty" style={{ marginTop: 12 }}>
          <h3>No active mesh warnings</h3>
          <p>The broker is reachable and discovery inputs look healthy.</p>
        </div>
      )}
    </div>
  );
}
