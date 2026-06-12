import { existsSync, readFileSync } from "node:fs";

type HudsonBuildConfig = {
  features?: string[];
};

type HudsonPackageConfig = {
  macos?: {
    features?: string[];
    builds?: HudsonBuildConfig[];
  };
};

const FEATURE_ENV: Record<string, Record<string, string>> = {
  terminal: { HUDSONKIT_WITH_TERMINAL: "1" },
  voice: { HUDSONKIT_WITH_VOICE: "1" },
};

function normalizeFeatures(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function hudsonFeatureEnvironment(configPath: string, buildIndex = 0): NodeJS.ProcessEnv {
  if (!existsSync(configPath)) return {};

  const config = JSON.parse(readFileSync(configPath, "utf8")) as HudsonPackageConfig;
  const features = new Set([
    ...normalizeFeatures(config.macos?.features),
    ...normalizeFeatures(config.macos?.builds?.[buildIndex]?.features),
  ]);

  const env: NodeJS.ProcessEnv = {};
  for (const feature of features) {
    const featureEnv = FEATURE_ENV[feature];
    if (!featureEnv) {
      throw new Error(`Unknown Hudson feature "${feature}" in ${configPath}. Known features: ${Object.keys(FEATURE_ENV).join(", ")}.`);
    }
    Object.assign(env, featureEnv);
  }
  return env;
}
