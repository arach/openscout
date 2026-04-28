import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionState } from "@openscout/agent-sessions";
import type { WebAgent } from "../../db-queries.ts";

let queryAgentsResult: WebAgent[] = [];
let brokerContextResult: { snapshot: { endpoints: Record<string, Record<string, unknown>> } } | null = null;
let localSnapshotResult: SessionState | null = null;
let pairingSnapshotResult: SessionState | null = null;

mock.module("../../db-queries.ts", () => ({
  queryAgents: () => queryAgentsResult,
}));

mock.module("../broker/service.ts", () => ({
  loadScoutBrokerContext: async () => brokerContextResult,
}));

mock.module("@openscout/runtime/local-agents", () => ({
  getLocalAgentEndpointSessionSnapshot: async () => localSnapshotResult,
}));

mock.module("../../pairing.ts", () => ({
  getScoutWebPairingSessionSnapshot: async () => pairingSnapshotResult,
}));

const { loadAgentObservePayload } = await import("./service.ts");

const tempRoots = new Set<string>();

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.add(dir);
  return dir;
}

function makeAgent(overrides: Partial<WebAgent> = {}): WebAgent {
  return {
    id: "agent-1",
    name: "Agent One",
    handle: "agent.one",
    agentClass: "general",
    harness: "claude",
    state: "working",
    projectRoot: "/Users/arach/dev/openscout",
    cwd: "/Users/arach/dev/openscout",
    updatedAt: Date.now(),
    transport: "claude_stream_json",
    selector: null,
    wakePolicy: null,
    capabilities: [],
    project: "openscout",
    branch: "main",
    role: null,
    harnessSessionId: "history-session",
    harnessLogPath: null,
    conversationId: "dm.operator.agent-1",
    ...overrides,
  };
}

function writeClaudeHistory(path: string, assistantText: string): void {
  const content = [
    JSON.stringify({
      type: "system",
      subtype: "init",
      timestamp: "2026-04-22T12:00:00.000Z",
      session_id: "claude-upstream-session",
      cwd: "/Users/arach/dev/openscout",
      model: "claude-sonnet-test",
    }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-04-22T12:00:01.000Z",
      message: { role: "user", content: "inspect" },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-04-22T12:00:02.000Z",
      message: {
        content: [{ type: "text", text: assistantText }],
      },
    }),
    JSON.stringify({
      type: "result",
      timestamp: "2026-04-22T12:00:03.000Z",
      subtype: "success",
      is_error: false,
    }),
  ].join("\n");
  writeFileSync(path, `${content}\n`, "utf8");
}

beforeEach(() => {
  queryAgentsResult = [];
  brokerContextResult = null;
  localSnapshotResult = null;
  pairingSnapshotResult = null;
});

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe("loadAgentObservePayload", () => {
  test("prefers harness-native history when a readable Claude history file is available", async () => {
    const tempRoot = makeTempDir("openscout-observe-history-");
    const historyPath = join(tempRoot, "claude-history.jsonl");
    writeClaudeHistory(historyPath, "hello from history");

    queryAgentsResult = [makeAgent()];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            state: "active",
            sessionId: "live-session-1",
            transport: "claude_stream_json",
          },
        },
      },
    };
    localSnapshotResult = {
      session: {
        id: "live-session-1",
        name: "Live Claude Session",
        adapterType: "claude-code",
        status: "active",
        cwd: "/Users/arach/dev/openscout",
        providerMeta: {
          resumeSessionPath: historyPath,
        },
      },
      turns: [
        {
          id: "live-turn-1",
          status: "streaming",
          startedAt: Date.parse("2026-04-22T12:00:04.000Z"),
          blocks: [
            {
              status: "streaming",
              block: {
                id: "live-think-1",
                turnId: "live-turn-1",
                index: 0,
                type: "reasoning",
                text: "from live snapshot",
                status: "streaming",
              },
            },
          ],
        },
      ],
      currentTurnId: "live-turn-1",
    };

    const payload = await loadAgentObservePayload("agent-1");

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe("history");
    expect(payload?.fidelity).toBe("timestamped");
    expect(payload?.historyPath).toBe(historyPath);
    expect(payload?.sessionId).toBe("live-session-1");
    expect(payload?.data.events.some((event) => event.text.includes("hello from history"))).toBe(true);
    expect(payload?.data.events.some((event) => event.text.includes("from live snapshot"))).toBe(false);
  });

  test("falls back to the live snapshot when the hinted history file is not replayable", async () => {
    const tempRoot = makeTempDir("openscout-observe-live-");
    const historyPath = join(tempRoot, "codex-history.jsonl");
    writeFileSync(historyPath, `${JSON.stringify({ cwd: "/Users/arach/dev/openscout" })}\n`, "utf8");

    queryAgentsResult = [
      makeAgent({
        harness: "codex",
        transport: "codex_app_server",
      }),
    ];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            state: "active",
            sessionId: "codex-live-session-1",
            transport: "codex_app_server",
          },
        },
      },
    };
    localSnapshotResult = {
      session: {
        id: "codex-live-session-1",
        name: "Live Codex Session",
        adapterType: "codex",
        status: "active",
        cwd: "/Users/arach/dev/openscout",
        providerMeta: {
          resumeSessionPath: historyPath,
        },
      },
      turns: [
        {
          id: "live-turn-1",
          status: "streaming",
          startedAt: Date.parse("2026-04-22T12:00:04.000Z"),
          blocks: [
            {
              status: "streaming",
              block: {
                id: "live-think-1",
                turnId: "live-turn-1",
                index: 0,
                type: "reasoning",
                text: "from live snapshot",
                status: "streaming",
              },
            },
          ],
        },
      ],
      currentTurnId: "live-turn-1",
    };

    const payload = await loadAgentObservePayload("agent-1");

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe("live");
    expect(payload?.fidelity).toBe("synthetic");
    expect(payload?.historyPath).toBe(historyPath);
    expect(payload?.sessionId).toBe("codex-live-session-1");
    expect(payload?.data.events.some((event) => event.text.includes("from live snapshot"))).toBe(true);
  });
});
