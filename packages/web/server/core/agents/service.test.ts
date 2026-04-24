import { afterEach, describe, expect, mock, test } from "bun:test";

const originalNodeId = process.env.OPENSCOUT_NODE_ID;

afterEach(() => {
  mock.restore();
  if (originalNodeId === undefined) {
    delete process.env.OPENSCOUT_NODE_ID;
  } else {
    process.env.OPENSCOUT_NODE_ID = originalNodeId;
  }
});

function makeBinding() {
  return {
    actor: {
      id: "alpha.test-node",
      kind: "agent",
      displayName: "Alpha Agent",
      handle: "alpha",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        project: "Alpha",
        projectRoot: "/tmp/alpha",
      },
    },
    agent: {
      id: "alpha.test-node",
      kind: "agent",
      definitionId: "alpha",
      nodeQualifier: "test-node",
      workspaceQualifier: "",
      selector: "@alpha",
      defaultSelector: "@alpha",
      displayName: "Alpha Agent",
      handle: "alpha",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        project: "Alpha",
        projectRoot: "/tmp/alpha",
        selector: "@alpha",
        defaultSelector: "@alpha",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
    },
    endpoint: {
      id: "endpoint.alpha.node-1",
      agentId: "alpha.test-node",
      nodeId: "node-1",
      harness: "codex",
      transport: "codex_app_server",
      state: "idle",
      projectRoot: "/tmp/alpha",
      cwd: "/tmp/alpha",
      sessionId: "alpha-codex",
      metadata: {
        branch: "main",
      },
    },
  };
}

describe("agent service", () => {
  test("upScoutAgent keeps agent creation successful when broker binding registration fails", async () => {
    const status = {
      agentId: "alpha.test-node",
      definitionId: "alpha",
      projectName: "Alpha",
      projectRoot: "/tmp/alpha",
      sessionId: "alpha-codex",
      startedAt: 123,
      harness: "codex",
      transport: "codex_app_server",
      isOnline: true,
      source: "manual",
    };

    const startLocalAgent = mock(async () => status);
    const registerScoutLocalAgentBinding = mock(async () => {
      throw new Error("broker offline");
    });

    mock.module("@openscout/runtime/local-agents", () => ({
      listLocalAgents: mock(async () => []),
      restartAllLocalAgents: mock(async () => []),
      startLocalAgent,
      stopAllLocalAgents: mock(async () => []),
      stopLocalAgent: mock(async () => null),
      inferLocalAgentBinding: mock(async () => null),
    }));

    mock.module("../broker/service.ts", () => ({
      loadScoutBrokerContext: mock(async () => null),
      openScoutPeerSession: mock(async () => null),
      registerScoutLocalAgentBinding,
    }));

    const { upScoutAgent } = await import("./service.ts");
    const result = await upScoutAgent({
      projectPath: "/tmp/alpha",
      agentName: "alpha",
      harness: "codex",
      model: "gpt-5.4-mini",
    });

    expect(result).toEqual(status);
    expect(startLocalAgent.mock.calls).toEqual([
      [{
        projectPath: "/tmp/alpha",
        agentName: "alpha",
        harness: "codex",
        model: "gpt-5.4-mini",
      }],
    ]);
    expect(registerScoutLocalAgentBinding.mock.calls).toEqual([
      [{ agentId: "alpha.test-node" }],
    ]);
  });

  test("createScoutAgentCard opens an inbox session for a different creator and returns the synced card", async () => {
    const binding = makeBinding();
    const status = {
      agentId: binding.agent.id,
      definitionId: binding.agent.definitionId,
      projectName: "Alpha",
      projectRoot: "/tmp/alpha",
      sessionId: "alpha-codex",
      startedAt: 123,
      harness: "codex",
      transport: "codex_app_server",
      isOnline: true,
      source: "manual",
    };
    const broker = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: {
        actors: {},
        agents: {},
        endpoints: {},
        conversations: {},
        messages: {},
        flights: {},
      },
    };

    const startLocalAgent = mock(async () => status);
    const registerScoutLocalAgentBinding = mock(async () => ({
      binding,
      brokerRegistered: true,
    }));
    const openScoutPeerSession = mock(async () => ({
      sourceId: "operator",
      targetId: binding.agent.id,
      agent: binding.agent,
      existed: false,
      conversation: {
        id: "conv-alpha",
      },
    }));

    mock.module("@openscout/runtime/local-agents", () => ({
      listLocalAgents: mock(async () => []),
      restartAllLocalAgents: mock(async () => []),
      startLocalAgent,
      stopAllLocalAgents: mock(async () => []),
      stopLocalAgent: mock(async () => null),
      inferLocalAgentBinding: mock(async () => {
        throw new Error("unexpected fallback binding lookup");
      }),
    }));

    mock.module("../broker/service.ts", () => ({
      loadScoutBrokerContext: mock(async () => broker),
      openScoutPeerSession,
      registerScoutLocalAgentBinding,
    }));

    const { createScoutAgentCard } = await import("./service.ts");
    const card = await createScoutAgentCard({
      projectPath: "/tmp/alpha",
      currentDirectory: "/tmp/alpha",
      createdById: "operator",
      model: "gpt-5.4-mini",
    });

    expect(card.agentId).toBe(binding.agent.id);
    expect(card.displayName).toBe("Alpha Agent");
    expect(card.projectRoot).toBe("/tmp/alpha");
    expect(card.currentDirectory).toBe("/tmp/alpha");
    expect(card.brokerRegistered).toBe(true);
    expect(card.createdById).toBe("operator");
    expect(card.inboxConversationId).toBe("conv-alpha");
    expect(card.returnAddress.conversationId).toBe("conv-alpha");
    expect(startLocalAgent.mock.calls).toEqual([
      [{
        projectPath: "/tmp/alpha",
        currentDirectory: "/tmp/alpha",
        createdById: "operator",
        model: "gpt-5.4-mini",
      }],
    ]);
    expect(registerScoutLocalAgentBinding.mock.calls).toEqual([
      [{ agentId: binding.agent.id, broker }],
    ]);
    expect(openScoutPeerSession.mock.calls).toEqual([
      [{
        sourceId: "operator",
        targetId: binding.agent.id,
        currentDirectory: "/tmp/alpha",
      }],
    ]);
  });

  test("createScoutAgentCard falls back to inferring the binding from disk and skips self-inbox sessions", async () => {
    process.env.OPENSCOUT_NODE_ID = "node-fallback";

    const binding = makeBinding();
    const status = {
      agentId: binding.agent.id,
      definitionId: binding.agent.definitionId,
      projectName: "Alpha",
      projectRoot: "/tmp/alpha",
      sessionId: "alpha-codex",
      startedAt: 123,
      harness: "codex",
      transport: "codex_app_server",
      isOnline: true,
      source: "manual",
    };

    const startLocalAgent = mock(async () => status);
    const inferLocalAgentBinding = mock(async () => binding);
    const openScoutPeerSession = mock(async () => {
      throw new Error("self-created cards should not open a peer session");
    });

    mock.module("@openscout/runtime/local-agents", () => ({
      listLocalAgents: mock(async () => []),
      restartAllLocalAgents: mock(async () => []),
      startLocalAgent,
      stopAllLocalAgents: mock(async () => []),
      stopLocalAgent: mock(async () => null),
      inferLocalAgentBinding,
    }));

    mock.module("../broker/service.ts", () => ({
      loadScoutBrokerContext: mock(async () => null),
      openScoutPeerSession,
      registerScoutLocalAgentBinding: mock(async () => null),
    }));

    const { createScoutAgentCard } = await import("./service.ts");
    const card = await createScoutAgentCard({
      projectPath: "/tmp/alpha",
      currentDirectory: "/tmp/alpha",
      createdById: binding.agent.id,
    });

    expect(card.agentId).toBe(binding.agent.id);
    expect(card.brokerRegistered).toBe(false);
    expect(card.inboxConversationId).toBeUndefined();
    expect(card.returnAddress.conversationId).toBeUndefined();
    expect(inferLocalAgentBinding.mock.calls).toEqual([
      [binding.agent.id, "node-fallback"],
    ]);
    expect(openScoutPeerSession.mock.calls).toHaveLength(0);
  });
});
