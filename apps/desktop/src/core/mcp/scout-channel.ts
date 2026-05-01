import { resolve } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import {
  loadScoutBrokerContext,
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
  sendScoutMessage,
  sendScoutMessageToAgentIds,
  askScoutAgentById,
  type ScoutBrokerContext,
} from "../broker/service.ts";
import { scoutBrokerPaths } from "../broker/paths.ts";
import { SCOUT_APP_VERSION } from "../../shared/product.ts";
import type { DeliveryIntent, DeliveryReason, MessageRecord } from "@openscout/protocol";

type ControlEvent = {
  kind: string;
  payload?: {
    message?: MessageRecord;
  };
};

async function resolveAgentId(
  currentDirectory: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return resolveScoutSenderId(undefined, currentDirectory, env);
}

function startBrokerSubscription(
  broker: ScoutBrokerContext,
  agentId: string,
  onMessage: (message: MessageRecord) => Promise<boolean> | boolean,
  signal: AbortSignal,
): void {
  const connect = async () => {
    while (!signal.aborted) {
      try {
        const response = await fetch(
          new URL(scoutBrokerPaths.v1.eventsStream, broker.baseUrl),
          { headers: { accept: "text/event-stream" }, signal },
        );
        if (!response.ok || !response.body) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let delimiterIndex: number;
          while ((delimiterIndex = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, delimiterIndex).trim();
            buffer = buffer.slice(delimiterIndex + 2);
            if (!block) continue;

            let eventName = "";
            const dataLines: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:"))
                eventName = line.slice("event:".length).trim();
              if (line.startsWith("data:"))
                dataLines.push(line.slice("data:".length).trim());
            }

            if (eventName !== "message.posted" || dataLines.length === 0)
              continue;

            let event: ControlEvent;
            try {
              event = JSON.parse(dataLines.join("\n")) as ControlEvent;
            } catch {
              continue;
            }

            const message = event.payload?.message;
            if (!message) continue;

            if (message.actorId === agentId) continue;

            const mentionsMe = message.mentions?.some(
              (m) => m.actorId === agentId,
            );
            const audienceIncludesMe =
              message.audience?.notify?.includes(agentId);

            if (mentionsMe || audienceIncludesMe) {
              const claim = await claimMessageDelivery(broker, {
                messageId: message.id,
                targetId: agentId,
                reasons: [
                  "conversation_visibility",
                  "mention",
                  "direct_message",
                ],
              });
              if (!claim && audienceIncludesMe) {
                continue;
              }

              const delivered = await onMessage(message);
              if (claim) {
                await updateDeliveryStatus(broker, {
                  deliveryId: claim.id,
                  status: delivered ? "acknowledged" : "pending",
                  leaseOwner: null,
                  leaseExpiresAt: null,
                });
              }
            }
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        const msg =
          error instanceof Error ? error.message : String(error);
        if (msg.includes("AbortError")) return;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  void connect();
}

async function postBrokerJson<T>(
  broker: ScoutBrokerContext,
  path: string,
  payload: unknown,
): Promise<T | null> {
  try {
    const response = await fetch(new URL(path, broker.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function claimMessageDelivery(
  broker: ScoutBrokerContext,
  input: {
    messageId: string;
    targetId: string;
    reasons: DeliveryReason[];
  },
): Promise<DeliveryIntent | null> {
  const result = await postBrokerJson<{ claimed?: DeliveryIntent | null }>(
    broker,
    "/v1/deliveries/claim",
    {
      messageId: input.messageId,
      targetId: input.targetId,
      reasons: input.reasons,
      leaseOwner: `scout-channel:${input.targetId}`,
      leaseMs: 30_000,
    },
  );
  return result?.claimed ?? null;
}

async function updateDeliveryStatus(
  broker: ScoutBrokerContext,
  input: {
    deliveryId: string;
    status: DeliveryIntent["status"];
    leaseOwner: string | null;
    leaseExpiresAt: number | null;
  },
): Promise<void> {
  await postBrokerJson(
    broker,
    "/v1/deliveries/status",
    input,
  );
}

export async function runScoutChannelServer(options: {
  defaultCurrentDirectory: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = options.env ?? process.env;
  const currentDirectory = resolve(
    options.defaultCurrentDirectory || process.cwd(),
  );

  const agentId = await resolveAgentId(currentDirectory, env);
  const brokerUrl =
    env.OPENSCOUT_BROKER_URL?.trim() || resolveScoutBrokerUrl();
  const broker = await loadScoutBrokerContext(brokerUrl);
  if (!broker) {
    throw new Error("Scout broker is not reachable. Run 'scout doctor' to check.");
  }

  const server = new Server(
    { name: "scout", version: SCOUT_APP_VERSION },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: [
        "You are connected to the Scout agent mesh.",
        "Incoming messages from other agents arrive as <channel source=\"scout\" ...> tags.",
        "Read them and respond. Use the scout_reply tool to send a reply back through the mesh.",
        "Use scout_send for unprompted messages to other agents.",
        `Your agent ID is ${agentId}.`,
      ].join(" "),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "scout_reply",
        description:
          "Reply to a Scout message through the mesh. Use this when responding to an incoming channel message.",
        inputSchema: {
          type: "object" as const,
          properties: {
            to: {
              type: "string",
              description:
                "The agent ID to reply to (from the channel message's from_agent_id attribute)",
            },
            text: {
              type: "string",
              description: "The reply message body",
            },
            conversation_id: {
              type: "string",
              description:
                "The conversation ID from the incoming message (from the channel message's conversation_id attribute). Optional.",
            },
          },
          required: ["to", "text"],
        },
      },
      {
        name: "scout_send",
        description:
          "Send a new message to another Scout agent. Use this for initiating contact, not for replies.",
        inputSchema: {
          type: "object" as const,
          properties: {
            to: {
              type: "string",
              description: "The target agent ID or @handle",
            },
            text: {
              type: "string",
              description: "The message body",
            },
          },
          required: ["to", "text"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, string>;

    if (req.params.name === "scout_reply") {
      const to = args.to?.trim();
      const text = args.text?.trim();
      if (!to || !text) {
        return {
          content: [{ type: "text", text: "Missing 'to' or 'text' argument." }],
          isError: true,
        };
      }

      const result = await sendScoutMessageToAgentIds({
        senderId: agentId,
        body: text,
        targetAgentIds: [to],
        currentDirectory,
        source: "scout-channel",
      });

      return {
        content: [
          {
            type: "text",
            text: `Replied to ${to}. Route: ${result.routeKind ?? "dm"}. Conversation: ${result.conversationId ?? "none"}.`,
          },
        ],
      };
    }

    if (req.params.name === "scout_send") {
      const to = args.to?.trim();
      const text = args.text?.trim();
      if (!to || !text) {
        return {
          content: [{ type: "text", text: "Missing 'to' or 'text' argument." }],
          isError: true,
        };
      }

      const result = await sendScoutMessageToAgentIds({
        senderId: agentId,
        body: text,
        targetAgentIds: [to],
        currentDirectory,
        source: "scout-channel",
      });

      return {
        content: [
          {
            type: "text",
            text: `Sent to ${to}. Route: ${result.routeKind ?? "dm"}. Conversation: ${result.conversationId ?? "none"}.`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const abortController = new AbortController();
  process.on("SIGINT", () => abortController.abort());
  process.on("SIGTERM", () => abortController.abort());

  startBrokerSubscription(
    broker,
    agentId,
    async (message) => {
      const senderName =
        message.mentions?.find((m) => m.actorId === message.actorId)?.label ??
        message.actorId;

      const meta: Record<string, string> = {
        from_agent_id: message.actorId,
        from_name: senderName,
        conversation_id: message.conversationId,
        message_id: message.id,
        message_class: message.class,
      };

      try {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content: `[${senderName}] ${message.body}`,
            meta,
          },
        });
        return true;
      } catch {
        // Session may not be ready yet; drop silently.
        return false;
      }
    },
    abortController.signal,
  );
}
