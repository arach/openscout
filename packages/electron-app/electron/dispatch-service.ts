import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dispatchPaths as readDispatchPaths,
  loadDispatchConfig as readDispatchConfig,
  saveDispatchConfig,
  type DispatchConfig,
} from "../../../dispatch/cli/src/config.js";
import {
  clearStaleDispatchRuntimeFiles,
  isProcessRunning,
  readDispatchRuntimePid,
  readDispatchRuntimeSnapshot,
} from "../../../dispatch/cli/src/runtime-state.js";
import type { DispatchState, UpdateDispatchConfigInput } from "../src/lib/openscout-desktop.js";

const DISPATCH_ROOT = resolveDispatchRoot();
const LOG_TAIL_LIMIT = 160;

function resolveDispatchRoot() {
  const explicitRoot = process.env.OPENSCOUT_REPO_ROOT?.trim();
  if (explicitRoot) {
    const candidate = path.join(explicitRoot, "dispatch", "cli");
    if (existsSync(path.join(candidate, "src", "main.ts"))) {
      return candidate;
    }
  }

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), moduleDirectory, path.dirname(process.execPath)];

  for (const candidate of candidates) {
    const root = searchUpwardsForDispatchRoot(candidate);
    if (root) {
      return root;
    }
  }

  return path.resolve(process.cwd(), "dispatch", "cli");
}

function searchUpwardsForDispatchRoot(startDirectory: string) {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const candidate = path.join(currentDirectory, "dispatch", "cli");
    if (
      existsSync(path.join(currentDirectory, "package.json"))
      && existsSync(path.join(currentDirectory, "packages"))
      && existsSync(path.join(candidate, "src", "main.ts"))
    ) {
      return candidate;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }
    currentDirectory = parentDirectory;
  }
}

function loadDispatchConfig() {
  const { configPath } = readDispatchPaths();
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readIdentityFingerprint(identityPath: string): string | null {
  if (!existsSync(identityPath)) {
    return null;
  }
  try {
    const payload = JSON.parse(readFileSync(identityPath, "utf8")) as { publicKey?: string };
    return typeof payload.publicKey === "string" && payload.publicKey.length > 0
      ? payload.publicKey.slice(0, 16)
      : null;
  } catch {
    return null;
  }
}

function readTrustedPeerCount(trustedPeersPath: string): number {
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

function readLogTail(logPath: string) {
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
  const visibleLines = lines.slice(-LOG_TAIL_LIMIT);
  const stats = statSync(logPath);
  return {
    body: visibleLines.join("\n").trim(),
    updatedAtLabel: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(stats.mtime),
    missing: false,
    truncated: lines.length > visibleLines.length,
  };
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

function dispatchCliScriptPath(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packagedCandidate = path.resolve(moduleDirectory, "../../dispatch-cli/bin/dispatch.mjs");
  if (existsSync(packagedCandidate)) {
    return packagedCandidate;
  }

  const workspaceCandidate = path.resolve(DISPATCH_ROOT, "bin", "dispatch.mjs");
  if (existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  return workspaceCandidate;
}

function dispatchCliWorkingDirectory(cliScriptPath: string): string {
  const appRuntimeRoot = path.resolve(cliScriptPath, "../../..");
  if (existsSync(path.join(appRuntimeRoot, "package.json"))) {
    return appRuntimeRoot;
  }

  return DISPATCH_ROOT;
}

function baseState(): DispatchState {
  clearStaleDispatchRuntimeFiles();

  const paths = readDispatchPaths();
  const rawConfig = loadDispatchConfig();
  const configuredRelay = typeof rawConfig.relay === "string" && rawConfig.relay.trim().length > 0
    ? rawConfig.relay.trim()
    : null;
  const workspaceRoot = typeof (rawConfig.workspace as { root?: string } | undefined)?.root === "string"
    ? ((rawConfig.workspace as { root?: string }).root ?? null)
    : null;
  const secure = rawConfig.secure !== false;
  const sessions = Array.isArray(rawConfig.sessions) ? rawConfig.sessions : [];
  const log = readLogTail(paths.logPath);
  const snapshot = readDispatchRuntimeSnapshot();
  const runtimePid = readDispatchRuntimePid();
  const runtimeAlive = isProcessRunning(runtimePid);

  if (snapshot && runtimeAlive) {
    return {
      status: snapshot.status,
      statusLabel: snapshot.statusLabel,
      statusDetail: snapshot.statusDetail,
      isRunning: true,
      commandLabel: "dispatch start",
      configPath: paths.configPath,
      identityPath: paths.identityPath,
      trustedPeersPath: paths.trustedPeersPath,
      logPath: paths.logPath,
      relay: snapshot.relay,
      configuredRelay,
      secure: snapshot.secure,
      workspaceRoot: snapshot.workspaceRoot,
      sessionCount: snapshot.sessionCount,
      identityFingerprint: snapshot.identityFingerprint,
      trustedPeerCount: snapshot.trustedPeerCount,
      pairing: snapshot.pairing,
      logTail: log.body,
      logUpdatedAtLabel: log.updatedAtLabel,
      logMissing: log.missing,
      logTruncated: log.truncated,
      lastUpdatedLabel: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(snapshot.updatedAt),
    };
  }

  return {
    status: "stopped",
    statusLabel: "Stopped",
    statusDetail: "Start Dispatch to launch the pairing relay and generate a fresh QR code.",
    isRunning: false,
    commandLabel: "dispatch start",
    configPath: paths.configPath,
    identityPath: paths.identityPath,
    trustedPeersPath: paths.trustedPeersPath,
    logPath: paths.logPath,
    relay: configuredRelay,
    configuredRelay,
    secure,
    workspaceRoot,
    sessionCount: sessions.length,
    identityFingerprint: readIdentityFingerprint(paths.identityPath),
    trustedPeerCount: readTrustedPeerCount(paths.trustedPeersPath),
    pairing: null,
    logTail: log.body,
    logUpdatedAtLabel: log.updatedAtLabel,
    logMissing: log.missing,
    logTruncated: log.truncated,
    lastUpdatedLabel: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date()),
  };
}

class DispatchService {
  #state: DispatchState = baseState();

  async getState(): Promise<DispatchState> {
    this.#refreshFileBackedState();
    return this.#state;
  }

  async refreshState(): Promise<DispatchState> {
    this.#refreshFileBackedState();
    return this.#state;
  }

  async ensureStarted(): Promise<DispatchState> {
    await this.#startIfNeeded();
    this.#refreshFileBackedState();
    return this.#state;
  }

  async control(action: "start" | "stop" | "restart"): Promise<DispatchState> {
    switch (action) {
      case "start":
        await this.#startIfNeeded();
        break;
      case "stop":
        await this.stop();
        break;
      case "restart":
        await this.#restart();
        break;
    }

    this.#refreshFileBackedState();
    return this.#state;
  }

  async updateConfig(input: UpdateDispatchConfigInput): Promise<DispatchState> {
    const current = readDispatchConfig();
    const next: DispatchConfig = {
      ...current,
    };

    const relay = input.relay.trim();
    if (relay) {
      next.relay = relay;
    } else {
      delete next.relay;
    }

    const workspaceRoot = input.workspaceRoot?.trim();
    if (workspaceRoot) {
      next.workspace = {
        ...(typeof current.workspace === "object" && current.workspace ? current.workspace : {}),
        root: workspaceRoot,
      };
    } else {
      delete next.workspace;
    }

    saveDispatchConfig(next);
    const shouldRestart = this.#isRuntimeRunning();
    this.#refreshFileBackedState();

    if (shouldRestart) {
      await this.#restart();
    }

    this.#refreshFileBackedState();
    return this.#state;
  }

  async stop(): Promise<DispatchState> {
    const pid = readDispatchRuntimePid();
    if (pid && isProcessRunning(pid)) {
      process.kill(pid, "SIGTERM");
      await waitForProcessExit(pid);
    }
    this.#refreshFileBackedState();
    return this.#state;
  }

  async shutdown(): Promise<void> {
    this.#refreshFileBackedState();
  }

  async #startIfNeeded() {
    this.#refreshFileBackedState();

    if (this.#isRuntimeRunning()) {
      return;
    }

    const cliScriptPath = dispatchCliScriptPath();
    const child = spawn(process.execPath, [cliScriptPath, "supervise"], {
      cwd: dispatchCliWorkingDirectory(cliScriptPath),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    this.#state = {
      ...this.#state,
      status: "starting",
      statusLabel: "Starting",
      statusDetail: "Launching Dispatch pair mode.",
      isRunning: true,
      pairing: null,
      lastUpdatedLabel: this.#timeLabel(),
    };

    await sleep(350);
    this.#refreshFileBackedState();
  }

  async #restart() {
    await this.stop();
    await this.#startIfNeeded();
  }

  #isRuntimeRunning() {
    const pid = readDispatchRuntimePid();
    return isProcessRunning(pid);
  }

  #refreshFileBackedState() {
    this.#state = baseState();
  }

  #timeLabel() {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
  }
}

export const dispatchService = new DispatchService();

async function waitForProcessExit(pid: number, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await sleep(100);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
