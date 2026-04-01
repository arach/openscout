import { describe, expect, test } from "bun:test";
import { OutboundBuffer, type SequencedEvent } from "./buffer.ts";
import type { DispatchEvent } from "../protocol/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal DispatchEvent for testing. */
function fakeEvent(label: string): DispatchEvent {
  return {
    event: "session:update",
    session: {
      id: label,
      name: label,
      adapterType: "test",
      status: "active",
    },
  };
}

/** Shortcut: push N events into a buffer, returning assigned seqs. */
function pushN(buf: OutboundBuffer, n: number): number[] {
  const seqs: number[] = [];
  for (let i = 1; i <= n; i++) {
    seqs.push(buf.push(fakeEvent(`e${i}`)));
  }
  return seqs;
}

// ---------------------------------------------------------------------------
// Basic push & retrieve
// ---------------------------------------------------------------------------

describe("OutboundBuffer", () => {
  test("push returns monotonically increasing sequence numbers starting at 1", () => {
    const buf = new OutboundBuffer();
    expect(buf.push(fakeEvent("a"))).toBe(1);
    expect(buf.push(fakeEvent("b"))).toBe(2);
    expect(buf.push(fakeEvent("c"))).toBe(3);
  });

  test("currentSeq reflects the last assigned seq", () => {
    const buf = new OutboundBuffer();
    expect(buf.currentSeq()).toBe(0);
    buf.push(fakeEvent("a"));
    expect(buf.currentSeq()).toBe(1);
    pushN(buf, 10);
    expect(buf.currentSeq()).toBe(11);
  });

  test("oldestSeq is 0 when empty, then tracks the oldest buffered event", () => {
    const buf = new OutboundBuffer(5);
    expect(buf.oldestSeq()).toBe(0);
    buf.push(fakeEvent("a"));
    expect(buf.oldestSeq()).toBe(1);
    pushN(buf, 4); // seqs 2..5, buffer now full at capacity 5
    expect(buf.oldestSeq()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Replay
  // -------------------------------------------------------------------------

  test("replay(0) returns all buffered events", () => {
    const buf = new OutboundBuffer();
    pushN(buf, 3);
    const result = buf.replay(0);
    expect(result.length).toBe(3);
    expect(result.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  test("replay(afterSeq) returns only events with seq > afterSeq", () => {
    const buf = new OutboundBuffer();
    pushN(buf, 5);
    const result = buf.replay(3);
    expect(result.length).toBe(2);
    expect(result.map((e) => e.seq)).toEqual([4, 5]);
  });

  test("replay with afterSeq = currentSeq returns empty", () => {
    const buf = new OutboundBuffer();
    pushN(buf, 5);
    expect(buf.replay(5)).toEqual([]);
  });

  test("replay with afterSeq > currentSeq returns empty", () => {
    const buf = new OutboundBuffer();
    pushN(buf, 3);
    expect(buf.replay(100)).toEqual([]);
  });

  test("replay on empty buffer returns empty", () => {
    const buf = new OutboundBuffer();
    expect(buf.replay(0)).toEqual([]);
    expect(buf.replay(5)).toEqual([]);
  });

  test("replay returns events in correct sequence order", () => {
    const buf = new OutboundBuffer();
    pushN(buf, 10);
    const result = buf.replay(0);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.seq).toBeGreaterThan(result[i - 1]!.seq);
    }
  });

  test("replay preserves original event payloads", () => {
    const buf = new OutboundBuffer();
    const event = fakeEvent("preserved");
    buf.push(event);
    const result = buf.replay(0);
    expect(result.length).toBe(1);
    expect(result[0]!.event).toEqual(event);
  });

  test("replay includes timestamps", () => {
    const buf = new OutboundBuffer();
    const before = Date.now();
    buf.push(fakeEvent("a"));
    const after = Date.now();
    const result = buf.replay(0);
    expect(result[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(result[0]!.timestamp).toBeLessThanOrEqual(after);
  });

  // -------------------------------------------------------------------------
  // Ring buffer overflow / eviction
  // -------------------------------------------------------------------------

  test("evicts oldest events when capacity is exceeded", () => {
    const buf = new OutboundBuffer(3);
    pushN(buf, 5); // seqs 1..5, only 3..5 should remain
    expect(buf.oldestSeq()).toBe(3);
    expect(buf.currentSeq()).toBe(5);
    const result = buf.replay(0);
    expect(result.length).toBe(3);
    expect(result.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  test("replay with afterSeq older than oldest returns all available", () => {
    const buf = new OutboundBuffer(3);
    pushN(buf, 10); // seqs 1..10, only 8..10 remain
    const result = buf.replay(2); // 2 is long gone
    expect(result.length).toBe(3);
    expect(result.map((e) => e.seq)).toEqual([8, 9, 10]);
  });

  test("replay with afterSeq exactly at oldest minus one returns all available", () => {
    const buf = new OutboundBuffer(5);
    pushN(buf, 10); // seqs 1..10, only 6..10 remain
    const result = buf.replay(5); // 5 is exactly oldest - 1
    expect(result.length).toBe(5);
    expect(result.map((e) => e.seq)).toEqual([6, 7, 8, 9, 10]);
  });

  test("replay with afterSeq within buffered range returns correct subset", () => {
    const buf = new OutboundBuffer(5);
    pushN(buf, 10); // seqs 6..10 remain
    const result = buf.replay(8);
    expect(result.length).toBe(2);
    expect(result.map((e) => e.seq)).toEqual([9, 10]);
  });

  test("capacity=1 only stores the latest event", () => {
    const buf = new OutboundBuffer(1);
    pushN(buf, 5);
    expect(buf.oldestSeq()).toBe(5);
    expect(buf.currentSeq()).toBe(5);
    const result = buf.replay(0);
    expect(result.length).toBe(1);
    expect(result[0]!.seq).toBe(5);
  });

  test("wraps around ring correctly with exact multiples of capacity", () => {
    const cap = 4;
    const buf = new OutboundBuffer(cap);

    // Fill exactly 3 full rotations (12 events).
    pushN(buf, 12);

    // Only the last 4 should remain: 9, 10, 11, 12
    expect(buf.oldestSeq()).toBe(9);
    expect(buf.currentSeq()).toBe(12);
    const result = buf.replay(0);
    expect(result.map((e) => e.seq)).toEqual([9, 10, 11, 12]);
  });

  // -------------------------------------------------------------------------
  // Sequence number monotonicity
  // -------------------------------------------------------------------------

  test("sequence numbers are strictly monotonic across many pushes", () => {
    const buf = new OutboundBuffer(10);
    let prev = 0;
    for (let i = 0; i < 100; i++) {
      const seq = buf.push(fakeEvent(`e${i}`));
      expect(seq).toBe(prev + 1);
      prev = seq;
    }
  });

  test("sequence numbers do not reset after clear", () => {
    const buf = new OutboundBuffer(10);
    pushN(buf, 5);
    expect(buf.currentSeq()).toBe(5);
    buf.clear();
    expect(buf.currentSeq()).toBe(5);
    expect(buf.oldestSeq()).toBe(0);
    // New pushes continue from 6.
    expect(buf.push(fakeEvent("after-clear"))).toBe(6);
  });

  // -------------------------------------------------------------------------
  // Clear
  // -------------------------------------------------------------------------

  test("clear empties the buffer", () => {
    const buf = new OutboundBuffer();
    pushN(buf, 10);
    buf.clear();
    expect(buf.oldestSeq()).toBe(0);
    expect(buf.replay(0)).toEqual([]);
  });

  test("clear does not reset sequence counter", () => {
    const buf = new OutboundBuffer();
    pushN(buf, 10);
    buf.clear();
    expect(buf.currentSeq()).toBe(10);
  });

  test("buffer is fully usable after clear", () => {
    const buf = new OutboundBuffer(5);
    pushN(buf, 5);
    buf.clear();
    pushN(buf, 3); // seqs 6, 7, 8
    const result = buf.replay(0);
    expect(result.length).toBe(3);
    expect(result.map((e) => e.seq)).toEqual([6, 7, 8]);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  test("constructor rejects capacity < 1", () => {
    expect(() => new OutboundBuffer(0)).toThrow();
    expect(() => new OutboundBuffer(-1)).toThrow();
  });

  test("default capacity is 500", () => {
    const buf = new OutboundBuffer();
    pushN(buf, 600);
    // Only the last 500 should remain.
    expect(buf.oldestSeq()).toBe(101);
    expect(buf.currentSeq()).toBe(600);
    const result = buf.replay(0);
    expect(result.length).toBe(500);
  });

  test("replay(afterSeq) where afterSeq equals oldest - 1 returns everything", () => {
    const buf = new OutboundBuffer(5);
    pushN(buf, 8); // seqs 4..8 remain
    const result = buf.replay(3); // 3 = oldest(4) - 1
    expect(result.length).toBe(5);
    expect(result.map((e) => e.seq)).toEqual([4, 5, 6, 7, 8]);
  });

  test("replay(afterSeq) where afterSeq equals oldest returns all except oldest", () => {
    const buf = new OutboundBuffer(5);
    pushN(buf, 8); // seqs 4..8 remain
    const result = buf.replay(4); // afterSeq == oldest
    expect(result.length).toBe(4);
    expect(result.map((e) => e.seq)).toEqual([5, 6, 7, 8]);
  });

  test("handles various DispatchEvent types", () => {
    const buf = new OutboundBuffer();

    // Session event.
    buf.push({ event: "session:closed", sessionId: "s1" });

    // Turn event.
    buf.push({
      event: "turn:start",
      sessionId: "s1",
      turn: {
        id: "t1",
        sessionId: "s1",
        status: "started",
        startedAt: new Date().toISOString(),
        blocks: [],
      },
    });

    // Delta event.
    buf.push({
      event: "block:delta",
      sessionId: "s1",
      turnId: "t1",
      blockId: "b1",
      text: "hello",
    });

    const result = buf.replay(0);
    expect(result.length).toBe(3);
    expect(result[0]!.event.event).toBe("session:closed");
    expect(result[1]!.event.event).toBe("turn:start");
    expect(result[2]!.event.event).toBe("block:delta");
  });

  // -------------------------------------------------------------------------
  // Stress / larger scale
  // -------------------------------------------------------------------------

  test("handles rapid push/replay cycles correctly", () => {
    const buf = new OutboundBuffer(50);

    for (let round = 0; round < 10; round++) {
      pushN(buf, 20);
      const result = buf.replay(buf.currentSeq() - 10);
      expect(result.length).toBe(10);
      // Verify the last 10 events are sequential.
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.seq).toBe(result[i - 1]!.seq + 1);
      }
    }
  });

  test("replay returns consistent results across overlapping ranges", () => {
    const buf = new OutboundBuffer(100);
    pushN(buf, 100);

    const all = buf.replay(0);
    const half = buf.replay(50);
    const last10 = buf.replay(90);

    expect(all.length).toBe(100);
    expect(half.length).toBe(50);
    expect(last10.length).toBe(10);

    // The latter half of `all` should match `half`.
    expect(all.slice(50).map((e) => e.seq)).toEqual(half.map((e) => e.seq));
    // The last 10 of `all` should match `last10`.
    expect(all.slice(90).map((e) => e.seq)).toEqual(last10.map((e) => e.seq));
  });
});
