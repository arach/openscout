import { describe, expect, test } from "bun:test";

import type { DeliveryIntent, DeliveryAttempt } from "./deliveries";
import type { FlightRecord, InvocationRequest } from "./invocations";
import {
  projectDeliveryState,
  projectInvocationLifecycle,
  projectInvocationState,
  projectOutcomeDelivery,
} from "./lifecycle";

function makeInvocation(input: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    id: "inv-1",
    requesterId: "operator",
    requesterNodeId: "node-operator",
    targetAgentId: "agent-1",
    action: "consult",
    task: "Summarize state.",
    ensureAwake: true,
    stream: false,
    createdAt: 1_000,
    ...input,
  };
}

function makeFlight(input: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: "flight-1",
    invocationId: "inv-1",
    requesterId: "operator",
    targetAgentId: "agent-1",
    state: "queued",
    startedAt: 1_100,
    ...input,
  };
}

function makeDelivery(input: Partial<DeliveryIntent> = {}): DeliveryIntent {
  return {
    id: "delivery-1",
    invocationId: "inv-1",
    targetId: "agent-1",
    targetKind: "agent",
    transport: "peer_broker",
    reason: "invocation",
    policy: "must_ack",
    status: "accepted",
    ...input,
  };
}

function makeAttempt(input: Partial<DeliveryAttempt> = {}): DeliveryAttempt {
  return {
    id: "attempt-1",
    deliveryId: "delivery-1",
    attempt: 1,
    status: "failed",
    createdAt: 1_200,
    ...input,
  };
}

describe("lifecycle projection", () => {
  test("maps invocation flight states without copying raw output into terminal summaries", () => {
    const lifecycle = projectInvocationLifecycle({
      invocation: makeInvocation({
        metadata: {
          actionId: "action-1",
          idempotencyKey: "ask:operator:agent-1:msg-1",
        },
      }),
      flight: makeFlight({
        state: "completed",
        summary: "Agent completed.",
        output: "This is the full agent output and should not be in the terminal summary.",
        completedAt: 2_000,
      }),
    });

    expect(lifecycle).toMatchObject({
      invocationId: "inv-1",
      flightId: "flight-1",
      state: "completed",
      actionId: "action-1",
      idempotencyKey: "ask:operator:agent-1:msg-1",
      terminal: {
        state: "completed",
        summary: "Agent completed.",
        completedAt: 2_000,
      },
    });
    expect(lifecycle.terminal?.summary).not.toContain("full agent output");
  });

  test("derives expired at read time without requiring a written flight state", () => {
    expect(projectInvocationState({
      invocation: makeInvocation(),
      flight: makeFlight({ state: "running" }),
      expiresAt: 1_500,
      now: 2_000,
    })).toBe("expired");

    expect(projectInvocationLifecycle({
      invocation: makeInvocation(),
      flight: makeFlight({ state: "running" }),
      expiresAt: 1_500,
      now: 2_000,
    })).toMatchObject({
      state: "expired",
      expiresAt: 1_500,
      terminal: {
        state: "expired",
        completedAt: 2_000,
      },
    });

    expect(projectInvocationLifecycle({
      invocation: makeInvocation({
        timeoutMs: 500,
        createdAt: 1_000,
      }),
      flight: makeFlight({ state: "running" }),
      now: 1_501,
    })).toMatchObject({
      state: "expired",
      expiresAt: 1_500,
    });
  });

  test("keeps peer authority handoff distinct from local sent delivery", () => {
    const delivery = makeDelivery({
      status: "peer_acked",
      targetNodeId: "node-peer",
      metadata: {
        peerFlightId: "flight-peer-1",
        peerAckedAt: 1_250,
      },
    });
    const outcome = projectOutcomeDelivery(delivery, [
      makeAttempt({
        status: "acknowledged",
        createdAt: 1_250,
      }),
    ]);
    const lifecycle = projectInvocationLifecycle({
      invocation: makeInvocation(),
      flight: makeFlight({ state: "running" }),
      deliveries: [delivery],
      deliveryAttempts: {
        "delivery-1": [makeAttempt({ status: "acknowledged", createdAt: 1_250 })],
      },
    });

    expect(projectDeliveryState(delivery)).toBe("dispatched_to_peer");
    expect(outcome).toMatchObject({
      state: "dispatched_to_peer",
      peerNodeId: "node-peer",
      peerFlightId: "flight-peer-1",
      deliveredAt: 1_250,
    });
    expect(lifecycle.state).toBe("acknowledged");
    expect(lifecycle.peerNodeId).toBe("node-peer");
    expect(lifecycle.peerFlightId).toBe("flight-peer-1");
  });

  test("keeps completed invocation and dead-lettered delivery separate", () => {
    const lifecycle = projectInvocationLifecycle({
      invocation: makeInvocation(),
      flight: makeFlight({
        state: "completed",
        summary: "Done.",
        completedAt: 2_000,
      }),
      deliveries: [
        makeDelivery({
          id: "delivery-dead",
          status: "failed",
          metadata: {
            failureReason: "peer_unreachable",
            failureDetail: "retry budget exhausted",
          },
        }),
      ],
      deliveryAttempts: {
        "delivery-dead": [
          makeAttempt({
            id: "attempt-dead",
            deliveryId: "delivery-dead",
            error: "connection refused",
            createdAt: 1_900,
          }),
        ],
      },
    });

    expect(lifecycle.state).toBe("completed");
    expect(lifecycle.deliveries?.[0]).toMatchObject({
      state: "dead_lettered",
      lastError: {
        reason: "peer_unreachable",
        detail: "retry budget exhausted",
      },
    });
  });

  test("distinguishes policy suppression from caller cancellation", () => {
    expect(projectDeliveryState(makeDelivery({
      status: "cancelled",
      metadata: {
        policySuppressed: true,
      },
    }))).toBe("suppressed");

    const callerCancelled = projectOutcomeDelivery(makeDelivery({
      status: "cancelled",
      metadata: {
        cancelledBy: "operator",
      },
    }));

    expect(callerCancelled.state).toBe("cancelled");
    expect(callerCancelled.state).not.toBe("suppressed");
  });

  test("normalizes retrying deliveries with next attempt and failed attempt detail", () => {
    const outcome = projectOutcomeDelivery(
      makeDelivery({
        status: "deferred",
        metadata: {
          failureReason: "peer_unreachable",
          nextAttemptAt: 3_000,
        },
      }),
      [
        makeAttempt({
          error: "network unavailable",
          createdAt: 2_000,
        }),
      ],
    );

    expect(outcome).toMatchObject({
      state: "retrying",
      nextAttemptAt: 3_000,
      lastAttemptAt: 2_000,
      lastError: {
        reason: "peer_unreachable",
        detail: "network unavailable",
      },
    });
  });
});
