#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(binDir, "..");
const client = join(root, "dist", "client");
const server = join(root, "dist", "openscout-web-server.mjs");
const packageJsonPath = join(root, "package.json");

if (!process.env.SCOUT_APP_VERSION && existsSync(packageJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      process.env.SCOUT_APP_VERSION = pkg.version.trim();
    }
  } catch {
    // ignore malformed package metadata
  }
}

const argv = process.argv.slice(2);
if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
  console.log(`openscout-web — lightweight Scout UI over HTTP

Runs this package’s standalone Bun server with the bundled static UI: pairing QR,
activity, inbox, and direct messaging for the web surface.

Requires Bun on PATH.

Usage:
  openscout-web [options]

Options:
  --port <n>         Listen port (default 3200; optional override OPENSCOUT_WEB_PORT)
  --cwd <dir>        Workspace root (optional override OPENSCOUT_SETUP_CWD)
  --vite-url <url>   Proxy non-API requests to a Vite dev server
  --static-root <d>  Override the static client directory

Static UI: ${client}
Server:    ${server}
`);
  process.exit(0);
}

if (!existsSync(join(client, "index.html")) || !existsSync(server)) {
  console.error("@openscout/web: dist assets are missing. Reinstall the package or run npm run build.");
  process.exit(1);
}

const env = { ...process.env };

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--port") {
    const v = argv[++i];
    if (!v) {
      console.error("openscout-web: --port requires a value");
      process.exit(1);
    }
    env.OPENSCOUT_WEB_PORT = v;
    continue;
  }
  if (a === "--cwd") {
    const v = argv[++i];
    if (!v) {
      console.error("openscout-web: --cwd requires a value");
      process.exit(1);
    }
    env.OPENSCOUT_SETUP_CWD = v;
    continue;
  }
  if (a === "--vite-url") {
    const v = argv[++i];
    if (!v) {
      console.error("openscout-web: --vite-url requires a value");
      process.exit(1);
    }
    env.OPENSCOUT_WEB_VITE_URL = v;
    continue;
  }
  if (a === "--static-root") {
    const v = argv[++i];
    if (!v) {
      console.error("openscout-web: --static-root requires a value");
      process.exit(1);
    }
    env.OPENSCOUT_WEB_STATIC_ROOT = v;
    continue;
  }
  console.error(`openscout-web: unknown argument: ${a}`);
  console.error("Try: openscout-web --help");
  process.exit(1);
}

const child = spawn("bun", [server], { stdio: "inherit", env });
child.on("error", (err) => {
  if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
    console.error("openscout-web: could not run Bun. Install Bun (https://bun.sh) and try again.");
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
