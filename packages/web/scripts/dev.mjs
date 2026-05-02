#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, hostname as osHostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOpenScoutWebRoutes } from "../shared/runtime-config.js";

const DEFAULT_PORTS = {
  web: 3200,
  vite: 5180,
  pairing: 7888,
};
const DEFAULT_SCOUT_WEB_DOMAIN = "scout.local";
const WORKTREE_PORT_BASES = {
  web: 3300,
  vite: 5300,
  pairing: 7900,
};
const WORKTREE_PORT_RANGE = 700;

function parseFlags(argv) {
  const flags = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    const eq = arg.indexOf("=");
    const [name, inlineValue] =
      eq >= 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];
    const nextArg = args[i + 1];
    const value = inlineValue ?? (!nextArg?.startsWith("-") ? nextArg : undefined);
    if (eq < 0 && value !== undefined) {
      i += 1;
    }
    if (name === "--port" || name === "-p") {
      flags.port = value;
    } else if (name === "--vite-port") {
      flags.vitePort = value;
    } else if (name === "--pairing-port") {
      flags.pairingPort = value;
    } else if (name === "--host") {
      flags.host = value;
    } else if (name === "--local-name") {
      flags.localName = value;
    }
  }
  return flags;
}

function safeGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
    }).trim() || null;
  } catch {
    return null;
  }
}

function resolveGitContext(cwd) {
  const worktreeRoot = safeGit(["rev-parse", "--show-toplevel"], cwd);
  const commonGitDir = safeGit(["rev-parse", "--git-common-dir"], cwd);
  if (!worktreeRoot || !commonGitDir) {
    return null;
  }
  const commonRoot = resolve(cwd, commonGitDir, "..");
  return {
    worktreeRoot: resolve(worktreeRoot),
    commonRoot,
    isWorktree: resolve(worktreeRoot) !== commonRoot,
  };
}

function worktreeSlot(input) {
  return createHash("sha256").update(input).digest().readUInt16BE(0) % WORKTREE_PORT_RANGE;
}

function resolvePortDefaults(packageDir) {
  const gitContext = resolveGitContext(packageDir);
  if (!gitContext) {
    return {
      gitContext: null,
      webPort: DEFAULT_PORTS.web,
      vitePort: DEFAULT_PORTS.vite,
      pairingPort: DEFAULT_PORTS.pairing,
    };
  }

  if (!gitContext.isWorktree) {
    return {
      gitContext,
      webPort: DEFAULT_PORTS.web,
      vitePort: DEFAULT_PORTS.vite,
      pairingPort: DEFAULT_PORTS.pairing,
    };
  }

  const slot = worktreeSlot(gitContext.worktreeRoot);
  return {
    gitContext,
    webPort: WORKTREE_PORT_BASES.web + slot,
    vitePort: WORKTREE_PORT_BASES.vite + slot,
    pairingPort: WORKTREE_PORT_BASES.pairing + slot,
  };
}

function resolveDevStateRoot(gitContext) {
  return resolve(
    gitContext?.commonRoot || resolve(packageDirectory, "..", ".."),
    ".openscout/dev/web",
  );
}

function loopbackHost(hostname) {
  return hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
}

function parsePort(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : null;
}

function portLabel(port) {
  return String(port);
}

function normalizeLocalHostnameLabel(value) {
  const firstLabel = value
    ?.trim()
    .replace(/\.local\.?$/i, "")
    .split(".")
    .find((part) => part.trim().length > 0)
    ?.trim();
  const normalized = firstLabel
    ?.toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized || "localhost";
}

function defaultScoutNodeHostname() {
  return `${normalizeLocalHostnameLabel(osHostname())}.${DEFAULT_SCOUT_WEB_DOMAIN}`;
}

function normalizeLocalHostname(value) {
  const trimmed = value?.trim().replace(/\.$/, "").toLowerCase();
  const labels = trimmed
    ?.split(".")
    .map((label) =>
      label
        .trim()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-")
    )
    .filter(Boolean);
  return labels && labels.length > 0 ? labels.join(".") : "localhost";
}

function resolveScoutWebNamedHostname(name) {
  const normalized = normalizeLocalHostname(name);
  return normalized.includes(".") ? normalized : `${normalized}.${DEFAULT_SCOUT_WEB_DOMAIN}`;
}

function readLocalWebName() {
  const configPath = resolve(process.env.OPENSCOUT_HOME || resolve(homedir(), ".openscout"), "config.json");
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return typeof config.webLocalName === "string" && config.webLocalName.trim()
      ? config.webLocalName.trim()
      : null;
  } catch {
    return null;
  }
}

async function isPortOpenable(hostname, port) {
  return await new Promise((resolveOpenable) => {
    const server = createServer();
    let done = false;
    const finish = (value) => {
      if (done) {
        return;
      }
      done = true;
      resolveOpenable(value);
    };

    server.unref();
    server.once("error", () => finish(false));
    server.listen(
      {
        host: hostname,
        port,
        exclusive: true,
      },
      () => {
        server.close(() => finish(true));
      },
    );
  });
}

async function findAvailablePort(startPort, hostname, reservedPorts, options = {}) {
  const requireNeighborFree = options.requireNeighborFree ?? false;

  for (let port = startPort; port < 65535; port += 1) {
    if (reservedPorts.has(port)) {
      continue;
    }
    if (!await isPortOpenable(hostname, port)) {
      continue;
    }
    if (requireNeighborFree) {
      const neighbor = port + 1;
      if (neighbor >= 65535 || reservedPorts.has(neighbor) || !await isPortOpenable(hostname, neighbor)) {
        continue;
      }
    }
    return port;
  }

  throw new Error(`Could not find an open port starting from ${startPort}.`);
}

async function canResolveHost(hostname) {
  try {
    await lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

const flags = parseFlags(process.argv);

if (flags.help) {
  console.log(`@openscout/web dev

Usage: bun dev [options]

Options:
  -p, --port <n>       Bun app port
      --vite-port <n>  Vite asset port
      --pairing-port <n>
                       Pairing bridge port
      --host <h>       Bind host (default 0.0.0.0, env OPENSCOUT_WEB_HOST)
      --local-name <n> Node hostname or short alias to advertise (default <machine>.scout.local)
  -h, --help           Show this help

Notes:
  Main checkout prefers 3200/5180/7888.
  Extra git worktrees prefer isolated port bands automatically.
  If a preferred port is busy, dev mode increments until it finds an open one.

Examples:
  bun dev
  bun dev --port 3300
  bun dev --port 3300 --vite-port 5181 --pairing-port 7981
`);
  process.exit(0);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const viteBin = resolve(packageDirectory, "node_modules/vite/bin/vite.js");
const viteSocketGuard = resolve(scriptDirectory, "vite-socket-guard.mjs");
const serverEntry = resolve(packageDirectory, "server/index.ts");

if (!existsSync(viteBin)) {
  console.error(
    "@openscout/web: missing local Vite install. Run the workspace install first.",
  );
  process.exit(1);
}

const portDefaults = resolvePortDefaults(packageDirectory);
const routes = resolveOpenScoutWebRoutes(process.env);
const publicHost = flags.host
  || process.env.OPENSCOUT_WEB_HOST?.trim()
  || process.env.SCOUT_WEB_HOST?.trim()
  || "0.0.0.0";
const internalHost = loopbackHost(publicHost);
const configuredLocalName = flags.localName
  || process.env.OPENSCOUT_WEB_LOCAL_NAME?.trim()
  || readLocalWebName()
  || defaultScoutNodeHostname();
const portalHost = DEFAULT_SCOUT_WEB_DOMAIN;
const advertisedHost = process.env.OPENSCOUT_WEB_ADVERTISED_HOST?.trim()
  || resolveScoutWebNamedHostname(configuredLocalName);
const explicitWebPort = parsePort(flags.port)
  ?? parsePort(process.env.OPENSCOUT_WEB_PORT)
  ?? parsePort(process.env.SCOUT_WEB_PORT);
const explicitPairingPort = parsePort(flags.pairingPort)
  ?? parsePort(process.env.OPENSCOUT_PAIRING_PORT)
  ?? parsePort(process.env.SCOUT_PAIRING_PORT);
const configuredViteUrl = process.env.OPENSCOUT_WEB_VITE_URL?.trim() || null;
const defaultViteUrl = configuredViteUrl
  || `http://${internalHost}:${portLabel(portDefaults.vitePort)}`;
const viteUrl = new URL(defaultViteUrl);
if (flags.host && !configuredViteUrl) {
  viteUrl.hostname = internalHost;
}
const explicitVitePort = parsePort(flags.vitePort)
  ?? (configuredViteUrl ? parsePort(viteUrl.port) : null);
const reservedPorts = new Set();

const bunPort = explicitWebPort ?? await findAvailablePort(
  portDefaults.webPort,
  internalHost,
  reservedPorts,
  { requireNeighborFree: true },
);
reservedPorts.add(bunPort);
reservedPorts.add(bunPort + 1);

const vitePort = explicitVitePort ?? await findAvailablePort(
  portDefaults.vitePort,
  internalHost,
  reservedPorts,
);
reservedPorts.add(vitePort);
viteUrl.port = portLabel(vitePort);

const pairingPort = explicitPairingPort ?? await findAvailablePort(
  portDefaults.pairingPort,
  internalHost,
  reservedPorts,
);

const viteHost = flags.host || viteUrl.hostname || "127.0.0.1";
const stateRoot = resolveDevStateRoot(portDefaults.gitContext);
const stateFile = resolve(
  stateRoot,
  "runs",
  `${Date.now()}-${process.pid}.json`,
);
const env = {
  ...process.env,
  OPENSCOUT_SETUP_CWD: portDefaults.gitContext?.worktreeRoot || process.cwd(),
  OPENSCOUT_WEB_HOST: publicHost,
  OPENSCOUT_WEB_PORT: portLabel(bunPort),
  OPENSCOUT_WEB_VITE_URL: viteUrl.origin,
  OPENSCOUT_WEB_BUN_URL: `http://${internalHost}:${portLabel(bunPort)}`,
  OPENSCOUT_WEB_VITE_HMR_PATH: routes.viteHmrPath,
  OPENSCOUT_WEB_TERMINAL_RELAY_PATH: routes.terminalRelayPath,
  OPENSCOUT_WEB_DEV_STATE_FILE: stateFile,
  OPENSCOUT_PAIRING_PORT: portLabel(pairingPort),
};
if (configuredLocalName) {
  env.OPENSCOUT_WEB_LOCAL_NAME = configuredLocalName;
}
env.OPENSCOUT_WEB_PORTAL_HOST = portalHost;
if (process.env.OPENSCOUT_WEB_ADVERTISED_HOST?.trim()) {
  env.OPENSCOUT_WEB_ADVERTISED_HOST = process.env.OPENSCOUT_WEB_ADVERTISED_HOST.trim();
}

if (portDefaults.gitContext?.isWorktree && !process.env.OPENSCOUT_PAIRING_HOME?.trim()) {
  env.OPENSCOUT_PAIRING_HOME = resolve(
    portDefaults.gitContext.worktreeRoot,
    ".openscout/pairing",
  );
}

const modeLabel = portDefaults.gitContext?.isWorktree
  ? `worktree ${portDefaults.gitContext.worktreeRoot}`
  : "main checkout";
const openUrl = `http://${advertisedHost}:${portLabel(bunPort)}`;
const portalUrl = `http://${portalHost}:${portLabel(bunPort)}`;
const fallbackUrl = `http://127.0.0.1:${portLabel(bunPort)}`;
const advertisedHostResolves = await canResolveHost(advertisedHost);
const portalHostResolves = await canResolveHost(portalHost);
console.log(
  `@openscout/web dev -> ${modeLabel}\n`
  + `  bun:     http://${publicHost}:${portLabel(bunPort)}\n`
  + `  portal:  ${portalUrl}${portalHostResolves ? "" : "  (name not resolving yet)"}\n`
  + `  node:    ${openUrl}${advertisedHostResolves ? "" : "  (name not resolving yet)"}\n`
  + `  local:   ${fallbackUrl}\n`
  + `  vite:    ${viteUrl.origin}  (internal asset server)\n`
  + `  pairing: ${portLabel(pairingPort)}`
  + (portalHostResolves && advertisedHostResolves
    ? ""
    : `\n  note:    configure DNS/hosts/Caddy for ${portalHost} and ${advertisedHost}; until then use ${fallbackUrl}`),
);

function spawnVite() {
  const viteEnv = {
    ...env,
    NODE_OPTIONS: [
      env.NODE_OPTIONS,
      `--import=${viteSocketGuard}`,
    ].filter(Boolean).join(" "),
  };

  return spawn(
    process.execPath,
    [viteBin, "--host", viteHost, "--port", portLabel(vitePort), "--strictPort"],
    {
      cwd: packageDirectory,
      env: viteEnv,
      stdio: "inherit",
    },
  );
}

function spawnServer() {
  return spawn("bun", ["run", "--hot", serverEntry], {
    cwd: packageDirectory,
    env,
    stdio: "inherit",
  });
}

const children = {
  vite: spawnVite(),
  server: spawnServer(),
};

try {
  await mkdir(resolve(stateRoot, "runs"), { recursive: true });
  await writeFile(
    stateFile,
    JSON.stringify({
      kind: "openscout-web-dev",
      version: 1,
      startedAt: new Date().toISOString(),
      repoRoot: portDefaults.gitContext?.commonRoot || resolve(packageDirectory, "..", ".."),
      worktreeRoot: portDefaults.gitContext?.worktreeRoot || resolve(packageDirectory, "..", ".."),
      packageDirectory,
      publicHost,
      internalHost,
      routes: {
        terminalRelayPath: routes.terminalRelayPath,
        viteHmrPath: routes.viteHmrPath,
      },
      ports: {
        web: bunPort,
        relay: bunPort + 1,
        vite: vitePort,
        pairing: pairingPort,
      },
      processes: {
        manager: process.pid,
        vite: children.vite?.pid ?? null,
        server: children.server?.pid ?? null,
      },
      pairingHome: env.OPENSCOUT_PAIRING_HOME || null,
    }, null, 2),
    "utf8",
  );
} catch (error) {
  console.warn(
    `@openscout/web: failed to record dev state at ${stateFile}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

let exiting = false;
const viteRestartWindowMs = 30_000;
const viteRestartLimit = 5;
let viteRestartTimestamps = [];

async function shutdown(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  for (const child of Object.values(children)) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  await rm(stateFile, { force: true }).catch(() => {});
  process.exit(code);
}

function attachChildHandlers(name, child) {
  child.on("error", (error) => {
    console.error(
      `@openscout/web: failed to start ${name} dev process: ${error.message}`,
    );
    void shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (exiting) {
      return;
    }
    if (signal === "SIGINT" || signal === "SIGTERM") {
      void shutdown(0);
      return;
    }

    if (name === "vite") {
      const now = Date.now();
      viteRestartTimestamps = viteRestartTimestamps.filter((ts) => now - ts < viteRestartWindowMs);
      viteRestartTimestamps.push(now);
      if (viteRestartTimestamps.length <= viteRestartLimit) {
        console.warn(
          `@openscout/web: vite exited (${signal ?? `code ${code ?? 0}`}); restarting so the Bun API server stays up.`,
        );
        children.vite = spawnVite();
        attachChildHandlers("vite", children.vite);
        return;
      }
      console.error("@openscout/web: vite is crash-looping; shutting down dev stack.");
    }

    void shutdown(code ?? 1);
  });
}

attachChildHandlers("vite", children.vite);
attachChildHandlers("server", children.server);

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("exit", () => {
  try {
    rmSync(stateFile, { force: true });
  } catch {
    // best-effort exit cleanup
  }
});
