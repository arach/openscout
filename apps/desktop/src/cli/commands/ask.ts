import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseAskCommandOptions, type ScoutAskCommandOptions } from "../options.ts";
import {
  askScoutQuestion,
  parseScoutHarness,
  resolveScoutAgentName,
  resolveScoutBrokerUrl,
  type ScoutAskResult,
  waitForScoutFlight,
} from "../../core/broker/service.ts";

function renderScoutTargetLabel(targetLabel: string): string {
  const trimmed = targetLabel.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function renderScoutUpCommand(projectRoot: string): string {
  return `scout up "${projectRoot}"`;
}

export function formatScoutAskRoutingError(
  result: Pick<ScoutAskResult, "targetDiagnostic">,
  targetLabel: string,
): string {
  const renderedTarget = renderScoutTargetLabel(targetLabel);
  const diagnostic = result.targetDiagnostic;

  if (diagnostic?.state === "discovered") {
    if (diagnostic.projectRoot) {
      return `target ${renderedTarget} is discovered but not online yet; nothing was sent. Start it with \`${renderScoutUpCommand(diagnostic.projectRoot)}\` or wait for it to come online.`;
    }
    return `target ${renderedTarget} is discovered but not online yet; nothing was sent. Run \`scout who\` to inspect the target, then start its project before retrying.`;
  }

  if (diagnostic?.state === "offline") {
    if (diagnostic.projectRoot) {
      return `target ${renderedTarget} is offline; nothing was sent. Start it with \`${renderScoutUpCommand(diagnostic.projectRoot)}\` or bring it back online before retrying.`;
    }
    return `target ${renderedTarget} is offline; nothing was sent. Run \`scout who\` to inspect the target before retrying.`;
  }

  return `target ${renderedTarget} is not currently routable; nothing was sent.`;
}

export async function runAskCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseAskCommandOptions(args, defaultScoutContextDirectory(context));
  await runAskWithOptions(context, options);
}

export async function runAskWithOptions(
  context: ScoutCommandContext,
  options: ScoutAskCommandOptions,
): Promise<void> {
  const result = await askScoutQuestion({
    senderId: resolveScoutAgentName(options.agentName),
    targetLabel: options.targetLabel,
    body: options.message,
    channel: options.channel,
    executionHarness: parseScoutHarness(options.harness),
    currentDirectory: options.currentDirectory,
  });

  if (!result.usedBroker) {
    throw new Error("broker is not reachable");
  }
  if (!result.flight) {
    throw new Error(formatScoutAskRoutingError(result, options.targetLabel));
  }

  context.stderr(`asking ${result.flight.targetAgentId}... (flight ${result.flight.id})`);
  const completed = await waitForScoutFlight(
    resolveScoutBrokerUrl(),
    result.flight.id,
    {
      timeoutSeconds: options.timeoutSeconds,
      onUpdate: (_flight, detail) => context.stderr(detail),
    },
  );

  context.output.writeValue(
    {
      flight: completed,
      output: completed.output ?? completed.summary ?? "",
    },
    (value) => value.output,
  );
}
