import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { completeLocalAgentTurn, createLocalAgentClient } from "./local/index";

function readFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...readFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

describe("agent-sessions local embed API", () => {
  test("exports the local turn entry points", () => {
    expect(typeof completeLocalAgentTurn).toBe("function");
    expect(typeof createLocalAgentClient).toBe("function");
  });

  test("rejects unsupported harness and transport pairings before launch", async () => {
    await expect(completeLocalAgentTurn({
      harness: "pi",
      transport: "grok_acp",
      cwd: process.cwd(),
      input: "hello",
    })).rejects.toThrow("does not support transport grok_acp");
  });

  test("keeps broker-shaped terms out of the local subpath", () => {
    const localDirectory = join(import.meta.dir, "local");
    const source = readFiles(localDirectory)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const forbidden of [
      "conversation" + "Id",
      "flight" + "Id",
      "Scout" + "Reply" + "Context",
      "@openscout/" + "runtime",
      "cards",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
