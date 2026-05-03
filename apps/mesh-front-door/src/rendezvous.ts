import {
  OPENSCOUT_MESH_PROTOCOL_VERSION,
  type OpenScoutMeshPresence,
  type OpenScoutMeshPresenceRecord,
  type OpenScoutMeshRendezvousList,
} from "@openscout/protocol";
import { readOpenScoutSessionFromRequest, type OpenScoutAuthEnv } from "./auth.js";
import { githubUserCanAccessMesh, type MeshMembershipEnv } from "./memberships.js";

export interface MeshFrontDoorEnv extends OpenScoutAuthEnv, MeshMembershipEnv {
  OPENSCOUT_ALLOWED_MESH_IDS?: string;
  OPENSCOUT_DEV_AUTH_DISABLED?: string;
  OPENSCOUT_MESH_DIRECTORY_OWNER?: string;
  OPENSCOUT_MAX_PRESENCE_TTL_MS?: string;
  OPENSCOUT_MESH_SHARED_OWNER?: string;
  OPENSCOUT_MESH_SHARED_TOKEN?: string;
}

export interface MeshFrontDoorAuth {
  key: string;
  label: string;
  kind: "github_user" | "access_user" | "access_service" | "shared_token" | "dev";
}

export interface MeshPresenceStore {
  get(key: string): Promise<OpenScoutMeshPresenceRecord | undefined>;
  list(prefix: string): Promise<OpenScoutMeshPresenceRecord[]>;
  put(key: string, value: OpenScoutMeshPresenceRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

interface ErrorResponse {
  error: string;
  detail?: string;
}

const DEFAULT_MAX_PRESENCE_TTL_MS = 5 * 60_000;

export async function resolveMeshFrontDoorAuth(request: Request, env: MeshFrontDoorEnv): Promise<MeshFrontDoorAuth | undefined> {
  const sharedToken = env.OPENSCOUT_MESH_SHARED_TOKEN?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  if (sharedToken && authorization === `Bearer ${sharedToken}`) {
    const owner = env.OPENSCOUT_MESH_SHARED_OWNER?.trim() || "openscout-shared";
    return { key: `shared:${owner}`, label: owner, kind: "shared_token" };
  }

  const session = await readOpenScoutSessionFromRequest(request, env);
  if (session) {
    return {
      key: `github:${session.providerUserId}`,
      label: session.email,
      kind: "github_user",
    };
  }

  const accessEmail = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  if (accessEmail) {
    return { key: `user:${accessEmail}`, label: accessEmail, kind: "access_user" };
  }

  const accessClientId = request.headers.get("cf-access-client-id")?.trim().toLowerCase();
  if (accessClientId) {
    return { key: `service:${accessClientId}`, label: accessClientId, kind: "access_service" };
  }

  const accessJwt = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (accessJwt) {
    return { key: `access-jwt:${accessJwt.slice(0, 32)}`, label: "cloudflare-access", kind: "access_service" };
  }

  if (env.OPENSCOUT_DEV_AUTH_DISABLED === "1") {
    return { key: "dev:local", label: "local-dev", kind: "dev" };
  }

  return undefined;
}

export function resolveMeshDirectoryOwnerKey(auth: MeshFrontDoorAuth, env: MeshFrontDoorEnv): string {
  const owner = env.OPENSCOUT_MESH_DIRECTORY_OWNER?.trim();
  return owner ? `owner:${owner}` : auth.key;
}

export async function handleRendezvousRequest(
  store: MeshPresenceStore,
  request: Request,
  auth: MeshFrontDoorAuth,
  env: MeshFrontDoorEnv = {},
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "GET" && url.pathname === "/health") {
    return json(200, {
      ok: true,
      service: "openscout-mesh-front-door",
      auth: auth.kind,
    });
  }

  if (method === "POST" && url.pathname === "/v1/presence") {
    return publishPresence(store, request, auth, env);
  }

  if (method === "GET" && url.pathname === "/v1/nodes") {
    const meshId = readMeshId(url);
    const allowed = assertAllowedMeshId(meshId, env);
    if (allowed) return allowed;
    const authorized = await assertAuthorizedMeshMembership(auth, meshId, env);
    if (authorized) return authorized;
    const nodes = await listActiveNodes(store, presenceKeyPrefix(auth.key, meshId));
    const payload: OpenScoutMeshRendezvousList = {
      v: OPENSCOUT_MESH_PROTOCOL_VERSION,
      meshId,
      nodes,
    };
    return json(200, payload);
  }

  const nodeMatch = /^\/v1\/nodes\/([^/]+)$/.exec(url.pathname);
  if (nodeMatch && method === "GET") {
    const meshId = readMeshId(url);
    const allowed = assertAllowedMeshId(meshId, env);
    if (allowed) return allowed;
    const authorized = await assertAuthorizedMeshMembership(auth, meshId, env);
    if (authorized) return authorized;
    const nodeId = decodeURIComponent(nodeMatch[1] ?? "");
    const record = await store.get(presenceKey(auth.key, meshId, nodeId));
    if (!record || record.expiresAt <= Date.now()) {
      return json(404, { error: "node_not_found" });
    }
    return json(200, record);
  }

  if (nodeMatch && method === "DELETE") {
    const meshId = readMeshId(url);
    const allowed = assertAllowedMeshId(meshId, env);
    if (allowed) return allowed;
    const authorized = await assertAuthorizedMeshMembership(auth, meshId, env);
    if (authorized) return authorized;
    const nodeId = decodeURIComponent(nodeMatch[1] ?? "");
    await store.delete(presenceKey(auth.key, meshId, nodeId));
    return json(200, { ok: true });
  }

  return json(404, { error: "not_found" });
}

async function publishPresence(
  store: MeshPresenceStore,
  request: Request,
  auth: MeshFrontDoorAuth,
  env: MeshFrontDoorEnv,
): Promise<Response> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json(400, { error: "bad_json" });
  }

  const validation = validatePresence(input);
  if (!validation.ok) {
    return json(400, { error: "invalid_presence", detail: validation.detail });
  }

  const allowed = assertAllowedMeshId(validation.presence.meshId, env);
  if (allowed) return allowed;
  const authorized = await assertAuthorizedMeshMembership(auth, validation.presence.meshId, env);
  if (authorized) return authorized;

  const now = Date.now();
  const maxTtlMs = readPositiveInteger(env.OPENSCOUT_MAX_PRESENCE_TTL_MS, DEFAULT_MAX_PRESENCE_TTL_MS);
  const record: OpenScoutMeshPresenceRecord = {
    ...validation.presence,
    issuedAt: clampTimestamp(validation.presence.issuedAt, now - maxTtlMs, now + maxTtlMs),
    expiresAt: Math.min(validation.presence.expiresAt, now + maxTtlMs),
    observedAt: now,
  };
  if (record.expiresAt <= now) {
    return json(400, { error: "expired_presence" });
  }

  await store.put(presenceKey(auth.key, record.meshId, record.nodeId), record);
  return json(200, {
    ok: true,
    nodeId: record.nodeId,
    meshId: record.meshId,
    expiresAt: record.expiresAt,
  });
}

async function listActiveNodes(store: MeshPresenceStore, prefix: string): Promise<OpenScoutMeshPresenceRecord[]> {
  const now = Date.now();
  const records = await store.list(prefix);
  const active: OpenScoutMeshPresenceRecord[] = [];
  await Promise.all(records.map(async (record) => {
    if (record.expiresAt <= now) {
      await store.delete(presenceKeyFromRecord(prefix, record));
      return;
    }
    active.push(record);
  }));
  return active.sort((left, right) => left.nodeName.localeCompare(right.nodeName) || left.nodeId.localeCompare(right.nodeId));
}

function validatePresence(input: unknown): { ok: true; presence: OpenScoutMeshPresence } | { ok: false; detail: string } {
  if (!isRecord(input)) {
    return { ok: false, detail: "presence must be an object" };
  }
  if (input.v !== OPENSCOUT_MESH_PROTOCOL_VERSION) {
    return { ok: false, detail: `v must be ${OPENSCOUT_MESH_PROTOCOL_VERSION}` };
  }
  if (!isNonEmptyString(input.meshId)) return { ok: false, detail: "meshId is required" };
  if (!isNonEmptyString(input.nodeId)) return { ok: false, detail: "nodeId is required" };
  if (!isNonEmptyString(input.nodeName)) return { ok: false, detail: "nodeName is required" };
  if (typeof input.issuedAt !== "number" || !Number.isFinite(input.issuedAt)) {
    return { ok: false, detail: "issuedAt must be a number" };
  }
  if (typeof input.expiresAt !== "number" || !Number.isFinite(input.expiresAt)) {
    return { ok: false, detail: "expiresAt must be a number" };
  }
  if (input.expiresAt <= input.issuedAt) return { ok: false, detail: "expiresAt must be after issuedAt" };
  if (!Array.isArray(input.entrypoints)) return { ok: false, detail: "entrypoints must be an array" };

  return {
    ok: true,
    presence: input as unknown as OpenScoutMeshPresence,
  };
}

function assertAllowedMeshId(meshId: string, env: MeshFrontDoorEnv): Response | undefined {
  const allowed = env.OPENSCOUT_ALLOWED_MESH_IDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed || allowed.length === 0 || allowed.includes(meshId)) {
    return undefined;
  }
  return json(403, { error: "mesh_not_allowed" });
}

async function assertAuthorizedMeshMembership(
  auth: MeshFrontDoorAuth,
  meshId: string,
  env: MeshFrontDoorEnv,
): Promise<Response | undefined> {
  if (await githubUserCanAccessMesh(auth, meshId, env)) {
    return undefined;
  }
  return json(403, { error: "mesh_access_denied" });
}

function readMeshId(url: URL): string {
  return url.searchParams.get("meshId")?.trim() || "openscout";
}

function presenceKey(ownerKey: string, meshId: string, nodeId: string): string {
  return `${ownerKey}/mesh/${encodeURIComponent(meshId)}/node/${encodeURIComponent(nodeId)}`;
}

function presenceKeyPrefix(ownerKey: string, meshId: string): string {
  return `${ownerKey}/mesh/${encodeURIComponent(meshId)}/node/`;
}

function presenceKeyFromRecord(prefix: string, record: OpenScoutMeshPresenceRecord): string {
  return `${prefix}${encodeURIComponent(record.nodeId)}`;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampTimestamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function json(status: number, payload: ErrorResponse | unknown): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
