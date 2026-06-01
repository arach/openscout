import { describe, expect, test } from "bun:test";

import { createScoutCommandContext } from "../context.ts";
import {
  parseTailCommandOptions,
  renderTailCommandHelp,
  runTailCommand,
} from "./tail.ts";

describe("tail command", () => {
  test("documents broker tail filters", () => {
    const help = renderTailCommandHelp();

    expect(help).toContain("Usage: scout tail");
    expect(help).toContain("--source <name>");
    expect(help).toContain("--kind <kind>");
    expect(help).toContain("--session <id>");
    expect(help).toContain("--transcripts");
  });

  test("parses filters and one-shot mode", () => {
    expect(parseTailCommandOptions([
      "--source",
      "codex,claude",
      "--kind",
      "tool-result",
      "--session",
      "sess-1",
      "--query",
      "permission",
      "--limit",
      "25",
      "--once",
      "--raw",
    ])).toEqual({
      limit: 25,
      sources: ["codex", "claude"],
      kinds: ["tool-result"],
      sessionId: "sess-1",
      query: "permission",
      once: true,
      transcripts: false,
      raw: true,
    });
  });

  test("rejects unknown kinds", () => {
    expect(() => parseTailCommandOptions(["--kind", "nope"]))
      .toThrow("unknown tail kind");
  });

  test("prints help before broker access", async () => {
    const lines: string[] = [];
    const context = createScoutCommandContext({
      cwd: "/tmp/openscout-test",
      env: {},
      stdout: (line) => lines.push(line),
      stderr: () => undefined,
      isTty: false,
    });

    await runTailCommand(context, ["-h"]);

    expect(lines.join("\n")).toContain("Usage: scout tail");
  });
});
