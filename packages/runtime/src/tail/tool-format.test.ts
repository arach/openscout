import { describe, expect, test } from "bun:test";

import { formatToolCall, parseMaybeJson, summarizeToolResult } from "./tool-format.js";

describe("formatToolCall", () => {
  test("shows the bare command for shell/exec tools, dropping noise fields", () => {
    const summary = formatToolCall(
      "exec_command",
      JSON.stringify({
        cmd: "sed -n '1,180p' design/studio/components/studies/PhoneFrame.tsx",
        workdir: "/Users/arach/dev/talkie",
        yield_time_ms: 10000,
        max_output_tokens: 2048,
      }),
    );
    expect(summary).toBe("sed -n '1,180p' design/studio/components/studies/PhoneFrame.tsx");
  });

  test("Claude Bash → bare command", () => {
    expect(formatToolCall("Bash", { command: "./node_modules/.bin/tsc --noEmit", description: "typecheck" }))
      .toBe("./node_modules/.bin/tsc --noEmit");
  });

  test("file tools show the last two path segments, folding $HOME", () => {
    expect(formatToolCall("Read", { file_path: "/Users/arach/dev/openscout/design/studio/views/scout-tail.tsx" }))
      .toBe("Read views/scout-tail.tsx");
    expect(formatToolCall("Edit", { file_path: "/Users/arach/dev/openscout/packages/web/server/core/broker/service.ts" }))
      .toBe("Edit broker/service.ts");
  });

  test("search tools prefer the pattern over an incidental path", () => {
    expect(formatToolCall("Grep", { pattern: "data-scout-skin", path: "design/studio" }))
      .toBe("Grep data-scout-skin");
  });

  test("falls back to a description/first scalar, never an empty tool", () => {
    expect(formatToolCall("Task", { description: "explore the codebase", prompt: "..." }))
      .toBe("Task explore the codebase");
    expect(formatToolCall("Mystery", { count: 3 })).toBe("Mystery 3");
    expect(formatToolCall("Bare", {})).toBe("Bare");
  });
});

describe("summarizeToolResult", () => {
  test("multi-line output collapses to a line count", () => {
    expect(summarizeToolResult("1\tuse client\n2\timport x\n3\timport y\n4\texport default"))
      .toBe("4 lines");
  });

  test("short single-line output is shown verbatim", () => {
    expect(summarizeToolResult("0 errors")).toBe("0 errors");
  });

  test("empty output reads as done", () => {
    expect(summarizeToolResult("")).toBe("done");
  });

  test("Codex output blob: pulls .output, then summarizes", () => {
    const output = parseMaybeJson(JSON.stringify({ output: "warn deprecated\nbuilt in 4.2s\n", metadata: { exit_code: 0 } }));
    expect(summarizeToolResult(output)).toBe("2 lines");
  });
});
