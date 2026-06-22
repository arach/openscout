import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ScoutBrokerBuildIdentity,
  ScoutBrokerChildServiceSnapshots,
  ScoutBrokerJsonRequestTrace,
} from "./broker-api.js";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";
import {
  openScoutNetworkDiscoveryEnabled,
  openScoutNetworkServiceEnvironment,
} from "./open-scout-network.js";
import { readTailscaleSelfWebHostsSync } from "./tailscale.js";
import {
  expandHomePath,
  isExecutablePath,
  resolveBunExecutable as resolveResolvedBunExecutable,
  resolveExecutableFromSearch,
} from "./tool-resolution.js";

/** True for paths under /tmp or /private/tmp — transient remote-install dirs. */
function isTmpPath(p: string): boolean {
  return /^\/(?:private\/)?tmp\//.test(p);
}

export type BrokerServiceMode = "dev" | "prod" | "custom";
export type BrokerAdvertiseScope = "local" | "mesh";
export type BrokerHealthTransport = ScoutBrokerJsonRequestTrace["transport"] | "in_process";

export type BrokerServiceConfig = {
  label: string;
  mode: BrokerServiceMode;
  uid: number;
  domainTarget: string;
  serviceTarget: string;
  launchAgentPath: string;
  supportDirectory: string;
  runtimeDirectory: string;
  logsDirectory: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  controlHome: string;
  runtimePackageDir: string;
  bunExecutable: string;
  brokerHost: string;
  brokerPort: number;
  brokerUrl: string;
  brokerSocketPath: string;
  advertiseScope: BrokerAdvertiseScope;
  coreAgents: string[];
};

export type BrokerHealthSnapshot = {
  reachable: boolean;
  ok: boolean;
  checkedAt: number;
  transport?: BrokerHealthTransport;
  socketPath?: string;
  socketFallbackError?: string;
  nodeId?: string;
  meshId?: string;
  build?: ScoutBrokerBuildIdentity;
  services?: ScoutBrokerChildServiceSnapshots;
  counts?: {
    nodes: number;
    actors: number;
    agents: number;
    agentRecords?: number;
    rawAgentRecords?: number;
    configuredAgents?: number;
    scoutManagedAgents?: number;
    currentAgentRegistrations?: number;
    localAgentRegistrations?: number;
    remoteAgentRegistrations?: number;
    staleAgentRegistrations?: number;
    retiredAgentRegistrations?: number;
    oneTimeAgentCards?: number;
    persistentAgentCards?: number;
    conversations: number;
    messages: number;
    flights: number;
    collaborationRecords: number;
  };
  error?: string;
};

export type BrokerServiceStatus = {
  label: string;
  mode: BrokerServiceMode;
  launchAgentPath: string;
  bootoutCommand: string;
  brokerUrl: string;
  brokerSocketPath: string;
  supportDirectory: string;
  runtimeDirectory: string;
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

export type BrokerServiceCommand = "install" | "start" | "stop" | "restart" | "uninstall" | "status";

export const DEFAULT_BROKER_HOST = "127.0.0.1";
export const DEFAULT_BROKER_HOST_MESH = "0.0.0.0";
export const DEFAULT_BROKER_PORT = 65535;
export const DEFAULT_ADVERTISE_SCOPE: BrokerAdvertiseScope = "local";

export function buildDefaultBrokerUrl(host = DEFAULT_BROKER_HOST, port = DEFAULT_BROKER_PORT): string {
  return `http://${host}:${port}`;
}

function normalizeBrokerUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value.trim();
  }
}

function readBrokerPort(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.OPENSCOUT_BROKER_PORT ?? String(DEFAULT_BROKER_PORT), 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_BROKER_PORT;
}

function envHasGeneratedLocalBrokerDefaults(env: NodeJS.ProcessEnv = process.env): boolean {
  const scope = env.OPENSCOUT_ADVERTISE_SCOPE?.trim().toLowerCase();
  const host = env.OPENSCOUT_BROKER_HOST?.trim();
  const url = env.OPENSCOUT_BROKER_URL?.trim();
  if (scope !== "local" || host !== DEFAULT_BROKER_HOST || !url) {
    return false;
  }

  return normalizeBrokerUrl(url) === normalizeBrokerUrl(buildDefaultBrokerUrl(DEFAULT_BROKER_HOST, readBrokerPort(env)));
}

function shouldIgnoreGeneratedLocalBrokerDefaults(env: NodeJS.ProcessEnv = process.env): boolean {
  // Older LaunchAgents persisted the initial local defaults as env vars. Once
  // settings enable OSN/mesh discovery, those generated values should not keep
  // pinning the supervised broker to loopback forever.
  return envHasGeneratedLocalBrokerDefaults(env) && openScoutNetworkDiscoveryEnabled(env);
}

export function resolveAdvertiseScope(env: NodeJS.ProcessEnv = process.env): BrokerAdvertiseScope {
  const raw = (env.OPENSCOUT_ADVERTISE_SCOPE ?? "").trim().toLowerCase();
  if (raw === "mesh") return "mesh";
  if (raw === "local" && !shouldIgnoreGeneratedLocalBrokerDefaults(env)) return "local";
  if (openScoutNetworkDiscoveryEnabled(env)) return "mesh";
  return DEFAULT_ADVERTISE_SCOPE;
}

export function resolveBrokerHost(
  scope: BrokerAdvertiseScope = resolveAdvertiseScope(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.OPENSCOUT_BROKER_HOST;
  if (
    typeof explicit === "string"
    && explicit.trim().length > 0
    && !(scope === "mesh" && shouldIgnoreGeneratedLocalBrokerDefaults(env))
  ) {
    return explicit;
  }
  return scope === "mesh" ? DEFAULT_BROKER_HOST_MESH : DEFAULT_BROKER_HOST;
}

export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim();
  return trimmed === "127.0.0.1" || trimmed === "::1" || trimmed === "localhost";
}

function localBrokerControlHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::" || trimmed === "[::]") {
    return DEFAULT_BROKER_HOST;
  }
  return trimmed;
}

function resolveBrokerUrl(
  host: string,
  port: number,
  scope: BrokerAdvertiseScope,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.OPENSCOUT_BROKER_URL?.trim();
  if (explicit && !(scope === "mesh" && shouldIgnoreGeneratedLocalBrokerDefaults(env))) {
    return explicit;
  }
  if (scope === "mesh") {
    const tailnetHost = readTailscaleSelfWebHostsSync(env)[0];
    if (tailnetHost) {
      return buildDefaultBrokerUrl(tailnetHost, port);
    }
  }
  return buildDefaultBrokerUrl(host, port);
}

export function buildLocalBrokerControlUrl(host = DEFAULT_BROKER_HOST, port = DEFAULT_BROKER_PORT): string {
  return buildDefaultBrokerUrl(localBrokerControlHost(host), port);
}

export function buildDefaultBrokerSocketPath(runtimeDirectory: string): string {
  return join(runtimeDirectory, "broker.sock");
}

export const DEFAULT_BROKER_URL = buildDefaultBrokerUrl();

export function resolveBrokerSocketPathForBaseUrl(
  baseUrl: string,
  config: BrokerServiceConfig = resolveBrokerServiceConfig(),
): string | null {
  return normalizeBrokerUrl(baseUrl) === normalizeBrokerUrl(config.brokerUrl)
    ? config.brokerSocketPath
    : null;
}

function runtimePackageDir(): string {
  // 1. Explicit override — always wins (useful for development)
  const explicit = process.env.OPENSCOUT_RUNTIME_PACKAGE_DIR?.trim();
  if (explicit) return explicit;

  // 2. Prefer the package that bundled this code. In published installs this
  // is @openscout/scout, which carries a private openscout-runtime shim.
  const fromBundledPackage = findBundledRuntimeDir();
  if (fromBundledPackage) return fromBundledPackage;

  // 3. Monorepo workspace fallback (dev only)
  const fromCwd = findWorkspaceRuntimeDir(process.cwd());
  if (fromCwd) return fromCwd;

  // 4. Compatibility with old installs that still have a separate runtime pkg.
  const fromGlobal = findGlobalRuntimeDir();
  if (fromGlobal) return fromGlobal;

  // 5. Last resort: relative to this module.
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
      // scout bin → ../../lib/node_modules/@openscout/scout
      const scoutPkg = resolve(scoutBin, "..", "..");
      if (isInstalledRuntimePackageDir(scoutPkg)) return scoutPkg;

      // Legacy layouts: scout bin → ../../lib/node_modules/@openscout/scout/node_modules/@openscout/runtime
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

function findBundledRuntimeDir(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolveBundledRuntimeDirFromModuleDir(moduleDir);
}

export function resolveBundledRuntimeDirFromModuleDir(moduleDir: string): string | null {
  const candidates = [
    // @openscout/runtime/dist/broker-process-manager.js
    resolve(moduleDir, ".."),
    // @openscout/scout/dist/runtime/broker-process-manager.mjs
    resolve(moduleDir, "..", ".."),
  ];

  for (const candidate of candidates) {
    if (isInstalledRuntimePackageDir(candidate)) return candidate;
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
  const bun = resolveResolvedBunExecutable(process.env);
  if (bun) {
    return bun.path;
  }

  throw new Error("Unable to locate Bun for broker service management. Install Bun or set OPENSCOUT_BUN_BIN.");
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

function resolveBrokerServiceLabel(mode: BrokerServiceMode): string {
  const explicit = process.env.OPENSCOUT_SERVICE_LABEL?.trim()
    || process.env.OPENSCOUT_BROKER_SERVICE_LABEL?.trim();
  if (explicit) {
    return explicit;
  }

  switch (mode) {
    case "prod":
      return "com.openscout";
    case "custom":
      return "com.openscout.custom";
    case "dev":
    default:
      return "dev.openscout";
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
  const runtimeDirectory = join(supportDirectory, "runtime");
  const logsDirectory = join(supportDirectory, "logs", "broker");
  const controlHome = isTmpPath(supportPaths.controlHome)
    ? join(homedir(), ".openscout", "control-plane")
    : supportPaths.controlHome;
  const advertiseScope = resolveAdvertiseScope();
  const brokerHost = resolveBrokerHost(advertiseScope);
  const brokerPort = readBrokerPort();
  const brokerUrl = resolveBrokerUrl(brokerHost, brokerPort, advertiseScope);
  const brokerSocketPath = process.env.OPENSCOUT_BROKER_SOCKET_PATH
    ?? buildDefaultBrokerSocketPath(runtimeDirectory);
  const launchAgentPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);

  return {
    label,
    mode,
    uid,
    domainTarget: `gui/${uid}`,
    serviceTarget: `gui/${uid}/${label}`,
    launchAgentPath,
    supportDirectory,
    runtimeDirectory,
    logsDirectory,
    stdoutLogPath: join(logsDirectory, "stdout.log"),
    stderrLogPath: join(logsDirectory, "stderr.log"),
    controlHome,
    runtimePackageDir: runtimePackageDir(),
    bunExecutable: resolveBunExecutable(),
    brokerHost,
    brokerPort,
    brokerUrl,
    brokerSocketPath,
    advertiseScope,
    coreAgents: readCoreAgentsSync(),
  };
}

type ScoutdCommand = {
  path: string;
  source: "env" | "package" | "workspace" | "path";
};

type NativeServiceStatus = Record<string, unknown> & {
  health?: unknown;
};

function executableCandidate(path: string | undefined | null): string | null {
  return isExecutablePath(path) ? path : null;
}

function resolveExecutableName(name: string): string | null {
  return resolveExecutableFromSearch({ names: [name] })?.path ?? null;
}

function resolveEnvExecutable(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.startsWith(".")) {
    const expanded = resolve(expandHomePath(trimmed));
    return executableCandidate(expanded);
  }
  return resolveExecutableName(trimmed);
}

function findWorkspaceRootFromRuntimeDir(runtimePackageDir: string): string | null {
  let current = resolve(runtimePackageDir);
  while (true) {
    if (
      existsSync(join(current, "Cargo.toml"))
      && existsSync(join(current, "crates", "scoutd", "Cargo.toml"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function workspaceScoutdAllowed(): boolean {
  const raw = process.env.OPENSCOUT_ALLOW_WORKSPACE_SCOUTD?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function resolveScoutdCommand(config: BrokerServiceConfig = resolveBrokerServiceConfig()): ScoutdCommand | null {
  const explicit = resolveEnvExecutable(process.env.OPENSCOUT_SCOUTD_BIN);
  if (explicit) {
    return { path: explicit, source: "env" };
  }

  const workspaceRoot = findWorkspaceRootFromRuntimeDir(config.runtimePackageDir);
  const packageCandidates = [
    join(config.runtimePackageDir, "bin", "scoutd"),
    join(config.runtimePackageDir, "native", "scoutd"),
    join(config.runtimePackageDir, "scoutd"),
    workspaceRoot ? join(workspaceRoot, "packages", "cli", "bin", "scoutd") : null,
    workspaceRoot ? join(workspaceRoot, "packages", "runtime", "bin", "scoutd") : null,
    join(config.runtimeDirectory, "scoutd"),
    join(dirname(config.runtimePackageDir), "scout", "bin", "scoutd"),
  ];
  for (const candidate of packageCandidates) {
    const resolved = executableCandidate(candidate);
    if (resolved) {
      return { path: resolved, source: "package" };
    }
  }

  const fromPath = resolveExecutableName("scoutd");
  if (fromPath) {
    return { path: fromPath, source: "path" };
  }

  if (workspaceRoot && workspaceScoutdAllowed()) {
    for (const candidate of [
      join(workspaceRoot, "target", "release", "scoutd"),
      join(workspaceRoot, "target", "debug", "scoutd"),
    ]) {
      const resolved = executableCandidate(candidate);
      if (resolved) {
        return { path: resolved, source: "workspace" };
      }
    }
  }

  return null;
}

function nativeServiceEnvironment(config: BrokerServiceConfig, scoutdPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENSCOUT_SCOUTD_BIN: scoutdPath,
    OPENSCOUT_RUNTIME_PACKAGE_DIR: config.runtimePackageDir,
    OPENSCOUT_BUN_BIN: config.bunExecutable,
    OPENSCOUT_SUPPORT_DIRECTORY: config.supportDirectory,
    OPENSCOUT_CONTROL_HOME: config.controlHome,
    OPENSCOUT_BROKER_HOST: config.brokerHost,
    OPENSCOUT_BROKER_PORT: String(config.brokerPort),
    OPENSCOUT_BROKER_URL: config.brokerUrl,
    OPENSCOUT_BROKER_SOCKET_PATH: config.brokerSocketPath,
    OPENSCOUT_BROKER_SERVICE_MODE: config.mode,
    OPENSCOUT_BROKER_SERVICE_LABEL: config.label,
    OPENSCOUT_SERVICE_LABEL: config.label,
    OPENSCOUT_ADVERTISE_SCOPE: config.advertiseScope,
    ...openScoutNetworkServiceEnvironment(process.env),
  };
  if (config.coreAgents.length > 0) {
    env.OPENSCOUT_CORE_AGENTS = config.coreAgents.join(",");
  }
  return env;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readHealthTransport(value: unknown): BrokerHealthTransport | undefined {
  return value === "unix_socket" || value === "http" || value === "in_process" ? value : undefined;
}

function normalizeNativeServiceStatus(input: NativeServiceStatus, config: BrokerServiceConfig): BrokerServiceStatus {
  const healthRecord = isRecord(input.health) ? input.health : {};
  const healthReachable = readBoolean(healthRecord.reachable) ?? readBoolean(input.reachable) ?? false;
  const healthOk = readBoolean(healthRecord.ok)
    ?? (typeof input.health === "boolean" ? input.health : undefined)
    ?? false;
  const healthError = readString(healthRecord.error) ?? readString(input.healthError);
  const healthTransport = readHealthTransport(healthRecord.transport) ?? readHealthTransport(input.healthTransport);
  const healthNodeId = readString(healthRecord.nodeId);
  const healthMeshId = readString(healthRecord.meshId);
  const healthSocketFallbackError = readString(healthRecord.socketFallbackError);
  const healthCounts = isRecord(healthRecord.counts)
    ? healthRecord.counts as BrokerHealthSnapshot["counts"]
    : undefined;
  const installed = readBoolean(input.installed) ?? existsSync(config.launchAgentPath);
  const loaded = readBoolean(input.loaded) ?? false;
  const stdoutLogPath = readString(input.stdoutLogPath) ?? config.stdoutLogPath;
  const stderrLogPath = readString(input.stderrLogPath) ?? config.stderrLogPath;
  const lastLogLine = readString(input.lastLogLine)
    ?? (healthReachable
      ? readLastLogLine([stdoutLogPath, stderrLogPath])
      : readLastLogLine([stderrLogPath, stdoutLogPath]));

  return {
    label: readString(input.label) ?? config.label,
    mode: (readString(input.mode) as BrokerServiceMode | undefined) ?? config.mode,
    launchAgentPath: readString(input.launchAgentPath) ?? config.launchAgentPath,
    bootoutCommand: readString(input.bootoutCommand) ?? bootoutCommand(config),
    brokerUrl: readString(input.brokerUrl) ?? config.brokerUrl,
    brokerSocketPath: readString(input.brokerSocketPath) ?? config.brokerSocketPath,
    supportDirectory: readString(input.supportDirectory) ?? config.supportDirectory,
    runtimeDirectory: readString(input.runtimeDirectory) ?? config.runtimeDirectory,
    controlHome: readString(input.controlHome) ?? config.controlHome,
    stdoutLogPath,
    stderrLogPath,
    installed,
    loaded,
    pid: readNumber(input.pid) ?? null,
    launchdState: readString(input.launchdState) ?? null,
    lastExitStatus: readNumber(input.lastExitStatus) ?? null,
    usesLaunchAgent: readBoolean(input.usesLaunchAgent) ?? (installed || loaded),
    reachable: healthReachable,
    health: {
      reachable: healthReachable,
      ok: healthOk,
      checkedAt: readNumber(healthRecord.checkedAt) ?? Date.now(),
      transport: healthTransport,
      socketPath: config.brokerSocketPath,
      ...(healthSocketFallbackError ? { socketFallbackError: healthSocketFallbackError } : {}),
      ...(healthNodeId ? { nodeId: healthNodeId } : {}),
      ...(healthMeshId ? { meshId: healthMeshId } : {}),
      ...(healthCounts ? { counts: healthCounts } : {}),
      ...(isRecord(healthRecord.build)
        ? { build: healthRecord.build as ScoutBrokerBuildIdentity }
        : {}),
      ...(isRecord(healthRecord.services)
        ? { services: healthRecord.services as ScoutBrokerChildServiceSnapshots }
        : {}),
      error: healthError,
    },
    lastLogLine,
  };
}

/** Cap on combined stdout/stderr captured from scoutd. */
const SCOUTD_MAX_BUFFER = 2 * 1024 * 1024;
/**
 * Default timeout for a scoutd service command. scoutd's `start` waits up to
 * 15s internally and `stop` up to 20s; 45s sits comfortably above both so we
 * only fire on a genuinely wedged process.
 */
const SCOUTD_DEFAULT_TIMEOUT_MS = 45_000;
/** Grace period between SIGTERM and SIGKILL when terminating a wedged scoutd. */
const SCOUTD_KILL_GRACE_MS = 250;

/**
 * Run `scoutd <command> --json` and return its parsed stdout. Uses an async
 * `spawn` (not `spawnSync`) so a wedged scoutd can never block the host event
 * loop: output is bounded by {@link SCOUTD_MAX_BUFFER}, and the call is bounded
 * by `timeoutMs` with SIGTERM→SIGKILL escalation on timeout.
 */
function spawnScoutdJson(
  scoutdPath: string,
  command: BrokerServiceCommand,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(scoutdPath, [command, "--json"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      terminate();
      fail(new Error(`scoutd ${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    killTimer.unref?.();

    function terminate(): void {
      child.kill("SIGTERM");
      const hardKillTimer = setTimeout(() => child.kill("SIGKILL"), SCOUTD_KILL_GRACE_MS);
      hardKillTimer.unref?.();
    }

    function cleanup(): void {
      clearTimeout(killTimer);
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function succeed(output: string): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(output);
    }

    function append(kind: "stdout" | "stderr", chunk: unknown): void {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      if (kind === "stdout") stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > SCOUTD_MAX_BUFFER) {
        terminate();
        fail(new Error(`scoutd ${command} exceeded output limit`));
      }
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => fail(new Error(`scoutd ${command} failed: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (settled || timedOut) return;
      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();
      if ((code ?? 1) !== 0) {
        const detail = trimmedStderr || trimmedStdout || `exit ${signal ?? code ?? "unknown status"}`;
        fail(new Error(`scoutd ${command} failed: ${detail}`));
        return;
      }
      succeed(trimmedStdout);
    });
  });
}

type ScoutdJsonRunner = (
  scoutdPath: string,
  command: BrokerServiceCommand,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) => Promise<string>;

export async function runScoutdServiceCommand(
  command: BrokerServiceCommand,
  config: BrokerServiceConfig,
  timeoutMs: number = SCOUTD_DEFAULT_TIMEOUT_MS,
  runScoutdJson: ScoutdJsonRunner = spawnScoutdJson,
): Promise<BrokerServiceStatus> {
  const scoutd = resolveScoutdCommand(config);
  if (!scoutd) {
    throw new Error(
      "Unable to locate scoutd for broker service management. Build scoutd with `npm run scoutd:build`, install a package that includes scoutd, or set OPENSCOUT_SCOUTD_BIN.",
    );
  }

  const stdout = await runScoutdJson(
    scoutd.path,
    command,
    nativeServiceEnvironment(config, scoutd.path),
    timeoutMs,
  );

  let parsed: NativeServiceStatus;
  try {
    parsed = JSON.parse(stdout) as NativeServiceStatus;
  } catch {
    throw new Error(`scoutd ${command} returned non-JSON stdout: ${stdout.slice(0, 400)}`);
  }
  return normalizeNativeServiceStatus(parsed, config);
}

function readCoreAgentsSync(): string[] {
  try {
    const settingsPath = resolveOpenScoutSupportPaths().settingsPath;
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as { agents?: { coreAgents?: unknown } };
    const raw_agents = settings?.agents?.coreAgents;
    if (Array.isArray(raw_agents)) {
      return raw_agents.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    }
  } catch {
    // settings.json missing or malformed — no core agents
  }
  return [];
}

function bootoutCommand(config: BrokerServiceConfig): string {
  return `/bin/launchctl bootout ${config.serviceTarget}`;
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

export async function brokerServiceStatus(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  return runScoutdServiceCommand("status", config);
}

export async function installBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  return runScoutdServiceCommand("install", config);
}

export async function startBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  return runScoutdServiceCommand("start", config);
}

export async function stopBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  return runScoutdServiceCommand("stop", config);
}

export async function restartBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  return runScoutdServiceCommand("restart", config);
}

export async function uninstallBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  return runScoutdServiceCommand("uninstall", config);
}

async function main() {
  const command = (process.argv[2] ?? "status") as BrokerServiceCommand | string;
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
    `bootout: ${status.bootoutCommand}`,
    `loaded: ${status.loaded ? "yes" : "no"}`,
    `pid: ${status.pid ?? "—"}`,
    `launchd state: ${status.launchdState ?? "—"}`,
    `broker url: ${status.brokerUrl}`,
    `broker socket: ${status.brokerSocketPath}`,
    `reachable: ${status.reachable ? "yes" : "no"}`,
    `health: ${status.health.ok ? "ok" : status.health.error ?? "unreachable"}`,
    `health transport: ${status.health.transport ?? "unknown"}`,
    `logs: ${status.stdoutLogPath}`,
  ];

  if (status.health.socketFallbackError) {
    lines.push(`socket fallback: ${status.health.socketFallbackError}`);
  }

  if (status.lastLogLine) {
    lines.push(`last log: ${status.lastLogLine}`);
  }

  return lines.join("\n");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  !process.argv[1].endsWith("/main.mjs")
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
