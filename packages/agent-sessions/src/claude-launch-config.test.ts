import { describe, expect, test } from "bun:test";

import { buildScoutChannelClaudeLaunchArgs, scoutChannelMcpAllowedToolIds } from "./claude-launch-config";

describe("buildScoutChannelClaudeLaunchArgs", () => {
  test("builds Claude MCP config for the scout channel server", () => {
    const args = buildScoutChannelClaudeLaunchArgs({
      currentDirectory: "/Users/arach/dev/openscout",
      agentName: "channel-test.codex-repo-watch-snapshot.air-local",
      env: {
        ...process.env,
        OPENSCOUT_SETUP_CWD: "/Users/arach",
      },
    });

    expect(args).toEqual([
      "--mcp-config",
      expect.any(String),
    ]);

    const config = JSON.parse(args[1] ?? "{}") as {
      mcpServers?: Record<string, {
        command?: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
      }>;
    };

    expect(config.mcpServers?.["scout-channel"]?.command?.length).toBeGreaterThan(0);
    expect(config.mcpServers?.["scout-channel"]?.args).toEqual([
      "channel",
      "--context-root",
      "/Users/arach",
    ]);
    expect(config.mcpServers?.["scout-channel"]?.cwd).toBe("/Users/arach");
    expect(config.mcpServers?.["scout-channel"]?.env).toEqual({
      OPENSCOUT_AGENT: "channel-test.codex-repo-watch-snapshot.air-local",
      OPENSCOUT_SETUP_CWD: "/Users/arach",
    });
  });

  test("maps scout-channel MCP tools to Claude allowedTools ids", () => {
    expect(scoutChannelMcpAllowedToolIds()).toEqual([
      "mcp__scout-channel__scout_whoami",
      "mcp__scout-channel__scout_channels_list",
      "mcp__scout-channel__scout_inbox_latest",
      "mcp__scout-channel__scout_inbox_pending",
      "mcp__scout-channel__scout_channel_latest",
      "mcp__scout-channel__scout_mark_read",
      "mcp__scout-channel__scout_reply",
      "mcp__scout-channel__scout_send",
    ]);
  });
});
