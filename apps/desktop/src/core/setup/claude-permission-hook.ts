import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ClaudePermissionHookStatus = {
  state: "installed" | "stale" | "missing" | "unavailable";
  settingsPath: string;
  hookPath: string;
  command: string;
  detail: string;
};

const HOOK_FILENAME = "claude-permission-hook.mjs";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function findRepoRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages", "web", "bin", HOOK_FILENAME))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(start);
    }
    current = parent;
  }
}

export function resolveClaudePermissionHookCommand(currentDirectory: string): {
  hookPath: string;
  command: string;
} {
  const hookPath = process.env.OPENSCOUT_CLAUDE_PERMISSION_HOOK?.trim()
    || join(findRepoRoot(currentDirectory), "packages", "web", "bin", HOOK_FILENAME);
  return {
    hookPath,
    command: `node ${shellQuote(hookPath)}`,
  };
}

function preToolUseEntries(settings: Record<string, unknown>): unknown[] {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return [];
  }
  const preToolUse = (hooks as Record<string, unknown>).PreToolUse;
  return Array.isArray(preToolUse) ? preToolUse : [];
}

function commandFromHook(hook: unknown): string | null {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
    return null;
  }
  const command = (hook as Record<string, unknown>).command;
  return typeof command === "string" ? command : null;
}

function hasScoutHook(settings: Record<string, unknown>, command: string): "exact" | "stale" | "none" {
  let foundStale = false;
  for (const entry of preToolUseEntries(settings)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const hooks = (entry as Record<string, unknown>).hooks;
    if (!Array.isArray(hooks)) {
      continue;
    }
    for (const hook of hooks) {
      const hookCommand = commandFromHook(hook);
      if (hookCommand === command) {
        return "exact";
      }
      if (hookCommand?.includes(HOOK_FILENAME)) {
        foundStale = true;
      }
    }
  }
  return foundStale ? "stale" : "none";
}

export function inspectClaudePermissionHook(currentDirectory: string): ClaudePermissionHookStatus {
  const settingsPath = join(resolve(currentDirectory), ".claude", "settings.local.json");
  const { hookPath, command } = resolveClaudePermissionHookCommand(currentDirectory);
  if (!existsSync(hookPath)) {
    return {
      state: "unavailable",
      settingsPath,
      hookPath,
      command,
      detail: `Hook executable not found at ${hookPath}.`,
    };
  }

  const settings = readJsonObject(settingsPath);
  const status = hasScoutHook(settings, command);
  if (status === "exact") {
    return {
      state: "installed",
      settingsPath,
      hookPath,
      command,
      detail: "Scout Claude permission hook is installed.",
    };
  }
  if (status === "stale") {
    return {
      state: "stale",
      settingsPath,
      hookPath,
      command,
      detail: "Scout Claude permission hook is present but points at an older command.",
    };
  }
  return {
    state: "missing",
    settingsPath,
    hookPath,
    command,
    detail: "Scout Claude permission hook is not installed for this project.",
  };
}

export function installClaudePermissionHook(currentDirectory: string): ClaudePermissionHookStatus {
  const settingsPath = join(resolve(currentDirectory), ".claude", "settings.local.json");
  const { hookPath, command } = resolveClaudePermissionHookCommand(currentDirectory);
  if (!existsSync(hookPath)) {
    return inspectClaudePermissionHook(currentDirectory);
  }

  const settings = readJsonObject(settingsPath);
  const hooks = settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
    ? settings.hooks as Record<string, unknown>
    : {};
  const existingPreToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const nextPreToolUse = existingPreToolUse
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return entry;
      }
      const record = entry as Record<string, unknown>;
      const entryHooks = Array.isArray(record.hooks) ? record.hooks : [];
      return {
        ...record,
        hooks: entryHooks.filter((hook) => !commandFromHook(hook)?.includes(HOOK_FILENAME)),
      };
    })
    .filter((entry) =>
      !(entry && typeof entry === "object" && !Array.isArray(entry) && Array.isArray((entry as Record<string, unknown>).hooks) && ((entry as Record<string, unknown>).hooks as unknown[]).length === 0));

  nextPreToolUse.push({
    matcher: "*",
    hooks: [
      {
        type: "command",
        command,
      },
    ],
  });

  const nextSettings = {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: nextPreToolUse,
    },
  };

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
  return inspectClaudePermissionHook(currentDirectory);
}
