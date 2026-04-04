import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseSetupCommandOptions } from "../options.ts";
import { runScoutSetup } from "../../core/setup/service.ts";
import { renderScoutSetupReport } from "../../ui/terminal/setup.ts";

export async function runSetupCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseSetupCommandOptions(args, defaultScoutContextDirectory(context));
  const report = await runScoutSetup(options);
  context.output.writeValue(report, renderScoutSetupReport);
}
