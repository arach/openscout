import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseWhoCommandOptions } from "../options.ts";
import { listScoutAgents } from "../../core/broker/service.ts";
import { renderScoutAgentList } from "../../ui/terminal/broker.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);

export function renderWhoCommandHelp(): string {
  return [
    "Usage: scout who [--context-root <path>] [--project <path>] [--json]",
    "",
    "List agents known to the broker for routing and discovery, grouped by project.",
    "",
    "Use this before sending or asking when you need the exact target.",
    "Use --project . to show every known agent attached to the current project.",
    "Short handles like @hudson can be ambiguous; copy a qualified handle or agent id from discovery output when needed.",
    "Qualified handles can include harness and model selectors, such as @talkie#codex?5.5.",
    "",
    "Examples:",
    "  scout who",
    "  scout who --project .",
    "  scout who --json",
    "  scout send --to talkie#codex?5.5 \"status?\"",
  ].join("\n");
}

export async function runWhoCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderWhoCommandHelp());
    return;
  }

  const options = parseWhoCommandOptions(args, defaultScoutContextDirectory(context));
  const entries = await listScoutAgents({
    currentDirectory: options.currentDirectory,
    projectPath: options.projectPath,
  });
  context.output.writeValue(entries, renderScoutAgentList);
}
