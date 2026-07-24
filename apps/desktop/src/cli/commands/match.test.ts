import { describe, expect, test } from "bun:test";

import {
  parseMatchCommandOptions,
  renderMatchCommandHelp,
} from "./match.js";

describe("scout match options", () => {
  test("parses topic and structured routing context", () => {
    expect(parseMatchCommandOptions([
      "--as",
      "agent.one",
      "--project=../talkie",
      "--wait",
      "2.5",
      "review",
      "the parser",
    ])).toEqual({
      agentName: "agent.one",
      projectPath: "../talkie",
      topic: "review the parser",
      waitMs: 2_500,
    });
  });

  test("supports a non-blocking poll and rejects excessive waits", () => {
    expect(parseMatchCommandOptions(["--wait=0", "handoff"]).waitMs).toBe(0);
    expect(() => parseMatchCommandOptions(["--wait=31", "handoff"])).toThrow(
      "between 0 and 30 seconds",
    );
  });

  test("documents ephemeral pair-only behavior", () => {
    const help = renderMatchCommandHelp();
    expect(help).toContain("scout match");
    expect(help).toContain("not a channel");
    expect(help).toContain("third participant");
  });
});
