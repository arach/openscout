import { describe, expect, test } from "bun:test";

import { formatScoutAskRoutingError, renderAskCommandHelp } from "./ask.ts";

describe("renderAskCommandHelp", () => {
  test("documents owned-work semantics and DM default routing", () => {
    const help = renderAskCommandHelp();

    expect(help).toContain("Ask one agent to do work or return a concrete answer.");
    expect(help).toContain("one target + no channel            -> DM");
    expect(help).toContain("Use ask when the meaning is \"do this and get back to me.\"");
    expect(help).toContain("--prompt-file <path>");
  });
});

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

  test("says plainly when there is no such target", () => {
    expect(formatScoutAskRoutingError(
      {
        targetDiagnostic: {
          agentId: "@mars",
          state: "unknown",
          registrationKind: null,
          projectRoot: null,
        },
      },
      "mars",
    )).toBe(
      "there is no @mars; nothing was sent.",
    );
  });

  test("calls out known but unavailable targets directly", () => {
    expect(formatScoutAskRoutingError(
      {
        targetDiagnostic: {
          agentId: "newell",
          state: "unavailable",
          detail: "Newell is currently offline with a manual wake policy, so the broker cannot bring it online without operator help.",
          wakePolicy: "manual",
          transport: "pairing_bridge",
          projectRoot: null,
        },
      },
      "newell",
    )).toContain("known but currently unavailable");
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
