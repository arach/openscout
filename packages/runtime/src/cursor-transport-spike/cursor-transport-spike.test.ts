import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseCursorCliStreamJsonOutput, runCursorCliTransportSpike } from "./cli-transport.ts";

const tempPaths = new Set<string>();

afterEach(() => {
  for (const tempPath of tempPaths) {
    rmSync(tempPath, { recursive: true, force: true });
  }
  tempPaths.clear();
});

describe("parseCursorCliStreamJsonOutput", () => {
  test("extracts final result text and session id from cursor-agent stream-json", () => {
    const raw = [
      "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"chat-1\"}",
      "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"SPI\"}]}}",
      "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"KE_OK\"}]}}",
      "{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"SPIKE_OK\",\"session_id\":\"chat-1\"}",
    ].join("\n");

    const parsed = parseCursorCliStreamJsonOutput(raw);
    expect(parsed.outputText).toBe("SPIKE_OK");
    expect(parsed.sessionId).toBe("chat-1");
    expect(parsed.eventCount).toBe(4);
  });

  test("runs cursor-agent stream-json through a configured executable", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-cursor-cli-"));
    tempPaths.add(tempRoot);
    const executablePath = join(tempRoot, "cursor-agent");
    writeFileSync(
      executablePath,
      [
        "#!/bin/sh",
        "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"chat-fake\"}'",
        "printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"CURSOR_\"}]}}'",
        "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"CURSOR_OK\",\"session_id\":\"chat-fake\"}'",
      ].join("\n") + "\n",
      "utf8",
    );
    chmodSync(executablePath, 0o755);

    const result = await runCursorCliTransportSpike({
      mode: "cursor_cli_stream_json",
      cwd: tempRoot,
      prompt: "Say CURSOR_OK.",
      authSource: "none",
      env: {
        ...process.env,
        OPENSCOUT_CURSOR_AGENT_BIN: executablePath,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.outputText).toBe("CURSOR_OK");
    expect(result.sessionId).toBe("chat-fake");
    expect(result.eventCount).toBe(3);
  });
});
