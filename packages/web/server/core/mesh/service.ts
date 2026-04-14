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
  if (remoteNodes.length === 0 && tailscale.onlineCount > 0) {
    warnings.push(
      `Tailscale has ${tailscale.onlineCount} online peer${tailscale.onlineCount === 1 ? "" : "s"} but no remote nodes were discovered. ` +
      "Run `scout mesh discover` to probe peers.",
    );
  }

  if (!tailscale.available && remoteNodes.length === 0) {
    warnings.push(
      "No Tailscale peers found and no mesh seeds configured. " +
      "Install Tailscale or set OPENSCOUT_MESH_SEEDS.",
    );
  }

  return warnings;
}

/* ── Public API ── */

export async function loadMeshStatus(): Promise<MeshStatusReport> {
  const brokerUrl = resolveScoutBrokerUrl();
  const [health, context, tailscale] = await Promise.all([
    readScoutBrokerHealth(brokerUrl),
    loadScoutBrokerContext(brokerUrl),
    readTailscaleStatus(),
  ]);

  const localNode = context?.node ?? null;
  const nodes = context?.snapshot.nodes ?? {};
  const meshId = health.meshId ?? localNode?.meshId ?? null;
  const warnings = computeWarnings(health, localNode, nodes, tailscale);

  return { brokerUrl, health, localNode, meshId, nodes, tailscale, warnings };
}
