import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { timeAgo } from "../lib/time.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import { stateColor } from "../lib/colors.ts";
import type { MeshIssue, MeshStatus, Route } from "../lib/types.ts";
import { MeshTopologyView } from "./MeshTopologyView.tsx";
import { useScout } from "../scout/Provider.tsx";
import { useMeshViewStore, setMeshViewMode, setMeshSnapshot } from "../lib/mesh-view-store.ts";
import "./system-surfaces-redesign.css";
import "./mesh-screen.css";

function issueTone(issue: MeshIssue): "notice" | "warning" | "error" {
  if (issue.code === "local_only") {
    return "notice";
  }
  return issue.severity === "error" ? "error" : "warning";
}

function issueBadge(issue: MeshIssue): string {
  switch (issue.code) {
    case "tailscale_stopped":
      return "Stopped";
    case "local_only":
      return "Not discoverable";
    case "mesh_loopback":
      return "Wrong address";
    case "discovery_unconfigured":
      return "No path";
    default:
      return "Offline";
  }
}

function shortHost(input?: string | null): string {
  if (!input) return "Unavailable";
  return input.replace(/^https?:\/\//, "").split("/")[0] ?? input;
}

function tailnetPeerLabel(peer: MeshStatus["tailscale"]["peers"][number]): string {
  const hostName = peer.hostName?.trim();
  if (hostName && hostName.toLowerCase() !== "localhost") {
    return hostName;
  }

  const dnsName = peer.dnsName?.trim().replace(/\.$/, "");
  if (dnsName) {
    return dnsName.split(".")[0] ?? dnsName;
  }

  return peer.name;
}

function advertiseScopeLabel(scope?: string): string {
  if (scope === "mesh") return "Announced to mesh";
  if (scope === "local") return "Local only";
  if (scope) return scope;
  return "Not advertised";
}

function discoverabilityTone(mesh: MeshStatus): "success" | "warning" | "danger" {
  if (mesh.identity.discoverable) return "success";
  return mesh.health.reachable ? "warning" : "danger";
}

function discoverabilityLabel(mesh: MeshStatus): string {
  if (mesh.identity.discoverable) return "Discoverable";
  return mesh.health.reachable ? "Not discoverable" : "Broker offline";
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

const STATE_RANK: Record<string, number> = { working: 0, available: 1, offline: 2 };

function MeshAgentTable() {
  const { agents, navigate } = useScout();

  if (agents.length === 0) {
    return (
      <div className="sys-list-empty">
        <h3>No agents registered</h3>
        <p>Agents connected to this broker will appear here.</p>
      </div>
    );
  }

  const sorted = [...agents].sort((a, b) => {
    const ra = STATE_RANK[normalizeAgentState(a.state)] ?? 3;
    const rb = STATE_RANK[normalizeAgentState(b.state)] ?? 3;
    if (ra !== rb) return ra - rb;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  return (
    <div className="mesh-agent-table">
      {sorted.map((agent) => {
        const state = normalizeAgentState(agent.state);
        return (
          <button
            key={agent.id}
            type="button"
            className="mesh-agent-row"
            onClick={() => navigate({ view: "agents", agentId: agent.id })}
          >
            <span
              className={`mesh-agent-dot mesh-agent-dot--${state}`}
              style={{ background: stateColor(agent.state) }}
            />
            <span className="mesh-agent-name">{agent.handle ?? agent.name}</span>
            <span className="mesh-agent-project">
              {agent.project ?? "—"}{agent.branch ? ` · ${agent.branch}` : ""}
            </span>
            <span className={`mesh-agent-state mesh-agent-state--${state}`}>{state}</span>
            <span className="mesh-agent-time">
              {agent.updatedAt ? timeAgo(agent.updatedAt) : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MeshScreen({ navigate: _navigate }: { navigate: (r: Route) => void }) {
  const [mesh, setMesh] = useState<MeshStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [tailscaleBusy, setTailscaleBusy] = useState(false);
  const [announceFeedback, setAnnounceFeedback] = useState<{
    tone: "success" | "warning";
    title: string;
    message: string;
  } | null>(null);
  const [tailscaleFeedback, setTailscaleFeedback] = useState<{
    tone: "success" | "warning";
    title: string;
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const { mode } = useMeshViewStore();

  const meshRef = useRef<MeshStatus | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    meshRef.current = mesh;
  }, [mesh]);

  const load = useCallback(async (loadMode: "initial" | "background" | "manual" = "initial") => {
    const requestId = ++requestIdRef.current;
    const hasSnapshot = meshRef.current !== null;

    if (!hasSnapshot && loadMode !== "background") {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
    }

    try {
      const data = await api<MeshStatus>("/api/mesh");
      if (requestId !== requestIdRef.current) return;
      setMesh(data);
      setMeshSnapshot(data);
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

  const announce = useCallback(async () => {
    setAnnouncing(true);
    setAnnounceFeedback(null);

    try {
      const data = await api<MeshStatus>("/api/mesh/announce", {
        method: "POST",
        body: "{}",
      });
      setMesh(data);
      setMeshSnapshot(data);
      meshRef.current = data;
      setError(null);
      setLastLoadedAt(Date.now());
      setAnnounceFeedback({
        tone: data.identity.discoverable ? "success" : "warning",
        title: data.identity.discoverable ? "Mesh updated." : "Mesh updated, but still needs attention.",
        message: data.identity.discoverable
          ? "This broker is now announced to the mesh."
          : "Mesh visibility was updated, but this broker still is not peer-reachable.",
      });
    } catch (announceError) {
      setAnnounceFeedback({
        tone: "warning",
        title: "Could not announce broker.",
        message: announceError instanceof Error ? announceError.message : String(announceError),
      });
    } finally {
      setAnnouncing(false);
    }
  }, []);

  const openTailscale = useCallback(async () => {
    setTailscaleBusy(true);
    setTailscaleFeedback(null);

    try {
      const data = await api<MeshStatus>("/api/mesh/tailscale", {
        method: "POST",
        body: JSON.stringify({ action: "open_app" }),
      });
      setMesh(data);
      setMeshSnapshot(data);
      meshRef.current = data;
      setError(null);
      setLastLoadedAt(Date.now());
      setTailscaleFeedback({
        tone: data.tailscale.running ? "success" : "warning",
        title: data.tailscale.running ? "Tailscale is running." : "Tailscale launch requested.",
        message: data.tailscale.running
          ? "Mesh discovery can resume on this machine."
          : "Scout asked macOS to open Tailscale. Approve any prompts, then refresh this page in a moment.",
      });
    } catch (tailscaleError) {
      setTailscaleFeedback({
        tone: "warning",
        title: "Could not open Tailscale.",
        message: tailscaleError instanceof Error ? tailscaleError.message : String(tailscaleError),
      });
    } finally {
      setTailscaleBusy(false);
    }
  }, []);

  const tone = mesh ? overallMeshTone(mesh) : "warning";
  const statusLabel = mesh ? overallMeshLabel(mesh) : "Loading";
  const nodes = mesh ? Object.values(mesh.nodes) : [];
  const localId = mesh?.localNode?.id;
  const localHostName = mesh?.localNode?.hostName?.toLowerCase();
  const remoteNodes = nodes.filter((node) => node.id !== localId);
  const externalTailscalePeers = (mesh?.tailscale.peers ?? []).filter((peer) => {
    const host = peer.hostName?.toLowerCase();
    if (!host || host === "localhost") return true;
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
        label: "Discoverable",
        value: mesh.identity.discoverable ? "Yes" : "No",
        detail: mesh.identity.modeLabel,
      },
      {
        label: "Mesh peers",
        value: `${remoteNodes.length}`,
        detail: remoteNodes.length > 0 ? "Remote brokers in this mesh" : "No remote brokers discovered",
      },
      {
        label: "Tailnet",
        value: !mesh.tailscale.available
          ? "Unavailable"
          : !mesh.tailscale.running
            ? "Stopped"
            : `${externalTailscalePeers.filter((peer) => peer.online).length}/${externalTailscalePeers.length}`,
        detail: !mesh.tailscale.available
          ? "Tailscale was not detected on this machine"
          : !mesh.tailscale.running
            ? `Backend state: ${mesh.tailscale.backendState ?? "unknown"}`
            : "Online peers / visible peers",
      },
    ];
  }, [externalTailscalePeers, mesh, remoteNodes.length]);

  return (
    <div className="sys-surface-page">
      <div className="sys-page-head">
        <div className="sys-page-title-group">
          <h2 className="sys-page-title">Mesh</h2>
        </div>
        <div className="sys-page-actions">
          <div className="mesh-mode-toggle">
            <button
              type="button"
              className={`mesh-mode-btn${mode === "map" ? " mesh-mode-btn--active" : ""}`}
              onClick={() => setMeshViewMode("map")}
            >
              Map
            </button>
            <button
              type="button"
              className={`mesh-mode-btn${mode === "fleet" ? " mesh-mode-btn--active" : ""}`}
              onClick={() => setMeshViewMode("fleet")}
            >
              Fleet
            </button>
          </div>
          {mesh && <span className={`sys-chip sys-chip-${tone}`}>{statusLabel}</span>}
          {mesh?.tailscale.available && !mesh.tailscale.running && (
            <span className="sys-chip sys-chip-warning">Tailnet stopped</span>
          )}
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

      {/* ── MAP MODE ── */}
      {mesh && mode === "map" && (
        <>
          {mesh.tailscale.available && !mesh.tailscale.running && (
            <div className="sys-banner sys-banner-warning">
              <strong>Tailscale is stopped.</strong>
              <span>
                {mesh.tailscale.health[0]
                  ?? "This machine is showing cached Tailnet peers, but the local Tailscale backend is not running."}
              </span>
              <div className="sys-inline-actions">
                <button
                  type="button"
                  className="s-btn s-btn-sm"
                  disabled={tailscaleBusy}
                  onClick={() => void openTailscale()}
                >
                  {tailscaleBusy ? "Opening..." : "Open Tailscale"}
                </button>
              </div>
            </div>
          )}

          <div className="mesh-stat-strip">
            {healthCards.map((card) => (
              <div key={card.label} className="mesh-stat-chip">
                <span className="mesh-stat-chip-label">{card.label}</span>
                <span className="mesh-stat-chip-value">{card.value}</span>
              </div>
            ))}
            {issues.length > 0 && (
              <span
                className={`sys-chip sys-chip-${issues.some((i) => i.severity === "error") ? "failed" : "warning"} mesh-stat-issues-badge`}
              >
                {issues.length} {issues.length === 1 ? "issue" : "issues"}
              </span>
            )}
            {!mesh.identity.discoverable && mesh.health.reachable && (
              <button
                type="button"
                className="s-btn s-btn-sm"
                disabled={announcing}
                onClick={() => void announce()}
              >
                {announcing ? "Announcing..." : "Announce"}
              </button>
            )}
            {announceFeedback && (
              <span
                className={`sys-chip sys-chip-${announceFeedback.tone === "success" ? "success" : "warning"}`}
              >
                {announceFeedback.title}
              </span>
            )}
            {tailscaleFeedback && (
              <span
                className={`sys-chip sys-chip-${tailscaleFeedback.tone === "success" ? "success" : "warning"}`}
              >
                {tailscaleFeedback.title}
              </span>
            )}
          </div>

          <div className="mesh-map-hero">
            {mesh.localNode ? (
              <MeshTopologyView mesh={mesh} />
            ) : (
              <div className="sys-list-empty">
                <h3>Topology unavailable</h3>
                <p>A local node record is required before the topology view can render.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── FLEET MODE ── */}
      {mesh && mode === "fleet" && (
        <>
          <div className="mesh-fleet-mini">
            {mesh.localNode && <MeshTopologyView mesh={mesh} />}
          </div>

          <section className="sys-panel">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Agents</h3>
                <p className="sys-section-subtitle">
                  All agents registered with this broker.
                </p>
              </div>
            </div>
            <MeshAgentTable />
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
                  This can be normal on a single-node setup. If you expect peers, check mesh health in the inspector.
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
                  {!mesh.tailscale.available
                    ? "Tailscale peers were not detected on this machine."
                    : !mesh.tailscale.running
                      ? "Tailscale is installed but currently stopped on this machine."
                      : "Only this host is visible in the current tailnet snapshot."}
                </p>
              </div>
            ) : (
              <div className="sys-list-grid">
                {externalTailscalePeers.map((peer) => (
                  <article key={peer.id} className="sys-list-card">
                    <div className="sys-list-card-head">
                      <h3 className="sys-list-card-title">{tailnetPeerLabel(peer)}</h3>
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

          {mesh.tailscale.available && !mesh.tailscale.running && (
            <div className="sys-banner sys-banner-warning">
              <strong>Tailscale is stopped.</strong>
              <span>
                {mesh.tailscale.health[0]
                  ?? "This machine is showing cached Tailnet peers, but the local Tailscale backend is not running."}
              </span>
              <div className="sys-inline-actions">
                <button
                  type="button"
                  className="s-btn"
                  disabled={tailscaleBusy}
                  onClick={() => void openTailscale()}
                >
                  {tailscaleBusy ? "Opening Tailscale..." : "Open Tailscale"}
                </button>
                <button
                  type="button"
                  className="s-btn"
                  disabled={tailscaleBusy || refreshing}
                  onClick={() => void load("manual")}
                >
                  {refreshing ? "Refreshing..." : "Refresh status"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
