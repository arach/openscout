import type { D1Database } from "./memberships.js";

export interface OpenScoutPushRelayEnv {
  OSN_DB?: D1Database;
  OPENSCOUT_PUSH_RELAY_TOKEN?: string;
  OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY?: string;
  OPENSCOUT_APNS_TEAM_ID?: string;
  OPENSCOUT_APNS_KEY_ID?: string;
  OPENSCOUT_APNS_PRIVATE_KEY?: string;
  OPENSCOUT_PUSH_DEFAULT_MESH_ID?: string;
}

type PushAuthorizationStatus =
  | "notDetermined"
  | "denied"
  | "authorized"
  | "provisional"
  | "ephemeral";

type ApnsEnvironment = "development" | "production";

interface RegisterDeviceInput {
  meshId?: string;
  deviceId: string;
  platform: "ios";
  appBundleId: string;
  apnsEnvironment: ApnsEnvironment;
  authorizationStatus: PushAuthorizationStatus;
  pushToken?: string | null;
  appVersion?: string | null;
  buildNumber?: string | null;
  deviceModel?: string | null;
  systemVersion?: string | null;
}

interface SendPushInput {
  meshId?: string;
  deviceId?: string | null;
  itemId?: string | null;
  kind?: string | null;
  urgency?: "interrupt" | "badge" | "silent" | null;
  payload?: Record<string, unknown> | null;
}

interface DeviceRow {
  id: string;
  device_id: string;
  app_bundle_id: string;
  apns_environment: ApnsEnvironment;
  encrypted_token: string;
  authorization_status: PushAuthorizationStatus;
}

const DEFAULT_MESH_ID = "openscout";
const DEFAULT_PUSH_TITLE = "Scout needs attention";
const DEFAULT_PUSH_BODY = "A local agent needs your input.";

export async function handleOpenScoutPushRelayRequest(
  request: Request,
  env: OpenScoutPushRelayEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (!url.pathname.startsWith("/v1/push")) {
    return undefined;
  }

  if (method === "GET" && url.pathname === "/v1/push/health") {
    return json(200, {
      ok: true,
      service: "openscout-push-relay",
    });
  }

  const authorized = authorizeRelayRequest(request, env);
  if (!authorized.ok) return authorized.response;

  if (!env.OSN_DB) return json(503, { error: "push_store_unavailable" });

  if (method === "POST" && url.pathname === "/v1/push/devices/register") {
    return registerDevice(request, env);
  }

  if (method === "POST" && url.pathname === "/v1/push/devices/unregister") {
    return unregisterDevice(request, env);
  }

  if (method === "GET" && url.pathname === "/v1/push/devices") {
    return listDevices(url, env);
  }

  if (method === "POST" && url.pathname === "/v1/push") {
    return sendPush(request, env, fetcher);
  }

  if (method === "GET" && url.pathname === "/v1/push/usage") {
    return usage(url, env);
  }

  return json(404, { error: "not_found" });
}

async function registerDevice(request: Request, env: OpenScoutPushRelayEnv): Promise<Response> {
  const input = await readJson<RegisterDeviceInput>(request);
  if (!input.ok) return input.response;
  const validation = validateRegisterDeviceInput(input.value, env);
  if (!validation.ok) return json(400, { error: "invalid_push_device", detail: validation.detail });

  const db = env.OSN_DB!;
  const now = Date.now();
  const meshId = validation.value.meshId;
  const pushToken = normalizeToken(validation.value.pushToken ?? "");

  if (!pushAllowed(validation.value.authorizationStatus)) {
    await db.prepare(`
      UPDATE osn_push_devices
         SET authorization_status = ?,
             revoked_at = ?,
             updated_at = ?
       WHERE mesh_id = ?
         AND device_id = ?
         AND platform = ?
         AND app_bundle_id = ?
         AND apns_environment = ?
    `).bind(
      validation.value.authorizationStatus,
      now,
      now,
      meshId,
      validation.value.deviceId,
      validation.value.platform,
      validation.value.appBundleId,
      validation.value.apnsEnvironment,
    ).run();
    return json(200, { ok: true, registered: false, removed: true });
  }

  if (!pushToken) {
    return json(200, { ok: true, registered: false, removed: false });
  }

  const encryptedToken = await encryptToken(pushToken, env);
  if (!encryptedToken.ok) return encryptedToken.response;
  const tokenHash = await sha256Hex(pushToken);
  const id = `push-${meshId}-${validation.value.deviceId}-${validation.value.appBundleId}-${validation.value.apnsEnvironment}`
    .replace(/[^a-zA-Z0-9._-]+/g, "-");

  await db.prepare(`
    DELETE FROM osn_push_devices
     WHERE token_hash = ?
       AND id <> ?
  `).bind(tokenHash, id).run();

  await db.prepare(`
    INSERT INTO osn_push_devices (
      id, mesh_id, device_id, platform, app_bundle_id, apns_environment,
      token_hash, encrypted_token, authorization_status, app_version, build_number,
      device_model, system_version, created_at, updated_at, last_seen_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(mesh_id, device_id, platform, app_bundle_id, apns_environment)
    DO UPDATE SET
      token_hash = excluded.token_hash,
      encrypted_token = excluded.encrypted_token,
      authorization_status = excluded.authorization_status,
      app_version = excluded.app_version,
      build_number = excluded.build_number,
      device_model = excluded.device_model,
      system_version = excluded.system_version,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at,
      revoked_at = NULL
  `).bind(
    id,
    meshId,
    validation.value.deviceId,
    validation.value.platform,
    validation.value.appBundleId,
    validation.value.apnsEnvironment,
    tokenHash,
    encryptedToken.value,
    validation.value.authorizationStatus,
    trimOrNull(validation.value.appVersion),
    trimOrNull(validation.value.buildNumber),
    trimOrNull(validation.value.deviceModel),
    trimOrNull(validation.value.systemVersion),
    now,
    now,
    now,
  ).run();

  return json(200, { ok: true, registered: true, removed: false });
}

async function unregisterDevice(request: Request, env: OpenScoutPushRelayEnv): Promise<Response> {
  const input = await readJson<Partial<RegisterDeviceInput>>(request);
  if (!input.ok) return input.response;
  const meshId = normalizeMeshId(input.value.meshId, env);
  const deviceId = input.value.deviceId?.trim();
  if (!deviceId) return json(400, { error: "invalid_push_device", detail: "deviceId is required" });
  const now = Date.now();
  await env.OSN_DB!.prepare(`
    UPDATE osn_push_devices
       SET authorization_status = 'denied',
           revoked_at = ?,
           updated_at = ?
     WHERE mesh_id = ?
       AND device_id = ?
  `).bind(now, now, meshId, deviceId).run();
  return json(200, { ok: true });
}

async function listDevices(url: URL, env: OpenScoutPushRelayEnv): Promise<Response> {
  const meshId = normalizeMeshId(url.searchParams.get("meshId"), env);
  const result = await env.OSN_DB!.prepare(`
    SELECT id, mesh_id, device_id, platform, app_bundle_id, apns_environment,
           authorization_status, app_version, build_number, device_model,
           system_version, created_at, updated_at, last_seen_at, revoked_at
      FROM osn_push_devices
     WHERE mesh_id = ?
     ORDER BY updated_at DESC, id ASC
  `).bind(meshId).all();
  return json(200, { devices: result.results ?? [] });
}

async function sendPush(
  request: Request,
  env: OpenScoutPushRelayEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await readJson<SendPushInput>(request);
  if (!input.ok) return input.response;
  const meshId = normalizeMeshId(input.value.meshId, env);
  const deviceId = trimOrNull(input.value.deviceId);
  const now = Date.now();

  const rows = await selectActiveDevices(env.OSN_DB!, meshId, deviceId);
  let deliveredCount = 0;
  const failures: Array<{ deviceId: string; status: number | null; reason: string | null }> = [];

  for (const row of rows) {
    const token = await decryptToken(row.encrypted_token, env);
    if (!token.ok) {
      failures.push({ deviceId: row.device_id, status: null, reason: "token_decrypt_failed" });
      continue;
    }
    const result = await sendApns(row, token.value, input.value, env, fetcher);
    await recordAttempt(env.OSN_DB!, {
      meshId,
      deviceId: row.device_id,
      itemId: trimOrNull(input.value.itemId),
      kind: trimOrNull(input.value.kind) ?? "operator_attention",
      status: result.delivered ? "delivered" : "failed",
      apnsId: result.apnsId,
      apnsStatus: result.status,
      apnsReason: result.reason,
      createdAt: now,
    });
    if (result.delivered) {
      deliveredCount += 1;
    } else {
      failures.push({ deviceId: row.device_id, status: result.status, reason: result.reason });
      if (result.reason === "BadDeviceToken" || result.reason === "Unregistered") {
        await revokeDevice(env.OSN_DB!, row.id, now);
      }
    }
  }

  await incrementUsage(env.OSN_DB!, meshId, now, rows.length, deliveredCount, failures.length);

  return json(200, {
    ok: true,
    attemptedCount: rows.length,
    deliveredCount,
    failedCount: failures.length,
    failures,
  });
}

async function usage(url: URL, env: OpenScoutPushRelayEnv): Promise<Response> {
  const meshId = normalizeMeshId(url.searchParams.get("meshId"), env);
  const result = await env.OSN_DB!.prepare(`
    SELECT day, attempted_count, delivered_count, failed_count
      FROM osn_push_usage_daily
     WHERE mesh_id = ?
     ORDER BY day DESC
     LIMIT 45
  `).bind(meshId).all();
  return json(200, { usage: result.results ?? [] });
}

async function selectActiveDevices(db: D1Database, meshId: string, deviceId: string | null): Promise<DeviceRow[]> {
  if (deviceId) {
    const result = await db.prepare(`
      SELECT id, device_id, app_bundle_id, apns_environment, encrypted_token, authorization_status
        FROM osn_push_devices
       WHERE mesh_id = ?
         AND device_id = ?
         AND revoked_at IS NULL
         AND authorization_status IN ('authorized', 'provisional', 'ephemeral')
    `).bind(meshId, deviceId).all<DeviceRow>();
    return result.results ?? [];
  }
  const result = await db.prepare(`
    SELECT id, device_id, app_bundle_id, apns_environment, encrypted_token, authorization_status
      FROM osn_push_devices
     WHERE mesh_id = ?
       AND revoked_at IS NULL
       AND authorization_status IN ('authorized', 'provisional', 'ephemeral')
  `).bind(meshId).all<DeviceRow>();
  return result.results ?? [];
}

async function recordAttempt(
  db: D1Database,
  input: {
    meshId: string;
    deviceId: string;
    itemId: string | null;
    kind: string;
    status: string;
    apnsId: string | null;
    apnsStatus: number | null;
    apnsReason: string | null;
    createdAt: number;
  },
): Promise<void> {
  await db.prepare(`
    INSERT INTO osn_push_attempts (
      id, mesh_id, device_id, item_id, kind, status, apns_id, apns_status, apns_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `attempt-${input.createdAt}-${crypto.randomUUID()}`,
    input.meshId,
    input.deviceId,
    input.itemId,
    input.kind,
    input.status,
    input.apnsId,
    input.apnsStatus,
    input.apnsReason,
    input.createdAt,
  ).run();
}

async function incrementUsage(
  db: D1Database,
  meshId: string,
  timestamp: number,
  attempted: number,
  delivered: number,
  failed: number,
): Promise<void> {
  const day = new Date(timestamp).toISOString().slice(0, 10);
  await db.prepare(`
    INSERT INTO osn_push_usage_daily (mesh_id, day, attempted_count, delivered_count, failed_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(mesh_id, day) DO UPDATE SET
      attempted_count = attempted_count + excluded.attempted_count,
      delivered_count = delivered_count + excluded.delivered_count,
      failed_count = failed_count + excluded.failed_count,
      updated_at = excluded.updated_at
  `).bind(meshId, day, attempted, delivered, failed, timestamp).run();
}

async function revokeDevice(db: D1Database, id: string, timestamp: number): Promise<void> {
  await db.prepare(`
    UPDATE osn_push_devices
       SET revoked_at = ?,
           updated_at = ?
     WHERE id = ?
  `).bind(timestamp, timestamp, id).run();
}

async function sendApns(
  row: DeviceRow,
  token: string,
  input: SendPushInput,
  env: OpenScoutPushRelayEnv,
  fetcher: typeof fetch,
): Promise<{ delivered: boolean; status: number | null; apnsId: string | null; reason: string | null }> {
  const jwt = await apnsJwt(env);
  if (!jwt.ok) return { delivered: false, status: null, apnsId: null, reason: jwt.reason };

  const authority = row.apns_environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
  const payload = {
    aps: {
      alert: {
        title: DEFAULT_PUSH_TITLE,
        body: bodyForKind(input.kind),
      },
      ...(input.urgency === "silent" ? {} : { sound: "default" }),
      "thread-id": "scout.inbox",
    },
    scout: sanitizeCustomPayload(input),
  };
  const response = await fetcher(`${authority}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt.value}`,
      "apns-topic": row.app_bundle_id,
      "apns-push-type": "alert",
      "apns-priority": input.urgency === "silent" ? "5" : "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  let reason: string | null = null;
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { reason?: string } | undefined;
    reason = body?.reason ?? `HTTP ${response.status}`;
  }
  return {
    delivered: response.ok,
    status: response.status,
    apnsId: response.headers.get("apns-id"),
    reason,
  };
}

function bodyForKind(kind: string | null | undefined): string {
  switch (kind) {
    case "failed_turn":
    case "failed_action":
    case "delivery_issue":
      return "A Scout task needs review.";
    case "approval":
    case "question":
    case "native_attention":
      return "A local agent needs your input.";
    default:
      return DEFAULT_PUSH_BODY;
  }
}

function sanitizeCustomPayload(input: SendPushInput): Record<string, unknown> {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  return {
    destination: payload.destination === "inbox" ? "inbox" : "inbox",
    itemId: trimOrNull(input.itemId) ?? trimOrNull(payload.itemId),
    kind: trimOrNull(input.kind) ?? trimOrNull(payload.kind),
  };
}

async function apnsJwt(env: OpenScoutPushRelayEnv): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
  const teamId = env.OPENSCOUT_APNS_TEAM_ID?.trim();
  const keyId = env.OPENSCOUT_APNS_KEY_ID?.trim();
  const privateKeyPem = env.OPENSCOUT_APNS_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !privateKeyPem) return { ok: false, reason: "missing_apns_credentials" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64Url(JSON.stringify({ iss: teamId, iat: nowSeconds }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return { ok: true, value: `${unsigned}.${base64Url(new Uint8Array(signature))}` };
}

async function encryptToken(token: string, env: OpenScoutPushRelayEnv): Promise<{ ok: true; value: string } | { ok: false; response: Response }> {
  const key = await importAesKey(env);
  if (!key.ok) return key;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: arrayBufferFromBytes(iv) },
    key.value,
    new TextEncoder().encode(token),
  );
  return { ok: true, value: `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}` };
}

async function decryptToken(encryptedToken: string, env: OpenScoutPushRelayEnv): Promise<{ ok: true; value: string } | { ok: false }> {
  const key = await importAesKey(env);
  if (!key.ok) return { ok: false };
  const [iv, ciphertext] = encryptedToken.split(".");
  if (!iv || !ciphertext) return { ok: false };
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: arrayBufferFromBytes(base64UrlToBytes(iv)) },
      key.value,
      arrayBufferFromBytes(base64UrlToBytes(ciphertext)),
    );
    return { ok: true, value: new TextDecoder().decode(decrypted) };
  } catch {
    return { ok: false };
  }
}

async function importAesKey(env: OpenScoutPushRelayEnv): Promise<{ ok: true; value: CryptoKey } | { ok: false; response: Response }> {
  const raw = env.OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return { ok: false, response: json(500, { error: "push_token_encryption_not_configured" }) };
  const bytes = base64UrlToBytes(raw);
  if (bytes.byteLength !== 32) {
    return { ok: false, response: json(500, { error: "invalid_push_token_encryption_key" }) };
  }
  return {
    ok: true,
    value: await crypto.subtle.importKey("raw", arrayBufferFromBytes(bytes), "AES-GCM", false, ["encrypt", "decrypt"]),
  };
}

function validateRegisterDeviceInput(
  input: RegisterDeviceInput,
  env: OpenScoutPushRelayEnv,
): { ok: true; value: RegisterDeviceInput & { meshId: string } } | { ok: false; detail: string } {
  const meshId = normalizeMeshId(input.meshId, env);
  if (!input || typeof input !== "object") return { ok: false, detail: "body must be an object" };
  if (input.platform !== "ios") return { ok: false, detail: "platform must be ios" };
  if (!input.deviceId?.trim()) return { ok: false, detail: "deviceId is required" };
  if (!input.appBundleId?.trim()) return { ok: false, detail: "appBundleId is required" };
  if (input.apnsEnvironment !== "development" && input.apnsEnvironment !== "production") {
    return { ok: false, detail: "apnsEnvironment must be development or production" };
  }
  if (!["notDetermined", "denied", "authorized", "provisional", "ephemeral"].includes(input.authorizationStatus)) {
    return { ok: false, detail: "authorizationStatus is invalid" };
  }
  return {
    ok: true,
    value: {
      ...input,
      meshId,
      deviceId: input.deviceId.trim(),
      appBundleId: input.appBundleId.trim(),
    },
  };
}

function authorizeRelayRequest(
  request: Request,
  env: OpenScoutPushRelayEnv,
): { ok: true } | { ok: false; response: Response } {
  const expected = env.OPENSCOUT_PUSH_RELAY_TOKEN?.trim();
  if (!expected) return { ok: false, response: json(503, { error: "push_relay_not_configured" }) };
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization !== `Bearer ${expected}`) {
    return { ok: false, response: json(401, { error: "unauthorized" }) };
  }
  return { ok: true };
}

async function readJson<T>(request: Request): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() as T };
  } catch {
    return { ok: false, response: json(400, { error: "bad_json" }) };
  }
}

function pushAllowed(status: PushAuthorizationStatus): boolean {
  return status === "authorized" || status === "provisional" || status === "ephemeral";
}

function normalizeToken(token: string): string {
  return token.trim().replace(/[<>\s]/g, "").toLowerCase();
}

function normalizeMeshId(meshId: string | null | undefined, env: OpenScoutPushRelayEnv): string {
  return meshId?.trim() || env.OPENSCOUT_PUSH_DEFAULT_MESH_ID?.trim() || DEFAULT_MESH_ID;
}

function trimOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return arrayBufferFromBytes(base64UrlToBytes(base64));
}

function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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
