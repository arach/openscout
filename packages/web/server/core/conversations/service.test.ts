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

  test("reports unreadCount: 0 when the operator has no read cursor", async () => {
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: baseSnapshot(),
    };

    const conversations = await getScoutConversations();
    const dm = conversations.find((entry) => entry.id === "dm.operator.hudson.main.mini");

    expect(dm?.unreadCount).toBe(0);
    expect(dm?.ask).toBeUndefined();
  });

  test("counts agent messages after the operator read cursor as unread", async () => {
    const snapshot = baseSnapshot();
    // One operator message already at createdAt 1_779_461_700_000; add two later
    // agent messages and an operator read cursor between them.
    snapshot.messages["msg-2"] = {
      id: "msg-2",
      conversationId: "dm.operator.hudson.main.mini",
      actorId: "hudson.main.mini",
      originNodeId: "node-1",
      class: "agent",
      body: "still working",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_800_000,
    };
    snapshot.messages["msg-3"] = {
      id: "msg-3",
      conversationId: "dm.operator.hudson.main.mini",
      actorId: "hudson.main.mini",
      originNodeId: "node-1",
      class: "agent",
      body: "done",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_900_000,
    };
    snapshot.readCursors = {
      "cursor-op": {
        conversationId: "dm.operator.hudson.main.mini",
        actorId: "operator",
        lastReadMessageId: "msg-1",
        lastReadAt: 1_779_461_750_000,
        updatedAt: 1_779_461_750_000,
      },
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();
    const dm = conversations.find((entry) => entry.id === "dm.operator.hudson.main.mini");

    // msg-2 and msg-3 are after the cursor and authored by the agent → 2 unread.
    expect(dm?.unreadCount).toBe(2);
  });

  test("surfaces a pending question unblock request as the conversation ask", async () => {
    const snapshot = baseSnapshot();
    snapshot.unblockRequests = {
      "ub-1": {
        id: "ub-1",
        kind: "question",
        state: "open",
        source: "harness",
        sourceRef: "session-1",
        title: "Need a decision",
        summary: "Should I force-push the rebase?",
        ownerId: "operator",
        createdById: "hudson.main.mini",
        agentId: "hudson.main.mini",
        conversationId: "dm.operator.hudson.main.mini",
        createdAt: 1_779_461_900_000,
        updatedAt: 1_779_461_900_000,
        actions: [{ kind: "answer", label: "Answer" }],
      },
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();
    const dm = conversations.find((entry) => entry.id === "dm.operator.hudson.main.mini");

    expect(dm?.ask).toEqual({
      from: "Hudson",
      text: "Should I force-push the rebase?",
      state: "pending",
    });
  });

  test("marks the conversation ask answered once the question is resolved", async () => {
    const snapshot = baseSnapshot();
    snapshot.unblockRequests = {
      "ub-1": {
        id: "ub-1",
        kind: "question",
        state: "resolved",
        source: "harness",
        sourceRef: "session-1",
        title: "Need a decision",
        summary: "Should I force-push the rebase?",
        ownerId: "operator",
        createdById: "hudson.main.mini",
        agentId: "hudson.main.mini",
        conversationId: "dm.operator.hudson.main.mini",
        createdAt: 1_779_461_900_000,
        updatedAt: 1_779_462_000_000,
        resolvedAt: 1_779_462_000_000,
      },
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();
    const dm = conversations.find((entry) => entry.id === "dm.operator.hudson.main.mini");

    expect(dm?.ask?.state).toBe("answered");
  });
});
