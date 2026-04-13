#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(binDir, "..");
const client = join(root, "dist", "client");
const packageJsonPath = join(root, "package.json");

if (!process.env.SCOUT_APP_VERSION && existsSync(packageJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      process.env.SCOUT_APP_VERSION = pkg.version.trim();
    }
  } catch {
    // ignore
  }
}

/**
 * Control-plane stack: spawn `scout server control-plane start`, which runs Bun against
 * `scout-control-plane-web.mjs` (pairing + relay/shell APIs only), not the full desktop web server.
 * This package ships only static UI assets.
 *
 * @returns {{ executable: string, prefixArgs: string[] }}
 */
function resolveScoutLauncher() {
  const envBin = process.env.OPENSCOUT_SCOUT_BIN?.trim();
  if (envBin) {
    if (envBin.endsWith(".mjs") || envBin.endsWith(".cjs")) {
      return { executable: process.execPath, prefixArgs: [envBin] };
    }
    return { executable: envBin, prefixArgs: [] };
  }

  const siblingCli = resolve(root, "..", "cli", "bin", "scout.mjs");
  if (existsSync(siblingCli)) {
    return { executable: process.execPath, prefixArgs: [siblingCli] };
  }

  const hoisted = resolve(root, "node_modules", "@openscout", "scout", "bin", "scout.mjs");
  if (existsSync(hoisted)) {
    return { executable: process.execPath, prefixArgs: [hoisted] };
  }

  return { executable: "scout", prefixArgs: [] };
}

const argv = process.argv.slice(2);
if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
  console.log(`openscout-web — minimal Scout UI over HTTP

Runs \`scout server control-plane start\` with this package’s static UI: pairing QR
and the current activity stream. Uses the control-plane HTTP surface only (not the full desktop web API).

Install @openscout/scout (or \`scout\` on PATH), plus Bun for the server process.

Usage:
  openscout-web [options]

Options:
  --port <n>   Listen port (default 3200; env SCOUT_WEB_PORT)
  --cwd <dir>  Workspace root (env OPENSCOUT_SETUP_CWD)

Env:
  OPENSCOUT_SCOUT_BIN   Path to scout.mjs or a \`scout\` executable (optional)

Static UI: ${client}
`);
  process.exit(0);
}

if (!existsSync(join(client, "index.html"))) {
  console.error("@openscout/web: dist/client is missing. Reinstall the package or run npm run build.");
  process.exit(1);
}

const forwardArgs = [];
const env = { ...process.env };

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--port") {
    const v = argv[++i];
    if (!v) {
      console.error("openscout-web: --port requires a value");
      process.exit(1);
    }
    forwardArgs.push("--port", v);
    continue;
  }
  if (a === "--cwd") {
    const v = argv[++i];
    if (!v) {
      console.error("openscout-web: --cwd requires a value");
      process.exit(1);
    }
    forwardArgs.push("--cwd", v);
    continue;
  }
  console.error(`openscout-web: unknown argument: ${a}`);
  console.error("Try: openscout-web --help");
  process.exit(1);
}

const { executable, prefixArgs } = resolveScoutLauncher();
const scoutArgs = [
  ...prefixArgs,
  "server",
  "control-plane",
  "start",
  "--static",
  "--static-root",
  client,
  ...forwardArgs,
];

const child = spawn(executable, scoutArgs, { stdio: "inherit", env });
child.on("error", (err) => {
  if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
    console.error(
      "openscout-web: could not run Scout. Install @openscout/scout globally or locally, " +
        "or set OPENSCOUT_SCOUT_BIN to your scout.mjs / scout executable.",
    );
    process.exit(1);
  }
  throw err;
});
child.on("exit", (code, signal) => {
  if (signal === "SIGINT" || signal === "SIGTERM") {
    process.exit(0);
  }
  process.exit(code ?? 1);
});
