/**
 * Mesh status for the web UI.
 *
 * Ported from apps/desktop/src/core/mesh/service.ts — uses the same
 * broker helpers already available in the web server package.
 */

import type { NodeDefinition } from "@openscout/protocol";
import { readTailscalePeers, type TailscalePeerCandidate } from "@openscout/runtime/mesh/tailscale";

import {
  readScoutBrokerHealth,
  loadScoutBrokerContext,
  resolveScoutBrokerUrl,
  type ScoutBrokerHealthState,
  type ScoutBrokerNodeRecord,
} from "../broker/service.ts";

/* ── Types ── */

export type TailscaleStatus = {
  available: boolean;
  peers: TailscalePeerCandidate[];
  onlineCount: number;
};

export type MeshStatusReport = {
  brokerUrl: string;
  health: ScoutBrokerHealthState;
  localNode: ScoutBrokerNodeRecord | null;
  meshId: string | null;
  nodes: Record<string, NodeDefinition>;
  tailscale: TailscaleStatus;
  warnings: string[];
};

/* ── Helpers ── */

function isLoopbackBrokerUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
  } catch {
    return false;
  }
}

async function readTailscaleStatus(): Promise<TailscaleStatus> {
  const peers = await readTailscalePeers();
  return {
    available: peers.length > 0,
    peers,
    onlineCount: peers.filter((p) => p.online).length,
  };
}

function computeWarnings(
  health: ScoutBrokerHealthState,
  localNode: ScoutBrokerNodeRecord | null,
  nodes: Record<string, NodeDefinition>,
  tailscale: TailscaleStatus,
): string[] {
  const warnings: string[] = [];

  if (!health.reachable) {
    warnings.push("Broker is not reachable. Run `scout setup` to start it.");
    return warnings;
  }

  if (localNode?.advertiseScope === "local") {
    warnings.push(
      "Node advertise scope is `local` — peers will not discover this broker. " +
      "Set OPENSCOUT_ADVERTISE_SCOPE=mesh and restart the broker.",
    );
  } else if (localNode?.advertiseScope === "mesh" && localNode.brokerUrl && isLoopbackBrokerUrl(localNode.brokerUrl)) {
    warnings.push(
      "Broker advertises mesh scope but is bound to loopback — peers cannot reach it. " +
      "Unset OPENSCOUT_BROKER_HOST (mesh default is 0.0.0.0) or use your Tailscale IP.",
    );
  }

  const remoteNodes = Object.values(nodes).filter((n) => n.id !== localNode?.id);

  if (!tailscale.available && remoteNodes.length === 0) {
    warnings.push(
      "No Tailscale peers found and no mesh seeds configured. " +
      "Install Tailscale or set OPENSCOUT_MESH_SEEDS.",
    );
  }

  return warnings;
}

/* ── Public API ── */

const STALE_NODE_MS = 24 * 60 * 60 * 1000; // 24h

function filterCurrentMeshNodes(
  allNodes: Record<string, NodeDefinition>,
  meshId: string | null,
  localNodeId: string | undefined,
  now: number,
): Record<string, NodeDefinition> {
  const filtered: Record<string, NodeDefinition> = {};
  for (const [id, node] of Object.entries(allNodes)) {
    if (id === localNodeId) {
      filtered[id] = node;
      continue;
    }
    if (meshId && node.meshId && node.meshId !== meshId) continue;
    const lastSeen = node.lastSeenAt ?? node.registeredAt ?? 0;
    if (lastSeen > 0 && now - lastSeen > STALE_NODE_MS) continue;
    filtered[id] = node;
  }
  return filtered;
}

export async function loadMeshStatus(): Promise<MeshStatusReport> {
  const brokerUrl = resolveScoutBrokerUrl();
  const [health, context, tailscale] = await Promise.all([
    readScoutBrokerHealth(brokerUrl),
    loadScoutBrokerContext(brokerUrl),
    readTailscaleStatus(),
  ]);

  const localNode = context?.node ?? null;
  const allNodes = context?.snapshot.nodes ?? {};
  const meshId = health.meshId ?? localNode?.meshId ?? null;
  const nodes = filterCurrentMeshNodes(allNodes, meshId, localNode?.id, Date.now());
  const warnings = computeWarnings(health, localNode, nodes, tailscale);

  return { brokerUrl, health, localNode, meshId, nodes, tailscale, warnings };
}
