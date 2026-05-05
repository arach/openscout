import { describe, expect, test } from "bun:test";

import { handleOpenScoutPushRelayRequest } from "../src/push-relay.js";
import type { D1Database } from "../src/memberships.js";

const SESSION_SECRET = "test-session-secret-please-keep-sufficiently-long";

class FakeD1Database implements D1Database {
  readonly devices = new Map<string, Record<string, unknown>>();
  readonly attempts: Record<string, unknown>[] = [];
  readonly usage = new Map<string, Record<string, unknown>>();
  readonly rateBuckets = new Map<string, { count: number; updated_at: number }>();
  readonly auditLog: Record<string, unknown>[] = [];

  prepare(query: string) {
    return new FakeD1PreparedStatement(this, query);
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
    const q = this.query;

    if (q.includes("INSERT INTO osn_push_rate_buckets") && q.includes("RETURNING count")) {
      const [bucketKey, kind, windowStart, updatedAt] = this.values as [string, string, number, number];
      const key = `${bucketKey}|${kind}|${windowStart}`;
      const existing = this.db.rateBuckets.get(key);
      const next = (existing?.count ?? 0) + 1;
      this.db.rateBuckets.set(key, { count: next, updated_at: updatedAt });
      return { count: next } as T;
    }

    if (q.includes("FROM osn_push_devices") && q.includes("WHERE token_hash = ?")) {
      const [tokenHash] = this.values as [string];
      for (const row of this.db.devices.values()) {
        if (row.token_hash === tokenHash) {
          return { id: row.id, user_id: row.user_id } as T;
        }
      }
      return null;
    }

    if (q.includes("FROM osn_push_devices") && q.includes("COUNT(*) AS count")) {
      const [userId] = this.values as [string];
      const count = Array.from(this.db.devices.values())
        .filter((row) => row.user_id === userId && row.revoked_at == null)
        .length;
      return { count } as T;
    }

    if (q.includes("SELECT id FROM osn_push_devices") && q.includes("user_id = ?")) {
      const [userId, deviceId, platform, appBundleId, apnsEnvironment] = this.values as string[];
      for (const row of this.db.devices.values()) {
        if (
          row.user_id === userId
          && row.device_id === deviceId
          && row.platform === platform
          && row.app_bundle_id === appBundleId
          && row.apns_environment === apnsEnvironment
        ) {
          return { id: row.id } as T;
        }
      }
      return null;
    }

    return null;
  }

  async all<T = unknown>(): Promise<{ results?: T[] }> {
    const q = this.query;

    if (q.includes("FROM osn_push_devices") && q.includes("ORDER BY updated_at")) {
      const [userId] = this.values as [string];
      return {
        results: Array.from(this.db.devices.values())
          .filter((row) => row.user_id === userId)
          .map(redactDevice) as T[],
      };
    }

    if (q.includes("FROM osn_push_devices") && q.includes("revoked_at IS NULL")) {
      const [userId, deviceId] = this.values as [string, string | undefined];
      return {
        results: Array.from(this.db.devices.values())
          .filter((row) => row.user_id === userId)
          .filter((row) => !deviceId || row.device_id === deviceId)
          .filter((row) => row.revoked_at == null)
          .filter((row) => ["authorized", "provisional", "ephemeral"].includes(String(row.authorization_status)))
          .map((row) => ({
            id: row.id,
            user_id: row.user_id,
            device_id: row.device_id,
            app_bundle_id: row.app_bundle_id,
            apns_environment: row.apns_environment,
            encrypted_token: row.encrypted_token,
            authorization_status: row.authorization_status,
          })) as T[],
      };
    }

    if (q.includes("FROM osn_push_usage_daily")) {
      const [userId] = this.values as [string];
      return {
        results: Array.from(this.db.usage.values()).filter((row) => row.user_id === userId) as T[],
      };
    }

    if (q.includes("FROM osn_push_audit_log")) {
      const [userId] = this.values as [string];
      return {
        results: this.db.auditLog.filter((row) => row.user_id === userId) as T[],
      };
    }

    return { results: [] };
  }

  async run(): Promise<unknown> {
    const q = this.query;

    if (q.includes("INSERT INTO osn_push_devices")) {
      const [
        id,
        userId,
        meshId,
        deviceId,
        platform,
        appBundleId,
        apnsEnvironment,
        tokenHash,
        encryptedToken,
        authorizationStatus,
        appVersion,
        buildNumber,
        deviceModel,
        systemVersion,
        createdAt,
        updatedAt,
        lastSeenAt,
      ] = this.values;
      this.db.devices.set(String(id), {
        id,
        user_id: userId,
        mesh_id: meshId,
        device_id: deviceId,
        platform,
        app_bundle_id: appBundleId,
        apns_environment: apnsEnvironment,
        token_hash: tokenHash,
        encrypted_token: encryptedToken,
        authorization_status: authorizationStatus,
        app_version: appVersion,
        build_number: buildNumber,
        device_model: deviceModel,
        system_version: systemVersion,
        created_at: createdAt,
        updated_at: updatedAt,
        last_seen_at: lastSeenAt,
        revoked_at: null,
      });
      return {};
    }

    if (q.includes("DELETE FROM osn_push_devices")) {
      const [tokenHash, id] = this.values;
      for (const [key, row] of this.db.devices) {
        if (row.token_hash === tokenHash && row.id !== id) {
          this.db.devices.delete(key);
        }
      }
      return {};
    }

    if (q.includes("UPDATE osn_push_devices") && q.includes("WHERE user_id")) {
      const [authorizationStatus, revokedAt, updatedAt, userId, deviceId] = this.values;
      for (const row of this.db.devices.values()) {
        if (row.user_id === userId && row.device_id === deviceId) {
          row.authorization_status = authorizationStatus;
          row.revoked_at = revokedAt;
          row.updated_at = updatedAt;
        }
      }
      return {};
    }

    if (q.includes("UPDATE osn_push_devices") && q.includes("WHERE id = ?")) {
      const [revokedAt, updatedAt, id] = this.values;
      const row = this.db.devices.get(String(id));
      if (row) {
        row.revoked_at = revokedAt;
        row.updated_at = updatedAt;
      }
      return {};
    }

    if (q.includes("INSERT INTO osn_push_attempts")) {
      this.db.attempts.push({
        id: this.values[0],
        user_id: this.values[1],
        mesh_id: this.values[2],
        device_id: this.values[3],
        item_id: this.values[4],
        kind: this.values[5],
        status: this.values[6],
      });
      return {};
    }

    if (q.includes("INSERT INTO osn_push_usage_daily")) {
      const [userId, day, attemptedCount, deliveredCount, failedCount, updatedAt] = this.values;
      this.db.usage.set(`${userId}:${day}`, {
        user_id: userId,
        day,
        attempted_count: attemptedCount,
        delivered_count: deliveredCount,
        failed_count: failedCount,
        updated_at: updatedAt,
      });
      return {};
    }

    if (q.includes("UPDATE osn_push_rate_buckets")) {
      const [updatedAt, bucketKey, kind, windowStart] = this.values as [number, string, string, number];
      const key = `${bucketKey}|${kind}|${windowStart}`;
      const existing = this.db.rateBuckets.get(key);
      if (existing) {
        existing.count = Math.max(existing.count - 1, 0);
        existing.updated_at = updatedAt;
      }
      return {};
    }

    if (q.includes("INSERT INTO osn_push_audit_log")) {
      this.db.auditLog.push({
        id: this.values[0],
        user_id: this.values[1],
        action: this.values[2],
        outcome: this.values[3],
        detail: this.values[4],
        ip: this.values[5],
        user_agent: this.values[6],
        created_at: this.values[7],
      });
      return {};
    }

    return {};
  }
}

describe("OpenScout Push Relay (session-scoped)", () => {
  test("rejects calls without a valid session", async () => {
    const db = new FakeD1Database();
    const response = await handleOpenScoutPushRelayRequest(
      new Request("https://push.oscout.net/v1/push/devices", {
        method: "GET",
      }),
      env(db),
    );
    expect(response?.status).toBe(401);
    expect(db.auditLog.some((row) => row.outcome === "denied_unauthenticated")).toBe(true);
  });

  test("registers a device scoped to the authenticated user", async () => {
    const db = new FakeD1Database();
    const response = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-1",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      env(db),
    );

    expect(response?.status).toBe(200);
    const row = Array.from(db.devices.values())[0];
    expect(row?.user_id).toBe("alice");
    expect(row?.encrypted_token).not.toBe(hexToken("a1"));

    const listed = await handleOpenScoutPushRelayRequest(
      await getRequestAs("alice", "https://push.oscout.net/v1/push/devices"),
      env(db),
    );
    expect(listed?.status).toBe(200);
    await expect(listed?.json()).resolves.toMatchObject({
      devices: [{ user_id: "alice", device_id: "phone-1" }],
    });
  });

  test("rejects malformed APNs tokens (must be 64 hex)", async () => {
    const db = new FakeD1Database();
    const response = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-1",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: "not-a-real-token",
      }),
      env(db),
    );
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "invalid_push_token" });
  });

  test("a second user cannot claim a token already registered to someone else", async () => {
    const db = new FakeD1Database();
    await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-1",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      env(db),
    );

    const stolen = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("mallory", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-other",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      env(db),
    );
    expect(stolen?.status).toBe(403);
    expect(db.auditLog.some((row) => row.outcome === "denied_token_owned_by_other_user")).toBe(true);
  });

  test("listing devices does not leak another user's devices", async () => {
    const db = new FakeD1Database();
    await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-1",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      env(db),
    );

    const listed = await handleOpenScoutPushRelayRequest(
      await getRequestAs("bob", "https://push.oscout.net/v1/push/devices"),
      env(db),
    );
    expect(listed?.status).toBe(200);
    await expect(listed?.json()).resolves.toMatchObject({ devices: [] });
  });

  test("send only targets the caller's own devices", async () => {
    const db = new FakeD1Database();
    await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-a",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      env(db),
    );
    await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("bob", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-b",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("b2"),
      }),
      env(db),
    );

    const calls: unknown[] = [];
    const response = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push", {
        itemId: "item-1",
        kind: "approval",
      }),
      env(db),
      async (_input, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response("", { status: 200, headers: { "apns-id": "apns-1" } });
      },
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ attemptedCount: 1, deliveredCount: 1 });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).toContain("Scout needs attention");
  });

  test("targeting another user's deviceId returns 404 and does not call APNs", async () => {
    const db = new FakeD1Database();
    await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "alice-phone",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      env(db),
    );

    const calls: unknown[] = [];
    const response = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("bob", "https://push.oscout.net/v1/push", {
        deviceId: "alice-phone",
        itemId: "item-1",
        kind: "approval",
      }),
      env(db),
      async (_input, init) => {
        calls.push(init);
        return new Response("", { status: 200 });
      },
    );
    expect(response?.status).toBe(404);
    expect(calls).toHaveLength(0);
    expect(db.auditLog.some((row) => row.outcome === "denied_unknown_device")).toBe(true);
  });

  test("per-minute rate limit returns 429 with Retry-After", async () => {
    const db = new FakeD1Database();
    await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-a",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      env(db),
    );

    const tightEnv = {
      ...env(db),
      OPENSCOUT_PUSH_RATE_PER_MINUTE: "2",
    };

    for (let i = 0; i < 2; i += 1) {
      const ok = await handleOpenScoutPushRelayRequest(
        await jsonRequestAs("alice", "https://push.oscout.net/v1/push", {
          itemId: `item-${i}`,
          kind: "approval",
        }),
        tightEnv,
        async () => new Response("", { status: 200, headers: { "apns-id": `apns-${i}` } }),
      );
      expect(ok?.status).toBe(200);
    }

    const blocked = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push", {
        itemId: "item-x",
        kind: "approval",
      }),
      tightEnv,
      async () => new Response("", { status: 200 }),
    );
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBeTruthy();
    expect(blocked?.headers.get("x-ratelimit-window")).toBe("user_minute");
    await expect(blocked?.json()).resolves.toMatchObject({
      error: "push_rate_limited",
      window: "user_minute",
      limit: 2,
    });
    expect(db.auditLog.some((row) => row.outcome === "denied_rate_user_minute")).toBe(true);
  });

  test("device cap returns 429 once exceeded", async () => {
    const db = new FakeD1Database();
    const tightEnv = {
      ...env(db),
      OPENSCOUT_PUSH_MAX_DEVICES_PER_USER: "1",
    };

    const first = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-1",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      tightEnv,
    );
    expect(first?.status).toBe(200);

    const second = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-2",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("b2"),
      }),
      tightEnv,
    );
    expect(second?.status).toBe(429);
    await expect(second?.json()).resolves.toMatchObject({ error: "push_device_cap_exceeded" });
  });

  test("body size cap returns 413 when content-length exceeds limit", async () => {
    const db = new FakeD1Database();
    const tightEnv = {
      ...env(db),
      OPENSCOUT_PUSH_MAX_BODY_BYTES: "16",
    };
    const token = await mintSessionToken("alice");
    const body = JSON.stringify({ itemId: "item-much-too-long-for-the-cap", kind: "approval" });
    const response = await handleOpenScoutPushRelayRequest(
      new Request("https://push.oscout.net/v1/push", {
        method: "POST",
        headers: {
          authorization: `Bearer osn_session_${token}`,
          "content-type": "application/json",
          "content-length": String(body.length),
        },
        body,
      }),
      tightEnv,
    );
    expect(response?.status).toBe(413);
    await expect(response?.json()).resolves.toMatchObject({ error: "push_body_too_large" });
  });

  test("custom payload size cap returns 413", async () => {
    const db = new FakeD1Database();
    await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push/devices/register", {
        deviceId: "phone-1",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: hexToken("a1"),
      }),
      env(db),
    );
    const tightEnv = {
      ...env(db),
      OPENSCOUT_PUSH_MAX_CUSTOM_PAYLOAD_BYTES: "10",
    };
    const response = await handleOpenScoutPushRelayRequest(
      await jsonRequestAs("alice", "https://push.oscout.net/v1/push", {
        itemId: "this-is-way-longer-than-ten-bytes",
        kind: "approval",
      }),
      tightEnv,
    );
    expect(response?.status).toBe(413);
    await expect(response?.json()).resolves.toMatchObject({ error: "push_payload_too_large" });
  });
});

function env(db: FakeD1Database) {
  return {
    OSN_DB: db,
    OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    OPENSCOUT_APNS_TEAM_ID: "TEAMID1234",
    OPENSCOUT_APNS_KEY_ID: "KEYID12345",
    OPENSCOUT_APNS_PRIVATE_KEY: TEST_APNS_PRIVATE_KEY,
    OPENSCOUT_SESSION_SECRET: SESSION_SECRET,
  };
}

async function getRequestAs(userId: string, url: string): Promise<Request> {
  const token = await mintSessionToken(userId);
  return new Request(url, {
    method: "GET",
    headers: { authorization: `Bearer osn_session_${token}` },
  });
}

async function jsonRequestAs(userId: string, url: string, body: unknown): Promise<Request> {
  const token = await mintSessionToken(userId);
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer osn_session_${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function mintSessionToken(userId: string): Promise<string> {
  const session = {
    provider: "github" as const,
    providerUserId: userId,
    login: userId,
    email: `${userId}@example.com`,
    expiresAt: Date.now() + 3_600_000,
  };
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(session)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${base64Url(sig)}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function hexToken(prefix: string): string {
  const padded = prefix.padEnd(64, "0");
  return padded.slice(0, 64);
}

function redactDevice(row: Record<string, unknown>): Record<string, unknown> {
  const { token_hash: _tokenHash, encrypted_token: _encryptedToken, ...rest } = row;
  return rest;
}

const TEST_APNS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgbvUOYVlf31KBfE99
G/2iNiFU6H8HQhxjIeamZROuOHWhRANCAAQ+WbiyDimpaHkOlDFA4atbvlyY4tXX
4nVrnvJlCHgmtChNcFk4ES4Ib5zUXFmEIX2HjEMia4he+6Zv+f7CFUZv
-----END PRIVATE KEY-----`;
