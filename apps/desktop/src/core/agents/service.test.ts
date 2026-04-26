import { afterEach, describe, expect, mock, test } from "bun:test";

afterEach(() => {
  mock.restore();
});

describe("createScoutAgentCard", () => {
  test("registers a card without forcing the creating process to own the live session", async () => {
    const actualLocalAgents = await import("@openscout/runtime/local-agents");
    const actualBrokerService = await import("../broker/service.ts");
    const startLocalAgent = mock(async () => ({
      agentId: "meshreview-opus.main.mini",
      definitionId: "meshreview-opus",
      projectName: "Openscout",
      projectRoot: "/tmp/openscout",
      sessionId: "relay-openscout-claude",
      startedAt: 123,
      harness: "claude",
      transport: "claude_stream_json",
      isOnline: false,
      source: "manual",
    }));
    const registerScoutLocalAgentBinding = mock(async () => ({
      brokerRegistered: true,
      binding: {
        actor: {
          id: "meshreview-opus.main.mini",
          kind: "agent",
          displayName: "Mesh Review Opus",
          handle: "meshreview-opus",
          labels: [],
          metadata: {},
        },
        agent: {
          id: "meshreview-opus.main.mini",
          kind: "agent",
          definitionId: "meshreview-opus",
          selector: "@meshreview-opus.main.node:mini",
          defaultSelector: "@meshreview-opus",
          displayName: "Mesh Review Opus",
          handle: "meshreview-opus",
          labels: [],
          metadata: {},
          agentClass: "general",
          capabilities: ["chat", "invoke", "deliver"],
          wakePolicy: "on_demand",
          homeNodeId: "node-1",
          authorityNodeId: "node-1",
          advertiseScope: "local",
        },
        endpoint: {
          id: "endpoint.meshreview-opus",
          agentId: "meshreview-opus.main.mini",
          nodeId: "node-1",
          harness: "claude",
          transport: "claude_stream_json",
          state: "waiting",
          cwd: "/tmp/openscout",
          projectRoot: "/tmp/openscout",
          sessionId: "relay-openscout-claude",
          metadata: {},
        },
      },
    }));
    const buildScoutAgentCard = mock((_binding, _options) => ({
      id: "meshreview-opus.main.mini",
      agentId: "meshreview-opus.main.mini",
      definitionId: "meshreview-opus",
      displayName: "Mesh Review Opus",
      handle: "meshreview-opus",
      projectRoot: "/tmp/openscout",
      currentDirectory: "/tmp/openscout",
      harness: "claude",
      transport: "claude_stream_json",
      createdAt: 123,
      brokerRegistered: true,
      returnAddress: {
        actorId: "meshreview-opus.main.mini",
        handle: "meshreview-opus",
      },
      metadata: {},
    }));

    mock.module("@openscout/runtime/local-agents", () => ({
      ...actualLocalAgents,
      startLocalAgent,
    }));
    mock.module("@openscout/runtime/scout-agent-cards", () => ({
      buildScoutAgentCard,
    }));
    mock.module("../broker/service.ts", () => ({
      ...actualBrokerService,
      loadScoutBrokerContext: mock(async () => ({
        baseUrl: "http://127.0.0.1:65535",
        node: { id: "node-1" },
        snapshot: {},
      })),
      openScoutPeerSession: mock(async () => {
        throw new Error("unexpected peer session");
      }),
      registerScoutLocalAgentBinding,
    }));

    const { createScoutAgentCard } = await import("./service.ts");
    await createScoutAgentCard({
      projectPath: "/tmp/openscout",
      agentName: "meshreview-opus",
      displayName: "Mesh Review Opus",
      harness: "claude",
      model: "opus",
      currentDirectory: "/tmp/openscout",
    });

    expect(startLocalAgent.mock.calls).toEqual([
      [{
        projectPath: "/tmp/openscout",
        agentName: "meshreview-opus",
        displayName: "Mesh Review Opus",
        harness: "claude",
        model: "opus",
        currentDirectory: "/tmp/openscout",
        ensureOnline: false,
      }],
    ]);
    expect(registerScoutLocalAgentBinding).toHaveBeenCalledTimes(1);
    expect(buildScoutAgentCard).toHaveBeenCalledTimes(1);
  });
});
