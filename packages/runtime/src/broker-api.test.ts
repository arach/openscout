import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ControlCommand,
  InvocationRequest,
  MessageRecord,
  ScoutDeliverRequest,
  ScoutDeliverResponse,
} from "@openscout/protocol";

import {
  maybePostJsonToActiveScoutBrokerService,
  maybeReadJsonFromActiveScoutBrokerService,
  registerActiveScoutBrokerService,
  requestScoutBrokerJson,
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
    const deliveredRequests: ScoutDeliverRequest[] = [];
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
      deliver: async (request) => {
        deliveredRequests.push(request);
        return {
          kind: "delivery",
          accepted: true,
          routeKind: "dm",
          conversation: {
            id: "dm.actor-1.agent-1",
            kind: "direct",
            title: "Actor One <> Agent One",
            visibility: "private",
            shareMode: "local",
            authorityNodeId: "node-1",
            participantIds: ["actor-1", "agent-1"],
          },
          message: {
            id: "msg-deliver-1",
            conversationId: "dm.actor-1.agent-1",
            actorId: request.requesterId,
            originNodeId: request.requesterNodeId,
            class: "agent",
            body: request.body,
            visibility: "private",
            policy: "durable",
            createdAt: request.createdAt,
          },
          targetAgentId: request.targetAgentId,
        } satisfies ScoutDeliverResponse;
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
    const deliveryResult = await maybePostJsonToActiveScoutBrokerService<
      ScoutDeliverResponse
    >("http://broker.test", "/v1/deliver", {
      id: "deliver-1",
      requesterId: "actor-1",
      requesterNodeId: "node-1",
      body: "hello agent",
      intent: "consult",
      targetAgentId: "agent-1",
      createdAt: 101,
    } satisfies ScoutDeliverRequest);
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
    expect(deliveryResult).toEqual({
      handled: true,
      value: expect.objectContaining({
        kind: "delivery",
        targetAgentId: "agent-1",
      }),
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
    expect(deliveredRequests.map((request) => request.id)).toEqual([
      "deliver-1",
    ]);
    expect(invokedRequests.map((request) => request.id)).toEqual(["inv-1"]);
  });
});

describe("broker JSON transport", () => {
  test("can request JSON over a Unix domain socket", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openscout-broker-api-"));
    const socketPath = join(dir, "broker.sock");
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        path: request.url,
        via: "unix",
      }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolve());
    });

    try {
      const result = await requestScoutBrokerJson<{
        ok: boolean;
        path: string;
        via: string;
      }>("http://127.0.0.1:1", "/health?probe=1", { socketPath });

      expect(result).toEqual({
        ok: true,
        path: "/health?probe=1",
        via: "unix",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await unlink(socketPath).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("falls back to HTTP when the configured Unix socket is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openscout-broker-api-"));
    const socketPath = join(dir, "missing.sock");
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        path: request.url,
        via: "http",
      }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("HTTP test server did not bind to a TCP port");
      }
      const result = await requestScoutBrokerJson<{
        ok: boolean;
        path: string;
        via: string;
      }>(`http://127.0.0.1:${address.port}`, "/health?probe=1", {
        socketPath,
      });

      expect(result).toEqual({
        ok: true,
        path: "/health?probe=1",
        via: "http",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
