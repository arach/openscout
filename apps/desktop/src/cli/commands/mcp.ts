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
    "broker-backed tools for sender resolution, live agent search and resolve,",
    "message send, and ask-style invocations.",
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
