import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEndpoint, InvocationRequest } from "@openscout/protocol";

import {
  invokeLocalAgentEndpoint,
  getLocalAgentEndpointSessionSnapshot,
  shutdownLocalSessionEndpoint,
} from "./local-agents";
import {
  isAcpStdioCommandAvailable,
  parseAcpStdioLaunchArgs,
} from "./acp-stdio";

const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalAcpCommand = process.env.OPENSCOUT_ACP_COMMAND;
const originalPath = process.env.PATH;
const tempPaths = new Set<string>();

afterEach(() => {
  if (originalSupportDirectory === undefined) {
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  } else {
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  }
  if (originalAcpCommand === undefined) {
    delete process.env.OPENSCOUT_ACP_COMMAND;
  } else {
    process.env.OPENSCOUT_ACP_COMMAND = originalAcpCommand;
  }
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  for (const path of tempPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  tempPaths.clear();
});

function writeFakeAcpExecutable(baseDirectory: string, methodLogPath: string): string {
  const executablePath = join(baseDirectory, `fake-acp-${crypto.randomUUID()}`);
  writeFileSync(executablePath, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const methodLogPath = ${JSON.stringify(methodLogPath)};

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const message = JSON.parse(trimmed);
  const id = message.id;
  const method = message.method;
  const params = message.params ?? {};

  if (method) {
    appendFileSync(methodLogPath, method + "\\n");
  }

  if (method === "initialize") {
    console.log(JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { close: {} } },
        agentInfo: { name: "fake-acp-runtime", title: "Fake ACP Runtime", version: "1.0.0" },
        authMethods: []
      }
    }));
    continue;
  }

  if (method === "session/new") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { sessionId: "acp-session-runtime" } }));
    continue;
  }

  if (method === "session/prompt") {
    appendFileSync(methodLogPath, "prompt:" + (params.prompt?.[0]?.text ?? "") + "\\n");
    console.log(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello from acp runtime" }
        }
      }
    }));
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } }));
    continue;
  }

  if (method === "session/close") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result: {} }));
    continue;
  }
}
`, "utf8");
  chmodSync(executablePath, 0o755);
  return executablePath;
}

function fakeEndpoint(input: { cwd: string; executable: string }): AgentEndpoint {
  return {
    id: "endpoint.fake-acp.local.acp_stdio",
    agentId: "fake-acp",
    nodeId: "local",
    harness: "claude",
    transport: "acp_stdio",
    state: "waiting",
    cwd: input.cwd,
    projectRoot: input.cwd,
    sessionId: "relay-fake-acp",
    metadata: {
      agentName: "fake-acp",
      runtimeInstanceId: "relay-fake-acp",
      source: "local-session",
      sessionBacked: true,
      systemPrompt: "ACP system prompt",
      launchArgs: [
        "--command",
        input.executable,
        "--startup-timeout-ms",
        "2000",
        "--request-timeout-ms",
        "2000",
        "--prompt-timeout-ms",
        "2000",
      ],
    },
  };
}

function fakeInvocation(): InvocationRequest {
  return {
    id: "inv-acp-runtime",
    requesterId: "codex",
    requesterNodeId: "local",
    targetAgentId: "fake-acp",
    action: "consult",
    task: "Say hi from the runtime test.",
    ensureAwake: true,
    stream: false,
    timeoutMs: 5_000,
    createdAt: Date.now(),
  };
}

describe("ACP stdio local-agent runtime", () => {
  test("parses command and adapter options from launch args", () => {
    expect(parseAcpStdioLaunchArgs([
      "--command=fake-acp",
      "--arg",
      "--stdio",
      "--session-mode",
      "new",
      "--additional-directory",
      "/tmp/workspace",
      "--no-read-text-file",
      "--write-text-file",
    ])).toMatchObject({
      command: "fake-acp",
      args: ["--stdio"],
      sessionMode: "new",
      additionalDirectories: ["/tmp/workspace"],
      readTextFile: false,
      writeTextFile: true,
    });
  });

  test("detects explicit ACP commands even when PATH is empty", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-acp-command-"));
    tempPaths.add(tempRoot);
    const executable = writeFakeAcpExecutable(tempRoot, join(tempRoot, "methods.log"));
    process.env.PATH = "";

    expect(isAcpStdioCommandAvailable(["--command", executable])).toBe(true);
  });

  test("warms, invokes, snapshots, and shuts down a fake ACP endpoint", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-acp-runtime-"));
    tempPaths.add(tempRoot);
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(tempRoot, "support");
    const methodLogPath = join(tempRoot, "methods.log");
    const executable = writeFakeAcpExecutable(tempRoot, methodLogPath);
    const endpoint = fakeEndpoint({ cwd: tempRoot, executable });

    try {
      const result = await invokeLocalAgentEndpoint(endpoint, fakeInvocation());
      const snapshot = await getLocalAgentEndpointSessionSnapshot(endpoint);
      const methodLog = readFileSync(methodLogPath, "utf8");

      expect(result.output).toBe("hello from acp runtime");
      expect(result.externalSessionId).toBe("acp-session-runtime");
      expect(result.metadata).toMatchObject({
        transport: "acp_stdio",
        acp: {
          acpSessionId: "acp-session-runtime",
        },
      });
      expect(snapshot?.session.adapterType).toBe("acp");
      expect(snapshot?.session.providerMeta?.acp).toMatchObject({
        acpSessionId: "acp-session-runtime",
      });
      expect(methodLog).toContain("initialize\nsession/new\nsession/prompt\n");
      expect(methodLog).toContain("ACP system prompt");
      expect(methodLog).toContain("Say hi from the runtime test.");
    } finally {
      await shutdownLocalSessionEndpoint(endpoint);
    }
  });
});
