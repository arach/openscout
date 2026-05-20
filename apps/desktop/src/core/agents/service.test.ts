import { afterEach, describe, expect, mock, test } from "bun:test";

afterEach(() => {
  mock.restore();
});

describe("agent service wiring", () => {
  test("uses the shared runtime agent service with desktop broker dependencies", async () => {
    const fixtureCard = {
      id: "alpha.test-node",
      agentId: "alpha.test-node",
      definitionId: "alpha",
      displayName: "Alpha Agent",
      handle: "alpha",
      projectRoot: "/tmp/alpha",
      currentDirectory: "/tmp/alpha",
      harness: "codex" as const,
      transport: "codex_app_server" as const,
      createdAt: 123,
      brokerRegistered: false,
      returnAddress: {
        actorId: "alpha.test-node",
        handle: "alpha",
      },
      metadata: {},
    };
    const createScoutAgentCard = mock(async (_input: unknown) => fixtureCard);
    const createScoutAgentService = mock((_deps: unknown) => ({
      createScoutAgentCard,
      downAllScoutAgents: mock(async () => []),
      downScoutAgent: mock(async () => null),
      loadScoutAgentStatuses: mock(async () => []),
      restartScoutAgents: mock(async () => []),
      upScoutAgent: mock(async (_input: unknown) => {
        throw new Error("unexpected up");
      }),
    }));
    const loadScoutBrokerContext = mock(async () => null);
    const openScoutPeerSession = mock(async () => {
      throw new Error("unexpected peer session");
    });
    const registerScoutLocalAgentBinding = mock(async () => null);

    mock.module("@openscout/runtime/control-plane-agents", () => ({
      createScoutAgentService,
    }));
    mock.module("../broker/service.ts", () => ({
      loadScoutBrokerContext,
      openScoutPeerSession,
      registerScoutLocalAgentBinding,
    }));

    const { createScoutAgentCard: wiredCreateScoutAgentCard } = await import("./service.ts");
    const card = await wiredCreateScoutAgentCard({
      projectPath: "/tmp/alpha",
      currentDirectory: "/tmp/alpha",
    });

    expect(card.agentId).toBe("alpha.test-node");
    expect(createScoutAgentService.mock.calls).toHaveLength(1);
    expect(createScoutAgentService.mock.calls[0]?.[0]).toEqual({
      loadScoutBrokerContext,
      openScoutPeerSession,
      registerScoutLocalAgentBinding,
    });
    expect(createScoutAgentCard.mock.calls).toEqual([
      [{
        projectPath: "/tmp/alpha",
        currentDirectory: "/tmp/alpha",
      }],
    ]);
  });
});
