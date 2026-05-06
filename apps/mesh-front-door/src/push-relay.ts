import {
  readOpenScoutSessionFromRequest,
  type OpenScoutAuthEnv,
  type OpenScoutSession,
} from "./auth.js";
import type { D1Database } from "./memberships.js";

export interface OpenScoutPushRelayEnv extends OpenScoutAuthEnv {
  OSN_DB?: D1Database;
  OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY?: string;
  OPENSCOUT_APNS_TEAM_ID?: string;
  OPENSCOUT_APNS_KEY_ID?: string;
  OPENSCOUT_APNS_PRIVATE_KEY?: string;
  OPENSCOUT_PUSH_DEFAULT_MESH_ID?: string;
  // Defensive controls — all optional, sensible defaults below.
  OPENSCOUT_PUSH_MAX_DEVICES_PER_USER?: string;
  OPENSCOUT_PUSH_RATE_PER_MINUTE?: string;
  OPENSCOUT_PUSH_RATE_PER_HOUR?: string;
  OPENSCOUT_PUSH_RATE_PER_DAY?: string;
  OPENSCOUT_PUSH_DEVICE_RATE_PER_MINUTE?: string;
  OPENSCOUT_PUSH_MAX_BODY_BYTES?: string;
  OPENSCOUT_PUSH_MAX_CUSTOM_PAYLOAD_BYTES?: string;
  OPENSCOUT_PUSH_AUDIT_RETENTION_DAYS?: string;
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
  user_id: string;
  device_id: string;
  app_bundle_id: string;
  apns_environment: ApnsEnvironment;
  encrypted_token: string;
  authorization_status: PushAuthorizationStatus;
}

type RateWindowKind = "user_minute" | "user_hour" | "user_day" | "device_minute";

interface RateLimitConfig {
  perMinute: number;
  perHour: number;
  perDay: number;
  perDeviceMinute: number;
}

interface DefenseConfig extends RateLimitConfig {
  maxDevicesPerUser: number;
  maxBodyBytes: number;
  maxCustomPayloadBytes: number;
  auditRetentionDays: number;
}

const DEFAULT_MESH_ID = "openscout";
const DEFAULT_PUSH_TITLE = "Scout needs attention";
const DEFAULT_PUSH_BODY = "A local agent needs your input.";

const DEFAULT_DEFENSES: DefenseConfig = {
  maxDevicesPerUser: 50,
  perMinute: 10,
  perHour: 100,
  perDay: 500,
  perDeviceMinute: 3,
  maxBodyBytes: 16 * 1024,
  maxCustomPayloadBytes: 1024,
  auditRetentionDays: 30,
};

const APNS_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

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

  if (!env.OSN_DB) return json(503, { error: "push_store_unavailable" });

  const session = await readOpenScoutSessionFromRequest(request, env);
  if (!session) {
    await audit(env, {
      userId: null,
      action: actionForRequest(method, url.pathname),
      outcome: "denied_unauthenticated",
      request,
    }).catch(() => undefined);
    return json(401, { error: "unauthorized" });
  }

  const userId = session.providerUserId;
  const defenses = readDefenseConfig(env);

  const bodyCap = enforceBodySize(request, defenses);
  if (bodyCap) {
    await audit(env, {
      userId,
      action: actionForRequest(method, url.pathname),
      outcome: "denied_body_too_large",
      detail: bodyCap.detail,
      request,
    }).catch(() => undefined);
    return bodyCap.response;
  }

  if (method === "POST" && url.pathname === "/v1/push/devices/register") {
    return registerDevice(request, env, session, defenses);
  }

  if (method === "POST" && url.pathname === "/v1/push/devices/unregister") {
    return unregisterDevice(request, env, session);
  }

  if (method === "GET" && url.pathname === "/v1/push/devices") {
    return listDevices(env, userId);
  }

  if (method === "POST" && url.pathname === "/v1/push") {
    return sendPush(request, env, session, defenses, fetcher);
  }

  if (method === "GET" && url.pathname === "/v1/push/usage") {
    return usage(env, userId);
  }

  if (method === "GET" && url.pathname === "/v1/push/audit") {
    return auditList(env, userId);
  }

  return json(404, { error: "not_found" });
}

async function registerDevice(
  request: Request,
  env: OpenScoutPushRelayEnv,
  session: OpenScoutSession,
  defenses: DefenseConfig,
): Promise<Response> {
  const userId = session.providerUserId;
  const input = await readJson<RegisterDeviceInput>(request);
  if (!input.ok) {
    await audit(env, { userId, action: "device_register", outcome: "denied_bad_json", request }).catch(() => undefined);
    return input.response;
  }
  const validation = validateRegisterDeviceInput(input.value, env);
  if (!validation.ok) {
    await audit(env, { userId, action: "device_register", outcome: "denied_invalid", detail: validation.detail, request }).catch(() => undefined);
    return json(400, { error: "invalid_push_device", detail: validation.detail });
  }

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
       WHERE user_id = ?
         AND device_id = ?
         AND platform = ?
         AND app_bundle_id = ?
         AND apns_environment = ?
    `).bind(
      validation.value.authorizationStatus,
      now,
      now,
      userId,
      validation.value.deviceId,
      validation.value.platform,
      validation.value.appBundleId,
      validation.value.apnsEnvironment,
    ).run();
    await audit(env, {
      userId,
      action: "device_register",
      outcome: "revoked_authorization",
      detail: validation.value.authorizationStatus,
      request,
    });
    return json(200, { ok: true, registered: false, removed: true });
  }

  if (!pushToken) {
    return json(200, { ok: true, registered: false, removed: false });
  }

  if (!APNS_TOKEN_PATTERN.test(pushToken)) {
    await audit(env, { userId, action: "device_register", outcome: "denied_token_format", request }).catch(() => undefined);
    return json(400, { error: "invalid_push_token", detail: "pushToken must be 64 hex characters" });
  }

  const tokenHash = await sha256Hex(pushToken);
  const existingTokenRow = await db.prepare(`
    SELECT id, user_id FROM osn_push_devices WHERE token_hash = ?
  `).bind(tokenHash).first<{ id: string; user_id: string }>();
  if (existingTokenRow && existingTokenRow.user_id !== userId) {
    await audit(env, {
      userId,
      action: "device_register",
      outcome: "denied_token_owned_by_other_user",
      detail: existingTokenRow.id,
      request,
    });
    return json(403, { error: "push_token_already_registered" });
  }

  const deviceCountRow = await db.prepare(`
    SELECT COUNT(*) AS count FROM osn_push_devices WHERE user_id = ? AND revoked_at IS NULL
  `).bind(userId).first<{ count: number }>();
  const existingDeviceRow = await db.prepare(`
    SELECT id FROM osn_push_devices
     WHERE user_id = ?
       AND device_id = ?
       AND platform = ?
       AND app_bundle_id = ?
       AND apns_environment = ?
  `).bind(
    userId,
    validation.value.deviceId,
    validation.value.platform,
    validation.value.appBundleId,
    validation.value.apnsEnvironment,
  ).first<{ id: string }>();
  if (!existingDeviceRow && (deviceCountRow?.count ?? 0) >= defenses.maxDevicesPerUser) {
    await audit(env, {
      userId,
      action: "device_register",
      outcome: "denied_device_cap",
      detail: `${deviceCountRow?.count ?? 0}/${defenses.maxDevicesPerUser}`,
      request,
    });
    return json(429, {
      error: "push_device_cap_exceeded",
      detail: `users may register up to ${defenses.maxDevicesPerUser} devices`,
    });
  }

  const encryptedToken = await encryptToken(pushToken, env);
  if (!encryptedToken.ok) return encryptedToken.response;
  const id = `push-${userId}-${validation.value.deviceId}-${validation.value.appBundleId}-${validation.value.apnsEnvironment}`
    .replace(/[^a-zA-Z0-9._-]+/g, "-");

  await db.prepare(`
    DELETE FROM osn_push_devices
     WHERE token_hash = ?
       AND id <> ?
  `).bind(tokenHash, id).run();

  await db.prepare(`
    INSERT INTO osn_push_devices (
      id, user_id, mesh_id, device_id, platform, app_bundle_id, apns_environment,
      token_hash, encrypted_token, authorization_status, app_version, build_number,
      device_model, system_version, created_at, updated_at, last_seen_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(user_id, device_id, platform, app_bundle_id, apns_environment)
    DO UPDATE SET
      mesh_id = excluded.mesh_id,
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
    userId,
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

  await audit(env, { userId, action: "device_register", outcome: "ok", detail: validation.value.deviceId, request });
  return json(200, { ok: true, registered: true, removed: false });
}

async function unregisterDevice(
  request: Request,
  env: OpenScoutPushRelayEnv,
  session: OpenScoutSession,
): Promise<Response> {
  const userId = session.providerUserId;
  const input = await readJson<Partial<RegisterDeviceInput>>(request);
  if (!input.ok) return input.response;
  const deviceId = input.value.deviceId?.trim();
  if (!deviceId) return json(400, { error: "invalid_push_device", detail: "deviceId is required" });
  const now = Date.now();
  await env.OSN_DB!.prepare(`
    UPDATE osn_push_devices
       SET authorization_status = 'denied',
           revoked_at = ?,
           updated_at = ?
     WHERE user_id = ?
       AND device_id = ?
  `).bind(now, now, userId, deviceId).run();
  await audit(env, { userId, action: "device_unregister", outcome: "ok", detail: deviceId, request });
  return json(200, { ok: true });
}

async function listDevices(env: OpenScoutPushRelayEnv, userId: string): Promise<Response> {
  const result = await env.OSN_DB!.prepare(`
    SELECT id, user_id, mesh_id, device_id, platform, app_bundle_id, apns_environment,
           authorization_status, app_version, build_number, device_model,
           system_version, created_at, updated_at, last_seen_at, revoked_at
      FROM osn_push_devices
     WHERE user_id = ?
     ORDER BY updated_at DESC, id ASC
  `).bind(userId).all();
  return json(200, { devices: result.results ?? [] });
}

async function sendPush(
  request: Request,
  env: OpenScoutPushRelayEnv,
  session: OpenScoutSession,
  defenses: DefenseConfig,
  fetcher: typeof fetch,
): Promise<Response> {
  const userId = session.providerUserId;
  const input = await readJson<SendPushInput>(request);
  if (!input.ok) {
    await audit(env, { userId, action: "send_push", outcome: "denied_bad_json", request }).catch(() => undefined);
    return input.response;
  }

  const customSize = customPayloadSize(input.value);
  if (customSize > defenses.maxCustomPayloadBytes) {
    await audit(env, {
      userId,
      action: "send_push",
      outcome: "denied_payload_too_large",
      detail: `${customSize}/${defenses.maxCustomPayloadBytes}`,
      request,
    }).catch(() => undefined);
    return json(413, {
      error: "push_payload_too_large",
      detail: `custom payload must be <= ${defenses.maxCustomPayloadBytes} bytes`,
    });
  }

  const deviceId = trimOrNull(input.value.deviceId);
  const now = Date.now();

  const userRate = await checkAndIncrementRate(env, userId, defenses, now);
  if (!userRate.ok) {
    await audit(env, {
      userId,
      action: "send_push",
      outcome: `denied_rate_${userRate.window}`,
      detail: `${userRate.count}/${userRate.limit}`,
      request,
    });
    return rateLimitResponse(userRate);
  }

  if (deviceId) {
    const deviceRate = await checkAndIncrementDeviceRate(env, userId, deviceId, defenses, now);
    if (!deviceRate.ok) {
      await audit(env, {
        userId,
        action: "send_push",
        outcome: "denied_rate_device_minute",
        detail: `${deviceRate.count}/${deviceRate.limit}`,
        request,
      });
      return rateLimitResponse(deviceRate);
    }
  }

  const rows = await selectActiveDevices(env.OSN_DB!, userId, deviceId);
  if (deviceId && rows.length === 0) {
    await audit(env, {
      userId,
      action: "send_push",
      outcome: "denied_unknown_device",
      detail: deviceId,
      request,
    });
    return json(404, { error: "push_device_not_found" });
  }

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
      userId,
      meshId: trimOrNull(input.value.meshId) ?? DEFAULT_MESH_ID,
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

  await incrementUsage(env.OSN_DB!, userId, now, rows.length, deliveredCount, failures.length);
  await audit(env, {
    userId,
    action: "send_push",
    outcome: "ok",
    detail: `attempted=${rows.length} delivered=${deliveredCount} failed=${failures.length}`,
    request,
  });

  return json(200, {
    ok: true,
    attemptedCount: rows.length,
    deliveredCount,
    failedCount: failures.length,
    failures,
  });
}

async function usage(env: OpenScoutPushRelayEnv, userId: string): Promise<Response> {
  const result = await env.OSN_DB!.prepare(`
    SELECT day, attempted_count, delivered_count, failed_count
      FROM osn_push_usage_daily
     WHERE user_id = ?
     ORDER BY day DESC
     LIMIT 45
  `).bind(userId).all();
  return json(200, { usage: result.results ?? [] });
}

async function auditList(env: OpenScoutPushRelayEnv, userId: string): Promise<Response> {
  const result = await env.OSN_DB!.prepare(`
    SELECT id, action, outcome, detail, ip, user_agent, created_at
      FROM osn_push_audit_log
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 200
  `).bind(userId).all();
  return json(200, { audit: result.results ?? [] });
}

async function selectActiveDevices(db: D1Database, userId: string, deviceId: string | null): Promise<DeviceRow[]> {
  if (deviceId) {
    const result = await db.prepare(`
      SELECT id, user_id, device_id, app_bundle_id, apns_environment, encrypted_token, authorization_status
        FROM osn_push_devices
       WHERE user_id = ?
         AND device_id = ?
         AND revoked_at IS NULL
         AND authorization_status IN ('authorized', 'provisional', 'ephemeral')
    `).bind(userId, deviceId).all<DeviceRow>();
    return result.results ?? [];
  }
  const result = await db.prepare(`
    SELECT id, user_id, device_id, app_bundle_id, apns_environment, encrypted_token, authorization_status
      FROM osn_push_devices
     WHERE user_id = ?
       AND revoked_at IS NULL
       AND authorization_status IN ('authorized', 'provisional', 'ephemeral')
  `).bind(userId).all<DeviceRow>();
  return result.results ?? [];
}

async function recordAttempt(
  db: D1Database,
  input: {
    userId: string;
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
      id, user_id, mesh_id, device_id, item_id, kind, status, apns_id, apns_status, apns_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `attempt-${input.createdAt}-${crypto.randomUUID()}`,
    input.userId,
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
  userId: string,
  timestamp: number,
  attempted: number,
  delivered: number,
  failed: number,
): Promise<void> {
  const day = new Date(timestamp).toISOString().slice(0, 10);
  await db.prepare(`
    INSERT INTO osn_push_usage_daily (user_id, day, attempted_count, delivered_count, failed_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET
      attempted_count = attempted_count + excluded.attempted_count,
      delivered_count = delivered_count + excluded.delivered_count,
      failed_count = failed_count + excluded.failed_count,
      updated_at = excluded.updated_at
  `).bind(userId, day, attempted, delivered, failed, timestamp).run();
}

async function revokeDevice(db: D1Database, id: string, timestamp: number): Promise<void> {
  await db.prepare(`
    UPDATE osn_push_devices
       SET revoked_at = ?,
           updated_at = ?
     WHERE id = ?
  `).bind(timestamp, timestamp, id).run();
}

interface RateCheckOk {
  ok: true;
  window: RateWindowKind;
  count: number;
  limit: number;
  resetSeconds: number;
}

interface RateCheckBlocked {
  ok: false;
  window: RateWindowKind;
  count: number;
  limit: number;
  resetSeconds: number;
}

type RateCheckResult = RateCheckOk | RateCheckBlocked;

async function checkAndIncrementRate(
  env: OpenScoutPushRelayEnv,
  userId: string,
  defenses: DefenseConfig,
  now: number,
): Promise<RateCheckResult> {
  const checks: Array<{ kind: RateWindowKind; limit: number; windowMs: number }> = [
    { kind: "user_minute", limit: defenses.perMinute, windowMs: 60_000 },
    { kind: "user_hour", limit: defenses.perHour, windowMs: 3_600_000 },
    { kind: "user_day", limit: defenses.perDay, windowMs: 86_400_000 },
  ];
  for (const check of checks) {
    const result = await atomicIncrementWithLimit(env.OSN_DB!, userId, check.kind, check.windowMs, check.limit, now);
    if (!result.ok) return result;
  }
  return {
    ok: true,
    window: "user_minute",
    count: 0,
    limit: defenses.perMinute,
    resetSeconds: 60,
  };
}

async function checkAndIncrementDeviceRate(
  env: OpenScoutPushRelayEnv,
  userId: string,
  deviceId: string,
  defenses: DefenseConfig,
  now: number,
): Promise<RateCheckResult> {
  const key = `${userId}:${deviceId}`;
  return atomicIncrementWithLimit(env.OSN_DB!, key, "device_minute", 60_000, defenses.perDeviceMinute, now);
}

// Atomic check-and-increment via INSERT ... ON CONFLICT DO UPDATE ... RETURNING.
// If the resulting count exceeds the limit, we decrement to roll back the
// counter so a rejected request doesn't permanently consume budget.
async function atomicIncrementWithLimit(
  db: D1Database,
  bucketKey: string,
  kind: RateWindowKind,
  windowMs: number,
  limit: number,
  now: number,
): Promise<RateCheckResult> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  const row = await db.prepare(`
    INSERT INTO osn_push_rate_buckets (bucket_key, window_kind, window_start, count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(bucket_key, window_kind, window_start) DO UPDATE SET
      count = count + 1,
      updated_at = excluded.updated_at
    RETURNING count
  `).bind(bucketKey, kind, windowStart, now).first<{ count: number }>();
  const count = row?.count ?? 1;
  if (count > limit) {
    await db.prepare(`
      UPDATE osn_push_rate_buckets
         SET count = MAX(count - 1, 0),
             updated_at = ?
       WHERE bucket_key = ? AND window_kind = ? AND window_start = ?
    `).bind(now, bucketKey, kind, windowStart).run();
    return { ok: false, window: kind, count: count - 1, limit, resetSeconds };
  }
  return { ok: true, window: kind, count, limit, resetSeconds };
}

function rateLimitResponse(result: RateCheckBlocked): Response {
  return new Response(
    JSON.stringify({
      error: "push_rate_limited",
      window: result.window,
      limit: result.limit,
      retryAfterSeconds: result.resetSeconds,
      detail: humanRateMessage(result),
    }, null, 2),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": String(result.resetSeconds),
        "x-ratelimit-limit": String(result.limit),
        "x-ratelimit-window": result.window,
        "x-ratelimit-reset": String(result.resetSeconds),
      },
    },
  );
}

function humanRateMessage(result: RateCheckBlocked): string {
  switch (result.window) {
    case "user_minute":
      return `Per-user per-minute limit reached (${result.limit}). Retry in ${result.resetSeconds}s.`;
    case "user_hour":
      return `Per-user per-hour limit reached (${result.limit}). Retry in ${result.resetSeconds}s.`;
    case "user_day":
      return `Per-user per-day limit reached (${result.limit}). Retry in ${result.resetSeconds}s.`;
    case "device_minute":
      return `Per-device per-minute limit reached (${result.limit}). Retry in ${result.resetSeconds}s.`;
  }
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
  const collapseId = collapseIdFor(input);
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt.value}`,
    "apns-topic": row.app_bundle_id,
    "apns-push-type": "alert",
    "apns-priority": input.urgency === "silent" ? "5" : "10",
    "content-type": "application/json",
  };
  if (collapseId) headers["apns-collapse-id"] = collapseId;
  const response = await fetcher(`${authority}/3/device/${token}`, {
    method: "POST",
    headers,
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

function customPayloadSize(input: SendPushInput): number {
  return new TextEncoder().encode(JSON.stringify(sanitizeCustomPayload(input))).byteLength;
}

function collapseIdFor(input: SendPushInput): string | undefined {
  const itemId = trimOrNull(input.itemId);
  if (!itemId) return undefined;
  return itemId.length <= 64 ? itemId : itemId.slice(0, 64);
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

function readDefenseConfig(env: OpenScoutPushRelayEnv): DefenseConfig {
  return {
    maxDevicesPerUser: readPositiveInt(env.OPENSCOUT_PUSH_MAX_DEVICES_PER_USER, DEFAULT_DEFENSES.maxDevicesPerUser),
    perMinute: readPositiveInt(env.OPENSCOUT_PUSH_RATE_PER_MINUTE, DEFAULT_DEFENSES.perMinute),
    perHour: readPositiveInt(env.OPENSCOUT_PUSH_RATE_PER_HOUR, DEFAULT_DEFENSES.perHour),
    perDay: readPositiveInt(env.OPENSCOUT_PUSH_RATE_PER_DAY, DEFAULT_DEFENSES.perDay),
    perDeviceMinute: readPositiveInt(env.OPENSCOUT_PUSH_DEVICE_RATE_PER_MINUTE, DEFAULT_DEFENSES.perDeviceMinute),
    maxBodyBytes: readPositiveInt(env.OPENSCOUT_PUSH_MAX_BODY_BYTES, DEFAULT_DEFENSES.maxBodyBytes),
    maxCustomPayloadBytes: readPositiveInt(env.OPENSCOUT_PUSH_MAX_CUSTOM_PAYLOAD_BYTES, DEFAULT_DEFENSES.maxCustomPayloadBytes),
    auditRetentionDays: readPositiveInt(env.OPENSCOUT_PUSH_AUDIT_RETENTION_DAYS, DEFAULT_DEFENSES.auditRetentionDays),
  };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function enforceBodySize(
  request: Request,
  defenses: DefenseConfig,
): { detail: string; response: Response } | undefined {
  const header = request.headers.get("content-length");
  if (!header) return undefined;
  const length = Number.parseInt(header, 10);
  if (!Number.isFinite(length)) return undefined;
  if (length > defenses.maxBodyBytes) {
    return {
      detail: `${length}/${defenses.maxBodyBytes}`,
      response: json(413, {
        error: "push_body_too_large",
        detail: `request body must be <= ${defenses.maxBodyBytes} bytes`,
      }),
    };
  }
  return undefined;
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

function actionForRequest(method: string, pathname: string): string {
  if (method === "POST" && pathname === "/v1/push/devices/register") return "device_register";
  if (method === "POST" && pathname === "/v1/push/devices/unregister") return "device_unregister";
  if (method === "GET" && pathname === "/v1/push/devices") return "list_devices";
  if (method === "POST" && pathname === "/v1/push") return "send_push";
  if (method === "GET" && pathname === "/v1/push/usage") return "list_usage";
  if (method === "GET" && pathname === "/v1/push/audit") return "list_audit";
  return `${method} ${pathname}`;
}

interface AuditInput {
  userId: string | null;
  action: string;
  outcome: string;
  detail?: string | null;
  request?: Request;
}

async function audit(env: OpenScoutPushRelayEnv, input: AuditInput): Promise<void> {
  if (!env.OSN_DB) return;
  const id = `audit-${Date.now()}-${crypto.randomUUID()}`;
  const ip = input.request?.headers.get("cf-connecting-ip") ?? input.request?.headers.get("x-real-ip") ?? null;
  const ua = input.request?.headers.get("user-agent") ?? null;
  await env.OSN_DB.prepare(`
    INSERT INTO osn_push_audit_log (id, user_id, action, outcome, detail, ip, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.userId,
    input.action,
    input.outcome,
    input.detail ?? null,
    ip,
    ua,
    Date.now(),
  ).run();
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
