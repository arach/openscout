import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionState } from "@openscout/agent-sessions";
import type { FlightRecord, InvocationRequest, MessageRecord } from "@openscout/protocol";
import type { WebAgent } from "../../db-queries.ts";

let queryAgentsResult: WebAgent[] = [];
let brokerContextResult: {
  snapshot: {
    endpoints: Record<string, Record<string, unknown>>;
    actors?: Record<string, { displayName?: string }>;
    agents?: Record<string, { displayName?: string }>;
    invocations?: Record<string, InvocationRequest>;
    flights?: Record<string, FlightRecord>;
    messages?: Record<string, MessageRecord>;
  };
} | null = null;
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
  test("joins a history observe session to its runtime flight through endpoint aliases", async () => {
    const requestedAt = Date.parse("2026-04-22T11:59:58.000Z");
    const tempRoot = makeTempDir("openscout-observe-provenance-");
    const historyPath = join(tempRoot, "claude-history.jsonl");
    writeClaudeHistory(historyPath, "working from harness history");
    queryAgentsResult = [makeAgent()];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            state: "active",
            sessionId: "runtime-session-1",
            transport: "claude_stream_json",
          },
        },
        actors: {
          operator: { displayName: "Arach" },
        },
        invocations: {
          "inv-1": {
            id: "inv-1",
            requesterId: "operator",
            requesterNodeId: "node-1",
            targetAgentId: "agent-1",
            action: "execute",
            task: "Add run provenance to the observe page.",
            conversationId: "chn-design",
            messageId: "msg-ask",
            ensureAwake: true,
            stream: true,
            createdAt: requestedAt + 500,
          },
          "inv-concurrent": {
            id: "inv-concurrent",
            requesterId: "operator",
            requesterNodeId: "node-1",
            targetAgentId: "agent-1",
            action: "execute",
            task: "A concurrent ask for another session.",
            ensureAwake: true,
            stream: true,
            createdAt: requestedAt + 5_000,
          },
          "inv-older": {
            id: "inv-older",
            requesterId: "operator",
            requesterNodeId: "node-1",
            targetAgentId: "agent-1",
            action: "execute",
            task: "The original initiating ask for the reused session.",
            conversationId: "chn-original",
            messageId: "msg-original",
            ensureAwake: true,
            stream: true,
            createdAt: requestedAt - 20_000,
          },
        },
        flights: {
          "flt-1": {
            id: "flt-1",
            invocationId: "inv-1",
            requesterId: "operator",
            targetAgentId: "agent-1",
            state: "running",
            startedAt: requestedAt + 1_000,
            metadata: {
              sessionTrace: [{
                sessionId: "runtime-session-1",
                startedAt: requestedAt + 1_000,
                lastAcknowledgedAt: requestedAt + 1_000,
              }],
            },
          },
          "flt-concurrent": {
            id: "flt-concurrent",
            invocationId: "inv-concurrent",
            requesterId: "operator",
            targetAgentId: "agent-1",
            state: "running",
            startedAt: requestedAt + 5_000,
            metadata: {
              sessionTrace: [{
                sessionId: "runtime-session-2",
                startedAt: requestedAt + 5_000,
                lastAcknowledgedAt: requestedAt + 5_000,
              }],
            },
          },
          "flt-older": {
            id: "flt-older",
            invocationId: "inv-older",
            requesterId: "operator",
            targetAgentId: "agent-1",
            state: "completed",
            startedAt: requestedAt - 20_000,
            completedAt: requestedAt - 10_000,
            metadata: {
              sessionTrace: [{
                sessionId: "runtime-session-1",
                startedAt: requestedAt - 20_000,
                lastAcknowledgedAt: requestedAt - 10_000,
                endedAt: requestedAt - 10_000,
              }],
            },
          },
        },
        messages: {
          "msg-original": {
            id: "msg-original",
            conversationId: "chn-original",
            actorId: "operator",
            originNodeId: "node-1",
            class: "agent",
            body: "The original initiating ask for the reused session.",
            visibility: "private",
            policy: "durable",
            createdAt: requestedAt - 20_000,
          },
          "msg-ask": {
            id: "msg-ask",
            conversationId: "chn-design",
            actorId: "operator",
            originNodeId: "node-1",
            class: "agent",
            body: "Add run provenance to the observe page.",
            visibility: "private",
            policy: "durable",
            createdAt: requestedAt,
          },
        },
      },
    };
    localAgentSnapshotResult = {
      session: {
        id: "harness-history-session",
        name: "Live Claude Session",
        adapterType: "claude-code",
        status: "active",
        cwd: "/Users/arach/dev/openscout",
        providerMeta: {
          resumeSessionPath: historyPath,
        },
      },
      turns: [],
    };

    const payload = await loadAgentObservePayload("agent-1");

    expect(payload?.source).toBe("history");
    expect(payload?.sessionId).toBe("harness-history-session");
    expect(payload?.initiatingAsk).toEqual({
      task: "The original initiating ask for the reused session.",
      requesterId: "operator",
      requesterName: "Arach",
      requestedAt: requestedAt - 20_000,
      invocationId: "inv-older",
      flightId: "flt-older",
      conversationId: "chn-original",
      messageId: "msg-original",
    });
  });

  test("links a parent agent route to the initiating flight of its observed child history", async () => {
    const sessionStart = Date.parse("2026-04-22T12:00:00.000Z");
    const tempRoot = makeTempDir("openscout-observe-parent-child-");
    const historyPath = join(tempRoot, "child-history.jsonl");
    writeClaudeHistory(historyPath, "child work visible through the parent route");
    queryAgentsResult = [makeAgent({
      id: "parent-agent",
      harnessSessionId: "relay-parent",
    })];
    brokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-parent": {
            id: "endpoint-parent",
            agentId: "parent-agent",
            state: "offline",
            sessionId: "relay-parent",
            harness: "claude",
            transport: "tmux",
            cwd: "/Users/arach/dev/openscout",
          },
          "endpoint-child-bare": {
            id: "endpoint-child-bare",
            agentId: "child-session",
            state: "offline",
            sessionId: "runtime-child-session",
            harness: "claude",
            transport: "tmux",
            cwd: "/Users/arach/dev/openscout",
            metadata: { startedAt: sessionStart - 500 },
          },
          "endpoint-child-qualified": {
            id: "endpoint-child-qualified",
            agentId: "child-session.main.node-1",
            state: "waiting",
            sessionId: "runtime-child-session",
            harness: "claude",
            transport: "tmux",
            cwd: "/Users/arach/dev/openscout",
            metadata: { startedAt: Math.floor((sessionStart - 500) / 1_000) },
          },
        },
        actors: {
          "parent-agent": { displayName: "Parent Agent" },
        },
        invocations: {
          "inv-original": {
            id: "inv-original",
            requesterId: "parent-agent",
            requesterNodeId: "node-1",
            targetAgentId: "child-session",
            action: "consult",
            task: "Create the first work-observability design study.",
            conversationId: "chn-original",
            messageId: "msg-original",
            ensureAwake: true,
            stream: false,
            createdAt: sessionStart - 1_000,
          },
          "inv-current": {
            id: "inv-current",
            requesterId: "parent-agent",
            requesterNodeId: "node-1",
            targetAgentId: "child-session.main.node-1",
            action: "consult",
            task: "Apply a later correction pass.",
            ensureAwake: true,
            stream: false,
            createdAt: sessionStart + 60_000,
          },
        },
        flights: {
          "flt-original": {
            id: "flt-original",
            invocationId: "inv-original",
            requesterId: "parent-agent",
            targetAgentId: "child-session",
            state: "completed",
            startedAt: sessionStart - 800,
            metadata: {
              sessionTrace: [{
                sessionId: "runtime-child-session",
                endpointId: "endpoint-child-bare",
                startedAt: sessionStart - 800,
                lastAcknowledgedAt: sessionStart - 800,
              }],
            },
          },
          "flt-current": {
            id: "flt-current",
            invocationId: "inv-current",
            requesterId: "parent-agent",
            targetAgentId: "child-session.main.node-1",
            state: "running",
            startedAt: sessionStart + 60_000,
            metadata: {
              sessionTrace: [{
                sessionId: "runtime-child-session",
                endpointId: "endpoint-child-qualified",
                startedAt: sessionStart + 60_000,
                lastAcknowledgedAt: sessionStart + 60_000,
              }],
            },
          },
        },
        messages: {
          "msg-original": {
            id: "msg-original",
            conversationId: "chn-original",
            actorId: "parent-agent",
            originNodeId: "node-1",
            class: "agent",
            body: "Create the first work-observability design study.",
            visibility: "private",
            policy: "durable",
            createdAt: sessionStart - 1_000,
          },
        },
      },
    };
    localAgentSnapshotResult = {
      session: {
        id: "harness-history-session",
        name: "Observed child history",
        adapterType: "claude-code",
        status: "active",
        cwd: "/Users/arach/dev/openscout",
        providerMeta: { resumeSessionPath: historyPath },
      },
      turns: [],
    };

    const payload = await loadAgentObservePayload("parent-agent");

    expect(payload?.source).toBe("history");
    expect(payload?.sessionId).toBe("harness-history-session");
    expect(payload?.initiatingAsk).toMatchObject({
      task: "Create the first work-observability design study.",
      invocationId: "inv-original",
      flightId: "flt-original",
      conversationId: "chn-original",
      messageId: "msg-original",
    });
  });

  test("does not attribute an ask from a different harness session", async () => {
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
        invocations: {
          "inv-old": {
            id: "inv-old",
            requesterId: "operator",
            requesterNodeId: "node-1",
            targetAgentId: "agent-1",
            action: "execute",
            task: "An older unrelated ask.",
            ensureAwake: true,
            stream: true,
            createdAt: Date.now() - 10_000,
          },
        },
        flights: {
          "flt-old": {
            id: "flt-old",
            invocationId: "inv-old",
            requesterId: "operator",
            targetAgentId: "agent-1",
            state: "running",
            metadata: {
              sessionTrace: [{
                sessionId: "different-session",
                startedAt: Date.now() - 10_000,
                lastAcknowledgedAt: Date.now() - 10_000,
              }],
            },
          },
        },
        messages: {},
      },
    };
    localSnapshotResult = {
      session: {
        id: "live-session-1",
        name: "Live Claude Session",
        adapterType: "claude-code",
        status: "active",
        cwd: "/Users/arach/dev/openscout",
      },
      turns: [],
    };

    const payload = await loadAgentObservePayload("agent-1");

    expect(payload?.initiatingAsk).toBeNull();
  });

  test("uses the sole active canonical flight when observe has no session identity", async () => {
    const requestedAt = Date.parse("2026-04-22T11:59:58.000Z");
    queryAgentsResult = [makeAgent({ harnessSessionId: null })];
    brokerContextResult = {
      snapshot: {
        endpoints: {},
        invocations: {
          "inv-active": {
            id: "inv-active",
            requesterId: "operator",
            requesterNodeId: "node-1",
            targetAgentId: "agent-1",
            action: "execute",
            task: "Recover the active ask even before a harness session is observable.",
            ensureAwake: true,
            stream: true,
            createdAt: requestedAt,
          },
        },
        flights: {
          "flt-active": {
            id: "flt-active",
            invocationId: "inv-active",
            requesterId: "operator",
            targetAgentId: "agent-1",
            state: "waking",
            startedAt: requestedAt,
          },
        },
        messages: {},
      },
    };

    const payload = await loadAgentObservePayload("agent-1");

    expect(payload?.source).toBe("unavailable");
    expect(payload?.initiatingAsk).toMatchObject({
      task: "Recover the active ask even before a harness session is observable.",
      invocationId: "inv-active",
      flightId: "flt-active",
    });
  });

  test("does not guess between concurrent active flights without session identity", async () => {
    const requestedAt = Date.parse("2026-04-22T11:59:58.000Z");
    queryAgentsResult = [makeAgent({ harnessSessionId: null })];
    brokerContextResult = {
      snapshot: {
        endpoints: {},
        invocations: Object.fromEntries([1, 2].map((index) => [`inv-${index}`, {
          id: `inv-${index}`,
          requesterId: "operator",
          requesterNodeId: "node-1",
          targetAgentId: "agent-1",
          action: "execute" as const,
          task: `Concurrent ask ${index}`,
          ensureAwake: true,
          stream: true,
          createdAt: requestedAt + index,
        }])),
        flights: Object.fromEntries([1, 2].map((index) => [`flt-${index}`, {
          id: `flt-${index}`,
          invocationId: `inv-${index}`,
          requesterId: "operator",
          targetAgentId: "agent-1",
          state: "running" as const,
          startedAt: requestedAt + index,
        }])),
        messages: {},
      },
    };

    const payload = await loadAgentObservePayload("agent-1");

    expect(payload?.source).toBe("unavailable");
    expect(payload?.initiatingAsk).toBeNull();
  });

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

describe("loadSessionRefObservePayload", () => {
  test("preserves the writable agent and harness session for broker session refs", async () => {
    brokerContextResult = {
      snapshot: {
        actors: {},
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            nodeId: "node-1",
            harness: "codex",
            state: "active",
            sessionId: "runtime-session-1",
            transport: "codex_app_server",
            metadata: {
              externalSessionId: "019f5b95-dce0-73d3-a4da-aff357e1d464",
            },
          },
        },
      },
    };

    const payload = await loadSessionRefObservePayload("019f5b95-dce0-73d3-a4da-aff357e1d464");

    expect(payload?.kind).toBe("broker");
    expect(payload?.agentId).toBe("agent-1");
    expect(payload?.sessionId).toBe("019f5b95-dce0-73d3-a4da-aff357e1d464");
  });
});
