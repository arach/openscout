import { describe, expect, test } from "bun:test";
import { qualifiedAgentHandle } from "./agent-labels.ts";

describe("agent labels", () => {
  test("qualifies project handles when the visible agent name carries a suffix", () => {
    expect(
      qualifiedAgentHandle({
        name: "openscout-pauli",
        handle: "openscout",
      }),
    ).toBe("openscout-pauli");
    expect(
      qualifiedAgentHandle({
        name: "OpenScout Pauli",
        handle: "@openscout",
      }),
    ).toBe("openscout-pauli");
  });

  test("keeps already-specific handles unchanged", () => {
    expect(
      qualifiedAgentHandle({
        name: "Hudson",
        handle: "hudson",
      }),
    ).toBe("hudson");
  });
});
