import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TAILSCALE_STATUS_TIMEOUT_MS = 1_500;

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

export interface TailscaleStatusSummary {
  backendState: string | null;
  running: boolean;
  health: string[];
  peers: TailscalePeerCandidate[];
  self: TailscaleSelfCandidate | null;
}

interface TailscaleStatusJson {
  BackendState?: string;
  Health?: string[];
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

function isBackendRunning(status: TailscaleStatusJson): boolean {
  return (status.BackendState ?? "").trim().toLowerCase() === "running";
}

function normalizeHost(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\.$/, "").toLowerCase();
  if (!normalized || normalized.includes("/") || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

function uniq(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeHost(value ?? undefined);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function readStatusJsonFromFile(filePath: string): Promise<TailscaleStatusJson> {
  const raw = await readFile(filePath, "utf8");
  return parseStatusJson(raw);
}

function readStatusJsonFromFileSync(filePath: string): TailscaleStatusJson {
  const raw = readFileSync(filePath, "utf8");
  return parseStatusJson(raw);
}

async function readStatusJson(): Promise<TailscaleStatusJson | null> {
  const fixturePath = process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  if (fixturePath) {
    try {
      return await readStatusJsonFromFile(fixturePath);
    } catch {
      return null;
    }
  }

  try {
    const tailscaleBin = process.env.OPENSCOUT_TAILSCALE_BIN ?? "tailscale";
    const { stdout } = await execFileAsync(tailscaleBin, ["status", "--json"]);
    return parseStatusJson(stdout);
  } catch {
    return null;
  }
}

function statusTimeoutMs(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(env.OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TAILSCALE_STATUS_TIMEOUT_MS;
}

function readStatusJsonSync(env: NodeJS.ProcessEnv = process.env): TailscaleStatusJson | null {
  if (env.OPENSCOUT_TAILSCALE_AUTO_HOSTS === "0") {
    return null;
  }

  const fixturePath = env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  if (fixturePath) {
    try {
      return readStatusJsonFromFileSync(fixturePath);
    } catch {
      return null;
    }
  }

  const tailscaleBin = env.OPENSCOUT_TAILSCALE_BIN ?? (env === process.env ? "tailscale" : undefined);
  if (!tailscaleBin) {
    return null;
  }

  try {
    const stdout = execFileSync(tailscaleBin, ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: statusTimeoutMs(env),
      windowsHide: true,
    });
    return parseStatusJson(stdout);
  } catch {
    return null;
  }
}

export function tailscaleSelfWebHosts(self: TailscaleSelfCandidate | null | undefined): string[] {
  if (!self) {
    return [];
  }
  return uniq([
    self.dnsName,
    self.hostName && self.magicDnsSuffix ? `${self.hostName}.${self.magicDnsSuffix}` : undefined,
    ...self.addresses,
  ]);
}

export async function readTailscalePeers(): Promise<TailscalePeerCandidate[]> {
  const summary = await readTailscaleStatusSummary();
  if (!summary) {
    return [];
  }
  return summary.peers;
}

export async function readTailscaleSelf(): Promise<TailscaleSelfCandidate | null> {
  const summary = await readTailscaleStatusSummary();
  if (!summary) {
    return null;
  }
  return summary.self;
}

export async function readTailscaleStatusSummary(): Promise<TailscaleStatusSummary | null> {
  const status = await readStatusJson();
  if (!status) {
    return null;
  }

  return {
    backendState: status.BackendState ?? null,
    running: isBackendRunning(status),
    health: status.Health ?? [],
    peers: parsePeers(status),
    self: parseSelf(status),
  };
}

export function readTailscaleSelfWebHostsSync(env: NodeJS.ProcessEnv = process.env): string[] {
  const status = readStatusJsonSync(env);
  if (!status || !isBackendRunning(status)) {
    return [];
  }
  return tailscaleSelfWebHosts(parseSelf(status));
}
