import {
  handleRendezvousRequest,
  resolveMeshDirectoryOwnerKey,
  resolveMeshFrontDoorAuth,
  type MeshFrontDoorEnv,
  type MeshPresenceStore,
} from "./rendezvous.js";
import { handleOpenScoutAuthRequest } from "./auth.js";
import { handleMeshMembershipRequest, type D1Database } from "./memberships.js";
import type { OpenScoutMeshPresenceRecord } from "@openscout/protocol";

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface Env extends MeshFrontDoorEnv {
  MESH_DIRECTORY: DurableObjectNamespace;
  OSN_DB?: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method.toUpperCase() === "GET" && url.pathname === "/health") {
      return json(200, {
        ok: true,
        service: "openscout-mesh-front-door",
      });
    }

    const authResponse = await handleOpenScoutAuthRequest(request, env);
    if (authResponse) return authResponse;

    const auth = await resolveMeshFrontDoorAuth(request, env);
    if (!auth) {
      return json(401, { error: "unauthorized" });
    }

    const membershipResponse = await handleMeshMembershipRequest(request, auth, env);
    if (membershipResponse) return membershipResponse;

    const ownerKey = resolveMeshDirectoryOwnerKey(auth, env);
    const objectId = env.MESH_DIRECTORY.idFromName(ownerKey);
    const object = env.MESH_DIRECTORY.get(objectId);
    const forwarded = new Request(request);
    forwarded.headers.set("x-openscout-owner-key", ownerKey);
    forwarded.headers.set("x-openscout-auth-kind", auth.kind);
    forwarded.headers.set("x-openscout-auth-label", auth.label);
    return object.fetch(forwarded);
  },
};

export class MeshDirectoryDurableObject {
  private readonly store: MeshPresenceStore;

  constructor(state: DurableObjectState, private readonly env: Env) {
    this.store = {
      get: (key) => state.storage.get<OpenScoutMeshPresenceRecord>(key),
      list: async (prefix) => Array.from((await state.storage.list<OpenScoutMeshPresenceRecord>({ prefix })).values()),
      put: (key, value) => state.storage.put(key, value),
      delete: async (key) => {
        await state.storage.delete(key);
      },
    };
  }

  async fetch(request: Request): Promise<Response> {
    const auth = {
      key: request.headers.get("x-openscout-owner-key") ?? "unknown",
      kind: (request.headers.get("x-openscout-auth-kind") ?? "dev") as "github_user" | "access_user" | "access_service" | "shared_token" | "dev",
      label: request.headers.get("x-openscout-auth-label") ?? "unknown",
    };
    return handleRendezvousRequest(this.store, request, auth, this.env);
  }
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
