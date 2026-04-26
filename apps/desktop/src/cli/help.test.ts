import { describe, expect, test } from "bun:test";

import { renderScoutHelp } from "./help.ts";

describe("renderScoutHelp", () => {
  test("documents the operator loop, lifecycle, and routing model", () => {
    const help = renderScoutHelp("0.2.99");

    expect(help).toContain("Fast path:");
    expect(help).toContain("Orientation (only when route or sender is unclear):");
    expect(help).toContain("Lifecycle:");
    expect(help).toContain("one target -> DM");
    expect(help).toContain("multiple targets + no channel");
    expect(help).toContain("MCP parity:");
    expect(help).toContain("scout card create");
  });
});
