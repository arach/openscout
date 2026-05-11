#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORTS = {
  web: "3200",
  vite: "5180",
  pairing: "7888",
};
const WORKTREE_PORT_BASES = {
  web: 3300,
  vite: 5300,
  pairing: 7900,
};
const WORKTREE_PORT_RANGE = 700;
const VITE_HMR_PATH = "/ws/hmr";
const TERMINAL_RELAY_PATH = "/ws/terminal";

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
    webPort: String(WORKTREE_PORT_BASES.web + slot),
    vitePort: String(WORKTREE_PORT_BASES.vite + slot),
    pairingPort: String(WORKTREE_PORT_BASES.pairing + slot),
  };
}

function loopbackHost(hostname) {
  return hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
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
      --host <h>       Bind host (default 127.0.0.1, env OPENSCOUT_WEB_HOST)
  -h, --help           Show this help

Notes:
  Main checkout defaults to 3200/5180/7888.
  Extra git worktrees get deterministic isolated ports automatically.

Examples:
  bun dev --port 3300
  bun dev --port 3300 --vite-port 5181
  bun dev --port 3300 --vite-port 5181 --pairing-port 7981
  bun dev -p 3300
`);
  process.exit(0);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const viteBin = resolve(packageDirectory, "node_modules/vite/bin/vite.js");
const portDefaults = resolvePortDefaults(packageDirectory);
const publicHost = flags.host
  || process.env.OPENSCOUT_WEB_HOST?.trim()
  || process.env.SCOUT_WEB_HOST?.trim()
  || "127.0.0.1";
const internalHost = loopbackHost(publicHost);
const bunPort = flags.port
  || process.env.OPENSCOUT_WEB_PORT?.trim()
  || process.env.SCOUT_WEB_PORT?.trim()
  || portDefaults.webPort;
const pairingPort = flags.pairingPort
  || process.env.OPENSCOUT_PAIRING_PORT?.trim()
  || process.env.SCOUT_PAIRING_PORT?.trim()
  || portDefaults.pairingPort;
const defaultViteUrl = process.env.OPENSCOUT_WEB_VITE_URL?.trim()
  || `http://${internalHost}:${portDefaults.vitePort}`;
const viteUrl = new URL(defaultViteUrl);
if (flags.host && !process.env.OPENSCOUT_WEB_VITE_URL?.trim()) {
  viteUrl.hostname = internalHost;
}
if (flags.vitePort) {
  viteUrl.port = flags.vitePort;
}
const viteHost = flags.host || viteUrl.hostname || "127.0.0.1";
const vitePort =
  viteUrl.port || (viteUrl.protocol === "https:" ? "443" : "80");

if (!existsSync(viteBin)) {
  console.error(
    "@openscout/web: missing local Vite install. Run the workspace install first.",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  OPENSCOUT_SETUP_CWD: portDefaults.gitContext?.worktreeRoot || process.cwd(),
  OPENSCOUT_WEB_HOST: publicHost,
  OPENSCOUT_WEB_PORT: bunPort,
  OPENSCOUT_WEB_VITE_URL: viteUrl.origin,
  OPENSCOUT_WEB_BUN_URL: `http://${internalHost}:${bunPort}`,
  OPENSCOUT_WEB_VITE_HMR_PATH: VITE_HMR_PATH,
  OPENSCOUT_WEB_TERMINAL_RELAY_PATH: TERMINAL_RELAY_PATH,
  OPENSCOUT_PAIRING_PORT: pairingPort,
};
if (portDefaults.gitContext?.isWorktree && !process.env.OPENSCOUT_PAIRING_HOME?.trim()) {
  env.OPENSCOUT_PAIRING_HOME = resolve(
    portDefaults.gitContext.worktreeRoot,
    ".openscout/pairing",
  );
}

const modeLabel = portDefaults.gitContext?.isWorktree
  ? `worktree ${portDefaults.gitContext.worktreeRoot}`
  : "main checkout";
console.log(
  `@openscout/web dev -> ${modeLabel}\n`
  + `  bun:     http://${publicHost}:${bunPort}\n`
  + `  vite:    ${viteUrl.origin}\n`
  + `  pairing: ${pairingPort}`,
);

const children = [
  spawn(
    process.execPath,
    [viteBin, "--host", viteHost, "--port", vitePort, "--strictPort"],
    {
      cwd: packageDirectory,
      env,
      stdio: "inherit",
    },
  ),
  spawn("bun", ["run", "--hot", "server/index.ts"], {
    cwd: packageDirectory,
    env,
    stdio: "inherit",
  }),
];

let exiting = false;

function shutdown(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(
      `@openscout/web: failed to start dev process: ${error.message}`,
    );
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (exiting) {
      return;
    }
    if (signal === "SIGINT" || signal === "SIGTERM") {
      shutdown(0);
      return;
    }
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
