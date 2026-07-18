import { describe, expect, test } from "bun:test";

import { stateChipColor } from "./mission-control-model.ts";

describe("stateChipColor", () => {
  test("uses the shared color for every normalized agent posture", () => {
    expect(stateChipColor("needs_attention")).toBe("var(--amber)");
    expect(stateChipColor("in_turn")).toBe("var(--green)");
    expect(stateChipColor("in_flight")).toBe("var(--accent)");
    expect(stateChipColor("blocked")).toBe("var(--dim)");
  });
});
