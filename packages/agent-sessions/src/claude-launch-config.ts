import { resolveScoutCliLaunchCommand } from "./scout-launch-config.js";

export const SCOUT_CHANNEL_MCP_SERVER_NAME = "scout-channel";

export const SCOUT_CHANNEL_MCP_TOOL_NAMES = [
  "scout_whoami",
  "scout_channels_list",
  "scout_inbox_latest",
  "scout_inbox_pending",
  "scout_channel_latest",
  "scout_mark_read",
  "scout_reply",
  "scout_send",
] as const;

export function scoutChannelMcpAllowedToolIds(
  serverName = SCOUT_CHANNEL_MCP_SERVER_NAME,
): string[] {
  return SCOUT_CHANNEL_MCP_TOOL_NAMES.map((toolName) => `mcp__${serverName}__${toolName}`);
}

export function buildScoutChannelClaudeLaunchArgs(options: {
  currentDirectory: string;
  agentName?: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const env = options.env ?? process.env;
  const resolved = resolveScoutCliLaunchCommand({
    currentDirectory: options.currentDirectory,
    env,
    subcommand: "channel",
  });
  if (!resolved) {
    return [];
  }

  const mcpEnv: Record<string, string> = {};
  const agentName = options.agentName?.trim() || env.OPENSCOUT_AGENT?.trim();
  if (agentName) {
    mcpEnv.OPENSCOUT_AGENT = agentName;
  }
  const setupCwd = env.OPENSCOUT_SETUP_CWD?.trim() || options.currentDirectory;
  if (setupCwd) {
    mcpEnv.OPENSCOUT_SETUP_CWD = setupCwd;
  }
  const brokerUrl = env.OPENSCOUT_BROKER_URL?.trim();
  if (brokerUrl) {
    mcpEnv.OPENSCOUT_BROKER_URL = brokerUrl;
  }

  const mcpConfig = {
    mcpServers: {
      "scout-channel": {
        command: resolved.command,
        args: resolved.args,
        cwd: resolved.cwd,
        ...(Object.keys(mcpEnv).length > 0 ? { env: mcpEnv } : {}),
      },
    },
  };

  return ["--mcp-config", JSON.stringify(mcpConfig)];
}
