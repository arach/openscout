import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentDefinition, AgentEndpoint, InvocationRequest } from "@openscout/protocol";

import { runLocalCodexInvocation } from "./local-agent-executor.js";

let tempDirectory: string;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "openscout-local-agent-test-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

function makeAgent(): AgentDefinition {
  return {
    id: "agent-local-codex-test",
    kind: "agent",
    definitionId: "agent-local-codex-test",
    displayName: "Local Codex Test",
    agentClass: "operator",
    capabilities: ["invoke"],
    wakePolicy: "manual",
    homeNodeId: "node-local",
    authorityNodeId: "node-local",
    advertiseScope: "local",
  };
}

function makeEndpoint(commandPath: string): AgentEndpoint {
  return {
    id: "endpoint-local-codex-test",
    agentId: "agent-local-codex-test",
    nodeId: "node-local",
    harness: "codex",
    transport: "codex_exec",
    state: "online",
    cwd: tempDirectory,
    metadata: {
      commandPath,
    },
  };
}

function makeInvocation(): InvocationRequest {
  return {
    id: "invocation-local-codex-test",
    requesterId: "operator",
    requesterNodeId: "node-local",
    targetAgentId: "agent-local-codex-test",
    action: "consult",
    task: "Say hello.",
    ensureAwake: true,
    stream: false,
    timeoutMs: 5_000,
    createdAt: Date.now(),
  };
}

test("runLocalCodexInvocation uses endpoint commandPath as the Codex executable override", async () => {
  const fakeCodexPath = join(tempDirectory, "fake-codex");
  const markerPath = join(tempDirectory, "fake-codex-marker.txt");
  await writeFile(
    fakeCodexPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' \"$0\" > ${JSON.stringify(markerPath)}`,
      "while [ \"$#\" -gt 0 ]; do",
      "  if [ \"$1\" = \"--output-last-message\" ]; then",
      "    shift",
      "    printf '%s\\n' 'fake-codex-ok' > \"$1\"",
      "    exit 0",
      "  fi",
      "  shift",
      "done",
      "exit 2",
      "",
    ].join("\n"),
  );
  await chmod(fakeCodexPath, 0o755);

  const result = await runLocalCodexInvocation({
    agent: makeAgent(),
    endpoint: makeEndpoint(fakeCodexPath),
    invocation: makeInvocation(),
  });

  expect(result.output).toBe("fake-codex-ok");
  expect((await readFile(markerPath, "utf8")).trim()).toBe(fakeCodexPath);
});
