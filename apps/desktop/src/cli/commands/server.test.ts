import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { normalizeServerOpenPath, renderServerCommandHelp, resolveBunExecutable } from "./server.ts";

describe("server command helpers", () => {
  test("documents the open workflow", () => {
    expect(renderServerCommandHelp()).toContain("scout server open [options]");
    expect(renderServerCommandHelp()).toContain("scout server control-plane open [options]");
    expect(renderServerCommandHelp()).toContain("--public-origin URL");
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

  test("resolves bun from explicit environment overrides", () => {
    const directory = mkdtempSync(join(tmpdir(), "scout-server-bun-"));
    const bunPath = join(directory, "bun");

    try {
      writeFileSync(bunPath, "#!/bin/sh\nexit 0\n");
      chmodSync(bunPath, 0o755);

      expect(resolveBunExecutable({ OPENSCOUT_BUN_BIN: bunPath })).toBe(bunPath);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
