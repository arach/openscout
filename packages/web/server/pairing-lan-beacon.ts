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
import { resolvedPairingConfig } from "./core/pairing/runtime/config.ts";
import { resolveWebPort } from "@openscout/runtime/local-config";
import { tryLoadIdentityPublicKeyHex } from "./core/pairing/runtime/security/identity.ts";

const RECONCILE_INTERVAL_MS = 5_000;

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
      if (await shouldSuppressBeacon()) {
        stopAdvert();
      } else {
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
    },
  };
}

function normalizeWebPort(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : null;
}
