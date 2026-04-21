import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import {
  parseAskCommandOptions,
  type ScoutAskCommandOptions,
} from "../options.ts";
import {
  askScoutQuestion,
  parseScoutHarness,
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
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

function renderAmbiguousCandidate(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function renderConversationRoute(conversationId?: string): string {
  if (!conversationId) {
    return "conversation";
  }
  return conversationId.startsWith("dm.")
    ? `DM ${conversationId}`
    : `conversation ${conversationId}`;
}

export function formatScoutAskRoutingError(
  result: Pick<ScoutAskResult, "targetDiagnostic">,
  targetLabel: string,
): string {
  const renderedTarget = renderScoutTargetLabel(targetLabel);
  const diagnostic = result.targetDiagnostic;

  if (diagnostic?.state === "ambiguous") {
    const rendered = diagnostic.candidates
      .map((candidate) =>
        renderAmbiguousCandidate(candidate.label || candidate.agentId),
      )
      .filter((label) => label.length > 0);
    if (rendered.length > 0) {
      return `target ${renderedTarget} matches multiple agents: ${rendered.join(", ")}. Re-run with the fully qualified form (e.g. \`scout ask --to ${rendered[0].replace(/^@/, "")} ...\`).`;
    }
    return `target ${renderedTarget} matches multiple agents; nothing was sent. Re-run with a fully qualified @handle to disambiguate.`;
  }

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

export async function runAskCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  const options = parseAskCommandOptions(
    args,
    defaultScoutContextDirectory(context),
  );
  await runAskWithOptions(context, options);
}

export async function runAskWithOptions(
  context: ScoutCommandContext,
  options: ScoutAskCommandOptions,
): Promise<void> {
  const currentDirectory =
    options.currentDirectory ?? defaultScoutContextDirectory(context);
  const senderId = await resolveScoutSenderId(
    options.agentName,
    currentDirectory,
    context.env,
  );
  const result = await askScoutQuestion({
    senderId,
    targetLabel: options.targetLabel,
    body: options.message,
    channel: options.channel,
    executionHarness: parseScoutHarness(options.harness),
    currentDirectory,
  });

  if (!result.usedBroker) {
    throw new Error("broker is not reachable");
  }
  if (!result.flight) {
    throw new Error(formatScoutAskRoutingError(result, options.targetLabel));
  }

  context.stderr(
    `asking ${result.flight.targetAgentId} as ${senderId} via ${renderConversationRoute(result.conversationId)}... (flight ${result.flight.id})`,
  );
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
      senderId,
      conversationId: result.conversationId ?? null,
      messageId: result.messageId ?? null,
      flight: completed,
      output: completed.output ?? completed.summary ?? "",
    },
    (value) => value.output,
  );
}
