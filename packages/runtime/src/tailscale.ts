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

export interface TailscaleSelfCandidate {
  id: string;
  name: string;
  dnsName?: string;
  addresses: string[];
  online: boolean;
  hostName?: string;
  os?: string;
  tailnetName?: string;
  magicDnsSuffix?: string;
}

interface TailscaleStatusJson {
  Self?: {
    ID?: string;
    HostName?: string;
    DNSName?: string;
    TailscaleIPs?: string[];
    Online?: boolean;
    OS?: string;
  };
  Peer?: Record<string, {
    ID?: string;
    HostName?: string;
    DNSName?: string;
    TailscaleIPs?: string[];
    Online?: boolean;
    OS?: string;
    Tags?: string[];
  }>;
  CurrentTailnet?: {
    Name?: string;
    MagicDNSSuffix?: string;
  };
}

function parseStatusJson(raw: string): TailscaleStatusJson {
  return JSON.parse(raw) as TailscaleStatusJson;
}

function parsePeers(status: TailscaleStatusJson): TailscalePeerCandidate[] {
  const peers = Object.entries(status.Peer ?? {});

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

function parseSelf(status: TailscaleStatusJson): TailscaleSelfCandidate | null {
  const self = status.Self;
  if (!self) {
    return null;
  }

  return {
    id: self.ID ?? self.DNSName ?? self.HostName ?? "self",
    name: self.HostName ?? self.DNSName ?? "self",
    dnsName: self.DNSName,
    addresses: self.TailscaleIPs ?? [],
    online: self.Online ?? true,
    hostName: self.HostName,
    os: self.OS,
    tailnetName: status.CurrentTailnet?.Name,
    magicDnsSuffix: status.CurrentTailnet?.MagicDNSSuffix,
  };
}

async function readStatusJsonFromFile(filePath: string): Promise<TailscaleStatusJson> {
  const raw = await readFile(filePath, "utf8");
  return parseStatusJson(raw);
}

async function readStatusJson(): Promise<TailscaleStatusJson | null> {
  const fixturePath = process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  if (fixturePath) {
    return readStatusJsonFromFile(fixturePath);
  }

  try {
    const tailscaleBin = process.env.OPENSCOUT_TAILSCALE_BIN ?? "tailscale";
    const { stdout } = await execFileAsync(tailscaleBin, ["status", "--json"]);
    return parseStatusJson(stdout);
  } catch {
    return null;
  }
}

export async function readTailscalePeers(): Promise<TailscalePeerCandidate[]> {
  const status = await readStatusJson();
  if (!status) {
    return [];
  }
  return parsePeers(status);
}

export async function readTailscaleSelf(): Promise<TailscaleSelfCandidate | null> {
  const status = await readStatusJson();
  if (!status) {
    return null;
  }
  return parseSelf(status);
}
