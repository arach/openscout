import { existsSync, readFileSync } from "node:fs";
import { homedir, join } from "node:path";

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
    const configPath = join(
      process.env.HOME ?? homedir(),
      ".pi",
      "agent",
      "extensions",
      "pi-scout",
      "config.json",
    );
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf8"));
      _config = { ..._config, ...raw };
    }
  } catch {
    // Use defaults on parse error
  }


  return _config;
}

export function resolveSocketPath(): string {
  const config = loadConfig();
  if (config.socketPath) return config.socketPath;
  return (
    process.env.OPENSCOUT_BROKER_SOCKET_PATH ??
    join(
      process.env.OPENSCOUT_CONTROL_HOME ??
        join(homedir(), ".openscout", "control-plane"),
      "runtime",
      "broker.sock"
    )
  );
}

export function resolveBrokerHttpUrl(): string {
  return process.env.OPENSCOUT_BROKER_URL ?? "http://127.0.0.1:65535";
}
