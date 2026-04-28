import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";

import { pairingLog } from "./log";
import { startRelay, type RelayOptions } from "./relay/relay";

const PAIRING_DIR = join(homedir(), ".scout/pairing");

export interface TLSPair {
  cert: string;
  key: string;
}

interface TailscaleStatusProbe {
  backendState: string | null;
  dnsName: string | null;
  online: boolean;
  health: string[];
}

export type StartedManagedRelay = {
  relayUrl: string;
  connectUrl: string;
  fallbackRelayUrls: string[];
  stop: () => void;
};

export type ResolvedRelayEndpoint = {
  relayUrl: string;
  connectUrl: string;
  fallbackRelayUrls: string[];
  options: RelayOptions;
};

export type RelayEndpointResolutionOptions = {
  localAddress?: string | null;
  tls?: TLSPair | null;
};

function findStoredCerts(): TLSPair | null {
  if (!existsSync(PAIRING_DIR)) {
    return null;
  }

  try {
    const files = readdirSync(PAIRING_DIR);
    const certFile = files.find((file) => file.endsWith(".ts.net.crt") || file.endsWith(".crt"));
    if (!certFile) {
      return null;
    }
    const keyFile = certFile.replace(/\.crt$/, ".key");
    if (!files.includes(keyFile)) {
      return null;
    }
    return {
      cert: join(PAIRING_DIR, certFile),
      key: join(PAIRING_DIR, keyFile),
    };
  } catch {
    return null;
  }
}

function readTailscaleStatus(): TailscaleStatusProbe | null {
  try {
    const output = execSync("tailscale status --self=true --peers=false --json", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    }).toString();
    const data = JSON.parse(output) as {
      BackendState?: string;
      Health?: string[];
      Self?: {
        DNSName?: string;
        Online?: boolean;
      };
    };

    const dnsName = typeof data.Self?.DNSName === "string"
      ? data.Self.DNSName.replace(/\.$/, "")
      : "";

    return {
      backendState: typeof data.BackendState === "string" ? data.BackendState : null,
      dnsName: dnsName || null,
      online: data.Self?.Online !== false,
      health: Array.isArray(data.Health) ? data.Health.filter((entry): entry is string => typeof entry === "string") : [],
    };
  } catch {
    return null;
  }
}

export function resolveRelayEndpointForTailscaleStatus(
  port: number,
  tailscale: TailscaleStatusProbe | null,
  options: RelayEndpointResolutionOptions = {},
): ResolvedRelayEndpoint {
  const backendState = tailscale?.backendState?.trim().toLowerCase() ?? "";
  const hostname = tailscale?.dnsName ?? null;
  const tailscaleRunning = backendState === "running" && tailscale?.online !== false && Boolean(hostname);
  const tls = tailscaleRunning
    ? options.tls !== undefined ? options.tls : resolveTls(hostname)
    : null;
  const scheme = tls ? "wss" : "ws";
  const connectUrl = `${scheme}://127.0.0.1:${port}`;
  const localAddress = options.localAddress !== undefined
    ? normalizedOptionalAddress(options.localAddress)
    : findLocalNetworkAddress();
  const localRelayUrl = localAddress ? `${scheme}://${localAddress}:${port}` : null;
  const tailnetRelayUrl = tailscaleRunning && hostname ? `${scheme}://${hostname}:${port}` : null;
  const fallbackRelayUrls = tailnetRelayUrl && localRelayUrl ? [tailnetRelayUrl] : [];

  if (localRelayUrl) {
    return {
      relayUrl: localRelayUrl,
      connectUrl,
      fallbackRelayUrls,
      options: tls ? { tls } satisfies RelayOptions : {} satisfies RelayOptions,
    };
  }

  if (tailnetRelayUrl && tls) {
    return {
      relayUrl: tailnetRelayUrl,
      connectUrl,
      fallbackRelayUrls: [],
      options: { tls } satisfies RelayOptions,
    };
  }

  if (tailnetRelayUrl) {
    pairingLog.warn("relay", "tailscale is running without TLS; falling back to insecure websocket relay", {
      hostname,
      port,
    });
    return {
      relayUrl: tailnetRelayUrl,
      connectUrl,
      fallbackRelayUrls: [],
      options: {} satisfies RelayOptions,
    };
  }

  if (hostname && backendState && backendState !== "running") {
    pairingLog.warn("relay", "tailscale hostname detected but tailscale is not running; using local-only relay endpoint", {
      hostname,
      backendState,
      health: tailscale?.health ?? [],
      port,
    });
  }

  return {
    relayUrl: connectUrl,
    connectUrl,
    fallbackRelayUrls: [],
    options: {} satisfies RelayOptions,
  };
}

function generateTailscaleCerts(hostname: string): TLSPair | null {
  mkdirSync(PAIRING_DIR, { recursive: true });

  const certPath = join(PAIRING_DIR, `${hostname}.crt`);
  const keyPath = join(PAIRING_DIR, `${hostname}.key`);

  try {
    pairingLog.info("relay", "generating tailscale TLS cert", { hostname });
    execSync(`tailscale cert --cert-file "${certPath}" --key-file "${keyPath}" "${hostname}"`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { cert: certPath, key: keyPath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pairingLog.warn("relay", "tailscale cert failed; falling back to self-signed TLS", { hostname, detail });
    return generateSelfSignedCert(hostname);
  }
}

function generateSelfSignedCert(hostname: string): TLSPair | null {
  mkdirSync(PAIRING_DIR, { recursive: true });

  const certPath = join(PAIRING_DIR, `${hostname}.crt`);
  const keyPath = join(PAIRING_DIR, `${hostname}.key`);

  try {
    execSync(
      `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 ` +
      `-keyout "${keyPath}" -out "${certPath}" -days 365 -nodes ` +
      `-subj "/CN=${hostname}" -addext "subjectAltName=DNS:${hostname}"`,
      {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10_000,
      },
    );
    pairingLog.info("relay", "generated self-signed TLS cert", { hostname });
    return { cert: certPath, key: keyPath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pairingLog.warn("relay", "failed to generate self-signed TLS cert", { hostname, detail });
    return null;
  }
}

function resolveTls(hostname: string | null) {
  const stored = findStoredCerts();
  if (stored) {
    return stored;
  }
  if (!hostname) {
    return null;
  }
  return generateTailscaleCerts(hostname);
}

function resolveRelayEndpoint(port: number) {
  return resolveRelayEndpointForTailscaleStatus(port, readTailscaleStatus());
}

export function suggestedRelayUrl(port = 7889) {
  return resolveRelayEndpoint(port).relayUrl;
}

export function startManagedRelay(port = 7889): StartedManagedRelay {
  const endpoint = resolveRelayEndpoint(port);
  pairingLog.info("relay", "starting managed relay", {
    relay: endpoint.relayUrl,
    connectUrl: endpoint.connectUrl,
    fallbackRelayUrls: endpoint.fallbackRelayUrls,
    port,
  });
  const relay = startRelay(port, endpoint.options);

  return {
    relayUrl: endpoint.relayUrl,
    connectUrl: endpoint.connectUrl,
    fallbackRelayUrls: endpoint.fallbackRelayUrls,
    stop() {
      pairingLog.info("relay", "stopping managed relay", { relay: endpoint.relayUrl, port });
      relay.stop();
    },
  };
}

function normalizedOptionalAddress(address: string | null | undefined): string | null {
  const trimmed = address?.trim();
  return trimmed ? trimmed : null;
}

function findLocalNetworkAddress(): string | null {
  const candidates: Array<{ name: string; address: string }> = [];
  const interfaces = networkInterfaces();

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") {
        continue;
      }
      if (!isPrivateIPv4(entry.address) || isLinkLocalIPv4(entry.address) || isTailscaleIPv4(entry.address)) {
        continue;
      }
      candidates.push({ name, address: entry.address });
    }
  }

  candidates.sort((left, right) => {
    const leftScore = localInterfaceScore(left.name);
    const rightScore = localInterfaceScore(right.name);
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    return left.address.localeCompare(right.address);
  });

  return candidates[0]?.address ?? null;
}

function localInterfaceScore(name: string): number {
  if (/^en\d+$/i.test(name)) {
    return 0;
  }
  if (/^bridge\d*$/i.test(name)) {
    return 2;
  }
  return 1;
}

function isPrivateIPv4(address: string): boolean {
  const octets = parseIPv4(address);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function isLinkLocalIPv4(address: string): boolean {
  const octets = parseIPv4(address);
  return Boolean(octets && octets[0] === 169 && octets[1] === 254);
}

function isTailscaleIPv4(address: string): boolean {
  const octets = parseIPv4(address);
  return Boolean(octets && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
}

function parseIPv4(address: string): [number, number, number, number] | null {
  const octets = address.split(".");
  if (octets.length !== 4) {
    return null;
  }
  const numbers = octets.map((octet) => Number(octet));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  return numbers as [number, number, number, number];
}
