#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
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
  --vite-port <n>     Accepted for compatibility; managed restarts do not start Vite.
  --pairing-port <n>  Pairing bridge port.
  -h, --help          Show this help.

What it restarts:
  packages, relay broker, broker-managed web app, macOS Scout app,
  macOS menu helper, and iOS app.`);
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

function defaultSupportDirectory() {
  return process.env.OPENSCOUT_SUPPORT_DIRECTORY?.trim()
    || join(homedir(), "Library", "Application Support", "OpenScout");
}

function supportDirectoryFromStatus(status) {
  return typeof status?.supportDirectory === "string" && status.supportDirectory.trim().length > 0
    ? status.supportDirectory
    : defaultSupportDirectory();
}

function supervisedWebLogPath(status) {
  return join(supportDirectoryFromStatus(status), "logs", "web", "supervised-web.log");
}

function readOptionalPort(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : null;
}

function managedWebUrlFromStatus(status, options) {
  const webService = status?.health?.services?.web;
  if (typeof webService?.url === "string" && webService.url.trim().length > 0) {
    return webService.url;
  }
  const servicePort = readOptionalPort(webService?.port);
  if (servicePort) {
    return `http://127.0.0.1:${servicePort}`;
  }
  const explicitPort = options.webPort ?? readOptionalPort(process.env.OPENSCOUT_WEB_PORT);
  return `http://127.0.0.1:${explicitPort ?? DEFAULT_PORTS.web}`;
}

function brokerUrlFromStatus(status) {
  if (typeof status?.brokerUrl === "string" && status.brokerUrl.trim().length > 0) {
    try {
      const port = readOptionalPort(new URL(status.brokerUrl).port);
      if (port) {
        return `http://127.0.0.1:${port}`;
      }
    } catch {
      // Fall back to the configured/default local broker port.
    }
  }
  const brokerPort = readOptionalPort(process.env.OPENSCOUT_BROKER_PORT) ?? DEFAULT_PORTS.broker;
  return `http://127.0.0.1:${brokerPort}`;
}

async function waitForBrokerReady(bunBin) {
  const deadline = Date.now() + 60_000;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const status = readBrokerStatus(bunBin);
    if (status) {
      lastStatus = status;
      if (status.reachable === true && status.health?.ok === true) {
        return status;
      }
    }
    await sleep(500);
  }
  const detail = lastStatus?.health?.error ?? lastStatus?.lastLogLine ?? "status unavailable";
  throw new Error(`Relay broker did not become ready: ${detail}`);
}

async function startManagedWeb(status, options) {
  const brokerUrl = brokerUrlFromStatus(status);
  const response = await fetch(new URL("/v1/web/start", brokerUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-forwarded-host": "scout.local",
      "x-forwarded-proto": "http",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) {
    const detail = body?.error ?? response.statusText;
    throw new Error(`Broker-managed web app did not start: ${detail}`);
  }
  return {
    url: typeof body.webUrl === "string" && body.webUrl.trim().length > 0
      ? body.webUrl
      : managedWebUrlFromStatus(status, options),
    logPath: supervisedWebLogPath(status),
    pid: typeof body.pid === "number" ? body.pid : null,
  };
}

function applyManagedWebEnvironment(options) {
  const overrides = [];
  if (options.webPort !== null) {
    process.env.OPENSCOUT_WEB_PORT = String(options.webPort);
    overrides.push(`web ${options.webPort}`);
  }
  if (options.pairingPort !== null) {
    process.env.OPENSCOUT_PAIRING_PORT = String(options.pairingPort);
    overrides.push(`pairing ${options.pairingPort}`);
  }
  if (options.vitePort !== null) {
    console.warn("warn: --vite-port is ignored because restart:all uses broker-managed static web.");
  }
  if (overrides.length > 0) {
    console.log(`managed web env override: ${overrides.join(", ")}`);
  }
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
  applyManagedWebEnvironment(options);

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

  console.log("\n==> Start broker-managed web app");
  const brokerReadyStatus = await waitForBrokerReady(bunBin);
  const web = await startManagedWeb(brokerReadyStatus, options);
  console.log(`web pid ${web.pid ?? "unknown"}; log ${web.logPath}`);
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
