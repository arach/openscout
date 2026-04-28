import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalFetch = globalThis.fetch;
const sendScoutMessageCalls: Array<Record<string, unknown>> = [];
const sendScoutDirectMessageCalls: Array<Record<string, unknown>> = [];
const askScoutQuestionCalls: Array<Record<string, unknown>> = [];

let querySessionByIdImpl: (conversationId: string) => {
  kind: string;
  agentId: string | null;
  participantIds: string[];
} | null = () => null;
let sendScoutMessageResult: unknown = {
  usedBroker: true,
  invokedTargets: [],
  unresolvedTargets: [],
};
let sendScoutDirectMessageResult: unknown = {
  conversationId: "dm.operator.agent-1",
  messageId: "msg-1",
  flight: {
    id: "flt-1",
    invocationId: "inv-1",
    targetAgentId: "agent-1",
    state: "queued",
  },
};
let askScoutQuestionResult: unknown = {
  usedBroker: true,
  conversationId: "dm.operator.agent-1",
  messageId: "msg-ask-1",
  flight: {
    id: "flt-ask-1",
    invocationId: "inv-ask-1",
    targetAgentId: "agent-1",
    state: "queued",
  },
};

mock.module("./db-queries.ts", () => ({
  queryAgents: () => [],
  queryActivity: () => [],
  queryHeartrate: () => [],
  queryFleet: () => ({
    generatedAt: Date.now(),
    totals: { active: 0, recentCompleted: 0, needsAttention: 0, activity: 0 },
    activeAsks: [],
    recentCompleted: [],
    needsAttention: [],
    activity: [],
  }),
  queryFlights: () => [],
  queryRecentMessages: () => [],
  querySessions: () => [],
  querySessionById: (conversationId: string) =>
    querySessionByIdImpl(conversationId),
  queryWorkItems: () => [],
  queryWorkItemById: () => null,
}));

mock.module("./core/broker/service.ts", () => ({
  loadScoutBrokerContext: async () => null,
  readScoutBrokerHealth: async () => ({
    baseUrl: "http://broker.test",
    reachable: false,
    ok: false,
    nodeId: null,
    meshId: null,
    counts: null,
    error: "offline",
  }),
  resolveScoutBrokerUrl: () => "http://broker.test",
  sendScoutMessage: async (input: Record<string, unknown>) => {
    sendScoutMessageCalls.push(input);
    return sendScoutMessageResult;
  },
  sendScoutDirectMessage: async (input: Record<string, unknown>) => {
    sendScoutDirectMessageCalls.push(input);
    return sendScoutDirectMessageResult;
  },
  askScoutQuestion: async (input: Record<string, unknown>) => {
    askScoutQuestionCalls.push(input);
    return askScoutQuestionResult;
  },
}));

const { createOpenScoutWebServer } =
  await import("./create-openscout-web-server.ts");

function makeStaticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openscout-web-static-"));
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
    "utf8",
  );
  return root;
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
  querySessionByIdImpl = () => null;
  sendScoutMessageResult = {
    usedBroker: true,
    invokedTargets: [],
    unresolvedTargets: [],
  };
  sendScoutDirectMessageResult = {
    conversationId: "dm.operator.agent-1",
    messageId: "msg-1",
    flight: {
      id: "flt-1",
      invocationId: "inv-1",
      targetAgentId: "agent-1",
      state: "queued",
    },
  };
  askScoutQuestionResult = {
    usedBroker: true,
    conversationId: "dm.operator.agent-1",
    messageId: "msg-ask-1",
    flight: {
      id: "flt-ask-1",
      invocationId: "inv-ask-1",
      targetAgentId: "agent-1",
      state: "queued",
    },
  };
  sendScoutMessageCalls.length = 0;
  sendScoutDirectMessageCalls.length = 0;
  askScoutQuestionCalls.length = 0;
});

describe("createOpenScoutWebServer", () => {
  test("returns batched observe payloads for the requested agent ids", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request(
      "http://localhost/api/observe/agents?ids=agent-1,agent-2",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  test("routes direct DM tells through sendScoutDirectMessage", async () => {
    querySessionByIdImpl = () => ({
      kind: "direct",
      agentId: "agent-1",
      participantIds: ["operator", "agent-1"],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Status update",
        conversationId: "dm.operator.agent-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutDirectMessageCalls).toEqual([
      {
        agentId: "agent-1",
        body: "Status update",
        currentDirectory: "/tmp/openscout",
        source: "scout-web",
      },
    ]);
    expect(sendScoutMessageCalls).toHaveLength(0);
  });

  test("serves runtime bootstrap config for the client", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/bootstrap.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    const body = await response.text();
    expect(body).toContain('"terminalRelayPath":"/ws/terminal"');
    expect(body).toContain('"terminalRelayHealthPath":"/ws/terminal/health"');
    expect(body).toContain('"terminalRunPath":"/api/terminal/run"');
  });

  test("derives the relay health route from the configured relay path by default", async () => {
    const originalRelayPath = process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH;
    const originalRelayHealthPath = process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HEALTH_PATH;
    process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH = "/ws/relay";
    delete process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HEALTH_PATH;

    try {
      const server = await createOpenScoutWebServer({
        currentDirectory: "/tmp/openscout",
        assetMode: "static",
        staticRoot: makeStaticRoot(),
      });

      const response = await server.app.request("http://localhost/api/bootstrap.js");
      const body = await response.text();
      expect(body).toContain('"terminalRelayPath":"/ws/relay"');
      expect(body).toContain('"terminalRelayHealthPath":"/ws/relay/health"');
    } finally {
      if (originalRelayPath === undefined) {
        delete process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH;
      } else {
        process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH = originalRelayPath;
      }
      if (originalRelayHealthPath === undefined) {
        delete process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HEALTH_PATH;
      } else {
        process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HEALTH_PATH = originalRelayHealthPath;
      }
    }
  });

  test("serves terminal relay health at the configured route", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      terminalRelayHealthcheck: async () => true,
    });

    const okResponse = await server.app.request("http://localhost/ws/terminal/health");
    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({
      ok: true,
      surface: "openscout-terminal-relay",
    });

    const unavailableServer = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const unavailableResponse = await unavailableServer.app.request("http://localhost/ws/terminal/health");
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.json()).toEqual({
      ok: false,
      surface: "openscout-terminal-relay",
    });
  });

  test("routes channel sends through sendScoutMessage", async () => {
    querySessionByIdImpl = () => ({
      kind: "channel",
      agentId: null,
      participantIds: ["operator", "agent-1", "agent-2"],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Team update",
        conversationId: "channel.ops",
      }),
    });

    expect(response.status).toBe(200);
    expect(sendScoutMessageCalls).toEqual([
      {
        senderId: "operator",
        body: "Team update",
        currentDirectory: "/tmp/openscout",
      },
    ]);
    expect(sendScoutDirectMessageCalls).toHaveLength(0);
  });

  test("routes direct DM asks through askScoutQuestion and rejects channel asks", async () => {
    querySessionByIdImpl = (conversationId) => {
      if (conversationId === "dm.operator.agent-1") {
        return {
          kind: "direct",
          agentId: "agent-1",
          participantIds: ["operator", "agent-1"],
        };
      }
      return {
        kind: "channel",
        agentId: null,
        participantIds: ["operator", "agent-1", "agent-2"],
      };
    };

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const dmResponse = await server.app.request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Please own this and report back.",
        conversationId: "dm.operator.agent-1",
      }),
    });
    expect(dmResponse.status).toBe(200);
    expect(askScoutQuestionCalls).toEqual([
      {
        senderId: "operator",
        targetLabel: "agent-1",
        targetAgentId: "agent-1",
        body: "Please own this and report back.",
        currentDirectory: "/tmp/openscout",
      },
    ]);

    const channelResponse = await server.app.request(
      "http://localhost/api/ask",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: "Someone take this.",
          conversationId: "channel.ops",
        }),
      },
    );
    expect(channelResponse.status).toBe(400);
    expect(await channelResponse.json()).toEqual({
      error: "ask is only available in a direct conversation with one agent",
    });
  });

  test("proxies UI routes to the configured Vite dev server", async () => {
    const fetchCalls: Array<{
      input: string;
      init: RequestInit | undefined;
    }> = [];
    globalThis.fetch = (async (input, init) => {
      fetchCalls.push({
        input: String(input),
        init,
      });
      return new Response("<!doctype html><html><body>vite</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as typeof fetch;

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "vite-proxy",
      viteDevUrl: "http://127.0.0.1:5180",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request(
      "http://localhost/agents/demo?tab=inbox",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("vite");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.input).toBe(
      "http://127.0.0.1:5180/agents/demo?tab=inbox",
    );
    expect(fetchCalls[0]?.init?.method).toBe("GET");
    expect(fetchCalls[0]?.init?.headers).toBeInstanceOf(Headers);
    expect(fetchCalls[0]?.init?.body).toBeUndefined();
  });
});
