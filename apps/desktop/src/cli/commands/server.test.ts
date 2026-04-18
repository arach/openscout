import { describe, expect, test } from "bun:test";

import { normalizeServerOpenPath, renderServerCommandHelp } from "./server.ts";

describe("server command helpers", () => {
  test("documents the open workflow", () => {
    expect(renderServerCommandHelp()).toContain("scout server open [options]");
    expect(renderServerCommandHelp()).toContain("scout server control-plane open [options]");
  });

  test("normalizes relative browser paths", () => {
    expect(normalizeServerOpenPath("agents/arc")).toBe("/agents/arc");
    expect(normalizeServerOpenPath("/agents/arc")).toBe("/agents/arc");
    expect(normalizeServerOpenPath("")).toBe("/");
  });

  test("rejects absolute URLs for browser paths", () => {
    expect(() => normalizeServerOpenPath("https://local.openscout.app")).toThrow(
      "--path must be a local path, not an absolute URL",
    );
  });
});
