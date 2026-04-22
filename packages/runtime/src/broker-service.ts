import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureOpenScoutCleanSlateSync, resolveOpenScoutSupportPaths } from "./support-paths.js";

/** True for paths under /tmp or /private/tmp — transient remote-install dirs. */
function isTmpPath(p: string): boolean {
  return /^\/(?:private\/)?tmp\//.test(p);
}

export type BrokerServiceMode = "dev" | "prod" | "custom";
export type BrokerAdvertiseScope = "local" | "mesh";

export type BrokerServiceConfig = {
  label: string;
  mode: BrokerServiceMode;
  uid: number;
  domainTarget: string;
  serviceTarget: string;
  launchAgentPath: string;
  supportDirectory: string;
  logsDirectory: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  controlHome: string;
  runtimePackageDir: string;
  bunExecutable: string;
  brokerHost: string;
  brokerPort: number;
  brokerUrl: string;
  advertiseScope: BrokerAdvertiseScope;
};

export type BrokerHealthSnapshot = {
  reachable: boolean;
  ok: boolean;
  nodeId?: string;
  meshId?: string;
  counts?: {
    nodes: number;
    actors: number;
    agents: number;
    conversations: number;
    messages: number;
    flights: number;
  };
  error?: string;
};

export type BrokerServiceStatus = {
  label: string;
  mode: BrokerServiceMode;
  launchAgentPath: string;
  brokerUrl: string;
  supportDirectory: string;
  controlHome: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  installed: boolean;
  loaded: boolean;
  pid: number | null;
  launchdState: string | null;
  lastExitStatus: number | null;
  usesLaunchAgent: boolean;
  reachable: boolean;
  health: BrokerHealthSnapshot;
  lastLogLine: string | null;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type LaunchctlStatus = {
  loaded: boolean;
  pid: number | null;
  launchdState: string | null;
  lastExitStatus: number | null;
  raw: string;
};

export const DEFAULT_BROKER_HOST = "127.0.0.1";
export const DEFAULT_BROKER_HOST_MESH = "0.0.0.0";
export const DEFAULT_BROKER_PORT = 65535;
export const DEFAULT_ADVERTISE_SCOPE: BrokerAdvertiseScope = "local";

export function resolveAdvertiseScope(): BrokerAdvertiseScope {
  const raw = (process.env.OPENSCOUT_ADVERTISE_SCOPE ?? "").trim().toLowerCase();
  if (raw === "mesh") return "mesh";
  if (raw === "local") return "local";
  return DEFAULT_ADVERTISE_SCOPE;
}

export function resolveBrokerHost(scope: BrokerAdvertiseScope = resolveAdvertiseScope()): string {
  const explicit = process.env.OPENSCOUT_BROKER_HOST;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit;
  }
  return scope === "mesh" ? DEFAULT_BROKER_HOST_MESH : DEFAULT_BROKER_HOST;
}

export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim();
  return trimmed === "127.0.0.1" || trimmed === "::1" || trimmed === "localhost";
}
const BROKER_SERVICE_POLL_INTERVAL_MS = 100;
const DEFAULT_BROKER_START_TIMEOUT_MS = 15_000;

export function buildDefaultBrokerUrl(host = DEFAULT_BROKER_HOST, port = DEFAULT_BROKER_PORT): string {
  return `http://${host}:${port}`;
}

export const DEFAULT_BROKER_URL = buildDefaultBrokerUrl();

function runtimePackageDir(): string {
  // 1. Explicit override — always wins (useful for development)
  const explicit = process.env.OPENSCOUT_RUNTIME_PACKAGE_DIR?.trim();
  if (explicit) return explicit;

  // 2. Global install (bun ~/.bun/node_modules, npm fallback)
  const fromGlobal = findGlobalRuntimeDir();
  if (fromGlobal) return fromGlobal;

  // 3. Monorepo workspace fallback (dev only)
  const fromCwd = findWorkspaceRuntimeDir(process.cwd());
  if (fromCwd) return fromCwd;

  // 4. Last resort: relative to this module (bundled context)
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "..");
}

function isInstalledRuntimePackageDir(candidate: string): boolean {
  return existsSync(join(candidate, "package.json"))
    && existsSync(join(candidate, "bin", "openscout-runtime.mjs"));
}

function findGlobalRuntimeDir(): string | null {
  // Static candidates: bun global install layouts
  const candidates = [
    join(homedir(), ".bun", "node_modules", "@openscout", "runtime"),
    join(homedir(), ".bun", "install", "global", "node_modules", "@openscout", "runtime"),
    join(homedir(), ".bun", "install", "global", "node_modules", "@openscout", "scout", "node_modules", "@openscout", "runtime"),
  ];

  for (const c of candidates) {
    if (isInstalledRuntimePackageDir(c)) return c;
  }

  // Dynamic: resolve from `which scout` — works regardless of how it was installed
  // (npm -g, bun -g, Homebrew prefix, etc.)
  try {
    const result = spawnSync("which", ["scout"], { encoding: "utf8", timeout: 3000 });
    const scoutBin = result.stdout?.trim();
    if (scoutBin) {
      // scout bin → ../../lib/node_modules/@openscout/scout/node_modules/@openscout/runtime
      const scoutPkg = resolve(scoutBin, "..", "..");
      const nested = join(scoutPkg, "node_modules", "@openscout", "runtime");
      if (isInstalledRuntimePackageDir(nested)) return nested;
      // or runtime is a sibling: ../../lib/node_modules/@openscout/runtime
      const sibling = resolve(scoutPkg, "..", "runtime");
      if (isInstalledRuntimePackageDir(sibling)) return sibling;
    }
  } catch {
    // which not available or timed out
  }

  return null;
}

function findWorkspaceRuntimeDir(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, "packages", "runtime");
    if (existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "src"))) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveBunExecutable(): string {
  const explicit = process.env.OPENSCOUT_BUN_BIN ?? process.env.BUN_BIN;
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }

  if (basename(process.execPath).startsWith("bun") && existsSync(process.execPath)) {
    return process.execPath;
  }

  const pathEntries = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, "bun");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const homeBun = join(homedir(), ".bun", "bin", "bun");
  if (existsSync(homeBun)) {
    return homeBun;
  }

  return "bun";
}

function resolveBrokerServiceMode(): BrokerServiceMode {
  const explicit = (process.env.OPENSCOUT_BROKER_SERVICE_MODE ?? "").trim().toLowerCase();
  if (explicit === "prod" || explicit === "production") {
    return "prod";
  }
  if (explicit === "custom") {
    return "custom";
  }
  return "dev";
}

function resolveBrokerStartTimeoutMs(): number {
  const explicit = Number.parseInt(process.env.OPENSCOUT_BROKER_START_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(explicit, BROKER_SERVICE_POLL_INTERVAL_MS);
  }
  return DEFAULT_BROKER_START_TIMEOUT_MS;
}

function resolveBrokerServiceLabel(mode: BrokerServiceMode): string {
  const explicit = process.env.OPENSCOUT_BROKER_SERVICE_LABEL?.trim();
  if (explicit) {
    return explicit;
  }

  switch (mode) {
    case "prod":
      return "com.openscout.broker";
    case "custom":
      return "com.openscout.broker.custom";
    case "dev":
    default:
      return "dev.openscout.broker";
  }
}

export function resolveBrokerServiceConfig(): BrokerServiceConfig {
  const mode = resolveBrokerServiceMode();
  const label = resolveBrokerServiceLabel(mode);
  const uid = typeof process.getuid === "function" ? process.getuid() : Number.parseInt(process.env.UID ?? "0", 10);
  // Resolve paths but reject anything under /tmp — remote-install sessions
  // set env vars to transient tmp dirs that don't survive reboots.
  const supportPaths = resolveOpenScoutSupportPaths();
  const defaultSupportDir = join(homedir(), "Library", "Application Support", "OpenScout");
  const supportDirectory = isTmpPath(supportPaths.supportDirectory) ? defaultSupportDir : supportPaths.supportDirectory;
  const logsDirectory = join(supportDirectory, "logs", "broker");
  const controlHome = isTmpPath(supportPaths.controlHome)
    ? join(homedir(), ".openscout", "control-plane")
    : supportPaths.controlHome;
  const advertiseScope = resolveAdvertiseScope();
  const brokerHost = resolveBrokerHost(advertiseScope);
  const brokerPort = Number.parseInt(process.env.OPENSCOUT_BROKER_PORT ?? String(DEFAULT_BROKER_PORT), 10);
  const brokerUrl = process.env.OPENSCOUT_BROKER_URL ?? buildDefaultBrokerUrl(brokerHost, brokerPort);
  const launchAgentPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);

  return {
    label,
    mode,
    uid,
    domainTarget: `gui/${uid}`,
    serviceTarget: `gui/${uid}/${label}`,
    launchAgentPath,
    supportDirectory,
    logsDirectory,
    stdoutLogPath: join(logsDirectory, "stdout.log"),
    stderrLogPath: join(logsDirectory, "stderr.log"),
    controlHome,
    runtimePackageDir: runtimePackageDir(),
    bunExecutable: resolveBunExecutable(),
    brokerHost,
    brokerPort,
    brokerUrl,
    advertiseScope,
  };
}

export function renderLaunchAgentPlist(config: BrokerServiceConfig): string {
  const launchPath = resolveLaunchAgentPATH();
  const envEntries = {
    OPENSCOUT_BROKER_HOST: config.brokerHost,
    OPENSCOUT_BROKER_PORT: String(config.brokerPort),
    OPENSCOUT_BROKER_URL: config.brokerUrl,
    OPENSCOUT_CONTROL_HOME: config.controlHome,
    OPENSCOUT_BROKER_SERVICE_MODE: config.mode,
    OPENSCOUT_BROKER_SERVICE_LABEL: config.label,
    OPENSCOUT_ADVERTISE_SCOPE: config.advertiseScope,
    HOME: homedir(),
    PATH: launchPath,
    ...collectOptionalEnvVars([
      "OPENSCOUT_MESH_ID",
      "OPENSCOUT_MESH_SEEDS",
      "OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS",
      "OPENSCOUT_NODE_NAME",
      "OPENSCOUT_NODE_ID",
      "OPENSCOUT_NODE_QUALIFIER",
      "OPENSCOUT_TAILSCALE_BIN",
      "OPENSCOUT_TAILSCALE_STATUS_JSON",
      "OPENSCOUT_SSE_KEEPALIVE_MS",
    ]),
  };

  const envBlock = Object.entries(envEntries)
    .map(([key, value]) => `\n    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(config.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(config.bunExecutable)}</string>
    <string>${xmlEscape(join(config.runtimePackageDir, "bin", "openscout-runtime.mjs"))}</string>
    <string>broker</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(config.runtimePackageDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(config.stdoutLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(config.stderrLogPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>${envBlock}
  </dict>
</dict>
</plist>
`;
}

function collectOptionalEnvVars(keys: string[]): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      entries[key] = value;
    }
  }

  return entries;
}

function resolveLaunchAgentPATH(): string {
  const entries = [
    // Always prefer bun bin first — stale ~/.local/bin symlinks can shadow
    // the current scout shim if bun's $PATH entry comes after.
    join(homedir(), ".bun", "bin"),
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];

  // Strip transient tmp dirs from PATH — remote-install sessions prepend them.
  return Array.from(new Set(entries)).filter((e) => !isTmpPath(e)).join(":");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function ensureServiceDirectories(config: BrokerServiceConfig): void {
  ensureOpenScoutCleanSlateSync();
  mkdirSync(config.supportDirectory, { recursive: true });
  mkdirSync(config.logsDirectory, { recursive: true });
  mkdirSync(config.controlHome, { recursive: true });
  ensureParentDirectory(config.launchAgentPath);
}

function writeLaunchAgentPlist(config: BrokerServiceConfig): void {
  ensureServiceDirectories(config);
  writeFileSync(config.launchAgentPath, renderLaunchAgentPlist(config), "utf8");
}

function runCommand(command: string, args: string[], options?: { allowFailure?: boolean; env?: Record<string, string> }): CommandResult {
  const result = spawnSync(command, args, {
    env: {
      ...process.env,
      ...(options?.env ?? {}),
    },
    encoding: "utf8",
  });

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  const exitCode = result.status ?? 1;

  if (exitCode !== 0 && !options?.allowFailure) {
    throw new Error(stderr || stdout || `${command} exited with status ${exitCode}`);
  }

  return { exitCode, stdout, stderr };
}

function launchctlPath(): string {
  return "/bin/launchctl";
}

function readLogLines(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isPackageScriptBanner(line: string): boolean {
  return /^\$\s*(bun run|npm run|pnpm\b|yarn\b)/.test(line);
}

export function selectLastRelevantLogLine(lines: string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!isPackageScriptBanner(line)) {
      return line;
    }
  }
  return lines.at(-1) ?? null;
}

function readLastLogLine(paths: string[]): string | null {
  let fallback: string | null = null;

  for (const path of paths) {
    const lines = readLogLines(path);
    if (lines.length === 0) {
      continue;
    }

    const relevantLine = selectLastRelevantLogLine(lines);
    if (!relevantLine) {
      continue;
    }
    if (!isPackageScriptBanner(relevantLine)) {
      return relevantLine;
    }
    fallback ??= relevantLine;
  }

  return fallback;
}

export function parseLaunchctlPrint(output: string): Omit<LaunchctlStatus, "loaded" | "raw"> {
  const pidMatch = output.match(/\bpid = (\d+)/);
  const stateMatch = output.match(/\bstate = ([^\n]+)/);
  const lastExitMatch = output.match(/\blast exit code = (-?\d+)/i) || output.match(/\blast exit status = (-?\d+)/i);

  return {
    pid: pidMatch ? Number.parseInt(pidMatch[1] ?? "0", 10) : null,
    launchdState: stateMatch?.[1]?.trim() ?? null,
    lastExitStatus: lastExitMatch ? Number.parseInt(lastExitMatch[1] ?? "0", 10) : null,
  };
}

function inspectLaunchctl(config: BrokerServiceConfig): LaunchctlStatus {
  const printResult = runCommand(launchctlPath(), ["print", config.serviceTarget], { allowFailure: true });
  if (printResult.exitCode !== 0) {
    return {
      loaded: false,
      pid: null,
      launchdState: null,
      lastExitStatus: null,
      raw: printResult.stderr || printResult.stdout,
    };
  }

  return {
    loaded: true,
    raw: printResult.stdout,
    ...parseLaunchctlPrint(printResult.stdout),
  };
}

async function fetchHealthSnapshot(config: BrokerServiceConfig): Promise<BrokerHealthSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(new URL("/health", config.brokerUrl), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return {
        reachable: false,
        ok: false,
        error: `health returned ${response.status}`,
      };
    }

    const payload = await response.json() as BrokerHealthSnapshot & { ok: boolean };
    return {
      reachable: true,
      ok: Boolean(payload.ok),
      nodeId: payload.nodeId,
      meshId: payload.meshId,
      counts: payload.counts,
    };
  } catch (error) {
    return {
      reachable: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function brokerServiceStatus(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  ensureServiceDirectories(config);
  const launchctl = inspectLaunchctl(config);
  const health = await fetchHealthSnapshot(config);
  const installed = existsSync(config.launchAgentPath);
  const lastLogLine = health.reachable
    ? readLastLogLine([config.stdoutLogPath, config.stderrLogPath])
    : readLastLogLine([config.stderrLogPath, config.stdoutLogPath]);

  return {
    label: config.label,
    mode: config.mode,
    launchAgentPath: config.launchAgentPath,
    brokerUrl: config.brokerUrl,
    supportDirectory: config.supportDirectory,
    controlHome: config.controlHome,
    stdoutLogPath: config.stdoutLogPath,
    stderrLogPath: config.stderrLogPath,
    installed,
    loaded: launchctl.loaded,
    pid: launchctl.pid,
    launchdState: launchctl.launchdState,
    lastExitStatus: launchctl.lastExitStatus,
    usesLaunchAgent: installed || launchctl.loaded,
    reachable: health.reachable,
    health,
    lastLogLine,
  };
}

export async function installBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  writeLaunchAgentPlist(config);
  return brokerServiceStatus(config);
}

export async function startBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  writeLaunchAgentPlist(config);
  runCommand(launchctlPath(), ["bootout", config.serviceTarget], { allowFailure: true });
  runCommand(launchctlPath(), ["bootstrap", config.domainTarget, config.launchAgentPath], { allowFailure: true });
  runCommand(launchctlPath(), ["kickstart", "-k", config.serviceTarget], { allowFailure: true });

  const attempts = Math.ceil(resolveBrokerStartTimeoutMs() / BROKER_SERVICE_POLL_INTERVAL_MS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await brokerServiceStatus(config);
    if (status.health.reachable) {
      return status;
    }
    await sleep(BROKER_SERVICE_POLL_INTERVAL_MS);
  }

  const status = await brokerServiceStatus(config);
  throw new Error(status.lastLogLine ?? status.health.error ?? "Broker service did not become healthy.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stopBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  runCommand(launchctlPath(), ["bootout", config.serviceTarget], { allowFailure: true });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await brokerServiceStatus(config);
    if (!status.health.reachable) {
      return status;
    }
    await sleep(BROKER_SERVICE_POLL_INTERVAL_MS);
  }
  return brokerServiceStatus(config);
}

export async function restartBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  await stopBrokerService(config);
  return startBrokerService(config);
}

export async function uninstallBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  await stopBrokerService(config);
  if (existsSync(config.launchAgentPath)) {
    rmSync(config.launchAgentPath, { force: true });
  }
  return brokerServiceStatus(config);
}

async function main() {
  const command = process.argv[2] ?? "status";
  const json = process.argv.includes("--json");
  const config = resolveBrokerServiceConfig();

  let status: BrokerServiceStatus;
  switch (command) {
    case "install":
      status = await installBrokerService(config);
      break;
    case "start":
      status = await startBrokerService(config);
      break;
    case "stop":
      status = await stopBrokerService(config);
      break;
    case "restart":
      status = await restartBrokerService(config);
      break;
    case "uninstall":
      status = await uninstallBrokerService(config);
      break;
    case "status":
      status = await brokerServiceStatus(config);
      break;
    default:
      console.error(`Unknown broker service command: ${command}`);
      process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(formatBrokerServiceStatus(status));
}

function formatBrokerServiceStatus(status: BrokerServiceStatus): string {
  const lines = [
    `label: ${status.label}`,
    `mode: ${status.mode}`,
    `launch agent: ${status.installed ? status.launchAgentPath : "not installed"}`,
    `loaded: ${status.loaded ? "yes" : "no"}`,
    `pid: ${status.pid ?? "—"}`,
    `launchd state: ${status.launchdState ?? "—"}`,
    `broker url: ${status.brokerUrl}`,
    `reachable: ${status.reachable ? "yes" : "no"}`,
    `health: ${status.health.ok ? "ok" : status.health.error ?? "unreachable"}`,
    `logs: ${status.stdoutLogPath}`,
  ];

  if (status.lastLogLine) {
    lines.push(`last log: ${status.lastLogLine}`);
  }

  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
