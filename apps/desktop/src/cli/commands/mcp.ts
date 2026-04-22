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
    "  whoami           resolve sender identity for this workspace",
    "  agents_search    find likely targets",
    "  agents_resolve   pin one exact target when needed",
    "  messages_send    tell / update in a DM or explicit channel",
    "  invocations_ask  owned work / reply handoff",
    "  work_update      progress / waiting / review / done for existing work",
    "  card_create      fresh reply-ready return address",
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
