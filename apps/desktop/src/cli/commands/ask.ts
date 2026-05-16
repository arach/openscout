import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import {
  parseAskCommandOptions,
  type ScoutAskCommandOptions,
} from "../options.ts";
import { resolvePromptBody } from "../input-file.ts";
import {
  askScoutQuestion,
  loadScoutFlight,
  parseScoutHarness,
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
  type ScoutAskResult,
  waitForScoutFlight,
} from "../../core/broker/service.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);
const DEFAULT_ASK_ACK_TIMEOUT_SECONDS = 30;

export function renderAskCommandHelp(): string {
  return [
    "Usage: scout ask (--to <agent> | --ref <ref>) [--as <sender>] [--channel <name>] [--timeout <seconds>] [--reply-mode inline|notify|none] [--no-wait] [--harness <runtime>] [--prompt-file <path> | <message>]",
    "",
    "Ask one agent to do work or return a concrete answer.",
    "",
    "Routing:",
    "  one target + no channel            -> DM",
    "  --channel <name>                   -> named group thread",
    "  short @name                        -> must resolve to exactly one routable agent",
    "",
    "Use ask when the meaning is \"do this and get back to me.\"",
    "The command creates durable broker work; the target should acknowledge quickly in the same DM or channel.",
    `Default inline mode returns once the target has acknowledged, completed immediately, or stays unacknowledged for ${DEFAULT_ASK_ACK_TIMEOUT_SECONDS}s.`,
    "Use the flight id, conversation, notify mode, or an explicit wait to follow the final completion.",
    "",
    "Input:",
    "  inline message                    -> primary prompt body",
    "  --prompt-file <path>              -> read the primary prompt body from a UTF-8 file",
    "  --body-file <path>                -> alias for --prompt-file",
    "",
    "Examples:",
    '  scout ask --to hudson "review the parser"',
    '  scout ask --ref 7f3a9c21 "continue from that result"',
    "  scout ask --to hudson --prompt-file ./handoff.md",
    '  scout ask --as premotion.master.mini --to hudson "build the editor"',
    '  scout ask --to hudson --reply-mode notify "take the next pass and report back"',
    '  scout ask --to hudson --no-wait "start the longer implementation"',
    '  scout ask --to vox.harness:codex "take another pass on the runtime fix"',
    '  scout ask --to lattices#codex?5.5 "take task A"',
    '  scout ask --to lattices#claude?sonnet "take task B"',
  ].join("\n");
}

function renderScoutAskReceipt(value: {
  conversationId?: string | null;
  messageId?: string | null;
  bindingRef?: string | null;
  flight: NonNullable<ScoutAskResult["flight"]>;
  replyMode: NonNullable<ScoutAskCommandOptions["replyMode"]>;
}): string {
  const pieces = [
    `asked ${value.flight.targetAgentId}`,
    `flight ${value.flight.id}`,
    value.conversationId ? renderConversationRoute(value.conversationId) : null,
    value.bindingRef,
  ].filter((piece): piece is string => Boolean(piece));
  const suffix = value.replyMode === "notify"
    ? "Scout will surface the completion when it arrives."
    : `Next: scout flight wait ${value.flight.id} --timeout 30`;
  return `${pieces.join(" · ")}. ${suffix}`;
}

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

  if (diagnostic?.state === "unavailable") {
    const runtime = diagnostic.transport ? ` (${diagnostic.transport})` : "";
    const wakePolicy = diagnostic.wakePolicy ? ` [wake:${diagnostic.wakePolicy}]` : "";
    return `target ${renderedTarget} is known but currently unavailable${runtime}${wakePolicy}; nothing was sent. ${diagnostic.detail}`;
  }

  if (diagnostic?.state === "unknown") {
    return `there is no ${renderedTarget}; nothing was sent.`;
  }

  if (diagnostic?.state === "invalid" || diagnostic?.state === "missing") {
    return `${diagnostic.detail}; nothing was sent.`;
  }

  return `target ${renderedTarget} is not currently routable; nothing was sent.`;
}

export async function runAskCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderAskCommandHelp());
    return;
  }

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
  const body = await resolvePromptBody(options);
  const result = await askScoutQuestion({
    senderId,
    targetLabel: options.targetLabel,
    targetRef: options.targetRef,
    body,
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

  const replyMode = options.replyMode ?? "inline";
  if (replyMode !== "inline") {
    context.output.writeValue(
      {
        senderId,
        conversationId: result.conversationId ?? null,
        messageId: result.messageId ?? null,
        bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
        flight: result.flight,
        replyMode,
      },
      renderScoutAskReceipt,
    );
    return;
  }

  const brokerUrl = resolveScoutBrokerUrl();
  let completed: NonNullable<ScoutAskResult["flight"]>;
  let timedOut = false;
  try {
    completed = await waitForScoutFlight(
      brokerUrl,
      result.flight.id,
      {
        timeoutSeconds: options.timeoutSeconds ?? DEFAULT_ASK_ACK_TIMEOUT_SECONDS,
        waitUntil: "acknowledged",
        onUpdate: (_flight, detail) => context.stderr(detail),
      },
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Timed out waiting for flight")) {
      throw error;
    }
    timedOut = true;
    completed = await loadScoutFlight(brokerUrl, result.flight.id) ?? result.flight;
  }

  context.output.writeValue(
    {
      senderId,
      conversationId: result.conversationId ?? null,
      messageId: result.messageId ?? null,
      bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
      flight: completed,
      output: renderScoutAskInlineResult({
        conversationId: result.conversationId ?? null,
        messageId: result.messageId ?? null,
        bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
        flight: completed,
        timedOut,
      }),
    },
    (value) => value.output,
  );
}

function renderScoutAskInlineResult(value: {
  conversationId?: string | null;
  messageId?: string | null;
  bindingRef?: string | null;
  flight: NonNullable<ScoutAskResult["flight"]>;
  timedOut?: boolean;
}): string {
  if (value.flight.state === "completed") {
    return value.flight.output ?? value.flight.summary ?? "";
  }

  const pieces = [
    value.timedOut
      ? `not yet acknowledged ${value.flight.targetAgentId}`
      : `acknowledged ${value.flight.targetAgentId}`,
    `state ${value.flight.state}`,
    `flight ${value.flight.id}`,
    value.conversationId ? renderConversationRoute(value.conversationId) : null,
    value.bindingRef,
  ].filter((piece): piece is string => Boolean(piece));
  return `${pieces.join(" · ")}. Next: scout flight wait ${value.flight.id} --timeout 30.`;
}
