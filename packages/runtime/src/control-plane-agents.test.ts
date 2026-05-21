import { afterEach, describe, expect, mock, test } from "bun:test";

import { createScoutAgentService } from "./control-plane-agents.ts";

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
      kind: "agent" as const,
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
      kind: "agent" as const,
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
      agentClass: "general" as const,
      capabilities: ["chat", "invoke", "deliver"] as const,
      wakePolicy: "on_demand" as const,
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local" as const,
    },
    endpoint: {
      id: "endpoint.alpha.node-1",
      agentId: "alpha.test-node",
      nodeId: "node-1",
      harness: "codex" as const,
      transport: "codex_app_server" as const,
      state: "idle" as const,
      projectRoot: "/tmp/alpha",
      cwd: "/tmp/alpha",
      sessionId: "alpha-codex",
      metadata: {
        branch: "main",
      },
    },
  };
}

function makeStatus(binding = makeBinding()) {
  return {
    agentId: binding.agent.id,
    definitionId: binding.agent.definitionId,
    projectName: "Alpha",
    projectRoot: "/tmp/alpha",
    sessionId: "alpha-codex",
    startedAt: 123,
    harness: "codex" as const,
    transport: "codex_app_server" as const,
    isOnline: true,
    source: "manual" as const,
  };
}

describe("createScoutAgentService", () => {
  test("upScoutAgent keeps creation successful when broker binding registration fails", async () => {
    const status = makeStatus();
    const startLocalAgent = mock(async () => status);
    const registerScoutLocalAgentBinding = mock(async () => {
      throw new Error("broker offline");
    });
    const service = createScoutAgentService({
      loadScoutBrokerContext: mock(async () => null),
      openScoutPeerSession: mock(async () => {
        throw new Error("unexpected peer session");
      }),
      registerScoutLocalAgentBinding,
      localAgents: {
        listLocalAgents: mock(async () => []),
        restartAllLocalAgents: mock(async () => []),
        startLocalAgent,
        stopAllLocalAgents: mock(async () => []),
        stopLocalAgent: mock(async () => null),
        inferLocalAgentBinding: mock(async () => null),
      },
    });

    const result = await service.upScoutAgent({
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

  test("createScoutAgentCard registers a card without owning the live session", async () => {
    const binding = makeBinding();
    const status = makeStatus(binding);
    const broker = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: {},
    };
    const startLocalAgent = mock(async () => status);
    const registerScoutLocalAgentBinding = mock(async () => ({
      binding,
      brokerRegistered: true,
    }));
    const openScoutPeerSession = mock(async () => ({
      sourceId: "operator",
      conversation: {
        id: "conv-alpha",
      },
    }));
    const service = createScoutAgentService({
      loadScoutBrokerContext: mock(async () => broker),
      openScoutPeerSession,
      registerScoutLocalAgentBinding,
      localAgents: {
        listLocalAgents: mock(async () => []),
        restartAllLocalAgents: mock(async () => []),
        startLocalAgent,
        stopAllLocalAgents: mock(async () => []),
        stopLocalAgent: mock(async () => null),
        inferLocalAgentBinding: mock(async () => {
          throw new Error("unexpected fallback binding lookup");
        }),
      },
    });

    const card = await service.createScoutAgentCard({
      projectPath: "/tmp/alpha",
      currentDirectory: "/tmp/alpha",
      createdById: "operator",
      model: "gpt-5.4-mini",
      reasoningEffort: "high",
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
        agentName: undefined,
        displayName: undefined,
        harness: undefined,
        model: "gpt-5.4-mini",
        reasoningEffort: "high",
        permissionProfile: undefined,
        currentDirectory: "/tmp/alpha",
        ensureOnline: false,
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

  test("createScoutAgentCard falls back to inferring binding and skips self-inbox sessions", async () => {
    process.env.OPENSCOUT_NODE_ID = "node-fallback";

    const binding = makeBinding();
    const status = makeStatus(binding);
    const startLocalAgent = mock(async () => status);
    const inferLocalAgentBinding = mock(async () => binding);
    const openScoutPeerSession = mock(async () => {
      throw new Error("self-created cards should not open a peer session");
    });
    const service = createScoutAgentService({
      loadScoutBrokerContext: mock(async () => null),
      openScoutPeerSession,
      registerScoutLocalAgentBinding: mock(async () => null),
      localAgents: {
        listLocalAgents: mock(async () => []),
        restartAllLocalAgents: mock(async () => []),
        startLocalAgent,
        stopAllLocalAgents: mock(async () => []),
        stopLocalAgent: mock(async () => null),
        inferLocalAgentBinding,
      },
    });

    const card = await service.createScoutAgentCard({
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

  test("updateScoutAgentCard updates local config, restarts, and resyncs broker", async () => {
    const config = {
      agentId: "alpha.test-node",
      editable: true,
      model: "claude-opus-4-7",
      permissionProfile: null,
      systemPrompt: "prompt",
      runtime: {
        cwd: "/tmp/alpha",
        harness: "claude" as const,
        transport: "tmux" as const,
        sessionId: "alpha-claude",
        wakePolicy: "on_demand" as const,
      },
      launchArgs: ["--model", "claude-opus-4-7"],
      capabilities: ["chat", "invoke", "deliver"],
      applyMode: "restart" as const,
      templateHint: "hint",
    };
    const updateLocalAgentCard = mock(async () => config);
    const restartLocalAgent = mock(async () => makeStatus());
    const registerScoutLocalAgentBinding = mock(async () => null);
    const service = createScoutAgentService({
      loadScoutBrokerContext: mock(async () => null),
      openScoutPeerSession: mock(async () => {
        throw new Error("unexpected peer session");
      }),
      registerScoutLocalAgentBinding,
      localAgents: {
        listLocalAgents: mock(async () => []),
        restartAllLocalAgents: mock(async () => []),
        restartLocalAgent,
        startLocalAgent: mock(async () => makeStatus()),
        stopAllLocalAgents: mock(async () => []),
        stopLocalAgent: mock(async () => null),
        updateLocalAgentCard,
        inferLocalAgentBinding: mock(async () => null),
      },
    });

    const result = await service.updateScoutAgentCard("alpha.test-node", {
      harness: "claude",
      model: "claude-opus-4-7",
      restart: true,
    });

    expect(result).toEqual(config);
    expect(updateLocalAgentCard.mock.calls).toEqual([
      ["alpha.test-node", {
        harness: "claude",
        model: "claude-opus-4-7",
        restart: true,
      }],
    ]);
    expect(restartLocalAgent.mock.calls).toEqual([["alpha.test-node"]]);
    expect(registerScoutLocalAgentBinding.mock.calls).toEqual([
      [{ agentId: "alpha.test-node" }],
    ]);
  });

  test("retireScoutAgentCard removes local config and marks broker registration retired", async () => {
    const status = makeStatus();
    const broker = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: {},
    };
    const retireLocalAgent = mock(async () => status);
    const retireScoutLocalAgentBinding = mock(async () => true);
    const service = createScoutAgentService({
      loadScoutBrokerContext: mock(async () => broker),
      openScoutPeerSession: mock(async () => {
        throw new Error("unexpected peer session");
      }),
      registerScoutLocalAgentBinding: mock(async () => null),
      retireScoutLocalAgentBinding,
      localAgents: {
        listLocalAgents: mock(async () => []),
        retireLocalAgent,
        restartAllLocalAgents: mock(async () => []),
        startLocalAgent: mock(async () => status),
        stopAllLocalAgents: mock(async () => []),
        stopLocalAgent: mock(async () => null),
        inferLocalAgentBinding: mock(async () => null),
      },
    });

    const result = await service.retireScoutAgentCard("alpha.test-node");

    expect(result).toEqual(status);
    expect(retireLocalAgent.mock.calls).toEqual([["alpha.test-node"]]);
    expect(retireScoutLocalAgentBinding.mock.calls).toEqual([
      [{ agentId: "alpha.test-node", broker }],
    ]);
  });
});
