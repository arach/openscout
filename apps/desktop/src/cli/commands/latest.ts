import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseLatestCommandOptions } from "../options.ts";
import {
  loadScoutActivityItems,
  loadScoutMessages,
  scoutConversationIdForChannel,
} from "../../core/broker/service.ts";
import {
  renderScoutActivityList,
  renderScoutMessageList,
} from "../../ui/terminal/broker.ts";

function newestMessagesFirst<T extends { createdAt: number }>(messages: T[]): T[] {
  return [...messages].sort((left, right) => right.createdAt - left.createdAt);
}

export async function runLatestCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseLatestCommandOptions(args, defaultScoutContextDirectory(context));
  const conversationId = options.conversationId ?? (
    options.channel ? scoutConversationIdForChannel(options.channel) : undefined
  );
  if (options.messages) {
    const messages = await loadScoutMessages({
      channel: options.channel,
      conversationId,
      limit: options.limit,
    });
    context.output.writeValue(newestMessagesFirst(messages), renderScoutMessageList);
    return;
  }

  const items = await loadScoutActivityItems({
    agentId: options.agentId,
    actorId: options.actorId,
    conversationId,
    limit: options.limit,
  });
  context.output.writeValue(items, renderScoutActivityList);
}
