import { describe, expect, test } from "bun:test";
import nativeSurfaceManifest from "../../../../apps/ios/Scout/Resources/WebSurfaces/manifest.json";
import goldenJson from "./fixtures/scout-surface-contract-v1.json";
import { SCOUT_SURFACE_V1_GOLDEN_FIXTURES } from "./scout-surface-contract.fixtures.ts";
import {
  SCOUT_SURFACE_LIMITS,
  SCOUT_SURFACE_METHOD_POLICY,
  SCOUT_SURFACE_METHODS,
  SURFACE_PREFERENCE_KEYS,
  isScoutSurfaceMethod,
  preferenceKeysForSurface,
  type ScoutSurfaceMethod,
} from "./scout-surface-contract.ts";

describe("Scout surface v1 contract", () => {
  test("keeps the checked-in Swift parity corpus synchronized with typed fixtures", () => {
    expect(JSON.stringify(goldenJson)).toBe(JSON.stringify(SCOUT_SURFACE_V1_GOLDEN_FIXTURES));
  });

  test("has one request and successful reply fixture for every allowlisted method", () => {
    const requestMethods = new Set(SCOUT_SURFACE_V1_GOLDEN_FIXTURES.requests.map((item) => item.method));
    const replyMethods = new Set(SCOUT_SURFACE_V1_GOLDEN_FIXTURES.successReplies.map((item) => item.method));

    expect([...requestMethods].sort()).toEqual([...SCOUT_SURFACE_METHODS].sort());
    expect([...replyMethods].sort()).toEqual([...SCOUT_SURFACE_METHODS].sort());
  });

  test("defines a bounded deadline policy for every allowlisted method", () => {
    expect(Object.keys(SCOUT_SURFACE_METHOD_POLICY).sort()).toEqual([...SCOUT_SURFACE_METHODS].sort());
    for (const method of SCOUT_SURFACE_METHODS) {
      const policy = SCOUT_SURFACE_METHOD_POLICY[method];
      expect(policy.defaultDeadlineMs).toBeGreaterThan(0);
      expect(policy.maximumDeadlineMs).toBeGreaterThanOrEqual(policy.defaultDeadlineMs);
      expect(policy.surfaces.length).toBeGreaterThan(0);
    }
  });

  test("enumerates preferences per surface and keeps fixture values under the wire bound", () => {
    const allKeys = [...SURFACE_PREFERENCE_KEYS.lanes, ...SURFACE_PREFERENCE_KEYS.dispatch];
    expect(new Set(allKeys).size).toBe(allKeys.length);
    expect(preferenceKeysForSurface("lanes")).toEqual(SURFACE_PREFERENCE_KEYS.lanes);
    expect(preferenceKeysForSurface("dispatch")).toEqual(SURFACE_PREFERENCE_KEYS.dispatch);

    for (const entry of SCOUT_SURFACE_V1_GOLDEN_FIXTURES.preferences.entries) {
      expect(allKeys).toContain(entry.key);
      expect(new TextEncoder().encode(JSON.stringify(entry.value)).byteLength)
        .toBeLessThanOrEqual(SCOUT_SURFACE_LIMITS.preferenceValueBytes);
    }
  });

  test("recognizes only exact allowlisted method names", () => {
    for (const method of SCOUT_SURFACE_METHODS) expect(isScoutSurfaceMethod(method)).toBe(true);
    for (const method of ["fetch", "mobile/*", "agents.delete", "/api/ask"]) {
      expect(isScoutSurfaceMethod(method)).toBe(false);
    }
  });

  test("host-scoped fixture requests always name at least one host", () => {
    const hostScoped = new Set<ScoutSurfaceMethod>([
      "agents.list",
      "agents.observe",
      "tail.recent",
      "tail.subscribe",
      "dispatch.diagnostics",
      "dispatch.subscribe",
    ]);
    for (const request of SCOUT_SURFACE_V1_GOLDEN_FIXTURES.requests) {
      if (!hostScoped.has(request.method)) continue;
      expect("hostIds" in request && Array.isArray(request.hostIds) && request.hostIds.length > 0)
        .toBe(true);
    }
  });

  test("keeps the signed native-surface manifest aligned with the contract", () => {
    for (const surface of ["lanes", "dispatch"] as const) {
      const expectedMethods = SCOUT_SURFACE_METHODS.filter((method) =>
        SCOUT_SURFACE_METHOD_POLICY[method].surfaces.includes(surface),
      );
      expect(nativeSurfaceManifest.surfaces[surface].capabilities).toEqual(expectedMethods);
      expect(nativeSurfaceManifest.surfaces[surface].preferences)
        .toEqual([...SURFACE_PREFERENCE_KEYS[surface]]);
    }
  });
});
