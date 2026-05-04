import { describe, expect, test } from "bun:test";

import { renderScoutActivityList, renderScoutMessagePostResult } from "./broker.ts";

describe("renderScoutMessagePostResult", () => {
  test("hides broker internals for normal sends", () => {
    expect(renderScoutMessagePostResult({
      message: "hello",
      senderId: "lattices.codex-event-tap-thread.mini",
      conversationId: "dm.operator.hudson.main.mini",
      invokedTargets: ["hudson.main.mini"],
      unresolvedTargets: [],
      routeKind: "dm",
    })).toBe("Sent.");
  });

  test("renders the local product target as Scout", () => {
    expect(renderScoutMessagePostResult({
      message: "hello",
      conversationId: "channel.shared",
      invokedTargets: ["scout"],
      unresolvedTargets: [],
      routeKind: "broadcast",
    })).toBe("Sent to Scout.");
  });

  test("renders wake flight ids when a send queued work", () => {
    expect(renderScoutMessagePostResult({
      message: "hello",
      conversationId: "dm.operator.hudson",
      flightId: "flt-1",
      invokedTargets: ["hudson.main"],
      unresolvedTargets: [],
      routeKind: "dm",
    })).toBe("Sent.\nWake flight: flt-1");
  });
});

describe("renderScoutActivityList", () => {
  test("handles empty activity", () => {
    expect(renderScoutActivityList([])).toBe("No Scout activity yet.");
  });

  test("renders recent ask activity with participants", () => {
    const rendered = renderScoutActivityList([
      {
        id: "activity:1",
        kind: "ask_opened",
        ts: 1_700_000_000,
        actorId: "operator",
        counterpartId: "vox",
        title: "Review the latest web server change",
      },
    ]);

    expect(rendered).toContain("asked");
    expect(rendered).toContain("operator -> vox");
    expect(rendered).toContain("Review the latest web server change");
  });
});
