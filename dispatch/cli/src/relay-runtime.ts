import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { dispatchLog } from "./log";
import { startRelay, type RelayOptions } from "./relay/relay";

const DISPATCH_DIR = join(homedir(), ".dispatch");

interface TLSPair {
  cert: string;
  key: string;
}

export type StartedManagedRelay = {
  relayUrl: string;
  stop: () => void;
};

function findStoredCerts(): TLSPair | null {
  if (!existsSync(DISPATCH_DIR)) {
    return null;
  }

  try {
    const files = readdirSync(DISPATCH_DIR);
    const certFile = files.find((file) => file.endsWith(".ts.net.crt") || file.endsWith(".crt"));
    if (!certFile) {
      return null;
    }
    const keyFile = certFile.replace(/\.crt$/, ".key");
    if (!files.includes(keyFile)) {
      return null;
    }
    return {
      cert: join(DISPATCH_DIR, certFile),
      key: join(DISPATCH_DIR, keyFile),
    };
  } catch {
    return null;
  }
}

function getTailscaleHostname(): string | null {
  try {
    const output = execSync("tailscale status --self=true --peers=false --json", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    }).toString();
    const data = JSON.parse(output);
    const dnsName: string = data?.Self?.DNSName ?? "";
    return dnsName.replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function generateTailscaleCerts(hostname: string): TLSPair | null {
  mkdirSync(DISPATCH_DIR, { recursive: true });

  const certPath = join(DISPATCH_DIR, `${hostname}.crt`);
  const keyPath = join(DISPATCH_DIR, `${hostname}.key`);

  try {
    dispatchLog.info("relay", "generating tailscale TLS cert", { hostname });
    execSync(`tailscale cert --cert-file "${certPath}" --key-file "${keyPath}" "${hostname}"`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { cert: certPath, key: keyPath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    dispatchLog.warn("relay", "tailscale cert failed; falling back to self-signed TLS", { hostname, detail });
    return generateSelfSignedCert(hostname);
  }
}

function generateSelfSignedCert(hostname: string): TLSPair | null {
  mkdirSync(DISPATCH_DIR, { recursive: true });

  const certPath = join(DISPATCH_DIR, `${hostname}.crt`);
  const keyPath = join(DISPATCH_DIR, `${hostname}.key`);

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
    dispatchLog.info("relay", "generated self-signed TLS cert", { hostname });
    return { cert: certPath, key: keyPath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    dispatchLog.warn("relay", "failed to generate self-signed TLS cert", { hostname, detail });
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
  const hostname = getTailscaleHostname();
  const tls = resolveTls(hostname);

  if (hostname && tls) {
    return {
      relayUrl: `wss://${hostname}:${port}`,
      options: { tls } satisfies RelayOptions,
    };
  }

  if (hostname) {
    dispatchLog.warn("relay", "tailscale hostname detected without TLS; refusing insecure fallback", { hostname, port });
    throw new Error(`Dispatch could not provision TLS for ${hostname}.`);
  }

  return {
    relayUrl: `ws://127.0.0.1:${port}`,
    options: {} satisfies RelayOptions,
  };
}

export function suggestedRelayUrl(port = 7889) {
  return resolveRelayEndpoint(port).relayUrl;
}

export function startManagedRelay(port = 7889): StartedManagedRelay {
  const endpoint = resolveRelayEndpoint(port);
  dispatchLog.info("relay", "starting managed relay", { relay: endpoint.relayUrl, port });
  const relay = startRelay(port, endpoint.options);

  return {
    relayUrl: endpoint.relayUrl,
    stop() {
      dispatchLog.info("relay", "stopping managed relay", { relay: endpoint.relayUrl, port });
      relay.stop();
    },
  };
}
