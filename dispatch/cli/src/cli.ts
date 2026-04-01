#!/usr/bin/env bun
// Dispatch CLI
//
// Usage:
//   dispatch init                    — Set up workspace, identity, and config
//   dispatch start                   — Start bridge + relay
//   dispatch pair                    — Show QR code for phone pairing
//   dispatch open <project>          — Open a project session (starts bridge if needed)
//   dispatch status                  — Show running sessions
//   dispatch config                  — View current config
//   dispatch config set <key> <val>  — Update a config value
//   dispatch workspace               — List projects in workspace
//   dispatch workspace add <path>    — Add a project to auto-start

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";
import { execSync, spawn, type ChildProcess } from "child_process";

const DISPATCH_DIR = join(homedir(), ".dispatch");
const CONFIG_FILE = join(DISPATCH_DIR, "config.json");

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

interface Config {
  relay?: string;
  secure?: boolean;
  port?: number;
  workspace?: { root: string };
  sessions?: Array<{ adapter: string; name: string; cwd?: string; options?: Record<string, unknown> }>;
  [key: string]: unknown;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config: Config): void {
  mkdirSync(DISPATCH_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

function resolvePath(p: string): string {
  return resolve(p.replace(/^~/, homedir()));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  console.log("  dispatch init");
  console.log("  ─────────────────────────────────\n");

  mkdirSync(DISPATCH_DIR, { recursive: true });
  const config = loadConfig();

  // Workspace root
  if (!config.workspace?.root) {
    const defaultRoot = "~/dev";
    const root = prompt(`  workspace root [${defaultRoot}]:`) || defaultRoot;
    config.workspace = { root };
    console.log(`  ✓ workspace: ${root}`);
  } else {
    console.log(`  ✓ workspace: ${config.workspace.root} (already set)`);
  }

  // Relay
  if (!config.relay) {
    // Try to detect Tailscale
    let defaultRelay = "wss://localhost:7889";
    try {
      const tsOutput = execSync("tailscale status --self=true --peers=false --json", {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      }).toString();
      const tsData = JSON.parse(tsOutput);
      const dnsName = (tsData?.Self?.DNSName ?? "").replace(/\.$/, "");
      if (dnsName) {
        defaultRelay = `wss://${dnsName}:7889`;
        console.log(`  ℹ Tailscale detected: ${dnsName}`);
      }
    } catch { /* no tailscale */ }

    const relay = prompt(`  relay URL [${defaultRelay}]:`) || defaultRelay;
    config.relay = relay;
    config.secure = true;
    console.log(`  ✓ relay: ${relay}`);
  } else {
    console.log(`  ✓ relay: ${config.relay} (already set)`);
  }

  // Port
  if (!config.port) {
    config.port = 7888;
    console.log(`  ✓ port: 7888`);
  }

  // Generate identity
  const identityFile = join(DISPATCH_DIR, "identity.json");
  if (!existsSync(identityFile)) {
    // Import and call loadOrCreateIdentity to generate keys
    const { loadOrCreateIdentity, bytesToHex } = await import("./security/index.ts");
    const identity = loadOrCreateIdentity();
    console.log(`  ✓ identity generated: ${bytesToHex(identity.publicKey).slice(0, 16)}...`);
  } else {
    console.log(`  ✓ identity: exists`);
  }

  // TLS cert
  const hasCert = readdirSync(DISPATCH_DIR).some(f => f.endsWith(".crt"));
  if (!hasCert) {
    console.log(`  ℹ TLS cert will be auto-generated on first relay start`);
  } else {
    console.log(`  ✓ TLS cert: exists`);
  }

  saveConfig(config);

  console.log(`\n  config saved to ${CONFIG_FILE}`);
  console.log(`\n  next steps:`);
  console.log(`    dispatch start        — start bridge + relay`);
  console.log(`    dispatch workspace    — browse your projects`);
  console.log(`    dispatch pair         — show QR code for phone`);
  console.log("");
}

function start(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.error("  dispatch is not initialized. Run: dispatch init");
    process.exit(1);
  }

  console.log("  starting dispatch...\n");

  const proc = spawn("bun", ["run", "src/main.ts", "start"], {
    cwd: findDispatchRoot(),
    stdio: "inherit",
    detached: false,
  });

  process.on("SIGINT", () => { proc.kill(); process.exit(0); });
  process.on("SIGTERM", () => { proc.kill(); process.exit(0); });
  proc.on("exit", (code) => process.exit(code ?? 0));
}

function pair(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.error("  dispatch is not initialized. Run: dispatch init");
    process.exit(1);
  }

  const proc = spawn("bun", ["run", "src/main.ts", "pair"], {
    cwd: findDispatchRoot(),
    stdio: "inherit",
  });

  process.on("SIGINT", () => { proc.kill(); process.exit(0); });
  proc.on("exit", (code) => process.exit(code ?? 0));
}

function status(): void {
  const config = loadConfig();
  console.log("  dispatch status");
  console.log("  ─────────────────────────────────\n");

  if (!existsSync(CONFIG_FILE)) {
    console.log("  not initialized — run: dispatch init\n");
    return;
  }

  console.log(`  config  : ${CONFIG_FILE}`);
  console.log(`  relay   : ${config.relay ?? "not set"}`);
  console.log(`  port    : ${config.port ?? 7888}`);
  console.log(`  root    : ${config.workspace?.root ?? "not set"}`);
  console.log(`  sessions: ${config.sessions?.length ?? 0} auto-start`);

  const identityFile = join(DISPATCH_DIR, "identity.json");
  if (existsSync(identityFile)) {
    try {
      const id = JSON.parse(readFileSync(identityFile, "utf8"));
      console.log(`  identity: ${(id.publicKey as string).slice(0, 16)}...`);
    } catch { /* skip */ }
  }

  console.log("");
}

function showConfig(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.log("  no config — run: dispatch init");
    return;
  }
  console.log(readFileSync(CONFIG_FILE, "utf8"));
}

function configSet(key: string, value: string): void {
  const config = loadConfig();

  // Handle nested keys like "workspace.root"
  const parts = key.split(".");
  let target: any = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i]! in target)) target[parts[i]!] = {};
    target = target[parts[i]!];
  }

  // Auto-detect type
  const lastKey = parts[parts.length - 1]!;
  if (value === "true") target[lastKey] = true;
  else if (value === "false") target[lastKey] = false;
  else if (!isNaN(Number(value)) && value !== "") target[lastKey] = Number(value);
  else target[lastKey] = value;

  saveConfig(config);
  console.log(`  ${key} = ${JSON.stringify(target[lastKey])}`);
}

function workspace(subPath?: string): void {
  const config = loadConfig();
  const root = config.workspace?.root;

  if (!root) {
    console.error("  no workspace root configured. Run: dispatch init");
    process.exit(1);
  }

  const resolvedRoot = resolvePath(root);
  const browsePath = subPath ? join(resolvedRoot, subPath) : resolvedRoot;

  console.log(`  ${browsePath}\n`);

  try {
    const entries = readdirSync(browsePath);
    for (const name of entries.sort()) {
      if (name.startsWith(".") || name === "node_modules") continue;

      const fullPath = join(browsePath, name);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch { continue; }

      const children = new Set(readdirSync(fullPath));
      const markers: string[] = [];
      if (children.has(".git")) markers.push("git");
      if (children.has("package.json")) markers.push("pkg");
      if (children.has("Package.swift")) markers.push("swift");
      if (children.has("Cargo.toml")) markers.push("rust");
      if (children.has("go.mod")) markers.push("go");
      if (children.has("pyproject.toml") || children.has("setup.py")) markers.push("py");

      const tag = markers.length ? ` [${markers.join(", ")}]` : "";
      console.log(`  ${name}${tag}`);
    }
  } catch (err: any) {
    console.error(`  error: ${err.message}`);
  }

  console.log("");
}

function open(project: string, adapter?: string): void {
  const config = loadConfig();
  const root = config.workspace?.root;

  let projectPath: string;
  if (project.startsWith("/") || project.startsWith("~")) {
    projectPath = resolvePath(project);
  } else if (root) {
    projectPath = join(resolvePath(root), project);
  } else {
    projectPath = resolve(project);
  }

  if (!existsSync(projectPath)) {
    console.error(`  not found: ${projectPath}`);
    process.exit(1);
  }

  const adapterType = adapter ?? "claude-code";
  const name = basename(projectPath);

  // Add to sessions in config
  config.sessions ??= [];
  const existing = config.sessions.find(s => s.cwd === projectPath || s.cwd === project);
  if (!existing) {
    config.sessions.push({ adapter: adapterType, name, cwd: projectPath });
    saveConfig(config);
    console.log(`  added: ${name} (${adapterType}) → ${projectPath}`);
  } else {
    console.log(`  already configured: ${name}`);
  }

  console.log(`  restart bridge to activate, or it will start on next: dispatch start`);
}

// ---------------------------------------------------------------------------
// Find the dispatch source root (for spawning bridge/relay)
// ---------------------------------------------------------------------------

function findDispatchRoot(): string {
  const candidates = [
    join(homedir(), "dev", "openscout", "dispatch", "cli"),
    join(homedir(), "dev", "dispatch"),
    join(homedir(), "dev", "ext", "dispatch"),
    process.cwd(),
    join(import.meta.dir, ".."),
  ];

  // Check common locations
  for (const dir of candidates) {
    if (existsSync(join(dir, "src", "main.ts"))) {
      return dir;
    }
  }

  console.error("  cannot find dispatch source. Run from the dispatch directory.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "init":
    await init();
    break;

  case "start":
    start();
    break;

  case "pair":
    pair();
    break;

  case "status":
    status();
    break;

  case "config":
    if (args[0] === "set" && args[1] && args[2]) {
      configSet(args[1], args[2]);
    } else {
      showConfig();
    }
    break;

  case "workspace":
  case "ws":
    workspace(args[0]);
    break;

  case "open":
    if (!args[0]) {
      console.error("  usage: dispatch open <project> [--adapter codex]");
      process.exit(1);
    }
    open(args[0], args.includes("--adapter") ? args[args.indexOf("--adapter") + 1] : undefined);
    break;

  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(`
  dispatch — universal viewport for AI coding sessions

  commands:
    init                     set up workspace, identity, and config
    start                    start bridge + relay
    pair                     show QR code for phone pairing
    open <project>           add a project session (--adapter codex)
    status                   show dispatch status
    config                   view config
    config set <key> <val>   update config (e.g. workspace.root ~/dev)
    workspace [path]         browse projects (alias: ws)

  examples:
    dispatch init
    dispatch open dispatch
    dispatch open myapp --adapter codex
    dispatch ws ext
    dispatch config set relay wss://my-host:7889
    dispatch start
`);
    break;

  default:
    console.error(`  unknown command: ${cmd}\n  run: dispatch --help`);
    process.exit(1);
}
