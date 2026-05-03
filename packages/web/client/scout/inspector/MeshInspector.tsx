import { useMeshViewStore, setMeshSelection } from "../../lib/mesh-view-store.ts";
import { timeAgo } from "../../lib/time.ts";
import "../../screens/system-surfaces-redesign.css";
import "../../screens/mesh-screen.css";

function shortHost(input?: string | null): string {
  if (!input) return "Unavailable";
  return input.replace(/^https?:\/\//, "").split("/")[0] ?? input;
}

export function MeshInspectorPanel() {
  const { meshSnapshot, selectedId, selectedType } = useMeshViewStore();

  if (!meshSnapshot) {
    return (
      <div className="sys-inspector-empty">
        <p>Loading mesh…</p>
      </div>
    );
  }

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
