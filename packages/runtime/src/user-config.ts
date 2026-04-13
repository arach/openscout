import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type OpenScoutUserConfig = {
  name?: string;
};

function userConfigPath(): string {
  return join(process.env.OPENSCOUT_HOME ?? join(homedir(), ".openscout"), "user.json");
}

export function loadUserConfig(): OpenScoutUserConfig {
  const configPath = userConfigPath();
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as OpenScoutUserConfig;
  } catch {
    return {};
  }
}

export function saveUserConfig(config: OpenScoutUserConfig): void {
  const configPath = userConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function resolveOperatorName(): string {
  const config = loadUserConfig();
  return config.name?.trim()
    || process.env.OPENSCOUT_OPERATOR_NAME?.trim()
    || process.env.USER?.trim()
    || "operator";
}
