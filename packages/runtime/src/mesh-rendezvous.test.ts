import { describe, expect, test } from "bun:test";

import {
  OPENSCOUT_IROH_MESH_ALPN,
  OPENSCOUT_MESH_PROTOCOL_VERSION,
  type NodeDefinition,
} from "@openscout/protocol";

import {
  buildMeshRendezvousPresence,
  mobilePairingMeshEntrypointFromSnapshot,
  publishMeshRendezvousPresence,
  resolveMeshRendezvousPublishConfig,
  startMeshRendezvousPublisher,
} from "./mesh-rendezvous.js";

describe("mesh rendezvous publisher", () => {
  test("resolves opt-in publish config from env", () => {
    expect(resolveMeshRendezvousPublishConfig({})).toBeUndefined();
    expect(resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_URL: "https://mesh.oscout.net/",
      OPENSCOUT_MESH_RENDEZVOUS_TOKEN: "secret",
      OPENSCOUT_MESH_RENDEZVOUS_TTL_MS: "120000",
      OPENSCOUT_MESH_RENDEZVOUS_INTERVAL_MS: "45000",
    })).toEqual({
      url: "https://mesh.oscout.net",
      token: "secret",
      ttlMs: 120_000,
      intervalMs: 45_000,
    });
  });

  test("builds presence from Iroh entrypoints and skips loopback HTTP", () => {
    const presence = buildMeshRendezvousPresence(makeNode({
      brokerUrl: "http://127.0.0.1:65501",
    }), { issuedAt: 1_000, ttlMs: 60_000 });

    expect(presence?.nodeId).toBe("node-a");
    expect(presence?.entrypoints).toHaveLength(1);
    expect(presence?.entrypoints[0]?.kind).toBe("iroh");
    expect(presence?.expiresAt).toBe(61_000);
  });

  test("includes non-loopback broker URL as HTTP entrypoint", () => {
    const presence = buildMeshRendezvousPresence(makeNode({
      brokerUrl: "https://node-a.mesh.oscout.net",
    }));

    expect(presence?.entrypoints.map((entrypoint) => entrypoint.kind)).toEqual(["iroh", "http"]);
  });

  test("extracts live mobile pairing entrypoint from pairing runtime snapshot", () => {
    expect(mobilePairingMeshEntrypointFromSnapshot({
      updatedAt: 12_000,
      pairing: {
        relay: "wss://relay.oscout.net",
        room: "room-1",
        publicKey: "a".repeat(64),
        expiresAt: 70_000,
        qrValue: JSON.stringify({
          fallbackRelays: ["wss://relay.tailnet.ts.net:7889"],
        }),
      },
    }, 10_000)).toEqual({
      kind: "mobile_pairing",
      relay: "wss://relay.oscout.net",
      fallbackRelays: ["wss://relay.tailnet.ts.net:7889"],
      room: "room-1",
      publicKey: "a".repeat(64),
      expiresAt: 70_000,
      lastSeenAt: 12_000,
      metadata: {
        source: "openscout-pairing-runtime",
      },
    });

    expect(mobilePairingMeshEntrypointFromSnapshot({
      pairing: {
        relay: "wss://relay.oscout.net",
        room: "room-1",
        publicKey: "a".repeat(64),
        expiresAt: 9_999,
      },
    }, 10_000)).toBeUndefined();
  });

  test("publishes signed-in-directory presence to the configured front door", async () => {
    const requests: Request[] = [];
    const ok = await publishMeshRendezvousPresence(makeNode(), {
      config: {
        url: "https://mesh.oscout.net",
        token: "secret",
        ttlMs: 60_000,
        intervalMs: 30_000,
      },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://mesh.oscout.net/v1/presence");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
    const payload = await requests[0]!.json();
    expect(payload.nodeId).toBe("node-a");
  });

  test("publisher resolves dynamic node source on each publish", async () => {
    const requests: Request[] = [];
    let name = "Node A";
    const publisher = startMeshRendezvousPublisher(() => makeNode({ name }), {
      config: {
        url: "https://mesh.oscout.net",
        token: "secret",
        ttlMs: 60_000,
        intervalMs: 60_000,
      },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await publisher.publishNow();
    name = "Node B";
    await publisher.publishNow();
    publisher.stop();

    expect(requests).toHaveLength(2);
    await expect(requests[0]!.json()).resolves.toMatchObject({ nodeName: "Node A" });
    await expect(requests[1]!.json()).resolves.toMatchObject({ nodeName: "Node B" });
  });
});

function makeNode(input: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    id: "node-a",
    meshId: "openscout",
    name: input.name ?? "Node A",
    advertiseScope: "mesh",
    registeredAt: 1,
    lastSeenAt: 2,
    brokerUrl: input.brokerUrl,
    meshEntrypoints: input.meshEntrypoints ?? [
      {
        kind: "iroh",
        endpointId: "endpoint-a",
        endpointAddr: { id: "endpoint-a", addrs: [] },
        alpn: OPENSCOUT_IROH_MESH_ALPN,
        bridgeProtocolVersion: OPENSCOUT_MESH_PROTOCOL_VERSION,
      },
    ],
  };
}
