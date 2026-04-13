/**
 * Host-side adapter for broker install/start/stop/status via the
 * `openscout-runtime service …` CLI. This is shell/distribution plumbing, not
 * Scout core domain logic.
 */
import { spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { BrokerServiceStatus } from "@openscout/runtime/broker-service";

function tryWhich(executableName: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    const candidate = join(dir, executableName);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (process.platform === "win32") {
      for (const ext of [".cmd", ".exe", ".bat"]) {
        const withExt = candidate + ext;
        if (existsSync(withExt)) return withExt;
      }
    }
  }
  return null;
}

/** Walk up from this module to find @openscout/runtime in node_modules (covers npm/bun dep installs). */
function findNodeModulesRuntimeBin(): string | null {
  const runtimeBinRel = join("node_modules", "@openscout", "runtime", "bin", "openscout-runtime.mjs");
  // Start from the directory of this script (handles bundled CLI context)
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 24; i++) {
    const candidate = join(dir, runtimeBinRel);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Also check bun global install locations
  const bunGlobal = join(homedir(), ".bun", "install", "global", "node_modules", "@openscout", "runtime", "bin", "openscout-runtime.mjs");
  if (existsSync(bunGlobal)) return bunGlobal;
  return null;
}

function findMonorepoOpenscoutRuntimeBin(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 24; i++) {
    const candidate = join(dir, "packages", "runtime", "bin", "openscout-runtime.mjs");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveJavaScriptRuntimeExecutable(): string {
  const explicit = process.env.OPENSCOUT_RUNTIME_NODE_BIN?.trim();
  if (explicit) {
    if (existsSync(explicit)) {
      return explicit;
    }
    const found = tryWhich(explicit);
    if (found) {
      return found;
    }
    throw new Error(`OPENSCOUT_RUNTIME_NODE_BIN is set but not found: ${explicit}`);
  }

  const execBase = basename(process.execPath).toLowerCase();
  if (execBase.startsWith("node") || execBase.startsWith("bun")) {
    return process.execPath;
  }

  const nodeOnPath = tryWhich("node");
  if (nodeOnPath) {
    return nodeOnPath;
  }

  const bunOnPath = tryWhich("bun");
  if (bunOnPath) {
    return bunOnPath;
  }

  throw new Error(
    "No JavaScript runtime found for openscout-runtime script entry. Install Node.js or set OPENSCOUT_RUNTIME_NODE_BIN.",
  );
}

/**
 * Path to the `openscout-runtime` entry (wrapper .mjs or an executable on PATH).
 * Does not import broker logic; it only locates the runtime control entrypoint.
 */
export function resolveRuntimeServiceEntrypoint(): string {
  const explicit = process.env.OPENSCOUT_RUNTIME_BIN?.trim();
  if (explicit) {
    if (existsSync(explicit)) {
      return explicit;
    }
    const found = tryWhich(explicit);
    if (found) {
      return found;
    }
    throw new Error(`OPENSCOUT_RUNTIME_BIN is set but not found: ${explicit}`);
  }

  const onPath = tryWhich("openscout-runtime");
  if (onPath) {
    return onPath;
  }

  const fromNodeModules = findNodeModulesRuntimeBin();
  if (fromNodeModules) {
    return fromNodeModules;
  }

  const monorepo = findMonorepoOpenscoutRuntimeBin();
  if (monorepo) {
    return monorepo;
  }

  throw new Error(
    "openscout-runtime not found on PATH. Install @openscout/runtime (e.g. npm i -g @openscout/runtime) or set OPENSCOUT_RUNTIME_BIN.",
  );
}

function spawnArgsForRuntime(entry: string, serviceArgs: string[]): { command: string; args: string[] } {
  const isScript = entry.endsWith(".mjs") || entry.endsWith(".js") || entry.endsWith(".cjs");
  if (isScript) {
    return { command: resolveJavaScriptRuntimeExecutable(), args: [entry, "service", ...serviceArgs] };
  }
  return { command: entry, args: ["service", ...serviceArgs] };
}

/**
 * Run `openscout-runtime service <subcommand> --json` and parse stdout as {@link BrokerServiceStatus}.
 */
export async function runRuntimeBrokerService(
  subcommand: "start" | "stop" | "restart" | "status" | "install" | "uninstall",
): Promise<BrokerServiceStatus> {
  const entry = resolveRuntimeServiceEntrypoint();
  const { command, args } = spawnArgsForRuntime(entry, [subcommand, "--json"]);

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const code = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      resolveExit(exitCode ?? 1);
    });
  });

  const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

  if (code !== 0) {
    const detail = stderr || stdout || `exit ${code}`;
    throw new Error(`openscout-runtime service ${subcommand} failed: ${detail}`);
  }

  try {
    return JSON.parse(stdout) as BrokerServiceStatus;
  } catch {
    throw new Error(
      `openscout-runtime service ${subcommand} returned non-JSON stdout: ${stdout.slice(0, 400)}`,
    );
  }
}

export async function getRuntimeBrokerServiceStatus(): Promise<BrokerServiceStatus> {
  return runRuntimeBrokerService("status");
}
