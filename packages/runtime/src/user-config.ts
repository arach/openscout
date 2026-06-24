import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";

export type InterruptThreshold = "always" | "blocking-only" | "batched" | "never";
export type CommsChannel = "here" | "mobile" | "here+mobile";
export type CommsVerbosity = "terse" | "normal" | "detailed";
export type CommsTone = "direct" | "warm" | "formal";
export type ProvisionalAgentNamesMode = "replace" | "extend";

export type OpenScoutUserConfig = {
  name?: string;
  handle?: string;
  pronouns?: string;
  hue?: number;
  bio?: string;
  timezone?: string;
  workingHours?: string;
  interruptThreshold?: InterruptThreshold;
  batchWindow?: number;
  channel?: CommsChannel;
  verbosity?: CommsVerbosity;
  tone?: CommsTone;
  quietHours?: string;
  /** Custom rotation pool for ephemeral agent names (one entry per name). */
  provisionalAgentNames?: string[];
  /** `replace` uses only your list; `extend` prepends yours then Scout defaults. */
  provisionalAgentNamesMode?: ProvisionalAgentNamesMode;
  /** Advanced: path to a JSON name pool (`{ "names": [...] }` or a string array). */
  provisionalAgentNamesFile?: string;
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

function readSettingsOperatorName(): string {
  const settingsPath = resolveOpenScoutSupportPaths().settingsPath;
  if (!existsSync(settingsPath)) return "";
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      profile?: { operatorName?: unknown };
      operatorName?: unknown;
    };
    const candidate = typeof settings.profile?.operatorName === "string"
      ? settings.profile.operatorName
      : typeof settings.operatorName === "string"
        ? settings.operatorName
        : "";
    return candidate.trim();
  } catch {
    return "";
  }
}

export function resolveOperatorName(): string {
  const config = loadUserConfig();
  return config.name?.trim()
    || process.env.OPENSCOUT_OPERATOR_NAME?.trim()
    || readSettingsOperatorName()
    || process.env.USER?.trim()
    || "operator";
}

function normalizeHandle(value: string | undefined): string {
  return value?.trim().replace(/^@+/, "") ?? "";
}

export function resolveOperatorHandle(): string {
  const config = loadUserConfig();
  return normalizeHandle(config.handle)
    || normalizeHandle(process.env.OPENSCOUT_OPERATOR_HANDLE)
    || normalizeHandle(config.name)
    || normalizeHandle(process.env.OPENSCOUT_OPERATOR_NAME)
    || normalizeHandle(process.env.USER)
    || "operator";
}
