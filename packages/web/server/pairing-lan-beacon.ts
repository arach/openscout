// Always-on LAN discovery beacon.
//
// A Scout Mac only advertises `_scout-pair._tcp` while pair mode is actively
// running (the pairing runtime controller owns that advert, carrying the live
// relay port + fallbacks). That means a Mac sitting idle is invisible to the
// iOS "On your network" list, so the only way to pair is to first start pair
// mode by hand on the Mac.
//
// This beacon closes that gap: whenever the web server is up and an identity
// exists, it advertises the same `_scout-pair._tcp` service carrying the Mac's
// public key, so every Scout Mac shows up for discovery. Tapping it hits the
// `/pair` endpoint, which now registers an approval-gated request rather than
// 404ing. To avoid two advertisers fighting over the same service instance, the
// beacon stands down whenever pair mode is running (the controller's advert,
// which also carries reconnection fallbacks, takes over) and resumes when it
// stops.

import { type ChildProcess, spawn } from "node:child_process";
import { resolvedPairingConfig } from "./core/pairing/runtime/config.ts";
import { tryLoadIdentityPublicKeyHex } from "./core/pairing/runtime/security/identity.ts";

const RECONCILE_INTERVAL_MS = 5_000;

export interface ScoutPairLanBeacon {
  stop(): void;
}

/**
 * Start the discovery beacon. Returns null when it can't run (non-darwin, no
 * `dns-sd`, or no identity yet) — callers treat that as a no-op.
 *
 * @param isPairModeRunning  Cheap predicate the beacon polls to decide whether
 *   to stand down in favour of the controller's own advert.
 */
export function startScoutPairLanBeacon(
  isPairModeRunning: () => boolean | Promise<boolean>,
): ScoutPairLanBeacon | null {
  if (process.platform !== "darwin") return null;
  if (process.env.OPENSCOUT_LAN_BEACON_ENABLED === "0") return null;

  const publicKeyHex = tryLoadIdentityPublicKeyHex();
  if (!publicKeyHex) return null;

  const fingerprint = publicKeyHex.slice(0, 16);
  const relayPort = resolvedPairingConfig().port + 1;

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
        "_scout-pair._tcp",
        "local",
        String(relayPort),
        "v=1",
        `pk=${publicKeyHex}`,
        `fp=${fingerprint}`,
        "scheme=ws",
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
      const running = await isPairModeRunning();
      if (running) {
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
