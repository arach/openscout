import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseSendCommandOptions } from "../options.ts";
import { parseScoutHarness, resolveScoutSenderId, sendScoutMessage } from "../../core/broker/service.ts";
import { renderScoutBroadcastResult } from "../../ui/terminal/broker.ts";
import { formatScoutSendRoutingError } from "./send.ts";

export async function runBroadcastCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseSendCommandOptions(args, defaultScoutContextDirectory(context));
  const currentDirectory = options.currentDirectory ?? defaultScoutContextDirectory(context);
  const senderId = await resolveScoutSenderId(options.agentName, currentDirectory, context.env);
  const result = await sendScoutMessage({
    senderId,
    body: `@all ${options.message}`,
    channel: "shared",
    executionHarness: parseScoutHarness(options.harness),
    currentDirectory,
  });

  if (!result.usedBroker) {
    throw new Error("broker is not reachable");
  }
  if (result.unresolvedTargets.length > 0) {
    throw new Error(formatScoutSendRoutingError(result.unresolvedTargets));
  }

  context.output.writeValue(
    {
      message: options.message,
      invokedTargets: result.invokedTargets,
      unresolvedTargets: result.unresolvedTargets,
      routeKind: result.routeKind,
    },
    renderScoutBroadcastResult,
  );
}
