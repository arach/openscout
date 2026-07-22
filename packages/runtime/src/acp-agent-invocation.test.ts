import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAcpAdapter } from "@openscout/agent-sessions";

import { invokeAcpAgent } from "./acp-agent-invocation.js";

const tempPaths = new Set<string>();

afterEach(() => {
  for (const path of tempPaths) rmSync(path, { recursive: true, force: true });
  tempPaths.clear();
});

test("returns the provider ACP session id and loads it on a follow-up invocation", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "openscout-acp-continuity-"));
  tempPaths.add(tempRoot);
  const executable = join(tempRoot, "fake-acp");
  const logPath = join(tempRoot, "methods.log");
  writeFileSync(executable, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import readline from "node:readline";
const log = process.env.METHOD_LOG;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const message = JSON.parse(line);
  const params = message.params ?? {};
  if (message.method) appendFileSync(log, message.method + ":" + (params.sessionId ?? "") + "\\n");
  if (message.method === "initialize") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } }));
  } else if (message.method === "session/new") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: process.env.NEW_SESSION_ID ?? "provider-session-42" } }));
  } else if (message.method === "session/load") {
    console.log(JSON.stringify(process.env.FAIL_LOAD === "1"
      ? { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "session not found" } }
      : { jsonrpc: "2.0", id: message.id, result: {} }));
  } else if (message.method === "session/prompt") {
    console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } } }));
    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } }));
  }
}
`, "utf8");
  chmodSync(executable, 0o755);

  const common = {
    adapterType: "acp",
    createAdapter: createAcpAdapter,
    label: "ACP test",
    sessionId: "scout-session",
    cwd: tempRoot,
    prompt: "hello",
    adapterOptions: {
      command: executable,
      args: [],
      env: { METHOD_LOG: logPath },
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    },
  };
  const originalEnv = process.env.METHOD_LOG;
  process.env.METHOD_LOG = logPath;
  try {
    const first = await invokeAcpAgent(common);
    expect(first.sessionId).toBe("scout-session");
    expect(first.externalSessionId).toBe("provider-session-42");

    const second = await invokeAcpAgent({ ...common, externalSessionId: first.externalSessionId });
    expect(second.externalSessionId).toBe("provider-session-42");

    process.env.FAIL_LOAD = "1";
    process.env.NEW_SESSION_ID = "provider-session-43";
    const recovered = await invokeAcpAgent({ ...common, externalSessionId: first.externalSessionId });
    expect(recovered.externalSessionId).toBe("provider-session-43");
    expect(recovered.metadata?.providerMeta).toMatchObject({
      acp: {
        sessionRecovery: {
          requestedSessionId: "provider-session-42",
          outcome: "new_session",
        },
      },
    });
  } finally {
    delete process.env.FAIL_LOAD;
    delete process.env.NEW_SESSION_ID;
    if (originalEnv === undefined) delete process.env.METHOD_LOG;
    else process.env.METHOD_LOG = originalEnv;
  }

  expect(readFileSync(logPath, "utf8")).toContain("session/load:provider-session-42");
});
