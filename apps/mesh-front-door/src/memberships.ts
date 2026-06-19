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
    const session = await readRequiredOsnSession(request, auth, env);
    if (!session.ok) return session.response;

    const db = env.OSN_DB;
    if (!db) return json(503, { error: "membership_store_unavailable" });

    await upsertOsnUser(db, session.session);
    await maybeBootstrapFirstUser(db, session.session, env);
    const meshes = await listMeshesForUser(db, session.session.provider, session.session.providerUserId);
    return json(200, { meshes });
  }

  return undefined;
}

// OSN users (GitHub or Apple) are gated by mesh membership; other auth kinds
// (Cloudflare Access, shared token, dev) are trusted upstream and bypass.
export async function osnUserCanAccessMesh(
  auth: MeshFrontDoorAuth,
  meshId: string,
  env: MeshMembershipEnv,
): Promise<boolean> {
  if (auth.kind !== "github_user" && auth.kind !== "apple_user") return true;
  const db = env.OSN_DB;
  if (!db) return false;
  const identity = parseUserKey(auth.key);
  if (!identity) return false;
  const row = await db.prepare(`
    SELECT 1 AS allowed
      FROM osn_mesh_memberships
     WHERE provider = ?
       AND provider_user_id = ?
       AND mesh_id = ?
     LIMIT 1
  `).bind(identity.provider, identity.providerUserId, meshId).first<{ allowed: number }>();
  return Boolean(row?.allowed);
}

// auth.key is `${provider}:${providerUserId}`. Apple subjects can contain dots
// but never colons, so split on the first colon only.
function parseUserKey(key: string): { provider: string; providerUserId: string } | undefined {
  const separator = key.indexOf(":");
  if (separator <= 0) return undefined;
  const provider = key.slice(0, separator);
  const providerUserId = key.slice(separator + 1);
  if (!provider || !providerUserId) return undefined;
  return { provider, providerUserId };
}

async function readRequiredOsnSession(
  request: Request,
  auth: MeshFrontDoorAuth,
  env: MeshMembershipEnv,
): Promise<{ ok: true; session: OpenScoutSession } | { ok: false; response: Response }> {
  if (auth.kind !== "github_user" && auth.kind !== "apple_user") {
    return { ok: false, response: json(403, { error: "osn_session_required" }) };
  }
  const session = await readOpenScoutSessionFromRequest(request, env);
  if (!session) {
    return { ok: false, response: json(401, { error: "unauthorized" }) };
  }
  return { ok: true, session };
}

async function upsertOsnUser(db: D1Database, session: OpenScoutSession): Promise<void> {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO osn_users (provider, provider_user_id, login, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_user_id) DO UPDATE SET
      login = excluded.login,
      email = excluded.email,
      updated_at = excluded.updated_at
  `).bind(session.provider, session.providerUserId, session.login, session.email, now, now).run();
}

async function maybeBootstrapFirstUser(
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
    VALUES (?, ?, ?, 'owner', ?, ?)
    ON CONFLICT(provider, provider_user_id, mesh_id) DO UPDATE SET
      role = excluded.role,
      updated_at = excluded.updated_at
  `).bind(session.provider, session.providerUserId, meshId, now, now).run();
}

async function listMeshesForUser(db: D1Database, provider: string, providerUserId: string): Promise<MeshRow[]> {
  const result = await db.prepare(`
    SELECT meshes.id,
           meshes.name,
           memberships.role,
           meshes.created_at
      FROM osn_mesh_memberships memberships
      JOIN osn_meshes meshes ON meshes.id = memberships.mesh_id
     WHERE memberships.provider = ?
       AND memberships.provider_user_id = ?
     ORDER BY lower(meshes.name), meshes.id
  `).bind(provider, providerUserId).all<MeshRow>();
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
