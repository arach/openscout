import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import { buildScoutVantagePlanFromEnvironment } from "../../core/vantage/plan.ts";
import { renderScoutVantagePlan } from "../../ui/terminal/vantage.ts";

function renderVantageHelp(): string {
  return [
    "Usage:",
    "  scout vantage plan [--context-root <path>] [--json]",
    "",
    "Commands:",
    "  plan        Build a Hudson Vantage setup manifest from local Scout context",
    "",
    "Examples:",
    "  scout vantage plan --json",
    "  scout vantage plan --context-root /path/to/project --json",
  ].join("\n");
}

export async function runVantageCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const subcommand = args[0] ?? "help";

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    context.output.writeText(renderVantageHelp());
    return;
  }

  if (subcommand !== "plan") {
    throw new ScoutCliError(`unknown vantage command: ${subcommand}`);
  }

  const options = parseContextRootCommandOptions(
    "vantage plan",
    args.slice(1),
    defaultScoutContextDirectory(context),
  );
  const plan = await buildScoutVantagePlanFromEnvironment({
    currentDirectory: options.currentDirectory,
  });

  context.output.writeValue(plan, renderScoutVantagePlan);
}
