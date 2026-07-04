import { describe, expect, test } from "bun:test";

import { buildLaneAskDisplay, laneAskHeadline, laneAskPreview } from "./lane-ask-display.ts";
import type { ObserveEvent } from "./types.ts";

function ask(text: string, overrides: Partial<ObserveEvent> = {}): ObserveEvent {
  return {
    id: "ask-1",
    t: 10,
    kind: "ask",
    text,
    ...overrides,
  };
}

describe("lane ask display", () => {
  test("uses the task after injected AGENTS instructions as the compact title", () => {
    const event = ask(`# AGENTS.md instructions for /Users/art/dev/hudson

<INSTRUCTIONS>
# Global Codex Build Hygiene

Do not put DerivedData under /tmp.
</INSTRUCTIONS>

Aida (@art) -> hudson-galileo ask/Task: bump HudsonKit/HudsonTerminal to Termin 4 GhosttyKit 0.16. delivery: waking session fresh session`);

    const model = buildLaneAskDisplay(event);

    expect(model.title).toBe("bump HudsonKit/HudsonTerminal to Termin 4 GhosttyKit 0.16. delivery: waking session fresh session");
    expect(model.preview).not.toContain("Global Codex Build Hygiene");
    expect(model.fullText).toContain("Global Codex Build Hygiene");
  });

  test("falls back to the first meaningful request line", () => {
    const event = ask(`

Please review the lane ask preview and make the full text readable.

Extra context follows here.`);

    expect(laneAskHeadline(event)).toBe("Please review the lane ask preview and make the full text readable.");
    expect(laneAskPreview(event)).toContain("Extra context follows here.");
  });

  test("records human answers with delay metadata", () => {
    const model = buildLaneAskDisplay(ask("Proceed with the migration?", {
      to: "human",
      answer: "Yes",
      answerT: 75,
    }));

    expect(model.label).toBe("Asked operator");
    expect(model.fields).toContainEqual({ label: "answer", value: "1m 5s" });
    expect(model.answer).toEqual({ label: "answered after 1m 5s", text: "Yes" });
  });

  test("prefers the explicit user request over attachments and project instructions", () => {
    const model = buildLaneAskDisplay(ask(`# AGENTS.md instructions for /Users/art/dev/openscout

<INSTRUCTIONS>
# Global Codex Build Hygiene

Do not put DerivedData under /tmp.
</INSTRUCTIONS>

# Files mentioned by the user:

## Talkie Capture.png: /Users/art/Library/Application Support/Talkie/Screenshots/Talkie Capture.png

## My request for Codex:
ask claude to come up with a much nicer user message presentation

also let's have a filter on the lanes that collapses technical events in turns (as a toggle of course)`));

    expect(model.label).toBe("User request");
    expect(model.title).toBe("ask claude to come up with a much nicer user message presentation");
    expect(model.preview).toContain("filter on the lanes");
    expect(model.preview).not.toContain("DerivedData");
    expect(model.preview).not.toContain("Talkie Capture");
  });
});
