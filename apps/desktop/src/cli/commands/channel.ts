import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseChannelCommandOptions } from "../options.ts";
import { loadScoutMessages } from "../../core/broker/service.ts";
import { runScoutChannelServer } from "../../core/mcp/scout-channel.ts";
import { renderScoutMessageList } from "../../ui/terminal/broker.ts";

function newestMessagesFirst<T extends { createdAt: number }>(messages: T[]): T[] {
  return [...messages].sort((left, right) => right.createdAt - left.createdAt);
}

export function renderChannelCommandHelp(): string {
  return [
    "Usage: scout channel [--context-root <path>]",
    "       scout channel [<name>] --latest <count> [--json]",
    "",
    "Run a Scout channel server over stdio.",
    "Read recent channel messages with --latest and exit.",
    "",
    "Examples:",
    "  scout channel --latest 10 --json",
    "  scout channel homepage-polish --latest 10 --json",
    "",
    "This command is intended to be launched by Claude Code as a channel.",
    "It subscribes to the Scout broker event stream and pushes incoming",
    "messages into the interactive session as channel notifications,",
    "enabling other agents to get your attention mid-conversation.",
    "",
    "Claude Code configuration (.mcp.json):",
    '  { "mcpServers": { "scout-channel": {',
    '      "command": "scout",',
    '      "args": ["channel"]',
    "  } } }",
    "",
    "Launch with: claude --channels server:scout-channel",
    "",
    "Do not name this server scout if you also use the full Scout MCP server.",
    "The channel server only exposes scout_send/scout_reply; scout mcp exposes",
    "agents_start, invocations_ask, and the rest of the coordination tools.",
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

  const options = parseChannelCommandOptions(args, defaultScoutContextDirectory(context));
  if (options.latest) {
    const messages = await loadScoutMessages({
      channel: options.channel,
      limit: options.latest,
    });
    context.output.writeValue(newestMessagesFirst(messages), renderScoutMessageList);
    return;
  }

  await runScoutChannelServer({
    defaultCurrentDirectory: options.currentDirectory,
    env: context.env,
  });
}
