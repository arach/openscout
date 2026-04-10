import { describe, expect, test } from "bun:test";

import { formatScoutAskRoutingError } from "./ask.ts";

describe("formatScoutAskRoutingError", () => {
  test("explains discovered targets with an explicit startup command", () => {
    expect(formatScoutAskRoutingError(
      {
        targetDiagnostic: {
          agentId: "talkie.arachs-mac-mini-local.master",
          state: "discovered",
          registrationKind: "discovered",
          projectRoot: "/tmp/dev/talkie",
        },
      },
      "talkie",
    )).toBe(
      'target @talkie is discovered but not online yet; nothing was sent. Start it with `scout up "/tmp/dev/talkie"` or wait for it to come online.',
    );
  });

  test("falls back to a generic undelivered message when there is no diagnostic", () => {
    expect(formatScoutAskRoutingError({}, "talkie")).toBe(
      "target @talkie is not currently routable; nothing was sent.",
    );
  });
});
