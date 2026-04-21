import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseSendCommandOptions } from "../options.ts";
import {
  parseScoutHarness,
  resolveScoutSenderId,
  sendScoutMessage,
} from "../../core/broker/service.ts";
import { renderScoutMessagePostResult } from "../../ui/terminal/broker.ts";

function renderTargetLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function formatScoutSendRoutingError(
  unresolvedTargets: string[],
): string {
  const rendered = unresolvedTargets
    .map(renderTargetLabel)
    .filter((label) => label.length > 0);
  if (rendered.length === 1) {
    return `target ${rendered[0]} is not uniquely routable; nothing was sent.`;
  }
  return `targets ${rendered.join(", ")} are not uniquely routable; nothing was sent.`;
}

export async function runSendCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  const options = parseSendCommandOptions(
    args,
    defaultScoutContextDirectory(context),
  );
  const currentDirectory =
    options.currentDirectory ?? defaultScoutContextDirectory(context);
  const senderId = await resolveScoutSenderId(
    options.agentName,
    currentDirectory,
    context.env,
  );
  const result = await sendScoutMessage({
    senderId,
    body: options.message,
    channel: options.channel,
    shouldSpeak: options.shouldSpeak,
    executionHarness: parseScoutHarness(options.harness),
    currentDirectory: options.currentDirectory,
  });

  if (!result.usedBroker) {
    throw new Error("broker is not reachable");
  }
  if (result.unresolvedTargets.length > 0) {
    throw new Error(formatScoutSendRoutingError(result.unresolvedTargets));
  }

  context.output.writeValue(
    {
      senderId,
      conversationId: result.conversationId,
      message: options.message,
      invokedTargets: result.invokedTargets,
      unresolvedTargets: result.unresolvedTargets,
    },
    renderScoutMessagePostResult,
  );
}
