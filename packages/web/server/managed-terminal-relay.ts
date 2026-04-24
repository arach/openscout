import { existsSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ManagedTerminalRelay = {
  healthcheck: () => Promise<boolean>;
  queueCommand: (command: string) => Promise<void>;
  shutdown: () => void;
  targetHttpUrl: string;
  targetWebSocketUrl: string;
};

function relayPortForWebPort(webPort: number): number {
  const configured = process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PORT?.trim();
  if (configured) {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return webPort + 1;
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

async function isHealthy(targetHttpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${targetHttpUrl}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
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
    if (await isHealthy(targetHttpUrl)) {
      return true;
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 100));
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
  const relayPort = relayPortForWebPort(args.webPort);
  const bindHost = relayHostForWebHost(args.hostname);
  const loopbackHost = relayLoopbackHost(bindHost);
  const targetHttpUrl = `http://${loopbackHost}:${relayPort}`;
  const targetWebSocketUrl = `ws://${loopbackHost}:${relayPort}`;

  if (await isHealthy(targetHttpUrl)) {
    return {
      healthcheck: () => isHealthy(targetHttpUrl),
      queueCommand: async (command: string) => {
        const response = await fetch(`${targetHttpUrl}/api/terminal/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command }),
        });
        if (!response.ok) {
          throw new Error("Terminal relay rejected queued command");
        }
      },
      shutdown() {},
      targetHttpUrl,
      targetWebSocketUrl,
    };
  }

  const runtimeEntry = resolveRuntimeEntry();
  const child = spawn(
    "node",
    [runtimeEntry],
    {
      cwd: resolve(dirname(runtimeEntry), ".."),
      env: {
        ...process.env,
        OPENSCOUT_WEB_TERMINAL_RELAY_HOST: bindHost,
        OPENSCOUT_WEB_TERMINAL_RELAY_PORT: String(relayPort),
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

  const ready = await waitForHealthy(targetHttpUrl, 5000);
  if (!ready) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    if (spawnError) {
      throw spawnError;
    }
    throw new Error(`Terminal relay did not become healthy at ${targetHttpUrl}`);
  }

  return {
    healthcheck: () => isHealthy(targetHttpUrl),
    queueCommand: async (command: string) => {
      const response = await fetch(`${targetHttpUrl}/api/terminal/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      if (!response.ok) {
        throw new Error("Terminal relay rejected queued command");
      }
    },
    shutdown() {
      terminateChild(child);
    },
    targetHttpUrl,
    targetWebSocketUrl,
  };
}

function terminateChild(child: ChildProcess) {
  if (child.killed) {
    return;
  }
  child.kill("SIGTERM");
}
