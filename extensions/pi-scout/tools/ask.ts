import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { brokerClient } from "../broker/client.ts";
import { loadConfig } from "../config.ts";
import type { FlightRecord, ScoutDeliverResponse } from "@openscout/protocol";
import type { ScoutRuntime } from "../runtime.ts";

export function createScoutAskTool(runtime: ScoutRuntime) {
  return {
    name: "scout_ask",
    label: "Scout Ask",
    description:
      "Ask a Scout agent to do work and wait for the result. " +
      "Use replyMode='inline' to wait for the result directly, " +
      "'notify' to get notified when done, or 'none' for fire-and-forget.",

    parameters: {
      target: {
        type: "string" as const,
        description: "Agent label (e.g. @hudson) or agent ID",
      },
      body: {
        type: "string" as const,
        description: "Task description or question",
      },
      replyMode: {
        type: "string" as const,
        description: "How to receive the result",
        default: "inline",
        required: false as const,
      },
      workItem: {
        type: "object" as const,
        description: "Optional work item to create alongside the ask",
        required: false as const,
        properties: {
          title: { type: "string" as const, description: "Work item title" },
        },
      },
    },

    async execute(
      _id: string,
      params: {
        target: string;
        body: string;
        replyMode?: "none" | "inline" | "notify";
        workItem?: { title: string };
      },
      signal: AbortSignal,
      _onUpdate: (update: unknown) => void,
      ctx: ExtensionContext,
    ) {
      await runtime.ensureEngaged(ctx);

      const config = loadConfig();
      const replyMode = params.replyMode ?? config.defaultReplyMode;

      const response = await brokerClient.deliver({
        intent: "consult",
        body: params.body,
        target: resolveTarget(params.target),
        workItem: params.workItem,
      });

      if (response.kind !== "delivery") {
        return {
          content: [
            {
              type: "text" as const,
              text: describeDeliveryFailure(params.target, response),
            },
          ],
          details: response,
        };
      }

      // Handle reply modes
      if (replyMode === "none") {
        return {
          content: [
            {
              type: "text" as const,
              text: response.flight
                ? `Ask queued for ${params.target}`
                : `Ask sent to ${params.target}`,
            },
          ],
          details: response,
        };
      }

      if (replyMode === "notify") {
        return {
          content: [
            {
              type: "text" as const,
              text: response.flight
                ? `Ask queued for ${params.target}. You'll be notified when it's done.`
                : `Ask sent to ${params.target}`,
            },
          ],
          details: response,
        };
      }

      // inline — wait for flight completion
      if (!response.flight) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Ask sent to ${params.target}`,
            },
          ],
          details: response,
        };
      }

      const result = await brokerClient.waitForFlight(response.flight.id, {
        signal,
        timeoutMs: 300_000,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: describeFlightResult(result),
          },
        ],
        details: result,
      };
    },
  };
}

function resolveTarget(target: string) {
  return target.includes(":")
    ? { kind: "agent_id" as const, id: target }
    : { kind: "agent_label" as const, label: target.replace(/^@/, "") };
}

function describeDeliveryFailure(
  target: string,
  response: Exclude<ScoutDeliverResponse, { kind: "delivery" }>,
): string {
  if (response.kind === "question") {
    return response.remediation?.detail ?? `Target ${target} is unavailable right now.`;
  }

  return response.remediation?.detail ?? `Could not reach ${target}: ${response.reason.replaceAll("_", " ")}`;
}

function describeFlightResult(result: FlightRecord): string {
  return result.output ?? result.summary ?? result.error ?? "Done.";
}
