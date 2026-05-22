import { describe, expect, test } from "bun:test";

import type { DeliveryAttempt, DeliveryIntent } from "@openscout/protocol";

import { readInvocationLifecycle } from "./invocation-lifecycle-read-model.js";
import { createRuntimeRegistrySnapshot } from "./registry.js";

describe("readInvocationLifecycle", () => {
  test("projects invocation lifecycle from runtime records and delivery attempts", () => {
    const snapshot = createRuntimeRegistrySnapshot({
      invocations: {
        "inv-1": {
          id: "inv-1",
          requesterId: "operator",
          requesterNodeId: "node-1",
          targetAgentId: "agent-1",
          action: "consult",
          task: "check this",
          messageId: "msg-1",
          ensureAwake: true,
          stream: false,
          timeoutMs: 60_000,
          createdAt: 1_000,
          metadata: {
            actionId: "action-1",
            idempotencyKey: "ask:operator:agent-1:msg-1",
          },
        },
      },
      flights: {
        "flight-old": {
          id: "flight-old",
          invocationId: "inv-1",
          requesterId: "operator",
          targetAgentId: "agent-1",
          state: "queued",
          startedAt: 1_050,
        },
        "flight-1": {
          id: "flight-1",
          invocationId: "inv-1",
          requesterId: "operator",
          targetAgentId: "agent-1",
          state: "running",
          startedAt: 1_100,
        },
      },
    });
    const deliveries: DeliveryIntent[] = [
      {
        id: "delivery-1",
        messageId: "msg-1",
        targetId: "agent-1",
        targetKind: "agent",
        transport: "peer_broker",
        reason: "invocation",
        policy: "must_ack",
        status: "peer_acked",
        targetNodeId: "node-peer",
        metadata: {
          invocationId: "inv-1",
          peerFlightId: "flight-peer-1",
          peerAckedAt: 1_250,
        },
      },
    ];
    const attempts: DeliveryAttempt[] = [
      {
        id: "attempt-1",
        deliveryId: "delivery-1",
        attempt: 1,
        status: "acknowledged",
        createdAt: 1_250,
      },
    ];

    const lifecycle = readInvocationLifecycle({
      snapshot,
      journal: {
        listDeliveries: () => deliveries,
        listDeliveryAttempts: () => attempts,
      },
      invocationId: "inv-1",
      now: 1_300,
    });

    expect(lifecycle).toMatchObject({
      invocationId: "inv-1",
      flightId: "flight-1",
      state: "acknowledged",
      expiresAt: 61_000,
      actionId: "action-1",
      idempotencyKey: "ask:operator:agent-1:msg-1",
      peerNodeId: "node-peer",
      peerFlightId: "flight-peer-1",
      deliveries: [
        {
          deliveryId: "delivery-1",
          state: "dispatched_to_peer",
          peerNodeId: "node-peer",
          peerFlightId: "flight-peer-1",
          deliveredAt: 1_250,
        },
      ],
    });
  });

  test("returns null for missing invocation ids", () => {
    expect(readInvocationLifecycle({
      snapshot: createRuntimeRegistrySnapshot(),
      journal: {
        listDeliveries: () => [],
        listDeliveryAttempts: () => [],
      },
      invocationId: "missing",
      now: 1_000,
    })).toBeNull();
  });
});
