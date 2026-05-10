import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseWatchCommandOptions } from "../options.ts";
import {
  loadScoutMessages,
  watchScoutMessages,
  type ScoutBrokerMessageRecord,
} from "../../core/broker/service.ts";
import {
  renderScoutMessage,
  renderScoutMessageList,
} from "../../ui/terminal/broker.ts";

export async function runWatchCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseWatchCommandOptions(args, defaultScoutContextDirectory(context));
  const emitMessage = (message: ScoutBrokerMessageRecord) => {
    if (context.output.mode === "json") {
      context.stdout(JSON.stringify(message));
      return;
    }
    context.output.writeValue(message, renderScoutMessage);
  };

  if (options.since || options.limit) {
    const backlog = await loadScoutMessages({
      channel: options.channel,
      since: options.since,
      limit: options.limit,
    });
    if (options.once) {
      context.output.writeValue(backlog, renderScoutMessageList);
      return;
    }
    for (const message of backlog) {
      emitMessage(message);
    }
  }

  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.on("SIGINT", shutdown);

  try {
    if (context.output.mode === "plain") {
      context.stdout(`Watching ${options.channel?.trim() || "shared"}`);
    }
    await watchScoutMessages({
      channel: options.channel,
      signal: controller.signal,
      onMessage(message) {
        emitMessage(message);
      },
    });
  } finally {
    process.off("SIGINT", shutdown);
  }
}
