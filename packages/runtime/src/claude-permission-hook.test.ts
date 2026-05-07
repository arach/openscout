import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectClaudePermissionHook,
  installClaudePermissionHook,
} from "./claude-permission-hook.js";

describe("Claude permission hook", () => {
  test("installs a project PreToolUse hook backed by the Scout control plane", () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-claude-hook-"));
    try {
      const projectRoot = join(root, "project");
      const controlHome = join(root, "control");
      const env = { ...process.env, OPENSCOUT_CONTROL_HOME: controlHome };

      const installed = installClaudePermissionHook(projectRoot, env);
      expect(installed.state).toBe("installed");
      expect(installed.hookPath).toBe(join(controlHome, "bin", "claude-permission-hook.mjs"));

      const settings = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.local.json"), "utf8"));
      expect(settings.hooks.PreToolUse).toEqual([
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `node '${join(controlHome, "bin", "claude-permission-hook.mjs")}'`,
            },
          ],
        },
      ]);
      expect(readFileSync(installed.hookPath, "utf8")).toContain("permission-requests");
      expect(inspectClaudePermissionHook(projectRoot, env).state).toBe("installed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
