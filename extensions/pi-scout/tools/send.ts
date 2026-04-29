import { brokerClient } from "../broker/client.ts";
import type { ToolExecutor } from "@mariozechner/pi-coding-agent";

export const scoutSendTool = {
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
    _ctx: unknown,
  ) {
    // Resolve target — label or id
    const isLabel = !params.target.includes(":");
    const target = isLabel
      ? { kind: "agent_label" as const, label: params.target.replace(/^@/, "") }
      : { kind: "agent_id" as const, id: params.target };

    const response = await brokerClient.deliver({
      intent: "tell",
      body: params.body,
      target,
      channel: params.channel,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: response.receiptText ?? `Message queued for ${params.target}`,
        },
      ],
    };
  },
};
