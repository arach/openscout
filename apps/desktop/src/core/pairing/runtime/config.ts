import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type PairingSessionConfig = {
  adapter: string;
  name: string;
  cwd?: string;
  options?: Record<string, unknown>;
};

export type PairingAdapterConfig = {
  type: string;
  options?: Record<string, unknown>;
};

export type PairingConfig = {
  relay?: string;
  secure?: boolean;
  port?: number;
  adapters?: Record<string, PairingAdapterConfig>;
  workspace?: {
    root?: string;
  };
  sessions?: PairingSessionConfig[];
};

export type PairingPaths = {
  rootDir: string;
  configPath: string;
  identityPath: string;
  trustedPeersPath: string;
  logPath: string;
  runtimeStatePath: string;
  runtimePidPath: string;
};

export const PAIRING_QR_TTL_MS = 5 * 60 * 1000;

export function pairingPaths(): PairingPaths {
  const rootDir = path.join(homedir(), ".scout/pairing");
  return {
    rootDir,
    configPath: path.join(rootDir, "config.json"),
    identityPath: path.join(rootDir, "identity.json"),
    trustedPeersPath: path.join(rootDir, "trusted-peers.json"),
    logPath: path.join(rootDir, "bridge.log"),
    runtimeStatePath: path.join(rootDir, "runtime.json"),
    runtimePidPath: path.join(rootDir, "runtime.pid"),
  };
}

export function loadPairingConfig(): PairingConfig {
  const { configPath } = pairingPaths();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const payload = JSON.parse(readFileSync(configPath, "utf8")) as PairingConfig;
    return typeof payload === "object" && payload ? payload : {};
  } catch {
    return {};
  }
}

export function savePairingConfig(config: PairingConfig): void {
  const { rootDir, configPath } = pairingPaths();
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function resolvedPairingConfig() {
  const config = loadPairingConfig();
  return {
    relay: typeof config.relay === "string" && config.relay.trim().length > 0
      ? config.relay.trim()
      : null,
    secure: config.secure !== false,
    port: Number.isFinite(config.port) && (config.port ?? 0) > 0 ? Number(config.port) : 7888,
    workspaceRoot: typeof config.workspace?.root === "string" && config.workspace.root.trim().length > 0
      ? config.workspace.root.trim()
      : null,
    sessions: Array.isArray(config.sessions) ? config.sessions : [],
  };
}
