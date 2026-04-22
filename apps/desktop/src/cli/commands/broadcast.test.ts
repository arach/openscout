import { describe, expect, test } from "bun:test";

import { createScoutCommandContext } from "../context.ts";
import { renderBroadcastCommandHelp, runBroadcastCommand } from "./broadcast.ts";

describe("broadcast command helpers", () => {
  test("documents shared-broadcast-only semantics", () => {
    const help = renderBroadcastCommandHelp();

    expect(help).toContain("Broadcast to channel.shared.");
    expect(help).toContain("Do not use broadcast for ordinary one-to-one delegation");
  });

  test("rejects an explicit channel override", async () => {
    const context = createScoutCommandContext({
      cwd: "/tmp/openscout-test",
      env: {},
      stdout: () => undefined,
      stderr: () => undefined,
      isTty: false,
    });

    await expect(runBroadcastCommand(context, ["--channel", "triage", "hello"]))
      .rejects
      .toThrow("broadcast always targets channel.shared; do not pass --channel");
  });
});
