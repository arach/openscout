import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseSendCommandOptions } from "../options.ts";
import {
  parseScoutHarness,
  resolveScoutSenderId,
  sendScoutMessage,
} from "../../core/broker/service.ts";
import { renderScoutMessagePostResult } from "../../ui/terminal/broker.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);

export function renderSendCommandHelp(): string {
  return [
    "Usage: scout send [--as <sender>] [--channel <name>] [--speak] [--harness <runtime>] <message>",
    "",
    "Tell or update another agent or an explicit channel.",
    "",
    "Routing:",
    "  one explicit @agent + no channel   -> DM",
    "  --channel <name>                   -> named group thread",
    "  no target + no channel             -> error",
    "  multiple targets + no channel      -> error",
    "",
    "Use send for heads-up, replies, and status updates.",
    "Use `scout ask` when the meaning is \"do this and get back to me.\"",
    "",
    "Examples:",
    '  scout send "@hudson ready for review"',
    '  scout send --as premotion.master.mini "@hudson editor branch is green"',
    '  scout send --channel triage "need two reviewers"',
  ].join("\n");
}

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

function formatScoutRouteChoiceError(
  routingError:
    | "missing_destination"
    | "multi_target_requires_explicit_channel",
): string {
  if (routingError === "missing_destination") {
    return "message has no explicit destination; use @agent for a DM, --channel <name> for a group thread, or scout broadcast for channel.shared.";
  }
  return "message targets multiple agents without an explicit channel; send separate DMs, use --channel <name> for a group thread, or use scout broadcast for channel.shared.";
}

export async function runSendCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderSendCommandHelp());
    return;
  }

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
  if (result.routingError) {
    throw new Error(formatScoutRouteChoiceError(result.routingError));
  }

  context.output.writeValue(
    {
      senderId,
      conversationId: result.conversationId,
      message: options.message,
      invokedTargets: result.invokedTargets,
      unresolvedTargets: result.unresolvedTargets,
      routeKind: result.routeKind,
    },
    renderScoutMessagePostResult,
  );
}
