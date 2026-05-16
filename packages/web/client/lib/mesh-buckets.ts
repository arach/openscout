import type { Agent, MeshStatus } from "./types.ts";

export type HostFacts = NonNullable<MeshStatus["nodes"][string]["host"]>;

export type MachineBucket = {
  machineId: string;
  machineLabel: string;
  reachability: "this" | "peer" | "tailnet" | "unknown";
  /** True when the machine is reachable; tailnet-only peers we can't reach are false. */
  online: boolean;
  host?: HostFacts;
  agents: Agent[];
};

function shortHost(s?: string | null): string {
  if (!s) return "";
  return s.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].split(".")[0] || s.slice(0, 8);
}

function machineLabelFor(node: { name?: string; hostName?: string } | undefined | null): string {
  if (!node) return "this host";
  const host = node.hostName ? shortHost(node.hostName) : null;
  return host || node.name || "this host";
}

function tailnetPeerLabel(peer: { hostName?: string | null; name?: string | null }): string {
  return shortHost(peer.hostName) || peer.name || "tailnet peer";
}

export function bucketAgentsByMachine(agents: Agent[], mesh: MeshStatus): MachineBucket[] {
  const buckets = new Map<string, MachineBucket>();
  const localId = mesh.localNode?.id ?? "local";
  const localLabel = machineLabelFor(mesh.localNode);
  const localHost = (mesh.localNode && mesh.nodes?.[mesh.localNode.id]?.host) ?? mesh.nodes?.[localId]?.host;

  buckets.set(localId, {
    machineId: localId,
    machineLabel: localLabel,
    reachability: "this",
    online: true,
    host: localHost,
    agents: [],
  });

  for (const agent of agents) {
    const id = agent.homeNodeId ?? localId;
    let bucket = buckets.get(id);
    if (!bucket) {
      const remote = mesh.nodes?.[id];
      bucket = {
        machineId: id,
        machineLabel: machineLabelFor(remote) || agent.homeNodeName || id,
        reachability: "peer",
        online: true,
        host: remote?.host,
        agents: [],
      };
      buckets.set(id, bucket);
    }
    bucket.agents.push(agent);
  }

  const knownHosts = new Set<string>();
  for (const b of buckets.values()) {
    knownHosts.add(b.machineLabel.toLowerCase());
  }
  for (const peer of mesh.tailscale?.peers ?? []) {
    const label = tailnetPeerLabel(peer);
    const labelKey = label.toLowerCase();
    if (knownHosts.has(labelKey)) continue;
    const peerId = `tailnet:${peer.id}`;
    if (buckets.has(peerId)) continue;
    buckets.set(peerId, {
      machineId: peerId,
      machineLabel: label,
      reachability: "tailnet",
      online: Boolean(peer.online && mesh.tailscale?.running),
      agents: [],
    });
    knownHosts.add(labelKey);
  }

  const groupRank = (b: MachineBucket): number =>
    b.reachability === "this" ? 0 : b.reachability === "peer" ? 1 : 2;
  return Array.from(buckets.values()).sort((a, b) => {
    const gr = groupRank(a) - groupRank(b);
    if (gr !== 0) return gr;
    return a.machineLabel.localeCompare(b.machineLabel);
  });
}
