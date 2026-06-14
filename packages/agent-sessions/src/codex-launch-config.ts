import { resolveScoutCliLaunchCommand } from "./scout-launch-config.js";

export function buildScoutMcpCodexLaunchArgs(options: {
  currentDirectory: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const resolved = resolveScoutCliLaunchCommand({
    ...options,
    subcommand: "mcp",
  });
  if (!resolved) {
    return [];
  }

  return [
    "-c",
    `mcp_servers.scout.command=${JSON.stringify(resolved.command)}`,
    "-c",
    `mcp_servers.scout.args=${JSON.stringify(resolved.args)}`,
    "-c",
    `mcp_servers.scout.cwd=${JSON.stringify(resolved.cwd)}`,
  ];
}
