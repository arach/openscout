import { describe, expect, test } from "bun:test";

import type { FlightSessionTrace } from "../../lib/types.ts";
import { uniqueFlightSessions } from "./flight-observe.ts";

function traceEntry(sessionId: string, startedAt: number): FlightSessionTrace {
  return {
    sessionId,
    startedAt,
    lastAcknowledgedAt: startedAt,
  };
}

describe("flight observe session selection", () => {
  test("orders unique sessions by their most recent trace span", () => {
    const firstA = traceEntry("session-a", 100);
    const sessionB = traceEntry("session-b", 200);
    const resumedA = traceEntry("session-a", 300);

    expect(uniqueFlightSessions([firstA, sessionB, resumedA])).toEqual([
      sessionB,
      resumedA,
    ]);
  });
});
