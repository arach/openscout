import { describe, expect, test } from "bun:test";

import {
  buildTwinNudge,
  buildTwinSystemPrompt,
  buildTwinSystemPromptTemplate,
  renderTwinSystemPromptTemplate,
  stripTwinReplyMetadata,
} from "./project-twins";

describe("project twin prompts", () => {
  test("system prompt composes shared base, project context, and broker-backed protocol", () => {
    process.env.OPENSCOUT_PROJECTS_ROOT = "/Users/arach/dev";
    process.env.OPENSCOUT_RELAY_HUB = "/Users/arach/.openscout/relay";

    const prompt = buildTwinSystemPrompt("shaper", "shaper", "/Users/arach/dev/shaper");

    expect(prompt).toContain('You are "shaper", a relay agent for the shaper project.');
    expect(prompt).toContain("Project context:");
    expect(prompt).toContain("Codebase root: /Users/arach/dev/shaper");
    expect(prompt).toContain("Projects root: /Users/arach/dev");
    expect(prompt).toContain("packages/relay/src/cli.ts relay send --as shaper");
    expect(prompt).toContain("packages/relay/src/cli.ts relay read --as shaper");
    expect(prompt).toContain("Relay protocol:");
    expect(prompt).toContain("Do not read or write channel.log or channel.jsonl directly");
  });

  test("system prompt template renders shared fragments, path aliases, and env variables at wake time", () => {
    process.env.OPENSCOUT_TEST_PROMPT_VAR = "broker-ready";
    process.env.OPENSCOUT_PROJECTS_ROOT = "/Users/arach/dev";
    process.env.OPENSCOUT_RELAY_HUB = "/Users/arach/.openscout/relay";

    const prompt = renderTwinSystemPromptTemplate(
      [
        buildTwinSystemPromptTemplate(),
        "",
        "Base path: {{base_path}}",
        "Workspace root: {{workspace_root}}",
        "Protocol alias:",
        "{{protocol}}",
        "Flag: {{env.OPENSCOUT_TEST_PROMPT_VAR}}",
      ].join("\n"),
      {
        twinId: "shaper",
        displayName: "Shaper",
        projectName: "shaper",
        projectPath: "/Users/arach/dev/shaper",
        brokerUrl: "http://127.0.0.1:65535",
        relayCommand: "bun relay",
        projectsRoot: "/Users/arach/dev",
        relayHub: "/Users/arach/.openscout/relay",
        openscoutRoot: "/Users/arach/dev/openscout",
      },
    );

    expect(prompt).toContain('You are "shaper", a relay agent for the shaper project.');
    expect(prompt).toContain("Codebase root: /Users/arach/dev/shaper");
    expect(prompt).toContain("Projects root: /Users/arach/dev");
    expect(prompt).toContain("Base path: /Users/arach/dev");
    expect(prompt).toContain("Workspace root: /Users/arach/dev/shaper");
    expect(prompt).toContain("Broker URL: http://127.0.0.1:65535");
    expect(prompt).toContain("bun relay send --as shaper");
    expect(prompt).toContain("bun relay read --as shaper");
    expect(prompt).toContain("Flag: broker-ready");
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
