import { expect, test } from "bun:test";

import { resolvedPairingConfig } from "./config.ts";

test("pairing config can take the hosted mobile relay from environment", () => {
  expect(resolvedPairingConfig({
    OPENSCOUT_PAIRING_RELAY_URL: " wss://mesh.oscout.net/v1/relay ",
  }).relay).toBe("wss://mesh.oscout.net/v1/relay");
});
