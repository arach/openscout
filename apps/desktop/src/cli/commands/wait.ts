import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import {
  resolveScoutBrokerUrl,
  resolveScoutWaitReference,
  waitForScoutInvocation,
  type ScoutFlightRecord,
  type ScoutInvocationSnapshot,
  type ScoutWaitResolution,
} from "../../core/broker/service.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);
const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
const MAX_WAIT_TIMEOUT_SECONDS = 86_400;

type ScoutWaitCommandOptions =
  | { command: "help" }
  | { command: "wait"; ref: string; timeoutSeconds?: number };

type ScoutWaitCommandResult = {
  input: string;
  found: boolean;
  timedOut: boolean;
  resolution: Extract<ScoutWaitResolution, { found: true }> | null;
  invocationId: string | null;
  flight: ScoutFlightRecord | null;
  failureLayer: string | null;
  failureDetail: string | null;
  messageDelivery: string | null;
  output: string | null;
  summary: string | null;
  error: string | null;
  nextAction: string | null;
};

export function renderWaitCommandHelp(): string {
  return [
    "Usage: scout wait <ref> [--timeout <seconds>]",
    "",
    "Wait for a Scout ask to finish from an invocation id, flight id, message id, or ref:<short-id>.",
    "",
    "Examples:",
    "  scout wait inv_123",
    "  scout wait flt_123 --timeout 600",
    "  scout wait ref:7f3a9c21",
  ].join("\n");
}

export function parseWaitCommandOptions(args: string[]): ScoutWaitCommandOptions {
  if (args.length === 0 || args.some((arg) => HELP_FLAGS.has(arg))) {
    return { command: "help" };
  }

  let ref: string | undefined;
  let timeoutSeconds: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--timeout") {
      const rawValue = args[index + 1];
      if (!rawValue) {
        throw new ScoutCliError("--timeout requires a number of seconds");
      }
      timeoutSeconds = parseWaitTimeout(rawValue);
      index += 1;
      continue;
    }
    if (arg.startsWith("--timeout=")) {
      timeoutSeconds = parseWaitTimeout(arg.slice("--timeout=".length));
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ScoutCliError(`unknown wait option: ${arg}`);
    }
    if (ref) {
      throw new ScoutCliError(`unexpected extra argument: ${arg}`);
    }
    ref = arg;
  }

  if (!ref?.trim()) {
    throw new ScoutCliError("wait requires <ref>");
  }
  return { command: "wait", ref: ref.trim(), ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}) };
}

export async function runWaitCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  const options = parseWaitCommandOptions(args);
  if (options.command === "help") {
    context.output.writeText(renderWaitCommandHelp());
    return;
  }

  const brokerUrl = resolveScoutBrokerUrl();
  const resolution = await resolveScoutWaitReference(brokerUrl, options.ref);
  if (!resolution.found) {
    const candidates = resolution.candidates.length > 0
      ? ` Candidates: ${resolution.candidates.join(", ")}`
      : "";
    throw new ScoutCliError(`could not resolve wait ref: ${options.ref}.${candidates}`);
  }

  let timedOut = false;
  let snapshot: ScoutInvocationSnapshot | null = null;
  try {
    snapshot = await waitForScoutInvocation(brokerUrl, resolution.invocationId, {
      timeoutSeconds: options.timeoutSeconds ?? DEFAULT_WAIT_TIMEOUT_SECONDS,
      onUpdate: (_snapshot, detail) => context.stderr(detail),
    });
  } catch (error) {
    if (isInvocationWaitTimeout(error)) {
      timedOut = true;
    } else {
      throw error;
    }
  }

  context.output.writeValue(
    buildWaitCommandResult({
      input: options.ref,
      resolution,
      snapshot,
      timedOut,
    }),
    renderWaitCommandResult,
  );
}

export function renderWaitCommandResult(result: ScoutWaitCommandResult): string {
  if (!result.found || !result.resolution) {
    return `Wait ref ${result.input} was not found.`;
  }

  const lines = [
    `Invocation: ${result.invocationId}`,
    result.flight ? `Flight: ${result.flight.id}` : null,
    result.flight ? `State: ${result.flight.state}` : null,
    result.failureLayer ? `Failure Layer: ${result.failureLayer}` : null,
    result.failureDetail ? `Failure Detail: ${result.failureDetail}` : null,
    result.messageDelivery ? `Message Delivery: ${result.messageDelivery}` : null,
    `Resolved: ${result.resolution.kind}`,
    result.resolution.messageId ? `Message: ${result.resolution.messageId}` : null,
    result.resolution.bindingRef ? `Ref: ref:${result.resolution.bindingRef}` : null,
    result.summary ? `Summary: ${result.summary}` : null,
    result.output ? `Output:\n${result.output}` : null,
    result.error ? `Error: ${result.error}` : null,
    result.nextAction ? `Next: ${result.nextAction}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function buildWaitCommandResult(input: {
  input: string;
  resolution: Extract<ScoutWaitResolution, { found: true }>;
  snapshot: ScoutInvocationSnapshot | null;
  timedOut: boolean;
}): ScoutWaitCommandResult {
  const flight = input.snapshot?.flight ?? null;
  const failure = describeWaitFailure(input.snapshot, flight, input.resolution);
  return {
    input: input.input,
    found: true,
    timedOut: input.timedOut,
    resolution: input.resolution,
    invocationId: input.resolution.invocationId,
    flight,
    failureLayer: failure?.layer ?? null,
    failureDetail: failure?.detail ?? null,
    messageDelivery: failure?.messageDelivery ?? null,
    output: flight?.output ?? null,
    summary: flight?.summary ?? null,
    error: flight?.error ?? null,
    nextAction: renderWaitNextAction(input.resolution.invocationId, flight, input.timedOut),
  };
}

function renderWaitNextAction(
  invocationId: string,
  flight: ScoutFlightRecord | null,
  timedOut: boolean,
): string | null {
  if (flight?.state === "completed") return null;
  if (flight?.state === "failed" || flight?.state === "cancelled") {
    return "Inspect the error above, then retry or follow up in the conversation.";
  }
  const command = `scout wait ${invocationId} --timeout ${DEFAULT_WAIT_TIMEOUT_SECONDS}`;
  if (timedOut) {
    return `Still ${flight?.state ?? "pending"}; run \`${command}\` again.`;
  }
  return `Run \`${command}\` to keep waiting.`;
}

type WaitFailureDescription = {
  layer: string;
  detail: string | null;
  messageDelivery: string | null;
};

function describeWaitFailure(
  snapshot: ScoutInvocationSnapshot | null,
  flight: ScoutFlightRecord | null,
  resolution: Extract<ScoutWaitResolution, { found: true }>,
): WaitFailureDescription | null {
  if (!flight) {
    return null;
  }

  const metadata = flight.metadata ?? {};
  const dispatchAck = metadataRecord(metadata, "dispatchAck");
  const dispatchDetail = renderDispatchAckDetail(dispatchAck);
  const failureStage = metadataString(metadata, "failureStage");
  const timeoutScope = metadataString(metadata, "timeoutScope");
  const sourceIntent = metadataString(metadata, "sourceIntent")
    ?? metadataString(snapshot?.invocation?.metadata, "sourceIntent");
  const messageDelivery = sourceIntent === "direct_message" && resolution.messageId
    ? `broker accepted message ${resolution.messageId}; the direct-message wake invocation failed.`
    : null;

  if (failureStage) {
    return {
      layer: layerForFailureStage(failureStage),
      detail: detailForFailureStage(failureStage, dispatchDetail, flight.error ?? flight.summary),
      messageDelivery,
    };
  }

  if (timeoutScope === "requester_wait") {
    return {
      layer: "response_timeout",
      detail: `Scout stopped waiting for a synchronous result${dispatchDetail ? ` after ${dispatchDetail}` : ""}.`,
      messageDelivery,
    };
  }

  if (flight.state === "failed" || flight.state === "cancelled") {
    if (dispatchAck) {
      return {
        layer: "harness_execution",
        detail: dispatchDetail
          ? `Failed after dispatch acknowledgement from ${dispatchDetail}.`
          : "Failed after the target acknowledged dispatch.",
        messageDelivery,
      };
    }
    if ((snapshot?.dispatches ?? []).length > 0) {
      const dispatch = snapshot!.dispatches[0]!;
      return {
        layer: `routing_${dispatch.kind}`,
        detail: dispatch.detail,
        messageDelivery,
      };
    }
    return {
      layer: "broker_dispatch",
      detail: flight.error ?? flight.summary ?? null,
      messageDelivery,
    };
  }

  return null;
}

function layerForFailureStage(stage: string): string {
  switch (stage) {
    case "endpoint_resolution":
      return "session_attach";
    case "dispatch_stalled":
      return "harness_dispatch";
    case "codex_app_server_sigterm":
    case "codex_app_server_proactive_shutdown":
      return "worker_process_exit";
    case "empty_reply":
      return "response_validation";
    case "harness_execution":
      return "harness_execution";
    default:
      return stage;
  }
}

function detailForFailureStage(
  stage: string,
  dispatchDetail: string | null,
  fallback: string | null | undefined,
): string | null {
  switch (stage) {
    case "endpoint_resolution":
      return fallback ?? "Scout could not resolve or attach a compatible endpoint before execution.";
    case "dispatch_stalled":
      return fallback ?? "Scout submitted to the harness, but the prompt remained in the composer.";
    case "codex_app_server_sigterm":
      return fallback ?? "The Codex app-server worker exited before replying.";
    case "codex_app_server_proactive_shutdown":
      return fallback ?? "OpenScout stopped the Codex app-server worker before it replied.";
    case "empty_reply":
      return fallback ?? "The worker completed without broker-visible output.";
    case "harness_execution":
      return dispatchDetail
        ? `Failed after dispatch acknowledgement from ${dispatchDetail}.`
        : fallback ?? "The worker failed after dispatch acknowledgement.";
    default:
      return fallback ?? dispatchDetail;
  }
}

function renderDispatchAckDetail(value: Record<string, unknown> | null): string | null {
  if (!value) {
    return null;
  }
  const harness = metadataString(value, "harness");
  const transport = metadataString(value, "transport");
  const strategy = metadataString(value, "strategy");
  const sessionId = metadataString(value, "sessionId");
  const endpointId = metadataString(value, "endpointId");
  const subject = harness && transport
    ? `${harness} via ${transport}`
    : transport ?? harness ?? endpointId ?? "target endpoint";
  const pieces = [
    subject,
    strategy ? `strategy ${strategy}` : null,
    sessionId ? `session ${sessionId}` : null,
  ].filter((piece): piece is string => Boolean(piece));
  return pieces.join(", ");
}

function metadataRecord(
  metadata: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseWaitTimeout(value: string): number {
  const timeoutSeconds = Number(value);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new ScoutCliError("--timeout must be a positive number of seconds");
  }
  if (timeoutSeconds > MAX_WAIT_TIMEOUT_SECONDS) {
    throw new ScoutCliError(`--timeout must be ${MAX_WAIT_TIMEOUT_SECONDS} seconds or less`);
  }
  return timeoutSeconds;
}

function isInvocationWaitTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Timed out waiting for invocation");
}
