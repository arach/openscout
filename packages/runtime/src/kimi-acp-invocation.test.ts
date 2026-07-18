import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { invokeKimiAcpAgent } from "./kimi-acp-invocation.js";

const originalKimiCliBin = process.env.KIMI_CLI_BIN;
const originalLog = process.env.OPENSCOUT_TEST_KIMI_LOG;
const tempDirs = new Set<string>();

afterEach(() => {
  if (originalKimiCliBin === undefined) delete process.env.KIMI_CLI_BIN;
  else process.env.KIMI_CLI_BIN = originalKimiCliBin;
  if (originalLog === undefined) delete process.env.OPENSCOUT_TEST_KIMI_LOG;
  else process.env.OPENSCOUT_TEST_KIMI_LOG = originalLog;
  for (const directory of tempDirs) rmSync(directory, { recursive: true, force: true });
  tempDirs.clear();
});

describe("invokeKimiAcpAgent", () => {
  test("runs a Kimi ACP turn and closes the subprocess session", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openscout-kimi-acp-"));
    tempDirs.add(directory);
    const logPath = join(directory, "kimi.log");
    const kimiPath = join(directory, "kimi");
    writeFileSync(kimiPath, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const logPath = process.env.OPENSCOUT_TEST_KIMI_LOG;
appendFileSync(logPath, \`argv:\${process.argv.slice(2).join(" ")}\\n\`);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const message = JSON.parse(line);
  const { id, method } = message;
  const params = message.params ?? {};
  appendFileSync(logPath, method + "\\n");
  if (method === "initialize") {
    console.log(JSON.stringify({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { promptCapabilities: { image: true }, sessionCapabilities: { close: {} }, loadSession: true },
        agentInfo: { name: "Kimi Code CLI", version: "test" },
        authMethods: [{ id: "login" }]
      }
    }));
  } else if (method === "authenticate") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result: {} }));
  } else if (method === "session/new") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { sessionId: "fake-kimi-session" } }));
  } else if (method === "session/prompt") {
    console.log(JSON.stringify({
      jsonrpc: "2.0", method: "session/update",
      params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "kimi-acp-ok" } } }
    }));
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } }));
  } else if (method === "session/close") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result: {} }));
  }
}
`, "utf8");
    chmodSync(kimiPath, 0o755);
    process.env.KIMI_CLI_BIN = kimiPath;
    process.env.OPENSCOUT_TEST_KIMI_LOG = logPath;

    const result = await invokeKimiAcpAgent({
      sessionId: "kimi-runtime-test",
      cwd: directory,
      prompt: "reply",
      timeoutMs: 2_000,
    });

    expect(result.output).toContain("kimi-acp-ok");
    expect(result.sessionId).toBe("kimi-runtime-test");
    expect(result.metadata).toMatchObject({ adapterType: "kimi-acp" });
    expect(readFileSync(logPath, "utf8")).toContain("argv:acp");
    expect(readFileSync(logPath, "utf8")).toContain("session/close");
  });
});
