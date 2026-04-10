import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseSendCommandOptions } from "../options.ts";
import { parseScoutHarness, resolveScoutAgentName, sendScoutMessage } from "../../core/broker/service.ts";
import { renderScoutMessagePostResult } from "../../ui/terminal/broker.ts";

export async function runSendCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseSendCommandOptions(args, defaultScoutContextDirectory(context));
  const result = await sendScoutMessage({
    senderId: resolveScoutAgentName(options.agentName),
    body: options.message,
    channel: options.channel,
    shouldSpeak: options.shouldSpeak,
    executionHarness: parseScoutHarness(options.harness),
    currentDirectory: options.currentDirectory,
  });

  if (!result.usedBroker) {
    throw new Error("broker is not reachable");
  }

  context.output.writeValue(
    {
      message: options.message,
      invokedTargets: result.invokedTargets,
      unresolvedTargets: result.unresolvedTargets,
    },
    renderScoutMessagePostResult,
  );
}
