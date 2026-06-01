import { describe, expect, test } from "bun:test";
import { prefilterHandle } from "./prefilter.ts";

describe("scoutbot prefilter", () => {
  test("answers /agents with matched rule metadata", () => {
    const reply = prefilterHandle("/agents", {
      actors: {},
      agents: {
        hudson: {
          id: "hudson",
          kind: "agent",
          displayName: "Hudson",
          handle: "hudson",
          defaultSelector: "@hudson",
          definitionId: "hudson",
          labels: [],
          metadata: {},
          agentClass: "general",
          capabilities: [],
          wakePolicy: "manual",
          homeNodeId: "node-1",
          authorityNodeId: "node-1",
          advertiseScope: "local",
        },
      },
      endpoints: {
        "endpoint.hudson": {
          id: "endpoint.hudson",
          agentId: "hudson",
          nodeId: "node-1",
          transport: "codex_app_server",
          state: "idle",
        },
      },
      conversations: {},
      messages: {},
      nodes: {},
      flights: {},
    }, 1234);

    expect(reply?.metadata).toMatchObject({
      matched_rule: "slash.agents",
      snapshot_at: 1234,
      scoutbotAction: "agents",
    });
    expect(reply?.body).toContain("@hudson");
    expect(reply?.body).not.toContain("matched_rule: slash.agents");
    expect(reply?.body).not.toContain("snapshot_at:");
  });

  test("hides stale Scoutbot direct deliveries from /status active work", () => {
    const reply = prefilterHandle("/status", {
      actors: {},
      agents: {},
      endpoints: {},
      conversations: {},
      messages: {},
      nodes: {},
      flights: {
        "flight-real": {
          id: "flight-real",
          invocationId: "inv-real",
          requesterId: "operator",
          targetAgentId: "hudson",
          state: "running",
          summary: "checking the build",
          startedAt: 200,
          metadata: {},
        },
        "flight-scoutbot-direct": {
          id: "flight-scoutbot-direct",
          invocationId: "inv-scoutbot-direct",
          requesterId: "operator",
          targetAgentId: "scoutbot",
          state: "queued",
          summary: "Message stored for Scout. Will deliver when online.",
          startedAt: 300,
          metadata: {
            source: "scout-mobile",
            destinationKind: "direct",
            destinationId: "scoutbot",
          },
        },
      },
    }, 1234);

    expect(reply?.metadata.matched_rule).toBe("slash.status");
    expect(reply?.body).toContain("1 active flight.");
    expect(reply?.body).toContain("1 stale Scoutbot direct delivery hidden");
    expect(reply?.body).toContain("flight-real: hudson");
    expect(reply?.body).not.toContain("flight-scoutbot-direct");
  });

  test("accepts effort directives on slash commands without treating them as args", () => {
    const reply = prefilterHandle("/status eff:low", {
      actors: {},
      agents: {},
      endpoints: {},
      conversations: {},
      messages: {},
      nodes: {},
      flights: {},
    }, 1234);

    expect(reply?.metadata).toMatchObject({
      matched_rule: "slash.status",
      reasoningEffort: "low",
      scoutbotAction: "status",
    });
    expect(reply?.body).toContain("0 active flights.");
    expect(reply?.body).not.toContain("eff:low");
  });

  test("accepts slash actions and session directives anywhere in the message", () => {
    const reply = prefilterHandle("can you /doing Hudson session:3234", {
      actors: {},
      agents: {
        hudson: {
          id: "hudson",
          kind: "agent",
          displayName: "Hudson",
          handle: "hudson",
          defaultSelector: "@hudson",
          definitionId: "hudson",
          labels: [],
          metadata: {},
          agentClass: "general",
          capabilities: [],
          wakePolicy: "manual",
          homeNodeId: "node-1",
          authorityNodeId: "node-1",
          advertiseScope: "local",
        },
      },
      endpoints: {},
      conversations: {},
      messages: {},
      nodes: {},
      flights: {},
    }, 1234);

    expect(reply?.metadata).toMatchObject({
      matched_rule: "slash.doing",
      scoutbotAction: "doing",
      targetSessionId: "3234",
    });
    expect(reply?.body).toContain("@hudson has no active flight");
  });

  test("steers a ScoutBot thread to an explicit session target", () => {
    const reply = prefilterHandle("/steer session:3234", {
      actors: {}, agents: {}, endpoints: {}, conversations: {}, messages: {}, nodes: {}, flights: {},
    }, 1234);

    expect(reply?.metadata).toMatchObject({
      matched_rule: "slash.steer",
      scoutbotAction: "steer",
      targetSessionId: "3234",
    });
    expect(reply?.body).toBe("Steering this ScoutBot thread to session 3234.");
  });

  test("answers latest-on-agent status from broker facts without Codex", () => {
    const reply = prefilterHandle("what's latest on Hudson", {
      actors: {},
      agents: {
        hudson: {
          id: "hudson",
          kind: "agent",
          displayName: "Hudson",
          handle: "hudson",
          defaultSelector: "@hudson",
          definitionId: "hudson",
          labels: [],
          metadata: {},
          agentClass: "general",
          capabilities: [],
          wakePolicy: "manual",
          homeNodeId: "node-1",
          authorityNodeId: "node-1",
          advertiseScope: "local",
        },
      },
      endpoints: {},
      conversations: {},
      messages: {
        "msg-hudson": {
          id: "msg-hudson",
          conversationId: "dm.operator.hudson",
          actorId: "hudson",
          class: "agent",
          body: "Found the failing compile path.",
          createdAt: 1000,
        },
      },
      nodes: {},
      flights: {
        "flight-hudson": {
          id: "flight-hudson",
          invocationId: "inv-hudson",
          requesterId: "operator",
          targetAgentId: "hudson",
          state: "running",
          summary: "checking the build",
          startedAt: 2000,
          metadata: {},
        },
      },
    }, 1234);

    expect(reply?.metadata.matched_rule).toBe("status.latest_agent");
    expect(reply?.body).toContain("Latest on @hudson");
    expect(reply?.body).toContain("current: running - checking the build");
    expect(reply?.body).toContain("recent:");
    expect(reply?.body).toContain("Found the failing compile path.");
  });

  test("falls through for ambiguous natural language", () => {
    expect(prefilterHandle("can you think through the HUD redesign?", {
      actors: {}, agents: {}, endpoints: {}, conversations: {}, messages: {}, nodes: {}, flights: {},
    })).toBeNull();
  });
});
