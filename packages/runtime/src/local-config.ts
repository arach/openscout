import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LOCAL_CONFIG_VERSION = 1;

export type LocalPortsConfig = {
  broker?: number;
  web?: number;
  pairing?: number;
};

export type LocalConfig = {
  version: number;
  host?: string;
  ports?: LocalPortsConfig;
};

export const DEFAULT_LOCAL_CONFIG = {
  version: LOCAL_CONFIG_VERSION,
  host: "127.0.0.1",
  ports: {
    broker: 65535,
    web: 3200,
    pairing: 7888,
  },
} as const;

export function localConfigHome(): string {
  return process.env.OPENSCOUT_HOME ?? join(homedir(), ".openscout");
}

export function localConfigPath(): string {
  return join(localConfigHome(), "config.json");
}

export function loadLocalConfig(): LocalConfig {
  const configPath = localConfigPath();
  if (!existsSync(configPath)) return { version: LOCAL_CONFIG_VERSION };
  try {
    return validateLocalConfig(JSON.parse(readFileSync(configPath, "utf8")));
  } catch {
    return { version: LOCAL_CONFIG_VERSION };
  }
}

function validateLocalConfig(input: unknown): LocalConfig {
  if (!input || typeof input !== "object") return { version: LOCAL_CONFIG_VERSION };
  const raw = input as Record<string, unknown>;
  const out: LocalConfig = { version: LOCAL_CONFIG_VERSION };
  if (typeof raw.host === "string" && raw.host.trim().length > 0) {
    out.host = raw.host.trim();
  }
  if (raw.ports && typeof raw.ports === "object") {
    const ports = raw.ports as Record<string, unknown>;
    const p: LocalPortsConfig = {};
    if (isValidPort(ports.broker)) p.broker = ports.broker;
    if (isValidPort(ports.web)) p.web = ports.web;
    if (isValidPort(ports.pairing)) p.pairing = ports.pairing;
    if (Object.keys(p).length > 0) out.ports = p;
  }
  return out;
}

function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;
}

export function resolveBrokerPort(): number {
  return loadLocalConfig().ports?.broker ?? DEFAULT_LOCAL_CONFIG.ports.broker;
}

export function resolveWebPort(): number {
  return loadLocalConfig().ports?.web ?? DEFAULT_LOCAL_CONFIG.ports.web;
}

export function resolvePairingPort(): number {
  return loadLocalConfig().ports?.pairing ?? DEFAULT_LOCAL_CONFIG.ports.pairing;
}

export function resolveHost(): string {
  return loadLocalConfig().host ?? DEFAULT_LOCAL_CONFIG.host;
}

export function writeLocalConfig(config: LocalConfig): void {
  const configPath = localConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  const body = JSON.stringify(
    { ...config, version: LOCAL_CONFIG_VERSION },
    null,
    2,
  ) + "\n";
  const tmp = `${configPath}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, configPath);
}

export function localConfigExists(): boolean {
  return existsSync(localConfigPath());
}
