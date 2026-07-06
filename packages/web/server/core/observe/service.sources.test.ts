import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionState } from "@openscout/agent-sessions";
import type { WebAgent } from "../../db-queries.ts";

let queryAgentsResult: WebAgent[] = [];
let brokerContextResult: { snapshot: { endpoints: Record<string, Record<string, unknown>> } } | null = null;
let localSnapshotResult: SessionState | null = null;
let localAgentSnapshotResult: SessionState | null = null;
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
  getLocalAgentSessionSnapshot: async () => localAgentSnapshotResult,
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
  readTailEventsForSession: async (sessionRef: string) => {
    const normalizedRef = sessionRef.trim().replace(/\.jsonl$/u, "");
    const transcript = tailDiscoveryResult?.transcripts.find((entry) => {
      const sessionId = entry.sessionId?.trim().replace(/\.jsonl$/u, "");
      return sessionId === normalizedRef || entry.transcriptPath.includes(normalizedRef);
    });
    if (!transcript || !["grok", "opencode", "cursor"].includes(transcript.source)) {
      return null;
    }
    return {
      transcript,
      events: [
        {
          id: "grok:test:0",
          ts: Date.now(),
          source: transcript.source,
          sessionId: transcript.sessionId ?? normalizedRef,
          pid: 1,
          parentPid: null,
          project: transcript.project,
          cwd: transcript.cwd,
          harness: transcript.harness,
          kind: "tool",
          summary: "Read started",
        },
      ],
    };
  },
}));

mock.module("../../pairing.ts", () => ({
  getScoutWebPairingSessionSnapshot: async () => pairingSnapshotResult,
}));

const { loadAgentObservePayload, loadSessionRefObservePayload } = await import("./service.ts");

mock.restore();

afterAll(() => {
  mock.restore();
});

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
    definitionId: "agent",
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
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: null,
    capabilities: [],
    project: "openscout",
    branch: "main",
    role: null,
    harnessSessionId: "history-session",
    harnessLogPath: null,
    conversationId: "dm.operator.agent-1",
    authorityNodeId: "node-1",
    authorityNodeName: "node-1",
    homeNodeId: "node-1",
    homeNodeName: "node-1",
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
    staleLocalRegistration: false,
    retiredFromFleet: false,
    replacedByAgentId: null,
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

function writeActiveClaudeHistory(path: string, assistantText: string): void {
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
  ].join("\n");
  writeFileSync(path, `${content}\n`, "utf8");
}

function writeCodexHistory(path: string, input: {
  sessionId: string;
  cwd: string;
  assistantText: string;
}): void {
  const content = [
    JSON.stringify({
      timestamp: "2026-04-22T12:00:00.000Z",
      type: "session_meta",
      payload: {
        id: input.sessionId,
        cwd: input.cwd,
        originator: "Codex Desktop",
        cli_version: "0.142.0",
        source: "vscode",
        model_provider: "openai",
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-22T12:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: "turn-codex-1",
        started_at: 1776862801,
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-22T12:00:02.000Z",
      type: "turn_context",
      payload: {
        cwd: input.cwd,
        model: "gpt-5.5",
        approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" },
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-22T12:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: input.assistantText,
        phase: "final",
      },
    }),
  ].join("\n");
  writeFileSync(path, `${content}\n`, "utf8");
}

beforeEach(() => {
  queryAgentsResult = [];
  brokerContextResult = null;
  localSnapshotResult = null;
  localAgentSnapshotResult = null;
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

  test("marks an active history-backed source as live when the hinted snapshot is idle", async () => {
    const tempRoot = makeTempDir("openscout-observe-active-history-");
    const historyPath = join(tempRoot, "active-history.jsonl");
    writeActiveClaudeHistory(historyPath, "still running from history");

    queryAgentsResult = [makeAgent()];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            state: "idle",
            sessionId: "idle-live-snapshot",
            transport: "claude_stream_json",
          },
        },
      },
    };
    localSnapshotResult = {
      session: {
        id: "idle-live-snapshot",
        name: "Idle Claude Session",
        adapterType: "claude-code",
        status: "idle",
        cwd: "/Users/arach/dev/openscout",
        providerMeta: {
          resumeSessionPath: historyPath,
        },
      },
      turns: [],
    };

    const payload = await loadAgentObservePayload("agent-1");

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe("history");
    expect(payload?.historyPath).toBe(historyPath);
    expect(payload?.data.live).toBe(true);
    expect(payload?.data.events.some((event) => event.text.includes("still running from history"))).toBe(true);
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

  test("uses the configured local agent snapshot for full instance ids", async () => {
    queryAgentsResult = [
      makeAgent({
        id: "talkie-codex.feat-design-tokens-reimagined.mini",
        harness: "codex",
        transport: "codex_app_server",
        harnessSessionId: "relay-talkie-codex-feat-design-tokens-reimagined-mini-codex",
      }),
    ];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "talkie-codex.feat-design-tokens-reimagined.mini",
            state: "idle",
            sessionId: "relay-talkie-codex-feat-design-tokens-reimagined-mini-codex",
            transport: "codex_app_server",
            metadata: {
              agentName: "talkie-codex",
              runtimeInstanceId: "relay-talkie-codex-feat-design-tokens-reimagined-mini-codex",
            },
          },
        },
      },
    };
    localSnapshotResult = {
      session: {
        id: "relay-talkie-codex-feat-design-tokens-reimagined-mini-codex",
        name: "talkie-codex",
        adapterType: "codex",
        status: "idle",
        cwd: "/Users/arach/dev/openscout",
      },
      turns: [],
    };
    localAgentSnapshotResult = {
      session: {
        id: "relay-talkie-codex-feat-design-tokens-reimagined-mini-codex",
        name: "talkie-codex.feat-design-tokens-reimagined.mini",
        adapterType: "codex",
        status: "active",
        cwd: "/Users/arach/dev/talkie",
      },
      turns: [
        {
          id: "turn-1",
          status: "streaming",
          startedAt: Date.parse("2026-04-22T12:00:04.000Z"),
          blocks: [
            {
              status: "completed",
              block: {
                id: "message-1",
                turnId: "turn-1",
                index: 0,
                type: "text",
                text: "configured full instance snapshot",
                status: "completed",
              },
            },
          ],
        },
      ],
      currentTurnId: "turn-1",
    };

    const payload = await loadAgentObservePayload("talkie-codex.feat-design-tokens-reimagined.mini");

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe("live");
    expect(payload?.sessionId).toBe("relay-talkie-codex-feat-design-tokens-reimagined-mini-codex");
    expect(payload?.data.metadata?.session?.cwd).toBe("/Users/arach/dev/talkie");
    expect(payload?.data.events.some((event) => event.text.includes("configured full instance snapshot"))).toBe(true);
  });

  test("uses harness-adapted discovered history for Claude agents carried by tmux", async () => {
    const tempRoot = makeTempDir("openscout-observe-claude-tmux-");
    process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT = join(tempRoot, "empty-projects");
    const historyPath = join(tempRoot, "claude-upstream-session.jsonl");
    writeClaudeHistory(historyPath, "hello from discovered Claude history");

    queryAgentsResult = [
      makeAgent({
        harness: "claude",
        transport: "tmux",
        cwd: "/Users/arach/dev/talkie",
        projectRoot: "/Users/arach/dev/talkie",
        project: "talkie",
        harnessSessionId: "relay-talkie-claude",
      }),
    ];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-stale-codex": {
            id: "endpoint-stale-codex",
            agentId: "agent-1",
            nodeId: "node-1",
            harness: "codex",
            transport: "codex_app_server",
            state: "active",
            sessionId: "019ead09-5750-7862-99c3-78c804b34c84",
            cwd: "/Users/arach/dev/talkie",
            projectRoot: "/Users/arach/dev/talkie",
            metadata: {
              threadId: "019ead09-5750-7862-99c3-78c804b34c84",
              runtimeInstanceId: "relay-talkie-codex",
              lastCompletedAt: Date.parse("2026-04-22T12:00:00.000Z"),
            },
          },
          "endpoint-current-claude": {
            id: "endpoint-current-claude",
            agentId: "agent-1",
            nodeId: "node-1",
            harness: "claude",
            transport: "tmux",
            state: "idle",
            sessionId: "relay-talkie-claude",
            cwd: "/Users/arach/dev/talkie",
            projectRoot: "/Users/arach/dev/talkie",
            metadata: {
              runtimeInstanceId: "relay-talkie-claude",
              tmuxSession: "relay-talkie-claude",
              startedAt: Date.parse("2026-04-22T12:01:00.000Z"),
            },
          },
        },
      },
    };
    tailDiscoveryResult = {
      generatedAt: Date.now(),
      processes: [],
      transcripts: [
        {
          source: "claude",
          transcriptPath: historyPath,
          sessionId: "claude-upstream-session",
          cwd: "/Users/arach/dev/talkie",
          project: "talkie",
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

    const payload = await loadAgentObservePayload("agent-1");

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe("history");
    expect(payload?.historyPath).toBe(historyPath);
    expect(payload?.sessionId).toBe("claude-upstream-session");
    expect(payload?.data.events.some((event) => event.text.includes("hello from discovered Claude history"))).toBe(true);
  });

  test("does not attach cwd-discovered Codex history to direct relay sessions without a session match", async () => {
    const tempRoot = makeTempDir("openscout-observe-codex-direct-mismatch-");
    const historyPath = join(tempRoot, "wrong-codex-session.jsonl");
    writeCodexHistory(historyPath, {
      sessionId: "wrong-codex-session",
      cwd: "/Users/arach/dev/scope",
      assistantText: "wrong raw codex history",
    });

    queryAgentsResult = [
      makeAgent({
        id: "scope.main.arts-mac-mini-local",
        harness: "codex",
        transport: "codex_app_server",
        cwd: "/Users/arach/dev/scope",
        projectRoot: "/Users/arach/dev/scope",
        project: "scope",
        harnessSessionId: "relay-scope-codex",
      }),
    ];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-scope-codex": {
            id: "endpoint-scope-codex",
            agentId: "scope.main.arts-mac-mini-local",
            nodeId: "node-1",
            harness: "codex",
            transport: "codex_app_server",
            state: "waiting",
            sessionId: "relay-scope-codex",
            cwd: "/Users/arach/dev/scope",
            projectRoot: "/Users/arach/dev/scope",
            metadata: {
              runtimeInstanceId: "relay-scope-codex",
              runtimeMode: "direct_session",
            },
          },
        },
      },
    };
    tailDiscoveryResult = {
      generatedAt: Date.now(),
      processes: [],
      transcripts: [
        {
          source: "codex",
          transcriptPath: historyPath,
          sessionId: "wrong-codex-session",
          cwd: "/Users/arach/dev/scope",
          project: "scope",
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

    const payload = await loadAgentObservePayload("scope.main.arts-mac-mini-local");

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe("unavailable");
    expect(payload?.historyPath).toBeNull();
    expect(payload?.sessionId).toBeNull();
    expect(payload?.data.events.some((event) => event.text.includes("wrong raw codex history"))).toBe(false);
  });

  test("uses session-matched discovered Codex history for direct relay sessions", async () => {
    const tempRoot = makeTempDir("openscout-observe-codex-direct-match-");
    const historyPath = join(tempRoot, "relay-scope-codex.jsonl");
    writeCodexHistory(historyPath, {
      sessionId: "relay-scope-codex",
      cwd: "/Users/arach/dev/scope",
      assistantText: "matched direct codex history",
    });

    queryAgentsResult = [
      makeAgent({
        id: "scope.main.arts-mac-mini-local",
        harness: "codex",
        transport: "codex_app_server",
        cwd: "/Users/arach/dev/scope",
        projectRoot: "/Users/arach/dev/scope",
        project: "scope",
        harnessSessionId: "relay-scope-codex",
      }),
    ];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-scope-codex": {
            id: "endpoint-scope-codex",
            agentId: "scope.main.arts-mac-mini-local",
            nodeId: "node-1",
            harness: "codex",
            transport: "codex_app_server",
            state: "waiting",
            sessionId: "relay-scope-codex",
            cwd: "/Users/arach/dev/scope",
            projectRoot: "/Users/arach/dev/scope",
            metadata: {
              runtimeInstanceId: "relay-scope-codex",
              runtimeMode: "direct_session",
            },
          },
        },
      },
    };
    tailDiscoveryResult = {
      generatedAt: Date.now(),
      processes: [],
      transcripts: [
        {
          source: "codex",
          transcriptPath: historyPath,
          sessionId: "relay-scope-codex",
          cwd: "/Users/arach/dev/scope",
          project: "scope",
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

    const payload = await loadAgentObservePayload("scope.main.arts-mac-mini-local");

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe("history");
    expect(payload?.historyPath).toBe(historyPath);
    expect(payload?.sessionId).toBe("relay-scope-codex");
    expect(payload?.data.events.some((event) => event.text.includes("matched direct codex history"))).toBe(true);
  });

  test("uses routed session id to discover Codex history when the agent record has no harness session", async () => {
    const tempRoot = makeTempDir("openscout-observe-codex-routed-session-");
    const historyPath = join(tempRoot, "relay-scope-codex.jsonl");
    writeCodexHistory(historyPath, {
      sessionId: "relay-scope-codex",
      cwd: "/Users/arach/dev/scope",
      assistantText: "routed direct codex history",
    });

    queryAgentsResult = [
      makeAgent({
        id: "scope.main.arts-mac-mini-local",
        harness: "codex",
        transport: "codex_app_server",
        cwd: "/Users/arach/dev/scope",
        projectRoot: "/Users/arach/dev/scope",
        project: "scope",
        harnessSessionId: null,
      }),
    ];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-scope-codex": {
            id: "endpoint-scope-codex",
            agentId: "scope.main.arts-mac-mini-local",
            nodeId: "node-1",
            harness: "codex",
            transport: "codex_app_server",
            state: "waiting",
            sessionId: "relay-scope-codex",
            cwd: "/Users/arach/dev/scope",
            projectRoot: "/Users/arach/dev/scope",
            metadata: {
              runtimeInstanceId: "relay-scope-codex",
              runtimeMode: "direct_session",
            },
          },
        },
      },
    };
    tailDiscoveryResult = {
      generatedAt: Date.now(),
      processes: [],
      transcripts: [
        {
          source: "codex",
          transcriptPath: historyPath,
          sessionId: "relay-scope-codex",
          cwd: "/Users/arach/dev/scope",
          project: "scope",
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

    const payload = await loadAgentObservePayload("scope.main.arts-mac-mini-local", {
      sessionId: "relay-scope-codex",
    });

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe("history");
    expect(payload?.historyPath).toBe(historyPath);
    expect(payload?.sessionId).toBe("relay-scope-codex");
    expect(payload?.data.events.some((event) => event.text.includes("routed direct codex history"))).toBe(true);
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

  test("maps a native Grok session ref to tail observe data", async () => {
    const transcriptPath = "/Users/art/.grok/sessions/openscout/019edd6b/events.jsonl";
    tailDiscoveryResult = {
      generatedAt: Date.now(),
      processes: [],
      transcripts: [
        {
          source: "grok",
          transcriptPath,
          sessionId: "019edd6b-fc26-7a53-a4a0-dd36c5378515",
          cwd: "/Users/art/dev/openscout",
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

    const payload = await loadSessionRefObservePayload("019edd6b-fc26-7a53-a4a0-dd36c5378515");

    expect(payload).not.toBeNull();
    expect(payload?.kind).toBe("tail");
    expect(payload?.source).toBe("tail");
    expect(payload?.historyPath).toBe(transcriptPath);
    expect(payload?.sessionId).toBe("019edd6b-fc26-7a53-a4a0-dd36c5378515");
    expect(payload?.data.events.some((event) => event.text.includes("Read started"))).toBe(true);
  });
});
