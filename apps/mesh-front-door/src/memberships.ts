import { readOpenScoutSessionFromRequest, type OpenScoutAuthEnv, type OpenScoutSession } from "./auth.js";
import type { MeshFrontDoorAuth } from "./rendezvous.js";

export interface MeshMembershipEnv extends OpenScoutAuthEnv {
  OSN_DB?: D1Database;
  OPENSCOUT_BOOTSTRAP_FIRST_GITHUB_USER?: string;
  OPENSCOUT_BOOTSTRAP_MESH_ID?: string;
  OPENSCOUT_BOOTSTRAP_MESH_NAME?: string;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

interface MeshRow {
  id: string;
  name: string;
  role: string;
  created_at: number;
}

const DEFAULT_BOOTSTRAP_MESH_ID = "openscout";
const DEFAULT_BOOTSTRAP_MESH_NAME = "OpenScout";

export async function handleMeshMembershipRequest(
  request: Request,
  auth: MeshFrontDoorAuth,
  env: MeshMembershipEnv,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "GET" && url.pathname === "/v1/meshes") {
    const session = await readRequiredGitHubSession(request, auth, env);
    if (!session.ok) return session.response;

    const db = env.OSN_DB;
    if (!db) return json(503, { error: "membership_store_unavailable" });

    await upsertGitHubUser(db, session.session);
    await maybeBootstrapFirstGitHubUser(db, session.session, env);
    const meshes = await listMeshesForGitHubUser(db, session.session.providerUserId);
    return json(200, { meshes });
  }

  return undefined;
}

export async function githubUserCanAccessMesh(
  auth: MeshFrontDoorAuth,
  meshId: string,
  env: MeshMembershipEnv,
): Promise<boolean> {
  if (auth.kind !== "github_user") return true;
  const db = env.OSN_DB;
  if (!db) return false;
  const providerUserId = auth.key.startsWith("github:") ? auth.key.slice("github:".length) : "";
  if (!providerUserId) return false;
  const row = await db.prepare(`
    SELECT 1 AS allowed
      FROM osn_mesh_memberships
     WHERE provider = 'github'
       AND provider_user_id = ?
       AND mesh_id = ?
     LIMIT 1
  `).bind(providerUserId, meshId).first<{ allowed: number }>();
  return Boolean(row?.allowed);
}

async function readRequiredGitHubSession(
  request: Request,
  auth: MeshFrontDoorAuth,
  env: MeshMembershipEnv,
): Promise<{ ok: true; session: OpenScoutSession } | { ok: false; response: Response }> {
  if (auth.kind !== "github_user") {
    return { ok: false, response: json(403, { error: "github_session_required" }) };
  }
  const session = await readOpenScoutSessionFromRequest(request, env);
  if (!session) {
    return { ok: false, response: json(401, { error: "unauthorized" }) };
  }
  return { ok: true, session };
}

async function upsertGitHubUser(db: D1Database, session: OpenScoutSession): Promise<void> {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO osn_users (provider, provider_user_id, login, email, created_at, updated_at)
    VALUES ('github', ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_user_id) DO UPDATE SET
      login = excluded.login,
      email = excluded.email,
      updated_at = excluded.updated_at
  `).bind(session.providerUserId, session.login, session.email, now, now).run();
}

async function maybeBootstrapFirstGitHubUser(
  db: D1Database,
  session: OpenScoutSession,
  env: MeshMembershipEnv,
): Promise<void> {
  if (env.OPENSCOUT_BOOTSTRAP_FIRST_GITHUB_USER !== "1") return;
  const existing = await db.prepare(`
    SELECT COUNT(*) AS count
      FROM osn_mesh_memberships
  `).first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;

  const meshId = env.OPENSCOUT_BOOTSTRAP_MESH_ID?.trim() || DEFAULT_BOOTSTRAP_MESH_ID;
  const meshName = env.OPENSCOUT_BOOTSTRAP_MESH_NAME?.trim() || DEFAULT_BOOTSTRAP_MESH_NAME;
  const now = Date.now();
  await db.prepare(`
    INSERT INTO osn_meshes (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      updated_at = excluded.updated_at
  `).bind(meshId, meshName, now, now).run();
  await db.prepare(`
    INSERT INTO osn_mesh_memberships (provider, provider_user_id, mesh_id, role, created_at, updated_at)
    VALUES ('github', ?, ?, 'owner', ?, ?)
    ON CONFLICT(provider, provider_user_id, mesh_id) DO UPDATE SET
      role = excluded.role,
      updated_at = excluded.updated_at
  `).bind(session.providerUserId, meshId, now, now).run();
}

async function listMeshesForGitHubUser(db: D1Database, providerUserId: string): Promise<MeshRow[]> {
  const result = await db.prepare(`
    SELECT meshes.id,
           meshes.name,
           memberships.role,
           meshes.created_at
      FROM osn_mesh_memberships memberships
      JOIN osn_meshes meshes ON meshes.id = memberships.mesh_id
     WHERE memberships.provider = 'github'
       AND memberships.provider_user_id = ?
     ORDER BY lower(meshes.name), meshes.id
  `).bind(providerUserId).all<MeshRow>();
  return result.results ?? [];
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
