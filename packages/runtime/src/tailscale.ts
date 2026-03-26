import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TailscalePeerCandidate {
  id: string;
  name: string;
  dnsName?: string;
  addresses: string[];
  online: boolean;
  hostName?: string;
  os?: string;
  tags?: string[];
}

interface TailscaleStatusJson {
  Peer?: Record<string, {
    ID?: string;
    HostName?: string;
    DNSName?: string;
    TailscaleIPs?: string[];
    Online?: boolean;
    OS?: string;
    Tags?: string[];
  }>;
}

function parseStatusJson(raw: string): TailscalePeerCandidate[] {
  const parsed = JSON.parse(raw) as TailscaleStatusJson;
  const peers = Object.entries(parsed.Peer ?? {});

  return peers.map(([fallbackId, peer]) => ({
    id: peer.ID ?? fallbackId,
    name: peer.HostName ?? peer.DNSName ?? fallbackId,
    dnsName: peer.DNSName,
    addresses: peer.TailscaleIPs ?? [],
    online: peer.Online ?? false,
    hostName: peer.HostName,
    os: peer.OS,
    tags: peer.Tags ?? [],
  }));
}

async function readStatusFromFile(filePath: string): Promise<TailscalePeerCandidate[]> {
  const raw = await readFile(filePath, "utf8");
  return parseStatusJson(raw);
}

export async function readTailscalePeers(): Promise<TailscalePeerCandidate[]> {
  const fixturePath = process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  if (fixturePath) {
    return readStatusFromFile(fixturePath);
  }

  try {
    const tailscaleBin = process.env.OPENSCOUT_TAILSCALE_BIN ?? "tailscale";
    const { stdout } = await execFileAsync(tailscaleBin, ["status", "--json"]);
    return parseStatusJson(stdout);
  } catch {
    return [];
  }
}
