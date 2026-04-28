import { afterEach, describe, expect, test } from "bun:test";

import type {
  ControlCommand,
  InvocationRequest,
  MessageRecord,
} from "@openscout/protocol";

import {
  maybePostJsonToActiveScoutBrokerService,
  maybeReadJsonFromActiveScoutBrokerService,
  registerActiveScoutBrokerService,
  type ActiveScoutBrokerService,
} from "./broker-api.js";
import { createRuntimeRegistrySnapshot } from "./registry.js";

afterEach(() => {
  registerActiveScoutBrokerService(null);
});

describe("active broker service helpers", () => {
  test("routes matching read requests to the active broker service", async () => {
    const snapshot = createRuntimeRegistrySnapshot({
      messages: {
        "msg-1": {
          id: "msg-1",
          conversationId: "conv-1",
          actorId: "actor-1",
          originNodeId: "node-1",
          class: "agent",
          body: "hello",
          visibility: "workspace",
          policy: "durable",
          createdAt: 100,
        },
      },
    });

    const service: ActiveScoutBrokerService = {
      baseUrl: "http://broker.test",
      readHealth: async () => ({
        ok: true,
        nodeId: "node-1",
        meshId: "mesh-1",
        counts: {
          nodes: 1,
          actors: 0,
          agents: 0,
          conversations: 0,
          messages: 1,
          flights: 0,
          collaborationRecords: 0,
        },
      }),
      readNode: async () => ({
        id: "node-1",
        meshId: "mesh-1",
        name: "node-1",
        advertiseScope: "local",
        registeredAt: 1,
        lastSeenAt: 1,
      }),
      readSnapshot: async () => snapshot,
      readMessages: async () => Object.values(snapshot.messages),
      executeCommand: async () => ({ ok: true }),
    };

    registerActiveScoutBrokerService(service);

    const health = await maybeReadJsonFromActiveScoutBrokerService<{
      ok: boolean;
      nodeId: string | null;
    }>("http://broker.test", "/health");
    const node = await maybeReadJsonFromActiveScoutBrokerService<{
      id: string;
    }>("http://broker.test", "/v1/node");
    const messages = await maybeReadJsonFromActiveScoutBrokerService<
      MessageRecord[]
    >("http://broker.test", "/v1/messages?limit=20");
    const miss = await maybeReadJsonFromActiveScoutBrokerService(
      "http://elsewhere.test",
      "/health",
    );

    expect(health.handled).toBe(true);
    expect(health.handled && health.value.ok).toBe(true);
    expect(node).toEqual({
      handled: true,
      value: {
        id: "node-1",
        meshId: "mesh-1",
        name: "node-1",
        advertiseScope: "local",
        registeredAt: 1,
        lastSeenAt: 1,
      },
    });
    expect(messages.handled).toBe(true);
    expect(messages.handled && messages.value[0]?.id).toBe("msg-1");
    expect(miss).toEqual({ handled: false });
  });

  test("keeps multiple active broker services addressable by base URL", async () => {
    const primary: ActiveScoutBrokerService = {
      baseUrl: "http://broker-a.test",
      readHealth: async () => ({
        ok: true,
        nodeId: "node-a",
        meshId: "mesh-1",
        counts: {
          nodes: 1,
          actors: 0,
          agents: 0,
          conversations: 0,
          messages: 0,
          flights: 0,
          collaborationRecords: 0,
        },
      }),
      readNode: async () => ({
        id: "node-a",
        meshId: "mesh-1",
        name: "node-a",
        advertiseScope: "local",
        registeredAt: 1,
        lastSeenAt: 1,
      }),
      readSnapshot: async () => createRuntimeRegistrySnapshot(),
      executeCommand: async () => ({ ok: true }),
    };
    const secondary: ActiveScoutBrokerService = {
      baseUrl: "http://broker-b.test",
      readHealth: async () => ({
        ok: true,
        nodeId: "node-b",
        meshId: "mesh-1",
        counts: {
          nodes: 1,
          actors: 0,
          agents: 0,
          conversations: 0,
          messages: 0,
          flights: 0,
          collaborationRecords: 0,
        },
      }),
      readNode: async () => ({
        id: "node-b",
        meshId: "mesh-1",
        name: "node-b",
        advertiseScope: "local",
        registeredAt: 1,
        lastSeenAt: 1,
      }),
      readSnapshot: async () => createRuntimeRegistrySnapshot(),
      executeCommand: async () => ({ ok: true }),
    };

    registerActiveScoutBrokerService(primary);
    registerActiveScoutBrokerService(secondary);

    const primaryNode = await maybeReadJsonFromActiveScoutBrokerService<{
      id: string;
    }>("http://broker-a.test", "/v1/node");
    const secondaryNode = await maybeReadJsonFromActiveScoutBrokerService<{
      id: string;
    }>("http://broker-b.test", "/v1/node");

    expect(primaryNode).toEqual({
      handled: true,
      value: expect.objectContaining({ id: "node-a" }),
    });
    expect(secondaryNode).toEqual({
      handled: true,
      value: expect.objectContaining({ id: "node-b" }),
    });
  });

  test("maps write endpoints onto service commands and direct handlers", async () => {
    const commands: ControlCommand[] = [];
    const postedMessages: MessageRecord[] = [];
    const invokedRequests: Array<InvocationRequest & { targetLabel?: string }> =
      [];

    const service: ActiveScoutBrokerService = {
      baseUrl: "http://broker.test",
      readHealth: async () => ({
        ok: true,
        nodeId: "node-1",
        meshId: "mesh-1",
        counts: {
          nodes: 1,
          actors: 0,
          agents: 0,
          conversations: 0,
          messages: 0,
          flights: 0,
          collaborationRecords: 0,
        },
      }),
      readNode: async () => ({
        id: "node-1",
        meshId: "mesh-1",
        name: "node-1",
        advertiseScope: "local",
        registeredAt: 1,
        lastSeenAt: 1,
      }),
      readSnapshot: async () => createRuntimeRegistrySnapshot(),
      executeCommand: async (command) => {
        commands.push(command);
        return { ok: true, kind: command.kind };
      },
      postConversationMessage: async (message) => {
        postedMessages.push(message);
        return { ok: true, messageId: message.id };
      },
      invokeAgent: async (request) => {
        invokedRequests.push(request);
        return {
          accepted: true,
          invocationId: request.id,
        };
      },
    };

    registerActiveScoutBrokerService(service);

    const actorResult = await maybePostJsonToActiveScoutBrokerService<{
      ok: boolean;
      actorId: string;
    }>("http://broker.test", "/v1/actors", {
      id: "actor-1",
      kind: "person",
      displayName: "Actor One",
    });
    const messageResult = await maybePostJsonToActiveScoutBrokerService<{
      ok: boolean;
      messageId: string;
    }>("http://broker.test", "/v1/messages", {
      id: "msg-1",
      conversationId: "conv-1",
      actorId: "actor-1",
      originNodeId: "node-1",
      class: "agent",
      body: "hello",
      visibility: "workspace",
      policy: "durable",
      createdAt: 100,
    } satisfies MessageRecord);
    const invocationResult = await maybePostJsonToActiveScoutBrokerService<{
      accepted: boolean;
      invocationId: string;
    }>("http://broker.test", "/v1/invocations", {
      id: "inv-1",
      requesterId: "actor-1",
      requesterNodeId: "node-1",
      targetAgentId: "agent-1",
      action: "consult",
      task: "help",
      ensureAwake: true,
      stream: false,
      createdAt: 100,
    } satisfies InvocationRequest);
    const commandResult = await maybePostJsonToActiveScoutBrokerService<{
      ok: boolean;
      kind: string;
    }>("http://broker.test", "/v1/commands", {
      kind: "actor.upsert",
      actor: {
        id: "actor-2",
        kind: "person",
        displayName: "Actor Two",
      },
    } satisfies ControlCommand);

    expect(actorResult).toEqual({
      handled: true,
      value: { ok: true, actorId: "actor-1" },
    });
    expect(messageResult).toEqual({
      handled: true,
      value: { ok: true, messageId: "msg-1" },
    });
    expect(invocationResult).toEqual({
      handled: true,
      value: { accepted: true, invocationId: "inv-1" },
    });
    expect(commandResult).toEqual({
      handled: true,
      value: { ok: true, kind: "actor.upsert" },
    });
    expect(commands).toEqual([
      {
        kind: "actor.upsert",
        actor: {
          id: "actor-1",
          kind: "person",
          displayName: "Actor One",
        },
      },
      {
        kind: "actor.upsert",
        actor: {
          id: "actor-2",
          kind: "person",
          displayName: "Actor Two",
        },
      },
    ]);
    expect(postedMessages.map((message) => message.id)).toEqual(["msg-1"]);
    expect(invokedRequests.map((request) => request.id)).toEqual(["inv-1"]);
  });
});
