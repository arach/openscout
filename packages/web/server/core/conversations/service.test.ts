import { describe, expect, mock, test } from "bun:test";

let brokerContextResult: unknown = null;

mock.module("../broker/service.ts", () => ({
  loadScoutBrokerContext: async () => brokerContextResult,
}));

const { getScoutConversations } = await import("./service.ts");

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    nodes: {
      "node-1": { id: "node-1", name: "node-1" },
    },
    actors: {
      operator: {
        id: "operator",
        displayName: "Operator",
      },
      "hudson.main.mini": {
        id: "hudson.main.mini",
        displayName: "Hudson",
        handle: "hudson",
      },
    },
    agents: {
      "hudson.main.mini": {
        id: "hudson.main.mini",
        kind: "agent",
        definitionId: "hudson",
        displayName: "Hudson",
        handle: "hudson",
        agentClass: "general",
        capabilities: ["chat", "invoke", "deliver"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
        metadata: {
          staleLocalRegistration: true,
          branch: "main",
        },
      },
    },
    endpoints: {
      "ep-hudson-main": {
        id: "ep-hudson-main",
        agentId: "hudson.main.mini",
        nodeId: "node-1",
        harness: "claude",
        transport: "claude_stream_json",
        state: "offline",
        projectRoot: "/Users/arach/dev/hudson",
        metadata: {
          staleLocalRegistration: true,
          branch: "main",
        },
      },
    },
    conversations: {
      "dm.operator.hudson.main.mini": {
        id: "dm.operator.hudson.main.mini",
        kind: "direct",
        title: "Hudson",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["operator", "hudson.main.mini"],
      },
    },
    messages: {
      "msg-1": {
        id: "msg-1",
        conversationId: "dm.operator.hudson.main.mini",
        actorId: "operator",
        originNodeId: "node-1",
        class: "operator",
        body: "hello",
        visibility: "private",
        policy: "durable",
        createdAt: 1_779_461_700_000,
      },
    },
    flights: {},
    ...overrides,
  };
}

describe("getScoutConversations", () => {
  test("keeps stale on-demand direct DMs in the conversation list", async () => {
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: baseSnapshot(),
    };

    const conversations = await getScoutConversations();

    expect(conversations).toContainEqual(
      expect.objectContaining({
        id: "dm.operator.hudson.main.mini",
        agentId: "hudson.main.mini",
        agentName: "Hudson",
        currentBranch: "main",
        messageCount: 1,
      }),
    );
  });

  test("uses the most recent endpoint when a direct agent has multiple stale endpoints", async () => {
    const snapshot = baseSnapshot();
    snapshot.endpoints["ep-hudson-main-old"] = {
      id: "ep-hudson-main-old",
      agentId: "hudson.main.mini",
      nodeId: "node-1",
      harness: "codex",
      transport: "codex_app_server",
      state: "offline",
      projectRoot: "/Users/arach/dev/hudson",
      metadata: {
        startedAt: "1778552408",
        lastFailedAt: "1779461710087",
        staleAt: "1779461710087",
        branch: "main",
      },
    };
    snapshot.endpoints["ep-hudson-main"]!.metadata = {
      startedAt: "1779336966",
      lastFailedAt: "1779461710087",
      staleAt: "1779461710087",
      branch: "main",
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations.find((entry) => entry.id === "dm.operator.hudson.main.mini")).toEqual(
      expect.objectContaining({
        harness: "claude",
      }),
    );
  });

  test("keeps direct DMs with message history when the endpoint is absent", async () => {
    const snapshot = baseSnapshot({
      endpoints: {},
    });
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations).toContainEqual(
      expect.objectContaining({
        id: "dm.operator.hudson.main.mini",
        agentId: "hudson.main.mini",
        harness: null,
        workspaceRoot: null,
      }),
    );
  });

  test("omits explicitly retired direct DMs", async () => {
    const snapshot = baseSnapshot();
    snapshot.agents["hudson.main.mini"]!.metadata = {
      retiredFromFleet: true,
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations.find((entry) => entry.id === "dm.operator.hudson.main.mini")).toBeUndefined();
  });
});
