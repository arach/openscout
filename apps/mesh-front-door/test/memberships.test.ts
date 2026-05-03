import { describe, expect, test } from "bun:test";

import { handleOpenScoutAuthRequest } from "../src/auth.js";
import { handleMeshMembershipRequest, type D1Database } from "../src/memberships.js";
import { handleRendezvousRequest, resolveMeshFrontDoorAuth, type MeshPresenceStore } from "../src/rendezvous.js";
import type { OpenScoutMeshPresenceRecord } from "@openscout/protocol";

class FakeD1Database implements D1Database {
  readonly users = new Map<string, { login: string; email: string }>();
  readonly meshes = new Map<string, { name: string; createdAt: number }>();
  readonly memberships = new Map<string, { role: string; createdAt: number }>();

  prepare(query: string) {
    return new FakeD1PreparedStatement(this, query);
  }

  grant(providerUserId: string, meshId: string, role = "member") {
    this.meshes.set(meshId, { name: meshId, createdAt: Date.now() });
    this.memberships.set(`github:${providerUserId}:${meshId}`, { role, createdAt: Date.now() });
  }
}

class FakeD1PreparedStatement {
  private values: unknown[] = [];

  constructor(private readonly db: FakeD1Database, private readonly query: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (this.query.includes("COUNT(*) AS count")) {
      return { count: this.db.memberships.size } as T;
    }
    if (this.query.includes("SELECT 1 AS allowed")) {
      const [providerUserId, meshId] = this.values as [string, string];
      return (this.db.memberships.has(`github:${providerUserId}:${meshId}`)
        ? { allowed: 1 }
        : null) as T | null;
    }
    return null;
  }

  async all<T = unknown>(): Promise<{ results?: T[] }> {
    if (this.query.includes("FROM osn_mesh_memberships memberships")) {
      const [providerUserId] = this.values as [string];
      const results = Array.from(this.db.memberships)
        .filter(([key]) => key.startsWith(`github:${providerUserId}:`))
        .map(([key, membership]) => {
          const meshId = key.slice(`github:${providerUserId}:`.length);
          const mesh = this.db.meshes.get(meshId);
          return {
            id: meshId,
            name: mesh?.name ?? meshId,
            role: membership.role,
            created_at: mesh?.createdAt ?? membership.createdAt,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
      return { results: results as T[] };
    }
    return { results: [] };
  }

  async run(): Promise<unknown> {
    if (this.query.includes("INSERT INTO osn_users")) {
      const [providerUserId, login, email] = this.values as [string, string, string];
      this.db.users.set(providerUserId, { login, email });
    }
    if (this.query.includes("INSERT INTO osn_meshes")) {
      const [meshId, name, createdAt] = this.values as [string, string, number];
      this.db.meshes.set(meshId, { name, createdAt });
    }
    if (this.query.includes("INSERT INTO osn_mesh_memberships")) {
      const [providerUserId, meshId, createdAt] = this.values as [string, string, number];
      this.db.memberships.set(`github:${providerUserId}:${meshId}`, { role: "owner", createdAt });
    }
    return {};
  }
}

class EmptyPresenceStore implements MeshPresenceStore {
  async get(): Promise<OpenScoutMeshPresenceRecord | undefined> {
    return undefined;
  }

  async list(): Promise<OpenScoutMeshPresenceRecord[]> {
    return [];
  }

  async put(): Promise<void> {}

  async delete(): Promise<void> {}
}

describe("mesh front door memberships", () => {
  test("lists meshes and bootstraps the first GitHub user", async () => {
    const db = new FakeD1Database();
    const { request, auth } = await makeGitHubRequest("https://mesh.oscout.net/v1/meshes");

    const response = await handleMeshMembershipRequest(request, auth, {
      ...env,
      OSN_DB: db,
      OPENSCOUT_BOOTSTRAP_FIRST_GITHUB_USER: "1",
      OPENSCOUT_BOOTSTRAP_MESH_ID: "openscout",
      OPENSCOUT_BOOTSTRAP_MESH_NAME: "OpenScout",
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      meshes: [
        {
          id: "openscout",
          name: "OpenScout",
          role: "owner",
          created_at: expect.any(Number),
        },
      ],
    });
  });

  test("denies GitHub rendezvous access outside mesh membership", async () => {
    const db = new FakeD1Database();
    db.grant("42", "team-a");
    const { request, auth } = await makeGitHubRequest("https://mesh.oscout.net/v1/nodes?meshId=team-b");

    const response = await handleRendezvousRequest(new EmptyPresenceStore(), request, auth, {
      ...env,
      OSN_DB: db,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "mesh_access_denied" });
  });
});

const env = {
  OPENSCOUT_GITHUB_CLIENT_ID: "github-client",
  OPENSCOUT_GITHUB_CLIENT_SECRET: "github-secret",
  OPENSCOUT_SESSION_SECRET: "test-secret",
};

async function makeGitHubRequest(url: string) {
  const start = await handleOpenScoutAuthRequest(
    new Request("https://mesh.oscout.net/v1/auth/github/start?return_to=/mesh"),
    env,
  );
  const stateCookie = readCookie(start, "osn_oauth_state");
  const state = new URL(start?.headers.get("location") ?? "").searchParams.get("state");
  const callback = await handleOpenScoutAuthRequest(
    new Request(`https://mesh.oscout.net/v1/auth/github/callback?code=oauth-code&state=${state}`, {
      headers: { cookie: `osn_oauth_state=${stateCookie}` },
    }),
    env,
    mockGitHubFetch,
  );
  const sessionCookie = readCookie(callback, "osn_session");
  const request = new Request(url, {
    headers: { cookie: `osn_session=${sessionCookie}` },
  });
  const auth = await resolveMeshFrontDoorAuth(request, env);
  if (!auth) throw new Error("expected auth");
  return { request, auth };
}

async function mockGitHubFetch(input: RequestInfo | URL): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  if (url === "https://github.com/login/oauth/access_token") {
    return json(200, { access_token: "github-token" });
  }
  if (url === "https://api.github.com/user") {
    return json(200, { id: 42, login: "arach", email: null });
  }
  if (url === "https://api.github.com/user/emails") {
    return json(200, [{ email: "arach@example.com", primary: true, verified: true }]);
  }
  return json(404, { error: "unexpected fetch", url });
}

function readCookie(response: Response | undefined, name: string): string {
  const header = response?.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${name}=([^;,]+)`).exec(header);
  return match?.[1] ?? "";
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
