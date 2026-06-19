import { describe, expect, test } from "bun:test";

import {
  collapseTailDisplayRows,
  filterTailEventsForDisplay,
  isTailNoiseEvent,
  observeToolFieldsFromTailEvent,
  observeToolIsEdit,
  observeToolIsRead,
  tailAttributionLabel,
  tailObserveEventDetail,
} from "./tail-display.ts";
import type { TailEvent } from "./types.ts";

function event(overrides: Partial<TailEvent> & Pick<TailEvent, "summary">): TailEvent {
  return {
    id: "evt-1",
    ts: 1_700_000_000_000,
    source: "grok",
    sessionId: "sess-1",
    pid: 1,
    parentPid: null,
    project: "openscout",
    cwd: "/tmp/openscout",
    harness: "unattributed",
    kind: "system",
    ...overrides,
  };
}

describe("isTailNoiseEvent", () => {
  test("flags grok streaming phase churn", () => {
    expect(isTailNoiseEvent(event({ summary: "phase · streaming_reasoning" }))).toBe(true);
    expect(isTailNoiseEvent(event({ summary: "phase · streaming_text" }))).toBe(true);
    expect(isTailNoiseEvent(event({ summary: "phase · tool_execution" }))).toBe(true);
  });

  test("keeps substantive grok tool lines", () => {
    expect(isTailNoiseEvent(event({ summary: "Read started", kind: "tool" }))).toBe(false);
    expect(isTailNoiseEvent(event({ summary: "permission allow · Read" }))).toBe(false);
  });
});

describe("filterTailEventsForDisplay", () => {
  test("work mode drops grok streaming noise", () => {
    const rows = filterTailEventsForDisplay([
      event({ summary: "phase · streaming_text" }),
      event({ summary: "Read started", kind: "tool" }),
    ], "work");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toBe("Read started");
  });
});

describe("observeToolFieldsFromTailEvent", () => {
  test("parses grok tool lifecycle summaries", () => {
    expect(observeToolFieldsFromTailEvent(event({ summary: "Read started", kind: "tool" }))).toEqual({
      tool: "Read",
      arg: "started",
    });
    expect(observeToolFieldsFromTailEvent(event({
      summary: "Shell completed · success",
      kind: "tool-result",
    }))).toEqual({
      tool: "Shell",
      arg: "completed",
      result: { outcome: "success" },
    });
    expect(observeToolFieldsFromTailEvent(event({
      summary: "Shell · curl -s http://127.0.0.1:5180/api/session-ref/test · success",
      kind: "tool-result",
    }))).toEqual({
      tool: "Shell",
      arg: "curl -s http://127.0.0.1:5180/api/session-ref/test",
      result: { outcome: "success" },
    });
  });

  test("parses codex-style function calls and plain summaries", () => {
    expect(observeToolFieldsFromTailEvent(event({
      source: "codex",
      summary: "Read({\"path\":\"README.md\"})",
      kind: "tool",
    }))).toEqual({
      tool: "Read",
      arg: "{\"path\":\"README.md\"}",
    });
    expect(observeToolFieldsFromTailEvent(event({
      source: "codex",
      summary: "grep foo",
      kind: "tool",
    }))).toEqual({ tool: "grep" });
  });

  test("matches observe tool kinds case-insensitively", () => {
    expect(observeToolIsRead("Read")).toBe(true);
    expect(observeToolIsEdit("Write")).toBe(true);
    expect(observeToolIsEdit("read")).toBe(false);
  });
});

describe("tailObserveEventDetail", () => {
  test("prefers workspace context over raw attribution jargon", () => {
    expect(tailObserveEventDetail(event({ summary: "phase · waiting_for_model" }))).toBe(
      "openscout · native",
    );
    expect(tailObserveEventDetail(event({
      summary: "phase · waiting_for_model",
      harness: "scout-managed",
    }))).toBe("openscout · scout");
  });

  test("falls back to source when workspace context is missing", () => {
    expect(tailObserveEventDetail(event({
      summary: "phase · waiting_for_model",
      project: "",
      cwd: "",
    }))).toBe("grok · native");
  });

  test("omits detail for tool lifecycle rows", () => {
    expect(tailObserveEventDetail(event({ summary: "Read started", kind: "tool" }))).toBeUndefined();
  });
});

describe("tailAttributionLabel", () => {
  test("maps internal attribution enums to operator-facing labels", () => {
    expect(tailAttributionLabel("unattributed")).toBe("native");
    expect(tailAttributionLabel("scout-managed")).toBe("scout");
  });
});

describe("collapseTailDisplayRows", () => {
  test("merges consecutive identical session summaries", () => {
    const collapsed = collapseTailDisplayRows([
      { event: event({ id: "a", summary: "phase · streaming_text", ts: 1 }), meta: null },
      { event: event({ id: "b", summary: "phase · streaming_text", ts: 2 }), meta: null },
      { event: event({ id: "c", summary: "Read started", kind: "tool", ts: 3 }), meta: null },
    ]);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]?.repeatCount).toBe(2);
    expect(collapsed[0]?.event.ts).toBe(2);
    expect(collapsed[1]?.repeatCount).toBe(1);
  });
});