import { afterEach, describe, expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createScoutMcpServer, type ScoutMcpAgentCandidate } from "./scout-mcp.ts";

const openClients = new Set<Client>();
const openServers = new Set<ReturnType<typeof createScoutMcpServer>>();

afterEach(async () => {
  await Promise.all([...openClients].map(async (client) => {
    await client.close();
    openClients.delete(client);
  }));
  await Promise.all([...openServers].map(async (server) => {
    await server.close();
    openServers.delete(server);
  }));
});

async function connectTestServer(dependencies: Parameters<typeof createScoutMcpServer>[0]["dependencies"]) {
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
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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
      resolveAgent: async () => ({ kind: "unresolved", candidate: null, candidates: [] }),
      sendMessage: async () => ({ usedBroker: true, invokedTargets: [], unresolvedTargets: [] }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({ usedBroker: true }),
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "whoami",
      "agents_search",
      "agents_resolve",
      "messages_send",
      "invocations_ask",
    ]);
  });

  test("surfaces broker-backed search results", async () => {
    const { client } = await connectTestServer({
      resolveSenderId: async (_senderId, currentDirectory) => `sender:${currentDirectory}`,
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
            workspace: "main",
            node: "mini",
            projectRoot: "/tmp/openscout-test",
            transport: "codex_app_server",
          },
        ];
        return candidates.filter((candidate) => !query || candidate.label.includes(query));
      },
      resolveAgent: async () => ({ kind: "unresolved", candidate: null, candidates: [] }),
      sendMessage: async () => ({ usedBroker: true, invokedTargets: [], unresolvedTargets: [] }),
      sendMessageToAgentIds: async () => ({
        usedBroker: true,
        invokedTargetIds: [],
        unresolvedTargetIds: [],
      }),
      askQuestion: async () => ({ usedBroker: true }),
      askAgentById: async () => ({ usedBroker: true }),
      waitForFlight: async () => {
        throw new Error("not used");
      },
    });

    const whoami = await client.callTool({
      name: "whoami",
      arguments: { currentDirectory: "/worktree/app" },
    });
    expect((whoami.structuredContent as { defaultSenderId: string }).defaultSenderId).toBe("sender:/worktree/app");

    const result = await client.callTool({
      name: "agents_search",
      arguments: { query: "hud" },
    });
    expect((result.structuredContent as { candidates: Array<{ agentId: string }> }).candidates).toHaveLength(1);
    expect((result.structuredContent as { candidates: Array<{ agentId: string }> }).candidates[0]?.agentId).toBe("hudson.main");
  });

  test("awaits explicit ask-by-id flights when requested", async () => {
    const { client } = await connectTestServer({
      resolveSenderId: async () => "operator",
      resolveBrokerUrl: () => "http://broker.test",
      searchAgents: async () => [],
      resolveAgent: async () => ({ kind: "unresolved", candidate: null, candidates: [] }),
      sendMessage: async () => ({ usedBroker: true, invokedTargets: [], unresolvedTargets: [] }),
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
      waitForFlight: async () => ({
        id: "flight-1",
        invocationId: "inv-1",
        requesterId: "operator",
        targetAgentId: "hudson.main",
        state: "completed",
        output: "done",
      }),
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
      targetAgentId: string | null;
    };

    expect(structured.awaited).toBe(true);
    expect(structured.output).toBe("done");
    expect(structured.flight?.state).toBe("completed");
    expect(structured.targetAgentId).toBe("hudson.main");
  });
});
