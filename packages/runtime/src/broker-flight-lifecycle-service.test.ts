import { describe, expect, test } from "bun:test";

import type {
  AgentDefinition,
  AgentEndpoint,
  DeliveryIntent,
  FlightRecord,
  InvocationRequest,
} from "@openscout/protocol";

import {
  BrokerFlightLifecycleService,
  deliveryStatusForFlight,
  shouldIgnoreFlightUpdate,
  staleLocalDeliveryReason,
} from "./broker-flight-lifecycle-service.js";
import type { RuntimeSnapshot } from "./scout-dispatcher.js";

function testAgent(input: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agent-1",
    kind: "agent",
    definitionId: "agent-1",
    displayName: "Agent One",
    handle: "agent-one",
    labels: ["agent"],
    metadata: {},
    selector: "@agent-one",
    defaultSelector: "@agent-one",
    agentClass: "general",
    capabilities: ["chat", "invoke", "deliver"],
    wakePolicy: "on_demand",
    homeNodeId: "node-1",
    authorityNodeId: "node-1",
    advertiseScope: "local",
    ...input,
  };
}

function testEndpoint(input: Partial<AgentEndpoint> = {}): AgentEndpoint {
  return {
    id: "endpoint-1",
    agentId: "agent-1",
    nodeId: "node-1",
    harness: "codex",
    transport: "tmux",
    state: "offline",
    metadata: {
      staleLocalRegistration: true,
      replacedByAgentId: "agent-2",
      lastStartedAt: 1_000,
    },
    ...input,
  };
}

function testInvocation(input: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    id: "invocation-1",
    requesterId: "operator",
    requesterNodeId: "node-1",
    targetAgentId: "agent-1",
    action: "consult",
    task: "hello",
    messageId: "message-1",
    ensureAwake: false,
    stream: false,
    createdAt: 1_000,
    metadata: {},
    ...input,
  };
}

function testFlight(input: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: "flight-1",
    invocationId: "invocation-1",
    requesterId: "operator",
    targetAgentId: "agent-1",
    state: "running",
    startedAt: 1_000,
    metadata: {},
    ...input,
  };
}

function testDelivery(input: Partial<DeliveryIntent> = {}): DeliveryIntent {
  return {
    id: "delivery-1",
    messageId: "message-1",
    invocationId: "invocation-1",
    targetId: "agent-1",
    targetKind: "agent",
    transport: "tmux",
    reason: "mention",
    policy: "durable",
    status: "pending",
    metadata: {},
    ...input,
  };
}

function testSnapshot(input: {
  agents?: Record<string, AgentDefinition>;
  endpoints?: Record<string, AgentEndpoint>;
  invocations?: Record<string, InvocationRequest>;
  flights?: Record<string, FlightRecord>;
} = {}): RuntimeSnapshot {
  return {
    nodes: {},
    actors: {},
    agents: input.agents ?? {},
    endpoints: input.endpoints ?? {},
    conversations: {},
    bindings: {},
    messages: {},
    readCursors: {},
    invocations: input.invocations ?? {},
    flights: input.flights ?? {},
    collaborationRecords: {},
    unblockRequests: {},
  };
}

function createHarness(input: {
  snapshot?: RuntimeSnapshot;
  deliveries?: DeliveryIntent[];
  invocation?: InvocationRequest;
  activeInvocationIds?: string[];
  now?: number;
} = {}) {
  const snapshot = input.snapshot ?? testSnapshot({
    agents: { "agent-1": testAgent() },
    invocations: { "invocation-1": input.invocation ?? testInvocation() },
    flights: {},
  });
  const committedFlights: FlightRecord[] = [];
  const appliedEntries: unknown[] = [];
  const updatedDeliveries: Array<{
    deliveryId: string;
    status: DeliveryIntent["status"];
    metadata?: Record<string, unknown>;
    leaseOwner?: string | null;
    leaseExpiresAt?: number | null;
  }> = [];
  const promoted: Array<{ invocation: InvocationRequest; flight: FlightRecord; output: string | undefined }> = [];
  const forwardedFlights: FlightRecord[] = [];
  const warnings: string[] = [];
  const activeInvocationIds = new Set(input.activeInvocationIds ?? []);

  const service = new BrokerFlightLifecycleService({
    runtime: {
      snapshot: () => snapshot,
      async upsertFlight(flight) {
        snapshot.flights[flight.id] = flight;
        committedFlights.push(flight);
      },
    },
    journal: {
      listDeliveries: () => input.deliveries ?? [],
    },
    durableStore: {
      async runWrite(work) {
        return await work();
      },
      async commitEntries(entries, applyRuntime) {
        const retainedEntries = Array.isArray(entries) ? entries : [entries];
        await applyRuntime(retainedEntries);
        return retainedEntries;
      },
      async applyProjectedEntries(entries) {
        appliedEntries.push(...(Array.isArray(entries) ? entries : [entries]));
      },
    },
    invocationFor: (invocationId) => input.invocation ?? snapshot.invocations[invocationId],
    async updateDeliveryStatus(update) {
      updatedDeliveries.push(update);
    },
    async promoteInvocationFlightToWork(invocation, flight, output) {
      promoted.push({ invocation, flight, output });
    },
    async maybeForwardFlightToAuthority(flight) {
      forwardedFlights.push(flight);
    },
    isInvocationActive: (invocationId) => activeInvocationIds.has(invocationId),
    warn: (message) => warnings.push(message),
    now: () => input.now ?? 10_000,
  });

  return {
    appliedEntries,
    committedFlights,
    forwardedFlights,
    promoted,
    service,
    snapshot,
    updatedDeliveries,
    warnings,
  };
}

describe("broker flight lifecycle helpers", () => {
  test("classifies terminal downgrades and delivery statuses", () => {
    expect(shouldIgnoreFlightUpdate(
      testFlight({ state: "completed" }),
      testFlight({ state: "running" }),
    )).toBe(true);
    expect(shouldIgnoreFlightUpdate(
      testFlight({ state: "running" }),
      testFlight({ state: "completed" }),
    )).toBe(false);

    expect(deliveryStatusForFlight(testFlight({ state: "running" }))).toBe("running");
    expect(deliveryStatusForFlight(testFlight({ state: "waiting" }))).toBe("running");
    expect(deliveryStatusForFlight(testFlight({ state: "completed" }))).toBe("completed");
    expect(deliveryStatusForFlight(testFlight({ state: "waking" }))).toBeNull();
  });

  test("ignores non-terminal updates after a terminal flight", async () => {
    const terminal = testFlight({ state: "completed", completedAt: 2_000 });
    const harness = createHarness({
      snapshot: testSnapshot({
        flights: { [terminal.id]: terminal },
      }),
    });

    await harness.service.recordFlight(testFlight({ state: "running" }));

    expect(harness.committedFlights).toEqual([]);
    expect(harness.appliedEntries).toEqual([]);
    expect(harness.warnings).toEqual([
      "[openscout-runtime] ignored stale flight update flight-1: completed -> running",
    ]);
  });

  test("records terminal flights, updates deliveries, promotes work, and forwards", async () => {
    const invocation = testInvocation();
    const delivery = testDelivery({ status: "running" });
    const completed = testFlight({
      state: "completed",
      completedAt: 4_000,
      output: "done",
    });
    const harness = createHarness({
      invocation,
      deliveries: [
        delivery,
        testDelivery({ id: "terminal-delivery", status: "failed" }),
      ],
      now: 20_000,
    });

    await harness.service.recordFlight(completed);

    expect(harness.committedFlights).toEqual([completed]);
    expect(harness.appliedEntries).toEqual([{ kind: "flight.record", flight: completed }]);
    expect(harness.updatedDeliveries).toEqual([
      {
        deliveryId: "delivery-1",
        status: "completed",
        metadata: {
          invocationId: "invocation-1",
          flightId: "flight-1",
          flightState: "completed",
          flightStatusUpdatedAt: 4_000,
        },
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    ]);
    expect(harness.promoted).toEqual([{ invocation, flight: completed, output: "done" }]);
    expect(harness.forwardedFlights).toEqual([completed]);
  });

  test("fails deliveries when every local endpoint for the target is stale", async () => {
    const endpoint = testEndpoint();
    const delivery = testDelivery({ status: "pending" });
    const snapshot = testSnapshot({
      agents: { "agent-1": testAgent() },
      endpoints: { [endpoint.id]: endpoint },
    });
    const harness = createHarness({
      snapshot,
      deliveries: [delivery],
      now: 30_000,
    });

    expect(staleLocalDeliveryReason(snapshot, delivery)).toContain("superseded local registration");

    await harness.service.reconcileStaleLocalDeliveries();

    expect(harness.updatedDeliveries).toEqual([
      expect.objectContaining({
        deliveryId: "delivery-1",
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        metadata: expect.objectContaining({
          failureReason: "agent_offline",
          staleLocalRegistration: true,
          reconciledStaleDelivery: true,
          reconciledAt: 30_000,
        }),
      }),
    ]);
  });
});
