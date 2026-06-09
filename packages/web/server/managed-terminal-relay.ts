import { existsSync } from "node:fs";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TERMINAL_RELAY_HEALTH_SURFACE = "openscout-terminal-relay";
const AUTO_RELAY_PORT_ATTEMPTS = 16;

export type TerminalRelayHealth = {
  ok: true;
  surface: typeof TERMINAL_RELAY_HEALTH_SURFACE;
  pid?: number;
  sessions?: number;
  attachedSessions?: number;
};

export type ManagedTerminalRelay = {
  healthcheck: () => Promise<boolean>;
  readHealth: () => Promise<TerminalRelayHealth | null>;
  queueCommand: (request: TerminalRelayRunRequest) => Promise<void>;
  shutdown: () => void;
  targetHttpUrl: string;
  targetWebSocketUrl: string;
};

export type TerminalRelayRunRequest = {
  command: string;
  cwd?: string | null;
  agentId?: string | null;
};

function relayPortPreferenceForWebPort(webPort: number): { port: number; configured: boolean } {
  const configured = process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PORT?.trim();
  if (configured) {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { port: parsed, configured: true };
    }
  }
  return { port: webPort + 1, configured: false };
}

function relayHostForWebHost(hostname: string): string {
  return process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HOST?.trim() || hostname;
}

function relayLoopbackHost(hostname: string): string {
  if (hostname === "0.0.0.0" || hostname === "::") {
    return "127.0.0.1";
  }
  return hostname;
}

function isTerminalRelayHealthPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const body = value as { ok?: unknown; surface?: unknown };
  return body.ok === true && body.surface === TERMINAL_RELAY_HEALTH_SURFACE;
}

export async function readTerminalRelayHealth(targetHttpUrl: string): Promise<TerminalRelayHealth | null> {
  try {
    const response = await fetch(`${targetHttpUrl}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json().catch(() => null);
    if (!isTerminalRelayHealthPayload(payload)) {
      return null;
    }
    const body = payload as TerminalRelayHealth;
    return {
      ok: true,
      surface: TERMINAL_RELAY_HEALTH_SURFACE,
      ...(Number.isFinite(body.pid) ? { pid: body.pid } : {}),
      ...(Number.isFinite(body.sessions) ? { sessions: body.sessions } : {}),
      ...(Number.isFinite(body.attachedSessions) ? { attachedSessions: body.attachedSessions } : {}),
    };
  } catch {
    return null;
  }
}

export async function isTerminalRelayHealthy(targetHttpUrl: string): Promise<boolean> {
  return (await readTerminalRelayHealth(targetHttpUrl)) !== null;
}

async function waitForHealthy(
  targetHttpUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTerminalRelayHealthy(targetHttpUrl)) {
      return true;
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 100));
  }
  return false;
}

async function canListenOnPort(hostname: string, port: number): Promise<boolean> {
  return new Promise((resolveListen) => {
    const server = createTcpServer();
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveListen(available);
    };

    server.once("error", () => finish(false));
    server.once("listening", () => {
      server.close(() => finish(true));
    });
    server.listen(port, hostname);
  });
}

async function waitForPortAvailable(hostname: string, port: number, timeoutMs = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canListenOnPort(hostname, port)) {
      return true;
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
  }
  return false;
}

function resolveRuntimeEntry(): string {
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const sourceEntry = resolve(selfDir, "terminal-relay-node.ts");
  const bundledEntry = resolve(selfDir, "openscout-terminal-relay.mjs");
  const sourceBundle = resolve(selfDir, "../dist/openscout-terminal-relay.mjs");

  if (existsSync(sourceEntry)) {
    const build = spawnSync(
      "bun",
      [
        "build",
        sourceEntry,
        "--target=node",
        "--format=esm",
        "--outfile",
        sourceBundle,
        "--external",
        "@lydell/node-pty",
      ],
      {
        cwd: resolve(selfDir, ".."),
        stdio: "inherit",
      },
    );
    if ((build.status ?? 1) !== 0) {
      throw new Error("Failed to build terminal relay bundle");
    }
    return sourceBundle;
  }

  if (existsSync(bundledEntry)) {
    return bundledEntry;
  }

  throw new Error("Could not locate the terminal relay runtime entry");
}

function relayPortRange(preferredPort: number): number[] {
  return Array.from({ length: AUTO_RELAY_PORT_ATTEMPTS }, (_, offset) => preferredPort + offset);
}

function tcpListenerPid(port: number): number | null {
  try {
    const output = execFileSync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fp",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = output.match(/^p(\d+)/m);
    if (!match) return null;
    const pid = Number.parseInt(match[1], 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function processField(pid: number, field: "command" | "ppid"): string | null {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function processParentPid(pid: number): number | null {
  const raw = processField(pid, "ppid");
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRelayProcess(pid: number): boolean {
  const command = processField(pid, "command") ?? "";
  return /\bscout-relay\b|openscout-terminal-relay|terminal-relay-node/.test(command);
}

function relayPidOwnedByThisWebProcess(pid: number | null): pid is number {
  return Boolean(pid && pid !== process.pid && processParentPid(pid) === process.pid && isRelayProcess(pid));
}

function terminateRelayPid(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function terminateOwnedRelayListener(port: number, keepPid: number | null): boolean {
  const pid = tcpListenerPid(port);
  if (!relayPidOwnedByThisWebProcess(pid) || pid === keepPid) {
    return false;
  }
  return terminateRelayPid(pid);
}

function cleanupOwnedRelayListeners(ports: number[], keepPort: number): void {
  const keepPid = tcpListenerPid(keepPort);
  for (const port of ports) {
    if (port === keepPort) continue;
    terminateOwnedRelayListener(port, keepPid);
  }
}

export async function startManagedTerminalRelay(args: {
  hostname: string;
  webPort: number;
}): Promise<ManagedTerminalRelay> {
  const relayPortPreference = relayPortPreferenceForWebPort(args.webPort);
  const bindHost = relayHostForWebHost(args.hostname);
  const loopbackHost = relayLoopbackHost(bindHost);
  const ports = relayPortRange(relayPortPreference.port);
  const preferredTargetHttpUrl = `http://${loopbackHost}:${relayPortPreference.port}`;
  const preferredTargetWebSocketUrl = `ws://${loopbackHost}:${relayPortPreference.port}`;
  const preferredHealth = await readTerminalRelayHealth(preferredTargetHttpUrl);

  if (preferredHealth) {
    cleanupOwnedRelayListeners(ports, relayPortPreference.port);
    const listenerPid = preferredHealth.pid ?? tcpListenerPid(relayPortPreference.port);
    return createManagedRelayHandle({
      targetHttpUrl: preferredTargetHttpUrl,
      targetWebSocketUrl: preferredTargetWebSocketUrl,
      ownedPid: relayPidOwnedByThisWebProcess(listenerPid) ? listenerPid : null,
    });
  }

  let preferredPortAvailable = await canListenOnPort(bindHost, relayPortPreference.port);
  if (!preferredPortAvailable && terminateOwnedRelayListener(relayPortPreference.port, null)) {
    preferredPortAvailable = await waitForPortAvailable(bindHost, relayPortPreference.port);
  }

  if (!relayPortPreference.configured && !preferredPortAvailable) {
    for (const relayPort of ports.slice(1)) {
      const targetHttpUrl = `http://${loopbackHost}:${relayPort}`;
      const targetWebSocketUrl = `ws://${loopbackHost}:${relayPort}`;
      const health = await readTerminalRelayHealth(targetHttpUrl);
      if (!health) continue;
      console.warn(
        `[relay] Reusing existing terminal relay on port ${relayPort}; preferred port ${relayPortPreference.port} is occupied`,
      );
      cleanupOwnedRelayListeners(ports, relayPort);
      const listenerPid = health.pid ?? tcpListenerPid(relayPort);
      return createManagedRelayHandle({
        targetHttpUrl,
        targetWebSocketUrl,
        ownedPid: relayPidOwnedByThisWebProcess(listenerPid) ? listenerPid : null,
      });
    }
  }

  const runtimeEntry = resolveRuntimeEntry();

  for (let offset = 0; offset < ports.length; offset += 1) {
    const relayPort = ports[offset]!;
    const targetHttpUrl = `http://${loopbackHost}:${relayPort}`;
    const targetWebSocketUrl = `ws://${loopbackHost}:${relayPort}`;
    let portAvailable = relayPort === relayPortPreference.port
      ? preferredPortAvailable
      : await canListenOnPort(bindHost, relayPort);

    if (!portAvailable) {
      if (terminateOwnedRelayListener(relayPort, null)) {
        portAvailable = await waitForPortAvailable(bindHost, relayPort);
      }
    }

    if (!portAvailable) {
      if (relayPortPreference.configured) {
        throw new Error(
          `Configured terminal relay port ${relayPort} is already in use and is not an OpenScout terminal relay`,
        );
      }
      if (offset === 0) {
        console.warn(
          `[relay] Terminal relay port ${relayPort} is occupied by another service; trying the next available port`,
        );
      }
      continue;
    }

    const relay = await startRelayProcess({
      runtimeEntry,
      bindHost,
      relayPort,
      targetHttpUrl,
      targetWebSocketUrl,
    });
    cleanupOwnedRelayListeners(ports, relayPort);
    return relay;
  }

  throw new Error(
    `Could not find an available terminal relay port starting at ${relayPortPreference.port}`,
  );
}

function createManagedRelayHandle(input: {
  targetHttpUrl: string;
  targetWebSocketUrl: string;
  child?: ChildProcess;
  ownedPid?: number | null;
}): ManagedTerminalRelay {
  return {
    healthcheck: () => isTerminalRelayHealthy(input.targetHttpUrl),
    readHealth: () => readTerminalRelayHealth(input.targetHttpUrl),
    queueCommand: async (request: TerminalRelayRunRequest) => {
      const response = await fetch(`${input.targetHttpUrl}/api/terminal/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error("Terminal relay rejected queued command");
      }
    },
    shutdown() {
      if (input.child) {
        terminateChild(input.child);
        return;
      }
      if (input.ownedPid) {
        terminateRelayPid(input.ownedPid);
      }
    },
    targetHttpUrl: input.targetHttpUrl,
    targetWebSocketUrl: input.targetWebSocketUrl,
  };
}

async function startRelayProcess(input: {
  runtimeEntry: string;
  bindHost: string;
  relayPort: number;
  targetHttpUrl: string;
  targetWebSocketUrl: string;
}): Promise<ManagedTerminalRelay> {
  const child = spawn(
    "node",
    [input.runtimeEntry],
    {
      argv0: "scout-relay",
      cwd: resolve(dirname(input.runtimeEntry), ".."),
      env: {
        ...process.env,
        OPENSCOUT_WEB_TERMINAL_RELAY_HOST: input.bindHost,
        OPENSCOUT_WEB_TERMINAL_RELAY_PORT: String(input.relayPort),
      },
      stdio: "inherit",
    },
  );

  let spawnError: Error | null = null;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") {
      return;
    }
    console.error(
      `[relay] Managed terminal relay exited unexpectedly (code: ${code ?? "null"}, signal: ${signal ?? "none"})`,
    );
  });

  const ready = await waitForHealthy(input.targetHttpUrl, 5000);
  if (ready) {
    return createManagedRelayHandle({
      targetHttpUrl: input.targetHttpUrl,
      targetWebSocketUrl: input.targetWebSocketUrl,
      child,
    });
  }

  if (!child.killed) {
    child.kill("SIGTERM");
  }
  if (spawnError) {
    throw spawnError;
  }
  throw new Error(`Terminal relay did not become healthy at ${input.targetHttpUrl}`);
}

function terminateChild(child: ChildProcess) {
  if (child.killed) {
    return;
  }
  child.kill("SIGTERM");
}
