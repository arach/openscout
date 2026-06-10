import { describe, expect, test } from "bun:test";

import {
  normalizeCliBinaryMtimeMs,
  shouldEnsureBrokerUptodateForCommand,
  shouldRestartBrokerForCliMtime,
} from "./uptodate.ts";

describe("CLI broker update check", () => {
  test("normalizes fractional mtimes before persisting and comparing", () => {
    expect(normalizeCliBinaryMtimeMs(1776614055986.6323)).toBe(1776614055986);
  });

  test("does not request a broker restart for the same binary mtime on the next run", () => {
    const currentMtimeMs = 1776614055986.6323;
    const persistedMtimeMs = 1776614055986;

    expect(shouldRestartBrokerForCliMtime(currentMtimeMs, persistedMtimeMs)).toBe(false);
  });

  test("requests a broker restart when the binary mtime actually increased", () => {
    expect(shouldRestartBrokerForCliMtime(2001.4, 2000)).toBe(true);
  });

  test("skips broker maintenance for stdio MCP startup", () => {
    expect(shouldEnsureBrokerUptodateForCommand("mcp")).toBe(false);
    expect(shouldEnsureBrokerUptodateForCommand("ask")).toBe(true);
    expect(shouldEnsureBrokerUptodateForCommand(null)).toBe(true);
  });
});
