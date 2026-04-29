import { afterEach, describe, expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as z from "zod/v4";

import {
  SCOUT_MCP_UI_META_KEY,
  createScoutMcpServer,
  type ScoutMcpAgentCandidate,
} from "./scout-mcp.ts";

const openClients = new Set<Client>();
const openServers = new Set<ReturnType<typeof createScoutMcpServer>>();

afterEach(async () => {
  await Promise.all(
    [...openClients].map(async (client) => {
      await client.close();
      openClients.delete(client);
    }),
  );
  await Promise.all(
    [...openServers].map(async (server) => {
      await server.close();
      openServers.delete(server);
    }),
  );
});

async function connectTestServer(
  dependencies: Parameters<typeof createScoutMcpServer>[0]["dependencies"],
) {
  const server = createScoutMcpServer({
    defaultCurrentDirectory: "/tmp/openscout-test",
    env: {
      ...process.env,
      OPENSCOUT_BROKER_URL: "http://broker.test",
    },
    dependencies,
  });
  const client = new Client(
    { name: "openscout-test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  openServers.add(server);
  openClients.add(client);
  return { client, server };
}

describe("createScoutMcpServer", () => {
  test("registers the core Scout MCP tools", async () => {
    const { client } = await connectTestServer({
      resolveSenderId: async () => "operator",
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => [],
      resolveAgent: async () => ({
        kind: "unresolved",
        candidate: null,
        candidates: [],
      }),
      sendMessage: async () => ({
        usedBroker: true,
        invokedTargets: [],
        unresolvedTargets: [],
      }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({ usedBroker: true }),
      updateWorkItem: async () => {
        throw new Error("not used");
      },
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "whoami",
      "card_create",
      "agents_search",
      "agents_resolve",
      "messages_send",
      "invocations_ask",
      "work_update",
    ]);
    expect(result.tools.find((tool) => tool.name === "whoami")?.description)
      .toContain("Start here.");
    expect(result.tools.find((tool) => tool.name === "messages_send")?.description)
      .toContain("For owned work or a reply lifecycle, use invocations_ask instead.");
    expect(result.tools.find((tool) => tool.name === "work_update")?.description)
      .toContain("progress, waiting, review, and done transitions");
  });

  test("advertises host-consumable agent picker metadata for Scout routing fields", async () => {
    const { client } = await connectTestServer({
      resolveSenderId: async () => "operator",
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => [],
      resolveAgent: async () => ({
        kind: "unresolved",
        candidate: null,
        candidates: [],
      }),
      sendMessage: async () => ({
        usedBroker: true,
        invokedTargets: [],
        unresolvedTargets: [],
      }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({ usedBroker: true }),
      updateWorkItem: async () => {
        throw new Error("not used");
      },
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const result = await client.listTools();
    const sendTool = result.tools.find((tool) => tool.name === "messages_send") as
      | {
          _meta?: Record<string, unknown>;
          inputSchema?: {
            properties?: Record<string, { description?: string }>;
          };
        }
      | undefined;
    const askTool = result.tools.find((tool) => tool.name === "invocations_ask") as
      | {
          _meta?: Record<string, unknown>;
          inputSchema?: {
            properties?: Record<string, { description?: string }>;
          };
        }
      | undefined;

    expect(sendTool?._meta).toMatchObject({
      [SCOUT_MCP_UI_META_KEY]: {
        icon: {
          kind: "semantic",
          name: "agent",
          fallbackGlyph: "@",
        },
        fields: {
          targetLabel: {
            kind: "agent-picker",
            selection: "single",
            sourceTool: "agents_search",
            resolveTool: "agents_resolve",
            valueField: "label",
            labelField: "label",
            descriptionField: "displayName",
          },
          mentionAgentIds: {
            kind: "agent-picker",
            selection: "multiple",
            sourceTool: "agents_search",
            valueField: "agentId",
          },
        },
      },
    });
    expect(askTool?._meta).toMatchObject({
      [SCOUT_MCP_UI_META_KEY]: {
        fields: {
          targetAgentId: {
            kind: "agent-picker",
            selection: "single",
            sourceTool: "agents_search",
            valueField: "agentId",
          },
          targetLabel: {
            kind: "agent-picker",
            selection: "single",
            sourceTool: "agents_search",
            resolveTool: "agents_resolve",
            valueField: "label",
          },
        },
      },
    });
    expect(sendTool?.inputSchema?.properties?.targetLabel?.description).toBe(
      "Scout agent handle to contact, such as @talkie or @talkie#codex?5.5",
    );
    expect(askTool?.inputSchema?.properties?.targetAgentId?.description).toBe(
      "Exact Scout agent id when already known, such as talkie.master.mini",
    );
  });

  test("surfaces broker-backed search results", async () => {
    const { client } = await connectTestServer({
      resolveSenderId: async (_senderId, currentDirectory) =>
        `sender:${currentDirectory}`,
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async ({ query }) => {
        const candidates: ScoutMcpAgentCandidate[] = [
          {
            agentId: "hudson.main",
            label: "@hudson",
            defaultLabel: "@hudson",
            displayName: "Hudson",
            handle: "hudson",
            selector: "hudson",
            defaultSelector: "hudson",
            state: "active",
            registrationKind: "broker",
            routable: true,
            harness: "codex",
            model: "gpt-5.5",
            workspace: "main",
            node: "mini",
            projectRoot: "/tmp/openscout-test",
            transport: "codex_app_server",
          },
        ];
        return candidates.filter(
          (candidate) => !query || candidate.label.includes(query),
        );
      },
      resolveAgent: async () => ({
        kind: "unresolved",
        candidate: null,
        candidates: [],
      }),
      sendMessage: async () => ({
        usedBroker: true,
        invokedTargets: [],
        unresolvedTargets: [],
      }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({ usedBroker: true }),
      updateWorkItem: async () => {
        throw new Error("not used");
      },
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const whoami = await client.callTool({
      name: "whoami",
      arguments: { currentDirectory: "/worktree/app" },
    });
    expect(
      (whoami.structuredContent as { defaultSenderId: string }).defaultSenderId,
    ).toBe("sender:/worktree/app");

    const result = await client.callTool({
      name: "agents_search",
      arguments: { query: "hud" },
    });
    expect(
      (result.structuredContent as { candidates: Array<{ agentId: string }> })
        .candidates,
    ).toHaveLength(1);
    expect(
      (result.structuredContent as { candidates: Array<{ agentId: string }> })
        .candidates[0]?.agentId,
    ).toBe("hudson.main");
  });

  test("creates a reply-ready card from the current sender and directory", async () => {
    let receivedModel: string | undefined;
    const { client } = await connectTestServer({
      resolveSenderId: async () => "scout.main.mini",
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => [],
      resolveAgent: async () => ({
        kind: "unresolved",
        candidate: null,
        candidates: [],
      }),
      createAgentCard: async ({
        projectPath,
        currentDirectory,
        createdById,
        agentName,
        model,
      }) => {
        receivedModel = model;
        return {
        id: "scout-codex-reply.main.mini",
        agentId: "scout-codex-reply.main.mini",
        definitionId: agentName ?? "scout-codex-reply",
        displayName: "Scout Codex Reply",
        handle: "scout-codex-reply",
        defaultSelector: "@scout-codex-reply",
        projectRoot: projectPath,
        currentDirectory,
        harness: "codex",
        transport: "codex_app_server",
        createdAt: 123,
        createdById,
        brokerRegistered: true,
        inboxConversationId: "dm.scout-codex-reply.main.mini.scout.main.mini",
        returnAddress: {
          actorId: "scout-codex-reply.main.mini",
          handle: "scout-codex-reply",
          defaultSelector: "@scout-codex-reply",
          conversationId: "dm.scout-codex-reply.main.mini.scout.main.mini",
        },
        };
      },
      sendMessage: async () => ({
        usedBroker: true,
        invokedTargets: [],
        unresolvedTargets: [],
      }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({ usedBroker: true }),
      updateWorkItem: async () => {
        throw new Error("not used");
      },
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const result = await client.callTool({
      name: "card_create",
      arguments: {
        agentName: "scout-codex-reply",
        model: "gpt-5.4-mini",
      },
    });

    const structured = result.structuredContent as {
      senderId: string;
      currentDirectory: string;
      card: {
        agentId: string;
        projectRoot: string;
        createdById?: string;
        inboxConversationId?: string;
        returnAddress: { conversationId?: string };
      };
    };

    expect(structured.senderId).toBe("scout.main.mini");
    expect(structured.currentDirectory).toBe("/tmp/openscout-test");
    expect(structured.card.agentId).toBe("scout-codex-reply.main.mini");
    expect(structured.card.projectRoot).toBe("/tmp/openscout-test");
    expect(structured.card.createdById).toBe("scout.main.mini");
    expect(structured.card.inboxConversationId).toBe(
      "dm.scout-codex-reply.main.mini.scout.main.mini",
    );
    expect(structured.card.returnAddress.conversationId).toBe(
      "dm.scout-codex-reply.main.mini.scout.main.mini",
    );
    expect(receivedModel).toBe("gpt-5.4-mini");
  });

  test("awaits explicit ask-by-id flights when requested", async () => {
    const { client } = await connectTestServer({
      resolveSenderId: async () => "operator",
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => [],
      resolveAgent: async () => ({
        kind: "unresolved",
        candidate: null,
        candidates: [],
      }),
      sendMessage: async () => ({
        usedBroker: true,
        invokedTargets: [],
        unresolvedTargets: [],
      }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({
        usedBroker: true,
        conversationId: "dm.operator.hudson",
        messageId: "msg-1",
        workItem: {
          id: "work-1",
          title: "Review the auth module",
          summary: "Tracked work",
          state: "working",
          acceptanceState: "pending",
          ownerId: "hudson.main",
          nextMoveOwnerId: "hudson.main",
          conversationId: "dm.operator.hudson",
          priority: "high",
        },
        flight: {
          id: "flight-1",
          invocationId: "inv-1",
          requesterId: "operator",
          targetAgentId: "hudson.main",
          state: "running",
        },
      }),
      waitForFlight: async () => ({
        id: "flight-1",
        invocationId: "inv-1",
        requesterId: "operator",
        targetAgentId: "hudson.main",
        state: "completed",
        output: "done",
      }),
      updateWorkItem: async () => {
        throw new Error("not used");
      },
    });

    const result = await client.callTool({
      name: "invocations_ask",
      arguments: {
        body: "Review the auth module",
        targetAgentId: "hudson.main",
        awaitReply: true,
      },
    });

    const structured = result.structuredContent as {
      awaited: boolean;
      output: string | null;
      flight: { state: string } | null;
      flightId: string | null;
      targetAgentId: string | null;
      workId: string | null;
      workUrl: string | null;
    };

    expect(structured.awaited).toBe(true);
    expect(structured.output).toBe("done");
    expect(structured.flight?.state).toBe("completed");
    expect(structured.flightId).toBe("flight-1");
    expect(structured.targetAgentId).toBe("hudson.main");
    expect(structured.workId).toBe("work-1");
    expect(structured.workUrl).toBe("/api/work/work-1");
    const content = result.content as Array<{ type: string; text: string }> | undefined;
    expect(content?.[0]).toEqual({ type: "text", text: "done" });
  });

  test("schedules MCP reply notifications for notify-mode asks", async () => {
    const { client } = await connectTestServer({
      resolveSenderId: async () => "operator",
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => [],
      resolveAgent: async () => ({
        kind: "unresolved",
        candidate: null,
        candidates: [],
      }),
      sendMessage: async () => ({
        usedBroker: true,
        invokedTargets: [],
        unresolvedTargets: [],
      }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({
        usedBroker: true,
        conversationId: "dm.operator.hudson",
        messageId: "msg-1",
        flight: {
          id: "flight-1",
          invocationId: "inv-1",
          requesterId: "operator",
          targetAgentId: "hudson.main",
          state: "running",
        },
      }),
      waitForFlight: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          id: "flight-1",
          invocationId: "inv-1",
          requesterId: "operator",
          targetAgentId: "hudson.main",
          state: "completed",
          output: "hudson replied",
        };
      },
      updateWorkItem: async () => {
        throw new Error("not used");
      },
    });

    const notificationPromise = new Promise<{
      params: {
        status: string;
        flightId: string;
        output: string | null;
        senderId: string;
        targetAgentId: string | null;
      };
    }>((resolve) => {
      client.setNotificationHandler(
        z.object({
          method: z.literal("notifications/scout/reply"),
          params: z
            .object({
              status: z.string(),
              flightId: z.string(),
              output: z.string().nullable(),
              senderId: z.string(),
              targetAgentId: z.string().nullable(),
            })
            .catchall(z.unknown()),
        }),
        (notification) => resolve(notification),
      );
    });

    const result = await client.callTool({
      name: "invocations_ask",
      arguments: {
        body: "Review the auth module",
        targetAgentId: "hudson.main",
        replyMode: "notify",
      },
    });

    const structured = result.structuredContent as {
      awaited: boolean;
      replyMode: string;
      delivery: string;
      notification: { method: string; status: string } | null;
      output: string | null;
      flight: { state: string } | null;
    };

    expect(structured.awaited).toBe(false);
    expect(structured.replyMode).toBe("notify");
    expect(structured.delivery).toBe("mcp_notification");
    expect(structured.notification).toEqual({
      method: "notifications/scout/reply",
      status: "scheduled",
    });
    expect(structured.output).toBeNull();
    expect(structured.flight?.state).toBe("running");

    const notification = await notificationPromise;
    expect(notification.params.status).toBe("completed");
    expect(notification.params.flightId).toBe("flight-1");
    expect(notification.params.output).toBe("hudson replied");
    expect(notification.params.senderId).toBe("operator");
    expect(notification.params.targetAgentId).toBe("hudson.main");
  });

  test("updates a work item through the dedicated MCP tool", async () => {
    const { client } = await connectTestServer({
      resolveSenderId: async () => "hudson.main",
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => [],
      resolveAgent: async () => ({
        kind: "unresolved",
        candidate: null,
        candidates: [],
      }),
      sendMessage: async () => ({
        usedBroker: true,
        invokedTargets: [],
        unresolvedTargets: [],
      }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({ usedBroker: true }),
      updateWorkItem: async ({ workId, actorId, state, summary }) => ({
        id: workId,
        title: "Review the auth module",
        summary: summary ?? null,
        state: state ?? "working",
        acceptanceState: "pending",
        ownerId: actorId,
        nextMoveOwnerId: actorId,
        conversationId: "dm.operator.hudson",
        priority: "normal",
      }),
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const result = await client.callTool({
      name: "work_update",
      arguments: {
        work: {
          workId: "work-1",
          state: "review",
          summary: "Ready for review",
        },
      },
    });

    const structured = result.structuredContent as {
      senderId: string;
      workId: string | null;
      workUrl: string | null;
      workItem: { state: string; summary: string | null } | null;
    };

    expect(structured.senderId).toBe("hudson.main");
    expect(structured.workId).toBe("work-1");
    expect(structured.workUrl).toBe("/api/work/work-1");
    expect(structured.workItem?.state).toBe("review");
    expect(structured.workItem?.summary).toBe("Ready for review");
  });

  test("routes a direct ask by label without whoami or agents_resolve preflight", async () => {
    const resolveSenderCalls: Array<{
      senderId: string | null | undefined;
      currentDirectory: string;
    }> = [];
    let receivedAsk:
      | {
          senderId: string;
          targetLabel: string;
          currentDirectory: string;
          source?: string;
        }
      | undefined;
    const { client } = await connectTestServer({
      resolveSenderId: async (senderId, currentDirectory) => {
        resolveSenderCalls.push({ senderId, currentDirectory });
        return "operator.main.mini";
      },
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => {
        throw new Error("unexpected agents_search preflight");
      },
      resolveAgent: async () => {
        throw new Error("unexpected agents_resolve preflight");
      },
      sendMessage: async () => ({
        usedBroker: true,
        invokedTargets: [],
        unresolvedTargets: [],
      }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async ({
        senderId,
        targetLabel,
        currentDirectory,
        source,
      }) => {
        receivedAsk = { senderId, targetLabel, currentDirectory, source };
        return {
          usedBroker: true,
          conversationId: "dm.operator.hudson",
          messageId: "msg-1",
          flight: {
            id: "flight-1",
            invocationId: "inv-1",
            requesterId: senderId,
            targetAgentId: "hudson.main",
            state: "running",
          },
        };
      },
      askAgentById: async () => {
        throw new Error("unexpected askAgentById path");
      },
      updateWorkItem: async () => {
        throw new Error("not used");
      },
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const result = await client.callTool({
      name: "invocations_ask",
      arguments: {
        body: "Use the simplified Scout path. Do not call whoami or agents_resolve first.",
        targetLabel: "@hudson",
        replyMode: "none",
      },
    });

    const structured = result.structuredContent as {
      currentDirectory: string;
      senderId: string;
      targetAgentId: string | null;
      targetLabel: string | null;
      conversationId: string | null;
      messageId: string | null;
      flightId: string | null;
      delivery: string;
    };

    expect(resolveSenderCalls).toEqual([
      { senderId: undefined, currentDirectory: "/tmp/openscout-test" },
    ]);
    expect(receivedAsk).toEqual({
      senderId: "operator.main.mini",
      targetLabel: "@hudson",
      currentDirectory: "/tmp/openscout-test",
      source: "scout-mcp",
    });
    expect(structured.currentDirectory).toBe("/tmp/openscout-test");
    expect(structured.senderId).toBe("operator.main.mini");
    expect(structured.targetAgentId).toBe("hudson.main");
    expect(structured.targetLabel).toBe("@hudson");
    expect(structured.conversationId).toBe("dm.operator.hudson");
    expect(structured.messageId).toBe("msg-1");
    expect(structured.flightId).toBe("flight-1");
    expect(structured.delivery).toBe("none");
    const content = result.content as Array<{ type: string; text: string }> | undefined;
    expect(content?.[0]).toEqual({
      type: "text",
      text: "Ask sent to hudson.main; flight flight-1.",
    });
  });

  test("sends to a target label in one MCP call", async () => {
    let receivedTargetLabel: string | undefined;
    let receivedSource: string | undefined;
    const { client } = await connectTestServer({
      resolveSenderId: async () => "operator",
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => [],
      resolveAgent: async () => ({
        kind: "unresolved",
        candidate: null,
        candidates: [],
      }),
      sendMessage: async ({ targetLabel, source }) => {
        receivedTargetLabel = targetLabel;
        receivedSource = source;
        return {
          usedBroker: true,
          conversationId: "dm.operator.hudson",
          messageId: "msg-1",
          invokedTargets: ["hudson.main"],
          unresolvedTargets: [],
          routeKind: "dm",
        };
      },
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({ usedBroker: true }),
      updateWorkItem: async () => {
        throw new Error("not used");
      },
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const result = await client.callTool({
      name: "messages_send",
      arguments: {
        body: "Take a look at the auth module.",
        targetLabel: "@hudson",
      },
    });

    const structured = result.structuredContent as {
      mode: string;
      conversationId: string | null;
      messageId: string | null;
      invokedTargetIds: string[];
      unresolvedTargetIds: string[];
      routeKind: string | null;
    };

    expect(receivedTargetLabel).toBe("@hudson");
    expect(receivedSource).toBe("scout-mcp");
    expect(structured.mode).toBe("target_label");
    expect(structured.conversationId).toBe("dm.operator.hudson");
    expect(structured.messageId).toBe("msg-1");
    expect(structured.invokedTargetIds).toEqual(["hudson.main"]);
    expect(structured.unresolvedTargetIds).toEqual([]);
    expect(structured.routeKind).toBe("dm");
    const content = result.content as Array<{ type: string; text: string }> | undefined;
    expect(content?.[0]).toEqual({
      type: "text",
      text: "Message sent to hudson.main in dm.operator.hudson (msg-1).",
    });
  });
});
