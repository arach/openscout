import { resolve } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  loadScoutBrokerContext,
  loadScoutInboxDeliveries,
  loadScoutMessages,
  listScoutChannelMemberships,
  markScoutConversationRead,
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
  replyToScoutMessage,
  sendScoutMessageToAgentIds,
  type ScoutBrokerContext,
} from "../broker/service.ts";
import { SCOUT_APP_VERSION } from "../../shared/product.ts";
import {
  isInboxClaimableDeliveryStatus,
  type AgentEndpoint,
  type InboxItem,
  type MessageRecord,
} from "@openscout/protocol";

type InboxStreamEvent = {
  item?: InboxItem;
  items?: InboxItem[];
};

const scoutChannelStartedAt = Date.now();

type ScoutChannelToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function scoutChannelTextResult(text: string, isError = false): ScoutChannelToolResult {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function scoutChannelJsonResult(value: unknown, isError = false): ScoutChannelToolResult {
  return scoutChannelTextResult(JSON.stringify(value, null, 2), isError);
}

function parseOptionalLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 200);
}

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
        const streamUrl = new URL("/v1/inbox/stream", broker.baseUrl);
        streamUrl.searchParams.set("targetId", agentId);
        const response = await fetch(
          streamUrl,
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

            if (!["snapshot", "inbox.item", "inbox.item.updated"].includes(eventName) || dataLines.length === 0)
              continue;

            let event: InboxStreamEvent | InboxItem;
            try {
              event = JSON.parse(dataLines.join("\n")) as InboxStreamEvent | InboxItem;
            } catch {
              continue;
            }

            const items = eventName === "snapshot"
              ? ((event as InboxStreamEvent).items ?? [])
              : [("item" in (event as InboxStreamEvent) ? (event as InboxStreamEvent).item : event as InboxItem)]
                .filter((item): item is InboxItem => Boolean(item));

            for (const item of items) {
              if (!isInboxClaimableDeliveryStatus(item.status)) {
                continue;
              }
              if (!item.message || item.message.actorId === agentId) {
                continue;
              }
              const claim = await claimInboxItem(broker, {
                itemId: item.id,
                targetId: agentId,
              });
              if (!claim?.message) {
                continue;
              }
              const delivered = await onMessage(claim.message);
              if (delivered) {
                await ackInboxItem(broker, {
                  itemId: claim.id,
                  leaseOwner: `scout-channel:${agentId}`,
                });
              } else {
                await nackInboxItem(broker, {
                  itemId: claim.id,
                  leaseOwner: `scout-channel:${agentId}`,
                  reason: "channel notification was not accepted by host",
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

function displayNameForChannelActor(
  broker: ScoutBrokerContext,
  message: MessageRecord,
): string {
  return (
    broker.snapshot.agents[message.actorId]?.displayName?.trim()
    || broker.snapshot.actors[message.actorId]?.displayName?.trim()
    || message.mentions?.find((mention) => mention.actorId === message.actorId)?.label?.trim()
    || message.actorId
  );
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

async function claimInboxItem(
  broker: ScoutBrokerContext,
  input: {
    itemId: string;
    targetId: string;
  },
): Promise<InboxItem | null> {
  const result = await postBrokerJson<{ claimed?: InboxItem | null }>(
    broker,
    "/v1/inbox/claim",
    {
      itemId: input.itemId,
      targetId: input.targetId,
      leaseOwner: `scout-channel:${input.targetId}`,
      leaseMs: 30_000,
    },
  );
  return result?.claimed ?? null;
}

async function ackInboxItem(
  broker: ScoutBrokerContext,
  input: { itemId: string; leaseOwner: string },
): Promise<void> {
  await postBrokerJson(broker, "/v1/inbox/ack", input);
}

async function nackInboxItem(
  broker: ScoutBrokerContext,
  input: { itemId: string; leaseOwner: string; reason?: string },
): Promise<void> {
  await postBrokerJson(broker, "/v1/inbox/nack", input);
}

function scoutChannelEndpointId(agentId: string): string {
  return `claude-channel:${agentId}:${process.pid}`;
}

function buildScoutChannelEndpoint(input: {
  broker: ScoutBrokerContext;
  agentId: string;
  currentDirectory: string;
  state: AgentEndpoint["state"];
}): AgentEndpoint {
  const now = Date.now();
  return {
    id: scoutChannelEndpointId(input.agentId),
    agentId: input.agentId,
    nodeId: input.broker.node.id,
    harness: "claude",
    transport: "claude_channel",
    state: input.state,
    sessionId: process.env.CLAUDE_SESSION_ID ?? process.env.CLAUDE_CODE_SESSION_ID ?? String(process.pid),
    cwd: input.currentDirectory,
    projectRoot: input.currentDirectory,
    metadata: {
      source: "scout-channel",
      processId: process.pid,
      startedAt: scoutChannelStartedAt,
      lastSeenAt: now,
    },
  };
}

async function upsertScoutChannelEndpoint(input: {
  broker: ScoutBrokerContext;
  agentId: string;
  currentDirectory: string;
  state: AgentEndpoint["state"];
}): Promise<void> {
  await postBrokerJson(input.broker, "/v1/endpoints", buildScoutChannelEndpoint(input));
}

function startScoutChannelHeartbeat(input: {
  broker: ScoutBrokerContext;
  agentId: string;
  currentDirectory: string;
  signal: AbortSignal;
}): void {
  const heartbeat = async () => {
    if (input.signal.aborted) return;
    await upsertScoutChannelEndpoint({ ...input, state: "active" });
  };

  void heartbeat();
  const interval = setInterval(() => void heartbeat(), 15_000);
  input.signal.addEventListener("abort", () => {
    clearInterval(interval);
    void upsertScoutChannelEndpoint({ ...input, state: "offline" });
  }, { once: true });
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
        "Read them and respond. Use scout_reply with conversation_id and message_id to send threaded acknowledgements, progress, and completions back through the mesh.",
        "Use scout_send for unprompted messages to other agents or to post in a named channel.",
        "For channel posts, prefer scout_reply with conversation_id and message_id from the incoming notification; otherwise use scout_send with channel set to the channel slug (for example homies).",
        "Use scout_channels_list, scout_inbox_latest, scout_inbox_pending, and scout_channel_latest to catch up on mesh traffic you may have missed.",
        "Use scout_mark_read after you have caught up on a channel or conversation.",
        `Your agent ID is ${agentId}.`,
      ].join(" "),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "scout_whoami",
        description:
          "Inspect the current Scout agent identity and broker URL for this channel session.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "scout_channels_list",
        description:
          "List named Scout channels this agent belongs to, including shared workspace channels.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "scout_inbox_latest",
        description:
          "Read recent direct or addressed Scout messages for this agent. Use this to catch up on mesh traffic you may have missed.",
        inputSchema: {
          type: "object" as const,
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of messages to return (default 20, max 200).",
            },
            since: {
              type: "number",
              description: "Optional unix timestamp; only return messages after this time.",
            },
          },
        },
      },
      {
        name: "scout_inbox_pending",
        description:
          "List pending or claimable Scout inbox deliveries for this agent. Use this to find messages that may not have been pushed into the live session yet.",
        inputSchema: {
          type: "object" as const,
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of inbox items to return (default 20, max 200).",
            },
          },
        },
      },
      {
        name: "scout_channel_latest",
        description:
          "Read recent messages from a named Scout channel. Defaults to the shared channel.",
        inputSchema: {
          type: "object" as const,
          properties: {
            channel: {
              type: "string",
              description: "Named channel slug such as shared, triage, or homepage-polish.",
            },
            limit: {
              type: "number",
              description: "Maximum number of messages to return (default 20, max 200).",
            },
            since: {
              type: "number",
              description: "Optional unix timestamp; only return messages after this time.",
            },
          },
        },
      },
      {
        name: "scout_mark_read",
        description:
          "Mark a Scout channel or conversation read for this agent and acknowledge delivered inbox items.",
        inputSchema: {
          type: "object" as const,
          properties: {
            channel: {
              type: "string",
              description: "Named channel slug to mark read. Defaults to shared.",
            },
            conversation_id: {
              type: "string",
              description: "Optional explicit conversation id instead of channel slug.",
            },
          },
        },
      },
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
            message_id: {
              type: "string",
              description:
                "The incoming message ID to reply to (from the channel message's message_id attribute). Optional.",
            },
          },
          required: ["to", "text"],
        },
      },
      {
        name: "scout_send",
        description:
          "Send a new Scout message. Use to for a direct agent target, channel for a named channel post, or both to mention agents in a channel.",
        inputSchema: {
          type: "object" as const,
          properties: {
            to: {
              type: "string",
              description: "Optional target agent ID or @handle for a direct message or channel mention.",
            },
            channel: {
              type: "string",
              description: "Optional named channel slug such as homies or shared.",
            },
            text: {
              type: "string",
              description: "The message body",
            },
          },
          required: ["text"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, string | number>;

    if (req.params.name === "scout_whoami") {
      return scoutChannelJsonResult({
        agentId,
        brokerUrl: broker.baseUrl,
        currentDirectory,
      });
    }

    if (req.params.name === "scout_channels_list") {
      return scoutChannelJsonResult({
        agentId,
        channels: listScoutChannelMemberships(broker.snapshot, agentId),
      });
    }

    if (req.params.name === "scout_inbox_latest") {
      const limit = parseOptionalLimit(
        typeof args.limit === "number" ? String(args.limit) : args.limit?.toString(),
        20,
      );
      const since = typeof args.since === "number"
        ? args.since
        : Number.parseInt(String(args.since ?? ""), 10);
      const messages = await loadScoutMessages({
        participantId: agentId,
        inboxOnly: true,
        limit,
        since: Number.isFinite(since) && since > 0 ? since : undefined,
        baseUrl: broker.baseUrl,
      });
      return scoutChannelJsonResult({
        agentId,
        limit,
        since: Number.isFinite(since) && since > 0 ? since : null,
        count: messages.length,
        messages,
      });
    }

    if (req.params.name === "scout_inbox_pending") {
      const limit = parseOptionalLimit(
        typeof args.limit === "number" ? String(args.limit) : args.limit?.toString(),
        20,
      );
      const items = await loadScoutInboxDeliveries({
        targetId: agentId,
        limit,
        statuses: "pending,accepted,deferred",
        baseUrl: broker.baseUrl,
      });
      return scoutChannelJsonResult({
        agentId,
        limit,
        count: items.length,
        items,
      });
    }

    if (req.params.name === "scout_channel_latest") {
      const channel = String(args.channel ?? "shared").trim() || "shared";
      const limit = parseOptionalLimit(
        typeof args.limit === "number" ? String(args.limit) : args.limit?.toString(),
        20,
      );
      const since = typeof args.since === "number"
        ? args.since
        : Number.parseInt(String(args.since ?? ""), 10);
      const messages = await loadScoutMessages({
        channel,
        limit,
        since: Number.isFinite(since) && since > 0 ? since : undefined,
        baseUrl: broker.baseUrl,
      });
      return scoutChannelJsonResult({
        channel,
        limit,
        since: Number.isFinite(since) && since > 0 ? since : null,
        count: messages.length,
        messages,
      });
    }

    if (req.params.name === "scout_mark_read") {
      const conversationId = String(args.conversation_id ?? "").trim() || undefined;
      const channel = conversationId ? undefined : (String(args.channel ?? "shared").trim() || "shared");
      const result = await markScoutConversationRead({
        actorId: agentId,
        channel,
        conversationId,
        metadata: { source: "scout-channel", action: "channel.mark-read" },
        baseUrl: broker.baseUrl,
      });
      return scoutChannelJsonResult({
        conversationId: result.cursor.conversationId,
        actorId: agentId,
        lastReadMessageId: result.cursor.lastReadMessageId ?? null,
        acknowledgedDeliveries: result.acknowledgedDeliveries,
      });
    }

    if (req.params.name === "scout_reply") {
      const to = String(args.to ?? "").trim();
      const text = String(args.text ?? "").trim();
      if (!to || !text) {
        return scoutChannelTextResult("Missing 'to' or 'text' argument.", true);
      }

      const conversationId = String(args.conversation_id ?? "").trim();
      const replyToMessageId = String(args.message_id ?? "").trim();
      if (conversationId && replyToMessageId) {
        const result = await replyToScoutMessage({
          senderId: agentId,
          body: text,
          conversationId,
          replyToMessageId,
          currentDirectory,
          source: "scout-channel",
        });

        if (result.routingError || !result.usedBroker) {
          return scoutChannelTextResult(
            `Scout reply was not sent: ${result.routingError ?? "broker is not reachable"}.`,
            true,
          );
        }
      } else {
        await sendScoutMessageToAgentIds({
          senderId: agentId,
          body: text,
          targetAgentIds: [to],
          currentDirectory,
          source: "scout-channel",
        });
      }

      return scoutChannelTextResult(`Replied to ${to}.`);
    }

    if (req.params.name === "scout_send") {
      const to = String(args.to ?? "").trim();
      const channel = String(args.channel ?? "").trim();
      const text = String(args.text ?? "").trim();
      if (!text || (!to && !channel)) {
        return scoutChannelTextResult("Missing 'text' and either 'to' or 'channel'.", true);
      }

      const result = await sendScoutMessageToAgentIds({
        senderId: agentId,
        body: text,
        targetAgentIds: to ? [to] : [],
        channel: channel || undefined,
        currentDirectory,
        source: "scout-channel",
      });

      if (result.routingError) {
        return scoutChannelTextResult(`Scout send failed: ${result.routingError}.`, true);
      }
      if (!result.usedBroker) {
        return scoutChannelTextResult("Scout broker is not reachable.", true);
      }
      if (result.unresolvedTargetIds.length > 0) {
        return scoutChannelTextResult(
          `Unresolved targets: ${result.unresolvedTargetIds.join(", ")}.`,
          true,
        );
      }

      const destination = channel
        ? `#${channel}`
        : to;
      return scoutChannelTextResult(
        `Sent to ${destination}${result.conversationId ? ` (${result.conversationId})` : ""}.`,
      );
    }

    return scoutChannelTextResult(`Unknown tool: ${req.params.name}`, true);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const abortController = new AbortController();
  process.on("SIGINT", () => abortController.abort());
  process.on("SIGTERM", () => abortController.abort());
  process.on("beforeExit", () => abortController.abort());

  startScoutChannelHeartbeat({
    broker,
    agentId,
    currentDirectory,
    signal: abortController.signal,
  });

  startBrokerSubscription(
    broker,
    agentId,
    async (message) => {
      const senderName = displayNameForChannelActor(broker, message);

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
