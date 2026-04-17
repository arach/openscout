import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { timeAgo } from "../lib/time.ts";
import type { MeshIssue, MeshStatus, Route } from "../lib/types.ts";
import { MeshTopologyView } from "./MeshTopologyView.tsx";
import "./system-surfaces-redesign.css";

function issueTone(issue: MeshIssue): "notice" | "warning" | "error" {
  if (issue.code === "local_only") {
    return "notice";
  }
  return issue.severity === "error" ? "error" : "warning";
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

function shortHost(input?: string | null): string {
  if (!input) return "Unavailable";
  return input.replace(/^https?:\/\//, "").split("/")[0] ?? input;
}

function advertiseScopeLabel(scope?: string): string {
  if (scope === "mesh") return "Mesh visible";
  if (scope === "local") return "Local only";
  if (scope) return scope;
  return "Not advertised";
}

function overallMeshTone(mesh: MeshStatus): "success" | "warning" | "danger" {
  if (!mesh.health.reachable) return "danger";
  if (mesh.issues.some((issue) => issue.severity === "error")) return "danger";
  if (mesh.issues.length > 0) return "warning";
  return "success";
}

function overallMeshLabel(mesh: MeshStatus): string {
  if (!mesh.health.reachable) return "Broker unreachable";
  if (mesh.issues.some((issue) => issue.severity === "error")) return "Degraded";
  if (mesh.issues.length > 0) return "Needs attention";
  return "Healthy";
}

function MeshIssueCard({ issue }: { issue: MeshIssue }) {
  const tone = issueTone(issue);
  return (
    <article className={`sys-issue-card sys-issue-card-${tone}`}>
      <div className="sys-issue-head">
        <h3 className="sys-issue-title">{issue.title}</h3>
        <span className={`sys-chip sys-chip-${tone === "error" ? "failed" : tone}`}>
          {issueBadge(issue)}
        </span>
      </div>
      <p className="sys-issue-body">{issue.summary}</p>
      {(issue.action || issue.actionCommand) && (
        <div className="sys-issue-action">
          {issue.actionCommand && <code className="sys-code-inline">{issue.actionCommand}</code>}
          {issue.action && <span>{issue.action}</span>}
        </div>
      )}
    </article>
  );
}

export function MeshScreen({ navigate: _navigate }: { navigate: (r: Route) => void }) {
  const [mesh, setMesh] = useState<MeshStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const meshRef = useRef<MeshStatus | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    meshRef.current = mesh;
  }, [mesh]);

  const load = useCallback(async (mode: "initial" | "background" | "manual" = "initial") => {
    const requestId = ++requestIdRef.current;
    const hasSnapshot = meshRef.current !== null;

    if (!hasSnapshot && mode !== "background") {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
    }

    try {
      const data = await api<MeshStatus>("/api/mesh");
      if (requestId !== requestIdRef.current) return;
      setMesh(data);
      setError(null);
      setLastLoadedAt(Date.now());
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load("background");
    }, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const tone = mesh ? overallMeshTone(mesh) : "warning";
  const statusLabel = mesh ? overallMeshLabel(mesh) : "Loading";
  const nodes = mesh ? Object.values(mesh.nodes) : [];
  const localId = mesh?.localNode?.id;
  const localHostName = mesh?.localNode?.hostName?.toLowerCase();
  const remoteNodes = nodes.filter((node) => node.id !== localId);
  const externalTailscalePeers = (mesh?.tailscale.peers ?? []).filter((peer) => {
    const host = peer.hostName?.toLowerCase();
    if (!host) return true;
    if (host === "localhost") return false;
    if (localHostName && (host === localHostName || host.startsWith(`${localHostName.split(".")[0]}.`))) return false;
    return true;
  });
  const issues = mesh
    ? (mesh.issues.length > 0
      ? mesh.issues
      : mesh.warnings.map((warning, index) => ({
        code: `fallback-${index}` as MeshIssue["code"],
        severity: "warning" as const,
        title: "Mesh notice",
        summary: warning,
        action: null,
        actionCommand: null,
      })))
    : [];

  const healthCards = useMemo(() => {
    if (!mesh) return [];
    return [
      {
        label: "Broker",
        value: mesh.health.reachable ? "Reachable" : "Unavailable",
        detail: mesh.health.error ?? shortHost(mesh.brokerUrl),
      },
      {
        label: "Visibility",
        value: advertiseScopeLabel(mesh.localNode?.advertiseScope),
        detail: mesh.localNode?.hostName ?? "Local registration unavailable",
      },
      {
        label: "Mesh peers",
        value: `${remoteNodes.length}`,
        detail: remoteNodes.length > 0 ? "Remote brokers in this mesh" : "No remote brokers discovered",
      },
      {
        label: "Tailnet",
        value: mesh.tailscale.available
          ? `${externalTailscalePeers.filter((peer) => peer.online).length}/${externalTailscalePeers.length}`
          : "Unavailable",
        detail: mesh.tailscale.available ? "Online peers / visible peers" : "Tailscale peers not detected",
      },
    ];
  }, [externalTailscalePeers, mesh, remoteNodes.length]);

  return (
    <div className="sys-surface-page">
      <div className="sys-page-head">
        <div className="sys-page-title-group">
          <h2 className="sys-page-title">Mesh</h2>
          <p className="sys-page-subtitle">
            Broker reachability, discovery posture, and peer visibility.
          </p>
        </div>
        <div className="sys-page-actions">
          <span className={`sys-chip sys-chip-${tone}`}>{statusLabel}</span>
          <div className="sys-sync-note">
            {loading
              ? "Loading system snapshot..."
              : error && mesh
                ? `Showing last confirmed snapshot from ${lastLoadedAt ? timeAgo(lastLoadedAt) : "earlier"}`
                : lastLoadedAt
                  ? `Confirmed ${timeAgo(lastLoadedAt)}`
                  : "Waiting for first snapshot"}
          </div>
          <button
            type="button"
            className="s-btn"
            disabled={loading || refreshing}
            onClick={() => void load("manual")}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && mesh && (
        <div className="sys-banner sys-banner-warning">
          <strong>Mesh refresh failed.</strong>
          <span>{error}</span>
        </div>
      )}

      {loading && !mesh && (
        <div className="sys-panel sys-state-card">
          <h3 className="sys-state-title">Loading mesh status</h3>
          <p className="sys-state-body">
            Inspecting broker reachability and peer discovery inputs.
          </p>
        </div>
      )}

      {!loading && !mesh && error && (
        <div className="sys-panel sys-state-card sys-state-card-error">
          <h3 className="sys-state-title">Mesh status is unavailable</h3>
          <p className="sys-state-body">{error}</p>
          <div className="sys-inline-actions">
            <button type="button" className="s-btn" onClick={() => void load("manual")}>
              Try again
            </button>
          </div>
        </div>
      )}

      {mesh && (
        <>
          <div className="sys-stat-grid">
            {healthCards.map((card) => (
              <div key={card.label} className="sys-stat-card">
                <span className="sys-stat-label">{card.label}</span>
                <strong className="sys-stat-value">{card.value}</strong>
                <span className="sys-stat-detail">{card.detail}</span>
              </div>
            ))}
          </div>

          <section className="sys-panel sys-mesh-identity">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Local node</h3>
                <p className="sys-section-subtitle">
                  The broker identity other peers can discover and dial.
                </p>
              </div>
            </div>

            {mesh.localNode ? (
              <div className="sys-detail-grid">
                <div className="sys-detail-card">
                  <span className="sys-detail-label">Node</span>
                  <span className="sys-detail-value">{mesh.localNode.name}</span>
                </div>
                <div className="sys-detail-card">
                  <span className="sys-detail-label">Node id</span>
                  <code className="sys-detail-value">{mesh.localNode.id}</code>
                </div>
                <div className="sys-detail-card">
                  <span className="sys-detail-label">Mesh</span>
                  <code className="sys-detail-value">{mesh.meshId ?? "Unassigned"}</code>
                </div>
                <div className="sys-detail-card">
                  <span className="sys-detail-label">Advertise scope</span>
                  <span className="sys-detail-value">{advertiseScopeLabel(mesh.localNode.advertiseScope)}</span>
                </div>
                <div className="sys-detail-card">
                  <span className="sys-detail-label">Broker URL</span>
                  <code className="sys-detail-value">{mesh.localNode.brokerUrl ?? mesh.brokerUrl}</code>
                </div>
                <div className="sys-detail-card">
                  <span className="sys-detail-label">Host</span>
                  <span className="sys-detail-value">{mesh.localNode.hostName ?? "Unavailable"}</span>
                </div>
              </div>
            ) : (
              <div className="sys-list-empty">
                <h3>No local node registration</h3>
                <p>
                  The broker answered health checks, but it has not published a local node record yet.
                </p>
              </div>
            )}
          </section>

          <section className="sys-panel">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Health notices</h3>
                <p className="sys-section-subtitle">
                  Warnings and errors from the current broker and discovery snapshot.
                </p>
              </div>
            </div>

            {issues.length > 0 ? (
              <div className="sys-issue-grid">
                {issues.map((issue, index) => (
                  <MeshIssueCard key={`${issue.code}-${index}`} issue={issue} />
                ))}
              </div>
            ) : (
              <div className="sys-list-empty">
                <h3>No active mesh warnings</h3>
                <p>The broker is reachable and discovery inputs look healthy from this page.</p>
              </div>
            )}
          </section>

          <section className="sys-panel">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Topology</h3>
                <p className="sys-section-subtitle">
                  Current broker relationships inside the visible mesh.
                </p>
              </div>
            </div>
            {mesh.localNode ? (
              <MeshTopologyView mesh={mesh} />
            ) : (
              <div className="sys-list-empty">
                <h3>Topology unavailable</h3>
                <p>A local node record is required before the topology view can render.</p>
              </div>
            )}
          </section>

          <section className="sys-panel">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Discovered peers</h3>
                <p className="sys-section-subtitle">
                  Remote brokers registered in {mesh.meshId ?? "this mesh"}.
                </p>
              </div>
            </div>

            {remoteNodes.length === 0 ? (
              <div className="sys-list-empty">
                <h3>No remote brokers discovered</h3>
                <p>
                  This can be normal on a single-node setup. If you expect peers, check the health notices above.
                </p>
              </div>
            ) : (
              <div className="sys-list-grid">
                {remoteNodes.map((node) => (
                  <article key={node.id} className="sys-list-card">
                    <div className="sys-list-card-head">
                      <h3 className="sys-list-card-title">{node.name}</h3>
                      <span className={`sys-chip sys-chip-${node.advertiseScope === "mesh" ? "success" : "neutral"}`}>
                        {advertiseScopeLabel(node.advertiseScope)}
                      </span>
                    </div>
                    <div className="sys-list-card-detail">
                      <span className="sys-detail-label">Node id</span>
                      <code className="sys-detail-value">{node.id}</code>
                    </div>
                    {node.brokerUrl && (
                      <div className="sys-list-card-detail">
                        <span className="sys-detail-label">Broker</span>
                        <code className="sys-detail-value">{node.brokerUrl}</code>
                      </div>
                    )}
                    <div className="sys-list-card-detail">
                      <span className="sys-detail-label">Last seen</span>
                      <span className="sys-detail-value">
                        {node.lastSeenAt ? timeAgo(node.lastSeenAt) : "Recently registered"}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="sys-panel">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Tailnet</h3>
                <p className="sys-section-subtitle">
                  External Tailscale peers visible from this machine.
                </p>
              </div>
            </div>

            {externalTailscalePeers.length === 0 ? (
              <div className="sys-list-empty">
                <h3>No external tailnet peers</h3>
                <p>
                  {mesh.tailscale.available
                    ? "Only this host is visible in the current tailnet snapshot."
                    : "Tailscale peers were not detected on this machine."}
                </p>
              </div>
            ) : (
              <div className="sys-list-grid">
                {externalTailscalePeers.map((peer) => (
                  <article key={peer.id} className="sys-list-card">
                    <div className="sys-list-card-head">
                      <h3 className="sys-list-card-title">{peer.hostName || peer.name}</h3>
                      <span className={`sys-chip sys-chip-${peer.online ? "success" : "failed"}`}>
                        {peer.online ? "Online" : "Offline"}
                      </span>
                    </div>
                    <div className="sys-list-card-detail">
                      <span className="sys-detail-label">Address</span>
                      <code className="sys-detail-value">{peer.addresses?.[0] ?? "Unavailable"}</code>
                    </div>
                    <div className="sys-list-card-detail">
                      <span className="sys-detail-label">Platform</span>
                      <span className="sys-detail-value">{peer.os ?? "Unknown"}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
