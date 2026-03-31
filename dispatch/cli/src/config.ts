import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type DispatchSessionConfig = {
  adapter: string;
  name: string;
  cwd?: string;
  options?: Record<string, unknown>;
};

export type DispatchAdapterConfig = {
  type: string;
  options?: Record<string, unknown>;
};

export type DispatchConfig = {
  relay?: string;
  secure?: boolean;
  port?: number;
  adapters?: Record<string, DispatchAdapterConfig>;
  workspace?: {
    root?: string;
  };
  sessions?: DispatchSessionConfig[];
};

export type DispatchPaths = {
  rootDir: string;
  configPath: string;
  identityPath: string;
  trustedPeersPath: string;
  logPath: string;
};

export const DISPATCH_QR_TTL_MS = 5 * 60 * 1000;

export function dispatchPaths(): DispatchPaths {
  const rootDir = path.join(homedir(), ".dispatch");
  return {
    rootDir,
    configPath: path.join(rootDir, "config.json"),
    identityPath: path.join(rootDir, "identity.json"),
    trustedPeersPath: path.join(rootDir, "trusted-peers.json"),
    logPath: path.join(rootDir, "bridge.log"),
  };
}

export function loadDispatchConfig(): DispatchConfig {
  const { configPath } = dispatchPaths();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const payload = JSON.parse(readFileSync(configPath, "utf8")) as DispatchConfig;
    return typeof payload === "object" && payload ? payload : {};
  } catch {
    return {};
  }
}

export function saveDispatchConfig(config: DispatchConfig): void {
  const { rootDir, configPath } = dispatchPaths();
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function resolvedDispatchConfig() {
  const config = loadDispatchConfig();
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
