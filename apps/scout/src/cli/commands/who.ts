import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import { listScoutAgents } from "../../core/broker/service.ts";
import { renderScoutAgentList } from "../../ui/terminal/broker.ts";

export async function runWhoCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseContextRootCommandOptions("who", args, defaultScoutContextDirectory(context));
  const entries = await listScoutAgents({ currentDirectory: options.currentDirectory });
  context.output.writeValue(entries, renderScoutAgentList);
}
