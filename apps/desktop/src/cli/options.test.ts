import { describe, expect, test } from "bun:test";

import {
  parseAskCommandOptions,
  parseCardCreateCommandOptions,
  parseImplicitAskCommandOptions,
  parseSendCommandOptions,
} from "./options.ts";

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
      ["--as", "vox", "--timeout", "900", "--context-root", "/tmp/repo", "@talkie", "take", "another", "pass"],
      "/tmp/workspace",
    );

    expect(options.agentName).toBe("vox");
    expect(options.timeoutSeconds).toBe(900);
    expect(options.targetLabel).toBe("talkie");
    expect(options.message).toBe("take another pass");
    expect(options.currentDirectory).toBe("/tmp/repo");
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
      )).toThrow("implicit ask requires an @agent mention");
  });

  test("rejects natural language input with multiple mentions", () => {
    expect(() =>
      parseImplicitAskCommandOptions(
        ["@dewey", "check", "with", "@hudson", "about", "this"],
        "/tmp/workspace",
      )).toThrow("implicit ask supports exactly one @agent mention");
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
