// Always-on LAN discovery beacon.
//
// Whenever the web server is up and an identity exists, it advertises
// `_oscout-pair._tcp` with the Mac's public key and web port so iOS can show
// the Mac in "On your network" and call `/pair` for the approval-gated flow.
// The pairing runtime controller may also advertise while it owns a local
// managed relay; in that one case this beacon stands down to avoid duplicate
// service instances. Remote relay / OSN pair mode still needs this beacon
// because the controller has no LAN relay service to advertise.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolvedPairingConfig } from "./core/pairing/runtime/config.ts";
import { localConfigHome, resolveWebPort } from "@openscout/runtime/local-config";
import { tryLoadIdentityPublicKeyHex } from "./core/pairing/runtime/security/identity.ts";

const RECONCILE_INTERVAL_MS = 5_000;
/** A claim older than this belongs to a process that stopped refreshing it. */
const CLAIM_STALE_MS = RECONCILE_INTERVAL_MS * 4;

interface BeaconClaim {
  pid: number;
  webPort: number;
  updatedAt: number;
}

function claimPath(): string {
  return join(localConfigHome(), "run", "lan-beacon.json");
}

function readClaim(): BeaconClaim | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(claimPath(), "utf8"));
    const c = parsed as Partial<BeaconClaim>;
    if (typeof c?.pid !== "number" || typeof c?.updatedAt !== "number") return null;
    return { pid: c.pid, webPort: typeof c.webPort === "number" ? c.webPort : 0, updatedAt: c.updatedAt };
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is some OTHER live local process already advertising this Mac?
 *
 * The identity in `~/.openscout` is per-Mac, so every local instance advertises
 * the SAME `_oscout-pair._tcp` fingerprint. mDNS does not reject the duplicate —
 * it renames it ("OpenScout <fp> (2)") — so the Mac shows up twice and a phone
 * can resolve into whichever process it happens to pick. Bonjour cannot tell us
 * which advert is ours (the names are identical by construction), so ownership
 * is claimed here instead: first live process to write the claim advertises,
 * everyone else stands down, and a claim whose owner died is taken over.
 */
function anotherInstanceOwnsBeacon(): boolean {
  const claim = readClaim();
  if (!claim) return false;
  if (claim.pid === process.pid) return false;
  if (!isAlive(claim.pid)) return false;
  return Date.now() - claim.updatedAt < CLAIM_STALE_MS;
}

function takeClaim(webPort: number): void {
  try {
    const path = claimPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, webPort, updatedAt: Date.now() } satisfies BeaconClaim),
      { mode: 0o600 },
    );
  } catch {
    // Unwritable home — fall back to the old behaviour (advertise anyway).
  }
}

function releaseClaim(): void {
  const claim = readClaim();
  if (claim?.pid !== process.pid) return;
  try {
    rmSync(claimPath(), { force: true });
  } catch {
    // A stale claim just ages out.
  }
}

export interface ScoutPairLanBeacon {
  stop(): void;
}

/**
 * Start the discovery beacon. Returns null when it can't run (non-darwin, no
 * `dns-sd`, or no identity yet) — callers treat that as a no-op.
 *
 * @param shouldSuppressBeacon  Cheap predicate the beacon polls to decide
 *   whether another local LAN advert already represents this Mac.
 */
export function startScoutPairLanBeacon(
  shouldSuppressBeacon: () => boolean | Promise<boolean>,
  options: { webPort?: number } = {},
): ScoutPairLanBeacon | null {
  if (process.platform !== "darwin") return null;
  if (process.env.OPENSCOUT_LAN_BEACON_ENABLED === "0") return null;

  const publicKeyHex = tryLoadIdentityPublicKeyHex();
  if (!publicKeyHex) return null;

  const fingerprint = publicKeyHex.slice(0, 16);
  const relayPort = resolvedPairingConfig().port + 1;
  // Always advertise the real web port (the Mac's `/pair` endpoint) so the phone
  // never assumes a default. Prefer the bound port the caller passed; fall back to
  // the configured web port rather than omitting it.
  const webPort = normalizeWebPort(options.webPort) ?? resolveWebPort();

  let advert: ChildProcess | null = null;
  let stopped = false;
  let reconciling = false;

  function startAdvert(): void {
    if (advert || stopped) return;
    // Mirror the controller's advert (`pairing-runtime-controller.ts`) so the
    // two are interchangeable for discovery: same service type, port, and TXT
    // keys. `v=1` version, `pk` full key (dedup id + trust match), `fp`
    // fingerprint (display), `scheme` ws (no relay is live yet).
    advert = spawn(
      "/usr/bin/dns-sd",
      [
        "-R",
        `OpenScout ${fingerprint}`,
        "_oscout-pair._tcp",
        "local",
        String(relayPort),
        "v=1",
        `pk=${publicKeyHex}`,
        `fp=${fingerprint}`,
        "scheme=ws",
        "mode=discovery",
        `webPort=${webPort}`,
      ],
      { stdio: "ignore" },
    );
    advert.once("exit", () => {
      advert = null;
    });
  }

  function stopAdvert(): void {
    if (!advert) return;
    try {
      advert.kill("SIGTERM");
    } catch {
      // already gone
    }
    advert = null;
  }

  async function reconcile(): Promise<void> {
    if (stopped || reconciling) return;
    reconciling = true;
    try {
      // Another LIVE local instance already speaks for this Mac — stand down
      // rather than register a duplicate the phone can resolve into.
      if (anotherInstanceOwnsBeacon()) {
        stopAdvert();
        return;
      }
      if (await shouldSuppressBeacon()) {
        stopAdvert();
        releaseClaim();
      } else {
        // Refresh on every pass, so if we die the claim ages out and another
        // instance takes over within a few reconciles.
        takeClaim(webPort);
        startAdvert();
      }
    } catch {
      // If we can't tell, prefer being discoverable.
      startAdvert();
    } finally {
      reconciling = false;
    }
  }

  const timer = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  void reconcile();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      stopAdvert();
      releaseClaim();
    },
  };
}

function normalizeWebPort(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : null;
}
