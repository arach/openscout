import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseLatestCommandOptions } from "../options.ts";
import { loadScoutActivityItems } from "../../core/broker/service.ts";
import { renderScoutActivityList } from "../../ui/terminal/broker.ts";

export async function runLatestCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseLatestCommandOptions(args, defaultScoutContextDirectory(context));
  const items = await loadScoutActivityItems({
    agentId: options.agentId,
    actorId: options.actorId,
    conversationId: options.conversationId,
    limit: options.limit,
  });
  context.output.writeValue(items, renderScoutActivityList);
}
