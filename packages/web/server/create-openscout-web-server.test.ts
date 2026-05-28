import { beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionBlock, BlockState, QuestionBlock, SessionState } from "@openscout/agent-sessions";
import {
  buildRelayAgentInstance,
  writeRelayAgentOverrides,
} from "@openscout/runtime/setup";

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalOpenScoutHome = process.env.OPENSCOUT_HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
const originalNodeQualifier = process.env.OPENSCOUT_NODE_QUALIFIER;
const originalOperatorName = process.env.OPENSCOUT_OPERATOR_NAME;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalOpenAIModel = process.env.OPENAI_MODEL;
const originalScoutbotAssistantModel = process.env.OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL;
const sendScoutMessageCalls: Array<Record<string, unknown>> = [];
const sendScoutConversationMessageCalls: Array<Record<string, unknown>> = [];
const sendScoutDirectMessageCalls: Array<Record<string, unknown>> = [];
const askScoutQuestionCalls: Array<Record<string, unknown>> = [];
const queryRunsCalls: Array<Record<string, unknown>> = [];
const decidePairingApprovalCalls: Array<Record<string, unknown>> = [];
const upsertUnblockRequestCalls: Array<Record<string, unknown>> = [];
const appendUnblockRequestEventCalls: Array<Record<string, unknown>> = [];
const testDirectories = new Set<string>();
let readUnblockRequestsResult: Array<Record<string, unknown>> = [];
let scoutBrokerContextResult: unknown = null;
let agentObservePayloadResult: unknown = null;
let sessionRefObservePayloadResult: unknown = null;
let brokerDiagnosticsResult: Record<string, unknown> = makeBrokerDiagnostics();
let pairingStateResult: Record<string, unknown> = makePairingState();
let pairingSessionSnapshotsResult: SessionState[] = [];

let querySessionByIdImpl: (conversationId: string) => {
  kind: string;
  agentId: string | null;
  participantIds: string[];
} | null = () => null;
let sendScoutMessageResult: unknown = {
  usedBroker: true,
  invokedTargets: [],
  unresolvedTargets: [],
};
let sendScoutDirectMessageResult: unknown = {
  conversationId: "dm.operator.agent-1",
  messageId: "msg-1",
  flight: {
    id: "flt-1",
    invocationId: "inv-1",
    targetAgentId: "agent-1",
    state: "queued",
  },
};
let askScoutQuestionResult: unknown = {
  usedBroker: true,
  conversationId: "dm.operator.agent-1",
  messageId: "msg-ask-1",
  flight: {
    id: "flt-ask-1",
    invocationId: "inv-ask-1",
    targetAgentId: "agent-1",
    state: "queued",
  },
};
let scoutRelayConfigResult: Record<string, unknown> = {};
mock.module("./db-queries.ts", () => ({
  configureReadonlyDb: (db: { exec(sql: string): void }) => {
    db.exec("PRAGMA busy_timeout = 250");
    db.exec("PRAGMA query_only = ON");
  },
  queryAgentById: () => null,
  queryAgents: () => [],
  queryActivity: () => [],
  queryBrokerDiagnostics: () => brokerDiagnosticsResult,
  queryAgentById: () => null,
  queryConversationDefinitionById: () => null,
  queryHeartrate: () => [],
  queryFleet: () => ({
    generatedAt: Date.now(),
    totals: { active: 0, recentCompleted: 0, needsAttention: 0, activity: 0 },
    activeAsks: [],
    recentCompleted: [],
    needsAttention: [],
    activity: [],
  }),
  queryFlightRecordById: () => null,
  queryFollowTarget: () => null,
  queryFlights: () => [],
  queryRuns: (opts: Record<string, unknown>) => {
    queryRunsCalls.push(opts);
    return [];
  },
  queryRecentMessages: () => [],
  querySessions: () => [],
  querySessionById: (conversationId: string) =>
    querySessionByIdImpl(conversationId),
  queryWorkItems: () => [],
  queryWorkItemById: () => null,
}));

mock.module("./pairing.ts", () => ({
  controlScoutWebPairingService: async () => pairingStateResult,
  decideScoutWebPairingApproval: async (input: Record<string, unknown>) => {
    decidePairingApprovalCalls.push(input);
    return pairingStateResult;
  },
  getScoutWebPairingState: async () => pairingStateResult,
  getScoutWebPairingSessionSnapshot: async (sessionId: string) =>
    pairingSessionSnapshotsResult.find((snapshot) => snapshot.session.id === sessionId) ?? null,
  getScoutWebPairingSessionSnapshots: async () => pairingSessionSnapshotsResult,
  refreshScoutWebPairingState: async () => pairingStateResult,
  removeScoutPairingTrustedPeer: () => false,
}));

mock.module("./core/broker/service.ts", () => ({
  appendScoutCollaborationEvent: async () => null,
  appendScoutUnblockRequestEvent: async (input: Record<string, unknown>) => {
    appendUnblockRequestEventCalls.push(input);
  },
  loadScoutBrokerContext: async () => scoutBrokerContextResult,
  loadScoutReadCursors: async () => ({}),
  loadScoutRelayConfig: async () => scoutRelayConfigResult,
  markScoutConversationRead: async () => null,
  readScoutUnblockRequests: async () => readUnblockRequestsResult,
  readScoutBrokerHealth: async () => ({
    baseUrl: "http://broker.test",
    reachable: false,
    ok: false,
    nodeId: null,
    meshId: null,
    counts: null,
    error: "offline",
  }),
  resolveScoutBrokerUrl: () => "http://broker.test",
  sendScoutMessage: async (input: Record<string, unknown>) => {
    sendScoutMessageCalls.push(input);
    return sendScoutMessageResult;
  },
  sendScoutConversationMessage: async (input: Record<string, unknown>) => {
    sendScoutConversationMessageCalls.push(input);
    return sendScoutMessageResult;
  },
  sendScoutDirectMessage: async (input: Record<string, unknown>) => {
    sendScoutDirectMessageCalls.push(input);
    return sendScoutDirectMessageResult;
  },
  askScoutQuestion: async (input: Record<string, unknown>) => {
    askScoutQuestionCalls.push(input);
    return askScoutQuestionResult;
  },
  upsertScoutConversation: async () => null,
  upsertScoutFlight: async () => null,
  upsertScoutUnblockRequest: async (input: Record<string, unknown>) => {
    upsertUnblockRequestCalls.push(input);
  },
}));

mock.module("./core/observe/service.ts", () => ({
  loadAgentObservePayload: async () => agentObservePayloadResult,
  loadAgentObserveSummaries: async () => [],
  loadSessionRefObservePayload: async () => sessionRefObservePayloadResult,
}));

const { createOpenScoutWebServer } =
  await import("./create-openscout-web-server.ts");

function makeStaticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openscout-web-static-"));
  testDirectories.add(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
    "utf8",
  );
  return root;
}

function useIsolatedOpenScoutHome(): string {
  const home = mkdtempSync(join(tmpdir(), "openscout-web-server-"));
  testDirectories.add(home);
  process.env.HOME = home;
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
  process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
  process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");
  process.env.OPENSCOUT_NODE_QUALIFIER = "test-node";
  return home;
}

function makePairingState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "stopped",
    statusLabel: "Stopped",
    statusDetail: null,
    connectedPeerFingerprint: null,
    isRunning: false,
    commandLabel: "openscout-web pair",
    configPath: "/tmp/pairing/config.json",
    identityPath: "/tmp/pairing/identity.json",
    trustedPeersPath: "/tmp/pairing/trusted-peers.json",
    logPath: "/tmp/pairing/bridge.log",
    relay: null,
    configuredRelay: null,
    secure: true,
    workspaceRoot: null,
    sessionCount: 0,
    identityFingerprint: null,
    trustedPeerCount: 0,
    trustedPeers: [],
    pendingApprovals: [],
    pairing: null,
    logTail: "",
    logUpdatedAtLabel: null,
    logMissing: true,
    logTruncated: false,
    lastUpdatedLabel: null,
    ...overrides,
  };
}

function makeBrokerDiagnostics(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt: Date.now(),
    windowMs: 86_400_000,
    totals: {
      successfulDispatches: 0,
      failedQueries: 0,
      failedDeliveries: 0,
      deliveryAttempts: 0,
      failedDeliveryAttempts: 0,
      dialogueMessages: 0,
    },
    rates: {
      messagesPerHour: 0,
      failedQueriesPerHour: 0,
      failedDeliveriesPerHour: 0,
      failureRate: 0,
    },
    attempts: [],
    failedQueries: [],
    failedDeliveries: [],
    dialogue: [],
    ...overrides,
  };
}

function sessionSnapshotWithAttention(): {
  snapshot: SessionState;
  approval: Record<string, unknown>;
} {
  const sessionId = "pairing-session-1";
  const turnId = "turn-1";
  const approvalBlockId = "cmd-approval";
  const questionBlock: QuestionBlock = {
    id: "question-1",
    turnId,
    type: "question",
    status: "streaming",
    index: 0,
    header: "Deploy",
    question: "Ship the fix?",
    options: [{ label: "Yes" }, { label: "No" }],
    multiSelect: false,
    questionStatus: "awaiting_answer",
  };
  const approvalBlock: ActionBlock = {
    id: approvalBlockId,
    turnId,
    type: "action",
    status: "streaming",
    index: 1,
    action: {
      kind: "command",
      status: "awaiting_approval",
      output: "",
      command: "bun test",
      approval: {
        version: 3,
        description: "Run focused tests",
        risk: "high",
      },
    },
  };
  const failedBlock: ActionBlock = {
    id: "tool-failed",
    turnId,
    type: "action",
    status: "failed",
    index: 2,
    action: {
      kind: "tool_call",
      status: "failed",
      output: "Native tool failed",
      toolName: "apply_patch",
      toolCallId: "tool-call-1",
    },
  };
  const blocks: BlockState[] = [
    { block: questionBlock, status: "streaming" },
    { block: approvalBlock, status: "streaming" },
    { block: failedBlock, status: "completed" },
  ];
  return {
    snapshot: {
      session: {
        id: sessionId,
        name: "Codex Pairing",
        adapterType: "codex",
        status: "active",
        cwd: "/tmp/project",
      },
      turns: [
        {
          id: turnId,
          status: "streaming",
          startedAt: 1_700_000_000_000,
          blocks,
        },
      ],
      currentTurnId: turnId,
    },
    approval: {
      sessionId,
      sessionName: "Codex Pairing",
      adapterType: "codex",
      turnId,
      blockId: approvalBlockId,
      version: 3,
      risk: "high",
      title: "Approve Command",
      description: "Run focused tests",
      detail: "bun test",
      actionKind: "command",
      actionStatus: "awaiting_approval",
    },
  };
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
  process.env.HOME = originalHome;
  if (originalOpenScoutHome === undefined) {
    delete process.env.OPENSCOUT_HOME;
  } else {
    process.env.OPENSCOUT_HOME = originalOpenScoutHome;
  }
  if (originalSupportDirectory === undefined) {
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  } else {
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  }
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  if (originalRelayHub === undefined) {
    delete process.env.OPENSCOUT_RELAY_HUB;
  } else {
    process.env.OPENSCOUT_RELAY_HUB = originalRelayHub;
  }
  if (originalNodeQualifier === undefined) {
    delete process.env.OPENSCOUT_NODE_QUALIFIER;
  } else {
    process.env.OPENSCOUT_NODE_QUALIFIER = originalNodeQualifier;
  }
  if (originalOperatorName === undefined) {
    delete process.env.OPENSCOUT_OPERATOR_NAME;
  } else {
    process.env.OPENSCOUT_OPERATOR_NAME = originalOperatorName;
  }
  if (originalOpenAIKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  }
  if (originalOpenAIModel === undefined) {
    delete process.env.OPENAI_MODEL;
  } else {
    process.env.OPENAI_MODEL = originalOpenAIModel;
  }
  if (originalScoutbotAssistantModel === undefined) {
    delete process.env.OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL;
  } else {
    process.env.OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL = originalScoutbotAssistantModel;
  }
  querySessionByIdImpl = () => null;
  scoutBrokerContextResult = null;
  agentObservePayloadResult = null;
  sessionRefObservePayloadResult = null;
  sendScoutMessageResult = {
    usedBroker: true,
    invokedTargets: [],
    unresolvedTargets: [],
  };
  sendScoutDirectMessageResult = {
    conversationId: "dm.operator.agent-1",
    messageId: "msg-1",
    flight: {
      id: "flt-1",
      invocationId: "inv-1",
      targetAgentId: "agent-1",
      state: "queued",
    },
  };
  askScoutQuestionResult = {
    usedBroker: true,
    conversationId: "dm.operator.agent-1",
    messageId: "msg-ask-1",
    flight: {
      id: "flt-ask-1",
      invocationId: "inv-ask-1",
      targetAgentId: "agent-1",
      state: "queued",
    },
  };
  scoutRelayConfigResult = {};
  brokerDiagnosticsResult = makeBrokerDiagnostics();
  readUnblockRequestsResult = [];
  pairingStateResult = makePairingState();
  pairingSessionSnapshotsResult = [];
  sendScoutMessageCalls.length = 0;
  sendScoutConversationMessageCalls.length = 0;
  sendScoutDirectMessageCalls.length = 0;
  askScoutQuestionCalls.length = 0;
  queryRunsCalls.length = 0;
  decidePairingApprovalCalls.length = 0;
  upsertUnblockRequestCalls.length = 0;
  appendUnblockRequestEventCalls.length = 0;
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalOpenScoutHome === undefined) {
    delete process.env.OPENSCOUT_HOME;
  } else {
    process.env.OPENSCOUT_HOME = originalOpenScoutHome;
  }
  if (originalSupportDirectory === undefined) {
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  } else {
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  }
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  if (originalRelayHub === undefined) {
    delete process.env.OPENSCOUT_RELAY_HUB;
  } else {
    process.env.OPENSCOUT_RELAY_HUB = originalRelayHub;
  }
  if (originalNodeQualifier === undefined) {
    delete process.env.OPENSCOUT_NODE_QUALIFIER;
  } else {
    process.env.OPENSCOUT_NODE_QUALIFIER = originalNodeQualifier;
  }
  if (originalOperatorName === undefined) {
    delete process.env.OPENSCOUT_OPERATOR_NAME;
  } else {
    process.env.OPENSCOUT_OPERATOR_NAME = originalOperatorName;
  }
  if (originalOpenAIKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  }
  if (originalOpenAIModel === undefined) {
    delete process.env.OPENAI_MODEL;
  } else {
    process.env.OPENAI_MODEL = originalOpenAIModel;
  }
  if (originalScoutbotAssistantModel === undefined) {
    delete process.env.OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL;
  } else {
    process.env.OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL = originalScoutbotAssistantModel;
  }

  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

describe("createOpenScoutWebServer", () => {
  test("serves and writes global material heuristics", async () => {
    const home = useIsolatedOpenScoutHome();
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const defaultsResponse = await server.app.request("http://localhost/api/heuristics/defaults");
    expect(defaultsResponse.status).toBe(200);
    await expect(defaultsResponse.json()).resolves.toMatchObject({
      path: null,
      config: {
        classify: {
          exclude: expect.arrayContaining(["node_modules/**"]),
        },
      },
    });

    const raw = JSON.stringify({ classify: { spec: { include: ["sco-*.md"] } } }, null, 2);
    const putResponse = await server.app.request("http://localhost/api/heuristics/global", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    expect(putResponse.status).toBe(200);
    await expect(putResponse.json()).resolves.toMatchObject({
      path: join(home, ".openscout", "heuristics.json"),
      raw,
      config: { classify: { spec: { include: ["sco-*.md"] } } },
    });
    expect(readFileSync(join(home, ".openscout", "heuristics.json"), "utf8")).toBe(raw);
  });

  test("returns editor-friendly errors for invalid heuristic JSON", async () => {
    useIsolatedOpenScoutHome();
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/heuristics/global", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: "{\n  \"classify\": " }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid JSON",
      lineNumber: 2,
    });
  });

  test("serves project material heuristics for a workspace root", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-web-heuristics-project-"));
    testDirectories.add(root);
    mkdirSync(join(root, ".openscout"), { recursive: true });
    writeFileSync(
      join(root, ".openscout", "heuristics.json"),
      JSON.stringify({ classify: { planning: { include: ["roadmap/*.md"] } } }),
      "utf8",
    );
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request(
      `http://localhost/api/heuristics/project?workspaceRoot=${encodeURIComponent(root)}`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      path: join(root, ".openscout", "heuristics.json"),
      config: { classify: { planning: { include: ["roadmap/*.md"] } } },
    });
  });

  test("serves unified conversations from the broker-backed service", async () => {
    scoutBrokerContextResult = {
      snapshot: {
        conversations: {
          "dm.operator.agent-1": {
            id: "dm.operator.agent-1",
            kind: "direct",
            title: "ignored",
            participantIds: ["operator", "agent-1"],
          },
          "channel.general": {
            id: "channel.general",
            kind: "channel",
            title: "general",
            participantIds: ["operator", "agent-1"],
          },
        },
        messages: {
          "msg-1": {
            id: "msg-1",
            conversationId: "dm.operator.agent-1",
            actorId: "agent-1",
            body: "hello from dm",
            createdAt: 1_700_000_000,
          },
          "msg-2": {
            id: "msg-2",
            conversationId: "channel.general",
            actorId: "agent-1",
            body: "hello from channel",
            createdAt: 1_700_000_100,
          },
        },
        agents: {
          "agent-1": {
            id: "agent-1",
            displayName: "Agent One",
            metadata: {},
          },
        },
        actors: {
          "agent-1": {
            id: "agent-1",
            displayName: "Agent One",
          },
        },
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            state: "available",
            harness: "codex",
            cwd: "/tmp/project",
            projectRoot: "/tmp/project",
            metadata: {},
          },
        },
      },
    };

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/conversations");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: "channel.general",
        kind: "channel",
        preview: "hello from channel",
      }),
      expect.objectContaining({
        id: "dm.operator.agent-1",
        kind: "direct",
        preview: "hello from dm",
        harness: "codex",
      }),
    ]);
  });

  test("returns batched observe payloads for the requested agent ids", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request(
      "http://localhost/api/observe/agents?ids=agent-1,agent-2",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  test("serves broker diagnostics", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/broker");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: {
        successfulDispatches: 0,
        failedQueries: 0,
        failedDeliveries: 0,
      },
      attempts: [],
      failedQueries: [],
      failedDeliveries: [],
      dialogue: [],
    });
  });

  test("suggests the current Scout MCP ask permission only for the current tool", async () => {
    brokerDiagnosticsResult = makeBrokerDiagnostics({
      totals: {
        successfulDispatches: 0,
        failedQueries: 0,
        failedDeliveries: 2,
        deliveryAttempts: 0,
        failedDeliveryAttempts: 0,
        dialogueMessages: 0,
      },
      failedDeliveries: [
        {
          id: "delivery:new-ask",
          kind: "failed_delivery",
          status: "failed",
          ts: 1_700_000_000_000,
          actorName: null,
          target: "claude-review",
          route: "mcp",
          detail: "Claude blocked mcp__scout__ask until permission is allowed.",
          conversationId: "dm.operator.claude-review",
          messageId: "msg-1",
          deliveryId: "delivery-1",
          invocationId: "inv-1",
          metadata: null,
        },
        {
          id: "delivery:old-invocation-ask",
          kind: "failed_delivery",
          status: "failed",
          ts: 1_700_000_000_001,
          actorName: null,
          target: "legacy-review",
          route: "mcp",
          detail: "Claude blocked mcp__scout__invocations_ask until permission is allowed.",
          conversationId: "dm.operator.legacy-review",
          messageId: "msg-2",
          deliveryId: "delivery-2",
          invocationId: "inv-2",
          metadata: null,
        },
      ],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{
        id: string;
        agentName: string | null;
        actions: Array<{ kind: string; value?: string }>;
      }>;
    };
    const askPermissionItems = body.items.filter((item) =>
      item.id.startsWith("config:mcp-scout-ask:"),
    );

    expect(askPermissionItems).toHaveLength(1);
    expect(askPermissionItems[0]?.agentName).toBe("claude-review");
    expect(askPermissionItems[0]?.actions).toContainEqual(
      expect.objectContaining({
        kind: "copy",
        value: "/allow mcp__scout__ask",
      }),
    );
    expect(body.items.some((item) => item.agentName === "legacy-review")).toBe(false);
  });

  test("includes session attention in operator attention and dedupes pairing approvals", async () => {
    useIsolatedOpenScoutHome();
    const { snapshot, approval } = sessionSnapshotWithAttention();
    pairingStateResult = makePairingState({
      pendingApprovals: [approval],
    });
    pairingSessionSnapshotsResult = [snapshot];

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      totals: { approvals: number; collaboration: number };
      items: Array<{
        id: string;
        kind: string;
        title: string;
        sourceLabel: string;
        actions: Array<{ kind: string; route?: Record<string, string> }>;
      }>;
    };
    const approvalId = "approval:pairing-session-1:turn-1:cmd-approval:v3";

    expect(body.totals.approvals).toBe(1);
    expect(body.items.filter((item) => item.id === approvalId)).toHaveLength(1);
    expect(body.items.find((item) => item.id === approvalId)?.actions)
      .toEqual([
        expect.objectContaining({ kind: "approve" }),
        expect.objectContaining({ kind: "deny" }),
        expect.objectContaining({
          kind: "open",
          route: expect.objectContaining({
            view: "follow",
            sessionId: "pairing-session-1",
            preferredView: "session",
          }),
        }),
      ]);
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-question:pairing-session-1:turn-1:question-1",
        kind: "question",
        title: "Deploy",
        sourceLabel: "codex question",
      }),
      expect.objectContaining({
        id: "session-action-failed:pairing-session-1:turn-1:tool-failed",
        kind: "session",
        title: "Tool call failed",
        sourceLabel: "codex action",
      }),
    ]));
    expect(body.items.find((item) => item.id === "session-action-failed:pairing-session-1:turn-1:tool-failed")?.actions)
      .toEqual([
        expect.objectContaining({
          kind: "open",
          route: expect.objectContaining({
            view: "follow",
            sessionId: "pairing-session-1",
            preferredView: "session",
          }),
        }),
      ]);
  });

  test("renders broker unblock requests without dead approval actions", async () => {
    const createdAt = 1_700_000_000_000;
    readUnblockRequestsResult = [{
      id: "unblock-1",
      kind: "permission",
      state: "open",
      source: "test-permission-source",
      sourceRef: "permission:req-1",
      title: "Tool permission needed",
      ownerId: "operator",
      createdById: "system",
      actions: [
        { kind: "approve", label: "Allow" },
        { kind: "deny", label: "Deny" },
        { kind: "open", label: "Open settings", route: { view: "settings" } },
      ],
      createdAt,
      updatedAt: createdAt,
    }];

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{
        id: string;
        actions: Array<{ kind: string }>;
      }>;
    };
    expect(body.items.find((item) => item.id === "unblock-1")?.actions.map((action) => action.kind))
      .toEqual(["open", "dismiss"]);
  });

  test("renders Claude Scout permission hints without a settings detour", async () => {
    const createdAt = 1_700_000_000_000;
    brokerDiagnosticsResult = makeBrokerDiagnostics({
      failedQueries: [{
        id: "failed-query-1",
        ts: createdAt,
        target: "claude.main",
        conversationId: "conv-claude",
        detail: "Claude blocked scout ask because allowedTools does not include Bash(scout:*).",
      }],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{
        id: string;
        title: string;
        detail: string | null;
        actions: Array<{ kind: string; label: string; route?: Record<string, string>; value?: string }>;
      }>;
    };
    const item = body.items.find((entry) => entry.id === "config:scout-ask-cli:failed-query-1");
    expect(item).toMatchObject({
      title: "Claude needs Scout CLI permission",
      detail: expect.stringContaining("Claude-session permission"),
      actions: [
        expect.objectContaining({
          kind: "copy",
          label: "Copy Claude fix",
          value: `{ "allowedTools": ["Bash(scout:*)"] }`,
        }),
        expect.objectContaining({
          kind: "open",
          label: "Open thread",
          route: { view: "conversation", conversationId: "conv-claude" },
        }),
      ],
    });
    expect(item?.actions.some((action) => action.kind === "configure")).toBe(false);
    expect(item?.actions.some((action) => action.route?.view === "settings")).toBe(false);
  });

  test("passes run filters to the run registry API", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request(
      "http://localhost/api/runs?agentId=agent-1&conversationId=conv-1&workId=work-1&state=completed&source=external_issue&active=false&limit=25",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(queryRunsCalls).toEqual([
      {
        agentId: "agent-1",
        conversationId: "conv-1",
        collaborationRecordId: undefined,
        workId: "work-1",
        state: "completed",
        source: "external_issue",
        active: false,
        limit: 25,
      },
    ]);
  });

  test("routes direct DM tells through sendScoutDirectMessage", async () => {
    querySessionByIdImpl = () => ({
      kind: "direct",
      agentId: "agent-1",
      participantIds: ["operator", "agent-1"],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Status update",
        conversationId: "dm.operator.agent-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutDirectMessageCalls).toEqual([
      {
        agentId: "agent-1",
        body: "Status update",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("routes configured-operator direct DM tells through sendScoutDirectMessage", async () => {
    process.env.OPENSCOUT_OPERATOR_NAME = "arach";
    querySessionByIdImpl = () => ({
      kind: "direct",
      agentId: "agent-1",
      participantIds: ["arach", "agent-1"],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Status update",
        conversationId: "dm.arach.agent-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutDirectMessageCalls).toEqual([
      {
        agentId: "agent-1",
        body: "Status update",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutConversationMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("preserves sends from observed agent-to-agent conversations", async () => {
    querySessionByIdImpl = () => ({
      kind: "direct",
      agentId: "hudson.main.mini",
      participantIds: ["hudson.main.mini", "narrative-studio.main.mini"],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "@hudson hi",
        conversationId: "dm.hudson.main.mini.narrative-studio.main.mini",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutConversationMessageCalls).toEqual([
      {
        conversationId: "dm.hudson.main.mini.narrative-studio.main.mini",
        senderId: "operator",
        body: "@hudson hi",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("serves runtime bootstrap config for the client", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/bootstrap.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    const body = await response.text();
    expect(body).toContain('"terminalRelayPath":"/ws/terminal"');
    expect(body).toContain('"terminalRelayHealthPath":"/ws/terminal/health"');
    expect(body).toContain('"terminalRunPath":"/api/terminal/run"');
    expect(body).toContain('"vantageOpenPath":"/api/vantage/open"');
  });

  test("creates Vantage handoffs through the configured native hook", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      createVantageHandoff: async (input) => {
        calls.push(input);
        return {
          ok: true,
          schema: "openscout.vantage.handoff.v1",
          handoffId: "handoff-test",
          handoffPath: "/tmp/openscout/vantage/handoff-test.json",
          setupPath: "/tmp/openscout/vantage/handoff-test.setup.json",
          openUrl: "openscout-vantage://handoff?id=handoff-test",
          launch: { attempted: true, ok: true, error: null },
          plan: {
            schema: "scout.vantage.plan.v1",
            createdAt: "2026-05-17T00:00:00.000Z",
            currentDirectory: "/tmp/openscout",
            broker: { reachable: false, baseUrl: null, nodeId: null },
            manifest: {
              kind: "hudson.vantage.setup",
              schemaVersion: 1,
              workspaceID: "openscout-openscout",
              source: "openscout",
              generatedAt: "2026-05-17T00:00:00.000Z",
              currentDirectory: "/tmp/openscout",
              broker: null,
              focus: { agentId: "agent-1" },
              selectedAgentIds: [],
              selectedNativeSessionIds: [],
              selection: [],
              focused: null,
              focusedNodeId: null,
              nodes: [],
            },
            diagnostics: [],
          },
        };
      },
    });

    const response = await server.app.request("http://localhost/api/vantage/open", {
      method: "POST",
      body: JSON.stringify({ agentId: "agent-1", launch: false }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      handoffId: "handoff-test",
      openUrl: "openscout-vantage://handoff?id=handoff-test",
    });
    expect(calls).toEqual([
      {
        currentDirectory: "/tmp/openscout",
        agentId: "agent-1",
        agentIds: [],
        nativeSessionIds: [],
        nativeSessions: [],
        launch: false,
      },
    ]);
  });

  test("reveals local paths through the configured reveal hook", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-web-reveal-"));
    testDirectories.add(root);
    mkdirSync(join(root, "sessions"), { recursive: true });
    const transcriptPath = join(root, "sessions", "session.jsonl");
    writeFileSync(transcriptPath, "{}\n", "utf8");
    const realTranscriptPath = realpathSync(transcriptPath);
    agentObservePayloadResult = {
      agentId: "agent-1",
      source: "history",
      fidelity: "timestamped",
      historyPath: transcriptPath,
      sessionId: "session-1",
      updatedAt: Date.now(),
      data: {
        events: [],
        files: [],
        metadata: {
          session: {
            cwd: root,
            threadPath: "sessions/session.jsonl",
          },
        },
      },
    };
    const revealedPaths: string[] = [];
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      revealPath: (targetPath) => {
        revealedPaths.push(targetPath);
      },
    });

    const response = await server.app.request("http://localhost/api/local-path/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "sessions/session.jsonl",
        basePath: root,
        agentId: "agent-1",
        sessionId: "session-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, path: realTranscriptPath });
    expect(revealedPaths).toEqual([realTranscriptPath]);
  });

  test("rejects reveal requests for paths outside the observed session", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-web-reveal-"));
    testDirectories.add(root);
    mkdirSync(join(root, "sessions"), { recursive: true });
    const transcriptPath = join(root, "sessions", "session.jsonl");
    writeFileSync(transcriptPath, "{}\n", "utf8");
    writeFileSync(join(root, "secret.txt"), "not in observe payload\n", "utf8");
    agentObservePayloadResult = {
      agentId: "agent-1",
      source: "history",
      fidelity: "timestamped",
      historyPath: transcriptPath,
      sessionId: "session-1",
      updatedAt: Date.now(),
      data: {
        events: [],
        files: [],
        metadata: {
          session: {
            cwd: root,
            threadPath: "sessions/session.jsonl",
          },
        },
      },
    };
    const revealedPaths: string[] = [];
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      revealPath: (targetPath) => {
        revealedPaths.push(targetPath);
      },
    });

    const response = await server.app.request("http://localhost/api/local-path/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "secret.txt",
        basePath: root,
        agentId: "agent-1",
        sessionId: "session-1",
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "path is not part of the observed session" });
    expect(revealedPaths).toEqual([]);
  });

  test("serves the local portal only for the portal host on the same app port", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      advertisedHost: "m1.scout.local",
      portalHost: "scout.local",
    });

    const response = await server.app.request("http://127.0.0.1:4321/", {
      headers: { host: "scout.local:4321" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("Scout local");
    expect(body).toContain("m1.scout.local");
    expect(body).toContain('href="http://m1.scout.local:4321/"');
  });

  test("serves the web app directly for the node host without a portal redirect", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      advertisedHost: "m1.scout.local",
      portalHost: "scout.local",
    });

    const response = await server.app.request("http://127.0.0.1:4321/", {
      headers: { host: "m1.scout.local:4321" },
    });

    expect(response.status).toBe(200);
    expect(response.redirected).toBe(false);
    expect(await response.text()).toContain("<body>ok</body>");
  });

  test("loads and updates local agent config through the web API", async () => {
    const home = useIsolatedOpenScoutHome();
    const projectRoot = join(home, "dev", "openscout");
    mkdirSync(projectRoot, { recursive: true });
    await writeRelayAgentOverrides({
      scoutbot: {
        agentId: "scoutbot",
        definitionId: "scoutbot",
        displayName: "Scoutbot",
        projectName: "OpenScout",
        projectRoot,
        source: "manual",
        systemPrompt: "Scoutbot prompt",
        launchArgs: ["--color", "never", "--model", "gpt-5.3-codex"],
        runtime: {
          cwd: projectRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "scoutbot-codex",
          wakePolicy: "on_demand",
        },
      },
    });
    const agentId = buildRelayAgentInstance("scoutbot", projectRoot).id;
    const server = await createOpenScoutWebServer({
      currentDirectory: projectRoot,
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const getResponse = await server.app.request(
      `http://localhost/api/agents/${agentId}/config`,
    );
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toMatchObject({
      model: "gpt-5.3-codex",
      systemPrompt: "Scoutbot prompt",
    });

    const postResponse = await server.app.request(
      `http://localhost/api/agents/${agentId}/config`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.4-mini",
          systemPrompt: "Updated Scoutbot prompt",
          restart: false,
        }),
      },
    );

    expect(postResponse.status).toBe(200);
    const postJson = await postResponse.json() as {
      config: { model: string | null; systemPrompt: string; launchArgs: string[] };
      restarted: boolean;
    };
    expect(postJson).toMatchObject({
      restarted: false,
      config: {
        model: "gpt-5.4-mini",
        systemPrompt: "Updated Scoutbot prompt",
      },
    });
    expect(postJson.config.launchArgs.join("\n")).toContain("gpt-5.4-mini");
    expect(postJson.config.launchArgs.join("\n")).not.toContain("gpt-5.3-codex");
  });

  test("derives the relay health route from the configured relay path by default", async () => {
    const originalRelayPath = process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH;
    const originalRelayHealthPath = process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HEALTH_PATH;
    process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH = "/ws/relay";
    delete process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HEALTH_PATH;

    try {
      const server = await createOpenScoutWebServer({
        currentDirectory: "/tmp/openscout",
        assetMode: "static",
        staticRoot: makeStaticRoot(),
      });

      const response = await server.app.request("http://localhost/api/bootstrap.js");
      const body = await response.text();
      expect(body).toContain('"terminalRelayPath":"/ws/relay"');
      expect(body).toContain('"terminalRelayHealthPath":"/ws/relay/health"');
    } finally {
      if (originalRelayPath === undefined) {
        delete process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH;
      } else {
        process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH = originalRelayPath;
      }
      if (originalRelayHealthPath === undefined) {
        delete process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HEALTH_PATH;
      } else {
        process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HEALTH_PATH = originalRelayHealthPath;
      }
    }
  });

  test("serves terminal relay health at the configured route", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      terminalRelayHealthcheck: async () => true,
    });

    const okResponse = await server.app.request("http://localhost/ws/terminal/health");
    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({
      ok: true,
      surface: "openscout-terminal-relay",
    });

    const unavailableServer = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const unavailableResponse = await unavailableServer.app.request("http://localhost/ws/terminal/health");
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.json()).toEqual({
      ok: false,
      surface: "openscout-terminal-relay",
    });
  });

  test("routes channel sends through sendScoutMessage", async () => {
    querySessionByIdImpl = () => ({
      kind: "channel",
      agentId: null,
      participantIds: ["operator", "agent-1", "agent-2"],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Team update",
        conversationId: "channel.ops",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutMessageCalls).toEqual([
      {
        senderId: "operator",
        body: "Team update",
        channel: "ops",
        currentDirectory: "/tmp/openscout",
      },
    ]);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
  });

  test("routes direct DM asks through askScoutQuestion and rejects channel asks", async () => {
    querySessionByIdImpl = (conversationId) => {
      if (conversationId === "dm.operator.agent-1") {
        return {
          kind: "direct",
          agentId: "agent-1",
          participantIds: ["operator", "agent-1"],
        };
      }
      return {
        kind: "channel",
        agentId: null,
        participantIds: ["operator", "agent-1", "agent-2"],
      };
    };

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const dmResponse = await server.app.request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Please own this and report back.",
        conversationId: "dm.operator.agent-1",
      }),
    });
    expect(dmResponse.status).toBe(200);
    expect(askScoutQuestionCalls).toEqual([
      {
        senderId: "operator",
        targetLabel: "agent-1",
        targetAgentId: "agent-1",
        body: "Please own this and report back.",
        currentDirectory: "/tmp/openscout",
      },
    ]);

    const channelResponse = await server.app.request(
      "http://localhost/api/ask",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: "Someone take this.",
          conversationId: "channel.ops",
        }),
      },
    );
    expect(channelResponse.status).toBe(400);
    expect(await channelResponse.json()).toEqual({
      error: "ask is only available in a direct conversation with one agent",
    });
  });

  test("routes Scoutbot ask actions through askScoutQuestion", async () => {
    const home = useIsolatedOpenScoutHome();
    process.env.OPENSCOUT_HOME = join(home, ".openscout");
    process.env.OPENSCOUT_OPERATOR_NAME = "operator";

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request(
      "http://localhost/api/scoutbot/actions/ask",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetLabel: "hudson",
          targetAgentId: "agent-hudson",
          body: "Can you check the broker handoff path?",
          channel: "ops",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      targetLabel: "hudson",
      conversationId: "dm.operator.agent-1",
      messageId: "msg-ask-1",
      flightId: "flt-ask-1",
      targetAgentId: "agent-1",
    });
    expect(askScoutQuestionCalls).toEqual([
      {
        senderId: "operator",
        targetLabel: "hudson",
        targetAgentId: "agent-hudson",
        body: "Can you check the broker handoff path?",
        channel: "ops",
        currentDirectory: "/tmp/openscout",
      },
    ]);
  });

  test("runs Scoutbot assistant through direct OpenAI control loop", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL = "gpt-test-scoutbot";
    const fetchCalls: Array<{
      input: string;
      body: Record<string, unknown>;
      authorization: string | null;
    }> = [];
    globalThis.fetch = (async (input, init) => {
      fetchCalls.push({
        input: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({
        id: "resp_scoutbot_1",
        output_text: [
          "The control plane is quiet.",
          "```scout-ui",
          "{\"type\":\"navigate\",\"route\":{\"view\":\"fleet\"}}",
          "```",
        ].join("\n"),
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/scoutbot/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "what's going on?",
        route: { view: "fleet" },
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as {
      reply: { body: string };
      session: { messageCount: number; messages: Array<{ role: string; body: string }> };
      responseId: string | null;
    };
    expect(json.reply.body).toContain("control plane is quiet");
    expect(json.responseId).toBe("resp_scoutbot_1");
    expect(json.session.messageCount).toBe(2);
    expect(json.session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(askScoutQuestionCalls).toHaveLength(0);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].input).toBe("https://api.openai.com/v1/responses");
    expect(fetchCalls[0].authorization).toBe("Bearer sk-test");
    expect(fetchCalls[0].body).toMatchObject({
      model: "gpt-test-scoutbot",
      instructions: expect.stringContaining("not a peer agent"),
    });
    expect(JSON.stringify(fetchCalls[0].body)).toContain("Current Scout control-plane snapshot");
    expect(JSON.stringify(fetchCalls[0].body)).toContain("currentRoute");
    expect(JSON.stringify(fetchCalls[0].body)).toContain("fleet");
  });

  test("creates a structured Scoutbot one-minute brief with TTL", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchCalls: Array<{
      body: Record<string, unknown>;
      authorization: string | null;
    }> = [];
    globalThis.fetch = (async (_input, init) => {
      fetchCalls.push({
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({
        id: "resp_brief_1",
        output_text: JSON.stringify({
          title: "One-minute brief",
          summary: "The system is quiet.",
          steps: [
            {
              id: "fleet",
              label: "Fleet",
              route: { view: "fleet" },
              narration: "Fleet is quiet: no active work and available agents are standing by.",
            },
            {
              id: "ops",
              label: "Ops Tail",
              route: { view: "ops", mode: "tail" },
              narration: "Ops tail has no fresh failures in the current window.",
            },
          ],
          recommendation: "Start by checking the stale active Scout item.",
          actions: [
            { label: "Open Ops Tail", route: { view: "ops", mode: "tail" } },
          ],
        }),
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/scoutbot/brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        route: { view: "fleet" },
        ttlMs: 180_000,
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as {
      ttlMs: number;
      preparedAt: number;
      expiresAt: number;
      steps: Array<{ label: string; route: Record<string, unknown>; snapshot: { expiresAt: number } }>;
      recommendation: string;
      actions: Array<{ label: string; route: Record<string, unknown> }>;
    };
    expect(json.ttlMs).toBe(180_000);
    expect(json.expiresAt - json.preparedAt).toBe(180_000);
    expect(json.steps).toEqual([
      expect.objectContaining({
        label: "Fleet",
        route: { view: "fleet" },
        snapshot: expect.objectContaining({ expiresAt: json.expiresAt }),
      }),
      expect.objectContaining({
        label: "Ops Tail",
        route: { view: "ops", mode: "tail" },
      }),
    ]);
    expect(json.recommendation).toContain("stale active Scout item");
    expect(json.actions).toEqual([
      expect.objectContaining({
        label: "Open Ops Tail",
        route: { view: "ops", mode: "tail" },
      }),
    ]);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].authorization).toBe("Bearer sk-test");
    expect(fetchCalls[0].body).toMatchObject({
      instructions: expect.stringContaining("Brief output mode (SCO-037 v1)"),
    });
    expect(JSON.stringify(fetchCalls[0].body)).toContain("currentRoute");
    expect(JSON.stringify(fetchCalls[0].body)).toContain("Prepare a one-minute OpenScout control-plane brief");
    expect(JSON.stringify(fetchCalls[0].body)).toContain("180 seconds");
    expect(askScoutQuestionCalls).toHaveLength(0);
  });

  test("caches the fleet home brief until its thirty-minute TTL expires", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchCalls: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      fetchCalls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({
        id: "resp_fleet_home_brief",
        output_text: JSON.stringify({
          title: "Fleet brief",
          summary: "The local fleet is steady.",
          steps: [
            {
              id: "fleet",
              label: "Fleet",
              route: { view: "fleet" },
              narration: "Fleet is steady: no blocked asks, and organic sessions are visible in the recent tail.",
            },
          ],
          recommendation: "Open the tail if you want the freshest organic session detail.",
          actions: [],
        }),
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const first = await server.app.request("http://localhost/api/fleet/brief");
    const second = await server.app.request("http://localhost/api/fleet/brief");
    const refreshed = await server.app.request("http://localhost/api/fleet/brief?refresh=1");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(refreshed.status).toBe(200);
    const firstJson = await first.json() as { statement: string; ttlMs: number; sourceBriefId: string; observations: unknown[] };
    const secondJson = await second.json() as { statement: string; ttlMs: number; sourceBriefId: string };
    const refreshedJson = await refreshed.json() as { statement: string; ttlMs: number; sourceBriefId: string };
    expect(firstJson.statement).toBe("Fleet is steady: no blocked asks, and organic sessions are visible in the recent tail.");
    expect(firstJson.observations).toHaveLength(1);
    expect(firstJson.ttlMs).toBe(30 * 60_000);
    expect(secondJson.sourceBriefId).toBe(firstJson.sourceBriefId);
    expect(refreshedJson.ttlMs).toBe(30 * 60_000);
    expect(fetchCalls).toHaveLength(2);
    expect(JSON.stringify(fetchCalls[0])).toContain("1800 seconds");
    expect(JSON.stringify(fetchCalls[0])).toContain("Fleet-home hero mode");
    expect(JSON.stringify(fetchCalls[0])).toContain("Do NOT use the Fleet narration to repeat those counters");
    expect(JSON.stringify(fetchCalls[0])).toContain("what deserves the operator's next 30 seconds");
    expect(JSON.stringify(fetchCalls[0])).toContain("subtle signal could fall through the cracks");
    expect(JSON.stringify(fetchCalls[0])).toContain("stale or hidden obligations");
    expect(JSON.stringify(fetchCalls[0])).toContain("Each finding paragraph is one distinct observation");
    expect(JSON.stringify(fetchCalls[0])).toContain("clickable references must be grounded in concrete IDs");
    expect(JSON.stringify(fetchCalls[0])).toContain("briefingEvidence.agentLogMessages");
    expect(JSON.stringify(fetchCalls[0])).toContain("Bad pattern: inventory counter sentence.");
    expect(JSON.stringify(fetchCalls[0])).toContain("Never copy the examples or schema placeholders.");
  });

  test("stores and dismisses Scoutbot reminders without an OpenAI key", async () => {
    useIsolatedOpenScoutHome();
    delete process.env.OPENAI_API_KEY;
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const createResponse = await server.app.request("http://localhost/api/scoutbot/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "check lattices status",
        delayMs: 180_000,
        context: { route: { view: "fleet" } },
      }),
    });

    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as {
      reminder: { id: string; body: string; status: string; dueAt: number };
      scheduled: Array<{ id: string }>;
      due: Array<{ id: string }>;
    };
    expect(created.reminder.body).toBe("check lattices status");
    expect(created.reminder.status).toBe("scheduled");
    expect(created.reminder.dueAt).toBeGreaterThan(Date.now());
    expect(created.scheduled).toEqual([expect.objectContaining({ id: created.reminder.id })]);
    expect(created.due).toEqual([]);

    const dueResponse = await server.app.request("http://localhost/api/scoutbot/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "read current status",
        dueAt: Date.now() - 1000,
      }),
    });
    const due = await dueResponse.json() as {
      reminder: { id: string; status: string };
      due: Array<{ id: string; status: string }>;
    };
    expect(due.reminder.status).toBe("due");
    expect(due.due).toEqual([expect.objectContaining({ id: due.reminder.id, status: "due" })]);

    const dismissResponse = await server.app.request(`http://localhost/api/scoutbot/reminders/${due.reminder.id}/dismiss`, {
      method: "POST",
    });
    expect(dismissResponse.status).toBe(200);
    const dismissed = await dismissResponse.json() as {
      due: Array<{ id: string }>;
      reminders: Array<{ id: string; status: string }>;
    };
    expect(dismissed.due.find((reminder) => reminder.id === due.reminder.id)).toBeUndefined();
    expect(dismissed.reminders.find((reminder) => reminder.id === due.reminder.id)?.status).toBe("dismissed");
  });

  test("returns a setup error when Scoutbot assistant has no OpenAI key", async () => {
    useIsolatedOpenScoutHome();
    delete process.env.OPENAI_API_KEY;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/scoutbot/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "state?" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "An OpenAI API key is required for Scoutbot assistant. Add one in Settings > Credentials or set OPENAI_API_KEY.",
    });
    expect(fetchCalled).toBe(false);
  });

  test("does not use a transient request supplied OpenAI key for Scoutbot assistant", async () => {
    useIsolatedOpenScoutHome();
    delete process.env.OPENAI_API_KEY;
    let fetchCalled = false;
    globalThis.fetch = (async (_input, init) => {
      fetchCalled = true;
      void init;
      return new Response(JSON.stringify({
        id: "resp_scoutbot_request_key",
        output_text: "Request key works.",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/scoutbot/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "state?",
        openaiApiKey: "sk-request-test",
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "An OpenAI API key is required for Scoutbot assistant. Add one in Settings > Credentials or set OPENAI_API_KEY.",
    });
    expect(fetchCalled).toBe(false);
  });

  test("saves and uses the local Scoutbot OpenAI credential store", async () => {
    useIsolatedOpenScoutHome();
    delete process.env.OPENAI_API_KEY;
    const fetchCalls: Array<{ authorization: string | null }> = [];
    globalThis.fetch = (async (_input, init) => {
      fetchCalls.push({
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({
        id: "resp_scoutbot_local_store_key",
        output_text: "Local store key works.",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const saveResponse = await server.app.request("http://localhost/api/scoutbot/credentials/openai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-local-store-test" }),
    });
    expect(saveResponse.status).toBe(200);
    expect(await saveResponse.json()).toEqual({
      openai: {
        configured: true,
        source: "local-store",
        preview: "sk-lo...test",
      },
    });

    const credentialFile = join(process.env.OPENSCOUT_CONTROL_HOME ?? "", "scoutbot-credentials.json");
    expect(readFileSync(credentialFile, "utf8")).not.toContain("sk-local-store-test");

    const chatResponse = await server.app.request("http://localhost/api/scoutbot/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "state?" }),
    });
    expect(chatResponse.status).toBe(200);
    expect(fetchCalls).toEqual([{ authorization: "Bearer sk-local-store-test" }]);

    const deleteResponse = await server.app.request("http://localhost/api/scoutbot/credentials/openai", {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({
      openai: {
        configured: false,
        source: "missing",
        preview: null,
      },
    });
  });

  test("uses the local Scout relay OpenAI key for Scoutbot assistant", async () => {
    delete process.env.OPENAI_API_KEY;
    scoutRelayConfigResult = { openaiApiKey: "sk-relay-test" };
    const fetchCalls: Array<{ authorization: string | null }> = [];
    globalThis.fetch = (async (_input, init) => {
      fetchCalls.push({
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({
        id: "resp_scoutbot_relay_key",
        output_text: "Relay key works.",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/scoutbot/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "state?" }),
    });

    expect(response.status).toBe(200);
    expect(fetchCalls).toEqual([{ authorization: "Bearer sk-relay-test" }]);
  });

  test("proxies UI routes to the configured Vite dev server", async () => {
    const fetchCalls: Array<{
      input: string;
      init: RequestInit | undefined;
    }> = [];
    globalThis.fetch = (async (input, init) => {
      fetchCalls.push({
        input: String(input),
        init,
      });
      return new Response("<!doctype html><html><body>vite</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "vite-proxy",
      viteDevUrl: "http://127.0.0.1:5180",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request(
      "http://localhost/agents/demo?tab=inbox",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("vite");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.input).toBe(
      "http://127.0.0.1:5180/agents/demo?tab=inbox",
    );
    expect(fetchCalls[0]?.init?.method).toBe("GET");
    expect(fetchCalls[0]?.init?.headers).toBeInstanceOf(Headers);
    expect(fetchCalls[0]?.init?.body).toBeUndefined();
  });
});
