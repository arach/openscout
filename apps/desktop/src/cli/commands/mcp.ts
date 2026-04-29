import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import { runScoutMcpServer } from "../../core/mcp/scout-mcp.ts";

export function renderMcpCommandHelp(): string {
  return [
    "Usage: scout mcp [--context-root <path>]",
    "",
    "Run a Scout MCP server over stdio.",
    "",
    "This command is intended to be launched by an MCP host. It exposes",
    "the same canonical Scout coordination loop the CLI teaches:",
    "",
    "  whoami           inspect sender identity when the host is unclear",
    "  agents_search    find likely targets when routing is ambiguous",
    "  agents_resolve   pin one exact target when needed",
    "  messages_send    tell / update with explicit target fields or channel",
    "  invocations_ask  owned work / reply handoff with explicit target fields",
    "  work_update      progress / waiting / review / done for existing work",
    "  card_create      fresh reply-ready return address",
    "",
    "Pass targets as tool fields. Message body text is payload, so quoted",
    "handles such as @codex should not become routing instructions.",
  ].join("\n");
}

export async function runMcpCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    context.output.writeText(renderMcpCommandHelp());
    return;
  }

  const options = parseContextRootCommandOptions("mcp", args, defaultScoutContextDirectory(context));
  await runScoutMcpServer({
    defaultCurrentDirectory: options.currentDirectory,
    env: context.env,
  });
}
