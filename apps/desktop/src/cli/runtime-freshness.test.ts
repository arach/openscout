import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  extractRuntimeFreshnessDecisionFromScoutdPayload,
  RUNTIME_FRESHNESS_DECISION_KEYS,
  shouldRestartBrokerForRuntimeFreshness,
} from "./runtime-freshness.ts";

const fixtureNames = [
  "scoutd-status-unverified.json",
  "scoutd-status-stale.json",
  "scoutd-status-stale-intentional.json",
] as const;

function readFixture(name: (typeof fixtureNames)[number]): unknown {
  return JSON.parse(
    readFileSync(new URL(`./test-fixtures/${name}`, import.meta.url), "utf8"),
  );
}

function fixtureRuntimeFreshness(payload: unknown): Record<string, unknown> {
  expect(payload).toBeObject();
  const freshness = (payload as Record<string, unknown>).runtimeFreshness;
  expect(freshness).toBeObject();
  return freshness as Record<string, unknown>;
}

describe("scoutd runtime freshness contract", () => {
  test("captured fixtures retain every field used by the decision extractor", () => {
    for (const name of fixtureNames) {
      const freshness = fixtureRuntimeFreshness(readFixture(name));
      for (const key of RUNTIME_FRESHNESS_DECISION_KEYS) {
        expect(Object.hasOwn(freshness, key)).toBe(true);
      }
    }
  });

  test("a live dirty-checkout status is unverified and cannot authorize restart", () => {
    const freshness = extractRuntimeFreshnessDecisionFromScoutdPayload(
      readFixture("scoutd-status-unverified.json"),
    );

    expect(freshness).toEqual({
      state: "unverified",
      intentional: false,
      basis: "workspace_head",
      detail:
        "The runtime started from a dirty source checkout; commit identity alone cannot prove that the currently loaded process includes every working-tree edit.",
    });
    expect(shouldRestartBrokerForRuntimeFreshness(freshness)).toBe(false);
  });

  test("a stale installed artifact authorizes restart", () => {
    const freshness = extractRuntimeFreshnessDecisionFromScoutdPayload(
      readFixture("scoutd-status-stale.json"),
    );

    expect(freshness).toMatchObject({
      state: "stale",
      intentional: false,
      basis: "installed_artifact",
    });
    expect(shouldRestartBrokerForRuntimeFreshness(freshness)).toBe(true);
  });

  test("an intentional stale verdict cannot authorize restart", () => {
    const freshness = extractRuntimeFreshnessDecisionFromScoutdPayload(
      readFixture("scoutd-status-stale-intentional.json"),
    );

    expect(freshness).toMatchObject({
      state: "stale",
      intentional: true,
      basis: "installed_artifact",
    });
    expect(shouldRestartBrokerForRuntimeFreshness(freshness)).toBe(false);
  });

  test("missing decision fields fail closed", () => {
    const freshness = extractRuntimeFreshnessDecisionFromScoutdPayload({
      runtimeFreshness: { state: "stale", basis: "installed_artifact" },
    });

    expect(freshness).toBeNull();
    expect(shouldRestartBrokerForRuntimeFreshness(freshness)).toBe(false);
  });
});
