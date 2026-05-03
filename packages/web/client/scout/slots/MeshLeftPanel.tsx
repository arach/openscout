import { useMeshViewStore, setMeshSelection } from "../../lib/mesh-view-store.ts";
import { timeAgo } from "../../lib/time.ts";
import "./ctx-panel.css";
import "../../screens/mesh-screen.css";

export function MeshLeftPanel() {
  const { meshSnapshot, selectedId, selectedType } = useMeshViewStore();

  if (!meshSnapshot) {
    return (
      <div className="ctx-panel ctx-panel--empty">
        <div className="ctx-panel-empty-state">
          <div className="ctx-panel-empty-hint">Loading mesh status…</div>
        </div>
      </div>
    );
  }

  const nodes = Object.values(meshSnapshot.nodes);
  const localId = meshSnapshot.localNode?.id;
  const localNode = meshSnapshot.localNode;
  const remoteNodes = nodes.filter((n) => n.id !== localId);

  const base = (s?: string | null) =>
    (s ?? "").replace(/^https?:\/\//, "").split("/")[0].split(":")[0].split(".")[0].toLowerCase();

  const tailnetOnly = meshSnapshot.tailscale.peers.filter(
    (p) =>
      !nodes.some(
        (n) => base(n.hostName) === base(p.hostName) || base(n.brokerUrl) === base(p.addresses?.[0]),
      ),
  );

  return (
    <div className="ctx-panel">
      <div className="mesh-left-section-label">NODES</div>

      {localNode && (
        <button
          type="button"
          className={`mesh-left-node-row${selectedId === localNode.id && selectedType === "node" ? " mesh-left-node-row--active" : ""}`}
          onClick={() =>
            setMeshSelection(
              selectedId === localNode.id ? null : localNode.id,
              selectedId === localNode.id ? null : "node",
            )
          }
        >
          <span className="mesh-left-node-dot mesh-left-node-dot--online" />
          <span className="mesh-left-node-body">
            <span className="mesh-left-node-name">
              {localNode.hostName?.split(".")[0] ?? localNode.name ?? "this broker"}
            </span>
            <span className="mesh-left-node-sub">this node</span>
          </span>
        </button>
      )}

      {remoteNodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className={`mesh-left-node-row${selectedId === node.id && selectedType === "node" ? " mesh-left-node-row--active" : ""}`}
          onClick={() =>
            setMeshSelection(
              selectedId === node.id ? null : node.id,
              selectedId === node.id ? null : "node",
            )
          }
        >
          <span
            className={`mesh-left-node-dot${node.advertiseScope === "mesh" ? " mesh-left-node-dot--online" : " mesh-left-node-dot--muted"}`}
          />
          <span className="mesh-left-node-body">
            <span className="mesh-left-node-name">
              {node.hostName?.split(".")[0] ?? node.name ?? node.id.slice(0, 8)}
            </span>
            <span className="mesh-left-node-sub">
              {node.advertiseScope === "mesh" ? "mesh peer" : "local only"}
              {node.lastSeenAt ? ` · ${timeAgo(node.lastSeenAt)}` : ""}
            </span>
          </span>
        </button>
      ))}

      {tailnetOnly.slice(0, 5).map((peer) => (
        <button
          key={peer.id}
          type="button"
          className="mesh-left-node-row mesh-left-node-row--dim"
          disabled
        >
          <span
            className={`mesh-left-node-dot${peer.online ? " mesh-left-node-dot--tailnet" : " mesh-left-node-dot--offline"}`}
          />
          <span className="mesh-left-node-body">
            <span className="mesh-left-node-name">
              {peer.hostName?.split(".")[0] ?? peer.name ?? "tailnet peer"}
            </span>
            <span className="mesh-left-node-sub">tailnet only</span>
          </span>
        </button>
      ))}

      {remoteNodes.length === 0 && tailnetOnly.length === 0 && (
        <div className="mesh-left-empty">No remote peers discovered</div>
      )}
    </div>
  );
}
