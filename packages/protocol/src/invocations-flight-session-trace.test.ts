import { describe, expect, test } from "bun:test";

import {
  flightSessionTrace,
  recordFlightSessionDispatch,
} from "./invocations.ts";

describe("flight session trace", () => {
  test("projects legacy dispatch metadata as a single session", () => {
    expect(flightSessionTrace({
      dispatchAck: {
        sessionId: "session-1",
        endpointId: "endpoint-1",
        harness: "claude",
        transport: "tmux",
        strategy: "spawn",
        acknowledgedAt: 100,
      },
    })).toEqual([{
      sessionId: "session-1",
      endpointId: "endpoint-1",
      harness: "claude",
      transport: "tmux",
      strategy: "spawn",
      startedAt: 100,
      lastAcknowledgedAt: 100,
    }]);
  });

  test("keeps ordered spans when dispatch moves to another session", () => {
    const first = recordFlightSessionDispatch({}, {
      sessionId: "session-1",
      endpointId: "endpoint-1",
      harness: "claude",
      transport: "tmux",
      strategy: "spawn",
      acknowledgedAt: 100,
    });
    const second = recordFlightSessionDispatch(first, {
      sessionId: "session-2",
      endpointId: "endpoint-2",
      harness: "claude",
      transport: "tmux",
      strategy: "wake",
      acknowledgedAt: 250,
    });

    expect(flightSessionTrace(second)).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        startedAt: 100,
        endedAt: 250,
      }),
      expect.objectContaining({
        sessionId: "session-2",
        startedAt: 250,
        lastAcknowledgedAt: 250,
        strategy: "wake",
      }),
    ]);
  });

  test("updates repeated acknowledgement of the same concrete session", () => {
    const first = recordFlightSessionDispatch({}, {
      sessionId: "session-1",
      endpointId: "endpoint-1",
      strategy: "spawn",
      acknowledgedAt: 100,
    });
    const attached = recordFlightSessionDispatch(first, {
      sessionId: "session-1",
      endpointId: "endpoint-1",
      strategy: "attach",
      acknowledgedAt: 200,
    });

    expect(flightSessionTrace(attached)).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        startedAt: 100,
        lastAcknowledgedAt: 200,
        strategy: "attach",
      }),
    ]);
  });
});
