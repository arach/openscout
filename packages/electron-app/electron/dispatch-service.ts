import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path, { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDispatchConfig as readDispatchConfig, saveDispatchConfig, type DispatchConfig } from "../../../dispatch/cli/src/config.js";
import type { DispatchState, UpdateDispatchConfigInput } from "../src/lib/openscout-desktop.js";

const DISPATCH_ROOT = resolveDispatchRoot();
const DISPATCH_MAIN = path.join(DISPATCH_ROOT, "src", "main.ts");
const PAIR_REFRESH_LEEWAY_MS = 30_000;
const LOG_TAIL_LIMIT = 160;

type PairingReadyEvent = {
  type: "pairing_ready";
  relay: string;
  trustedPeerCount: number;
  payload: {
    v: number;
    relay: string;
    room: string;
    publicKey: string;
    expiresAt: number;
  };
  qrArt: string;
  identityFingerprint: string;
};

type PairingStatusEvent = {
  type: "status";
  status: "connecting" | "connected" | "paired" | "closed" | "error";
  detail: string | null;
};

type PairingEvent = PairingReadyEvent | PairingStatusEvent;

function dispatchPaths() {
  const root = path.join(os.homedir(), ".dispatch");
  return {
    root,
    configPath: path.join(root, "config.json"),
    identityPath: path.join(root, "identity.json"),
    trustedPeersPath: path.join(root, "trusted-peers.json"),
    logPath: path.join(root, "bridge.log"),
  };
}

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
  const { configPath } = dispatchPaths();
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

function resolveBunExecutable(): string | null {
  const explicitCandidates = [
    process.env.OPENSCOUT_BUN_BIN,
    process.env.BUN_BIN,
  ].filter(Boolean) as string[];

  for (const candidate of explicitCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  const commonDirectories = [
    `${process.env.HOME ?? ""}/.bun/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(Boolean);

  for (const directory of [...pathEntries, ...commonDirectories]) {
    const candidate = path.join(directory, "bun");
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function baseState(): DispatchState {
  const paths = dispatchPaths();
  const rawConfig = loadDispatchConfig();
  const relay = typeof rawConfig.relay === "string" && rawConfig.relay.trim().length > 0
    ? rawConfig.relay.trim()
    : null;
  const workspaceRoot = typeof (rawConfig.workspace as { root?: string } | undefined)?.root === "string"
    ? ((rawConfig.workspace as { root?: string }).root ?? null)
    : null;
  const secure = rawConfig.secure !== false;
  const sessions = Array.isArray(rawConfig.sessions) ? rawConfig.sessions : [];
  const log = readLogTail(paths.logPath);

  return {
    status: "stopped",
    statusLabel: "Stopped",
    statusDetail: relay
      ? "Start Dispatch to launch the pairing relay and generate a fresh QR code."
      : "Start Dispatch to launch the pairing relay and generate a fresh QR code.",
    isRunning: false,
    commandLabel: "bun run dispatch:start",
    configPath: paths.configPath,
    identityPath: paths.identityPath,
    trustedPeersPath: paths.trustedPeersPath,
    logPath: paths.logPath,
    relay,
    configuredRelay: relay,
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
  #child: ChildProcessWithoutNullStreams | null = null;
  #stdoutBuffer = "";
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #intentionalStop = false;
  #launchFailed = false;
  #fatalDetail: string | null = null;

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
    const shouldRestart = Boolean(this.#child);
    this.#refreshFileBackedState();

    if (shouldRestart) {
      await this.#restart();
    }

    this.#refreshFileBackedState();
    return this.#state;
  }

  async stop(): Promise<DispatchState> {
    this.#intentionalStop = true;
    this.#clearRestartTimer();
    if (this.#child) {
      this.#child.kill("SIGTERM");
      this.#child = null;
    }
    this.#state = {
      ...this.#state,
      status: "stopped",
      statusLabel: "Stopped",
      statusDetail: "Dispatch service is stopped. Start it to generate a fresh QR code.",
      isRunning: false,
      pairing: null,
      lastUpdatedLabel: this.#timeLabel(),
    };
    return this.#state;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  async #startIfNeeded() {
    this.#refreshFileBackedState();

    if (this.#child) {
      return;
    }

    this.#start();
  }

  async #restart() {
    await this.stop();
    this.#intentionalStop = false;
    this.#start();
  }

  #start() {
    this.#clearRestartTimer();
    this.#stdoutBuffer = "";
    this.#launchFailed = false;
    this.#fatalDetail = null;
    this.#state = {
      ...this.#state,
      status: "starting",
      statusLabel: "Starting",
      statusDetail: "Launching Dispatch pair mode.",
      isRunning: true,
      pairing: null,
      lastUpdatedLabel: this.#timeLabel(),
    };

    const bunExecutable = resolveBunExecutable();
    if (!bunExecutable) {
      this.#state = {
        ...this.#state,
        status: "error",
        statusLabel: "Error",
        statusDetail: "Bun executable was not found. Install Bun or set OPENSCOUT_BUN_BIN.",
        isRunning: false,
        pairing: null,
        lastUpdatedLabel: this.#timeLabel(),
      };
      return;
    }

    const child = spawn(bunExecutable, [DISPATCH_MAIN, "start"], {
      cwd: DISPATCH_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.#intentionalStop = false;
    this.#child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.#stdoutBuffer += chunk;
      this.#drainStdoutBuffer();
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const detail = chunk.trim();
      if (!detail) {
        return;
      }
      this.#fatalDetail = simplifyDispatchFailure(detail);
      this.#state = {
        ...this.#state,
        status: "error",
        statusLabel: "Error",
        statusDetail: this.#fatalDetail,
        isRunning: false,
        lastUpdatedLabel: this.#timeLabel(),
      };
    });

    child.on("error", (error) => {
      this.#launchFailed = true;
      this.#child = null;
      this.#state = {
        ...this.#state,
        status: "error",
        statusLabel: "Error",
        statusDetail: error.message,
        isRunning: false,
        pairing: null,
        lastUpdatedLabel: this.#timeLabel(),
      };
    });

    child.on("close", (code, signal) => {
      const wasIntentional = this.#intentionalStop;
      const launchFailed = this.#launchFailed;
      this.#child = null;
      if (wasIntentional) {
        this.#intentionalStop = false;
        this.#state = {
          ...this.#state,
          status: "stopped",
          statusLabel: "Stopped",
          statusDetail: "Dispatch service is stopped. Start it to generate a fresh QR code.",
          isRunning: false,
          pairing: null,
          lastUpdatedLabel: this.#timeLabel(),
        };
        return;
      }

      if (launchFailed) {
        this.#launchFailed = false;
        return;
      }

      if (this.#fatalDetail) {
        this.#state = {
          ...this.#state,
          status: "error",
          statusLabel: "Error",
          statusDetail: this.#fatalDetail,
          isRunning: false,
          pairing: null,
          lastUpdatedLabel: this.#timeLabel(),
        };
        this.#fatalDetail = null;
        return;
      }

      this.#state = {
        ...this.#state,
        status: "closed",
        statusLabel: "Closed",
        statusDetail: code === 0
          ? "Dispatch pair mode stopped."
          : signal
            ? `Dispatch pair mode exited (${signal}).`
            : `Dispatch pair mode exited (${code ?? "unknown"}).`,
        isRunning: false,
        lastUpdatedLabel: this.#timeLabel(),
      };

      this.#restartTimer = setTimeout(() => {
        this.#restartTimer = null;
        void this.#restart();
      }, 2_000);
    });
  }

  #drainStdoutBuffer() {
    while (true) {
      const newlineIndex = this.#stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = this.#stdoutBuffer.slice(0, newlineIndex).trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newlineIndex + 1);
      if (!line.startsWith("{")) {
        continue;
      }

      try {
        this.#handlePairingEvent(JSON.parse(line) as PairingEvent);
      } catch {
        // Ignore malformed event lines.
      }
    }
  }

  #handlePairingEvent(event: PairingEvent) {
    if (event.type === "pairing_ready") {
      this.#state = {
        ...this.#state,
        relay: event.relay,
        identityFingerprint: event.identityFingerprint,
        trustedPeerCount: event.trustedPeerCount,
        pairing: {
          relay: event.payload.relay,
          room: event.payload.room,
          publicKey: event.payload.publicKey,
          expiresAt: event.payload.expiresAt,
          qrArt: event.qrArt,
          qrValue: JSON.stringify(event.payload),
        },
        status: "connecting",
        statusLabel: "Pairing Ready",
        statusDetail: `Relay room ${event.payload.room} is waiting for Dispatch.`,
        isRunning: true,
        lastUpdatedLabel: this.#timeLabel(),
      };
      this.#scheduleExpiryRefresh(event.payload.expiresAt);
      return;
    }

    const labelByStatus: Record<PairingStatusEvent["status"], string> = {
      connecting: "Connecting",
      connected: "Connected",
      paired: "Paired",
      closed: "Closed",
      error: "Error",
    };

    this.#state = {
      ...this.#state,
      status: event.status,
      statusLabel: labelByStatus[event.status],
      statusDetail: event.detail,
      isRunning: event.status !== "closed" && event.status !== "error",
      lastUpdatedLabel: this.#timeLabel(),
    };
  }

  #scheduleExpiryRefresh(expiresAt: number) {
    this.#clearRestartTimer();
    const delay = Math.max(1_000, expiresAt - Date.now() - PAIR_REFRESH_LEEWAY_MS);
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      void this.#restart();
    }, delay);
  }

  #clearRestartTimer() {
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
  }

  #refreshFileBackedState() {
    const nextBase = baseState();
    this.#state = {
      ...this.#state,
      commandLabel: nextBase.commandLabel,
      configPath: nextBase.configPath,
      identityPath: nextBase.identityPath,
      trustedPeersPath: nextBase.trustedPeersPath,
      logPath: nextBase.logPath,
      relay: this.#child && this.#state.relay ? this.#state.relay : (nextBase.relay ?? this.#state.relay),
      configuredRelay: nextBase.configuredRelay,
      secure: nextBase.secure,
      workspaceRoot: nextBase.workspaceRoot,
      sessionCount: nextBase.sessionCount,
      identityFingerprint: nextBase.identityFingerprint,
      trustedPeerCount: nextBase.trustedPeerCount,
      logTail: nextBase.logTail,
      logUpdatedAtLabel: nextBase.logUpdatedAtLabel,
      logMissing: nextBase.logMissing,
      logTruncated: nextBase.logTruncated,
      lastUpdatedLabel: this.#state.lastUpdatedLabel ?? nextBase.lastUpdatedLabel,
    };
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

function simplifyDispatchFailure(detail: string) {
  if (/EADDRINUSE|address already in use/i.test(detail)) {
    return "Dispatch could not start because the pairing relay port is already in use. Stop the other Dispatch process or restart the relay.";
  }
  return detail;
}
