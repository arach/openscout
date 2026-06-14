import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ScoutCliLaunchCommand = {
  command: string;
  args: string[];
  cwd: string;
};

export type ScoutCliSubcommand = "mcp" | "channel";

function isExecutable(filePath: string | undefined | null): filePath is string {
  if (!filePath) {
    return false;
  }

  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => resolve(value)),
  )];
}

function ancestorChain(start: string): string[] {
  const chain: string[] = [];
  let current = resolve(start);

  while (true) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) {
      return chain;
    }
    current = parent;
  }
}

function resolveExecutableFromSearchPath(
  names: string[],
  env: NodeJS.ProcessEnv,
): string | null {
  const pathEntries = (env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  const commonDirectories = [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];

  for (const directory of [...pathEntries, ...commonDirectories]) {
    for (const name of names) {
      const candidate = join(directory, name);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveBunExecutable(env: NodeJS.ProcessEnv): string | null {
  const explicitCandidates = [
    env.OPENSCOUT_BUN_BIN,
    env.SCOUT_BUN_BIN,
    env.BUN_BIN,
  ];

  for (const candidate of explicitCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  if (basename(process.execPath).startsWith("bun") && isExecutable(process.execPath)) {
    return process.execPath;
  }

  return resolveExecutableFromSearchPath(["bun"], env);
}

function resolveScoutExecutable(env: NodeJS.ProcessEnv): string | null {
  const explicitCandidates = [
    env.OPENSCOUT_CLI_BIN,
    env.SCOUT_CLI_BIN,
    env.OPENSCOUT_SCOUT_BIN,
    env.SCOUT_BIN,
  ];

  for (const candidate of explicitCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return resolveExecutableFromSearchPath(["scout"], env);
}

function resolveRepoScoutCliScript(currentDirectory: string): string | null {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const starts = uniquePaths([currentDirectory, moduleDirectory]);

  for (const start of starts) {
    for (const candidate of ancestorChain(start)) {
      const scriptPath = join(candidate, "packages", "cli", "bin", "scout.mjs");
      if (existsSync(scriptPath)) {
        return scriptPath;
      }
    }
  }

  return null;
}

function resolveRepoScoutScript(currentDirectory: string): string | null {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const starts = uniquePaths([currentDirectory, moduleDirectory]);

  for (const start of starts) {
    for (const candidate of ancestorChain(start)) {
      const scriptPath = join(candidate, "apps", "desktop", "bin", "scout.ts");
      if (existsSync(scriptPath)) {
        return scriptPath;
      }
    }
  }

  return null;
}

function resolveContextRoot(currentDirectory: string, env: NodeJS.ProcessEnv): string {
  const configured = env.OPENSCOUT_SETUP_CWD?.trim();
  return resolve(configured || currentDirectory);
}

export function resolveScoutCliLaunchCommand(options: {
  currentDirectory: string;
  env?: NodeJS.ProcessEnv;
  subcommand: ScoutCliSubcommand;
}): ScoutCliLaunchCommand | null {
  const env = options.env ?? process.env;
  const contextRoot = resolveContextRoot(options.currentDirectory, env);
  const scoutArgs = [options.subcommand, "--context-root", contextRoot];

  const repoCliScript = resolveRepoScoutCliScript(options.currentDirectory);
  const bunExecutable = resolveBunExecutable(env);
  if (repoCliScript && bunExecutable) {
    return {
      command: bunExecutable,
      args: [repoCliScript, ...scoutArgs],
      cwd: contextRoot,
    };
  }

  const scoutExecutable = resolveScoutExecutable(env);
  if (scoutExecutable) {
    return {
      command: scoutExecutable,
      args: scoutArgs,
      cwd: contextRoot,
    };
  }

  const scoutScript = resolveRepoScoutScript(options.currentDirectory);
  if (scoutScript && bunExecutable) {
    return {
      command: bunExecutable,
      args: [scoutScript, ...scoutArgs],
      cwd: contextRoot,
    };
  }

  return null;
}
