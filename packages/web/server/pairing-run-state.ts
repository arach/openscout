// The per-Mac `run/` directory that shared pairing state lives in.
//
// Both the pair-request store and the LAN beacon claim write files beside the
// pairing identity in `~/.openscout`, which is real user data: a pair-request
// row carries a bearer token that completes a pair. Every writer of OpenScout
// user state is expected to refuse to run against a real home under a test
// runner, and these are no exception — an unisolated test once left a live
// pending token in the operator's actual `~/.openscout/run/pair-requests.json`.

import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { assertTestIsolatedUserData } from "@openscout/runtime/support-paths";

function isInside(parent: string, child: string): boolean {
  const base = resolve(parent);
  const target = resolve(child);
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

/**
 * Refuse to write shared pairing state unless a test has isolated it.
 *
 * Two conditions, because either alone leaves the hole open:
 *
 * - `OPENSCOUT_HOME` must be set at all, matching every other user-data writer
 *   (`writeLocalConfig`, `writeOpenScoutSettings`). Without it, a path derived
 *   from `homedir()` lands in the runner's real home.
 * - the path must not be inside the REAL `~/.openscout` unless the isolation
 *   variable explicitly points there. A test that sets `OPENSCOUT_HOME` to a
 *   temp directory and then hands us a hard-coded real-home path would satisfy
 *   the first check and still leak, so the destination is checked too.
 *
 * Outside a test runner this is a no-op: production is exactly the case that is
 * supposed to write to the real home.
 */
export function assertIsolatedPairingRunStateWrite(path: string): void {
  assertTestIsolatedUserData("write shared pairing run state", "OPENSCOUT_HOME");
  if (process.env.NODE_ENV !== "test") return;
  const isolatedHome = process.env.OPENSCOUT_HOME?.trim();
  if (isolatedHome && isInside(isolatedHome, path)) return;
  if (!isInside(join(homedir(), ".openscout"), path)) return;
  throw new Error(
    `Refusing to write pairing run state to ${path} while NODE_ENV=test: that path is inside the real `
      + "~/.openscout. Point OPENSCOUT_HOME at a temp directory (see isolateOpenScoutUserDataForTests).",
  );
}
