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

export type MeshIssueCode =
  | "broker_unreachable"
  | "local_only"
  | "mesh_loopback"
  | "discovery_unconfigured";

export type MeshIssue = {
  code: MeshIssueCode;
  severity: "warning" | "error";
  title: string;
  summary: string;
  action: string | null;
  actionCommand: string | null;
};

export type MeshStatusReport = {
  brokerUrl: string;
  health: ScoutBrokerHealthState;
  localNode: ScoutBrokerNodeRecord | null;
  meshId: string | null;
  nodes: Record<string, NodeDefinition>;
  tailscale: TailscaleStatus;
  issues: MeshIssue[];
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

function formatIssueWarning(issue: MeshIssue): string {
  return issue.action
    ? `${issue.title} — ${issue.summary} ${issue.action}`
    : `${issue.title} — ${issue.summary}`;
}

function computeIssues(
  health: ScoutBrokerHealthState,
  localNode: ScoutBrokerNodeRecord | null,
  nodes: Record<string, NodeDefinition>,
  tailscale: TailscaleStatus,
): MeshIssue[] {
  const issues: MeshIssue[] = [];

  if (!health.reachable) {
    issues.push({
      code: "broker_unreachable",
      severity: "error",
      title: "Broker not reachable",
      summary: "The mesh page cannot reach the local broker yet, so peer status is incomplete.",
      action: "Start the broker, then reload this page.",
      actionCommand: "scout setup",
    });
    return issues;
  }

  if (localNode?.advertiseScope === "local") {
    issues.push({
      code: "local_only",
      severity: "warning",
      title: "Local-only visibility",
      summary: "This broker is healthy on this machine, but peer brokers will not discover it while advertise scope stays local.",
      action: "Switch to mesh visibility and restart the broker if this machine should participate in peer discovery.",
      actionCommand: "OPENSCOUT_ADVERTISE_SCOPE=mesh",
    });
  } else if (localNode?.advertiseScope === "mesh" && localNode.brokerUrl && isLoopbackBrokerUrl(localNode.brokerUrl)) {
    issues.push({
      code: "mesh_loopback",
      severity: "warning",
      title: "Mesh visibility is not reachable",
      summary: "This broker advertises mesh visibility, but it is still bound to a loopback address, so peers cannot connect to it.",
      action: "Unset the explicit broker host or point it at a reachable interface.",
      actionCommand: "OPENSCOUT_BROKER_HOST=0.0.0.0",
    });
  }

  const remoteNodes = Object.values(nodes).filter((n) => n.id !== localNode?.id);

  if (!tailscale.available && remoteNodes.length === 0) {
    issues.push({
      code: "discovery_unconfigured",
      severity: "warning",
      title: "No discovery path configured",
      summary: "No Tailscale peers are available and no mesh seeds are configured, so this broker has nowhere to look for peers.",
      action: "Join the machine to Tailscale or configure an explicit seed broker.",
      actionCommand: "OPENSCOUT_MESH_SEEDS=http://peer-host:65535",
    });
  }

  return issues;
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
  const issues = computeIssues(health, localNode, nodes, tailscale);
  const warnings = issues.map(formatIssueWarning);

  return { brokerUrl, health, localNode, meshId, nodes, tailscale, issues, warnings };
}
