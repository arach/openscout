export function normalizeCliBinaryMtimeMs(value: number): number {
  return Math.floor(value);
}

export function shouldRestartBrokerForCliMtime(currentMtimeMs: number, persistedMtimeMs: number): boolean {
  return normalizeCliBinaryMtimeMs(currentMtimeMs) > normalizeCliBinaryMtimeMs(persistedMtimeMs);
}

export function shouldEnsureBrokerUptodateForCommand(command: string | null): boolean {
  return command !== "mcp";
}
