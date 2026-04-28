import { describe, expect, test } from "bun:test";

import type { ActivityItem } from "./sqlite-store.js";
import { createBrokerCoreService } from "./broker-core-service.js";
import { createRuntimeRegistrySnapshot } from "./registry.js";

describe("createBrokerCoreService", () => {
  test("builds broker reads around runtime state and delegates writes", async () => {
    const snapshot = createRuntimeRegistrySnapshot({
      messages: {
        "msg-1": {
          id: "msg-1",
          conversationId: "conv-1",
          actorId: "agent-1",
          originNodeId: "node-1",
          class: "agent",
          body: "hello",
          visibility: "workspace",
          policy: "durable",
          createdAt: 100,
        },
      },
      collaborationRecords: {
        "rec-1": {
          id: "rec-1",
          kind: "task",
          title: "Investigate",
          createdById: "agent-1",
          createdAt: 100,
          updatedAt: 100,
        },
      },
    });

    const activityItems: ActivityItem[] = [
      {
        id: "act-1",
        kind: "message_posted",
        ts: 100,
        agentId: "agent-1",
        messageId: "msg-1",
        title: "hello",
      },
      {
        id: "act-2",
        kind: "flight_updated",
        ts: 101,
        flightId: "flt-1",
      },
    ];
    const commands: unknown[] = [];

    const service = createBrokerCoreService({
      baseUrl: "http://broker.test",
      nodeId: "node-1",
      meshId: "mesh-1",
      localNode: {
        id: "node-1",
        meshId: "mesh-1",
        name: "node-1",
        advertiseScope: "local",
        registeredAt: 1,
        lastSeenAt: 1,
      },
      runtime: {
        snapshot: () => snapshot,
      },
      projection: {
        listActivityItems: async () => activityItems,
      },
      journal: {
        listCollaborationRecords: () => Object.values(snapshot.collaborationRecords),
        listCollaborationEvents: () => [],
      },
      threadEvents: {
        replay: async () => [],
        snapshot: async () => ({
          conversation: {
            id: "conv-1",
            kind: "direct",
            authorityNodeId: "node-1",
            participantIds: ["agent-1"],
            visibility: "workspace",
            createdAt: 100,
            updatedAt: 100,
          },
          latestSeq: 0,
          messages: [],
          collaboration: [],
          activeFlights: [],
        }),
        openWatch: async (request) => ({
          watchId: `${request.watcherId}-watch`,
          conversationId: request.conversationId,
          authorityNodeId: "node-1",
          acceptedAfterSeq: request.afterSeq ?? 0,
          latestSeq: 0,
          leaseExpiresAt: 999,
          mode: "snapshot_then_stream",
        }),
        renewWatch: async (request) => ({
          watchId: request.watchId,
          leaseExpiresAt: 999,
        }),
        closeWatch: async () => {},
      },
      isReconciledStaleFlightActivityItem: (item) => item.id === "act-2",
      executeCommand: async (command) => {
        commands.push(command);
        return { ok: true };
      },
    });

    const health = await service.readHealth();
    const messages = await service.readMessages?.({ limit: 10 });
    const activity = await service.readActivity?.({ limit: 10 });
    const records = await service.readCollaborationRecords?.({ limit: 10 });
    const closeWatch = await service.closeThreadWatch?.({ watchId: "watch-1" });
    const post = await service.postConversationMessage?.({
      id: "msg-2",
      conversationId: "conv-1",
      actorId: "agent-1",
      originNodeId: "node-1",
      class: "agent",
      body: "next",
      visibility: "workspace",
      policy: "durable",
      createdAt: 101,
    });

    expect(health.counts?.messages).toBe(1);
    expect(messages?.map((message) => message.id)).toEqual(["msg-1"]);
    expect(activity?.map((item) => item.id)).toEqual(["act-1"]);
    expect(records).toEqual(Object.values(snapshot.collaborationRecords));
    expect(closeWatch).toEqual({ ok: true, watchId: "watch-1" });
    expect(post).toEqual({ ok: true });
    expect(commands).toEqual([
      {
        kind: "conversation.post",
        message: expect.objectContaining({ id: "msg-2" }),
      },
    ]);
  });
});
