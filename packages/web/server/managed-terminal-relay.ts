import { existsSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ManagedTerminalRelay = {
  healthcheck: () => Promise<boolean>;
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

const TERMINAL_RELAY_HEALTH_SURFACE = "openscout-terminal-relay";
const AUTO_RELAY_PORT_ATTEMPTS = 16;

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

export async function isTerminalRelayHealthy(targetHttpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${targetHttpUrl}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) {
      return false;
    }
    return isTerminalRelayHealthPayload(await response.json().catch(() => null));
  } catch {
    return false;
  }
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
        "node-pty",
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

export async function startManagedTerminalRelay(args: {
  hostname: string;
  webPort: number;
}): Promise<ManagedTerminalRelay> {
  const relayPortPreference = relayPortPreferenceForWebPort(args.webPort);
  const bindHost = relayHostForWebHost(args.hostname);
  const loopbackHost = relayLoopbackHost(bindHost);
  const preferredTargetHttpUrl = `http://${loopbackHost}:${relayPortPreference.port}`;
  const preferredTargetWebSocketUrl = `ws://${loopbackHost}:${relayPortPreference.port}`;

  if (await isTerminalRelayHealthy(preferredTargetHttpUrl)) {
    return createManagedRelayHandle(preferredTargetHttpUrl, preferredTargetWebSocketUrl);
  }

  const runtimeEntry = resolveRuntimeEntry();

  for (let offset = 0; offset < AUTO_RELAY_PORT_ATTEMPTS; offset += 1) {
    const relayPort = relayPortPreference.port + offset;
    const targetHttpUrl = `http://${loopbackHost}:${relayPort}`;
    const targetWebSocketUrl = `ws://${loopbackHost}:${relayPort}`;
    const portAvailable = await canListenOnPort(bindHost, relayPort);

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

    return startRelayProcess({
      runtimeEntry,
      bindHost,
      relayPort,
      targetHttpUrl,
      targetWebSocketUrl,
    });
  }

  throw new Error(
    `Could not find an available terminal relay port starting at ${relayPortPreference.port}`,
  );
}

function createManagedRelayHandle(
  targetHttpUrl: string,
  targetWebSocketUrl: string,
  child?: ChildProcess,
): ManagedTerminalRelay {
  return {
    healthcheck: () => isTerminalRelayHealthy(targetHttpUrl),
    queueCommand: async (request: TerminalRelayRunRequest) => {
      const response = await fetch(`${targetHttpUrl}/api/terminal/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error("Terminal relay rejected queued command");
      }
    },
    shutdown() {
      if (child) {
        terminateChild(child);
      }
    },
    targetHttpUrl,
    targetWebSocketUrl,
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
    return createManagedRelayHandle(input.targetHttpUrl, input.targetWebSocketUrl, child);
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
