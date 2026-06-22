#!/usr/bin/env bun

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const DEFAULT_PORTS = {
  broker: 43110,
  web: 43120,
  vite: 43122,
  pairing: 43130,
};
const WORKTREE_PORT_BASES = {
  web: 43200,
  vite: 43900,
  pairing: 44600,
};
const WORKTREE_PORT_RANGE = 700;
const VALUE_FLAGS = new Set(["--port", "--web-port", "--vite-port", "--pairing-port"]);

function printHelp() {
  console.log(`OpenScout restart:all

Usage:
  bun run restart:all [options]

Options:
  --fresh             Remove generated build outputs before rebuilding.
                      Preserves OpenScout broker/control-plane data.
  --no-ios            Skip the iOS build/install step.
  --require-ios       Fail if the iOS build/install step fails.
  --port <n>          Web app port. Alias: --web-port.
  --vite-port <n>     Vite asset port.
  --pairing-port <n>  Pairing bridge port.
  -h, --help          Show this help.

What it restarts:
  packages, relay broker, web app, macOS Scout app, macOS menu helper, and iOS app.`);
}

function parsePort(value, flagName) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 65536) {
    throw new Error(`${flagName} must be a TCP port between 1 and 65535.`);
  }
  return parsed;
}

function takeValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flagName} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    fresh: false,
    ios: true,
    requireIos: false,
    help: false,
    webPort: null,
    vitePort: null,
    pairingPort: null,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--fresh") {
      options.fresh = true;
      continue;
    }
    if (arg === "--no-ios") {
      options.ios = false;
      continue;
    }
    if (arg === "--require-ios") {
      options.ios = true;
      options.requireIos = true;
      continue;
    }

    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    if (!VALUE_FLAGS.has(name)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const inlineValue = eq >= 0 ? arg.slice(eq + 1) : null;
    const value = inlineValue ?? takeValue(args, i, name);
    if (inlineValue === null) i += 1;

    if (name === "--port" || name === "--web-port") {
      options.webPort = parsePort(value, name);
    } else if (name === "--vite-port") {
      options.vitePort = parsePort(value, name);
    } else if (name === "--pairing-port") {
      options.pairingPort = parsePort(value, name);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function resolveBunBin() {
  const explicit = process.env.OPENSCOUT_BUN_BIN?.trim()
    || process.env.SCOUT_BUN_BIN?.trim()
    || process.env.BUN_BIN?.trim();
  if (explicit) return explicit;
  if (process.versions.bun && process.execPath) return process.execPath;
  return "bun";
}

function runStep(label, command, args = [], options = {}) {
  const required = options.required ?? true;
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    if (!required) {
      console.warn(`warn: ${label} failed: ${result.error.message}`);
      return false;
    }
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    const detail = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    if (!required) {
      console.warn(`warn: ${label} failed (${detail}); continuing.`);
      return false;
    }
    throw new Error(`${label} failed (${detail}).`);
  }

  return true;
}

function safeGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function resolveGitContext(cwd) {
  const worktreeRoot = safeGit(["rev-parse", "--show-toplevel"], cwd);
  const commonGitDir = safeGit(["rev-parse", "--git-common-dir"], cwd);
  if (!worktreeRoot || !commonGitDir) {
    return null;
  }
  return {
    worktreeRoot: resolve(worktreeRoot),
    commonRoot: resolve(cwd, commonGitDir, ".."),
  };
}

function worktreeSlot(input) {
  return createHash("sha256").update(input).digest().readUInt16BE(0) % WORKTREE_PORT_RANGE;
}

function resolveDefaultWebPorts() {
  const context = resolveGitContext(repoRoot);
  if (!context || context.worktreeRoot === context.commonRoot) {
    return { ...DEFAULT_PORTS };
  }
  const slot = worktreeSlot(context.worktreeRoot);
  return {
    broker: DEFAULT_PORTS.broker,
    web: WORKTREE_PORT_BASES.web + slot,
    vite: WORKTREE_PORT_BASES.vite + slot,
    pairing: WORKTREE_PORT_BASES.pairing + slot,
  };
}

function freshGeneratedPaths() {
  return [
    "packages/protocol/dist",
    "packages/runtime/dist",
    "packages/cli/dist",
    "packages/web/dist",
    "apps/macos/.build",
    "apps/macos/dist/Scout.app",
    "apps/macos/dist/ScoutMenu.app",
    "apps/macos/dist/OpenScoutMenu.app",
    "apps/macos/dist/OpenScout Menu.app",
    "apps/ios/.deriveddata/devphone",
  ].map((relativePath) => resolve(repoRoot, relativePath));
}

function removeGeneratedOutputs() {
  console.log("\n==> Fresh generated outputs");
  for (const outputPath of freshGeneratedPaths()) {
    if (!existsSync(outputPath)) {
      continue;
    }
    rmSync(outputPath, { recursive: true, force: true });
    console.log(`removed ${outputPath}`);
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function webLogPath() {
  const explicit = process.env.OPENSCOUT_RESTART_ALL_WEB_LOG?.trim();
  if (explicit) return explicit;
  return join(homedir(), "Library", "Logs", "OpenScout", "restart-all-web.log");
}

function startWebDev(bunBin, options) {
  const defaultPorts = resolveDefaultWebPorts();
  const webPort = options.webPort ?? defaultPorts.web;
  const vitePort = options.vitePort ?? defaultPorts.vite;
  const pairingPort = options.pairingPort ?? defaultPorts.pairing;
  const logPath = webLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(
    logPath,
    `\n\n[restart:all] ${new Date().toISOString()} starting web dev on ${webPort}\n`,
    "utf8",
  );
  const logFd = openSync(logPath, "a");
  const child = spawn(
    bunBin,
    [
      "run",
      "--cwd",
      "packages/web",
      "dev",
      "--port",
      String(webPort),
      "--vite-port",
      String(vitePort),
      "--pairing-port",
      String(pairingPort),
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
    },
  );
  child.unref();
  closeSync(logFd);
  return {
    pid: child.pid,
    url: `http://127.0.0.1:${webPort}`,
    logPath,
  };
}

async function waitForWeb(url, logPath) {
  const healthUrl = `${url}/api/health`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the server accepts connections.
    }
    await sleep(500);
  }
  throw new Error(`Web app did not become ready at ${healthUrl}. See ${logPath}.`);
}

function readBrokerStatus(bunBin) {
  const result = spawnSync(
    bunBin,
    ["packages/runtime/bin/openscout-runtime.mjs", "service", "status", "--json"],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if ((result.status ?? 1) !== 0 || !result.stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }

  const bunBin = resolveBunBin();

  if (options.fresh) {
    runStep("Quit macOS Scout app", bunBin, ["apps/macos/bin/scout-app.ts", "quit"], {
      required: false,
    });
    runStep("Quit macOS menu helper", bunBin, ["apps/macos/bin/openscout-menu.ts", "quit"], {
      required: false,
    });
    removeGeneratedOutputs();
  }

  runStep("Build packages", bunBin, ["run", "build"]);
  runStep("Stop stale dev web processes and ports", "bash", ["scripts/dev-cleanup.sh", "--ports-only"], {
    required: false,
  });
  runStep("Restart relay broker", bunBin, [
    "packages/runtime/bin/openscout-runtime.mjs",
    "service",
    "restart",
    "--json",
  ]);

  console.log("\n==> Start web app");
  const web = startWebDev(bunBin, options);
  console.log(`web pid ${web.pid}; log ${web.logPath}`);
  await waitForWeb(web.url, web.logPath);
  console.log(`web ready at ${web.url}`);

  runStep("Restart macOS Scout app", bunBin, ["apps/macos/bin/scout-app.ts", "restart"]);
  runStep("Restart macOS menu helper", bunBin, ["apps/macos/bin/openscout-menu.ts", "restart"]);

  let iosStatus = "skipped";
  if (options.ios) {
    const ok = runStep("Build and install iOS app", "bash", ["apps/ios/scripts/push-device.sh"], {
      required: options.requireIos,
    });
    iosStatus = ok ? "pushed" : "failed (continued)";
  }

  const brokerStatus = readBrokerStatus(bunBin);
  const brokerHealth = brokerStatus
    ? `${brokerStatus.reachable ? "reachable" : "unreachable"}, health ${
      brokerStatus.health?.ok ? "ok" : brokerStatus.health?.error ?? "unknown"
    }, pid ${brokerStatus.pid ?? "unknown"}`
    : "status unavailable";

  console.log("\nrestart:all complete");
  console.log(`broker: ${brokerHealth}`);
  console.log(`web: ${web.url} (log ${web.logPath})`);
  console.log("macOS: Scout app and menu helper restarted");
  console.log(`iOS: ${iosStatus}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
