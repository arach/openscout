import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveBrokerServiceConfig,
  type BrokerServiceConfig,
} from "./broker-process-manager.js";
import {
  DEFAULT_SCOUT_WEB_PORTAL_HOST,
  resolveConfiguredScoutWebHostname,
  resolveScoutWebNamedHostname,
  resolveWebPort,
} from "./local-config.js";
import {
  renderOpenScoutCaddyfile,
  resolveOpenScoutLocalEdgeConfig,
  type OpenScoutLocalEdgeConfig,
  type OpenScoutLocalEdgeScheme,
} from "./local-edge.js";

const RESTART_MIN_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;
const BROKER_HEALTH_TIMEOUT_MS = 30_000;
const BROKER_HEALTH_POLL_MS = 250;
const MENU_BUNDLE_ID = "com.openscout.menu";
const MENU_PROCESS_NAME = "OpenScoutMenu";

let shuttingDown = false;
let brokerProcess: ChildProcess | null = null;
let caddyProcess: ChildProcess | null = null;
let mdnsProcesses: ChildProcess[] = [];
let brokerRestartDelayMs = RESTART_MIN_DELAY_MS;
let edgeRestartDelayMs = RESTART_MIN_DELAY_MS;
let supervisedWebPid: number | null = null;

const config = resolveBrokerServiceConfig();

function log(message: string, details?: unknown): void {
  if (details === undefined) {
    console.log(`[openscout-base] ${message}`);
    return;
  }
  console.log(`[openscout-base] ${message}`, details);
}

function warn(message: string, details?: unknown): void {
  if (details === undefined) {
    console.warn(`[openscout-base] ${message}`);
    return;
  }
  console.warn(`[openscout-base] ${message}`, details);
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function logFile(name: string): number {
  const dir = join(config.supportDirectory, "logs", "base");
  ensureDirectory(dir);
  return openSync(join(dir, name), "a");
}

function runtimeEntrypoint(config: BrokerServiceConfig): string {
  return join(config.runtimePackageDir, "bin", "openscout-runtime.mjs");
}

function spawnBroker(): void {
  if (shuttingDown || brokerProcess) {
    return;
  }

  const stdout = logFile("broker.stdout.log");
  const stderr = logFile("broker.stderr.log");
  brokerProcess = spawn(config.bunExecutable, [
    "run",
    runtimeEntrypoint(config),
    "broker",
  ], {
    cwd: config.runtimePackageDir,
    env: {
      ...process.env,
      OPENSCOUT_PARENT_PID: String(process.pid),
      OPENSCOUT_BROKER_HOST: config.brokerHost,
      OPENSCOUT_BROKER_PORT: String(config.brokerPort),
      OPENSCOUT_BROKER_URL: config.brokerUrl,
      OPENSCOUT_BROKER_SOCKET_PATH: config.brokerSocketPath,
      OPENSCOUT_CONTROL_HOME: config.controlHome,
      OPENSCOUT_ADVERTISE_SCOPE: config.advertiseScope,
    },
    stdio: ["ignore", stdout, stderr],
  });

  log("broker started", { pid: brokerProcess.pid, url: config.brokerUrl });
  brokerProcess.once("exit", (code, signal) => {
    log("broker exited", { code, signal });
    brokerProcess = null;
    supervisedWebPid = null;
    if (!shuttingDown) {
      scheduleBrokerRestart();
    }
  });
}

function scheduleBrokerRestart(): void {
  const delay = brokerRestartDelayMs;
  brokerRestartDelayMs = Math.min(brokerRestartDelayMs * 2, RESTART_MAX_DELAY_MS);
  setTimeout(() => {
    if (!shuttingDown) {
      spawnBroker();
      void startWebWhenBrokerIsReady();
    }
  }, delay).unref();
}

async function waitForBrokerHealth(timeoutMs = BROKER_HEALTH_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/health", config.brokerUrl), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        const body = await response.json() as { ok?: boolean };
        if (body.ok === true) {
          brokerRestartDelayMs = RESTART_MIN_DELAY_MS;
          return true;
        }
      }
    } catch {
      // Broker is still starting.
    }
    await sleep(BROKER_HEALTH_POLL_MS);
  }
  return false;
}

function resolveEdgeScheme(): OpenScoutLocalEdgeScheme {
  const value = process.env.OPENSCOUT_WEB_EDGE_SCHEME?.trim().toLowerCase();
  if (value === "http" || value === "https" || value === "both") {
    return value;
  }
  return "both";
}

function resolveEdgeConfig(): OpenScoutLocalEdgeConfig {
  const portalHost = process.env.OPENSCOUT_WEB_PORTAL_HOST?.trim() || DEFAULT_SCOUT_WEB_PORTAL_HOST;
  const nodeHost = process.env.OPENSCOUT_WEB_ADVERTISED_HOST?.trim()
    || (process.env.OPENSCOUT_WEB_LOCAL_NAME?.trim()
      ? resolveScoutWebNamedHostname(process.env.OPENSCOUT_WEB_LOCAL_NAME)
      : resolveConfiguredScoutWebHostname());
  return resolveOpenScoutLocalEdgeConfig({
    portalHost,
    nodeHost,
    scheme: resolveEdgeScheme(),
    brokerPort: config.brokerPort,
    webPort: Number.parseInt(process.env.OPENSCOUT_WEB_PORT ?? "", 10) || resolveWebPort(),
  });
}

function resolveLocalEdgeCaddyfilePath(): string {
  const dir = join(homedir(), ".scout", "local-edge");
  ensureDirectory(dir);
  return join(dir, "Caddyfile");
}

function resolveCaddyExecutable(): string {
  return process.env.OPENSCOUT_CADDY_BIN?.trim() || "caddy";
}

function spawnMdnsProxy(input: {
  name: string;
  host: string;
  port: number;
  scheme: "http" | "https";
}): ChildProcess {
  return spawn("/usr/bin/dns-sd", [
    "-P",
    input.name,
    input.scheme === "https" ? "_https._tcp" : "_http._tcp",
    "local",
    String(input.port),
    input.host,
    "127.0.0.1",
    "path=/",
  ], {
    stdio: ["ignore", logFile("mdns.stdout.log"), logFile("mdns.stderr.log")],
  });
}

function stopEdgeProcesses(): void {
  for (const processRef of mdnsProcesses) {
    if (!processRef.killed) {
      processRef.kill("SIGTERM");
    }
  }
  mdnsProcesses = [];
  if (caddyProcess && !caddyProcess.killed) {
    caddyProcess.kill("SIGTERM");
  }
  caddyProcess = null;
}

function startLocalEdge(): void {
  if (process.env.OPENSCOUT_BASE_EDGE_ENABLED === "0" || process.platform !== "darwin") {
    return;
  }
  if (shuttingDown || caddyProcess) {
    return;
  }

  const edgeConfig = resolveEdgeConfig();
  const schemes = edgeConfig.scheme === "both" ? ["http", "https"] as const : [edgeConfig.scheme] as const;
  const caddyfilePath = resolveLocalEdgeCaddyfilePath();
  writeFileSync(caddyfilePath, renderOpenScoutCaddyfile(edgeConfig), "utf8");

  mdnsProcesses = schemes.flatMap((scheme) => {
    const edgePort = scheme === "https" ? 443 : 80;
    const suffix = scheme.toUpperCase();
    return [
      spawnMdnsProxy({
        name: `Scout Local ${suffix}`,
        host: edgeConfig.portalHost,
        port: edgePort,
        scheme,
      }),
      spawnMdnsProxy({
        name: `Scout ${edgeConfig.nodeHost} ${suffix}`,
        host: edgeConfig.nodeHost,
        port: edgePort,
        scheme,
      }),
    ];
  });

  caddyProcess = spawn(resolveCaddyExecutable(), [
    "run",
    "--config",
    caddyfilePath,
    "--adapter",
    "caddyfile",
  ], {
    env: process.env,
    stdio: ["ignore", logFile("edge.stdout.log"), logFile("edge.stderr.log")],
  });

  log("local edge started", {
    pid: caddyProcess.pid,
    portal: edgeConfig.portalHost,
    node: edgeConfig.nodeHost,
    caddyfile: caddyfilePath,
  });

  caddyProcess.once("error", (error: NodeJS.ErrnoException) => {
    stopEdgeProcesses();
    warn("local edge failed to start", error.message);
    scheduleEdgeRestart();
  });
  caddyProcess.once("exit", (code, signal) => {
    log("local edge exited", { code, signal });
    stopEdgeProcesses();
    if (!shuttingDown) {
      scheduleEdgeRestart();
    }
  });
}

function scheduleEdgeRestart(): void {
  const delay = edgeRestartDelayMs;
  edgeRestartDelayMs = Math.min(edgeRestartDelayMs * 2, RESTART_MAX_DELAY_MS);
  setTimeout(() => {
    if (!shuttingDown) {
      startLocalEdge();
    }
  }, delay).unref();
}

async function startWebWhenBrokerIsReady(): Promise<void> {
  if (process.env.OPENSCOUT_BASE_START_WEB === "0") {
    return;
  }
  if (!(await waitForBrokerHealth())) {
    warn("broker did not become healthy before web startup timeout");
    return;
  }

  try {
    const edgeConfig = resolveEdgeConfig();
    const scheme = edgeConfig.scheme === "https" ? "https" : "http";
    const response = await fetch(new URL("/v1/web/start", config.brokerUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-forwarded-host": edgeConfig.portalHost,
        "x-forwarded-proto": scheme,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json() as { ok?: boolean; pid?: number | null; error?: string | null };
    supervisedWebPid = typeof body.pid === "number"
      ? body.pid
      : resolvePortListenerPid(Number.parseInt(process.env.OPENSCOUT_WEB_PORT ?? "", 10) || resolveWebPort());
    if (!response.ok || body.ok !== true) {
      warn("web server did not report healthy", body.error ?? response.statusText);
      return;
    }
    log("web server ready", { pid: supervisedWebPid });
  } catch (error) {
    warn("web server startup failed", error instanceof Error ? error.message : String(error));
  }
}

function resolvePortListenerPid(port: number): number | null {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    return null;
  }
  const pid = Number.parseInt(result.stdout.trim().split(/\s+/)[0] ?? "", 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function findRepoMenuBundle(): string | null {
  let current = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = resolve(current, "apps", "macos", "dist", "OpenScoutMenu.app");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function startMenuBarApp(): void {
  if (process.env.OPENSCOUT_BASE_MENU_ENABLED === "0" || process.platform !== "darwin") {
    return;
  }

  const explicitBundle = process.env.OPENSCOUT_MENU_BUNDLE_PATH?.trim();
  const repoBundle = explicitBundle && existsSync(explicitBundle) ? explicitBundle : findRepoMenuBundle();
  const args = repoBundle ? [repoBundle] : ["-b", MENU_BUNDLE_ID];
  const child = spawn("open", args, {
    stdio: ["ignore", logFile("menu.stdout.log"), logFile("menu.stderr.log")],
  });
  child.once("exit", (code) => {
    if (code === 0) {
      log("menu bar app launch requested", { target: repoBundle ?? MENU_BUNDLE_ID });
      return;
    }
    warn("menu bar app launch failed", { target: repoBundle ?? MENU_BUNDLE_ID, code });
  });
}

function stopMenuBarApp(): void {
  if (process.platform !== "darwin" || process.env.OPENSCOUT_BASE_MENU_ENABLED === "0") {
    return;
  }
  spawn("pkill", ["-x", MENU_PROCESS_NAME], { stdio: "ignore" }).unref();
}

function stopSupervisedWeb(): void {
  if (supervisedWebPid && supervisedWebPid > 0) {
    try {
      process.kill(supervisedWebPid, "SIGTERM");
    } catch {
      // The broker may already have stopped its web child.
    }
  }
  supervisedWebPid = null;
}

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  stopSupervisedWeb();
  stopMenuBarApp();
  stopEdgeProcesses();
  if (brokerProcess && !brokerProcess.killed) {
    brokerProcess.kill("SIGTERM");
  }
  await sleep(500);
  process.exit(exitCode);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown(0).catch((error) => {
      warn("shutdown failed", error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  });
}

log("starting Scout base service", {
  label: config.label,
  brokerUrl: config.brokerUrl,
  bootout: `launchctl bootout ${config.serviceTarget}`,
});
spawnBroker();
startLocalEdge();
startMenuBarApp();
void startWebWhenBrokerIsReady();
