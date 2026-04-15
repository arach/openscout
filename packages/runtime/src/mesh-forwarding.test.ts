import { afterEach, describe, expect, test } from "bun:test";

import type { MessageRecord, NodeDefinition } from "@openscout/protocol";

import {
  DEFAULT_MESH_FORWARD_TIMEOUT_MS,
  forwardMeshMessage,
  type MeshMessageBundle,
  PeerUnreachableError,
} from "./mesh-forwarding.js";

const servers = new Set<ReturnType<typeof Bun.serve>>();

afterEach(() => {
  for (const server of servers) {
    server.stop(true);
  }
  servers.clear();
});

function startHangingServer(): string {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise<Response>(() => {});
    },
  });
  servers.add(server);
  return `http://127.0.0.1:${server.port}`;
}

function makeBundle(): MeshMessageBundle {
  const originNode: NodeDefinition = {
    id: "origin-node",
    meshId: "openscout",
    name: "Origin",
    advertiseScope: "mesh",
    brokerUrl: "http://127.0.0.1:65535",
    capabilities: ["broker"],
    registeredAt: 0,
    lastSeenAt: 0,
  };
  const message: MessageRecord = {
    id: "msg-timeout",
    conversationId: "channel.shared.timeout",
    actorId: "actor-origin",
    originNodeId: originNode.id,
    class: "agent",
    body: "timeout probe",
    visibility: "workspace",
    policy: "durable",
    createdAt: Date.now(),
  };

  return {
    originNode,
    conversation: {
      id: message.conversationId,
      kind: "channel",
      title: "timeout",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: "peer-node",
      participantIds: ["actor-origin"],
      metadata: { surface: "test" },
    },
    actors: [],
    agents: [],
    bindings: [],
    message,
  };
}

describe("mesh forwarding", () => {
  test("times out a stalled peer forward instead of hanging indefinitely", async () => {
    const brokerUrl = startHangingServer();
    const startedAt = Date.now();

    try {
      await forwardMeshMessage(brokerUrl, makeBundle(), { timeoutMs: 100 });
      throw new Error("expected forwardMeshMessage to time out");
    } catch (error) {
      expect(error).toBeInstanceOf(PeerUnreachableError);
      const peerError = error as PeerUnreachableError;
      expect(peerError.url).toBe(`${brokerUrl}/v1/mesh/messages`);
      expect(Date.now() - startedAt).toBeLessThan(DEFAULT_MESH_FORWARD_TIMEOUT_MS);
    }
  });
});
