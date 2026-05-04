import { beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionBlock, BlockState, QuestionBlock, SessionState } from "@openscout/agent-sessions";
import {
  buildRelayAgentInstance,
  writeRelayAgentOverrides,
} from "@openscout/runtime/setup";

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
const originalNodeQualifier = process.env.OPENSCOUT_NODE_QUALIFIER;
const sendScoutMessageCalls: Array<Record<string, unknown>> = [];
const sendScoutDirectMessageCalls: Array<Record<string, unknown>> = [];
const askScoutQuestionCalls: Array<Record<string, unknown>> = [];
const queryRunsCalls: Array<Record<string, unknown>> = [];
const decidePairingApprovalCalls: Array<Record<string, unknown>> = [];
const testDirectories = new Set<string>();
let scoutBrokerContextResult: unknown = null;
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
mock.module("./db-queries.ts", () => ({
  configureReadonlyDb: (db: { exec(sql: string): void }) => {
    db.exec("PRAGMA busy_timeout = 250");
    db.exec("PRAGMA query_only = ON");
  },
  queryAgents: () => [],
  queryActivity: () => [],
  queryBrokerDiagnostics: () => ({
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
  }),
  queryHeartrate: () => [],
  queryFleet: () => ({
    generatedAt: Date.now(),
    totals: { active: 0, recentCompleted: 0, needsAttention: 0, activity: 0 },
    activeAsks: [],
    recentCompleted: [],
    needsAttention: [],
    activity: [],
  }),
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
  loadScoutBrokerContext: async () => scoutBrokerContextResult,
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
  sendScoutDirectMessage: async (input: Record<string, unknown>) => {
    sendScoutDirectMessageCalls.push(input);
    return sendScoutDirectMessageResult;
  },
  askScoutQuestion: async (input: Record<string, unknown>) => {
    askScoutQuestionCalls.push(input);
    return askScoutQuestionResult;
  },
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
  querySessionByIdImpl = () => null;
  scoutBrokerContextResult = null;
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
  pairingStateResult = makePairingState();
  pairingSessionSnapshotsResult = [];
  sendScoutMessageCalls.length = 0;
  sendScoutDirectMessageCalls.length = 0;
  askScoutQuestionCalls.length = 0;
  queryRunsCalls.length = 0;
  decidePairingApprovalCalls.length = 0;
});

afterEach(() => {
  process.env.HOME = originalHome;
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

  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

describe("createOpenScoutWebServer", () => {
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

  test("includes session attention in operator attention and dedupes pairing approvals", async () => {
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
      ranger: {
        agentId: "ranger",
        definitionId: "ranger",
        displayName: "Ranger",
        projectName: "OpenScout",
        projectRoot,
        source: "manual",
        systemPrompt: "Ranger prompt",
        launchArgs: ["--color", "never", "--model", "gpt-5.3-codex"],
        runtime: {
          cwd: projectRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "ranger-codex",
          wakePolicy: "on_demand",
        },
      },
    });
    const agentId = buildRelayAgentInstance("ranger", projectRoot).id;
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
      systemPrompt: "Ranger prompt",
    });

    const postResponse = await server.app.request(
      `http://localhost/api/agents/${agentId}/config`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.4-mini",
          systemPrompt: "Updated Ranger prompt",
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
        systemPrompt: "Updated Ranger prompt",
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
