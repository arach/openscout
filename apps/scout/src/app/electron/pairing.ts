import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { findNearestProjectRoot } from "@openscout/runtime/setup";

import { resolveScoutAppRoot } from "../../shared/paths.ts";

export const SCOUT_PAIRING_HOME_DIRECTORY = ".scout/pairing";
export const SCOUT_PAIRING_CONFIG_FILE = "config.json";
export const SCOUT_PAIRING_IDENTITY_FILE = "identity.json";
export const SCOUT_PAIRING_TRUSTED_PEERS_FILE = "trusted-peers.json";
export const SCOUT_PAIRING_LOG_FILE = "bridge.log";
export const SCOUT_PAIRING_RUNTIME_STATE_FILE = "runtime.json";
export const SCOUT_PAIRING_RUNTIME_PID_FILE = "runtime.pid";
export const SCOUT_PAIRING_DEFAULT_PORT = 7_888;
export const SCOUT_PAIRING_LOG_TAIL_LINE_LIMIT = 160;
export const SCOUT_PAIRING_RUNTIME_BOOTSTRAP_DELAY_MS = 350;
export const SCOUT_PAIRING_PROCESS_EXIT_TIMEOUT_MS = 5_000;
export const SCOUT_PAIRING_PROCESS_EXIT_POLL_MS = 100;
export const SCOUT_PAIRING_COMMAND_LABEL = "scout pair";
export const SCOUT_PAIRING_RUNTIME_VERSION = 1 as const;
export const SCOUT_PAIRING_RUNTIME_SCRIPT = "pair-supervisor.ts";

export type ScoutPairingControlAction = "start" | "stop" | "restart";

export type ScoutPairingConfig = {
  relay?: string;
  secure?: boolean;
  port?: number;
  adapters?: Record<string, { type: string; options?: Record<string, unknown> }>;
  workspace?: {
    root?: string;
  };
  sessions?: unknown[];
};

export type ScoutPairingPaths = {
  rootDir: string;
  configPath: string;
  identityPath: string;
  trustedPeersPath: string;
  logPath: string;
  runtimeStatePath: string;
  runtimePidPath: string;
};

export type ScoutPairingSnapshot = {
  relay: string;
  room: string;
  publicKey: string;
  expiresAt: number;
  qrArt: string;
  qrValue: string;
};

export type ScoutPairingRuntimeStatus =
  | "unconfigured"
  | "stopped"
  | "starting"
  | "connecting"
  | "connected"
  | "paired"
  | "closed"
  | "error";

export type ScoutPairingRuntimeSnapshot = {
  version: 1;
  pid: number;
  childPid: number | null;
  status: ScoutPairingRuntimeStatus;
  statusLabel: string;
  statusDetail: string | null;
  relay: string | null;
  secure: boolean;
  workspaceRoot: string | null;
  sessionCount: number;
  identityFingerprint: string | null;
  trustedPeerCount: number;
  pairing: ScoutPairingSnapshot | null;
  startedAt: number;
  updatedAt: number;
};

export type ScoutPairingState = {
  status: ScoutPairingRuntimeStatus;
  statusLabel: string;
  statusDetail: string | null;
  isRunning: boolean;
  commandLabel: string;
  configPath: string;
  identityPath: string;
  trustedPeersPath: string;
  logPath: string;
  relay: string | null;
  configuredRelay: string | null;
  secure: boolean;
  workspaceRoot: string | null;
  sessionCount: number;
  identityFingerprint: string | null;
  trustedPeerCount: number;
  pairing: ScoutPairingSnapshot | null;
  logTail: string;
  logUpdatedAtLabel: string | null;
  logMissing: boolean;
  logTruncated: boolean;
  lastUpdatedLabel: string | null;
};

export type UpdateScoutPairingConfigInput = {
  relay: string;
  workspaceRoot?: string | null;
};

type ScoutPairingResolvedConfig = {
  relay: string | null;
  secure: boolean;
  port: number;
  workspaceRoot: string | null;
  sessions: unknown[];
};

type ScoutPairingLogTail = {
  body: string;
  updatedAtLabel: string | null;
  missing: boolean;
  truncated: boolean;
};

type ScoutPairingIdentity = {
  publicKey?: string;
};

export function resolveScoutPairingPaths(): ScoutPairingPaths {
  const rootDir = join(homedir(), SCOUT_PAIRING_HOME_DIRECTORY);
  return {
    rootDir,
    configPath: join(rootDir, SCOUT_PAIRING_CONFIG_FILE),
    identityPath: join(rootDir, SCOUT_PAIRING_IDENTITY_FILE),
    trustedPeersPath: join(rootDir, SCOUT_PAIRING_TRUSTED_PEERS_FILE),
    logPath: join(rootDir, SCOUT_PAIRING_LOG_FILE),
    runtimeStatePath: join(rootDir, SCOUT_PAIRING_RUNTIME_STATE_FILE),
    runtimePidPath: join(rootDir, SCOUT_PAIRING_RUNTIME_PID_FILE),
  };
}

function loadScoutPairingConfig(): ScoutPairingConfig {
  const { configPath } = resolveScoutPairingPaths();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const payload = JSON.parse(readFileSync(configPath, "utf8")) as ScoutPairingConfig;
    return typeof payload === "object" && payload ? payload : {};
  } catch {
    return {};
  }
}

function saveScoutPairingConfig(config: ScoutPairingConfig): void {
  const { rootDir, configPath } = resolveScoutPairingPaths();
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function resolveScoutPairingConfig(): ScoutPairingResolvedConfig {
  const config = loadScoutPairingConfig();
  return {
    relay: typeof config.relay === "string" && config.relay.trim().length > 0
      ? config.relay.trim()
      : null,
    secure: config.secure !== false,
    port: Number.isFinite(config.port) && (config.port ?? 0) > 0 ? Number(config.port) : SCOUT_PAIRING_DEFAULT_PORT,
    workspaceRoot: typeof config.workspace?.root === "string" && config.workspace.root.trim().length > 0
      ? config.workspace.root.trim()
      : null,
    sessions: Array.isArray(config.sessions) ? config.sessions : [],
  };
}

async function resolveDefaultScoutPairingWorkspaceRoot(currentDirectory?: string): Promise<string | null> {
  const trimmed = currentDirectory?.trim();
  if (!trimmed) {
    return null;
  }

  return await findNearestProjectRoot(trimmed) ?? trimmed;
}

function readScoutPairingRuntimeSnapshot(): ScoutPairingRuntimeSnapshot | null {
  const { runtimeStatePath } = resolveScoutPairingPaths();
  if (!existsSync(runtimeStatePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(runtimeStatePath, "utf8")) as ScoutPairingRuntimeSnapshot;
    return parsed?.version === SCOUT_PAIRING_RUNTIME_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function clearScoutPairingRuntimeSnapshot(): void {
  const { runtimeStatePath } = resolveScoutPairingPaths();
  try {
    unlinkSync(runtimeStatePath);
  } catch {
    // noop
  }
}

function readScoutPairingRuntimePid(): number | null {
  const { runtimePidPath } = resolveScoutPairingPaths();
  if (!existsSync(runtimePidPath)) {
    return null;
  }

  try {
    const raw = readFileSync(runtimePidPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function clearScoutPairingRuntimePid(): void {
  const { runtimePidPath } = resolveScoutPairingPaths();
  try {
    unlinkSync(runtimePidPath);
  } catch {
    // noop
  }
}

function isScoutPairingProcessRunning(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function staleScoutPairingRuntimeOwnerPid(): number | null {
  const pid = readScoutPairingRuntimePid();
  if (!pid) {
    return null;
  }
  return isScoutPairingProcessRunning(pid) ? null : pid;
}

function isScoutPairingRuntimeRunning(): boolean {
  const pid = readScoutPairingRuntimePid();
  if (isScoutPairingProcessRunning(pid)) {
    return true;
  }

  const snapshot = readScoutPairingRuntimeSnapshot();
  return Boolean(snapshot && isScoutPairingProcessRunning(snapshot.childPid ?? snapshot.pid));
}

function clearStaleScoutPairingRuntimeFiles(): void {
  const staleOwnerPid = staleScoutPairingRuntimeOwnerPid();
  if (staleOwnerPid === null) {
    return;
  }

  const snapshot = readScoutPairingRuntimeSnapshot();
  if (snapshot && isScoutPairingProcessRunning(snapshot.childPid ?? snapshot.pid)) {
    return;
  }

  clearScoutPairingRuntimePid();
  clearScoutPairingRuntimeSnapshot();
}

function readScoutPairingIdentityFingerprint(identityPath: string): string | null {
  if (!existsSync(identityPath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(identityPath, "utf8")) as ScoutPairingIdentity;
    return typeof payload.publicKey === "string" && payload.publicKey.length > 0
      ? payload.publicKey.slice(0, 16)
      : null;
  } catch {
    return null;
  }
}

function readScoutPairingTrustedPeerCount(trustedPeersPath: string): number {
  if (!existsSync(trustedPeersPath)) {
    return 0;
  }

  try {
    const payload = JSON.parse(readFileSync(trustedPeersPath, "utf8"));
    return Array.isArray(payload) ? payload.length : 0;
  } catch {
    return 0;
  }
}

function readScoutPairingLogTail(logPath: string): ScoutPairingLogTail {
  if (!existsSync(logPath)) {
    return {
      body: "",
      updatedAtLabel: null,
      missing: true,
      truncated: false,
    };
  }

  const body = readFileSync(logPath, "utf8");
  const lines = body.split(/\r?\n/g);
  const visibleLines = lines.slice(-SCOUT_PAIRING_LOG_TAIL_LINE_LIMIT);
  const stats = statSync(logPath);
  return {
    body: visibleLines.join("\n").trim(),
    updatedAtLabel: formatScoutPairingLogTimestamp(stats.mtime),
    missing: false,
    truncated: lines.length > visibleLines.length,
  };
}

function formatScoutPairingTimeLabel(date: Date | number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatScoutPairingLogTimestamp(date: Date | number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

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

function resolveScoutBunExecutable(): string {
  const explicitPaths = [
    process.env.SCOUT_BUN_BIN,
    process.env.OPENSCOUT_BUN_BIN,
    process.env.BUN_BIN,
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

  for (const candidate of explicitPaths) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  const pathEntries = (process.env.PATH ?? "").split(":").filter(Boolean);
  const commonDirectories = [
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];

  for (const directory of [...pathEntries, ...commonDirectories]) {
    const candidate = join(directory.replace(/^~(?=$|\/)/, homedir()), "bun");
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to locate Bun for Scout pair mode.");
}

function resolveScoutPairingRuntimeScriptPath(): string {
  const candidates = [
    join(resolveScoutAppRoot(), "bin", SCOUT_PAIRING_RUNTIME_SCRIPT),
    join(resolveScoutAppRoot(), "..", "..", "packages", "electron-app", "dist", "electron", SCOUT_PAIRING_RUNTIME_SCRIPT.replace(/\.ts$/, ".js")),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to locate the Scout pair supervisor entrypoint.");
}

function pairingStateFromRuntime(
  snapshot: ScoutPairingRuntimeSnapshot,
  paths: ScoutPairingPaths,
  log: ScoutPairingLogTail,
  resolvedConfig: ScoutPairingResolvedConfig,
  fallbackWorkspaceRoot: string | null,
): ScoutPairingState {
  const relay = snapshot.relay ?? resolvedConfig.relay;
  const effectiveWorkspaceRoot = snapshot.workspaceRoot ?? resolvedConfig.workspaceRoot ?? fallbackWorkspaceRoot;
  return {
    status: snapshot.status,
    statusLabel: snapshot.statusLabel,
    statusDetail: snapshot.statusDetail,
    isRunning: true,
    commandLabel: SCOUT_PAIRING_COMMAND_LABEL,
    configPath: paths.configPath,
    identityPath: paths.identityPath,
    trustedPeersPath: paths.trustedPeersPath,
    logPath: paths.logPath,
    relay,
    configuredRelay: resolvedConfig.relay,
    secure: snapshot.secure,
    workspaceRoot: effectiveWorkspaceRoot,
    sessionCount: snapshot.sessionCount,
    identityFingerprint: snapshot.identityFingerprint,
    trustedPeerCount: snapshot.trustedPeerCount,
    pairing: snapshot.pairing,
    logTail: log.body,
    logUpdatedAtLabel: log.updatedAtLabel,
    logMissing: log.missing,
    logTruncated: log.truncated,
    lastUpdatedLabel: formatScoutPairingTimeLabel(snapshot.updatedAt),
  };
}

function pairingStateFromConfig(
  paths: ScoutPairingPaths,
  resolvedConfig: ScoutPairingResolvedConfig,
  log: ScoutPairingLogTail,
  fallbackWorkspaceRoot: string | null,
): ScoutPairingState {
  const hasConfiguredRelay = resolvedConfig.relay !== null;
  const effectiveWorkspaceRoot = resolvedConfig.workspaceRoot ?? fallbackWorkspaceRoot;
  return {
    status: hasConfiguredRelay ? "stopped" : "unconfigured",
    statusLabel: hasConfiguredRelay ? "Stopped" : "Not configured",
    statusDetail: hasConfiguredRelay
      ? "Start Scout pair mode to launch the pairing relay and generate a fresh QR code."
      : "Set a relay to prepare Scout pair mode.",
    isRunning: false,
    commandLabel: SCOUT_PAIRING_COMMAND_LABEL,
    configPath: paths.configPath,
    identityPath: paths.identityPath,
    trustedPeersPath: paths.trustedPeersPath,
    logPath: paths.logPath,
    relay: resolvedConfig.relay,
    configuredRelay: resolvedConfig.relay,
    secure: resolvedConfig.secure,
    workspaceRoot: effectiveWorkspaceRoot,
    sessionCount: resolvedConfig.sessions.length,
    identityFingerprint: readScoutPairingIdentityFingerprint(paths.identityPath),
    trustedPeerCount: readScoutPairingTrustedPeerCount(paths.trustedPeersPath),
    pairing: null,
    logTail: log.body,
    logUpdatedAtLabel: log.updatedAtLabel,
    logMissing: log.missing,
    logTruncated: log.truncated,
    lastUpdatedLabel: formatScoutPairingTimeLabel(new Date()),
  };
}

async function readScoutPairingState(currentDirectory?: string): Promise<ScoutPairingState> {
  clearStaleScoutPairingRuntimeFiles();

  const paths = resolveScoutPairingPaths();
  const resolvedConfig = resolveScoutPairingConfig();
  const log = readScoutPairingLogTail(paths.logPath);
  const snapshot = readScoutPairingRuntimeSnapshot();
  const runtimeAlive = isScoutPairingRuntimeRunning();
  const fallbackWorkspaceRoot = await resolveDefaultScoutPairingWorkspaceRoot(currentDirectory);

  if (snapshot && runtimeAlive) {
    return pairingStateFromRuntime(snapshot, paths, log, resolvedConfig, fallbackWorkspaceRoot);
  }

  return pairingStateFromConfig(paths, resolvedConfig, log, fallbackWorkspaceRoot);
}

async function updateScoutPairingConfig(input: UpdateScoutPairingConfigInput, currentDirectory?: string): Promise<void> {
  const current = loadScoutPairingConfig();
  const next: ScoutPairingConfig = {
    ...current,
  };

  const relay = input.relay.trim();
  if (relay) {
    next.relay = relay;
  } else {
    delete next.relay;
  }

  const workspaceRoot = input.workspaceRoot?.trim() || await resolveDefaultScoutPairingWorkspaceRoot(currentDirectory);
  if (workspaceRoot) {
    next.workspace = {
      ...(typeof current.workspace === "object" && current.workspace ? current.workspace : {}),
      root: workspaceRoot,
    };
  } else {
    delete next.workspace;
  }

  saveScoutPairingConfig(next);
}

async function ensureDefaultScoutPairingWorkspaceConfig(currentDirectory?: string): Promise<void> {
  const current = loadScoutPairingConfig();
  const existingWorkspaceRoot = typeof current.workspace?.root === "string" && current.workspace.root.trim().length > 0
    ? current.workspace.root.trim()
    : null;
  if (existingWorkspaceRoot) {
    return;
  }

  const workspaceRoot = await resolveDefaultScoutPairingWorkspaceRoot(currentDirectory);
  if (!workspaceRoot) {
    return;
  }

  saveScoutPairingConfig({
    ...current,
    workspace: {
      ...(typeof current.workspace === "object" && current.workspace ? current.workspace : {}),
      root: workspaceRoot,
    },
  });
}

async function waitForScoutPairingProcessExit(pid: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SCOUT_PAIRING_PROCESS_EXIT_TIMEOUT_MS) {
    if (!isScoutPairingProcessRunning(pid)) {
      return;
    }
    await sleep(SCOUT_PAIRING_PROCESS_EXIT_POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function startScoutPairingRuntime(): Promise<void> {
  const bunExecutable = resolveScoutBunExecutable();
  const runtimeScriptPath = resolveScoutPairingRuntimeScriptPath();
  const child = spawn(bunExecutable, [runtimeScriptPath], {
    cwd: resolveScoutAppRoot(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  await sleep(SCOUT_PAIRING_RUNTIME_BOOTSTRAP_DELAY_MS);
}

async function stopScoutPairingRuntime(): Promise<void> {
  const pid = readScoutPairingRuntimePid();
  if (pid && isScoutPairingProcessRunning(pid)) {
    process.kill(pid, "SIGTERM");
    await waitForScoutPairingProcessExit(pid);
  }
}

async function restartScoutPairingRuntime(): Promise<void> {
  await stopScoutPairingRuntime();
  await startScoutPairingRuntime();
}

async function ensureScoutPairingRuntimeStarted(): Promise<void> {
  if (isScoutPairingRuntimeRunning()) {
    return;
  }
  await startScoutPairingRuntime();
}

export async function getScoutElectronPairingState(currentDirectory?: string): Promise<ScoutPairingState> {
  return readScoutPairingState(currentDirectory);
}

export async function refreshScoutElectronPairingState(currentDirectory?: string): Promise<ScoutPairingState> {
  return readScoutPairingState(currentDirectory);
}

export async function controlScoutElectronPairingService(
  action: ScoutPairingControlAction,
  currentDirectory?: string,
): Promise<ScoutPairingState> {
  switch (action) {
    case "start":
      await ensureDefaultScoutPairingWorkspaceConfig(currentDirectory);
      await ensureScoutPairingRuntimeStarted();
      break;
    case "stop":
      await stopScoutPairingRuntime();
      break;
    case "restart":
      await ensureDefaultScoutPairingWorkspaceConfig(currentDirectory);
      await restartScoutPairingRuntime();
      break;
  }

  return readScoutPairingState(currentDirectory);
}

export async function updateScoutElectronPairingConfig(
  input: UpdateScoutPairingConfigInput,
  currentDirectory?: string,
): Promise<ScoutPairingState> {
  await updateScoutPairingConfig(input, currentDirectory);
  if (isScoutPairingRuntimeRunning()) {
    await restartScoutPairingRuntime();
  }
  return readScoutPairingState(currentDirectory);
}
