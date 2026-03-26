import { describe, expect, test } from "bun:test";

import {
  buildTwinNudge,
  buildTwinSystemPrompt,
  stripTwinReplyMetadata,
} from "./project-twins";

describe("project twin prompts", () => {
  test("system prompt directs twins to broker-backed relay commands", () => {
    const prompt = buildTwinSystemPrompt("shaper", "shaper", "/Users/arach/dev/shaper");

    expect(prompt).toContain("The local broker for agent communication is at");
    expect(prompt).toContain("packages/relay/src/cli.ts relay send --as shaper");
    expect(prompt).toContain("packages/relay/src/cli.ts relay read --as shaper");
    expect(prompt).toContain("Do not read or write channel.log or channel.jsonl directly");
  });

  test("nudge includes task, context, and relay reply instructions", () => {
    const prompt = buildTwinNudge(
      "shaper",
      {
        id: "inv-1",
        requesterId: "hudson",
        requesterNodeId: "node-1",
        targetAgentId: "shaper",
        action: "consult",
        task: "Find the session restore race.",
        context: {
          file: "ShaperProvider.tsx",
        },
        ensureAwake: true,
        stream: false,
        createdAt: 1,
      },
      "flt-1",
    );

    expect(prompt).toContain("Task: Find the session restore race.");
    expect(prompt).toContain('Context: {"file":"ShaperProvider.tsx"}');
    expect(prompt).toContain("packages/relay/src/cli.ts relay read -n 20 --as shaper");
    expect(prompt).toContain('packages/relay/src/cli.ts relay send --as shaper "[ask:flt-1] @hudson <your response>"');
  });
});

describe("project twin reply cleanup", () => {
  test("strips ask ids and asker mentions from replies", () => {
    const cleaned = stripTwinReplyMetadata(
      "[ask:flt-1] @hudson SHAPER_BROKER_OK",
      "flt-1",
      "hudson",
    );

    expect(cleaned).toBe("SHAPER_BROKER_OK");
  });
});
