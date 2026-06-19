import { describe, expect, test } from "bun:test";

import type {
  AgentDefinition,
  ScoutDeliverRequest,
  ScoutDispatchRecord,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
import {
  BrokerDeliveryRouter,
  buildDeliveryReceipt,
  callerContextForDelivery,
  executionWithRouteParams,
  normalizeScoutLabels,
  remediationForDispatch,
  shouldMaterializeProjectAgent,
} from "./broker-delivery-routing.js";
import type { StartLocalAgentInput } from "./local-agents.js";

function testPayload(input: Partial<ScoutDeliverRequest> = {}): ScoutDeliverRequest {
  return {
    body: "hello",
    intent: "consult",
    ...input,
  };
}

function testAgent(input: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agent-1",
    kind: "agent",
    definitionId: "agent",
    displayName: "Agent One",
    handle: "agent",
    labels: ["agent"],
    selector: "@agent",
    defaultSelector: "@agent",
    metadata: {},
    agentClass: "general",
    capabilities: ["chat", "invoke", "deliver"],
    wakePolicy: "on_demand",
    homeNodeId: "node-1",
    authorityNodeId: "node-1",
    advertiseScope: "local",
    ...input,
  };
}

describe("broker delivery routing", () => {
  test("resolves caller context and label-derived execution preferences", () => {
    expect(callerContextForDelivery(testPayload({
      caller: { actorId: " caller ", nodeId: " node-caller " },
      requesterId: "requester",
      requesterNodeId: "node-requester",
    }), {
      operatorActorId: "operator",
      nodeId: "node-1",
    })).toEqual({
      requesterId: "caller",
      requesterNodeId: "node-caller",
    });

    expect(callerContextForDelivery(testPayload(), {
      operatorActorId: "operator",
      nodeId: "node-1",
    })).toEqual({
      requesterId: "operator",
      requesterNodeId: "node-1",
    });

    expect(executionWithRouteParams(testPayload({
      targetLabel: "@ranger#codex?gpt-5",
    }))).toEqual({
      harness: "codex",
      model: "gpt-5",
    });

    expect(executionWithRouteParams(testPayload({
      targetLabel: "@ranger#codex?gpt-5",
      execution: { harness: "claude" },
    }))).toEqual({
      harness: "claude",
      model: "gpt-5",
    });
  });

  test("captures implicit project-card materialization policy", () => {
    const resolved = { kind: "resolved" as const, agent: testAgent() };
    const unknown = { kind: "unknown" as const, label: "@agent" };
    const ambiguous = {
      kind: "ambiguous" as const,
      label: "@agent",
      candidates: [testAgent({ id: "agent-a" }), testAgent({ id: "agent-b" })],
    };

    expect(shouldMaterializeProjectAgent({
      resolved,
      persistence: "one_time",
    })).toBe(false);
    expect(shouldMaterializeProjectAgent({
      projectPath: "/repo",
      resolved,
      persistence: "one_time",
      projectAgent: { persistence: "one_time" },
    })).toBe(true);
    expect(shouldMaterializeProjectAgent({
      projectPath: "/repo",
      resolved,
      persistence: "sticky",
      projectAgent: { persistence: "sticky", displayName: "Repo Agent" },
    })).toBe(true);
    expect(shouldMaterializeProjectAgent({
      projectPath: "/repo",
      resolved: unknown,
      persistence: "one_time",
    })).toBe(true);
    expect(shouldMaterializeProjectAgent({
      projectPath: "/repo",
      resolved: ambiguous,
      persistence: "one_time",
      execution: { session: "new" },
    })).toBe(true);
    expect(shouldMaterializeProjectAgent({
      projectPath: "/repo",
      resolved: ambiguous,
      persistence: "one_time",
      execution: { session: "existing" },
    })).toBe(false);
  });

  test("materializes a one-time project card before resolving the new agent", async () => {
    const runtime = createInMemoryControlRuntime({}, { localNodeId: "node-1" });
    const started: StartLocalAgentInput[] = [];
    const pruned: unknown[] = [];
    const logs: string[] = [];
    const router = new BrokerDeliveryRouter({
      runtimeSnapshot: () => runtime.snapshot(),
      nodeId: "node-1",
      implicitProjectCardTtlMs: 1_000,
      isInactiveLocalAgent: () => false,
      createId: () => "one-abcdef12",
      async startLocalAgent(input) {
        started.push(input);
        return {
          agentId: "agent-1",
          definitionId: input.agentName ?? "agent",
          projectName: "My App",
          projectRoot: "/tmp/My App",
          sessionId: "session-1",
          startedAt: 100,
          harness: input.harness ?? "codex",
          transport: "codex_app_server",
          isOnline: false,
          source: "manual",
        };
      },
      async pruneOneTimeLocalAgentCards(input) {
        pruned.push(input);
        return { inspected: 1, remaining: 1, retired: [] };
      },
      async syncRegisteredLocalAgents() {
        await runtime.upsertAgent(testAgent());
      },
      clearGitBranchCache() {
        logs.push("cleared");
      },
      log(message) {
        logs.push(message);
      },
    });

    const result = await router.resolveWithImplicitProjectAgent({
      target: { kind: "project_path", projectPath: "/tmp/My App" },
      execution: { harness: "codex", model: "gpt-5" },
      projectAgent: { persistence: "one_time" },
    }, {
      requesterId: "operator",
      reason: "test materialization",
    });

    expect(result).toEqual({ kind: "resolved", agent: testAgent() });
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual(expect.objectContaining({
      projectPath: "/tmp/My App",
      agentName: "my-app-card-abcdef12",
      currentDirectory: "/tmp/My App",
      harness: "codex",
      model: "gpt-5",
      ensureOnline: false,
      card: expect.objectContaining({
        kind: "one_time",
        createdById: "operator",
        maxUses: 1,
      }),
    }));
    expect(pruned).toEqual([
      expect.objectContaining({
        createdById: "operator",
        projectRoot: "/tmp/My App",
        excludeAgentIds: ["agent-1"],
      }),
    ]);
    expect(logs).toContain("cleared");
  });

  test("normalizes delivery labels, remediation, and receipts", () => {
    expect(normalizeScoutLabels([" ops ", "", "ops", "runtime"])).toEqual(["ops", "runtime"]);

    const dispatch: ScoutDispatchRecord = {
      id: "dispatch-1",
      kind: "unavailable",
      askedLabel: "@ranger",
      detail: "cannot use stale registration",
      candidates: [],
      dispatchedAt: 100,
      dispatcherNodeId: "node-1",
      target: {
        agentId: "agent-1",
        displayName: "Ranger",
        reason: "superseded_registration",
        detail: "newer registration exists",
        endpointState: "offline",
      },
    };
    expect(remediationForDispatch(dispatch)).toEqual(expect.objectContaining({
      kind: "use_current_registration",
      targetAgentId: "agent-1",
      targetLabel: "@ranger",
    }));

    expect(buildDeliveryReceipt({
      requestId: "deliver-1",
      routeKind: "dm",
      requesterId: "operator",
      requesterNodeId: "node-1",
      targetAgentId: "agent-1",
      targetLabel: "@agent",
      conversationId: "conversation-1",
      messageId: "message-1",
      flightId: "flight-1",
    })).toEqual(expect.objectContaining({
      requestId: "deliver-1",
      routeKind: "dm",
      requesterId: "operator",
      targetAgentId: "agent-1",
      targetLabel: "@agent",
      conversationId: "conversation-1",
      messageId: "message-1",
      flightId: "flight-1",
      acceptedAt: expect.any(Number),
    }));
  });
});
