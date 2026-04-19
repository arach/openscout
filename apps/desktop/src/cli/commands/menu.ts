import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { ScoutCliError } from "../errors.ts";

export type ScoutMenuAction = "launch" | "restart" | "quit" | "status" | "build" | "dmg";

type ScoutMenuCommand = {
  action: ScoutMenuAction;
  passthroughArgs: string[];
};

type ScoutMenuResult = {
  action: ScoutMenuAction;
  mode: "repo-helper" | "installed-app";
  bundleId: string;
  bundlePath: string | null;
  helperPath: string | null;
  installed: boolean;
  running: boolean;
  message: string;
};

const MENU_BUNDLE_ID = "com.openscout.menu";
const MENU_BUNDLE_NAME = "OpenScoutMenu.app";
const MENU_PROCESS_NAME = "OpenScoutMenu";
const HELP_FLAGS = new Set(["help", "--help", "-h"]);
const COMMON_MENU_BUNDLE_PATHS = [
  join("/Applications", MENU_BUNDLE_NAME),
  join(homedir(), "Applications", MENU_BUNDLE_NAME),
] as const;

export function renderMenuCommandHelp(): string {
  return [
    "scout menu — macOS menu bar app",
    "",
    "Usage:",
    "  scout menu",
    "  scout menu launch",
    "  scout menu status",
    "  scout menu restart",
    "  scout menu quit",
    "  scout menu build",
    "  scout menu dmg",
    "",
    "Aliases:",
    "  launch = open = start",
    "  quit   = stop",
    "",
    "Behavior:",
    "  On macOS, `scout menu` launches the installed OpenScout menu app when available.",
    "  When run inside an OpenScout repo checkout, it prefers `apps/macos/bin/openscout-menu.ts`",
    "  so launch/build/restart reuse the repo helper and auto-build the app bundle if needed.",
    "",
    "Examples:",
    "  scout menu",
    "  scout menu status",
    "  scout menu restart",
    "  scout menu build --version 0.2.16",
  ].join("\n");
}

export function parseMenuCommand(args: string[]): ScoutMenuCommand {
  const [first, ...rest] = args;
  if (!first) {
    return { action: "launch", passthroughArgs: [] };
  }

  if (first.startsWith("-")) {
    return { action: "launch", passthroughArgs: args };
  }

  switch (first) {
    case "launch":
    case "open":
    case "start":
      return { action: "launch", passthroughArgs: rest };
    case "restart":
      return { action: "restart", passthroughArgs: rest };
    case "quit":
    case "stop":
      return { action: "quit", passthroughArgs: rest };
    case "status":
      return { action: "status", passthroughArgs: rest };
    case "build":
      return { action: "build", passthroughArgs: rest };
    case "dmg":
      return { action: "dmg", passthroughArgs: rest };
    default:
      throw new ScoutCliError(`unknown subcommand: ${first} (try: scout menu)`);
  }
}

function runProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    allowFailure?: boolean;
  },
): {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
  });

  if (result.error) {
    throw new ScoutCliError(`failed to run ${command}: ${result.error.message}`);
  }

  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const ok = (result.status ?? 1) === 0;
  if (!ok && !options.allowFailure) {
    const detail = stderr || stdout || `${command} ${args.join(" ")} failed`;
    throw new ScoutCliError(detail);
  }

  return {
    ok,
    stdout,
    stderr,
    status: result.status,
  };
}

function findRepoMenuHelper(startDirectory: string): string | null {
  let current = resolve(startDirectory);

  while (true) {
    const candidate = join(current, "apps", "macos", "bin", "openscout-menu.ts");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  const sourceRelativeCandidate = fileURLToPath(new URL("../../../../macos/bin/openscout-menu.ts", import.meta.url));
  return existsSync(sourceRelativeCandidate) ? sourceRelativeCandidate : null;
}

function resolveRepoBundlePath(helperPath: string): string {
  return resolve(dirname(helperPath), "..", "dist", MENU_BUNDLE_NAME);
}

function isMenuRunning(env: NodeJS.ProcessEnv): boolean {
  return runProcess("pgrep", ["-x", MENU_PROCESS_NAME], { env, allowFailure: true }).ok;
}

function stopRunningMenu(env: NodeJS.ProcessEnv): boolean {
  return runProcess("pkill", ["-x", MENU_PROCESS_NAME], { env, allowFailure: true }).ok;
}

function resolveInstalledMenuBundlePath(env: NodeJS.ProcessEnv): string | null {
  const spotlight = runProcess(
    "mdfind",
    [`kMDItemCFBundleIdentifier == '${MENU_BUNDLE_ID}'`],
    { env, allowFailure: true },
  );
  const indexedPath = spotlight.stdout
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (indexedPath) {
    return indexedPath;
  }

  for (const candidate of COMMON_MENU_BUNDLE_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function openInstalledMenuApp(bundlePath: string | null, env: NodeJS.ProcessEnv): void {
  const bundleAttempts: Array<{ command: string; args: string[] }> = [
    { command: "open", args: ["-b", MENU_BUNDLE_ID] },
  ];
  if (bundlePath) {
    bundleAttempts.push({ command: "open", args: [bundlePath] });
  }

  let lastFailure = "OpenScout Menu is not installed.";
  for (const attempt of bundleAttempts) {
    const result = runProcess(attempt.command, attempt.args, { env, allowFailure: true });
    if (result.ok) {
      return;
    }
    lastFailure = result.stderr || result.stdout || lastFailure;
  }

  throw new ScoutCliError(
    `${lastFailure} Run this command from the OpenScout repo to auto-build the menu app, or install the app first.`,
  );
}

function renderMenuResult(result: ScoutMenuResult): string {
  if (result.action === "status") {
    const lines = [
      `Installed: ${result.installed ? "yes" : "no"}`,
      `Running: ${result.running ? "yes" : "no"}`,
    ];
    if (result.bundlePath) {
      lines.splice(1, 0, `Bundle: ${result.bundlePath}`);
    }
    if (result.helperPath) {
      lines.push(`Helper: ${result.helperPath}`);
    }
    return lines.join("\n");
  }

  const lines = [result.message];
  if (result.bundlePath) {
    lines.push(`Bundle: ${result.bundlePath}`);
  }
  return lines.join("\n");
}

function renderActionMessage(action: ScoutMenuAction): string {
  switch (action) {
    case "build":
      return "Built the OpenScout menu app bundle.";
    case "dmg":
      return "Built the OpenScout menu app DMG.";
    case "restart":
      return "Restarted the OpenScout menu app.";
    case "quit":
      return "Stopped the OpenScout menu app.";
    case "status":
      return "Checked the OpenScout menu app status.";
    case "launch":
    default:
      return "Opened the OpenScout menu app.";
  }
}

function runWithRepoHelper(
  context: ScoutCommandContext,
  helperPath: string,
  command: ScoutMenuCommand,
): ScoutMenuResult {
  runProcess(process.execPath, [helperPath, command.action, ...command.passthroughArgs], {
    cwd: defaultScoutContextDirectory(context),
    env: context.env,
  });

  const bundlePath = resolveRepoBundlePath(helperPath);
  const running = command.action === "quit" ? false : isMenuRunning(context.env);
  const installed = existsSync(bundlePath) || running;

  return {
    action: command.action,
    mode: "repo-helper",
    bundleId: MENU_BUNDLE_ID,
    bundlePath,
    helperPath,
    installed,
    running,
    message: renderActionMessage(command.action),
  };
}

function runWithInstalledApp(
  context: ScoutCommandContext,
  command: ScoutMenuCommand,
): ScoutMenuResult {
  const bundlePath = resolveInstalledMenuBundlePath(context.env);

  if (command.action === "build" || command.action === "dmg") {
    throw new ScoutCliError(
      `scout menu ${command.action} requires an OpenScout repo checkout. Run from the repo root or use bun run macos:${command.action}.`,
    );
  }

  switch (command.action) {
    case "launch":
      if (!isMenuRunning(context.env)) {
        openInstalledMenuApp(bundlePath, context.env);
      }
      break;
    case "restart":
      stopRunningMenu(context.env);
      openInstalledMenuApp(bundlePath, context.env);
      break;
    case "quit":
      stopRunningMenu(context.env);
      break;
    case "status":
      break;
    default:
      break;
  }

  const running = command.action === "quit" ? false : isMenuRunning(context.env);
  const installed = Boolean(bundlePath) || running;

  return {
    action: command.action,
    mode: "installed-app",
    bundleId: MENU_BUNDLE_ID,
    bundlePath,
    helperPath: null,
    installed,
    running,
    message: renderActionMessage(command.action),
  };
}

export async function runMenuCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (HELP_FLAGS.has(args[0] ?? "")) {
    context.output.writeText(renderMenuCommandHelp());
    return;
  }

  if (process.platform !== "darwin") {
    throw new ScoutCliError("scout menu is only supported on macOS.");
  }

  const command = parseMenuCommand(args);
  const helperPath = findRepoMenuHelper(defaultScoutContextDirectory(context));
  const result = helperPath
    ? runWithRepoHelper(context, helperPath, command)
    : runWithInstalledApp(context, command);

  context.output.writeValue(result, renderMenuResult);
}
