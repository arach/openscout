import { useState, useCallback, useMemo } from "react";
import { useMeshViewStore, setMeshSelection, setMeshSnapshot } from "../../lib/mesh-view-store.ts";
import { useLocalAgents } from "../../lib/local-agents.ts";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Agent, MeshStatus } from "../../lib/types.ts";
import "../../screens/system-surfaces-redesign.css";
import "../../screens/mesh-screen.css";

type ReachState = "discoverable" | "local-only" | "tailnet-stopped" | "unavailable" | "loopback";

function reachState(mesh: MeshStatus): ReachState {
  if (mesh.issues.some((i) => i.code === "mesh_loopback")) return "loopback";
  if (mesh.identity.discoverable) return "discoverable";
  if (!mesh.tailscale.available) return "unavailable";
  if (!mesh.tailscale.running) return "tailnet-stopped";
  return "local-only";
}

function harnessBreakdown(agents: Agent[]): Array<{ label: string; total: number; working: number }> {
  const acc = new Map<string, { total: number; working: number }>();
  for (const a of agents) {
    const key = (a.harness ?? a.agentClass ?? "agent").toLowerCase();
    const entry = acc.get(key) ?? { total: 0, working: 0 };
    entry.total += 1;
    if (normalizeAgentState(a.state) === "working") entry.working += 1;
    acc.set(key, entry);
  }
  return Array.from(acc.entries())
    .map(([label, v]) => ({ label, total: v.total, working: v.working }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

function shortHost(input?: string | null): string {
  if (!input) return "Unavailable";
  return input.replace(/^https?:\/\//, "").split("/")[0] ?? input;
}

function cleanIp(addr: string): string {
  return addr.split("/")[0];
}

export function MeshInspectorPanel() {
  const { meshSnapshot, selectedId, selectedType, probeCache } = useMeshViewStore();
  const { agents } = useLocalAgents();
  const [announcing, setAnnouncing] = useState(false);
  const [tailscaleBusy, setTailscaleBusy] = useState(false);

  const handleAnnounce = useCallback(async () => {
    setAnnouncing(true);
    try {
      const data = await api<MeshStatus>("/api/mesh/announce", { method: "POST", body: "{}" });
      setMeshSnapshot(data);
    } finally {
      setAnnouncing(false);
    }
  }, []);

  const handleStartTailscale = useCallback(async () => {
    setTailscaleBusy(true);
    try {
      const data = await api<MeshStatus>("/api/mesh/tailscale", {
        method: "POST",
        body: JSON.stringify({ action: "open_app" }),
      });
      setMeshSnapshot(data);
    } finally {
      setTailscaleBusy(false);
    }
  }, []);

  const totals = useMemo(() => {
    const acc = { total: agents.length, working: 0, available: 0, offline: 0 };
    for (const a of agents) {
      const state = normalizeAgentState(a.state);
      acc[state] += 1;
    }
    return acc;
  }, [agents]);

  const harness = useMemo(() => harnessBreakdown(agents), [agents]);

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

  // ── Default: machine summary ──
  const mesh = meshSnapshot;
  const reach = reachState(mesh);
  const peerCount = Object.values(mesh.nodes).filter((n) => n.id !== mesh.localNode?.id).length;
  const tailnetOnline = mesh.tailscale.onlineCount ?? 0;
  const hostLabel = mesh.localNode?.hostName?.split(".")[0] ?? mesh.localNode?.name ?? mesh.identity.name ?? "this broker";

  return (
    <div className="sys-inspector-content mesh-summary">
      <div className="sys-inspector-head">
        <h3 className="sys-inspector-title">{hostLabel}</h3>
        <span className="mesh-summary-mode">{mesh.identity.modeLabel}</span>
      </div>

      <section className="mesh-summary-section">
        <div className="mesh-summary-counts">
          <div className="mesh-summary-count">
            <span className="mesh-summary-count-value">{totals.total}</span>
            <span className="mesh-summary-count-label">agents</span>
          </div>
          <div className="mesh-summary-count mesh-summary-count--working">
            <span className="mesh-summary-count-value">{totals.working}</span>
            <span className="mesh-summary-count-label">working</span>
          </div>
          <div className="mesh-summary-count">
            <span className="mesh-summary-count-value">{totals.available}</span>
            <span className="mesh-summary-count-label">available</span>
          </div>
          <div className="mesh-summary-count mesh-summary-count--offline">
            <span className="mesh-summary-count-value">{totals.offline}</span>
            <span className="mesh-summary-count-label">offline</span>
          </div>
        </div>
      </section>

      {harness.length > 0 && (
        <section className="mesh-summary-section">
          <div className="sys-inspector-section-label">By harness</div>
          <div className="mesh-summary-harness">
            {harness.map((h) => (
              <div key={h.label} className="mesh-summary-harness-row">
                <span className="mesh-summary-harness-name">{h.label}</span>
                <span className="mesh-summary-harness-count">{h.total}</span>
                {h.working > 0 && (
                  <span className="mesh-summary-harness-working">{h.working} working</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mesh-summary-section">
        <div className="sys-inspector-section-label">Peers</div>
        <div className="mesh-summary-peers">
          <div className="mesh-summary-peer-row">
            <span className="mesh-summary-peer-label">Mesh</span>
            <span className="mesh-summary-peer-value">{peerCount}</span>
          </div>
          {mesh.tailscale.available && (
            <div className="mesh-summary-peer-row">
              <span className="mesh-summary-peer-label">Tailnet</span>
              <span className={`mesh-summary-peer-value${mesh.tailscale.running ? "" : " mesh-summary-peer-value--dim"}`}>
                {mesh.tailscale.running ? `${tailnetOnline} online` : "stopped"}
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="mesh-summary-section mesh-summary-reach">
        <div className="sys-inspector-section-label">Reach</div>
        <MeshReachControl
          state={reach}
          tailscaleAvailable={mesh.tailscale.available}
          announcing={announcing}
          tailscaleBusy={tailscaleBusy}
          onAnnounce={() => void handleAnnounce()}
          onStartTailscale={() => void handleStartTailscale()}
        />
      </section>
    </div>
  );
}

function MeshReachControl({
  state,
  tailscaleAvailable,
  announcing,
  tailscaleBusy,
  onAnnounce,
  onStartTailscale,
}: {
  state: ReachState;
  tailscaleAvailable: boolean;
  announcing: boolean;
  tailscaleBusy: boolean;
  onAnnounce: () => void;
  onStartTailscale: () => void;
}) {
  if (state === "discoverable") {
    return (
      <div className="mesh-reach mesh-reach--on">
        <span className="mesh-reach-dot" />
        <span className="mesh-reach-label">Discoverable on mesh</span>
      </div>
    );
  }

  if (state === "tailnet-stopped") {
    return (
      <div className="mesh-reach">
        <div className="mesh-reach-row">
          <span className="mesh-reach-dot mesh-reach-dot--off" />
          <span className="mesh-reach-label">Tailscale stopped</span>
        </div>
        <button type="button" className="s-btn mesh-reach-action" disabled={tailscaleBusy} onClick={onStartTailscale}>
          {tailscaleBusy ? "Opening…" : "Start Tailscale"}
        </button>
      </div>
    );
  }

  if (state === "loopback") {
    return (
      <div className="mesh-reach">
        <div className="mesh-reach-row">
          <span className="mesh-reach-dot mesh-reach-dot--off" />
          <span className="mesh-reach-label">Announcement broken</span>
        </div>
        <button type="button" className="s-btn mesh-reach-action" disabled={announcing} onClick={onAnnounce}>
          {announcing ? "Fixing…" : "Fix announcement"}
        </button>
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div className="mesh-reach mesh-reach--neutral">
        <span className="mesh-reach-dot mesh-reach-dot--off" />
        <span className="mesh-reach-label">Local only — no tailnet on this host</span>
      </div>
    );
  }

  // local-only with tailscale running
  return (
    <div className="mesh-reach">
      <div className="mesh-reach-row">
        <span className="mesh-reach-dot mesh-reach-dot--off" />
        <span className="mesh-reach-label">Local only</span>
      </div>
      <button
        type="button"
        className="s-btn s-btn-primary mesh-reach-action"
        disabled={announcing || !tailscaleAvailable}
        onClick={onAnnounce}
      >
        {announcing ? "Announcing…" : "Make discoverable"}
      </button>
    </div>
  );
}
