import { describe, expect, test } from "bun:test";

import {
  parseCardCreateCommandOptions,
  parseImplicitAskCommandOptions,
} from "./options.ts";

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
      ["--name", "shellfix", "--harness", "codex", "--model", "gpt-5.4-mini", "/tmp/worktree"],
      "/tmp/workspace",
    );

    expect(options.agentName).toBe("shellfix");
    expect(options.harness).toBe("codex");
    expect(options.model).toBe("gpt-5.4-mini");
    expect(options.projectPath).toBe("/tmp/worktree");
  });
});
