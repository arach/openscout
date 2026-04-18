import { describe, expect, test } from "bun:test";

import { renderScoutActivityList } from "./broker.ts";

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
