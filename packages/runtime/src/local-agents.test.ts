import { describe, expect, test } from "bun:test";

import {
  buildTmuxLaunchShellCommand,
  buildLocalAgentNudge,
  buildLocalAgentSystemPrompt,
  buildLocalAgentSystemPromptTemplate,
  normalizeLocalAgentSystemPrompt,
  renderLocalAgentSystemPromptTemplate,
  stripLocalAgentReplyMetadata,
} from "./local-agents";
import { DEFAULT_BROKER_URL } from "./broker-service";

describe("local agent prompts", () => {
  test("system prompt composes shared base, project context, and broker-backed protocol", () => {
    process.env.OPENSCOUT_PROJECTS_ROOT = "/Users/arach/dev";
    process.env.OPENSCOUT_RELAY_HUB = "/Users/arach/.openscout/relay";

    const prompt = buildLocalAgentSystemPrompt("shaper", "shaper", "/Users/arach/dev/shaper");

    expect(prompt).toContain('You are "shaper", a relay agent for the shaper project.');
    expect(prompt).toContain("Project context:");
    expect(prompt).toContain("Codebase root: /Users/arach/dev/shaper");
    expect(prompt).toContain("Projects root: /Users/arach/dev");
    expect(prompt).toContain('bun "/Users/arach/dev/openscout/packages/cli/bin/scout.mjs" send --as shaper "@<agent> your message"');
    expect(prompt).toContain('bun "/Users/arach/dev/openscout/packages/cli/bin/scout.mjs" ask --to <agent> --as shaper "your request"');
    expect(prompt).toContain('bun "/Users/arach/dev/openscout/packages/cli/bin/scout.mjs" latest --agent shaper --limit 20');
    expect(prompt).toContain("Relay protocol:");
    expect(prompt).toContain("Do not use file-backed relay state or side channels directly");
    expect(prompt).toContain("Default Scout loop: resolve identity, resolve one target, choose DM vs explicit channel, keep follow-up in that same venue");
    expect(prompt).toContain("Keep one-to-one handoffs in a DM");
    expect(prompt).toContain("If you need multiple agents, use separate DMs or an explicit channel");
    expect(prompt).toContain("Do not use channel.shared for ordinary delegation or follow-up");
    expect(prompt).toContain("Treat known offline / on-demand agents as wakeable");
    expect(prompt).toContain("Use send for tells and status; use ask when the meaning is 'do this and get back to me'");
    expect(prompt).toContain("/Users/arach/dev/openscout/.agents/skills/scout/SKILL.md");
  });

  test("legacy generated node-based prompts normalize away so bun defaults can replace them", () => {
    const legacyPrompt = renderLocalAgentSystemPromptTemplate(
      buildLocalAgentSystemPromptTemplate(),
      {
        agentId: "shaper",
        displayName: "Shaper",
        projectName: "shaper",
        projectPath: "/Users/arach/dev/shaper",
        brokerUrl: DEFAULT_BROKER_URL,
        relayCommand: 'node "/Users/arach/dev/openscout/packages/cli/bin/scout.mjs"',
        projectsRoot: "/Users/arach/dev",
        relayHub: "/Users/arach/.openscout/relay",
        openscoutRoot: "/Users/arach/dev/openscout",
        scoutSkill: "/Users/arach/dev/openscout/.agents/skills/scout/SKILL.md",
      },
    );

    expect(
      normalizeLocalAgentSystemPrompt("shaper", "shaper", "/Users/arach/dev/shaper", legacyPrompt),
    ).toBeUndefined();
  });

  test("system prompt template renders shared fragments, path aliases, and env variables at wake time", () => {
    process.env.OPENSCOUT_TEST_PROMPT_VAR = "broker-ready";
    process.env.OPENSCOUT_PROJECTS_ROOT = "/Users/arach/dev";
    process.env.OPENSCOUT_RELAY_HUB = "/Users/arach/.openscout/relay";

    const prompt = renderLocalAgentSystemPromptTemplate(
      [
        buildLocalAgentSystemPromptTemplate(),
        "",
        "Base path: {{base_path}}",
        "Workspace root: {{workspace_root}}",
        "Protocol alias:",
        "{{protocol}}",
        "Flag: {{env.OPENSCOUT_TEST_PROMPT_VAR}}",
      ].join("\n"),
      {
        agentId: "shaper",
        displayName: "Shaper",
        projectName: "shaper",
        projectPath: "/Users/arach/dev/shaper",
        brokerUrl: DEFAULT_BROKER_URL,
        relayCommand: "bun relay",
        projectsRoot: "/Users/arach/dev",
        relayHub: "/Users/arach/.openscout/relay",
        openscoutRoot: "/Users/arach/dev/openscout",
        scoutSkill: "/Users/arach/dev/openscout/.agents/skills/scout/SKILL.md",
      },
    );

    expect(prompt).toContain('You are "shaper", a relay agent for the shaper project.');
    expect(prompt).toContain("Codebase root: /Users/arach/dev/shaper");
    expect(prompt).toContain("Projects root: /Users/arach/dev");
    expect(prompt).toContain("Base path: /Users/arach/dev");
    expect(prompt).toContain("Workspace root: /Users/arach/dev/shaper");
    expect(prompt).toContain(`Broker URL: ${DEFAULT_BROKER_URL}`);
    expect(prompt).toContain('bun relay send --as shaper "@<agent> your message"');
    expect(prompt).toContain('bun relay ask --to <agent> --as shaper "your request"');
    expect(prompt).toContain("bun relay latest --agent shaper --limit 20");
    expect(prompt).toContain("Default Scout loop: resolve identity, resolve one target, choose DM vs explicit channel, keep follow-up in that same venue");
    expect(prompt).toContain("Keep one-to-one handoffs in a DM");
    expect(prompt).toContain("If you need multiple agents, use separate DMs or an explicit channel");
    expect(prompt).toContain("Treat known offline / on-demand agents as wakeable");
    expect(prompt).toContain("Use send for tells and status; use ask when the meaning is 'do this and get back to me'");
    expect(prompt).toContain("/Users/arach/dev/openscout/.agents/skills/scout/SKILL.md");
    expect(prompt).toContain("Flag: broker-ready");
  });

  test("nudge includes task, context, and relay reply instructions", () => {
    const prompt = buildLocalAgentNudge(
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
    expect(prompt).toContain('bun "/Users/arach/dev/openscout/packages/cli/bin/scout.mjs" latest --agent shaper --limit 20');
    expect(prompt).toContain('bun "/Users/arach/dev/openscout/packages/cli/bin/scout.mjs" send --as shaper "[ask:flt-1] @hudson <your response>"');
  });

  test("tmux launch shell command quotes script paths with spaces", () => {
    expect(buildTmuxLaunchShellCommand("/Users/arach/Library/Application Support/OpenScout/runtime/agents/spectator/launch.sh"))
      .toBe('exec bash "/Users/arach/Library/Application Support/OpenScout/runtime/agents/spectator/launch.sh"');
  });
});

describe("local agent reply cleanup", () => {
  test("strips ask ids and asker mentions from replies", () => {
    const cleaned = stripLocalAgentReplyMetadata(
      "[ask:flt-1] @hudson SHAPER_BROKER_OK",
      "flt-1",
      "hudson",
    );

    expect(cleaned).toBe("SHAPER_BROKER_OK");
  });
});
