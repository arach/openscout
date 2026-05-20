import { describe, expect, test } from "bun:test";

import {
  compareTimestampsAsc,
  formatAbsoluteTimestamp,
  normalizeTimestampMs,
  timeAgo,
} from "./time.ts";
import { isSameCalendarDay } from "./thread-days.ts";

describe("client timestamp helpers", () => {
  test("normalizes epoch seconds and milliseconds to milliseconds", () => {
    expect(normalizeTimestampMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTimestampMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTimestampMs(null)).toBeNull();
    expect(normalizeTimestampMs(Number.NaN)).toBeNull();
  });

  test("formats relative time from mixed timestamp units", () => {
    const nowMs = Date.UTC(2024, 0, 1, 12, 0, 0);

    expect(timeAgo(nowMs - 5 * 60_000, nowMs)).toBe("5m");
    expect(timeAgo(Math.floor((nowMs - 2 * 60 * 60_000) / 1000), nowMs)).toBe(
      "2h",
    );
    expect(timeAgo(null, nowMs)).toBe("");
  });

  test("compares timestamps after normalizing mixed units", () => {
    const firstMs = Date.UTC(2024, 0, 1, 10, 0, 0);
    const secondSeconds = Math.floor(Date.UTC(2024, 0, 1, 11, 0, 0) / 1000);

    expect(compareTimestampsAsc(secondSeconds, firstMs)).toBeGreaterThan(0);
    expect([secondSeconds, firstMs].sort(compareTimestampsAsc)).toEqual([
      firstMs,
      secondSeconds,
    ]);
  });

  test("thread day helpers use the shared timestamp normalization", () => {
    const morningMs = new Date(2024, 5, 1, 10, 0, 0).getTime();
    const eveningSeconds = Math.floor(
      new Date(2024, 5, 1, 18, 0, 0).getTime() / 1000,
    );

    expect(isSameCalendarDay(morningMs, eveningSeconds)).toBe(true);
  });

  test("absolute timestamp formatting is empty for unusable values", () => {
    expect(formatAbsoluteTimestamp(undefined)).toBe("");
  });
});
