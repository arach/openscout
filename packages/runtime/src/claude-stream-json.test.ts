import { describe, expect, test } from "bun:test";

import { resolveClaudeStreamJsonOutput } from "./claude-stream-json";

describe("resolveClaudeStreamJsonOutput", () => {
  test("prefers the final result payload over earlier assistant text", () => {
    const output = resolveClaudeStreamJsonOutput(
      "Final answer",
      ["Let me research this.", " Interim note."],
    );

    expect(output).toBe("Final answer");
  });

  test("falls back to accumulated assistant text when the result payload is empty", () => {
    const output = resolveClaudeStreamJsonOutput(
      "   ",
      ["First part.", " Second part."],
    );

    expect(output).toBe("First part. Second part.");
  });
});
