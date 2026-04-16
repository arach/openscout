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

  test("lists candidates when the short @name matches multiple agents", () => {
    const message = formatScoutAskRoutingError(
      {
        targetDiagnostic: {
          state: "ambiguous",
          candidates: [
            { agentId: "vox.mini.codex", label: "@vox.harness:codex" },
            { agentId: "vox.mini.claude", label: "@vox.harness:claude" },
          ],
        },
      },
      "vox",
    );
    expect(message).toContain("target @vox matches multiple agents");
    expect(message).toContain("@vox.harness:codex");
    expect(message).toContain("@vox.harness:claude");
    expect(message).toContain("Re-run with the fully qualified form");
  });
});
