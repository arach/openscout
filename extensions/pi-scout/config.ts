import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PiScoutConfig = {
  socketPath: string | null;
  defaultReplyMode: "none" | "inline" | "notify";
  autoRegister: boolean;
  fuzzySearch: boolean;
};

const DEFAULT_CONFIG: PiScoutConfig = {
  socketPath: null,
  defaultReplyMode: "inline",
  autoRegister: true,
  fuzzySearch: true,
};

let _config: PiScoutConfig | null = null;

export function loadConfig(): PiScoutConfig {
  if (_config) return _config;
  _config = { ...DEFAULT_CONFIG };

  try {
    const home = process.env.HOME ?? "/Users/art";
    const configPath = join(home, ".pi", "agent", "extensions", "pi-scout", "config.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf8"));
      _config = { ..._config, ...raw };
    }
  } catch {
    // Use defaults on parse error
  }

  return _config ?? DEFAULT_CONFIG;
}

export function resolveSocketPath(): string {
  return resolveSocketPaths()[0];
}

export function resolveSocketPaths(): string[] {
  const config = loadConfig();
  if (config.socketPath) return [config.socketPath];

  const explicitSocketPath = process.env.OPENSCOUT_BROKER_SOCKET_PATH;
  if (explicitSocketPath) return [explicitSocketPath];

  const home = process.env.HOME ?? homedir() ?? "/Users/art";
  const supportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY
    ?? join(home, "Library", "Application Support", "OpenScout");
  const controlHome = process.env.OPENSCOUT_CONTROL_HOME
    ?? join(home, ".openscout", "control-plane");

  return Array.from(new Set([
    join(supportDirectory, "runtime", "broker.sock"),
    join(controlHome, "runtime", "broker.sock"),
  ]));
}

export function resolveBrokerHttpUrl(): string {
  return process.env.OPENSCOUT_BROKER_URL ?? "http://127.0.0.1:65535";
}
