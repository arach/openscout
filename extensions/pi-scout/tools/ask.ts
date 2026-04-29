import { brokerClient } from "../broker/client.ts";
import { loadConfig } from "../config.ts";

export const scoutAskTool = {
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
    _ctx: unknown,
  ) {
    const config = loadConfig();
    const replyMode = params.replyMode ?? config.defaultReplyMode;

    // Resolve target — label or id
    const isLabel = !params.target.includes(":");
    const target = isLabel
      ? { kind: "agent_label" as const, label: params.target.replace(/^@/, "") }
      : { kind: "agent_id" as const, id: params.target };

    const response = await brokerClient.deliver({
      intent: "consult",
      body: params.body,
      target,
      workItem: params.workItem,
    });

    // Handle reply modes
    if (replyMode === "none") {
      return {
        content: [
          {
            type: "text" as const,
            text: response.receiptText ?? `Ask queued for ${params.target}`,
          },
        ],
      };
    }

    if (replyMode === "notify") {
      return {
        content: [
          {
            type: "text" as const,
            text:
              response.receiptText ??
              `Ask queued for ${params.target}. You'll be notified when it's done.`,
          },
        ],
        // TODO: register SSE handler for flight completion
      };
    }

    // inline — wait for flight completion
    if (!response.flight) {
      return {
        content: [
          {
            type: "text" as const,
            text: response.receiptText ?? `Ask sent to ${params.target}`,
          },
        ],
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
          text: result.output ?? result.summary ?? "Done.",
        },
      ],
      details: result,
    };
  },
};
