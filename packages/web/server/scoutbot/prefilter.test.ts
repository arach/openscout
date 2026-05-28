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

    expect(reply?.metadata).toEqual({ matched_rule: "slash.agents", snapshot_at: 1234 });
    expect(reply?.body).toContain("@hudson");
    expect(reply?.body).toContain("matched_rule: slash.agents");
  });

  test("falls through for ambiguous natural language", () => {
    expect(prefilterHandle("can you think through the HUD redesign?", {
      actors: {}, agents: {}, endpoints: {}, conversations: {}, messages: {}, nodes: {}, flights: {},
    })).toBeNull();
  });
});
