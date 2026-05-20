import { afterEach, describe, expect, mock, test } from "bun:test";

afterEach(() => {
  mock.restore();
});

describe("agent service wiring", () => {
  test("uses the shared runtime agent service with web broker dependencies", async () => {
    const upScoutAgent = mock(async (_input: unknown) => ({
      agentId: "alpha.test-node",
      definitionId: "alpha",
      projectName: "Alpha",
      projectRoot: "/tmp/alpha",
      sessionId: "alpha-codex",
      startedAt: 123,
      harness: "codex" as const,
      transport: "codex_app_server" as const,
      isOnline: true,
      source: "manual" as const,
    }));
    const createScoutAgentService = mock((_deps: unknown) => ({
      createScoutAgentCard: mock(async (_input: unknown) => {
        throw new Error("unexpected card");
      }),
      downAllScoutAgents: mock(async () => []),
      downScoutAgent: mock(async () => null),
      loadScoutAgentStatuses: mock(async () => []),
      restartScoutAgents: mock(async () => []),
      upScoutAgent,
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

    const { upScoutAgent: wiredUpScoutAgent } = await import("./service.ts");
    const status = await wiredUpScoutAgent({
      projectPath: "/tmp/alpha",
      agentName: "alpha",
      harness: "codex",
    });

    expect(status.agentId).toBe("alpha.test-node");
    expect(createScoutAgentService.mock.calls).toHaveLength(1);
    expect(createScoutAgentService.mock.calls[0]?.[0]).toEqual({
      loadScoutBrokerContext,
      openScoutPeerSession,
      registerScoutLocalAgentBinding,
    });
    expect(upScoutAgent.mock.calls).toEqual([
      [{
        projectPath: "/tmp/alpha",
        agentName: "alpha",
        harness: "codex",
      }],
    ]);
  });
});
