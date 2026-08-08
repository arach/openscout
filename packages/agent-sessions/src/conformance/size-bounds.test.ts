import { describe, expect, test } from "bun:test";
import { createCodexEventNormalizer } from "../adapters/codex/normalizer.js";
import {
  MAX_ACTION_OUTPUT_EVENT_UTF8_BYTES,
  MAX_DIAGNOSTIC_UTF8_BYTES,
  MAX_SESSION_EVENT_UTF8_BYTES,
  truncateUtf8,
  utf8ByteLength,
  type AdapterReplayRecord,
} from "../protocol/normalizer.js";
import type { AgentSessionStreamEvent, Session } from "../protocol/primitives.js";
import { StateTracker } from "../state.js";

function createNormalizer() {
  const times = [
    "2026-08-07T20:00:00.000Z",
    "2026-08-07T20:00:01.000Z",
  ];
  let nextTime = 0;
  let nextBlock = 0;
  return createCodexEventNormalizer({
    sessionId: "size-bound-session",
    now: () => times[nextTime++] ?? times.at(-1)!,
    nextId: (kind) => `${kind}-${++nextBlock}`,
  });
}

function replay(records: AdapterReplayRecord[]): AgentSessionStreamEvent[] {
  const normalizer = createNormalizer();
  return records.flatMap((record) => normalizer.ingest(record));
}

describe("SCO-042 event size bounds (C009)", () => {
  test("truncateUtf8 never splits a multi-byte scalar", () => {
    const value = `ab${"🙂".repeat(4)}`;
    const result = truncateUtf8(value, 5);
    expect(result.text).toBe("ab");
    expect(utf8ByteLength(result.text)).toBeLessThanOrEqual(5);
    expect(result.omittedBytes).toBe(16);
  });

  test("bounds repeated Codex action output and preserves exact omission metadata", () => {
    const firstOutput = "a".repeat(70 * 1024);
    const secondOutput = "b".repeat(70 * 1024);
    const events = replay([
      {
        source: "harness",
        sequence: 0,
        payload: {
          method: "turn/started",
          params: { turn: { id: "turn-large", status: "inProgress" } },
        },
      },
      {
        source: "harness",
        sequence: 1,
        payload: {
          method: "item/started",
          params: {
            turnId: "turn-large",
            item: { id: "command-large", type: "commandExecution", command: ["fixture"] },
          },
        },
      },
      {
        source: "harness",
        sequence: 2,
        payload: {
          method: "item/commandExecution/outputDelta",
          params: { turnId: "turn-large", itemId: "command-large", delta: firstOutput },
        },
      },
      {
        source: "harness",
        sequence: 3,
        payload: {
          method: "item/commandExecution/outputDelta",
          params: { turnId: "turn-large", itemId: "command-large", delta: secondOutput },
        },
      },
      {
        source: "harness",
        sequence: 4,
        payload: {
          method: "turn/completed",
          params: { turn: { id: "turn-large", status: "completed" } },
        },
      },
    ]);

    for (const event of events) {
      expect(utf8ByteLength(JSON.stringify(event))).toBeLessThanOrEqual(
        MAX_SESSION_EVENT_UTF8_BYTES,
      );
    }

    const outputEvents = events.filter(
      (event): event is Extract<AgentSessionStreamEvent, { event: "block:action:output" }> =>
        event.event === "block:action:output",
    );
    expect(outputEvents.map((event) => event.truncation?.omittedBytes)).toEqual([
      10 * 1024,
      70 * 1024,
    ]);

    const tracker = new StateTracker();
    const session: Session = {
      id: "size-bound-session",
      name: "size-bound-session",
      adapterType: "codex",
      status: "active",
    };
    tracker.createSession(session.id, session);
    const immutableSnapshot = JSON.stringify(events);
    for (const event of events) tracker.trackEvent(session.id, event);
    expect(JSON.stringify(events)).toBe(immutableSnapshot);

    const action = tracker.getSessionState(session.id)?.turns[0]?.blocks.find(
      (entry) => entry.block.type === "action",
    )?.block;
    expect(action?.type).toBe("action");
    if (action?.type !== "action") throw new Error("Expected an action block");
    expect(utf8ByteLength(action.action.output)).toBe(MAX_ACTION_OUTPUT_EVENT_UTF8_BYTES);
    expect(action.action.truncation).toEqual({
      omittedBytes: 80 * 1024,
      maxRetainedBytes: 64 * 1024,
      sourceRef: "block:command-large",
    });
  });

  test("bounds diagnostic text and records its omitted bytes", () => {
    const message = "x".repeat(10 * 1024);
    const events = replay([
      {
        source: "harness",
        sequence: 0,
        payload: {
          method: "turn/started",
          params: { turn: { id: "turn-error", status: "inProgress" } },
        },
      },
      {
        source: "adapter_control",
        sequence: 1,
        event: "transport_error",
        payload: { message },
      },
    ]);
    const errorStart = events.find(
      (event) => event.event === "block:start" && event.block.type === "error",
    );
    expect(errorStart?.event).toBe("block:start");
    if (errorStart?.event !== "block:start" || errorStart.block.type !== "error") {
      throw new Error("Expected an error block");
    }
    expect(utf8ByteLength(errorStart.block.message)).toBe(MAX_DIAGNOSTIC_UTF8_BYTES);
    expect(errorStart.block.truncation).toEqual({
      omittedBytes: 6 * 1024,
      maxRetainedBytes: MAX_DIAGNOSTIC_UTF8_BYTES,
      sourceRef: "turn:turn-error",
    });
  });
});
