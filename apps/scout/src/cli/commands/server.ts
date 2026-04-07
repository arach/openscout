import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";

export function renderServerCommandHelp(): string {
  return [
    "scout server — desktop web UI (Bun runtime)",
    "",
    "Usage:",
    "  scout server start [options]",
    "",
    "Options:",
    "  --port <n>        Listen port (default 3200; env SCOUT_WEB_PORT)",
    "  --static          Serve built UI from disk (sets SCOUT_STATIC=1)",
    "  --static-root DIR Static client root (env SCOUT_STATIC_ROOT)",
    "  --vite-url URL    Dev proxy target for non-API routes (env SCOUT_VITE_URL)",
    "  --cwd DIR         Workspace / setup root (env OPENSCOUT_SETUP_CWD)",
    "",
    "Requires `bun` on PATH. Published installs ship a bundled server next to the CLI.",
  ].join("\n");
}

/**
 * Resolved against `import.meta.url`: published CLI has `scout-web-server.mjs` beside `main.mjs`;
 * in-repo dev uses `apps/scout/src/server/index.ts`.
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

function parseServerStartFlags(args: string[]): {
  env: Record<string, string>;
} {
  const env: Record<string, string> = {};
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
    throw new ScoutCliError(`unknown option: ${a}`);
  }
  return { env };
}

export async function runServerCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    context.output.writeText(renderServerCommandHelp());
    return;
  }

  if (args[0] !== "start") {
    throw new ScoutCliError(`unknown subcommand: ${args[0]} (try: scout server start)`);
  }

  const { env: flagEnv } = parseServerStartFlags(args.slice(1));
  const entry = resolveScoutWebServerEntry();
  const mergedEnv = { ...process.env, ...flagEnv } as NodeJS.ProcessEnv;

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["run", entry], {
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
