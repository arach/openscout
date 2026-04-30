import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { brokerClient } from "../broker/client.ts";
import type { ScoutDeliverResponse } from "@openscout/protocol";
import type { ScoutRuntime } from "../runtime.ts";

export function createScoutSendTool(runtime: ScoutRuntime) {
  return {
    name: "scout_send",
    label: "Scout Send",
    description: "Send a message to a Scout agent via the broker",

    parameters: {
      target: {
        type: "string" as const,
        description: "Agent label (e.g. @hudson) or agent ID",
      },
      body: {
        type: "string" as const,
        description: "Message body to send",
      },
      channel: {
        type: "string" as const,
        description: "Optional channel to post in",
        required: false as const,
      },
    },

    async execute(
      _id: string,
      params: { target: string; body: string; channel?: string },
      _signal: AbortSignal,
      _onUpdate: (update: unknown) => void,
      ctx: ExtensionContext,
    ) {
      await runtime.ensureEngaged(ctx);

      const response = await brokerClient.deliver({
        intent: "tell",
        body: params.body,
        target: resolveTarget(params.target),
        channel: params.channel,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: describeDeliveryResponse(params.target, response),
          },
        ],
        details: response,
      };
    },
  };
}

function resolveTarget(target: string) {
  return target.includes(":")
    ? { kind: "agent_id" as const, id: target }
    : { kind: "agent_label" as const, label: target.replace(/^@/, "") };
}

function describeDeliveryResponse(
  target: string,
  response: ScoutDeliverResponse,
): string {
  if (response.kind === "delivery") {
    return `Message queued for ${target}`;
  }

  if (response.kind === "question") {
    return response.remediation?.detail ?? `Target ${target} is unavailable right now.`;
  }

  return response.remediation?.detail ?? `Could not reach ${target}: ${response.reason.replaceAll("_", " ")}`;
}
