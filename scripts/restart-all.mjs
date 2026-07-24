#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  console.log(`OpenScout scout:up

Usage:
  bun run scout:up [options]
  bun run scout:verify

Options:
  --fresh             Remove generated build outputs before rebuilding.
                      Preserves OpenScout broker/control-plane data.
  --no-ios            Skip the iOS build/install step.
  --require-ios       Fail if the iOS build/install step fails.
  --verify-only       Do not mutate anything; verify the running suite.
  --port <n>          Web app port. Alias: --web-port.
  --vite-port <n>     Accepted for compatibility; managed restarts do not start Vite.
  --pairing-port <n>  Pairing bridge port.
  -h, --help          Show this help.

What it restarts:
  packages, relay broker, broker-managed web app, macOS Scout app,
  its embedded macOS menu helper, and iOS app.

Ownership:
  launchd -> scoutd -> base/probes -> broker/edge -> web
  LaunchServices -> Scout + embedded ScoutMenu -> pairing runtime`);
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

export function parseArgs(argv) {
  const options = {
    fresh: false,
    ios: true,
    requireIos: false,
    help: false,
    webPort: null,
    vitePort: null,
    pairingPort: null,
    verifyOnly: false,
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
    if (arg === "--verify-only") {
      options.verifyOnly = true;
      options.ios = false;
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
  const deadline = Date.now() + 120_000;
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
  const deadline = Date.now() + 120_000;
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
  if (!response.ok) {
    const detail = body?.error ?? response.statusText;
    throw new Error(`Broker-managed web app did not start: ${detail}`);
  }
  if (body?.ok !== true) {
    const detail = body?.error ?? "startup is still pending";
    console.warn(`web start accepted; waiting for /api/health (${detail})`);
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

function readBrokerStatus(_bunBin) {
  const result = spawnSync(
    resolve(repoRoot, "packages", "cli", "bin", "scoutd"),
    ["status", "--json"],
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

export function parseProcessTable(output) {
  return String(output).split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
      args: match[4],
    }];
  });
}

function readProcessTable() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,comm=,args="], { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) throw new Error("Unable to inspect process ownership with ps.");
  return parseProcessTable(result.stdout);
}

function processByPid(processes, pid) {
  return processes.find((process) => process.pid === pid) ?? null;
}

function processesNamed(processes, name) {
  return processes.filter((process) => {
    const executable = process.args.trim().split(/\s+/)[0] ?? "";
    return process.command === name
      || process.command.endsWith(`/${name}`)
      || executable.endsWith(`/${name}`);
  });
}

function assertSingleChild(processes, name, parentPid) {
  const matches = processesNamed(processes, name);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} process; found ${matches.length}.`);
  }
  if (matches[0].ppid !== parentPid) {
    throw new Error(`${name} pid ${matches[0].pid} is owned by pid ${matches[0].ppid}, expected ${parentPid}.`);
  }
  return matches[0];
}

function legacyServiceLoaded(label) {
  const result = spawnSync("launchctl", ["print", `gui/${process.getuid()}/${label}`], { stdio: "ignore" });
  return (result.status ?? 1) === 0;
}

export function legacyScoutServiceLabels(mode) {
  return mode === "custom"
    ? ["com.openscout.custom"]
    : ["dev.openscout", "com.openscout"];
}

async function waitForMacApps() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const processes = readProcessTable();
    if (processesNamed(processes, "Scout").length === 1 && processesNamed(processes, "ScoutMenu").length === 1) return;
    await sleep(250);
  }
  throw new Error("Scout and its embedded menu helper did not both launch within 30 seconds.");
}

export function verifyProcessOwnership(status, processes, expectedMenuBundlePath) {
  const scoutdPid = status?.scoutdState?.scoutdPid ?? status?.pid;
  const basePid = status?.scoutdState?.basePid;
  const probePid = status?.scoutdState?.probePid;
  if (!Number.isInteger(scoutdPid) || !Number.isInteger(basePid) || !Number.isInteger(probePid)) {
    throw new Error("scoutd status is missing supervisor process IDs.");
  }
  const scoutd = processByPid(processes, scoutdPid);
  if (!scoutd || scoutd.ppid !== 1 || !scoutd.args.includes("scoutd supervise")) {
    throw new Error(`scoutd pid ${scoutdPid} is not owned by launchd.`);
  }
  const base = processByPid(processes, basePid);
  if (!base || base.ppid !== scoutdPid || base.command !== "scout-base") {
    throw new Error(`scout-base pid ${basePid} is not owned by scoutd pid ${scoutdPid}.`);
  }
  const probe = processByPid(processes, probePid);
  if (!probe || probe.ppid !== scoutdPid || !probe.args.includes("scoutd probes serve")) {
    throw new Error(`scoutd probes pid ${probePid} is not owned by scoutd pid ${scoutdPid}.`);
  }
  const broker = assertSingleChild(processes, "scout-broker", basePid);
  const edge = assertSingleChild(processes, "scout-edge", basePid);
  const web = assertSingleChild(processes, "scout-web", broker.pid);

  const apps = processesNamed(processes, "Scout");
  if (apps.length !== 1) throw new Error(`Expected exactly one Scout app; found ${apps.length}.`);
  const menus = processesNamed(processes, "ScoutMenu");
  if (menus.length !== 1) throw new Error(`Expected exactly one ScoutMenu helper; found ${menus.length}.`);
  const expectedMenuExecutable = join(expectedMenuBundlePath, "Contents", "MacOS", "ScoutMenu");
  if (!menus[0].args.includes(expectedMenuExecutable)) {
    throw new Error(`ScoutMenu is not running from the embedded helper: ${menus[0].args}`);
  }

  const pairingControllers = processes.filter((process) => process.args.includes("pairing-runtime-controller"));
  for (const controller of pairingControllers) {
    if (controller.ppid !== menus[0].pid) {
      throw new Error(`pairing controller pid ${controller.pid} is not owned by ScoutMenu pid ${menus[0].pid}.`);
    }
  }

  return { scoutd, base, probe, broker, edge, web, app: apps[0], menu: menus[0], pairingControllers };
}

async function verifySuite(bunBin, options) {
  const status = await waitForBrokerReady(bunBin);
  const webUrl = managedWebUrlFromStatus(status, options);
  await waitForWeb(webUrl, supervisedWebLogPath(status));
  await waitForMacApps();
  const loadedLegacyLabels = legacyScoutServiceLabels(status?.mode).filter(legacyServiceLoaded);
  if (loadedLegacyLabels.length > 0) {
    throw new Error(`Legacy launchd services are still loaded: ${loadedLegacyLabels.join(", ")}.`);
  }
  const tree = verifyProcessOwnership(
    status,
    readProcessTable(),
    resolve(repoRoot, "apps", "macos", "dist", "Scout.app", "Contents", "Library", "LoginItems", "ScoutMenu.app"),
  );
  const agents = await fetch(new URL("/api/agents?detail=summary&limit=1", webUrl), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!agents.ok) throw new Error(`Web agents summary failed verification with HTTP ${agents.status}.`);
  return { status, tree, webUrl };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }

  const bunBin = resolveBunBin();
  applyManagedWebEnvironment(options);

  if (options.verifyOnly) {
    const verified = await verifySuite(bunBin, options);
    console.log(`suite verified: scoutd ${verified.tree.scoutd.pid} -> base ${verified.tree.base.pid} -> broker ${verified.tree.broker.pid} -> web ${verified.tree.web.pid}`);
    console.log(`apps verified: Scout ${verified.tree.app.pid}; embedded ScoutMenu ${verified.tree.menu.pid}`);
    console.log(`web ready: ${verified.webUrl}`);
    return;
  }

  runStep("Quit macOS Scout app", bunBin, ["apps/macos/bin/scout-app.ts", "quit"], { required: false });
  runStep("Quit macOS menu helper", bunBin, ["apps/macos/bin/openscout-menu.ts", "quit"], { required: false });

  if (options.fresh) {
    removeGeneratedOutputs();
  }

  runStep("Build packages", bunBin, ["run", "build"]);
  runStep("Build Scout and embedded menu helper", bunBin, ["apps/macos/bin/scout-app.ts", "dev-build"]);
  runStep("Restart launchd-owned Scout services", resolve(repoRoot, "packages", "cli", "bin", "scoutd"), ["restart", "--json"]);

  console.log("\n==> Start broker-managed web app");
  const brokerReadyStatus = await waitForBrokerReady(bunBin);
  const web = await startManagedWeb(brokerReadyStatus, options);
  console.log(`web pid ${web.pid ?? "unknown"}; log ${web.logPath}`);
  await waitForWeb(web.url, web.logPath);
  console.log(`web ready at ${web.url}`);

  runStep("Launch macOS Scout app", bunBin, ["apps/macos/bin/scout-app.ts", "launch"]);

  let iosStatus = "skipped";
  if (options.ios) {
    const ok = runStep("Build and install iOS app", "bash", ["apps/ios/scripts/push-device.sh"], {
      required: options.requireIos,
    });
    iosStatus = ok ? "pushed" : "failed (continued)";
  }

  const verified = await verifySuite(bunBin, options);
  const brokerStatus = verified.status;
  const brokerHealth = brokerStatus
    ? `${brokerStatus.reachable ? "reachable" : "unreachable"}, health ${
      brokerStatus.health?.ok ? "ok" : brokerStatus.health?.error ?? "unknown"
    }, pid ${brokerStatus.pid ?? "unknown"}`
    : "status unavailable";

  console.log("\nscout:up complete");
  console.log(`broker: ${brokerHealth}`);
  console.log(`web: ${web.url} (log ${web.logPath})`);
  console.log(`ownership: launchd -> scoutd ${verified.tree.scoutd.pid} -> base ${verified.tree.base.pid} -> broker ${verified.tree.broker.pid} -> web ${verified.tree.web.pid}`);
  console.log(`macOS: Scout ${verified.tree.app.pid}; embedded ScoutMenu ${verified.tree.menu.pid}`);
  console.log(`iOS: ${iosStatus}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
