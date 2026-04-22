import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeMobilePushDb,
  listActiveMobilePushRegistrations,
  listMobilePushRegistrations,
  syncMobilePushRegistration,
} from "./mobile-push.ts";
import { SQLiteControlPlaneStore } from "./sqlite-store.ts";

const tempRoots = new Set<string>();
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;

afterEach(() => {
  closeMobilePushDb();
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }

  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function createControlPlaneRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openscout-mobile-push-"));
  tempRoots.add(root);
  process.env.OPENSCOUT_CONTROL_HOME = root;
  const store = new SQLiteControlPlaneStore(join(root, "control-plane.sqlite"));
  store.close();
  return root;
}

describe("mobile push registrations", () => {
  test("upserts and updates the active registration for a device/environment", () => {
    createControlPlaneRoot();

    const first = syncMobilePushRegistration({
      deviceId: "device-1",
      platform: "ios",
      appBundleId: "com.openscout.scout",
      apnsEnvironment: "development",
      authorizationStatus: "authorized",
      pushToken: "AA BB CC 11",
      appVersion: "0.2.5",
      buildNumber: "12",
    });
    expect(first.registered).toBe(true);

    let rows = listMobilePushRegistrations();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pushToken).toBe("aabbcc11");
    expect(rows[0]?.appVersion).toBe("0.2.5");

    const second = syncMobilePushRegistration({
      deviceId: "device-1",
      platform: "ios",
      appBundleId: "com.openscout.scout",
      apnsEnvironment: "development",
      authorizationStatus: "authorized",
      pushToken: "ddeeff22",
      appVersion: "0.2.6",
      buildNumber: "13",
    });
    expect(second.registered).toBe(true);

    rows = listMobilePushRegistrations();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pushToken).toBe("ddeeff22");
    expect(rows[0]?.appVersion).toBe("0.2.6");
    expect(listActiveMobilePushRegistrations()).toHaveLength(1);
  });

  test("removes a registration when notification authorization is revoked", () => {
    createControlPlaneRoot();

    syncMobilePushRegistration({
      deviceId: "device-1",
      platform: "ios",
      appBundleId: "com.openscout.scout",
      apnsEnvironment: "development",
      authorizationStatus: "authorized",
      pushToken: "deadbeef",
    });
    expect(listActiveMobilePushRegistrations()).toHaveLength(1);

    const result = syncMobilePushRegistration({
      deviceId: "device-1",
      platform: "ios",
      appBundleId: "com.openscout.scout",
      apnsEnvironment: "development",
      authorizationStatus: "denied",
      pushToken: null,
    });

    expect(result.removed).toBe(true);
    expect(listMobilePushRegistrations()).toHaveLength(0);
    expect(listActiveMobilePushRegistrations()).toHaveLength(0);
  });

  test("reassigns an existing token to the latest device registration", () => {
    createControlPlaneRoot();

    syncMobilePushRegistration({
      deviceId: "device-1",
      platform: "ios",
      appBundleId: "com.openscout.scout",
      apnsEnvironment: "development",
      authorizationStatus: "authorized",
      pushToken: "cafebabe",
    });

    const result = syncMobilePushRegistration({
      deviceId: "device-2",
      platform: "ios",
      appBundleId: "com.openscout.scout",
      apnsEnvironment: "development",
      authorizationStatus: "authorized",
      pushToken: "cafebabe",
    });

    expect(result.registered).toBe(true);

    const rows = listMobilePushRegistrations();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceId).toBe("device-2");
    expect(rows[0]?.pushToken).toBe("cafebabe");
  });
});
