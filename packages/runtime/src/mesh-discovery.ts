import type { NodeDefinition } from "@openscout/protocol";

import { readTailscalePeers } from "./tailscale.js";

export interface MeshDiscoveryOptions {
  localNodeId: string;
  localBrokerUrl?: string;
  defaultPort: number;
  meshId: string;
  seeds?: string[];
  timeoutMs?: number;
}

export interface MeshDiscoveryResult {
  discovered: NodeDefinition[];
  probes: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSeedUrl(seed: string, defaultPort: number): string {
  try {
    const url = new URL(seed.includes("://") ? seed : `http://${seed}`);
    if (!url.port) {
      url.port = String(defaultPort);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function buildPeerSeeds(peerName: string, addresses: string[], dnsName: string | undefined, defaultPort: number): string[] {
  const names = [dnsName, peerName]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeSeedUrl(value, defaultPort));
  const ips = addresses.map((address) => normalizeSeedUrl(address, defaultPort));
  return unique([...names, ...ips]);
}

async function probeNode(baseUrl: string, timeoutMs: number): Promise<NodeDefinition | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/v1/node`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const node = await response.json() as NodeDefinition;
    return {
      ...node,
      brokerUrl: node.brokerUrl ?? baseUrl,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverMeshNodes(
  options: MeshDiscoveryOptions,
): Promise<MeshDiscoveryResult> {
  const peerSeeds = options.seeds
    ? options.seeds.map((seed) => normalizeSeedUrl(seed, options.defaultPort))
    : [];
  const tailscalePeers = await readTailscalePeers();
  const tailscaleSeeds = tailscalePeers
    .filter((peer) => peer.online)
    .flatMap((peer) => buildPeerSeeds(peer.name, peer.addresses, peer.dnsName, options.defaultPort));
  const candidates = unique([...peerSeeds, ...tailscaleSeeds])
    .filter((seed) => seed && seed !== options.localBrokerUrl);

  const discovered: NodeDefinition[] = [];
  const seen = new Set<string>();

  for (const seed of candidates) {
    const node = await probeNode(seed, options.timeoutMs ?? 1500);
    if (!node) continue;
    if (node.id === options.localNodeId) continue;
    if (node.meshId !== options.meshId) continue;
    if (seen.has(node.id)) continue;
    seen.add(node.id);

    discovered.push({
      ...node,
      brokerUrl: node.brokerUrl ?? seed,
      advertiseScope: "mesh",
      lastSeenAt: Date.now(),
      registeredAt: node.registeredAt ?? Date.now(),
    });
  }

  return {
    discovered,
    probes: candidates,
  };
}
