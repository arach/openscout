import { readTailscaleStatusSummary } from "@openscout/runtime/mesh/tailscale";

export async function getMobileMeshStatus() {
  const summary = await readTailscaleStatusSummary();
  const peers = summary?.peers ?? [];
  return {
    tailscale: {
      available: summary !== null,
      running: summary?.running ?? false,
      backendState: summary?.backendState ?? null,
      health: summary?.health ?? [],
      peers,
      onlineCount: peers.filter((peer) => peer.online).length,
    },
  };
}
