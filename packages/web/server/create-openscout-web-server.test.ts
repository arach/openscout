import { afterAll, beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionBlock, BlockState, QuestionBlock, SessionState } from "@openscout/agent-sessions";
import type { DiscoverySnapshot } from "@openscout/runtime/tail";
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
const originalProbesSocket = process.env.OPENSCOUT_PROBES_SOCKET;
const sendScoutMessageCalls: Array<Record<string, unknown>> = [];
const sendScoutConversationMessageCalls: Array<Record<string, unknown>> = [];
const sendScoutConversationSteerCalls: Array<Record<string, unknown>> = [];
const sendScoutDirectMessageCalls: Array<Record<string, unknown>> = [];
const askScoutQuestionCalls: Array<Record<string, unknown>> = [];
const openScoutDirectSessionCalls: Array<Record<string, unknown>> = [];
const upsertScoutConversationCalls: Array<Record<string, unknown>> = [];
const queryRunsCalls: Array<Record<string, unknown>> = [];
const decidePairingApprovalCalls: Array<Record<string, unknown>> = [];
const lanBeaconSuppressPredicates: Array<() => boolean | Promise<boolean>> = [];
const testDirectories = new Set<string>();
let scoutBrokerContextResult: unknown = null;
let agentObservePayloadResult: unknown = null;
let sessionRefObservePayloadResult: unknown = null;
let queryAgentsResult: Array<Record<string, unknown>> = [];
let queryTerminalSessionsResult: Array<Record<string, unknown>> = [];
let queryDiscoveredTerminalSessionsResult: Array<Record<string, unknown>> = [];
let brokerDiagnosticsResult: Record<string, unknown> = makeBrokerDiagnostics();
let pairingStateResult: Record<string, unknown> = makePairingState();
let pairingSessionSnapshotsResult: SessionState[] = [];
let queryFleetResult: Record<string, unknown> | null = null;

let querySessionByIdImpl: (conversationId: string) => {
  id?: string;
  kind: string;
  agentId: string | null;
  participantIds: string[];
} | null = () => null;
let queryConversationDefinitionByIdImpl: (conversationId: string) => {
  id: string;
  kind: string;
  title: string;
  visibility: string;
  shareMode: string;
  authorityNodeId: string;
  topic: string | null;
  parentConversationId: string | null;
  messageId: string | null;
  metadata: Record<string, unknown>;
  participantIds: string[];
} | null = () => null;
let openScoutDirectSessionResult: Record<string, unknown> = {
  agent: { id: "agent-1" },
  conversation: {
    id: "c.agent-1",
    kind: "direct",
    title: "Agent One",
    visibility: "private",
    shareMode: "local",
    authorityNodeId: "node-1",
    participantIds: ["agent-1", "operator"],
    metadata: { naturalKey: "direct:agent-1,operator" },
  },
  existed: true,
};
let sendScoutMessageResult: unknown = {
  usedBroker: true,
  invokedTargets: [],
  unresolvedTargets: [],
};
let sendScoutDirectMessageResult: unknown = {
  conversationId: "c.agent-1",
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
  conversationId: "c.agent-1",
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
  queryAgentById: (agentId: string) =>
    queryAgentsResult.find((agent) => agent.id === agentId) ?? null,
  queryAgents: () => queryAgentsResult,
  queryActivity: () => [],
  queryBrokerDiagnostics: () => brokerDiagnosticsResult,
  queryConversationDefinitionById: (conversationId: string) =>
    queryConversationDefinitionByIdImpl(conversationId),
  queryHeartrate: () => [],
  queryFleet: () => queryFleetResult ?? ({
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
  queryTerminalSessions: () => queryTerminalSessionsResult,
  queryRecentMessages: () => [],
  querySessions: () => [],
  querySessionById: (conversationId: string) =>
    querySessionByIdImpl(conversationId),
  queryWorkItems: () => [],
  queryWorkItemById: () => null,
}));

mock.module("./terminal-session-discovery.ts", () => ({
  parseTmuxSessionList: (output: string) => output
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.includes("|") ? splitDelimitedLine(line, "|", 5) : splitDelimitedLine(line, "\t", 5);
      const [name, windows, attached, currentCommand, currentPath] = parts;
      return {
        name,
        windows: Number.parseInt(windows ?? "1", 10),
        attached: Number.parseInt(attached ?? "0", 10),
        currentCommand: cleanOptionalString(currentCommand),
        currentPath: cleanOptionalString(currentPath),
      };
    }),
  parseZellijSessionList: (output: string) => output
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      name: line.split(/\s+/u)[0] ?? "",
      state: /\bEXITED\b/iu.test(line) ? "exited" : "live",
      raw: line,
    })),
  queryDiscoveredTerminalSessions: () => queryDiscoveredTerminalSessionsResult,
  terminalSurfaceKey: (backend: string, sessionName: string) => `${backend}:${sessionName}`,
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

mock.module("./pairing-lan-beacon.ts", () => ({
  startScoutPairLanBeacon: (shouldSuppressBeacon: () => boolean | Promise<boolean>) => {
    lanBeaconSuppressPredicates.push(shouldSuppressBeacon);
    return { stop() {} };
  },
}));

mock.module("./core/broker/service.ts", () => ({
  appendScoutCollaborationEvent: async () => null,
  loadScoutBrokerContext: async () => scoutBrokerContextResult,
  loadScoutReadCursors: async () => ({}),
  loadScoutRelayConfig: async () => scoutRelayConfigResult,
  markScoutConversationRead: async () => null,
  normalizeOutgoingAttachments: (attachments: Array<Record<string, unknown>> | undefined) => {
    const normalized = attachments
      ?.filter((attachment) => typeof attachment.mediaType === "string" && (attachment.url || attachment.blobKey))
      .map((attachment, index) => ({
        id: typeof attachment.id === "string" && attachment.id.trim() ? attachment.id : `att-test-${index}`,
        mediaType: attachment.mediaType,
        fileName: attachment.fileName,
        url: attachment.url,
        blobKey: attachment.blobKey,
      }));
    return normalized?.length ? normalized : undefined;
  },
  registerScoutLocalAgentBinding: async () => null,
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
  resolveScoutBrokerAdvertiseUrl: () => "http://broker.test",
  retireScoutLocalAgentBinding: async () => false,
  sendScoutMessage: async (input: Record<string, unknown>) => {
    sendScoutMessageCalls.push(input);
    return sendScoutMessageResult;
  },
  sendScoutConversationMessage: async (input: Record<string, unknown>) => {
    sendScoutConversationMessageCalls.push(input);
    return sendScoutMessageResult;
  },
  sendScoutConversationSteer: async (input: Record<string, unknown>) => {
    sendScoutConversationSteerCalls.push(input);
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
  openScoutDirectSession: async (input: Record<string, unknown>) => {
    openScoutDirectSessionCalls.push(input);
    return {
      ...openScoutDirectSessionResult,
      input,
    };
  },
  upsertScoutConversation: async (input: Record<string, unknown>) => {
    upsertScoutConversationCalls.push(input);
  },
  upsertScoutFlight: async () => null,
}));

mock.module("./core/observe/service.ts", () => ({
  loadAgentObservePayload: async () => agentObservePayloadResult,
  loadAgentObserveSummaries: async () => [],
  loadSessionRefObservePayload: async () => sessionRefObservePayloadResult,
}));

const { createOpenScoutWebServer } =
  await import("./create-openscout-web-server.ts");
const { resetScoutVoiceSessionStateForTests } =
  await import("./scout-voice-session.ts");
const {
  gitBuildInfoProbe,
  resetScoutdProbeClientForTests,
} = await import("@openscout/runtime/system-probes");

mock.restore();

afterAll(() => {
  mock.restore();
});

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

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function cleanOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitDelimitedLine(line: string, delimiter: "|" | "\t", fieldCount: number): string[] {
  const parts = line.split(delimiter);
  if (parts.length <= fieldCount) return parts;
  return [...parts.slice(0, fieldCount - 1), parts.slice(fieldCount - 1).join(delimiter)];
}

function makeDiscoverySnapshot(generatedAt: number): DiscoverySnapshot {
  return {
    generatedAt,
    processes: [],
    transcripts: [],
    totals: {
      total: 0,
      scoutManaged: 0,
      hudsonManaged: 0,
      unattributed: 0,
      transcripts: 0,
    },
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

async function waitForTestCondition(condition: () => boolean, timeoutMs = 250): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition was not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
    lanDiscoveryAdvertised: false,
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
    ledger: {
      mode: "latest",
      limit: 160,
      cursor: null,
      cursors: {
        attempts: null,
        failedQueries: null,
        failedDeliveries: null,
        dialogue: null,
      },
      hasMore: {
        attempts: false,
        failedQueries: false,
        failedDeliveries: false,
        dialogue: false,
      },
    },
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

function makeA2aBrokerContext(overrides: {
  agent?: Record<string, unknown>;
  endpoint?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  const agentId = "weather-a2a.local";
  const nodeId = "node-1";
  const agent = {
    id: agentId,
    kind: "agent",
    definitionId: agentId,
    displayName: "Weather A2A Agent",
    handle: "weather-a2a",
    labels: ["weather-a2a"],
    selector: "weather-a2a",
    agentClass: "general",
    capabilities: ["chat", "invoke"],
    wakePolicy: "on_demand",
    homeNodeId: nodeId,
    authorityNodeId: nodeId,
    advertiseScope: "local",
    ownerId: "operator",
    metadata: {
      brokerRegistered: true,
      project: "openscout-a2a-sidecar",
      role: "weather",
      branch: "main",
      createdAt: 1_700_000_000_000,
      a2aAgentCard: {
        provider: {
          organization: "OpenScout Protocol Lab",
          url: "https://openscout.local",
        },
        skills: [
          {
            id: "weatherTool",
            name: "weatherTool",
            description: "Get current weather for a location",
          },
        ],
      },
      supportedInterfaces: [
        {
          name: "A2A JSON-RPC",
          protocol: "a2a",
          url: "http://127.0.0.1:4111/api/a2a/weather-agent",
        },
      ],
    },
    ...(overrides.agent ?? {}),
  };
  const endpoint = {
    id: "endpoint.weather-a2a.local.a2a",
    agentId,
    nodeId,
    harness: "http",
    transport: "http",
    state: "active",
    address: "http://127.0.0.1:4111/api/a2a/weather-agent",
    projectRoot: "/tmp/openscout-a2a-sidecar",
    cwd: "/tmp/openscout-a2a-sidecar",
    metadata: {
      a2aContextId: "ctx-weather",
      a2aExecutionUrl: "http://127.0.0.1:4111/api/a2a/weather-agent",
      lastCompletedAt: 1_700_000_100_000,
    },
    ...(overrides.endpoint ?? {}),
  };
  return {
    baseUrl: "http://broker.test",
    node: {
      id: nodeId,
      meshId: "mesh-1",
      name: "Test node",
      advertiseScope: "local",
      registeredAt: 1_700_000_000_000,
    },
    snapshot: {
      nodes: {
        [nodeId]: {
          id: nodeId,
          meshId: "mesh-1",
          name: "Test node",
          advertiseScope: "local",
          registeredAt: 1_700_000_000_000,
        },
      },
      actors: {
        operator: {
          id: "operator",
          kind: "operator",
          displayName: "Operator",
          handle: "art",
        },
      },
      agents: {
        [agentId]: agent,
      },
      endpoints: {
        [String(endpoint.id)]: endpoint,
      },
      flights: {},
      ...(overrides.snapshot ?? {}),
    },
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
  process.env.OPENSCOUT_PROBES_SOCKET = join(
    tmpdir(),
    `openscout-web-test-missing-probes-${process.pid}.sock`,
  );
  resetScoutdProbeClientForTests();
  querySessionByIdImpl = () => null;
  queryConversationDefinitionByIdImpl = () => null;
  scoutBrokerContextResult = null;
  agentObservePayloadResult = null;
  sessionRefObservePayloadResult = null;
  sendScoutMessageResult = {
    usedBroker: true,
    invokedTargets: [],
    unresolvedTargets: [],
  };
  openScoutDirectSessionResult = {
    agent: { id: "agent-1" },
    conversation: {
      id: "c.agent-1",
      kind: "direct",
      title: "Agent One",
      visibility: "private",
      shareMode: "local",
      authorityNodeId: "node-1",
      participantIds: ["agent-1", "operator"],
      metadata: { naturalKey: "direct:agent-1,operator" },
    },
    existed: true,
  };
  sendScoutDirectMessageResult = {
    conversationId: "c.agent-1",
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
    conversationId: "c.agent-1",
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
  queryFleetResult = null;
  queryAgentsResult = [];
  queryTerminalSessionsResult = [];
  queryDiscoveredTerminalSessionsResult = [];
  pairingStateResult = makePairingState();
  pairingSessionSnapshotsResult = [];
  sendScoutMessageCalls.length = 0;
  sendScoutConversationMessageCalls.length = 0;
  sendScoutConversationSteerCalls.length = 0;
  sendScoutDirectMessageCalls.length = 0;
  askScoutQuestionCalls.length = 0;
  openScoutDirectSessionCalls.length = 0;
  upsertScoutConversationCalls.length = 0;
  queryRunsCalls.length = 0;
  decidePairingApprovalCalls.length = 0;
  lanBeaconSuppressPredicates.length = 0;
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
  if (originalProbesSocket === undefined) {
    delete process.env.OPENSCOUT_PROBES_SOCKET;
  } else {
    process.env.OPENSCOUT_PROBES_SOCKET = originalProbesSocket;
  }
  resetScoutdProbeClientForTests();

  resetScoutVoiceSessionStateForTests();

  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

describe("createOpenScoutWebServer", () => {
  test("serves /api/build from warmed git.buildInfo without rerunning the probe", async () => {
    const repo = mkdtempSync(join(tmpdir(), "openscout-web-build-info-"));
    testDirectories.add(repo);
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "web-probe@example.com"]);
    git(repo, ["config", "user.name", "Web Probe"]);
    writeFileSync(join(repo, "README.md"), "hello\n", "utf8");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "initial"]);
    const commit = git(repo, ["rev-parse", "--short", "HEAD"]);

    const tailSnapshot = makeDiscoverySnapshot(Date.now());
    const server = await createOpenScoutWebServer({
      currentDirectory: repo,
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      tailRuntime: {
        getTailDiscovery: () => tailSnapshot,
        refreshTailDiscovery: async () => tailSnapshot,
        readRecentTranscriptEvents: async () => [],
        snapshotRecentEvents: () => [],
      },
    });

    await server.warmupCaches();
    const beforeRuns = gitBuildInfoProbe.for(repo).metrics().runCount;

    const response = await server.app.request("http://localhost/api/build");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: expect.any(String),
      branch: "main",
      commit,
      dirty: false,
      mode: "dev",
    });
    expect(gitBuildInfoProbe.for(repo).metrics().runCount).toBe(beforeRuns);
  });

  test("serves static app shell without browser storage", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/broker");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("<body>ok</body>");
  });

  test("does not fall back to app shell for missing static assets", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/assets/index-stale.js");

    expect(response.status).toBe(404);
  });

  test("serves trusted raw files from path-shaped URLs for iframe-relative assets", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-web-raw-file-"));
    testDirectories.add(root);
    mkdirSync(join(root, "reports"), { recursive: true });
    const stylesheetPath = join(root, "reports", "daily summary.css");
    writeFileSync(stylesheetPath, "body { color: red; }\n", "utf8");
    const rawPath = realpathSync(stylesheetPath)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const server = await createOpenScoutWebServer({
      currentDirectory: root,
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request(`http://localhost/api/file/raw${rawPath}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    await expect(response.text()).resolves.toBe("body { color: red; }\n");
  });

  test("serves tail recent immediately while broker refresh is pending", async () => {
    const fetchUrls: string[] = [];
    globalThis.fetch = ((input) => {
      fetchUrls.push(String(input));
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/tail/recent?limit=10");

    expect(response.status).toBe(200);
    expect(fetchUrls[0]).toContain("/v1/tail/recent?limit=10");
    expect(response.headers.get("x-openscout-tail-state")).toBe("empty-refreshing");
    const timing = response.headers.get("server-timing") ?? "";
    expect(timing).toContain("web-tail-cache");
    await expect(response.json()).resolves.toMatchObject({ generatedAt: expect.any(Number), limit: 10, events: [] });
  });

  test("refreshes tail recent cache in the background with server timing from broker", async () => {
    const fetchUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      fetchUrls.push(String(input));
      return new Response(JSON.stringify({
        generatedAt: 1,
        limit: 10,
        cursor: "tail-1",
        events: [{ id: "tail-1", ts: 1 }],
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "server-timing": "tail-live;dur=1.2",
        },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const first = await server.app.request("http://localhost/api/tail/recent?limit=10");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ events: [] });
    await flushPromises();

    const second = await server.app.request("http://localhost/api/tail/recent?limit=10");
    expect(fetchUrls[0]).toContain("/v1/tail/recent?limit=10");
    expect(second.status).toBe(200);
    expect(second.headers.get("x-openscout-tail-state")).toBe("hit-refreshing");
    const timing = second.headers.get("server-timing") ?? "";
    expect(timing).toContain("tail-live;dur=1.2");
    expect(timing).toContain("web-broker-fetch");
    expect(timing).toContain("web-json");
    await expect(second.json()).resolves.toMatchObject({
      generatedAt: 1,
      cursor: "tail-1",
      events: [{ id: "tail-1", ts: 1 }],
    });
  });

  test("forces tail discovery refresh before serving cached broker data", async () => {
    const fetchUrls: string[] = [];
    let brokerGeneratedAt = 0;
    globalThis.fetch = (async (input) => {
      fetchUrls.push(String(input));
      brokerGeneratedAt += 1;
      return new Response(JSON.stringify(makeDiscoverySnapshot(brokerGeneratedAt)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      tailRuntime: {
        getTailDiscovery: async () => makeDiscoverySnapshot(0),
      },
    });

    const first = await server.app.request("http://localhost/api/tail/discover");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ generatedAt: 0 });
    await flushPromises();

    const forced = await server.app.request("http://localhost/api/tail/discover?force=1");

    expect(forced.status).toBe(200);
    expect(fetchUrls.at(-1)).toContain("/v1/tail/discover?force=1");
    await expect(forced.json()).resolves.toMatchObject({ generatedAt: 2 });
  });

  test("serves an empty tail snapshot when broker refresh fails", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "tail_unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "server-timing": "tail-discover;dur=9.4",
        },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const first = await server.app.request("http://localhost/api/tail/recent?limit=10");
    expect(first.status).toBe(200);
    await flushPromises();
    const response = await server.app.request("http://localhost/api/tail/recent?limit=10");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-openscout-tail-state")).toBe("empty-retrying");
    expect(response.headers.get("x-openscout-tail-warning")).toContain("broker tail unavailable (503)");
    const timing = response.headers.get("server-timing") ?? "";
    expect(timing).toContain("tail-discover;dur=9.4");
    expect(timing).toContain("web-broker-fetch");
    await expect(response.json()).resolves.toMatchObject({ limit: 10, events: [] });
  });

  test("keeps strict voice health 503 while serving quiet browser probes as handled readiness", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const strictResponse = await server.app.request("http://localhost/api/voice/health");
    expect(strictResponse.status).toBe(503);
    await expect(strictResponse.json()).resolves.toMatchObject({
      ok: false,
      adapter: "hudson-dictation",
      capture: "native",
    });

    const quietResponse = await server.app.request("http://localhost/api/voice/health?quiet=1");
    expect(quietResponse.status).toBe(200);
    await expect(quietResponse.json()).resolves.toMatchObject({ ok: false });
  });

  test("bridges native voice sessions between the web client and scout voice host", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const registerResponse = await server.app.request("http://localhost/api/voice/host/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hostId: "scout-menu",
        platform: "macos",
        bundle: "app.openscout.scout.menu",
      }),
    });
    expect(registerResponse.status).toBe(200);

    const sessionResponse = await server.app.request("http://localhost/api/voice/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "openscout-web",
        surface: "chat-composer",
      }),
    });
    expect(sessionResponse.status).toBe(200);
    const { sessionId } = await sessionResponse.json() as { sessionId: string };
    expect(sessionId).toMatch(/^scout-voice:/);

    const commandResponse = await server.app.request(
      "http://localhost/api/voice/host/commands?hostId=scout-menu&timeoutMs=1000",
    );
    expect(commandResponse.status).toBe(200);
    await expect(commandResponse.json()).resolves.toMatchObject({
      command: { type: "session.start", sessionId },
    });

    const eventResponse = await server.app.request("http://localhost/api/voice/host/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hostId: "scout-menu",
        sessionId,
        event: "session.final",
        data: { text: "Hello from HudsonKit.", durationMs: 512 },
      }),
    });
    expect(eventResponse.status).toBe(200);
  });

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

  test("serves unified comms from the broker-backed service", async () => {
    scoutBrokerContextResult = {
      snapshot: {
        conversations: {
          "c.agent-1": {
            id: "c.agent-1",
            kind: "direct",
            title: "ignored",
            participantIds: ["operator", "agent-1"],
          },
          "c.general": {
            id: "c.general",
            kind: "channel",
            title: "general",
            participantIds: ["operator", "agent-1"],
            metadata: { channel: "general" },
          },
        },
        messages: {
          "msg-1": {
            id: "msg-1",
            conversationId: "c.agent-1",
            actorId: "agent-1",
            body: "hello from dm",
            createdAt: 1_700_000_000,
          },
          "msg-2": {
            id: "msg-2",
            conversationId: "c.general",
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
    const response = await server.app.request("http://localhost/api/comms");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        chatId: "c.general",
        cId: "c.general",
        id: "c.general",
        kind: "channel",
        preview: "hello from channel",
      }),
      expect.objectContaining({
        chatId: "c.agent-1",
        cId: "c.agent-1",
        id: "c.agent-1",
        kind: "direct",
        preview: "hello from dm",
        harness: "codex",
      }),
    ]);
  });

  test("includes broker-registered agent cards in the agents API", async () => {
    queryAgentsResult = [
      {
        id: "local-agent",
        definitionId: "local-agent",
        name: "Local Agent",
        handle: "local-agent",
        conversationId: "c.local-agent",
      },
    ];
    scoutBrokerContextResult = makeA2aBrokerContext({
      agent: { capabilities: [] },
    });
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const listResponse = await server.app.request("http://localhost/api/agents");

    expect(listResponse.status).toBe(200);
    const agents = await listResponse.json() as Array<Record<string, unknown>>;
    expect(agents.map((agent) => agent.id)).toEqual([
      "local-agent",
      "weather-a2a.local",
    ]);
    const a2aAgent = agents.find((agent) => agent.id === "weather-a2a.local");
    expect(a2aAgent).toMatchObject({
      id: "weather-a2a.local",
      definitionId: "weather-a2a.local",
      name: "Weather A2A Agent",
      handle: "weather-a2a",
      agentClass: "general",
      harness: "http",
      state: "available",
      projectRoot: "/tmp/openscout-a2a-sidecar",
      cwd: "/tmp/openscout-a2a-sidecar",
      transport: "http",
      selector: "weather-a2a",
      wakePolicy: "on_demand",
      capabilities: ["chat", "invoke"],
      project: "openscout-a2a-sidecar",
      branch: "main",
      role: null,
      harnessSessionId: null,
      conversationId: null,
      authorityNodeId: "node-1",
      authorityNodeName: "Test node",
      homeNodeId: "node-1",
      homeNodeName: "Test node",
      ownerId: "operator",
      ownerName: "Operator",
      ownerHandle: "art",
      updatedAt: 1_700_000_100_000,
      createdAt: 1_700_000_000_000,
      providerName: "OpenScout Protocol Lab",
      providerUrl: "https://openscout.local",
      protocol: "A2A",
      skills: ["weatherTool"],
    });

    const detailResponse = await server.app.request(
      "http://localhost/api/agents/weather-a2a",
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      id: "weather-a2a.local",
      handle: "weather-a2a",
      conversationId: null,
    });
  });

  test("keeps database agent rows authoritative when broker cards share an id", async () => {
    queryAgentsResult = [
      {
        id: "weather-a2a.local",
        definitionId: "weather-a2a.local",
        name: "Projected A2A Agent",
        handle: "weather-a2a",
        conversationId: "c.weather-a2a",
      },
    ];
    scoutBrokerContextResult = makeA2aBrokerContext();
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/agents");

    expect(response.status).toBe(200);
    const agents = await response.json() as Array<Record<string, unknown>>;
    expect(agents.filter((agent) => agent.id === "weather-a2a.local")).toHaveLength(1);
    expect(agents.find((agent) => agent.id === "weather-a2a.local")).toMatchObject({
      name: "Projected A2A Agent",
    });
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

  test("does not advertise terminal takeover for protocol-backed sessions", async () => {
    queryAgentsResult = [
      {
        id: "agent-1",
        name: "Codex Relay",
        harness: "codex",
        transport: "codex_app_server",
        harnessSessionId: "codex-thread-1",
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
      },
    ];
    scoutBrokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            nodeId: "node-1",
            harness: "codex",
            transport: "codex_app_server",
            state: "active",
            sessionId: "codex-thread-1",
            cwd: "/tmp/project",
            projectRoot: "/tmp/project",
            metadata: {
              threadPath: "/tmp/project/.codex/thread.jsonl",
            },
          },
        },
      },
    };
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request(
      "http://localhost/api/agents/agent-1/session-catalog",
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      activeSessionId: "codex-thread-1",
      resumeCommand: "codex resume -C /tmp/project codex-thread-1",
    });
    expect(body.sessions).toEqual([
      expect.objectContaining({
        id: "codex-thread-1",
        transport: "codex_app_server",
        canObserve: true,
        canTakeover: false,
      }),
    ]);
  });

  test("advertises terminal takeover only for CLI resume transports", async () => {
    queryAgentsResult = [
      {
        id: "agent-1",
        name: "Codex CLI",
        harness: "codex",
        transport: "codex_exec",
        harnessSessionId: "codex-thread-1",
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
      },
    ];
    scoutBrokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            nodeId: "node-1",
            harness: "codex",
            transport: "codex_exec",
            state: "active",
            sessionId: "codex-thread-1",
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

    const response = await server.app.request(
      "http://localhost/api/agents/agent-1/session-catalog",
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.sessions).toEqual([
      expect.objectContaining({
        id: "codex-thread-1",
        transport: "codex_exec",
        canTakeover: true,
      }),
    ]);
  });

  test("serves a bounded tmux peek for a broker-backed agent", async () => {
    queryAgentsResult = [
      {
        id: "agent-1",
        name: "Claude Relay",
        harness: "claude",
        transport: "tmux",
        harnessSessionId: "fallback-session",
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
      },
    ];
    scoutBrokerContextResult = {
      snapshot: {
        endpoints: {
          "endpoint-1": {
            id: "endpoint-1",
            agentId: "agent-1",
            nodeId: "node-1",
            harness: "claude",
            transport: "tmux",
            state: "active",
            sessionId: "tmux-session",
            pane: "%3",
            cwd: "/tmp/project",
            metadata: {
              tmuxSession: "tmux-session",
            },
          },
        },
      },
    };
    const captureCalls: Array<Record<string, unknown>> = [];
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      captureTmuxPane: (request) => {
        captureCalls.push(request);
        return { body: "\x1B[32mWorking\x1B[0m\nDone\n\n" };
      },
    });

    const response = await server.app.request(
      "http://localhost/api/agents/agent-1/tmux-peek?lines=12&cols=60",
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      available: true,
      agentId: "agent-1",
      sessionId: "tmux-session",
      lineCount: 12,
      columnCount: 60,
      truncated: false,
      reason: null,
    });
    const rows = String(body.body).split("\n");
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => Array.from(row).length === 60)).toBe(true);
    expect(rows.slice(0, 9).every((row) => row === " ".repeat(60))).toBe(true);
    expect(rows.at(-3)?.trimEnd()).toBe("Working");
    expect(rows.at(-2)?.trimEnd()).toBe("Done");
    expect(rows.at(-1)?.trimEnd()).toBe("");
    expect(typeof body.capturedAt).toBe("number");
    expect(captureCalls).toEqual([
      expect.objectContaining({
        agentId: "agent-1",
        sessionId: "tmux-session",
        paneTarget: "%3",
        cwd: "/tmp/project",
        lines: 12,
        columns: 60,
      }),
    ]);
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

  test("routes failed dispatch review to a project-scoped Codex ask", async () => {
    process.env.OPENSCOUT_OPERATOR_NAME = "operator";
    const failedDelivery = {
      id: "delivery:del-msg-1-talkie-mention-local_socket",
      kind: "failed_delivery",
      status: "failed",
      ts: 1_700_000_000_000,
      actorName: "Talkie",
      target: "talkie.codex-agent",
      route: "local_socket",
      detail: "mention",
      conversationId: "chat-1",
      messageId: "msg-1",
      deliveryId: "del-msg-1-talkie-mention-local_socket",
      invocationId: null,
      metadata: {
        source: "deliveries",
        targetId: "talkie.codex-agent",
        transport: "local_socket",
        reason: "mention",
        failureReason: "local_socket_unreachable",
        failureDetail: "connect ENOENT /tmp/talkie.sock",
      },
    };
    brokerDiagnosticsResult = makeBrokerDiagnostics({
      failedDeliveries: [failedDelivery],
      attempts: [failedDelivery],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/broker/dispatch-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId: failedDelivery.id }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      conversationId: "c.agent-1",
      messageId: "msg-ask-1",
      flightId: "flt-ask-1",
      dedupeFingerprint: "failed_delivery|msg-1|talkie.codex-agent|local_socket",
      rootCauseFingerprint: "failed_delivery|talkie.codex-agent|local_socket|local_socket_unreachable|connect enoent /tmp/talkie.sock",
    });
    expect(askScoutQuestionCalls).toHaveLength(1);
    expect(askScoutQuestionCalls[0]).toMatchObject({
      senderId: expect.any(String),
      target: { kind: "project_path", projectPath: "/tmp/openscout" },
      executionHarness: "codex",
      projectAgent: { persistence: "one_time" },
      currentDirectory: "/tmp/openscout",
      source: "scout-dispatch-review",
      messageMetadata: {
        dispatchAttemptId: failedDelivery.id,
        deliveryId: failedDelivery.deliveryId,
        dedupeFingerprint: "failed_delivery|msg-1|talkie.codex-agent|local_socket",
        rootCauseFingerprint: "failed_delivery|talkie.codex-agent|local_socket|local_socket_unreachable|connect enoent /tmp/talkie.sock",
      },
    });
    expect(String(askScoutQuestionCalls[0]?.body)).toContain("OpenScout dispatch failure context");
    expect(String(askScoutQuestionCalls[0]?.body)).toContain("del-msg-1-talkie-mention-local_socket");
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
          conversationId: "c.claude-review",
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
          conversationId: "c.legacy-review",
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

  test("does not resurrect dismissed failed asks in operator attention", async () => {
    const now = 1_700_000_000_000;
    const failedAsk = (id: string, attention: "badge" | "silent") => ({
      invocationId: id,
      flightId: `flight-${id}`,
      agentId: "agent-1",
      agentName: "Agent One",
      conversationId: "conv-1",
      collaborationRecordId: null,
      task: `Task ${id}`,
      status: "failed",
      statusLabel: "Interrupted",
      acknowledgedAt: null,
      attention,
      agentState: "not_ready",
      harness: "claude",
      transport: "claude_stream_json",
      summary: `Summary ${id}`,
      startedAt: now - 2_000,
      updatedAt: now - 1_000,
    });
    queryFleetResult = {
      generatedAt: now,
      totals: { active: 0, recentCompleted: 2, needsAttention: 0, activity: 0 },
      activeAsks: [],
      recentCompleted: [
        failedAsk("inv-dismissed", "silent"),
        failedAsk("inv-visible", "badge"),
      ],
      needsAttention: [],
      activity: [],
    };

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{ id: string }>;
    };
    const ids = body.items.map((item) => item.id);
    expect(ids).not.toContain("ask:inv-dismissed");
    expect(ids).toContain("ask:inv-visible");
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

  test("falls back to broker snapshot flights when the durable flight query misses", async () => {
    scoutBrokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: {
        actors: {
          "session-1": {
            id: "session-1",
            kind: "session",
            displayName: "openscout-haydn",
          },
        },
        agents: {},
        endpoints: {},
        conversations: {},
        messages: {},
        invocations: {
          "inv-session": {
            id: "inv-session",
            requesterId: "operator",
            targetAgentId: "session-1",
            conversationId: "chn-session",
            messageId: "msg-session-seed",
            body: "Reply with exactly: ok",
            ensureAwake: true,
            stream: false,
            createdAt: 1_779_461_790_000,
          },
        },
        flights: {
          "flt-session": {
            id: "flt-session",
            invocationId: "inv-session",
            requesterId: "operator",
            targetAgentId: "session-1",
            state: "completed",
            summary: "openscout-haydn replied.",
            startedAt: 1_779_461_800_000,
            completedAt: 1_779_461_900_000,
          },
        },
      },
    };
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request(
      "http://localhost/api/flights?active=false&flightId=flt-session",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "flt-session",
        invocationId: "inv-session",
        agentId: "session-1",
        agentName: "openscout-haydn",
        conversationId: "chn-session",
        collaborationRecordId: null,
        state: "completed",
        summary: "openscout-haydn replied.",
        startedAt: 1_779_461_800_000,
        completedAt: 1_779_461_900_000,
      },
    ]);
  });

  test("opens a direct chat using the agent project path as resolution context", async () => {
    queryAgentsResult = [
      {
        id: "agent-1",
        definitionId: "agent-1",
        name: "Agent One",
        handle: "agent-one",
        projectRoot: "/tmp/project-alpha",
        cwd: "/tmp/project-alpha",
        conversationId: null,
      },
    ];

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/conversations/direct", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-1",
        targetLabel: "@agent-one",
        projectPath: "/tmp/project-alpha",
      }),
    });

    expect(response.status).toBe(200);
    expect(openScoutDirectSessionCalls).toEqual([
      expect.objectContaining({
        agentId: "agent-1",
        currentDirectory: "/tmp/project-alpha",
        targetName: "@agent-one",
      }),
    ]);
    expect(await response.json()).toMatchObject({
      ok: true,
      chatId: "c.agent-1",
      conversationId: "c.agent-1",
      agentId: "agent-1",
    });
  });

  test("wakes direct DM sends in an existing chatId as tells by default", async () => {
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
        chatId: "c.agent-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutConversationSteerCalls).toEqual([
      {
        conversationId: "c.agent-1",
        senderId: expect.any(String),
        body: "Status update",
        intent: "tell",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutConversationMessageCalls).toHaveLength(0);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("honors explicit steer mode in direct DMs", async () => {
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
        body: "Use the existing turn context",
        chatId: "c.agent-1",
        intent: "steer",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutConversationSteerCalls).toEqual([
      {
        conversationId: "c.agent-1",
        senderId: "operator",
        body: "Use the existing turn context",
        intent: "steer",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutConversationMessageCalls).toHaveLength(0);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("wakes configured-operator direct DM sends in an existing conversationId by default", async () => {
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
        conversationId: "c.arach-agent-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutConversationSteerCalls).toEqual([
      {
        conversationId: "c.arach-agent-1",
        senderId: expect.any(String),
        body: "Status update",
        intent: "tell",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutConversationMessageCalls).toHaveLength(0);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("steers all participants in observed agent-to-agent conversations", async () => {
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
        conversationId: "c.hudson-narrative",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutConversationSteerCalls).toEqual([
      {
        conversationId: "c.hudson-narrative",
        senderId: "operator",
        body: "@hudson hi",
        intent: "steer",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutConversationMessageCalls).toHaveLength(0);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("rejects structural DM ids instead of promoting them", async () => {
    querySessionByIdImpl = () => ({
      id: "dm.operator.agent-1",
      kind: "group_direct",
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
        body: "Status update",
        conversationId: "dm.operator.agent-1",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "chatId must be an opaque chat id",
    });
    expect(sendScoutConversationMessageCalls).toHaveLength(0);
    expect(sendScoutConversationSteerCalls).toHaveLength(0);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("promotes direct conversations to group direct when adding a participant", async () => {
    querySessionByIdImpl = (conversationId) => ({
      id: conversationId,
      kind: upsertScoutConversationCalls.length > 0 ? "group_direct" : "direct",
      agentId: upsertScoutConversationCalls.length > 0 ? null : "agent-1",
      participantIds: upsertScoutConversationCalls.length > 0
        ? ["agent-1", "agent-2", "operator"]
        : ["agent-1", "operator"],
    });
    queryConversationDefinitionByIdImpl = (conversationId) => ({
      id: conversationId,
      kind: "direct",
      title: "Agent One",
      visibility: "private",
      shareMode: "local",
      authorityNodeId: "node-1",
      topic: null,
      parentConversationId: null,
      messageId: null,
      metadata: {},
      participantIds: ["operator", "agent-1"],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/conversations/c.conv-1/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actorId: "agent-2" }),
    });

    expect(response.status).toBe(200);
    expect(upsertScoutConversationCalls).toEqual([
      expect.objectContaining({
        id: "c.conv-1",
        kind: "group_direct",
        participantIds: ["agent-1", "agent-2", "operator"],
      }),
    ]);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      kind: "group_direct",
      participantIds: ["agent-1", "agent-2", "operator"],
      session: {
        id: "c.conv-1",
        kind: "group_direct",
        agentId: null,
        participantIds: ["agent-1", "agent-2", "operator"],
      },
    });
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
    expect(body).toContain('"tailStreamPath":"/ws/tail"');
    expect(body).toContain('"eventsStreamPath":"/ws/events"');
    expect(body).toContain('"terminalRunPath":"/api/terminal/run"');
    expect(body).toContain('"vantageOpenPath":"/api/vantage/open"');
  });

  test("serves registered terminal sessions", async () => {
    queryTerminalSessionsResult = [{
      id: "ts.abc",
      harness: "claude",
      sourceSessionId: "claude-session-123",
      cwd: "/tmp/openscout",
      resumeCommand: "claude --resume claude-session-123",
      surfaces: [{
        backend: "zellij",
        sessionName: "scout-zj-demo",
        paneId: "terminal_0",
        attachCommand: ["env", "ZELLIJ_SOCKET_DIR=/tmp/z", "zellij", "attach", "scout-zj-demo"],
        observeCommand: ["env", "ZELLIJ_SOCKET_DIR=/tmp/z", "zellij", "watch", "scout-zj-demo"],
        relay: { backend: "zellij", sessionName: "scout-zj-demo", zellijSession: "scout-zj-demo" },
        state: "live",
        socketDir: "/tmp/z",
      }],
      createdAt: 1,
      updatedAt: 2,
    }];
    queryDiscoveredTerminalSessionsResult = [{
      id: "discovered.tmux.demo",
      harness: "tmux",
      sourceSessionId: "raw-tmux-demo",
      cwd: "",
      resumeCommand: "tmux attach -t raw-tmux-demo",
      surfaces: [{
        backend: "tmux",
        sessionName: "raw-tmux-demo",
        paneId: null,
        attachCommand: ["tmux", "attach", "-t", "raw-tmux-demo"],
        observeCommand: null,
        relay: { backend: "tmux", sessionName: "raw-tmux-demo", tmuxSession: "raw-tmux-demo" },
        state: "live",
      }],
      createdAt: 3,
      updatedAt: 3,
      metadata: { source: "backend-discovery", registryState: "discovered" },
    }];
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/terminal-sessions?backend=zellij");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      count: 1,
      sessions: queryTerminalSessionsResult,
    });

    const inventoryResponse = await server.app.request(
      "http://localhost/api/terminal-sessions?includeDiscovered=1",
    );

    expect(inventoryResponse.status).toBe(200);
    await expect(inventoryResponse.json()).resolves.toEqual({
      ok: true,
      count: 2,
      sessions: [...queryTerminalSessionsResult, ...queryDiscoveredTerminalSessionsResult],
    });
  });

  test("redirects the remote pairing page to the iOS deep link", async () => {
    const qrValue = JSON.stringify({
      v: 1,
      relay: "ws://mac.tailnet.ts.net:43131",
      room: "room-1",
      publicKey: "a".repeat(64),
      expiresAt: 1_780_958_228_426,
    });
    pairingStateResult = makePairingState({
      pairing: {
        relay: "ws://mac.tailnet.ts.net:43131",
        room: "room-1",
        publicKey: "a".repeat(64),
        expiresAt: 1_780_958_228_426,
        qrArt: "",
        qrValue,
      },
    });
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/pair", {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe(`scout://pair?payload=${encodeURIComponent(qrValue)}`);
  });

  test("redirects route-specific pairing pages to reordered iOS deep links", async () => {
    const lanPayload = {
      v: 1,
      relay: "ws://192.168.18.14:43131",
      fallbackRelays: ["ws://mac.tailnet.ts.net:43131"],
      room: "room-1",
      publicKey: "a".repeat(64),
      expiresAt: 1_780_958_228_426,
    };
    const tailnetPayload = {
      ...lanPayload,
      relay: "ws://mac.tailnet.ts.net:43131",
      fallbackRelays: ["ws://192.168.18.14:43131"],
    };
    const qrValue = JSON.stringify(lanPayload);
    pairingStateResult = makePairingState({
      pairing: {
        relay: lanPayload.relay,
        fallbackRelays: lanPayload.fallbackRelays,
        room: lanPayload.room,
        publicKey: lanPayload.publicKey,
        expiresAt: lanPayload.expiresAt,
        qrArt: "",
        qrValue,
      },
    });
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const lan = await server.app.request("http://localhost/pair?route=lan", {
      redirect: "manual",
    });
    const tailnet = await server.app.request("http://localhost/pair?route=tsn", {
      redirect: "manual",
    });

    expect(lan.status).toBe(302);
    expect(lan.headers.get("location")).toBe(`scout://pair?payload=${encodeURIComponent(JSON.stringify(lanPayload))}`);
    expect(tailnet.status).toBe(302);
    expect(tailnet.headers.get("location")).toBe(`scout://pair?payload=${encodeURIComponent(JSON.stringify(tailnetPayload))}`);
  });

  test("adds the actual web port to pairing deep-link payloads", async () => {
    const lanPayload = {
      v: 1,
      relay: "ws://192.168.18.14:7889",
      fallbackRelays: ["ws://mac.tailnet.ts.net:7889"],
      room: "room-1",
      publicKey: "a".repeat(64),
      expiresAt: 1_780_958_228_426,
    };
    pairingStateResult = makePairingState({
      pairing: {
        relay: lanPayload.relay,
        fallbackRelays: lanPayload.fallbackRelays,
        room: lanPayload.room,
        publicKey: lanPayload.publicKey,
        expiresAt: lanPayload.expiresAt,
        qrArt: "",
        qrValue: JSON.stringify(lanPayload),
      },
    });
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      webPort: 4311,
    });

    const response = await server.app.request("http://localhost/pair?route=tsn", {
      redirect: "manual",
    });
    const location = response.headers.get("location");
    const payload = JSON.parse(new URL(location ?? "").searchParams.get("payload") ?? "{}");

    expect(response.status).toBe(302);
    expect(payload).toMatchObject({
      relay: "ws://mac.tailnet.ts.net:7889",
      webPort: 4311,
    });
  });

  test("keeps LAN discovery advertised for remote relay pair mode", async () => {
    pairingStateResult = makePairingState({
      isRunning: true,
      relay: "wss://mesh.oscout.net/v1/relay",
      lanDiscoveryAdvertised: false,
    });
    await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      webPort: 3200,
    });

    expect(lanBeaconSuppressPredicates).toHaveLength(1);
    expect(await lanBeaconSuppressPredicates[0]!()).toBe(false);
  });

  test("suppresses LAN discovery when the runtime controller advertises it", async () => {
    pairingStateResult = makePairingState({
      isRunning: true,
      relay: "ws://192.168.18.14:43131",
      lanDiscoveryAdvertised: true,
    });
    await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      webPort: 3200,
    });

    expect(lanBeaconSuppressPredicates).toHaveLength(1);
    expect(await lanBeaconSuppressPredicates[0]!()).toBe(true);
  });

  test("registers an approval request when remote pairing has no active payload", async () => {
    pairingStateResult = makePairingState({ pairing: null });
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/pair");

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("scout://pair pairing requires approval");
  });

  test("serves site-level feature flag bundle config for the client", async () => {
    const originalBundle = process.env.OPENSCOUT_WEB_FLAG_BUNDLE;
    const originalExperience = process.env.OPENSCOUT_WEB_EXPERIENCE;
    const originalVariant = process.env.OPENSCOUT_WEB_AB_VARIANT;
    process.env.OPENSCOUT_WEB_FLAG_BUNDLE = "B";
    delete process.env.OPENSCOUT_WEB_EXPERIENCE;
    delete process.env.OPENSCOUT_WEB_AB_VARIANT;

    try {
      const server = await createOpenScoutWebServer({
        currentDirectory: "/tmp/openscout",
        assetMode: "static",
        staticRoot: makeStaticRoot(),
      });

      const response = await server.app.request("http://localhost/api/bootstrap.js");
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('"featureFlags":{"bundle":"max-pro"}');
    } finally {
      if (originalBundle === undefined) {
        delete process.env.OPENSCOUT_WEB_FLAG_BUNDLE;
      } else {
        process.env.OPENSCOUT_WEB_FLAG_BUNDLE = originalBundle;
      }
      if (originalExperience === undefined) {
        delete process.env.OPENSCOUT_WEB_EXPERIENCE;
      } else {
        process.env.OPENSCOUT_WEB_EXPERIENCE = originalExperience;
      }
      if (originalVariant === undefined) {
        delete process.env.OPENSCOUT_WEB_AB_VARIANT;
      } else {
        process.env.OPENSCOUT_WEB_AB_VARIANT = originalVariant;
      }
    }
  });

  test("adds mixed-content protection only for HTTPS edge requests", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const plainResponse = await server.app.request("http://localhost/api/bootstrap.js");
    expect(plainResponse.headers.get("content-security-policy")).toBeNull();

    const forwardedHttpsResponse = await server.app.request("http://localhost/api/bootstrap.js", {
      headers: {
        "x-forwarded-proto": "https",
      },
    });
    expect(forwardedHttpsResponse.headers.get("content-security-policy"))
      .toBe("upgrade-insecure-requests; block-all-mixed-content");
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
      expect(body).toContain('"tailStreamPath":"/ws/tail"');
      expect(body).toContain('"eventsStreamPath":"/ws/events"');
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

  test("steers channel participants in an existing opaque chat", async () => {
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
        conversationId: "c.ops",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutConversationSteerCalls).toEqual([
      {
        conversationId: "c.ops",
        senderId: "operator",
        body: "Team update",
        intent: "steer",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutConversationMessageCalls).toHaveLength(0);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("keeps passive comments available for existing opaque chats", async () => {
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
        body: "Transcript note",
        conversationId: "c.ops",
        intent: "comment",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutConversationMessageCalls).toEqual([
      {
        conversationId: "c.ops",
        senderId: "operator",
        body: "Transcript note",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutConversationSteerCalls).toHaveLength(0);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("routes direct DM asks through askScoutQuestion and rejects channel asks", async () => {
    process.env.OPENSCOUT_OPERATOR_NAME = "operator";
    querySessionByIdImpl = (conversationId) => {
      if (conversationId === "c.agent-1") {
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
        conversationId: "c.agent-1",
      }),
    });
    expect(dmResponse.status).toBe(200);
    expect(askScoutQuestionCalls).toEqual([
      {
        senderId: "operator",
        targetLabel: "agent-1",
        targetAgentId: "agent-1",
        body: "Please own this and report back.",
        source: "scout-web",
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
          conversationId: "c.ops",
        }),
      },
    );
    expect(channelResponse.status).toBe(400);
    expect(await channelResponse.json()).toEqual({
      error: "ask is only available in a direct conversation with one agent",
    });

    const explicitResponse = await server.app.request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "What should we catch up on?",
        targetAgentId: "agent-2",
        targetLabel: "Talkie",
        execution: {
          harness: "codex",
          model: "gpt-test",
        },
      }),
    });
    expect(explicitResponse.status).toBe(200);
    expect(askScoutQuestionCalls).toEqual([
      {
        senderId: "operator",
        targetLabel: "agent-1",
        targetAgentId: "agent-1",
        body: "Please own this and report back.",
        source: "scout-web",
        currentDirectory: "/tmp/openscout",
      },
      {
        senderId: expect.any(String),
        targetLabel: "Talkie",
        targetAgentId: "agent-2",
        body: "What should we catch up on?",
        executionHarness: "codex",
        executionModel: "gpt-test",
        source: "scout-web",
        currentDirectory: "/tmp/openscout",
      },
    ]);
  });

  test("routes session initiation effort and fork source through askScoutQuestion", async () => {
    process.env.OPENSCOUT_OPERATOR_NAME = "operator";
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: { projectPath: "/tmp/openscout" },
        execution: {
          harness: "codex",
          model: "gpt-5.5",
          reasoningEffort: "high",
          session: "fork",
          forkFromSessionId: "session-source-1",
        },
        agent: { persistence: "sticky", handle: "hudson" },
        seed: {
          instructions: "Pick this up from the prior run.",
          attachments: [
            {
              mediaType: "text/markdown",
              url: "http://127.0.0.1:3200/api/blobs/blob-1",
              fileName: "notes.md",
            },
          ],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      ok: true,
      conversationId: "c.agent-1",
      flightId: "flt-ask-1",
      handle: "hudson",
    }));
    expect(askScoutQuestionCalls).toEqual([
      {
        senderId: expect.any(String),
        target: { kind: "project_path", projectPath: "/tmp/openscout" },
        body: "Pick this up from the prior run.",
        executionHarness: "codex",
        executionModel: "gpt-5.5",
        executionReasoningEffort: "high",
        executionSession: "fork",
        executionForkFromSessionId: "session-source-1",
        attachments: [
          {
            mediaType: "text/markdown",
            url: "http://127.0.0.1:3200/api/blobs/blob-1",
            fileName: "notes.md",
          },
        ],
        projectAgent: { persistence: "sticky", handle: "hudson" },
        currentDirectory: "/tmp/openscout",
        source: "scout-session-initiation",
      },
    ]);
  });

  test("keeps project-path ask routing when session initiation targets an existing agent", async () => {
    process.env.OPENSCOUT_OPERATOR_NAME = "operator";
    queryAgentsResult = [
      {
        id: "agent-1",
        definitionId: "agent-1",
        name: "Hudson",
        projectRoot: "/tmp/openscout",
        cwd: "/tmp/openscout",
        harness: "codex",
        model: "gpt-test",
      },
    ];
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/fallback",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: { agentId: "agent-1" },
        seed: { instructions: "Please take this on." },
      }),
    });

    expect(response.status).toBe(200);
    expect(askScoutQuestionCalls).toHaveLength(1);
    expect(askScoutQuestionCalls[0]).toMatchObject({
      senderId: "operator",
      target: { kind: "project_path", projectPath: "/tmp/openscout" },
      targetAgentId: "agent-1",
      body: "Please take this on.",
      executionHarness: "codex",
      executionModel: "gpt-test",
      currentDirectory: "/tmp/openscout",
      source: "scout-session-initiation",
    });
    expect(askScoutQuestionCalls[0]).not.toHaveProperty("targetLabel");
  });

  test("rejects session initiation fork without a source", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: { projectPath: "/tmp/openscout" },
        execution: { session: "fork", harness: "codex" },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "session 'fork' requires execution.forkFromSessionId or execution.forkFromStateId",
    });
    expect(askScoutQuestionCalls).toEqual([]);
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
      conversationId: "c.agent-1",
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

  test("falls back to local Codex when Scoutbot assistant has no OpenAI key", async () => {
    useIsolatedOpenScoutHome();
    delete process.env.OPENAI_API_KEY;
    let fetchCalled = false;
    const codexCalls: Array<{
      sessionId: string;
      threadId?: string | null;
      prompt: string;
      systemPrompt: string;
    }> = [];
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      scoutbotAssistant: {
        invokeCodex: async (input) => {
          codexCalls.push({
            sessionId: input.sessionId,
            threadId: input.threadId,
            prompt: input.prompt,
            systemPrompt: input.systemPrompt,
          });
          return {
            output: "Codex fallback works.",
            threadId: "codex-thread-1",
          };
        },
      },
    });

    const response = await server.app.request("http://localhost/api/scoutbot/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "state?" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as {
      reply: { body: string };
      responseId: string | null;
      session: { messages: Array<{ role: string; body: string }> };
    };
    expect(json.reply.body).toBe("Codex fallback works.");
    expect(json.responseId).toBe("codex-thread-1");
    expect(json.session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(fetchCalled).toBe(false);
    expect(codexCalls).toHaveLength(1);
    expect(codexCalls[0].threadId).toBeNull();
    expect(codexCalls[0].prompt).toContain("Operator request:");
    expect(codexCalls[0].prompt).toContain("Current Scout control-plane snapshot");
    expect(codexCalls[0].systemPrompt).toContain("not a peer agent");
  });

  test("ignores a transient request supplied OpenAI key and still uses configured providers", async () => {
    useIsolatedOpenScoutHome();
    delete process.env.OPENAI_API_KEY;
    let fetchCalled = false;
    const codexCalls: Array<{ prompt: string }> = [];
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
      scoutbotAssistant: {
        invokeCodex: async (input) => {
          codexCalls.push({ prompt: input.prompt });
          return {
            output: "Request key ignored; Codex handled this.",
            threadId: "codex-thread-request-key",
          };
        },
      },
    });

    const response = await server.app.request("http://localhost/api/scoutbot/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "state?",
        openaiApiKey: "sk-request-test",
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as { reply: { body: string }; responseId: string | null };
    expect(json.reply.body).toContain("Codex handled this");
    expect(json.responseId).toBe("codex-thread-request-key");
    expect(fetchCalled).toBe(false);
    expect(codexCalls).toHaveLength(1);
    expect(codexCalls[0].prompt).not.toContain("sk-request-test");
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

  test("proxies repo-watch snapshots through the web API", async () => {
    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify({
        generatedAt: 1_780_760_000_000,
        projects: [],
        totals: {
          projects: 0,
          worktrees: 0,
          dirtyWorktrees: 0,
          conflictedWorktrees: 0,
          attentionWorktrees: 0,
          attachedAgents: 0,
          attachedSessions: 0,
        },
        warnings: [],
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

    const response = await server.app.request(
      "http://localhost/api/repo-watch?force=1&includeTail=true&includeDiff=true&includeLastCommit=1&native=1&maxRoots=32&maxWorktrees=12&scanBudgetMs=12000&ignored=true",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      generatedAt: 1_780_760_000_000,
      totals: { projects: 0, worktrees: 0 },
    });
    expect(fetchCalls).toEqual([
      "http://broker.test/v1/repo-watch/snapshot?force=1&includeTail=1&includeDiff=1&includeLastCommit=1&native=1&maxRoots=32&maxWorktrees=12&scanBudgetMs=12000",
    ]);
  });

  function stubDiffSnapshot(worktreePath: string) {
    return {
      schema: "openscout.repo.diff/v1" as const,
      generatedAt: 1_780_760_000_000,
      worktreePath,
      layers: [],
      coverage: {
        requestedLayers: 0,
        emittedLayers: 0,
        files: 0,
        patchBytes: 0,
        truncatedLayers: 0,
        scanBudgetReached: false,
      },
      diagnostics: [],
      scout: { worktreeId: "w1", projectId: null, agents: [], sessions: [], hints: [] },
      render: {
        renderKey: "k1",
        cachePolicy: "local-disposable" as const,
        preferredTheme: "pierre-dark",
        preferredLayout: "split" as const,
      },
    };
  }

  test("serves repo-diff snapshots from the web server (no broker hop)", async () => {
    let captured: {
      worktreePath?: string;
      layers?: string[];
      baseRef?: string;
      paths?: string[];
      limits?: { timeoutMs?: number; includeBinaryPatch?: boolean };
    } | null = null;
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      repoDiffSnapshot: async (opts) => {
        captured = {
          worktreePath: opts.worktreePath,
          layers: opts.layers,
          baseRef: opts.baseRef ?? undefined,
          paths: opts.paths,
          limits: opts.limits,
        };
        return stubDiffSnapshot(opts.worktreePath);
      },
    });

    const response = await server.app.request(
      "http://localhost/api/repo-diff/worktree?path=/tmp/wt&layer=staged&layer=unstaged&baseRef=main&ignored=true",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ schema: "openscout.repo.diff/v1" });
    expect(captured?.worktreePath).toBe("/tmp/wt");
    // Layer order follows the request (the client controls tab order).
    expect(captured?.layers).toEqual(["staged", "unstaged"]);
    expect(captured?.baseRef).toBe("main");
    expect(captured?.limits).toMatchObject({
      timeoutMs: 15_000,
      includeBinaryPatch: false,
    });
  });

  test("passes repo-diff file filters through as native diff paths", async () => {
    let captured: { paths?: string[] } | null = null;
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      repoDiffSnapshot: async (opts) => {
        captured = { paths: opts.paths };
        return stubDiffSnapshot(opts.worktreePath);
      },
    });

    const response = await server.app.request(
      "http://localhost/api/repo-diff/worktree?path=/tmp/wt&file=src/a.ts&file=/tmp/wt/src/b.ts&file=/tmp/elsewhere/nope.ts",
    );

    expect(response.status).toBe(200);
    expect(captured?.paths).toEqual(["src/a.ts", "src/b.ts"]);
    await expect(response.json()).resolves.toMatchObject({
      scope: {
        kind: "worktree",
        filteredPaths: ["src/a.ts", "src/b.ts"],
      },
    });
  });

  test("serves cached repo-diff snapshots and rehydrates in the background", async () => {
    let calls = 0;
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      repoDiffSnapshot: async (opts) => {
        calls += 1;
        return {
          ...stubDiffSnapshot(opts.worktreePath),
          generatedAt: calls,
          render: {
            ...stubDiffSnapshot(opts.worktreePath).render,
            renderKey: `k${calls}`,
          },
        };
      },
    });

    const live = await server.app.request(
      "http://localhost/api/repo-diff/worktree?path=/tmp/wt&cache=reload",
    );
    expect(live.status).toBe(200);
    expect(live.headers.get("x-openscout-repo-diff-cache")).toBe("miss");
    expect((await live.json() as { generatedAt: number }).generatedAt).toBe(1);
    expect(calls).toBe(1);

    const cached = await server.app.request(
      "http://localhost/api/repo-diff/worktree?path=/tmp/wt&cache=prefer&rehydrate=1",
    );
    expect(cached.status).toBe(200);
    expect(cached.headers.get("x-openscout-repo-diff-cache")).toBe("hit");
    expect(cached.headers.get("x-openscout-repo-diff-rehydrate")).toBe("queued");
    expect((await cached.json() as { generatedAt: number }).generatedAt).toBe(1);

    await waitForTestCondition(() => calls >= 2);

    const rehydrated = await server.app.request(
      "http://localhost/api/repo-diff/worktree?path=/tmp/wt&cache=only",
    );
    expect(rehydrated.status).toBe(200);
    expect(rehydrated.headers.get("x-openscout-repo-diff-cache")).toBe("hit");
    expect((await rehydrated.json() as { generatedAt: number }).generatedAt).toBe(2);
  });

  test("repo-diff cache-only misses do not run live commands", async () => {
    let called = false;
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      repoDiffSnapshot: async (opts) => {
        called = true;
        return stubDiffSnapshot(opts.worktreePath);
      },
    });

    const response = await server.app.request(
      "http://localhost/api/repo-diff/worktree?path=/tmp/wt&cache=only",
    );

    expect(response.status).toBe(404);
    expect(called).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      status: "missing",
      worktreePath: "/tmp/wt",
    });
  });

  test("repo-diff summary tier skips patch text and parsed hunks", async () => {
    let capturedLimits: Record<string, unknown> | undefined;
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      repoDiffSnapshot: async (opts) => {
        capturedLimits = opts.limits;
        return stubDiffSnapshot(opts.worktreePath);
      },
    });

    const response = await server.app.request(
      "http://localhost/api/repo-diff/worktree?path=/tmp/wt&tier=summary",
    );

    expect(response.status).toBe(200);
    expect(capturedLimits).toMatchObject({
      includeRawPatch: false,
      includeParsedHunks: false,
      includeBinaryPatch: false,
    });
  });

  test("rejects repo-diff requests without a worktree path", async () => {
    let called = false;
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      repoDiffSnapshot: async (opts) => {
        called = true;
        return stubDiffSnapshot(opts.worktreePath);
      },
    });

    const response = await server.app.request("http://localhost/api/repo-diff/worktree");
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  test("returns JSON for unknown API routes instead of the app shell", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/repo-diff/missing");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "unknown api route: /api/repo-diff/missing",
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
      viteDevUrl: "http://127.0.0.1:43122",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request(
      "http://localhost/agents/demo?tab=inbox",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("vite");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.input).toBe(
      "http://127.0.0.1:43122/agents/demo?tab=inbox",
    );
    expect(fetchCalls[0]?.init?.method).toBe("GET");
    expect(fetchCalls[0]?.init?.headers).toBeInstanceOf(Headers);
    expect(fetchCalls[0]?.init?.body).toBeUndefined();
  });
});
