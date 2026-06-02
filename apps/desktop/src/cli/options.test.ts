import { describe, expect, test } from "bun:test";

import {
  parseAskCommandOptions,
  parseCardCreateCommandOptions,
  parseChannelCommandOptions,
  parseInboxCommandOptions,
  parseImplicitAskCommandOptions,
  parseLatestCommandOptions,
  parseSendCommandOptions,
  parseWhoCommandOptions,
  parseWatchCommandOptions,
} from "./options.ts";

describe("parseWhoCommandOptions", () => {
  test("accepts a project path filter relative to the context root", () => {
    const options = parseWhoCommandOptions(
      ["--context-root", "/tmp/workspace", "--project", "../talkie"],
      "/tmp/default",
    );

    expect(options.currentDirectory).toBe("/tmp/workspace");
    expect(options.projectPath).toBe("/tmp/talkie");
  });
});

describe("parseSendCommandOptions", () => {
  test("accepts a message file as the primary body source", () => {
    const options = parseSendCommandOptions(
      ["--context-root", "/tmp/repo", "--message-file", "status.md"],
      "/tmp/workspace",
    );

    expect(options.message).toBe("");
    expect(options.messageFile).toBe("/tmp/repo/status.md");
    expect(options.currentDirectory).toBe("/tmp/repo");
  });

  test("accepts an explicit target without consuming body mentions", () => {
    const options = parseSendCommandOptions(
      ["--to", "hudson", "literal", "@codex", "stays", "text"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("hudson");
    expect(options.message).toBe("literal @codex stays text");
  });

  test("accepts a binding ref target", () => {
    const options = parseSendCommandOptions(
      ["--ref", "7f3a9c21", "follow", "up"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("ref:7f3a9c21");
    expect(options.targetRef).toBe("7f3a9c21");
    expect(options.message).toBe("follow up");
  });

  test("accepts a composer route target", () => {
    const options = parseSendCommandOptions(
      [">>", "hudson", "status", "is", "green"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("hudson");
    expect(options.message).toBe("status is green");
  });

  test("accepts a composer route channel", () => {
    const options = parseSendCommandOptions(
      [">>", "channel:ops", "status", "is", "green"],
      "/tmp/workspace",
    );

    expect(options.channel).toBe("ops");
    expect(options.message).toBe("status is green");
  });

  test("accepts a wake flag for non-blocking visible turns", () => {
    const options = parseSendCommandOptions(
      ["--to", "hudson", "--wake", "please", "continue"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("hudson");
    expect(options.wake).toBe(true);
    expect(options.message).toBe("please continue");
  });

  test("rejects mixing inline messages with a message file", () => {
    expect(() =>
      parseSendCommandOptions(
        ["--message-file", "status.md", "@hudson", "ready"],
        "/tmp/workspace",
      )).toThrow("provide either an inline message or --message-file/--body-file");
  });
});

describe("parseAskCommandOptions", () => {
  test("accepts a prompt file as the primary body source", () => {
    const options = parseAskCommandOptions(
      ["--to", "hudson", "--prompt-file=handoff.md"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("hudson");
    expect(options.message).toBe("");
    expect(options.promptFile).toBe("/tmp/workspace/handoff.md");
  });

  test("accepts --body-file as a prompt file alias", () => {
    const options = parseAskCommandOptions(
      ["--to", "hudson", "--body-file", "/tmp/handoff.md"],
      "/tmp/workspace",
    );

    expect(options.promptFile).toBe("/tmp/handoff.md");
  });

  test("accepts a binding ref target", () => {
    const options = parseAskCommandOptions(
      ["--ref=7f3a9c21", "continue"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("ref:7f3a9c21");
    expect(options.targetRef).toBe("7f3a9c21");
    expect(options.message).toBe("continue");
  });

  test("accepts a composer route target", () => {
    const options = parseAskCommandOptions(
      [">>", "hudson", "review", "the", "parser"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("hudson");
    expect(options.message).toBe("review the parser");
  });

  test("accepts an explicit project path target", () => {
    const options = parseAskCommandOptions(
      ["--project", "../talkie", "compare", "auth"],
      "/tmp/workspace",
    );

    expect(options.projectPath).toBe("/tmp/talkie");
    expect(options.targetLabel).toBeUndefined();
    expect(options.message).toBe("compare auth");
  });

  test("accepts a composer project path target", () => {
    const options = parseAskCommandOptions(
      [">>", "project:../talkie", "compare", "auth"],
      "/tmp/workspace",
    );

    expect(options.projectPath).toBe("/tmp/talkie");
    expect(options.targetLabel).toBeUndefined();
    expect(options.message).toBe("compare auth");
  });

  test("rejects mixing agent and project path targets", () => {
    expect(() =>
      parseAskCommandOptions(
        ["--to", "hudson", "--project", "../talkie", "review"],
        "/tmp/workspace",
      )).toThrow("provide either --to/--ref or --project, not both");
  });

  test("accepts repeated labels", () => {
    const options = parseAskCommandOptions(
      ["--to", "hudson", "--label", "release:0.2.66", "--labels=goal:hook,release:0.2.66", "review"],
      "/tmp/workspace",
    );

    expect(options.labels).toEqual(["release:0.2.66", "goal:hook"]);
  });

  test("rejects mixing inline questions with a prompt file", () => {
    expect(() =>
      parseAskCommandOptions(
        ["--to", "hudson", "--prompt-file", "handoff.md", "review", "this"],
        "/tmp/workspace",
      )).toThrow("provide either an inline question or --prompt-file/--body-file");
  });
});

describe("parseImplicitAskCommandOptions", () => {
  test("extracts a target agent from natural language input", () => {
    const options = parseImplicitAskCommandOptions(
      ["hey", "@dewey", "can", "you", "review", "our", "docs?"],
      "/tmp/workspace",
    );

    expect(options.agentName).toBeNull();
    expect(options.targetLabel).toBe("dewey");
    expect(options.message).toBe("hey can you review our docs?");
    expect(options.currentDirectory).toBe("/tmp/workspace");
  });

  test("extracts shorthand harness and model target labels", () => {
    const options = parseImplicitAskCommandOptions(
      ["hey", "@lattices#codex?5.5", "can", "you", "review", "this?"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("lattices#codex?5.5");
    expect(options.message).toBe("hey can you review this?");
  });

  test("parses ask flags before the freeform request", () => {
    const options = parseImplicitAskCommandOptions(
      ["--as", "vox", "--timeout", "900", "--label", "goal:ios-shell", "--context-root", "/tmp/repo", "@talkie", "take", "another", "pass"],
      "/tmp/workspace",
    );

    expect(options.agentName).toBe("vox");
    expect(options.timeoutSeconds).toBe(900);
    expect(options.labels).toEqual(["goal:ios-shell"]);
    expect(options.targetLabel).toBe("talkie");
    expect(options.message).toBe("take another pass");
    expect(options.currentDirectory).toBe("/tmp/repo");
  });

  test("parses non-blocking ask reply modes", () => {
    const notify = parseImplicitAskCommandOptions(
      ["--notify", "@talkie", "take", "another", "pass"],
      "/tmp/workspace",
    );
    const noWait = parseImplicitAskCommandOptions(
      ["--no-wait", "@talkie", "start", "the", "longer", "run"],
      "/tmp/workspace",
    );

    expect(notify.replyMode).toBe("notify");
    expect(noWait.replyMode).toBe("none");
  });

  test("extracts a target agent from the composer route operator", () => {
    const options = parseImplicitAskCommandOptions(
      ["hey", ">>", "dewey", "can", "you", "review", "our", "docs?"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("dewey");
    expect(options.message).toBe("hey can you review our docs?");
  });

  test("accepts a prompt file with only a composer route target", () => {
    const options = parseImplicitAskCommandOptions(
      [">>", "talkie", "--prompt-file", "handoff.md"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("talkie");
    expect(options.message).toBe("");
    expect(options.promptFile).toBe("/tmp/workspace/handoff.md");
  });

  test("accepts a prompt file with only an @agent mention", () => {
    const options = parseImplicitAskCommandOptions(
      ["@talkie", "--prompt-file", "handoff.md"],
      "/tmp/workspace",
    );

    expect(options.targetLabel).toBe("talkie");
    expect(options.message).toBe("");
    expect(options.promptFile).toBe("/tmp/workspace/handoff.md");
  });

  test("rejects natural language input without a mention", () => {
    expect(() =>
      parseImplicitAskCommandOptions(
        ["please", "review", "the", "docs"],
        "/tmp/workspace",
      )).toThrow("implicit ask requires >> target or an @agent mention");
  });

  test("rejects natural language input with multiple mentions", () => {
    expect(() =>
      parseImplicitAskCommandOptions(
        ["@dewey", "check", "with", "@hudson", "about", "this"],
        "/tmp/workspace",
      )).toThrow("implicit ask supports exactly one @agent mention");
  });
});

describe("parseLatestCommandOptions", () => {
  test("accepts a channel filter and message mode", () => {
    const options = parseLatestCommandOptions(
      ["--channel", "homepage-polish", "--messages", "--limit", "1"],
      "/tmp/workspace",
    );

    expect(options.channel).toBe("homepage-polish");
    expect(options.messages).toBe(true);
    expect(options.limit).toBe(1);
  });

  test("rejects channel and conversation together", () => {
    expect(() =>
      parseLatestCommandOptions(
        ["--channel", "ops", "--conversation", "channel.ops"],
        "/tmp/workspace",
      )).toThrow("provide either --channel or --conversation, not both");
  });
});

describe("parseWatchCommandOptions", () => {
  test("accepts channel backlog flags", () => {
    const before = Date.now();
    const options = parseWatchCommandOptions(
      ["--channel", "homepage-polish", "--since", "1h", "--limit", "20", "--once"],
      "/tmp/workspace",
    );

    expect(options.channel).toBe("homepage-polish");
    expect(options.limit).toBe(20);
    expect(options.once).toBe(true);
    expect(options.since ?? 0).toBeGreaterThanOrEqual(before - 3_600_000 - 1_000);
    expect(options.since ?? 0).toBeLessThanOrEqual(Date.now() - 3_600_000 + 1_000);
  });

  test("accepts conversation backlog flags", () => {
    const options = parseWatchCommandOptions(
      ["--conversation", "dm.operator.hudson", "--since", "1700000000", "--limit", "20", "--once"],
      "/tmp/workspace",
    );

    expect(options.conversationId).toBe("dm.operator.hudson");
    expect(options.limit).toBe(20);
    expect(options.once).toBe(true);
    expect(options.since).toBe(1_700_000_000_000);
  });

  test("rejects channel and conversation together", () => {
    expect(() =>
      parseWatchCommandOptions(
        ["--channel", "ops", "--conversation", "dm.operator.hudson"],
        "/tmp/workspace",
      )).toThrow("provide either --channel or --conversation, not both");
  });
});

describe("parseInboxCommandOptions", () => {
  test("accepts inferred identity inbox flags", () => {
    const before = Date.now();
    const options = parseInboxCommandOptions(
      ["--latest", "5", "--since", "30m"],
      "/tmp/workspace",
    );

    expect(options.agentName).toBeNull();
    expect(options.latest).toBe(5);
    expect(options.since ?? 0).toBeGreaterThanOrEqual(before - 1_800_000 - 1_000);
    expect(options.since ?? 0).toBeLessThanOrEqual(Date.now() - 1_800_000 + 1_000);
  });

  test("accepts an explicit inbox identity", () => {
    const options = parseInboxCommandOptions(
      ["--as", "hudson-site.main.mini", "--limit", "3"],
      "/tmp/workspace",
    );

    expect(options.agentName).toBe("hudson-site.main.mini");
    expect(options.latest).toBe(3);
  });
});

describe("parseChannelCommandOptions", () => {
  test("accepts latest messages for the default channel", () => {
    const options = parseChannelCommandOptions(
      ["--latest", "10"],
      "/tmp/workspace",
    );

    expect(options.latest).toBe(10);
    expect(options.channel).toBeUndefined();
    expect(options.markRead).toBe(false);
  });

  test("accepts a positional channel for latest messages", () => {
    const options = parseChannelCommandOptions(
      ["homepage-polish", "--latest=3"],
      "/tmp/workspace",
    );

    expect(options.channel).toBe("homepage-polish");
    expect(options.latest).toBe(3);
    expect(options.markRead).toBe(false);
  });

  test("accepts a positional channel for mark-read mode", () => {
    const options = parseChannelCommandOptions(
      ["triage", "--mark-read"],
      "/tmp/workspace",
    );

    expect(options.channel).toBe("triage");
    expect(options.latest).toBeUndefined();
    expect(options.markRead).toBe(true);
  });

  test("accepts clear as a mark-read alias", () => {
    const options = parseChannelCommandOptions(
      ["shared", "--clear"],
      "/tmp/workspace",
    );

    expect(options.channel).toBe("shared");
    expect(options.markRead).toBe(true);
  });

  test("rejects latest and mark-read together", () => {
    expect(() =>
      parseChannelCommandOptions(
        ["triage", "--latest=3", "--mark-read"],
        "/tmp/workspace",
      )).toThrow("provide either --latest or --mark-read, not both");
  });

  test("rejects a channel name without latest mode", () => {
    expect(() =>
      parseChannelCommandOptions(
        ["homepage-polish"],
        "/tmp/workspace",
      )).toThrow("channel name is only valid with --latest or --mark-read");
  });
});

describe("parseCardCreateCommandOptions", () => {
  test("accepts an explicit model override", () => {
    const options = parseCardCreateCommandOptions(
      ["--name", "shellfix", "--harness", "codex", "--model", "gpt-5.4-mini", "--reasoning-effort", "xhigh", "/tmp/worktree"],
      "/tmp/workspace",
    );

    expect(options.agentName).toBe("shellfix");
    expect(options.harness).toBe("codex");
    expect(options.model).toBe("gpt-5.4-mini");
    expect(options.reasoningEffort).toBe("xhigh");
    expect(options.projectPath).toBe("/tmp/worktree");
  });
});
