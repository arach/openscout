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
  userTwin?: string;
  companionTwin?: string;
  pronunciations?: Record<string, string>;
  openaiApiKey?: string;
}

export const DEFAULT_USER_TWIN = "dev";
export const DEFAULT_COMPANION_TWIN = DEFAULT_USER_TWIN;

function normalizeRelayConfig(config?: Partial<RelayConfig>): RelayConfig {
  return {
    agents: config?.agents ?? [],
    created: config?.created ?? Date.now(),
    projectRoot: config?.projectRoot,
    channels: config?.channels,
    defaultVoice: config?.defaultVoice,
    roster: config?.roster,
    userTwin: config?.userTwin,
    companionTwin: config?.companionTwin,
    pronunciations: config?.pronunciations,
    openaiApiKey: config?.openaiApiKey,
  };
}

export function getUserTwinName(config?: Partial<RelayConfig>): string {
  const userTwin = config?.userTwin?.trim();
  const companion = config?.companionTwin?.trim();
  return userTwin || companion || DEFAULT_USER_TWIN;
}

export const getCompanionTwinName = getUserTwinName;

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
