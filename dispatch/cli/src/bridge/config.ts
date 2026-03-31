// Bridge configuration — loads from ~/.dispatch/config.json with CLI overrides.
//
// Layering order (later wins):
//   1. Built-in defaults
//   2. ~/.dispatch/config.json
//   3. CLI flags

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface AdapterEntry {
  type: string;
  options?: Record<string, unknown>;
}

export interface SessionEntry {
  /** Adapter type to use (e.g. "claude-code", "codex", "openai"). */
  adapter: string;
  /** Display name for the session. */
  name: string;
  /** Working directory. */
  cwd?: string;
  /** Adapter-specific options. */
  options?: Record<string, unknown>;
}

export interface WorkspaceConfig {
  /** Root directory to browse projects from (e.g. "~/dev"). */
  root: string;
}

export interface DispatchConfig {
  /** Relay WebSocket URL (e.g. "ws://relay.example.com:7889"). */
  relay?: string;
  /** Enable Noise encryption on local WebSocket connections. */
  secure?: boolean;
  /** Local WebSocket port. */
  port: number;
  /** Additional adapters to register (keyed by name). */
  adapters?: Record<string, AdapterEntry>;
  /** Sessions to auto-start when the bridge launches. */
  sessions?: SessionEntry[];
  /** Workspace root for project discovery. */
  workspace?: WorkspaceConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: DispatchConfig = {
  port: 7888,
  secure: true,
};

// ---------------------------------------------------------------------------
// Config file path
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".dispatch");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export { CONFIG_FILE };

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load config from ~/.dispatch/config.json, returning defaults for any missing
 * fields. Returns the raw file values so CLI can overlay on top.
 */
export function loadConfigFile(): Partial<DispatchConfig> {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<DispatchConfig>;
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[config] failed to parse ${CONFIG_FILE}: ${msg}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// CLI argument helpers
// ---------------------------------------------------------------------------

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ---------------------------------------------------------------------------
// Parse CLI flags into a partial config
// ---------------------------------------------------------------------------

export function parseCLIFlags(): Partial<DispatchConfig> & { pair?: boolean } {
  const flags: Partial<DispatchConfig> & { pair?: boolean } = {};

  const portStr = getArg("--port");
  if (portStr !== undefined) {
    const n = Number(portStr);
    if (!Number.isNaN(n) && n > 0) flags.port = n;
  }

  if (hasFlag("--secure")) flags.secure = true;

  const relay = getArg("--relay");
  if (relay !== undefined) flags.relay = relay;

  if (hasFlag("--pair")) flags.pair = true;

  return flags;
}

// ---------------------------------------------------------------------------
// Resolve final config: defaults <- file <- CLI
// ---------------------------------------------------------------------------

export interface ResolvedConfig extends DispatchConfig {
  /** --pair flag: just show QR and wait, don't start sessions. */
  pair: boolean;
}

export function resolveConfigLayers(
  file: Partial<DispatchConfig>,
  cli: Partial<DispatchConfig> & { pair?: boolean },
): ResolvedConfig {
  return {
    port: cli.port ?? file.port ?? DEFAULTS.port,
    secure: cli.secure ?? file.secure ?? DEFAULTS.secure ?? false,
    relay: cli.relay ?? file.relay,
    adapters: file.adapters,
    sessions: file.sessions,
    workspace: file.workspace,
    pair: cli.pair ?? false,
  };
}

export function resolveConfig(): ResolvedConfig {
  const file = loadConfigFile();
  const cli = parseCLIFlags();
  return resolveConfigLayers(file, cli);
}
