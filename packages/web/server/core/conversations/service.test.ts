import { afterAll, describe, expect, mock, test } from "bun:test";

let brokerContextResult: unknown = null;

mock.module("../broker/service.ts", () => ({
  loadScoutBrokerContext: async () => brokerContextResult,
}));

const { getScoutConversations } = await import("./service.ts");

mock.restore();

afterAll(() => {
  mock.restore();
});

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
      "chat_hudson-main": {
        id: "chat_hudson-main",
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
        conversationId: "chat_hudson-main",
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
  test("omits legacy structural conversation ids from the live list", async () => {
    const snapshot = baseSnapshot();
    snapshot.conversations["dm.operator.hudson.main.mini"] = {
      id: "dm.operator.hudson.main.mini",
      kind: "direct",
      title: "Hudson Legacy",
      visibility: "private",
      shareMode: "local",
      authorityNodeId: "node-1",
      participantIds: ["operator", "hudson.main.mini"],
    };
    snapshot.messages["legacy-msg"] = {
      id: "legacy-msg",
      conversationId: "dm.operator.hudson.main.mini",
      actorId: "hudson.main.mini",
      originNodeId: "node-1",
      class: "agent",
      body: "legacy",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_800_000,
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations.map((entry) => entry.id)).toEqual(["chat_hudson-main"]);
  });

  test("keeps stale on-demand direct chats in the conversation list", async () => {
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: baseSnapshot(),
    };

    const conversations = await getScoutConversations();

    expect(conversations).toContainEqual(
      expect.objectContaining({
        id: "chat_hudson-main",
        chatId: "chat_hudson-main",
        agentId: "hudson.main.mini",
        agentName: "Hudson",
        currentBranch: "main",
        messageCount: 1,
      }),
    );
  });

  test("adds scoped labels for same-project agent-agent participants", async () => {
    const snapshot = baseSnapshot();
    snapshot.actors["openscout-a.main.mini"] = {
      id: "openscout-a.main.mini",
      displayName: "OpenScout",
      handle: "openscout-a",
    };
    snapshot.actors["openscout-b.main.mini"] = {
      id: "openscout-b.main.mini",
      displayName: "OpenScout",
      handle: "openscout-b",
    };
    snapshot.agents["openscout-a.main.mini"] = {
      id: "openscout-a.main.mini",
      kind: "agent",
      definitionId: "openscout",
      displayName: "OpenScout",
      handle: "openscout-a",
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {},
    };
    snapshot.agents["openscout-b.main.mini"] = {
      id: "openscout-b.main.mini",
      kind: "agent",
      definitionId: "openscout",
      displayName: "OpenScout",
      handle: "openscout-b",
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {},
    };
    snapshot.endpoints["ep-openscout-a"] = {
      id: "ep-openscout-a",
      agentId: "openscout-a.main.mini",
      nodeId: "node-1",
      harness: "claude",
      transport: "tmux",
      state: "idle",
      projectRoot: "/Users/arach/dev/openscout",
      sessionId: "relay-openscout-a",
    };
    snapshot.endpoints["ep-openscout-b"] = {
      id: "ep-openscout-b",
      agentId: "openscout-b.main.mini",
      nodeId: "node-1",
      harness: "claude",
      transport: "claude_stream_json",
      state: "idle",
      projectRoot: "/Users/arach/dev/openscout",
      sessionId: "relay-openscout-b",
    };
    snapshot.conversations["chat_openscout_pair"] = {
      id: "chat_openscout_pair",
      kind: "direct",
      title: "OpenScout <> OpenScout",
      visibility: "private",
      shareMode: "local",
      authorityNodeId: "node-1",
      participantIds: ["openscout-a.main.mini", "openscout-b.main.mini"],
    };
    snapshot.messages["msg-openscout-pair"] = {
      id: "msg-openscout-pair",
      conversationId: "chat_openscout_pair",
      actorId: "openscout-a.main.mini",
      originNodeId: "node-1",
      class: "agent",
      body: "handoff",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_900_000,
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();
    const pair = conversations.find((entry) => entry.id === "chat_openscout_pair");

    expect(pair?.participants).toHaveLength(2);
    expect(pair?.participants.map((participant) => participant.displayName)).toEqual([
      "Openscout",
      "Openscout",
    ]);
    expect(pair?.participants.every((participant) => participant.label.startsWith("Openscout · "))).toBe(true);
    expect(new Set(pair?.participants.map((participant) => participant.scopedAlias)).size).toBe(2);
    expect(pair?.participants.map((participant) => participant.sessionId)).toEqual([
      "relay-openscout-a",
      "relay-openscout-b",
    ]);
  });

  test("normalizes legacy second timestamps before returning summaries", async () => {
    const snapshot = baseSnapshot();
    snapshot.messages["msg-1"]!.createdAt = 1_779_461_700;
    snapshot.messages["msg-2"] = {
      id: "msg-2",
      conversationId: "chat_hudson-main",
      actorId: "hudson.main.mini",
      originNodeId: "node-1",
      class: "agent",
      body: "done",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_710,
    };
    snapshot.readCursors = {
      "read-1": {
        conversationId: "chat_hudson-main",
        actorId: "operator",
        lastReadAt: 1_779_461_705,
      },
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations.find((entry) => entry.id === "chat_hudson-main")).toEqual(
      expect.objectContaining({
        lastMessageAt: 1_779_461_710_000,
        unreadCount: 1,
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

    expect(conversations.find((entry) => entry.id === "chat_hudson-main")).toEqual(
      expect.objectContaining({
        harness: "claude",
      }),
    );
  });

  test("surfaces the per-conversation session id from message routing metadata", async () => {
    const snapshot = baseSnapshot();
    snapshot.endpoints["ep-hudson-main"]!.sessionId = "endpoint-active-session";
    snapshot.messages["msg-2"] = {
      id: "msg-2",
      conversationId: "chat_hudson-main",
      actorId: "hudson.main.mini",
      originNodeId: "node-1",
      class: "agent",
      body: "done",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_800_000,
      metadata: {
        returnAddress: {
          sessionId: "relay-hudson-claude",
        },
      },
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations.find((entry) => entry.id === "chat_hudson-main")).toEqual(
      expect.objectContaining({
        sessionId: "relay-hudson-claude",
      }),
    );
  });

  test("does not invent a conversation session id from the active endpoint alone", async () => {
    const snapshot = baseSnapshot();
    snapshot.endpoints["ep-hudson-main"]!.sessionId = "endpoint-active-session";
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations.find((entry) => entry.id === "chat_hudson-main")?.sessionId).toBeNull();
  });

  test("keeps direct chats with message history when the endpoint is absent", async () => {
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
        id: "chat_hudson-main",
        agentId: "hudson.main.mini",
        harness: null,
        workspaceRoot: null,
      }),
    );
  });

  test("keeps completed session-backed direct chats without an agent record", async () => {
    const snapshot = baseSnapshot();
    const sessionActorId = "session-mr8idz7a-gn5ntd";
    const chatId = "chn-96b2fea9b3904b3ca6f88490f6d2c5f9";
    snapshot.actors[sessionActorId] = {
      id: sessionActorId,
      kind: "session",
      displayName: "openscout-haydn",
      handle: "project-haydn",
      labels: ["cardless-session", "session"],
      metadata: {
        source: "scout-cardless-session",
        sessionBacked: true,
        cardless: true,
        projectRoot: "/Users/arach/dev/openscout",
      },
    };
    snapshot.endpoints["endpoint-session"] = {
      id: "endpoint-session",
      agentId: sessionActorId,
      nodeId: "node-1",
      harness: "codex",
      transport: "codex_app_server",
      state: "idle",
      cwd: "/Users/arach/dev/openscout",
      projectRoot: "/Users/arach/dev/openscout",
      sessionId: sessionActorId,
      metadata: {
        source: "scout-cardless-session",
        sessionBacked: true,
        cardless: true,
        pendingExternalSession: false,
        externalSessionId: "019f34ec-a5d0-7dd2-9398-aae6c0c0336b",
      },
    };
    snapshot.conversations[chatId] = {
      id: chatId,
      kind: "direct",
      title: "Operator <> openscout-haydn",
      visibility: "private",
      shareMode: "local",
      authorityNodeId: "node-1",
      participantIds: ["operator", sessionActorId],
    };
    snapshot.messages["msg-session-seed"] = {
      id: "msg-session-seed",
      conversationId: chatId,
      actorId: "operator",
      originNodeId: "node-1",
      class: "operator",
      body: "Reply with exactly: ok",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_800_000,
    };
    snapshot.messages["msg-session-reply"] = {
      id: "msg-session-reply",
      conversationId: chatId,
      actorId: sessionActorId,
      originNodeId: "node-1",
      class: "agent",
      body: "ok",
      replyToMessageId: "msg-session-seed",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_900_000,
      metadata: {
        flightId: "flt-session",
        responderSessionId: sessionActorId,
      },
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations).toContainEqual(
      expect.objectContaining({
        id: chatId,
        chatId,
        agentId: sessionActorId,
        agentName: "Openscout",
        harness: "codex",
        sessionId: sessionActorId,
        workspaceRoot: "/Users/arach/dev/openscout",
        preview: "ok",
        messageCount: 2,
      }),
    );
  });

  test("omits failed cardless launch stubs without an external session", async () => {
    const snapshot = baseSnapshot();
    const sessionActorId = "session-mqmzik4c-zb8ocf";
    const chatId = "chat_ff3a45d076de4614995c530d455ffc48";
    snapshot.actors[sessionActorId] = {
      id: sessionActorId,
      displayName: "Openscout",
      metadata: {
        cardless: true,
      },
    };
    snapshot.agents[sessionActorId] = {
      id: sessionActorId,
      kind: "agent",
      definitionId: "openscout",
      displayName: "Openscout",
      handle: "openscout",
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {
        cardless: true,
      },
    };
    snapshot.endpoints["endpoint-failed-cardless"] = {
      id: "endpoint-failed-cardless",
      agentId: sessionActorId,
      nodeId: "node-1",
      harness: "codex",
      transport: "codex_app_server",
      state: "offline",
      projectRoot: "/Users/arach/dev/openscout",
      metadata: {
        cardless: true,
        pendingExternalSession: true,
        lastError: "Codex app-server cwd does not exist: /Users/arach/dev/openscout/packages/runtime/~/dev/openscout",
        lastFailedAt: "1779461800000",
      },
    };
    snapshot.conversations[chatId] = {
      id: chatId,
      kind: "direct",
      title: "Openscout",
      visibility: "private",
      shareMode: "local",
      authorityNodeId: "node-1",
      participantIds: ["operator", sessionActorId],
    };
    snapshot.messages["failed-cardless-msg"] = {
      id: "failed-cardless-msg",
      conversationId: chatId,
      actorId: sessionActorId,
      originNodeId: "node-1",
      class: "agent",
      body: "failed to respond",
      visibility: "private",
      policy: "durable",
      createdAt: 1_779_461_850_000,
    };
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot,
    };

    const conversations = await getScoutConversations();

    expect(conversations.find((entry) => entry.id === chatId)).toBeUndefined();
    expect(conversations.find((entry) => entry.id === "chat_hudson-main")).toBeDefined();
  });

  test("omits explicitly retired direct chats", async () => {
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

    expect(conversations.find((entry) => entry.id === "chat_hudson-main")).toBeUndefined();
  });

  test("reports unreadCount: 0 when the operator has no read cursor", async () => {
    brokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: baseSnapshot(),
    };

    const conversations = await getScoutConversations();
    const dm = conversations.find((entry) => entry.id === "chat_hudson-main");

    expect(dm?.unreadCount).toBe(0);
    expect(dm?.ask).toBeUndefined();
  });

  test("counts agent messages after the operator read cursor as unread", async () => {
    const snapshot = baseSnapshot();
    // One operator message already at createdAt 1_779_461_700_000; add two later
    // agent messages and an operator read cursor between them.
    snapshot.messages["msg-2"] = {
      id: "msg-2",
      conversationId: "chat_hudson-main",
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
      conversationId: "chat_hudson-main",
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
        conversationId: "chat_hudson-main",
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
    const dm = conversations.find((entry) => entry.id === "chat_hudson-main");

    // msg-2 and msg-3 are after the cursor and authored by the agent → 2 unread.
    expect(dm?.unreadCount).toBe(2);
  });

});
