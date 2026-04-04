export type ScoutElectronWindowConfig = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};

export const SCOUT_ELECTRON_DEFAULT_WINDOW: ScoutElectronWindowConfig = {
  width: 1440,
  height: 980,
  minWidth: 1100,
  minHeight: 760,
};

export const SCOUT_ELECTRON_DEFAULT_HOST = "127.0.0.1";

export function resolveScoutElectronStartUrl(input: {
  explicitUrl?: string | null;
  port?: number | null;
}): string {
  const explicitUrl = input.explicitUrl?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  if (!input.port || input.port <= 0) {
    throw new Error("Scout desktop start URL requires a server port when no explicit URL is configured.");
  }

  return `http://${SCOUT_ELECTRON_DEFAULT_HOST}:${input.port}`;
}
