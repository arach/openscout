import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { timeAgo } from "../lib/time.ts";
import type { MeshIssue, MeshStatus, Route } from "../lib/types.ts";
import { MeshTopologyView } from "./MeshTopologyView.tsx";

function issueTone(issue: MeshIssue): "notice" | "warning" | "error" {
  if (issue.code === "local_only") {
    return "notice";
  }
  return issue.severity === "error" ? "error" : "warning";
}

function issueLabel(issue: MeshIssue): string {
  switch (issue.code) {
    case "local_only":
      return "Visibility";
    case "mesh_loopback":
      return "Reachability";
    case "discovery_unconfigured":
      return "Discovery";
    default:
      return "Broker";
  }
}

function issueBadge(issue: MeshIssue): string {
  switch (issue.code) {
    case "local_only":
      return "Local only";
    case "mesh_loopback":
      return "Unreachable";
    case "discovery_unconfigured":
      return "Needs setup";
    default:
      return "Offline";
  }
}

function MeshIssueCard({ issue }: { issue: MeshIssue }) {
  const tone = issueTone(issue);
  return (
    <div className={`s-mesh-issue s-mesh-issue-${tone}`}>
      <div className={`s-mesh-issue-rail s-mesh-issue-rail-${tone}`} />
      <div className="s-mesh-issue-body">
        <div className="s-mesh-issue-header">
          <span className="s-mesh-issue-kicker">{issueLabel(issue)}</span>
          <span className={`s-mesh-issue-badge s-mesh-issue-badge-${tone}`}>{issueBadge(issue)}</span>
        </div>
        <h3 className="s-mesh-issue-title">{issue.title}</h3>
        <p className="s-mesh-issue-summary">{issue.summary}</p>
        {(issue.action || issue.actionCommand) && (
          <div className="s-mesh-issue-action">
            {issue.actionCommand && (
              <code className="s-mesh-issue-command">{issue.actionCommand}</code>
            )}
            {issue.action && (
              <span className="s-mesh-issue-action-text">{issue.action}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const localHostName = mesh.localNode?.hostName?.toLowerCase();
  const remoteNodes = nodes.filter((n) => n.id !== localId);
  const externalTailscalePeers = mesh.tailscale.peers.filter((p) => {
    const host = p.hostName?.toLowerCase();
    if (!host) return true;
    if (host === "localhost") return false;
    if (localHostName && (host === localHostName || host.startsWith(`${localHostName.split(".")[0]}.`))) return false;
    return true;
  });
  const issues = mesh.issues?.length > 0
    ? mesh.issues
    : mesh.warnings.map((warning, index) => ({
      code: `fallback-${index}` as MeshIssue["code"],
      severity: "warning" as const,
      title: "Mesh notice",
      summary: warning,
      action: null,
      actionCommand: null,
    }));
  const advertiseScopeLabel = mesh.localNode?.advertiseScope === "mesh" ? "mesh visible" : "local only";

  return (
    <div className="s-mesh-screen">
      <div className="s-sessions-header">
        <h2 className="s-page-title">Mesh</h2>
        <span className="s-meta">
          {remoteNodes.length} peer{remoteNodes.length !== 1 ? "s" : ""}
          {externalTailscalePeers.length > 0 ? ` · ${externalTailscalePeers.filter((p) => p.online).length}/${externalTailscalePeers.length} tailnet` : ""}
        </span>
      </div>

      {/* Hero: this broker's identity */}
      {mesh.localNode && (
        <div className="s-mesh-hero">
          <div className="s-mesh-hero-head">
            <span className="s-dot" style={{ background: mesh.health.reachable ? "var(--green)" : "var(--red)" }} />
            <span className="s-mesh-hero-title">{mesh.localNode.name}</span>
            <span className={`s-badge s-badge-${mesh.localNode.advertiseScope === "mesh" ? "ok" : "warn"}`}>
              {advertiseScopeLabel}
            </span>
          </div>
          <div className="s-mesh-hero-grid">
            <div className="s-mesh-hero-field">
              <span className="s-mesh-hero-label">node id</span>
              <code className="s-mesh-hero-value">{mesh.localNode.id}</code>
            </div>
            <div className="s-mesh-hero-field">
              <span className="s-mesh-hero-label">mesh</span>
              <code className="s-mesh-hero-value">{mesh.meshId ?? "—"}</code>
            </div>
            <div className="s-mesh-hero-field">
              <span className="s-mesh-hero-label">broker url</span>
              <code className="s-mesh-hero-value">{mesh.localNode.brokerUrl ?? mesh.brokerUrl}</code>
            </div>
            {mesh.localNode.hostName && (
              <div className="s-mesh-hero-field">
                <span className="s-mesh-hero-label">host</span>
                <code className="s-mesh-hero-value">{mesh.localNode.hostName}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status issues */}
      {issues.length > 0 && (
        <div className="s-mesh-issues">
          {issues.map((issue, index) => (
            <MeshIssueCard key={`${issue.code}-${index}`} issue={issue} />
          ))}
        </div>
      )}

      {/* Topology */}
      <MeshTopologyView mesh={mesh} />

      {/* Remote peers in this mesh */}
      <div className="s-mesh-section">
        <h3 className="s-mesh-section-title">
          Peers in {mesh.meshId ?? "mesh"}
          <span className="s-meta" style={{ marginLeft: 8 }}>{remoteNodes.length}</span>
        </h3>

        {remoteNodes.length === 0 ? (
          <div className="s-empty" style={{ textAlign: "center" }}>
            <p>No peers discovered yet.</p>
          </div>
        ) : (
          <div className="s-mesh-nodes">
            {remoteNodes.map((node) => (
              <div key={node.id} className="s-mesh-node">
                <div className="s-mesh-node-header">
                  <span className="s-dot" style={{ background: "var(--muted)" }} />
                  <span className="s-mesh-node-name">{node.name}</span>
                  <span className="s-badge">{node.advertiseScope ?? "remote"}</span>
                </div>
                <div className="s-mesh-node-detail s-meta"><code>{node.id}</code></div>
                {node.brokerUrl && (
                  <div className="s-mesh-node-detail s-meta"><code>{node.brokerUrl}</code></div>
                )}
                {node.lastSeenAt && (
                  <div className="s-mesh-node-detail s-meta">
                    Seen {timeAgo(node.lastSeenAt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* External Tailscale peers (excluding self) */}
      {externalTailscalePeers.length > 0 && (
        <div className="s-mesh-section">
          <h3 className="s-mesh-section-title">
            Tailnet
            <span className="s-meta" style={{ marginLeft: 8 }}>
              {externalTailscalePeers.filter((p) => p.online).length}/{externalTailscalePeers.length} online
            </span>
          </h3>

          <div className="s-mesh-nodes">
            {externalTailscalePeers.map((peer) => (
              <div key={peer.id} className="s-mesh-node">
                <div className="s-mesh-node-header">
                  <span className="s-dot" style={{ background: peer.online ? "var(--green)" : "var(--dim)" }} />
                  <span className="s-mesh-node-name">{peer.hostName || peer.name}</span>
                  {peer.os && <span className="s-badge">{peer.os}</span>}
                </div>
                {peer.addresses?.[0] && (
                  <div className="s-mesh-node-detail s-meta"><code>{peer.addresses[0]}</code></div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
