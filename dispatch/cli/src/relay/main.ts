#!/usr/bin/env bun
// Relay entry point.
//
// Usage:
//   bun run relay                 # auto-discovers Tailscale, generates certs, serves wss://
//   bun run relay -- --port 9001  # custom port
//   bun run relay -- --no-tls     # force plaintext (ws://)
//
// On first run with Tailscale available:
//   1. Detects the Tailscale hostname
//   2. Generates TLS certs via `tailscale cert`
//   3. Stores them in ~/.dispatch/
//   4. Serves wss:// automatically
//
// On subsequent runs, reuses the stored certs.

import { existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { startRelay, type RelayOptions } from "./relay.ts";

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const port = Number(getArg("--port") ?? 7889);
const noTls = hasFlag("--no-tls");

const DISPATCH_DIR = join(homedir(), ".dispatch");

// ---------------------------------------------------------------------------
// TLS: find existing certs or generate via Tailscale
// ---------------------------------------------------------------------------

interface TLSPair {
  cert: string;
  key: string;
}

function findStoredCerts(): TLSPair | null {
  if (!existsSync(DISPATCH_DIR)) return null;

  try {
    const files = readdirSync(DISPATCH_DIR);
    const crtFile = files.find((f) => f.endsWith(".ts.net.crt"));
    if (!crtFile) return null;

    const keyFile = crtFile.replace(/\.crt$/, ".key");
    if (!files.includes(keyFile)) return null;

    return {
      cert: join(DISPATCH_DIR, crtFile),
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
      timeout: 5000,
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
    console.log(`[relay] generating TLS cert for ${hostname}...`);
    execSync(`tailscale cert --cert-file "${certPath}" --key-file "${keyPath}" "${hostname}"`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    console.log(`[relay] cert stored in ${DISPATCH_DIR}`);
    return { cert: certPath, key: keyPath };
  } catch (err: any) {
    console.warn(`[relay] tailscale cert failed, falling back to self-signed`);
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
      { stdio: ["pipe", "pipe", "pipe"], timeout: 10000 },
    );
    console.log(`[relay] self-signed cert stored in ${DISPATCH_DIR}`);
    return { cert: certPath, key: keyPath };
  } catch (err: any) {
    console.warn(`[relay] failed to generate self-signed cert: ${err.message}`);
    return null;
  }
}

function resolveTLS(): TLSPair | null {
  // 1. Check for existing certs.
  const stored = findStoredCerts();
  if (stored) {
    console.log(`[relay] using stored TLS cert: ${stored.cert}`);
    return stored;
  }

  // 2. Detect Tailscale and generate.
  const hostname = getTailscaleHostname();
  if (!hostname) {
    console.log("[relay] Tailscale not detected — serving plaintext (ws://)");
    return null;
  }

  console.log(`[relay] Tailscale detected: ${hostname}`);
  return generateTailscaleCerts(hostname);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const options: RelayOptions = {};

if (!noTls) {
  const tls = resolveTLS();
  if (tls) {
    options.tls = tls;
  }
}

const relay = startRelay(port, options);

process.on("SIGINT", () => {
  console.log("\n[relay] shutting down...");
  relay.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  relay.stop();
  process.exit(0);
});
