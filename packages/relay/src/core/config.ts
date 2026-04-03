import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ChannelConfig {
  audio: boolean;
  voice?: string;
}

export interface RelayConfig {
  agents: string[];
  created: number;
  projectRoot?: string;
  channels?: Record<string, ChannelConfig>;
  defaultVoice?: string;
  roster?: string[];
  userAgent?: string;
  companionAgent?: string;
  pronunciations?: Record<string, string>;
  openaiApiKey?: string;
}

export const DEFAULT_USER_AGENT = "dev";
export const DEFAULT_COMPANION_AGENT = DEFAULT_USER_AGENT;

function normalizeRelayConfig(config?: Partial<RelayConfig>): RelayConfig {
  return {
    agents: config?.agents ?? [],
    created: config?.created ?? Date.now(),
    projectRoot: config?.projectRoot,
    channels: config?.channels,
    defaultVoice: config?.defaultVoice,
    roster: config?.roster,
    userAgent: config?.userAgent,
    companionAgent: config?.companionAgent,
    pronunciations: config?.pronunciations,
    openaiApiKey: config?.openaiApiKey,
  };
}

export function getUserAgentName(config?: Partial<RelayConfig>): string {
  const userAgent = config?.userAgent?.trim();
  const companion = config?.companionAgent?.trim();
  return userAgent || companion || DEFAULT_USER_AGENT;
}

export const getCompanionAgentName = getUserAgentName;

export async function loadRelayConfig(hub: string): Promise<RelayConfig> {
  try {
    const raw = await readFile(join(hub, "config.json"), "utf8");
    return normalizeRelayConfig(JSON.parse(raw) as Partial<RelayConfig>);
  } catch {
    return normalizeRelayConfig();
  }
}

export function loadRelayConfigSync(hub: string): RelayConfig {
  try {
    const raw = readFileSync(join(hub, "config.json"), "utf8");
    return normalizeRelayConfig(JSON.parse(raw) as Partial<RelayConfig>);
  } catch {
    return normalizeRelayConfig();
  }
}

export async function saveRelayConfig(hub: string, config: RelayConfig): Promise<void> {
  await writeFile(join(hub, "config.json"), JSON.stringify(normalizeRelayConfig(config), null, 2) + "\n");
}
