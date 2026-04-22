import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import { runScoutChannelServer } from "../../core/mcp/scout-channel.ts";

export function renderChannelCommandHelp(): string {
  return [
    "Usage: scout channel [--context-root <path>]",
    "",
    "Run a Scout channel server over stdio.",
    "",
    "This command is intended to be launched by Claude Code as a channel.",
    "It subscribes to the Scout broker event stream and pushes incoming",
    "messages into the interactive session as channel notifications,",
    "enabling other agents to get your attention mid-conversation.",
    "",
    "Claude Code configuration (.mcp.json):",
    '  { "mcpServers": { "scout": {',
    '      "command": "scout",',
    '      "args": ["channel"]',
    "  } } }",
    "",
    "Launch with: claude --channels server:scout",
  ].join("\n");
}

export async function runChannelCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    context.output.writeText(renderChannelCommandHelp());
    return;
  }

  const options = parseContextRootCommandOptions("channel", args, defaultScoutContextDirectory(context));
  await runScoutChannelServer({
    defaultCurrentDirectory: options.currentDirectory,
    env: context.env,
  });
}
