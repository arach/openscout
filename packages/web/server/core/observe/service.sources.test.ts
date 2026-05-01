import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionState } from "@openscout/agent-sessions";
import type { WebAgent } from "../../db-queries.ts";

let queryAgentsResult: WebAgent[] = [];
let brokerContextResult: { snapshot: { endpoints: Record<string, Record<string, unknown>> } } | null = null;
let localSnapshotResult: SessionState | null = null;
let pairingSnapshotResult: SessionState | null = null;
let tailDiscoveryResult: {
  generatedAt: number;
  processes: unknown[];
  transcripts: Array<{
    source: string;
    transcriptPath: string;
    sessionId: string | null;
    cwd: string | null;
    project: string;
    harness: "scout-managed" | "hudson-managed" | "unattributed";
    mtimeMs: number;
    size: number;
  }>;
  totals: {
    total: number;
    scoutManaged: number;
    hudsonManaged: number;
    unattributed: number;
    transcripts: number;
  };
} | null = null;

mock.module("../../db-queries.ts", () => ({
  queryAgents: () => queryAgentsResult,
}));

mock.module("../broker/service.ts", () => ({
  loadScoutBrokerContext: async () => brokerContextResult,
}));

mock.module("@openscout/runtime/local-agents", () => ({
  getLocalAgentEndpointSessionSnapshot: async () => localSnapshotResult,
}));

mock.module("@openscout/runtime/tail", () => ({
  getTailDiscovery: async () => tailDiscoveryResult ?? {
    generatedAt: Date.now(),
    processes: [],
    transcripts: [],
    totals: {
      total: 0,
      scoutManaged: 0,
      hudsonManaged: 0,
      unattributed: 0,
      transcripts: 0,
    },
  },
}));

mock.module("../../pairing.ts", () => ({
  getScoutWebPairingSessionSnapshot: async () => pairingSnapshotResult,
}));

const { loadAgentObservePayload, loadSessionRefObservePayload } = await import("./service.ts");

const tempRoots = new Set<string>();
const originalHome = process.env.HOME;
const originalClaudeProjectsRoot = process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT;

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
  tailDiscoveryResult = null;
});

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT = originalClaudeProjectsRoot;
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

  test("maps a Claude session ref id directly to its history file", async () => {
    const home = makeTempDir("openscout-observe-home-");
    process.env.HOME = home;
    const projectDir = join(home, ".claude", "projects", "-Users-arach-dev-openscout");
    process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT = join(home, ".claude", "projects");
    mkdirSync(projectDir, { recursive: true });
    const historyPath = join(projectDir, "3b0fcaa9-024a-4e67-88f7-08a72d75fbbb.jsonl");
    writeClaudeHistory(historyPath, "hello from ref lookup");

    const payload = await loadSessionRefObservePayload("3b0fcaa9-024a-4e67-88f7-08a72d75fbbb");

    expect(payload).not.toBeNull();
    expect(payload?.kind).toBe("history");
    expect(payload?.source).toBe("history");
    expect(payload?.historyPath).toBe(historyPath);
    expect(payload?.sessionId).toBe("3b0fcaa9-024a-4e67-88f7-08a72d75fbbb");
    expect(payload?.data.events.some((event) => event.text.includes("hello from ref lookup"))).toBe(true);
  });

  test("maps a Tail-discovered raw session ref to its transcript file", async () => {
    const tempRoot = makeTempDir("openscout-observe-tail-");
    process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT = join(tempRoot, "empty-projects");
    const historyPath = join(tempRoot, "tail-session.jsonl");
    writeClaudeHistory(historyPath, "hello from tail discovery");
    tailDiscoveryResult = {
      generatedAt: Date.now(),
      processes: [],
      transcripts: [
        {
          source: "claude",
          transcriptPath: historyPath,
          sessionId: "tail-session",
          cwd: "/Users/arach/dev/openscout",
          project: "openscout",
          harness: "unattributed",
          mtimeMs: Date.now(),
          size: 100,
        },
      ],
      totals: {
        total: 0,
        scoutManaged: 0,
        hudsonManaged: 0,
        unattributed: 0,
        transcripts: 1,
      },
    };

    const payload = await loadSessionRefObservePayload("tail-session");

    expect(payload).not.toBeNull();
    expect(payload?.kind).toBe("history");
    expect(payload?.source).toBe("history");
    expect(payload?.historyPath).toBe(historyPath);
    expect(payload?.sessionId).toBe("tail-session");
    expect(payload?.data.events.some((event) => event.text.includes("hello from tail discovery"))).toBe(true);
  });
});
