import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseWatchCommandOptions } from "../options.ts";
import { watchScoutMessages } from "../../core/broker/service.ts";
import { renderScoutMessage } from "../../ui/terminal/broker.ts";

export async function runWatchCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseWatchCommandOptions(args, defaultScoutContextDirectory(context));
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
        context.output.writeValue(message, renderScoutMessage);
      },
    });
  } finally {
    process.off("SIGINT", shutdown);
  }
}
