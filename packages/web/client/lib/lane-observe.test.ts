import { describe, expect, test } from "bun:test";

import {
  filterObserveDataForHorizon,
  filterObserveEventsForHorizon,
  filesFromObserveEvents,
  laneSnippetText,
  laneTextNeedsExpand,
  laneToolArgSnippet,
} from "./lane-observe.ts";

describe("laneSnippetText", () => {
  test("clips long prose to a readable snippet", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega";
    expect(laneSnippetText(text, 40, 2).endsWith("…")).toBe(true);
    expect(laneTextNeedsExpand(text, 40, 2)).toBe(true);
  });
});

describe("filesFromObserveEvents", () => {
  test("infers read paths from shell and read tool args", () => {
    const files = filesFromObserveEvents([
      {
        id: "a",
        t: 1,
        kind: "tool",
        text: "Shell · sed -n '1,220p' packages/web/client/scout/repo-diff/DiffSurface.tsx",
        tool: "Shell",
        arg: "sed -n '1,220p' packages/web/client/scout/repo-diff/DiffSurface.tsx",
      },
      {
        id: "b",
        t: 2,
        kind: "tool",
        text: "Read · README.md",
        tool: "Read",
        arg: "{\"path\":\"README.md\"}",
      },
    ]);

    expect(files.map((file) => file.path)).toEqual([
      "README.md",
      "packages/web/client/scout/repo-diff/DiffSurface.tsx",
    ]);
    expect(files[0]?.state).toBe("read");
  });

  test("infers modified paths from patches and git diff commands", () => {
    const files = filesFromObserveEvents([
      {
        id: "patch",
        t: 4,
        kind: "tool",
        text: "Edit · patch",
        tool: "Edit",
        arg: "patch",
        detail: "*** Begin Patch\n*** Update File: packages/web/client/lib/lane-observe.ts\n@@\n-old\n+new\n*** End Patch",
      },
      {
        id: "diff",
        t: 5,
        kind: "tool",
        text: "Shell · git diff -- packages/web/client/lib/observe-display.ts",
        tool: "Shell",
        arg: "git diff -- packages/web/client/lib/observe-display.ts",
      },
    ]);

    expect(files.map((file) => [file.path, file.state])).toEqual([
      ["packages/web/client/lib/observe-display.ts", "read"],
      ["packages/web/client/lib/lane-observe.ts", "modified"],
    ]);
  });
});

describe("filterObserveEventsForHorizon", () => {
  const NOW = 1_700_000_000_000;
  const sessionStart = NOW - 60 * 60_000;

  test("keeps only events inside the selected wall-clock window", () => {
    const events = [
      { id: "old", t: 600, kind: "tool" as const, text: "old tool", tool: "Shell" },
      { id: "mid", t: 2400, kind: "tool" as const, text: "mid tool", tool: "Shell" },
      { id: "new", t: 3540, kind: "message" as const, text: "recent reply" },
    ];

    const filtered = filterObserveEventsForHorizon(
      events,
      sessionStart,
      NOW,
      30 * 60_000,
    );

    expect(filtered.map((event) => event.id)).toEqual(["mid", "new"]);
  });
});

describe("filterObserveDataForHorizon", () => {
  const NOW = 1_700_000_000_000;
  const sessionStart = NOW - 60 * 60_000;

  test("filters observe files along with events", () => {
    const filtered = filterObserveDataForHorizon({
      events: [
        { id: "old", t: 600, kind: "tool", text: "old", tool: "Shell" },
        { id: "new", t: 3540, kind: "tool", text: "new", tool: "Shell" },
      ],
      files: [
        { path: "old.ts", state: "read", touches: 1, lastT: 600 },
        { path: "new.ts", state: "modified", touches: 1, lastT: 3540 },
      ],
      live: false,
      metadata: { session: { sessionStart } },
    }, NOW, 30 * 60_000);

    expect(filtered?.events.map((event) => event.id)).toEqual(["new"]);
    expect(filtered?.files.map((file) => file.path)).toEqual(["new.ts"]);
  });
});

describe("laneToolArgSnippet", () => {
  test("shortens long shell commands for lane headers", () => {
    const snippet = laneToolArgSnippet(
      "rg -n \"Line context|selectionContextFromWindow\" packages/web/client/scout/repo-diff/DiffSurface.tsx packages/web/client/scout/repo-diff/repo-diff.css",
    );
    expect(snippet.endsWith("…")).toBe(true);
  });
});
