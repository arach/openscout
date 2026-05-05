import { describe, expect, test } from "bun:test";

import { handleOpenScoutPushRelayRequest } from "../src/push-relay.js";
import type { D1Database } from "../src/memberships.js";

class FakeD1Database implements D1Database {
  readonly devices = new Map<string, Record<string, unknown>>();
  readonly attempts: Record<string, unknown>[] = [];
  readonly usage = new Map<string, Record<string, unknown>>();

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
    return null;
  }

  async all<T = unknown>(): Promise<{ results?: T[] }> {
    if (this.query.includes("FROM osn_push_devices") && this.query.includes("ORDER BY updated_at")) {
      const [meshId] = this.values as [string];
      return {
        results: Array.from(this.db.devices.values())
          .filter((row) => row.mesh_id === meshId)
          .map(redactDevice) as T[],
      };
    }

    if (this.query.includes("FROM osn_push_devices") && this.query.includes("revoked_at IS NULL")) {
      const [meshId, deviceId] = this.values as [string, string | undefined];
      return {
        results: Array.from(this.db.devices.values())
          .filter((row) => row.mesh_id === meshId)
          .filter((row) => !deviceId || row.device_id === deviceId)
          .filter((row) => row.revoked_at == null)
          .filter((row) => ["authorized", "provisional", "ephemeral"].includes(String(row.authorization_status)))
          .map((row) => ({
            id: row.id,
            device_id: row.device_id,
            app_bundle_id: row.app_bundle_id,
            apns_environment: row.apns_environment,
            encrypted_token: row.encrypted_token,
            authorization_status: row.authorization_status,
          })) as T[],
      };
    }

    if (this.query.includes("FROM osn_push_usage_daily")) {
      const [meshId] = this.values as [string];
      return {
        results: Array.from(this.db.usage.values()).filter((row) => row.mesh_id === meshId) as T[],
      };
    }

    return { results: [] };
  }

  async run(): Promise<unknown> {
    if (this.query.includes("INSERT INTO osn_push_devices")) {
      const [
        id,
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

    if (this.query.includes("DELETE FROM osn_push_devices")) {
      const [tokenHash, id] = this.values;
      for (const [key, row] of this.db.devices) {
        if (row.token_hash === tokenHash && row.id !== id) {
          this.db.devices.delete(key);
        }
      }
      return {};
    }

    if (this.query.includes("UPDATE osn_push_devices") && this.query.includes("WHERE mesh_id")) {
      const [authorizationStatus, revokedAt, updatedAt, meshId, deviceId] = this.values;
      for (const row of this.db.devices.values()) {
        if (row.mesh_id === meshId && row.device_id === deviceId) {
          row.authorization_status = authorizationStatus;
          row.revoked_at = revokedAt;
          row.updated_at = updatedAt;
        }
      }
      return {};
    }

    if (this.query.includes("INSERT INTO osn_push_attempts")) {
      this.db.attempts.push({
        id: this.values[0],
        mesh_id: this.values[1],
        device_id: this.values[2],
        item_id: this.values[3],
        kind: this.values[4],
        status: this.values[5],
      });
      return {};
    }

    if (this.query.includes("INSERT INTO osn_push_usage_daily")) {
      const [meshId, day, attemptedCount, deliveredCount, failedCount, updatedAt] = this.values;
      this.db.usage.set(`${meshId}:${day}`, {
        mesh_id: meshId,
        day,
        attempted_count: attemptedCount,
        delivered_count: deliveredCount,
        failed_count: failedCount,
        updated_at: updatedAt,
      });
      return {};
    }

    return {};
  }
}

describe("OpenScout Push Relay", () => {
  test("registers APNs device tokens encrypted and lists redacted devices", async () => {
    const db = new FakeD1Database();
    const response = await handleOpenScoutPushRelayRequest(
      jsonRequest("https://push.oscout.net/v1/push/devices/register", {
        meshId: "openscout",
        deviceId: "phone-1",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: "AA BB CC 11",
      }),
      env(db),
    );

    expect(response?.status).toBe(200);
    expect(Array.from(db.devices.values())[0]?.encrypted_token).not.toBe("aabbcc11");

    const listed = await handleOpenScoutPushRelayRequest(
      new Request("https://push.oscout.net/v1/push/devices?meshId=openscout", {
        headers: authHeaders(),
      }),
      env(db),
    );

    expect(listed?.status).toBe(200);
    await expect(listed?.json()).resolves.toMatchObject({
      devices: [{
        mesh_id: "openscout",
        device_id: "phone-1",
        app_bundle_id: "com.openscout.scout",
      }],
    });
  });

  test("sends generic APNs payloads and records usage", async () => {
    const db = new FakeD1Database();
    await handleOpenScoutPushRelayRequest(
      jsonRequest("https://push.oscout.net/v1/push/devices/register", {
        meshId: "openscout",
        deviceId: "phone-1",
        platform: "ios",
        appBundleId: "com.openscout.scout",
        apnsEnvironment: "production",
        authorizationStatus: "authorized",
        pushToken: "aabbcc11",
      }),
      env(db),
    );

    const pushed: unknown[] = [];
    const response = await handleOpenScoutPushRelayRequest(
      jsonRequest("https://push.oscout.net/v1/push", {
        meshId: "openscout",
        itemId: "item-1",
        kind: "approval",
        payload: {
          destination: "inbox",
          itemId: "item-1",
          detail: "do not leak this detail",
        },
      }),
      env(db),
      async (_input, init) => {
        pushed.push(JSON.parse(String(init?.body)));
        return new Response("", {
          status: 200,
          headers: { "apns-id": "apns-1" },
        });
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      attemptedCount: 1,
      deliveredCount: 1,
    });
    expect(JSON.stringify(pushed[0])).toContain("Scout needs attention");
    expect(JSON.stringify(pushed[0])).not.toContain("do not leak this detail");
    expect(db.attempts).toHaveLength(1);
    expect(db.usage.size).toBe(1);
  });
});

function env(db: FakeD1Database) {
  return {
    OSN_DB: db,
    OPENSCOUT_PUSH_RELAY_TOKEN: "relay-secret",
    OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    OPENSCOUT_APNS_TEAM_ID: "TEAMID1234",
    OPENSCOUT_APNS_KEY_ID: "KEYID12345",
    OPENSCOUT_APNS_PRIVATE_KEY: TEST_APNS_PRIVATE_KEY,
  };
}

function authHeaders() {
  return {
    authorization: "Bearer relay-secret",
  };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
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
