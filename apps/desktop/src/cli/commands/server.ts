import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalConfig } from "@openscout/runtime/local-config";

import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";

type ScoutServerMode = "full" | "control-plane";
type ScoutServerAction = "start" | "open";

type ScoutServerHealth = {
  ok: true;
  surface: "full" | "control-plane" | "openscout-web";
  currentDirectory: string;
};

type ScoutServerOpenResult = {
  url: string;
  port: number;
  mode: ScoutServerMode;
  reusedExistingServer: boolean;
};

const SERVER_OPEN_TIMEOUT_MS = 15_000;
const SERVER_HEALTH_TIMEOUT_MS = 1_500;

export function renderServerCommandHelp(): string {
  return [
    "scout server — desktop web UI (Bun runtime)",
    "",
    "Usage:",
    "  scout server start [options]",
    "  scout server open [options]",
    "  scout server control-plane start [options]",
    "  scout server control-plane open [options]",
    "",
    "Subcommands:",
    "  start              Full desktop web API + UI assets (default stack).",
    "  open               Open the full web UI and start it on demand if needed.",
    "  control-plane start Pairing + relay/shell activity only (`@openscout/web` surface).",
    "  control-plane open  Open the control-plane UI and start it on demand if needed.",
    "",
    "Options:",
    "  --port <n>        Listen port (default 3200; env SCOUT_WEB_PORT)",
    "  --static          Serve built UI from disk (sets SCOUT_STATIC=1)",
    "  --static-root DIR Static client root (env SCOUT_STATIC_ROOT)",
    "  --vite-url URL    Dev proxy target for non-API routes (env SCOUT_VITE_URL)",
    "  --cwd DIR         Workspace / setup root (env OPENSCOUT_SETUP_CWD)",
    "  --path PATH       Browser path for `open` (default /)",
    "",
    "Requires `bun` on PATH.",
    "Published installs include dist/client for the full web UI and dist/control-plane-client",
    "for the minimal control-plane UI; if present and you do not pass --vite-url, the matching",
    "static assets are used by default.",
  ].join("\n");
}

/**
 * Resolved against `import.meta.url`: published CLI has `scout-web-server.mjs` beside `main.mjs`;
 * in-repo dev uses `apps/desktop/src/server/index.ts`.
 */
export function resolveScoutWebServerEntry(): string {
  const mainDir = dirname(fileURLToPath(import.meta.url));
  const bundled = join(mainDir, "scout-web-server.mjs");
  if (existsSync(bundled)) {
    return bundled;
  }
  const source = fileURLToPath(new URL("../../server/index.ts", import.meta.url));
  if (existsSync(source)) {
    return source;
  }
  throw new ScoutCliError(
    "Could not find Scout web server entry. Rebuild @openscout/scout or run from the OpenScout repository.",
  );
}

export function resolveScoutControlPlaneWebServerEntry(): string {
  const mainDir = dirname(fileURLToPath(import.meta.url));
  const bundled = join(mainDir, "scout-control-plane-web.mjs");
  if (existsSync(bundled)) {
    return bundled;
  }
  const source = fileURLToPath(new URL("../../server/control-plane-index.ts", import.meta.url));
  if (existsSync(source)) {
    return source;
  }
  throw new ScoutCliError(
    "Could not find Scout control-plane web server entry. Rebuild @openscout/scout or run from the OpenScout repository.",
  );
}

function parseServerFlags(args: string[]): {
  env: Record<string, string>;
  openPath: string;
} {
  const env: Record<string, string> = {};
  let openPath = "/";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port") {
      const v = args[++i];
      if (!v) throw new ScoutCliError("--port requires a value");
      env.SCOUT_WEB_PORT = v;
      continue;
    }
    if (a === "--static") {
      env.SCOUT_STATIC = "1";
      continue;
    }
    if (a === "--static-root") {
      const v = args[++i];
      if (!v) throw new ScoutCliError("--static-root requires a value");
      env.SCOUT_STATIC_ROOT = v;
      continue;
    }
    if (a === "--vite-url") {
      const v = args[++i];
      if (!v) throw new ScoutCliError("--vite-url requires a value");
      env.SCOUT_VITE_URL = v;
      continue;
    }
    if (a === "--cwd") {
      const v = args[++i];
      if (!v) throw new ScoutCliError("--cwd requires a value");
      env.OPENSCOUT_SETUP_CWD = v;
      continue;
    }
    if (a === "--path") {
      const v = args[++i];
      if (!v) throw new ScoutCliError("--path requires a value");
      openPath = v;
      continue;
    }
    if (a.startsWith("--port=")) {
      env.SCOUT_WEB_PORT = a.slice("--port=".length);
      continue;
    }
    if (a.startsWith("--static-root=")) {
      env.SCOUT_STATIC_ROOT = a.slice("--static-root=".length);
      continue;
    }
    if (a.startsWith("--vite-url=")) {
      env.SCOUT_VITE_URL = a.slice("--vite-url=".length);
      continue;
    }
    if (a.startsWith("--cwd=")) {
      env.OPENSCOUT_SETUP_CWD = a.slice("--cwd=".length);
      continue;
    }
    if (a.startsWith("--path=")) {
      openPath = a.slice("--path=".length);
      continue;
    }
    throw new ScoutCliError(`unknown option: ${a}`);
  }

  return { env, openPath };
}

function resolveBundledStaticClientRoot(entry: string, mode: ScoutServerMode): string | null {
  const entryDir = dirname(entry);
  const clientDirectory = mode === "control-plane"
    ? join(entryDir, "control-plane-client")
    : join(entryDir, "client");
  const indexPath = join(clientDirectory, "index.html");
  return existsSync(indexPath) ? clientDirectory : null;
}

function buildMergedServerEnv(entry: string, mode: ScoutServerMode, flagEnv: Record<string, string>): NodeJS.ProcessEnv {
  const bundledStaticClientRoot = resolveBundledStaticClientRoot(entry, mode);
  const autoEnv: Record<string, string> = {};
  if (bundledStaticClientRoot) {
    const wantsVite = Boolean(flagEnv.SCOUT_VITE_URL ?? process.env.SCOUT_VITE_URL);
    if (!wantsVite) {
      autoEnv.SCOUT_STATIC = "1";
      autoEnv.SCOUT_STATIC_ROOT = bundledStaticClientRoot;
    }
  }
  return { ...process.env, ...autoEnv, ...flagEnv } as NodeJS.ProcessEnv;
}

function parseServerSelection(args: string[]): {
  action: ScoutServerAction;
  flagArgs: string[];
  entry: string;
  mode: ScoutServerMode;
} {
  if (args[0] === "start") {
    return {
      action: "start",
      flagArgs: args.slice(1),
      entry: resolveScoutWebServerEntry(),
      mode: "full",
    };
  }
  if (args[0] === "open") {
    return {
      action: "open",
      flagArgs: args.slice(1),
      entry: resolveScoutWebServerEntry(),
      mode: "full",
    };
  }
  if (args[0] === "control-plane") {
    if (args[1] !== "start" && args[1] !== "open") {
      throw new ScoutCliError("expected: scout server control-plane <start|open>");
    }
    return {
      action: args[1],
      flagArgs: args.slice(2),
      entry: resolveScoutControlPlaneWebServerEntry(),
      mode: "control-plane",
    };
  }
  throw new ScoutCliError(`unknown subcommand: ${args[0]} (try: scout server open)`);
}

export function normalizeServerOpenPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    throw new ScoutCliError("--path must be a local path, not an absolute URL");
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  return `/${trimmed}`;
}

function resolveServerPort(env: NodeJS.ProcessEnv): number {
  const envValue = env.SCOUT_WEB_PORT?.trim();
  if (envValue) {
    const port = Number.parseInt(envValue, 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new ScoutCliError(`invalid port: ${envValue}`);
    }
    return port;
  }
  const fromFile = loadLocalConfig().ports?.web;
  if (fromFile) return fromFile;
  return 3200;
}

function resolveExpectedCurrentDirectory(env: NodeJS.ProcessEnv): string {
  return resolve(env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd());
}

function renderModeLabel(mode: ScoutServerMode): string {
  return mode === "control-plane" ? "Scout control plane" : "Scout";
}

function renderSurfaceLabel(surface: ScoutServerHealth["surface"]): string {
  switch (surface) {
    case "control-plane":
      return "control-plane";
    case "openscout-web":
      return "@openscout/web";
    case "full":
    default:
      return "full";
  }
}

function renderServerOpenResult(result: ScoutServerOpenResult): string {
  const prefix = result.mode === "control-plane" ? "Opened Scout control plane" : "Opened Scout";
  return `${prefix} at ${result.url}${result.reusedExistingServer ? "" : " (started server)"}`;
}

function healthUrlForPort(port: number): URL {
  return new URL(`/api/health`, `http://127.0.0.1:${port}`);
}

async function probeScoutServer(port: number): Promise<
  | { status: "healthy"; health: ScoutServerHealth }
  | { status: "unreachable" }
  | { status: "non-scout"; statusCode: number | null }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(healthUrlForPort(port), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: "non-scout",
        statusCode: response.status,
      };
    }

    let body: Partial<ScoutServerHealth>;
    try {
      body = await response.json() as Partial<ScoutServerHealth>;
    } catch {
      return {
        status: "non-scout",
        statusCode: response.status,
      };
    }

    if (
      body.ok === true
      && (body.surface === "full" || body.surface === "control-plane" || body.surface === "openscout-web")
      && typeof body.currentDirectory === "string"
    ) {
      return {
        status: "healthy",
        health: {
          ok: true,
          surface: body.surface,
          currentDirectory: body.currentDirectory,
        },
      };
    }
    return {
      status: "non-scout",
      statusCode: response.status,
    };
  } catch {
    return { status: "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

async function openBrowser(url: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let command: string;
    let args: string[];

    if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        rejectPromise(new ScoutCliError(`could not open a browser automatically; ${command} is not available`));
        return;
      }
      rejectPromise(error);
    });
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

async function spawnDetachedServer(entry: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["run", entry], {
      detached: true,
      stdio: "ignore",
      env,
      windowsHide: true,
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        rejectPromise(
          new ScoutCliError(
            "`bun` was not found on PATH. Install Bun (https://bun.sh) to run scout server.",
          ),
        );
        return;
      }
      rejectPromise(error);
    });
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

async function waitForScoutServer(
  port: number,
  mode: ScoutServerMode,
  expectedCurrentDirectory: string,
): Promise<void> {
  const deadline = Date.now() + SERVER_OPEN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const probe = await probeScoutServer(port);
    if (probe.status === "healthy") {
      const actualCurrentDirectory = resolve(probe.health.currentDirectory);
      if (probe.health.surface !== mode) {
        throw new ScoutCliError(
          `port ${port} is serving Scout ${renderSurfaceLabel(probe.health.surface)}, not ${renderModeLabel(mode)}.`,
        );
      }
      if (actualCurrentDirectory !== expectedCurrentDirectory) {
        throw new ScoutCliError(
          `port ${port} is already serving Scout for ${actualCurrentDirectory}, not ${expectedCurrentDirectory}.`,
        );
      }
      return;
    }
    if (probe.status === "non-scout") {
      throw new ScoutCliError(`port ${port} is already serving another HTTP app or an older Scout server; choose a different --port.`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new ScoutCliError(`timed out waiting for ${renderModeLabel(mode)} on port ${port}`);
}

async function openScoutServer(options: {
  entry: string;
  mode: ScoutServerMode;
  env: NodeJS.ProcessEnv;
  openPath: string;
}): Promise<ScoutServerOpenResult> {
  const port = resolveServerPort(options.env);
  const expectedCurrentDirectory = resolveExpectedCurrentDirectory(options.env);
  const browserUrl = new URL(normalizeServerOpenPath(options.openPath), `http://127.0.0.1:${port}`).toString();
  const probe = await probeScoutServer(port);

  if (probe.status === "healthy") {
    const actualCurrentDirectory = resolve(probe.health.currentDirectory);
    if (probe.health.surface !== options.mode) {
      throw new ScoutCliError(
        `port ${port} is already serving Scout ${renderSurfaceLabel(probe.health.surface)}, not ${renderModeLabel(options.mode)}.`,
      );
    }
    if (actualCurrentDirectory !== expectedCurrentDirectory) {
      throw new ScoutCliError(
        `port ${port} is already serving Scout for ${actualCurrentDirectory}, not ${expectedCurrentDirectory}.`,
      );
    }
    await openBrowser(browserUrl);
    return {
      url: browserUrl,
      port,
      mode: options.mode,
      reusedExistingServer: true,
    };
  }

  if (probe.status === "non-scout") {
    throw new ScoutCliError(`port ${port} is already serving another HTTP app or an older Scout server; choose a different --port.`);
  }

  await spawnDetachedServer(options.entry, options.env);
  await waitForScoutServer(port, options.mode, expectedCurrentDirectory);
  await openBrowser(browserUrl);
  return {
    url: browserUrl,
    port,
    mode: options.mode,
    reusedExistingServer: false,
  };
}

export async function runServerCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    context.output.writeText(renderServerCommandHelp());
    return;
  }

  const selection = parseServerSelection(args);
  const { env: flagEnv, openPath } = parseServerFlags(selection.flagArgs);
  const mergedEnv = buildMergedServerEnv(selection.entry, selection.mode, flagEnv);

  if (selection.action === "open") {
    const result = await openScoutServer({
      entry: selection.entry,
      mode: selection.mode,
      env: mergedEnv,
      openPath,
    });
    context.output.writeValue(result, renderServerOpenResult);
    return;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["run", selection.entry], {
      stdio: "inherit",
      env: mergedEnv,
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        rejectPromise(
          new ScoutCliError(
            "`bun` was not found on PATH. Install Bun (https://bun.sh) to run scout server.",
          ),
        );
        return;
      }
      rejectPromise(err);
    });
    child.on("exit", (code, signal) => {
      if (signal === "SIGINT" || signal === "SIGTERM") {
        resolvePromise();
        return;
      }
      if (signal) {
        rejectPromise(new ScoutCliError(`server exited on signal ${signal}`));
        return;
      }
      if (code !== 0 && code !== null) {
        rejectPromise(new ScoutCliError(`server exited with code ${code}`));
        return;
      }
      resolvePromise();
    });
  });
}
