import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import { runScoutMcpServer } from "../../core/mcp/scout-mcp.ts";
import { renderMcpInstallHelp, runMcpInstallCommand } from "./mcp-install.ts";

export function renderMcpCommandHelp(): string {
  return [
    "Usage:",
    "  scout mcp [--context-root <path>]",
    "  scout mcp install [--host <codex|claude>] [--force] [--dry-run]",
    "",
    "Run or install the Scout MCP server.",
    "",
    "The stdio server form is intended to be launched by an MCP host. It exposes",
    "the same canonical Scout coordination loop the CLI teaches:",
    "",
    "  whoami           inspect sender identity when the host is unclear",
    "  session_attach_current",
    "                   attach the current live Codex session to Scout",
    "  card_create      fresh reply-ready return address",
    "  agents_search    find likely targets when routing is ambiguous",
    "  agents_resolve   pin one exact target when needed",
    "  messages_send    tell / update with explicit target fields or channel",
    "  invocations_ask  owned work / reply handoff with explicit target fields",
    "  work_update      progress / waiting / review / done for existing work",
    "",
    "Pass targets as tool fields. Message body text is payload, so quoted",
    "handles such as @codex should not become routing instructions.",
    "",
    renderMcpInstallHelp(),
  ].join("\n");
}

export async function runMcpCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  const subcommand = args[0]?.trim() || "";

  if (args.includes("--help") || args.includes("-h")) {
    context.output.writeText(renderMcpCommandHelp());
    return;
  }

  if (subcommand === "install") {
    await runMcpInstallCommand(context, args.slice(1));
    return;
  }

  const options = parseContextRootCommandOptions("mcp", args, defaultScoutContextDirectory(context));
  await runScoutMcpServer({
    defaultCurrentDirectory: options.currentDirectory,
    env: context.env,
  });
}
