import { describe, expect, test } from "bun:test";

import {
  OPENSCOUT_IROH_MESH_ALPN,
  OPENSCOUT_MESH_PROTOCOL_VERSION,
  type OpenScoutMeshPresence,
  type OpenScoutMeshPresenceRecord,
} from "@openscout/protocol";

import {
  handleRendezvousRequest,
  resolveMeshDirectoryOwnerKey,
  resolveMeshFrontDoorAuth,
  type MeshPresenceStore,
} from "../src/rendezvous.js";

class MemoryPresenceStore implements MeshPresenceStore {
  readonly values = new Map<string, OpenScoutMeshPresenceRecord>();

  async get(key: string): Promise<OpenScoutMeshPresenceRecord | undefined> {
    return this.values.get(key);
  }

  async list(prefix: string): Promise<OpenScoutMeshPresenceRecord[]> {
    return Array.from(this.values)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
  }

  async put(key: string, value: OpenScoutMeshPresenceRecord): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("mesh front door rendezvous", () => {
  test("publishes and lists scoped node presence", async () => {
    const store = new MemoryPresenceStore();
    const auth = { key: "user:arach@example.com", label: "arach@example.com", kind: "access_user" as const };
    const presence = makePresence({ nodeId: "laptop-a", nodeName: "Laptop A" });

    const publish = await handleRendezvousRequest(store, jsonRequest("https://mesh.openscout.app/v1/presence", presence), auth, {
      OPENSCOUT_ALLOWED_MESH_IDS: "openscout",
    });
    expect(publish.status).toBe(200);

    const list = await handleRendezvousRequest(store, new Request("https://mesh.openscout.app/v1/nodes?meshId=openscout"), auth, {
      OPENSCOUT_ALLOWED_MESH_IDS: "openscout",
    });
    expect(list.status).toBe(200);
    const payload = await list.json();
    expect(payload.nodes).toHaveLength(1);
    expect(payload.nodes[0].nodeId).toBe("laptop-a");
    expect(payload.nodes[0].observedAt).toBeNumber();
  });

  test("keeps different Cloudflare Access identities isolated", async () => {
    const store = new MemoryPresenceStore();
    await handleRendezvousRequest(
      store,
      jsonRequest("https://mesh.openscout.app/v1/presence", makePresence({ nodeId: "private-node" })),
      { key: "user:a@example.com", label: "a@example.com", kind: "access_user" },
    );

    const list = await handleRendezvousRequest(
      store,
      new Request("https://mesh.openscout.app/v1/nodes?meshId=openscout"),
      { key: "user:b@example.com", label: "b@example.com", kind: "access_user" },
    );
    const payload = await list.json();
    expect(payload.nodes).toEqual([]);
  });

  test("rejects expired presence and disallowed meshes", async () => {
    const store = new MemoryPresenceStore();
    const auth = { key: "dev:local", label: "local-dev", kind: "dev" as const };
    const now = Date.now();

    const expired = await handleRendezvousRequest(
      store,
      jsonRequest("https://mesh.openscout.app/v1/presence", makePresence({
        issuedAt: now - 10_000,
        expiresAt: now - 1_000,
      })),
      auth,
    );
    expect(expired.status).toBe(400);

    const disallowed = await handleRendezvousRequest(
      store,
      jsonRequest("https://mesh.openscout.app/v1/presence", makePresence({ meshId: "other" })),
      auth,
      { OPENSCOUT_ALLOWED_MESH_IDS: "openscout" },
    );
    expect(disallowed.status).toBe(403);
  });

  test("resolves Cloudflare Access and shared-token auth", () => {
    const userAuth = resolveMeshFrontDoorAuth(
      new Request("https://mesh.openscout.app/v1/nodes", {
        headers: { "cf-access-authenticated-user-email": "Arach@Example.com" },
      }),
      {},
    );
    expect(userAuth).toEqual({ key: "user:arach@example.com", label: "arach@example.com", kind: "access_user" });

    const tokenAuth = resolveMeshFrontDoorAuth(
      new Request("https://mesh.openscout.app/v1/nodes", {
        headers: { authorization: "Bearer secret" },
      }),
      { OPENSCOUT_MESH_SHARED_TOKEN: "secret", OPENSCOUT_MESH_SHARED_OWNER: "mesh-alpha" },
    );
    expect(tokenAuth).toEqual({ key: "shared:mesh-alpha", label: "mesh-alpha", kind: "shared_token" });
  });

  test("can place human and node publisher auth in one managed directory", () => {
    const auth = { key: "user:arach@example.com", label: "arach@example.com", kind: "access_user" as const };
    expect(resolveMeshDirectoryOwnerKey(auth, {})).toBe("user:arach@example.com");
    expect(resolveMeshDirectoryOwnerKey(auth, { OPENSCOUT_MESH_DIRECTORY_OWNER: "default" })).toBe("owner:default");
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePresence(input: Partial<OpenScoutMeshPresence> = {}): OpenScoutMeshPresence {
  const now = Date.now();
  return {
    v: OPENSCOUT_MESH_PROTOCOL_VERSION,
    meshId: input.meshId ?? "openscout",
    nodeId: input.nodeId ?? "node-a",
    nodeName: input.nodeName ?? "Node A",
    issuedAt: input.issuedAt ?? now,
    expiresAt: input.expiresAt ?? now + 60_000,
    entrypoints: input.entrypoints ?? [
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
