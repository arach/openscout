import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectClaudePermissionHook,
  installClaudePermissionHook,
  removeClaudePermissionHook,
} from "./claude-permission-hook.js";

describe("Claude permission hook", () => {
  test("reports missing when no Scout hook is installed", () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-claude-hook-"));
    try {
      const projectRoot = join(root, "project");
      const controlHome = join(root, "control");
      const env = { ...process.env, OPENSCOUT_CONTROL_HOME: controlHome };

      const status = inspectClaudePermissionHook(projectRoot, env);
      expect(status.state).toBe("missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  test("removes Scout PreToolUse hooks while preserving other Claude settings", () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-claude-hook-"));
    try {
      const projectRoot = join(root, "project");
      const controlHome = join(root, "control");
      const env = { ...process.env, OPENSCOUT_CONTROL_HOME: controlHome };
      const settingsPath = join(projectRoot, ".claude", "settings.local.json");
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify({
        permissions: {
          allow: ["Read(**)"],
        },
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node './other-hook.mjs'",
                },
              ],
            },
          ],
        },
      }, null, 2));

      installClaudePermissionHook(projectRoot, env);
      const removed = removeClaudePermissionHook(projectRoot, env);
      expect(removed.state).toBe("missing");

      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.permissions.allow).toEqual(["Read(**)"]);
      expect(settings.hooks.PreToolUse).toEqual([
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "node './other-hook.mjs'",
            },
          ],
        },
      ]);
      expect(inspectClaudePermissionHook(projectRoot, env).state).toBe("missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
