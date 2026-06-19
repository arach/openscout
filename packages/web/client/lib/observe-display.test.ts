import { describe, expect, test } from "bun:test";

import type { ObserveEvent } from "./types.ts";
import { collapseObserveDisplayRows, observeEventSignature } from "./observe-display.ts";

function observe(overrides: Partial<ObserveEvent> & Pick<ObserveEvent, "id">): ObserveEvent {
  return {
    t: 0,
    kind: "system",
    text: "",
    ...overrides,
  };
}

describe("collapseObserveDisplayRows", () => {
  test("merges consecutive think runs into the latest reasoning snippet", () => {
    const rows = collapseObserveDisplayRows([
      observe({ id: "a", t: 1, kind: "think", text: "First pass on the lane trace." }),
      observe({ id: "b", t: 2, kind: "think", text: "Need to collapse reasoning before expanding tools." }),
      observe({ id: "c", t: 3, kind: "tool", tool: "Read", arg: "README.md", text: "Read · README.md" }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.repeatCount).toBe(2);
    expect(rows[0]?.event.text).toContain("Need to collapse reasoning");
    expect(rows[0]?.event.text).toContain("(2 reasoning updates)");
  });

  test("collapses repeated identical shell commands", () => {
    const rows = collapseObserveDisplayRows([
      observe({ id: "a", t: 1, kind: "tool", tool: "Shell", arg: "rg LaneFacts packages/web", text: "Shell · rg LaneFacts packages/web" }),
      observe({ id: "b", t: 2, kind: "tool", tool: "Shell", arg: "rg LaneFacts packages/web", text: "Shell · rg LaneFacts packages/web" }),
      observe({ id: "c", t: 3, kind: "message", text: "done" }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.repeatCount).toBe(2);
    expect(rows[0]?.event.id).toBe("b");
  });

  test("merges grok tool started/completed pairs", () => {
    const rows = collapseObserveDisplayRows([
      observe({ id: "a", t: 1, kind: "tool", tool: "Read", arg: "started", text: "Read started" }),
      observe({
        id: "b",
        t: 2,
        kind: "tool",
        tool: "Read",
        arg: "completed",
        text: "Read completed · success",
        result: { outcome: "success" },
      }),
      observe({ id: "c", t: 3, kind: "tool", tool: "Shell", arg: "started", text: "Shell started" }),
      observe({
        id: "d",
        t: 4,
        kind: "tool",
        tool: "Shell",
        arg: "completed",
        text: "Shell completed · success",
        result: { outcome: "success" },
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.event.tool).toBe("Read");
    expect(rows[0]?.event.arg).toBe("completed");
    expect(rows[1]?.event.tool).toBe("Shell");
  });

  test("preserves shell commands when merging grok lifecycle pairs", () => {
    const rows = collapseObserveDisplayRows([
      observe({
        id: "a",
        t: 1,
        kind: "tool",
        tool: "Shell",
        arg: "curl -s http://127.0.0.1:5180/api/session-ref/test",
        text: "Shell · curl -s http://127.0.0.1:5180/api/session-ref/test",
      }),
      observe({
        id: "b",
        t: 2,
        kind: "tool",
        tool: "Shell",
        arg: "curl -s http://127.0.0.1:5180/api/session-ref/test",
        text: "Shell · curl -s http://127.0.0.1:5180/api/session-ref/test · success",
        result: { outcome: "success" },
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.event.arg).toBe("curl -s http://127.0.0.1:5180/api/session-ref/test");
    expect(rows[0]?.event.result).toEqual({ outcome: "success" });
  });

  test("collapses consecutive identical notes and permissions", () => {
    const rows = collapseObserveDisplayRows([
      observe({ id: "a", t: 1, kind: "note", text: "[turn_ended]" }),
      observe({ id: "b", t: 2, kind: "note", text: "[turn_ended]" }),
      observe({ id: "c", t: 3, kind: "system", text: "permission allow · Read" }),
      observe({ id: "d", t: 4, kind: "system", text: "permission allow · Read" }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.repeatCount).toBe(2);
    expect(rows[1]?.repeatCount).toBe(2);
  });

  test("does not merge different tools or non-adjacent lifecycle pairs", () => {
    const rows = collapseObserveDisplayRows([
      observe({ id: "a", t: 1, kind: "tool", tool: "Read", arg: "started", text: "Read started" }),
      observe({ id: "b", t: 2, kind: "tool", tool: "Shell", arg: "completed", text: "Shell completed · success" }),
      observe({ id: "c", t: 3, kind: "system", text: "turn 24 · grok" }),
      observe({ id: "d", t: 4, kind: "system", text: "turn 25 · grok" }),
    ]);

    expect(rows).toHaveLength(4);
    expect(observeEventSignature(rows[2]!.event)).not.toBe(observeEventSignature(rows[3]!.event));
  });

  test("merges permission requested/resolved pairs for the same tool", () => {
    const rows = collapseObserveDisplayRows([
      observe({ id: "a", t: 1, kind: "system", text: "permission requested · Read" }),
      observe({ id: "b", t: 2, kind: "system", text: "permission allow · Read" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.event.text).toBe("permission allow · Read");
  });

  test("collapses repeated merged tool pairs", () => {
    const rows = collapseObserveDisplayRows([
      observe({ id: "a1", t: 1, kind: "tool", tool: "Read", arg: "started", text: "Read started" }),
      observe({
        id: "a2",
        t: 2,
        kind: "tool",
        tool: "Read",
        arg: "completed",
        text: "Read completed · success",
        result: { outcome: "success" },
      }),
      observe({ id: "b1", t: 3, kind: "tool", tool: "Read", arg: "started", text: "Read started" }),
      observe({
        id: "b2",
        t: 4,
        kind: "tool",
        tool: "Read",
        arg: "completed",
        text: "Read completed · success",
        result: { outcome: "success" },
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.repeatCount).toBe(2);
    expect(rows[0]?.event.id).toBe("b2");
  });
});
