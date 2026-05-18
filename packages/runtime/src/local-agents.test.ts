import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CLAUDE_SCOUT_ALLOWED_TOOLS,
  SUPPORTED_LOCAL_AGENT_HARNESSES,
  SUPPORTED_SCOUT_HARNESSES,
  buildTmuxLaunchShellCommand,
  buildAttachedSessionInvocationPrompt,
  buildLocalAgentDirectInvocationPrompt,
  buildLocalAgentNudge,
  buildLocalAgentSystemPrompt,
  buildLocalAgentSystemPromptTemplate,
  buildTmuxPromptSubmitKeys,
  normalizeClaudeRuntimeLaunchArgs,
  normalizeLocalAgentSystemPrompt,
  renderLocalAgentSystemPromptTemplate,
  stripLocalAgentReplyMetadata,
} from "./local-agents";
import { DEFAULT_BROKER_URL } from "./broker-process-manager";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scoutCli = `bun ${JSON.stringify(join(repoRoot, "packages", "cli", "bin", "scout.mjs"))}`;
const scoutSkillPath = join(repoRoot, ".agents", "skills", "scout", "SKILL.md");

describe("local agent prompts", () => {
  test("Scout harness attribution accepts Flue without making it a managed local launcher", () => {
    expect(SUPPORTED_SCOUT_HARNESSES).toContain("flue");
    expect(SUPPORTED_LOCAL_AGENT_HARNESSES).not.toContain("flue");
    expect(SUPPORTED_LOCAL_AGENT_HARNESSES).toContain("pi");
  });

  test("system prompt composes shared base, project context, and broker-backed protocol", () => {
    process.env.OPENSCOUT_PROJECTS_ROOT = "/Users/arach/dev";
    process.env.OPENSCOUT_RELAY_HUB = "/Users/arach/.openscout/relay";

    const prompt = buildLocalAgentSystemPrompt("shaper", "shaper", "/Users/arach/dev/shaper");

    expect(prompt).toContain('You are "shaper", a relay agent for the shaper project.');
    expect(prompt).toContain("Project context:");
    expect(prompt).toContain("Codebase root: /Users/arach/dev/shaper");
    expect(prompt).toContain("Projects root: /Users/arach/dev");
    expect(prompt).toContain(`${scoutCli} inbox --as shaper --latest 20 --json`);
    expect(prompt).toContain(`${scoutCli} channel <name> --latest 20 --json`);
    expect(prompt).toContain(`${scoutCli} send --to <agent> --as shaper "your message"`);
    expect(prompt).toContain(`${scoutCli} ask --to <agent> --as shaper "your request"`);
    expect(prompt).toContain("Relay protocol:");
    expect(prompt).toContain("Do not use file-backed relay state or side channels directly");
    expect(prompt).toContain("Do not curl broker HTTP endpoints to read messages");
    expect(prompt).toContain("Default Scout loop: resolve identity, resolve one target, choose DM vs explicit channel, keep follow-up in that same venue");
    expect(prompt).toContain("Keep one-to-one handoffs in a DM");
    expect(prompt).toContain("If you need multiple agents, use separate DMs or an explicit channel");
    expect(prompt).toContain("Do not use channel.shared for ordinary delegation or follow-up");
    expect(prompt).toContain("Treat known offline / on-demand agents as wakeable");
    expect(prompt).toContain("Use send for tells and status; use ask when the meaning is 'do this and get back to me'");
    expect(prompt).toContain("For substantial reports, specs, code, diffs, logs, or research bundles, create or update a durable file when you have write access");
    expect(prompt).toContain("If you do not have write access, keep the reply useful inline");
    expect(prompt).toContain(scoutSkillPath);
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
        relayCommand: `node ${JSON.stringify(join(repoRoot, "packages", "cli", "bin", "scout.mjs"))}`,
        projectsRoot: "/Users/arach/dev",
        relayHub: "/Users/arach/.openscout/relay",
        openscoutRoot: repoRoot,
        scoutSkill: scoutSkillPath,
      },
    );

    expect(
      normalizeLocalAgentSystemPrompt("shaper", "shaper", "/Users/arach/dev/shaper", legacyPrompt),
    ).toBeUndefined();
  });

  test("direct claude runtime prompt forbids reply tools for final-response capture", () => {
    process.env.OPENSCOUT_PROJECTS_ROOT = "/Users/arach/dev";
    process.env.OPENSCOUT_RELAY_HUB = "/Users/arach/.openscout/relay";

    const prompt = buildLocalAgentSystemPrompt(
      "shaper",
      "shaper",
      "/Users/arach/dev/shaper",
      { transport: "claude_stream_json" },
    );

    expect(prompt).toContain("OpenScout runtime:");
    expect(prompt).toContain("Do not call Scout reply tools for the final answer in this runtime");
    expect(prompt).toContain("the broker captures your final assistant message");
  });

  test("tmux claude runtime remains the default local agent context", () => {
    process.env.OPENSCOUT_PROJECTS_ROOT = "/Users/arach/dev";
    process.env.OPENSCOUT_RELAY_HUB = "/Users/arach/.openscout/relay";

    const prompt = buildLocalAgentSystemPrompt(
      "shaper",
      "shaper",
      "/Users/arach/dev/shaper",
    );

    expect(prompt).toContain("Relay protocol:");
    expect(prompt).toContain("Use the Scout CLI for broker reads and writes");
    expect(prompt).not.toContain("OpenScout runtime:");
    expect(prompt).not.toContain("the broker captures your final assistant message");
  });

  test("explicit tmux generated prompts normalize away as current defaults", () => {
    process.env.OPENSCOUT_PROJECTS_ROOT = "/Users/arach/dev";
    process.env.OPENSCOUT_RELAY_HUB = "/Users/arach/.openscout/relay";

    const prompt = buildLocalAgentSystemPrompt(
      "shaper",
      "shaper",
      "/Users/arach/dev/shaper",
      { transport: "tmux" },
    );

    expect(
      normalizeLocalAgentSystemPrompt("shaper", "shaper", "/Users/arach/dev/shaper", prompt),
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
        openscoutRoot: repoRoot,
        scoutSkill: scoutSkillPath,
      },
    );

    expect(prompt).toContain('You are "shaper", a relay agent for the shaper project.');
    expect(prompt).toContain("Codebase root: /Users/arach/dev/shaper");
    expect(prompt).toContain("Projects root: /Users/arach/dev");
    expect(prompt).toContain("Base path: /Users/arach/dev");
    expect(prompt).toContain("Workspace root: /Users/arach/dev/shaper");
    expect(prompt).not.toContain(`Broker URL: ${DEFAULT_BROKER_URL}`);
    expect(prompt).toContain("Use the Scout CLI for broker reads and writes");
    expect(prompt).toContain("bun relay inbox --as shaper --latest 20 --json");
    expect(prompt).toContain("bun relay channel <name> --latest 20 --json");
    expect(prompt).toContain('bun relay send --to <agent> --as shaper "your message"');
    expect(prompt).toContain('bun relay ask --to <agent> --as shaper "your request"');
    expect(prompt).toContain("Do not curl broker HTTP endpoints to read messages");
    expect(prompt).toContain("Default Scout loop: resolve identity, resolve one target, choose DM vs explicit channel, keep follow-up in that same venue");
    expect(prompt).toContain("Keep one-to-one handoffs in a DM");
    expect(prompt).toContain("If you need multiple agents, use separate DMs or an explicit channel");
    expect(prompt).toContain("Treat known offline / on-demand agents as wakeable");
    expect(prompt).toContain("Use send for tells and status; use ask when the meaning is 'do this and get back to me'");
    expect(prompt).toContain(scoutSkillPath);
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
        conversationId: "dm.operator.shaper",
        messageId: "msg-request-1",
        ensureAwake: true,
        stream: false,
        createdAt: 1,
      },
      "flt-1",
    );

    expect(prompt).toContain("Task: Find the session restore race.");
    expect(prompt).toContain('Context: {"file":"ShaperProvider.tsx"}');
    expect(prompt).toContain(`${scoutCli} latest --agent shaper --limit 20`);
    expect(prompt).toContain("Reply in the existing thread, not by addressing @hudson.");
    expect(prompt).toContain(`${scoutCli} send --as shaper --ref msg-request-1 "[ask:flt-1] <your response>"`);
    expect(prompt).not.toContain("@hudson <your response>");
  });

  test("wake nudge delivers direct messages without reply marker instructions", () => {
    const prompt = buildLocalAgentNudge(
      "shaper",
      {
        id: "inv-1",
        requesterId: "hudson",
        requesterNodeId: "node-1",
        targetAgentId: "shaper",
        action: "wake",
        task: "The branch is ready for review.",
        ensureAwake: true,
        stream: false,
        createdAt: 1,
      },
      "flt-1",
    );

    expect(prompt).toContain("New broker message from hudson.");
    expect(prompt).toContain("Message: The branch is ready for review.");
    expect(prompt).toContain("not a reply-required ask");
    expect(prompt).toContain(`${scoutCli} latest --agent shaper --limit 20`);
    expect(prompt).not.toContain("[ask:flt-1]");
    expect(prompt).not.toContain(`${scoutCli} send --as shaper`);
  });

  test("direct invocation prompt starts with a compact Scout title and collapses routing context", () => {
    const prompt = buildLocalAgentDirectInvocationPrompt(
      "ranger",
      {
        id: "inv-1",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "ranger",
        action: "consult",
        task: "Review how invocation prompt titles should read in Codex conversations.",
        conversationId: "dm.operator.ranger.main.mini",
        messageId: "msg-moi5w7kt-1hjg5e",
        execution: {
          session: "new",
        },
        ensureAwake: true,
        stream: false,
        createdAt: 1,
      },
    );

    expect(prompt.startsWith("⌖ @operator → @ranger · ask:1hjg5e › Review how invocation prompt titles should read in Codex conversations.\ndelivery: waking · session: fresh session\n\n")).toBe(true);
    expect(prompt.replace(/\n/g, "")).toContain("@operator → @ranger · ask:1hjg5e › Review how invocation prompt titles should read in Codex conversations.delivery: waking · session: fresh session");
    expect(prompt).toContain("<!-- SCOUT BROKER REPLY MODE -->");
    expect(prompt).toContain("<!-- SCOUT ARTIFACT GUIDANCE -->");
    expect(prompt).toContain("For long-form deliverables, prefer a durable file when you have write access");
    expect(prompt).toContain("Inline replies are still valid");
    expect(prompt).toContain("ScoutReplyContext:");
    expect(prompt).toContain("<summary>Scout routing context</summary>");
    expect(prompt).toContain("Do not publish a separate acknowledgement or progress update through Scout for this request.");
    expect(prompt).toContain("Do not call `messages_reply`, `scout_reply`, `scout send`, `messages_send`, or `invocations_ask` to answer this request.");
    expect(prompt).toContain('"mode": "broker_reply"');
    expect(prompt).toContain('"fromAgentId": "operator"');
    expect(prompt).toContain('"toAgentId": "ranger"');
    expect(prompt).toContain('"conversationId": "dm.operator.ranger.main.mini"');
    expect(prompt).toContain('"messageId": "msg-moi5w7kt-1hjg5e"');
    expect(prompt).toContain('"replyToMessageId": "msg-moi5w7kt-1hjg5e"');
    expect(prompt).toContain('"replyPath": "final_response"');
    expect(prompt).not.toContain("First, immediately publish a short broker-visible acknowledgement");
    expect(prompt).not.toContain("[scout] @operator asks @ranger");
    expect(prompt).not.toContain("meta: from=operator to=ranger action=consult");
    expect(prompt).not.toContain("ref: convo=dm.operator.ranger.main.mini msg=msg-moi5w7kt-1hjg5e");
    expect(prompt).not.toContain("OpenScout invocation for");
    expect(prompt).not.toContain("Requester:");
    expect(prompt).not.toContain("Action:");
  });

  test("direct invocation prompt skips fenced protocol blocks when summarizing title text", () => {
    const prompt = buildLocalAgentDirectInvocationPrompt(
      "ranger",
      {
        id: "inv-1",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "ranger",
        action: "execute",
        task: [
          "```",
          "OpenScout invocation for ranger.",
          "Requester: operator.",
          "```",
          "",
          "Improve the Scout invocation title format.",
        ].join("\n"),
        execution: {
          session: "new",
        },
        ensureAwake: true,
        stream: false,
        createdAt: 1,
      },
    );

    expect(prompt.startsWith("⌖ @operator → @ranger · task:inv-1 › Improve the Scout invocation title format.\ndelivery: waking · session: fresh session\n\n")).toBe(true);
    expect(prompt).toContain("<!-- SCOUT BROKER REPLY MODE -->");
    expect(prompt).not.toContain("meta: from=operator to=ranger action=execute");
  });

  test("direct invocation opener gives sidebar previews a visible payload boundary", () => {
    const prompt = buildLocalAgentDirectInvocationPrompt(
      "ranger",
      {
        id: "inv-1",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "ranger",
        action: "consult",
        task: "Hey — @arach asked me to verify whether the invocation preview title is coming from a stale Claude session before changing code. Then patch the runtime if needed.",
        conversationId: "dm.operator.ranger.main.mini",
        messageId: "msg-recent-t5if6t",
        execution: {
          session: "new",
        },
        ensureAwake: true,
        stream: false,
        createdAt: 1,
      },
    );

    expect(prompt.startsWith("⌖ @operator → @ranger · ask:t5if6t › Hey — @arach asked me to verify whether the invocation preview title is coming from a stale...\ndelivery: waking · session: fresh session\n\n")).toBe(true);
    expect(prompt).not.toContain("ask:t5if6t\n\nHey");
    expect(prompt).not.toContain("ask:t5if6tHey");
  });

  test("attached session invocation prompt uses the same Scout opener", () => {
    const prompt = buildAttachedSessionInvocationPrompt(
      {
        id: "inv-1",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "ranger",
        action: "status",
        task: "Check whether the broker reply landed.",
        conversationId: "dm.operator.ranger.main.mini",
        messageId: "msg-attached-abc123",
        execution: {
          session: "existing",
        },
        ensureAwake: true,
        stream: false,
        createdAt: 1,
      },
      "ranger",
    );

    expect(prompt.startsWith("⌖ @operator → @ranger · status:abc123 › Check whether the broker reply landed.\ndelivery: routed · session: continuing session\n\n")).toBe(true);
    expect(prompt).toContain("<!-- SCOUT BROKER REPLY MODE -->");
    expect(prompt).toContain('"conversationId": "dm.operator.ranger.main.mini"');
    expect(prompt).toContain('"replyToMessageId": "msg-attached-abc123"');
    expect(prompt).not.toContain("[scout] @operator checks @ranger");
    expect(prompt).not.toContain("meta: from=operator to=ranger action=status");
    expect(prompt).toContain("Treat this as a direct message to the current session, but return only the broker-visible reply for Scout delivery.");
    expect(prompt).not.toContain("Scout message from");
    expect(prompt).not.toContain("Requested action:");
  });

  test("tmux launch shell command quotes script paths with spaces", () => {
    expect(buildTmuxLaunchShellCommand("/Users/arach/Library/Application Support/OpenScout/runtime/agents/spectator/launch.sh"))
      .toBe('exec bash "/Users/arach/Library/Application Support/OpenScout/runtime/agents/spectator/launch.sh"');
  });

  test("tmux prompt submission leaves Claude Code insert mode before Enter", () => {
    expect(buildTmuxPromptSubmitKeys()).toEqual(["C-[", "Enter"]);
    expect(buildTmuxPromptSubmitKeys("pi")).toEqual(["Enter"]);
  });

  test("claude runtime launch args preapprove Scout MCP coordination tools", () => {
    const args = normalizeClaudeRuntimeLaunchArgs(["--model", "sonnet"]);

    expect(args).toEqual([
      "--model",
      "sonnet",
      "--allowedTools",
      DEFAULT_CLAUDE_SCOUT_ALLOWED_TOOLS.join(","),
    ]);
  });

  test("claude runtime launch args preserve explicit allowed tools", () => {
    const args = normalizeClaudeRuntimeLaunchArgs([
      "--allowedTools",
      "Read,Grep",
      "--model",
      "sonnet",
    ]);

    expect(args).toEqual([
      "--allowedTools",
      "Read,Grep",
      "--model",
      "sonnet",
    ]);
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
