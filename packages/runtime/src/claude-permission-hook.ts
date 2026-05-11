import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type ClaudePermissionHookStatus = {
  state: "installed" | "stale" | "missing" | "unavailable";
  settingsPath: string;
  hookPath: string;
  command: string;
  detail: string;
};

const HOOK_FILENAME = "claude-permission-hook.mjs";

const HOOK_SCRIPT = String.raw`#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, randomUUID } from "node:crypto";

const CONTROL_HOME = process.env.OPENSCOUT_CONTROL_HOME
  || join(homedir(), ".openscout", "control-plane");
const REQUEST_DIR = join(CONTROL_HOME, "permission-requests");
const TIMEOUT_MS = Math.max(1000, Number(process.env.OPENSCOUT_PERMISSION_HOOK_TIMEOUT_MS || 45000));
const POLL_MS = Math.max(100, Number(process.env.OPENSCOUT_PERMISSION_HOOK_POLL_MS || 350));

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", reject);
  });
}

function stableRequestId(input) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    session_id: input.session_id ?? "",
    transcript_path: input.transcript_path ?? "",
    cwd: input.cwd ?? "",
    tool_name: input.tool_name ?? "",
    tool_input: input.tool_input ?? null,
  }));
  return "claude:" + hash.digest("hex").slice(0, 24);
}

function writeJsonAtomic(path, value) {
  mkdirSync(REQUEST_DIR, { recursive: true });
  const temp = path + "." + process.pid + "." + randomUUID() + ".tmp";
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(temp, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function emitPermission(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
    suppressOutput: true,
  }) + "\n");
}

function toolSummary(input) {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  if (typeof toolInput.command === "string") return toolInput.command;
  if (typeof toolInput.file_path === "string") return toolInput.file_path;
  if (typeof toolInput.path === "string") return toolInput.path;
  if (typeof toolInput.description === "string") return toolInput.description;
  return null;
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw || "{}");
  if (input.hook_event_name !== "PreToolUse" || typeof input.tool_name !== "string") {
    return;
  }

  const id = stableRequestId(input);
  const path = join(REQUEST_DIR, encodeURIComponent(id) + ".json");
  const now = Date.now();
  const existing = existsSync(path) ? readJson(path) : null;
  const request = {
    ...(existing && typeof existing === "object" ? existing : {}),
    id,
    source: "claude-code",
    status: existing?.decision ? "decided" : "pending",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    expiresAt: now + TIMEOUT_MS,
    sessionId: input.session_id ?? null,
    transcriptPath: input.transcript_path ?? null,
    cwd: input.cwd ?? process.cwd(),
    hookEventName: input.hook_event_name,
    toolName: input.tool_name,
    toolInput: input.tool_input ?? null,
    summary: toolSummary(input),
    raw: input,
  };
  writeJsonAtomic(path, request);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (!existsSync(path)) continue;
    const latest = readJson(path);
    const decision = latest?.decision;
    if (decision === "allow" || decision === "deny") {
      const reason = typeof latest.reason === "string" && latest.reason.trim()
        ? latest.reason.trim()
        : "Scout operator " + decision + "ed " + input.tool_name;
      emitPermission(decision, reason);
      return;
    }
  }

  const latest = existsSync(path) ? readJson(path) : request;
  writeJsonAtomic(path, {
    ...latest,
    status: "expired",
    updatedAt: Date.now(),
  });
  emitPermission("ask", "Scout did not receive a remote decision in time.");
}

main().catch((error) => {
  process.stderr.write("[openscout claude permission hook] " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exit(1);
});
`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function controlHomeDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENSCOUT_CONTROL_HOME || join(homedir(), ".openscout", "control-plane");
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

export function resolveClaudePermissionHookCommand(
  currentDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  hookPath: string;
  command: string;
} {
  const hookPath = env.OPENSCOUT_CLAUDE_PERMISSION_HOOK?.trim()
    || join(controlHomeDirectory(env), "bin", HOOK_FILENAME);
  return {
    hookPath,
    command: `node ${shellQuote(hookPath)}`,
  };
}

export function ensureClaudePermissionHookExecutable(
  currentDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const { hookPath } = resolveClaudePermissionHookCommand(currentDirectory, env);
  if (env.OPENSCOUT_CLAUDE_PERMISSION_HOOK?.trim()) {
    return existsSync(hookPath) ? hookPath : null;
  }
  mkdirSync(dirname(hookPath), { recursive: true });
  writeFileSync(hookPath, `${HOOK_SCRIPT}\n`, "utf8");
  chmodSync(hookPath, 0o755);
  return hookPath;
}

export function inspectClaudePermissionHook(
  currentDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): ClaudePermissionHookStatus {
  const settingsPath = join(resolve(currentDirectory), ".claude", "settings.local.json");
  const { hookPath, command } = resolveClaudePermissionHookCommand(currentDirectory, env);

  const settings = readJsonObject(settingsPath);
  const status = hasScoutHook(settings, command);
  if (status === "none") {
    return {
      state: "missing",
      settingsPath,
      hookPath,
      command,
      detail: "Scout Claude permission hook is not installed for this project.",
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
  if (!existsSync(hookPath)) {
    return {
      state: "unavailable",
      settingsPath,
      hookPath,
      command,
      detail: `Hook executable not found at ${hookPath}.`,
    };
  }

  return {
    state: "installed",
    settingsPath,
    hookPath,
    command,
    detail: "Scout Claude permission hook is installed.",
  };
}

export function installClaudePermissionHook(
  currentDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): ClaudePermissionHookStatus {
  const settingsPath = join(resolve(currentDirectory), ".claude", "settings.local.json");
  const { command } = resolveClaudePermissionHookCommand(currentDirectory, env);
  const hookPath = ensureClaudePermissionHookExecutable(currentDirectory, env);
  if (!hookPath) {
    return inspectClaudePermissionHook(currentDirectory, env);
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
  return inspectClaudePermissionHook(currentDirectory, env);
}

export function removeClaudePermissionHook(
  currentDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): ClaudePermissionHookStatus {
  const settingsPath = join(resolve(currentDirectory), ".claude", "settings.local.json");
  if (!existsSync(settingsPath)) {
    return inspectClaudePermissionHook(currentDirectory, env);
  }

  const settings = readJsonObject(settingsPath);
  const hooks = settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
    ? settings.hooks as Record<string, unknown>
    : null;
  if (!hooks) {
    return inspectClaudePermissionHook(currentDirectory, env);
  }

  let removedScoutHook = false;
  const existingPreToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const nextPreToolUse = existingPreToolUse
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return entry;
      }
      const record = entry as Record<string, unknown>;
      const entryHooks = Array.isArray(record.hooks) ? record.hooks : [];
      const nextEntryHooks = entryHooks.filter((hook) => !commandFromHook(hook)?.includes(HOOK_FILENAME));
      if (nextEntryHooks.length !== entryHooks.length) {
        removedScoutHook = true;
      }
      return {
        ...record,
        hooks: nextEntryHooks,
      };
    })
    .filter((entry) =>
      !(entry && typeof entry === "object" && !Array.isArray(entry) && Array.isArray((entry as Record<string, unknown>).hooks) && ((entry as Record<string, unknown>).hooks as unknown[]).length === 0));

  if (!removedScoutHook) {
    return inspectClaudePermissionHook(currentDirectory, env);
  }

  const nextHooks = { ...hooks };
  if (nextPreToolUse.length > 0) {
    nextHooks.PreToolUse = nextPreToolUse;
  } else {
    delete nextHooks.PreToolUse;
  }

  const nextSettings = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }

  writeFileSync(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
  return inspectClaudePermissionHook(currentDirectory, env);
}
