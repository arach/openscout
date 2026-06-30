import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LOCAL_CONFIG_VERSION,
  writeLocalConfig,
} from "@openscout/runtime/local-config";
import {
  resolveRelayAgentConfig,
  writeOpenScoutSettings,
  writeProjectConfig,
} from "@openscout/runtime/setup";

import {
  askScoutQuestion,
  loadScoutMessages,
  openScoutPeerSession,
  readScoutBrokerHealth,
  resolveScoutBrokerUrl,
  sendScoutConversationSteer,
  sendScoutConversationMessage,
  sendScoutMessage,
} from "./service.ts";

const originalHome = process.env.HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
const originalBrokerUrl = process.env.OPENSCOUT_BROKER_URL;
const originalBrokerInternalUrl = process.env.OPENSCOUT_BROKER_INTERNAL_URL;
const originalSkipUserProjectHints = process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS;
const originalFetch = globalThis.fetch;
const testDirectories = new Set<string>();

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalSupportDirectory === undefined) {
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  } else {
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  }
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  if (originalRelayHub === undefined) {
    delete process.env.OPENSCOUT_RELAY_HUB;
  } else {
    process.env.OPENSCOUT_RELAY_HUB = originalRelayHub;
  }
  if (originalBrokerUrl === undefined) {
    delete process.env.OPENSCOUT_BROKER_URL;
  } else {
    process.env.OPENSCOUT_BROKER_URL = originalBrokerUrl;
  }
  if (originalBrokerInternalUrl === undefined) {
    delete process.env.OPENSCOUT_BROKER_INTERNAL_URL;
  } else {
    process.env.OPENSCOUT_BROKER_INTERNAL_URL = originalBrokerInternalUrl;
  }
  if (originalSkipUserProjectHints === undefined) {
    delete process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS;
  } else {
    process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = originalSkipUserProjectHints;
  }
  globalThis.fetch = originalFetch;
  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

function useIsolatedOpenScoutHome(): string {
  const home = mkdtempSync(join(tmpdir(), "openscout-desktop-broker-"));
  testDirectories.add(home);
  process.env.HOME = home;
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
  process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
  process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");
  process.env.OPENSCOUT_BROKER_URL = "http://broker.test";
  process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = "1";
  return home;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("resolveScoutBrokerUrl", () => {
  test("uses local config host and broker port for same-machine broker API", () => {
    useIsolatedOpenScoutHome();
    writeLocalConfig({
      version: LOCAL_CONFIG_VERSION,
      host: "127.0.0.1",
      ports: { broker: 43110 },
    });
    delete process.env.OPENSCOUT_BROKER_INTERNAL_URL;
    process.env.OPENSCOUT_BROKER_URL = "http://mesh.example.test:43110";

    expect(resolveScoutBrokerUrl()).toBe("http://127.0.0.1:43110");
  });
});

describe("readScoutBrokerHealth", () => {
  test("preserves broker build identity and child service states", async () => {
    useIsolatedOpenScoutHome();
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          nodeId: "node-1",
          meshId: "mesh-1",
          build: {
            packageName: "@openscout/runtime",
            version: "0.test",
            mode: "dev",
          },
          services: {
            web: {
              managed: true,
              managedBy: "broker",
              state: "running",
              pid: 4321,
              port: 43120,
              url: "http://127.0.0.1:43120",
              healthy: null,
            },
            localEdge: {
              managed: true,
              managedBy: "base",
              state: "unknown",
              healthy: null,
            },
          },
          counts: {
            nodes: 1,
            actors: 2,
            agents: 3,
            conversations: 4,
            messages: 5,
            flights: 6,
            collaborationRecords: 7,
          },
        });
      }
      return jsonResponse({ error: "unexpected request" }, 404);
    }) as unknown as typeof fetch;

    const health = await readScoutBrokerHealth();

    expect(health.reachable).toBe(true);
    expect(health.build?.version).toBe("0.test");
    expect(health.services?.web?.state).toBe("running");
    expect(health.services?.web?.pid).toBe(4321);
    expect(health.services?.localEdge?.managedBy).toBe("base");
    expect(health.counts?.collaborationRecords).toBe(7);
  });
});

describe("askScoutQuestion", () => {
  test("registers discovered targets and lets the broker wake them on demand", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const talkieRoot = join(workspaceRoot, "talkie");

    mkdirSync(join(talkieRoot, ".git"), { recursive: true });
    writeFileSync(join(talkieRoot, "AGENTS.md"), "# talkie\n", "utf8");

    await writeOpenScoutSettings({
      discovery: {
        workspaceRoots: [workspaceRoot],
        includeCurrentRepo: false,
      },
    });

    const requests: Array<{ method: string; path: string; body?: any }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {},
          agents: {},
          endpoints: {},
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/actors") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/agents") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/messages") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/conversations") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        const body = await request.json() as { requesterId: string; targetLabel: string; body: string };
        requests[requests.length - 1]!.body = body;
        return jsonResponse({
          kind: "delivery",
          accepted: true,
          routeKind: "dm",
          conversation: {
            id: "dm.operator.talkie",
            kind: "direct",
            title: "Talkie",
            visibility: "private",
            authorityNodeId: "node-1",
            participantIds: ["operator", "talkie"],
          },
          message: {
            id: "msg-1",
            conversationId: "dm.operator.talkie",
            actorId: body.requesterId,
            originNodeId: "node-1",
            class: "agent",
            body: body.body,
            visibility: "private",
            policy: "durable",
            createdAt: Date.now(),
          },
          flight: {
            id: "flt-1",
            invocationId: "inv-1",
            requesterId: body.requesterId,
            targetAgentId: "talkie",
            state: "waking",
            summary: "Talkie waking.",
            startedAt: Date.now(),
          },
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await askScoutQuestion({
      senderId: "operator",
      targetLabel: "talkie",
      body: "build it for me",
      currentDirectory: workspaceRoot,
    });

    expect(result.usedBroker).toBe(true);
    expect(result.flight?.id).toBe("flt-1");
    expect(result.flight?.state).toBe("waking");
    expect(result.unresolvedTarget).toBeUndefined();
    expect(result.targetDiagnostic).toBeUndefined();
    expect(requests.some((request) => request.path === "/v1/agents")).toBe(false);
    expect(requests.some((request) => request.path === "/v1/messages")).toBe(false);
    expect(requests.some((request) => request.path === "/v1/invocations")).toBe(false);
    expect(requests.some((request) => request.path === "/v1/deliver")).toBe(true);
    expect(requests.find((request) => request.path === "/v1/deliver")?.body?.execution)
      .toEqual({ session: "new" });
    expect(requests.some((request) => request.path === "/v1/endpoints")).toBe(false);
  }, 15000);

  test("returns broker delivery rejections as structured unresolved targets", async () => {
    const home = useIsolatedOpenScoutHome();

    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {
            operator: {
              id: "operator",
              kind: "person",
              displayName: "Operator",
            },
          },
          agents: {},
          endpoints: {},
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        return jsonResponse({
          kind: "rejected",
          accepted: false,
          reason: "unknown_target",
          rejection: {
            id: "dispatch-1",
            requesterId: "operator",
            kind: "unknown",
            askedLabel: "@ghost",
            detail: "no agent matches @ghost",
            candidates: [],
            dispatchedAt: Date.now(),
            dispatcherNodeId: "node-1",
          },
        }, 422);
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await askScoutQuestion({
      senderId: "operator",
      targetLabel: "ghost",
      body: "build it for me",
      currentDirectory: home,
    });

    expect(result.usedBroker).toBe(true);
    expect(result.unresolvedTarget).toBe("ghost");
    expect(result.targetDiagnostic).toEqual({
      agentId: "@ghost",
      state: "unknown",
      registrationKind: null,
      projectRoot: null,
    });
  }, 15000);

  test("refreshes stale exact targets before asking", async () => {
    const home = useIsolatedOpenScoutHome();
    const repo = join(home, "dev", "openscout");
    mkdirSync(join(repo, ".git"), { recursive: true });
    await writeProjectConfig(repo, {
      version: 1,
      project: {
        id: "openscout",
        name: "OpenScout",
      },
      agent: {
        id: "scoutbot",
      },
    });
    const configured = await resolveRelayAgentConfig("scoutbot", {
      currentDirectory: repo,
    });
    expect(configured).not.toBeNull();
    const configuredAgentId = configured!.agentId;

    const requests: Array<{ method: string; path: string; body?: any }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ method: request.method, path: url.pathname, body });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {
            operator: {
              id: "operator",
              kind: "person",
              displayName: "Operator",
            },
          },
          agents: {
            [configuredAgentId]: {
              id: configuredAgentId,
              kind: "agent",
              definitionId: "scoutbot",
              displayName: "Scoutbot",
              metadata: {
                staleLocalRegistration: true,
                projectRoot: repo,
              },
            },
          },
          endpoints: {},
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/actors") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/agents") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        return jsonResponse({
          kind: "delivery",
          accepted: true,
          routeKind: "dm",
          conversation: {
            id: `dm.operator.${configuredAgentId}`,
            kind: "direct",
            title: "Scoutbot",
            visibility: "private",
            authorityNodeId: "node-1",
            participantIds: ["operator", configuredAgentId],
          },
          message: {
            id: "msg-1",
            conversationId: `dm.operator.${configuredAgentId}`,
            actorId: "operator",
            originNodeId: "node-1",
            class: "agent",
            body: body.body,
            visibility: "private",
            policy: "durable",
            createdAt: Date.now(),
          },
          targetAgentId: configuredAgentId,
          flight: {
            id: "flt-1",
            invocationId: "inv-1",
            requesterId: "operator",
            targetAgentId: configuredAgentId,
            state: "waking",
          },
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await askScoutQuestion({
      senderId: "operator",
      targetLabel: configuredAgentId,
      targetAgentId: configuredAgentId,
      body: "inspect state",
      currentDirectory: repo,
    });

    expect(result.usedBroker).toBe(true);
    expect(result.flight?.targetAgentId).toBe(configuredAgentId);
    expect(requests.some((request) => (
      request.method === "POST" &&
      request.path === "/v1/agents" &&
      request.body?.id === configuredAgentId &&
      request.body?.metadata?.staleLocalRegistration !== true
    ))).toBe(true);
    expect(requests.find((request) => request.path === "/v1/deliver")?.body)
      .toMatchObject({
        targetAgentId: configuredAgentId,
        targetLabel: configuredAgentId,
        execution: { session: "new" },
      });
  }, 15000);
});

describe("sendScoutMessage", () => {
  test("creates named channels with opaque conversation ids and alias metadata", async () => {
    const home = useIsolatedOpenScoutHome();
    const requests: Array<{ method: string; path: string; search: string; body?: any }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ method: request.method, path: url.pathname, search: url.search, body });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {
            operator: {
              id: "operator",
              kind: "person",
              displayName: "Operator",
            },
          },
          agents: {},
          endpoints: {},
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/conversations") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/messages") {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await sendScoutMessage({
      senderId: "operator",
      body: "ship the channel primitive",
      channel: "talkie-next",
      currentDirectory: home,
      createdAtMs: 12345,
    });

    const conversationPost = requests.find((request) => request.path === "/v1/conversations");
    const messagePost = requests.find((request) => request.path === "/v1/messages");

    expect(result).toEqual({
      usedBroker: true,
      conversationId: conversationPost?.body?.id,
      messageId: messagePost?.body?.id,
      invokedTargets: [],
      unresolvedTargets: [],
    });
    expect(conversationPost?.body).toEqual(expect.objectContaining({
      kind: "channel",
      title: "talkie-next",
      visibility: "workspace",
      metadata: expect.objectContaining({
        channel: "talkie-next",
        naturalKey: "channel:talkie-next",
      }),
    }));
    expect(conversationPost?.body?.id).toMatch(/^chat_[0-9a-f]{32}$/);
    expect(messagePost?.body).toMatchObject({
      conversationId: conversationPost?.body?.id,
      actorId: "operator",
      body: "ship the channel primitive",
      metadata: {
        relayChannel: "talkie-next",
      },
    });
  }, 15000);
});

describe("sendScoutConversationMessage", () => {
  test("appends operator contributions to the existing conversation", async () => {
    const home = useIsolatedOpenScoutHome();
    const requests: Array<{ method: string; path: string; body?: any }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ method: request.method, path: url.pathname, body });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {
            operator: {
              id: "operator",
              kind: "person",
              displayName: "Operator",
            },
          },
          agents: {
            "hudson.main.mini": {
              id: "hudson.main.mini",
              kind: "agent",
              handle: "hudson",
              selector: "@hudson",
              displayName: "Hudson",
              metadata: { selector: "@hudson" },
            },
            "narrative-studio.main.mini": {
              id: "narrative-studio.main.mini",
              kind: "agent",
              handle: "narrative-studio",
              selector: "@narrative-studio",
              displayName: "Narrative Studio",
              metadata: { selector: "@narrative-studio" },
            },
          },
          endpoints: {},
          conversations: {
            "dm.hudson.main.mini.narrative-studio.main.mini": {
              id: "dm.hudson.main.mini.narrative-studio.main.mini",
              kind: "direct",
              title: "Hudson <> Narrative Studio",
              visibility: "private",
              authorityNodeId: "node-1",
              participantIds: ["hudson.main.mini", "narrative-studio.main.mini"],
            },
          },
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/messages") {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await sendScoutConversationMessage({
      conversationId: "dm.hudson.main.mini.narrative-studio.main.mini",
      senderId: "operator",
      body: "@hudson hi",
      currentDirectory: home,
      source: "scout-web",
    });
    const messagePost = requests.find((request) => request.path === "/v1/messages");

    expect(result).toEqual({
      usedBroker: true,
      conversationId: "dm.hudson.main.mini.narrative-studio.main.mini",
      messageId: messagePost?.body?.id,
      invokedTargets: ["hudson.main.mini"],
      unresolvedTargets: [],
    });
    expect(requests.some((request) => request.path === "/v1/deliver")).toBe(false);
    expect(messagePost?.body)
      .toMatchObject({
        conversationId: "dm.hudson.main.mini.narrative-studio.main.mini",
        actorId: "operator",
        body: "@hudson hi",
        mentions: [{ actorId: "hudson.main.mini", label: "@hudson" }],
        audience: { notify: ["hudson.main.mini"], reason: "mention" },
        metadata: {
          source: "scout-web",
          destinationKind: "conversation",
          destinationId: "dm.hudson.main.mini.narrative-studio.main.mini",
        },
      });
  }, 15000);
});

describe("sendScoutConversationSteer", () => {
  test("records one operator message and wakes every non-human participant in an agent-to-agent conversation", async () => {
    const home = useIsolatedOpenScoutHome();
    const requests: Array<{ method: string; path: string; body?: any }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ method: request.method, path: url.pathname, body });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {
            operator: {
              id: "operator",
              kind: "person",
              displayName: "Operator",
            },
          },
          agents: {
            "hudson.main.mini": {
              id: "hudson.main.mini",
              kind: "agent",
              handle: "hudson",
              selector: "@hudson",
              displayName: "Hudson",
              metadata: { selector: "@hudson" },
            },
            "narrative-studio.main.mini": {
              id: "narrative-studio.main.mini",
              kind: "agent",
              handle: "narrative-studio",
              selector: "@narrative-studio",
              displayName: "Narrative Studio",
              metadata: { selector: "@narrative-studio" },
            },
          },
          endpoints: {
            "endpoint-hudson": {
              id: "endpoint-hudson",
              agentId: "hudson.main.mini",
              nodeId: "node-1",
              harness: "claude",
              transport: "tmux",
              state: "idle",
              sessionId: "relay-hudson-claude",
            },
            "endpoint-narrative": {
              id: "endpoint-narrative",
              agentId: "narrative-studio.main.mini",
              nodeId: "node-1",
              harness: "claude",
              transport: "claude_stream_json",
              state: "idle",
              sessionId: "relay-narrative-claude",
            },
          },
          conversations: {
            "c.hudson-narrative": {
              id: "c.hudson-narrative",
              kind: "direct",
              title: "Hudson <> Narrative Studio",
              visibility: "private",
              authorityNodeId: "node-1",
              participantIds: ["hudson.main.mini", "narrative-studio.main.mini"],
            },
          },
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/messages") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/invocations") {
        return jsonResponse({
          accepted: true,
          invocationId: body.id,
          flightId: `flight-${body.targetAgentId}`,
          targetAgentId: body.targetAgentId,
          state: "queued",
          flight: {
            id: `flight-${body.targetAgentId}`,
            invocationId: body.id,
            requesterId: body.requesterId,
            targetAgentId: body.targetAgentId,
            state: "queued",
          },
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await sendScoutConversationSteer({
      conversationId: "c.hudson-narrative",
      senderId: "operator",
      body: "Who has next?",
      currentDirectory: home,
      source: "scout-web",
    });

    expect(result).toMatchObject({
      usedBroker: true,
      conversationId: "c.hudson-narrative",
      invokedTargets: ["hudson.main.mini", "narrative-studio.main.mini"],
      unresolvedTargets: [],
    });
    const messagePost = requests.find((request) => request.path === "/v1/messages")?.body;
    expect(messagePost).toMatchObject({
      conversationId: "c.hudson-narrative",
      actorId: "operator",
      body: "Who has next?",
      audience: {
        notify: ["hudson.main.mini", "narrative-studio.main.mini"],
        reason: "direct_message",
      },
      metadata: {
        source: "scout-web",
        destinationKind: "conversation",
        destinationId: "c.hudson-narrative",
        intent: "steer",
        relayTargetIds: ["hudson.main.mini", "narrative-studio.main.mini"],
      },
    });

    const invocationPosts = requests
      .filter((request) => request.path === "/v1/invocations")
      .map((request) => request.body);
    expect(invocationPosts).toHaveLength(2);
    expect(invocationPosts).toEqual([
      expect.objectContaining({
        targetAgentId: "hudson.main.mini",
        action: "wake",
        conversationId: "c.hudson-narrative",
        messageId: messagePost.id,
        execution: {
          session: "existing",
          targetSessionId: "relay-hudson-claude",
        },
        metadata: expect.objectContaining({
          intent: "steer",
          relayTarget: "hudson.main.mini",
          relayMessageId: messagePost.id,
        }),
      }),
      expect.objectContaining({
        targetAgentId: "narrative-studio.main.mini",
        action: "wake",
        conversationId: "c.hudson-narrative",
        messageId: messagePost.id,
        execution: {
          session: "existing",
          targetSessionId: "relay-narrative-claude",
        },
        metadata: expect.objectContaining({
          intent: "steer",
          relayTarget: "narrative-studio.main.mini",
          relayMessageId: messagePost.id,
        }),
      }),
    ]);

    requests.length = 0;
    const scopedResult = await sendScoutConversationSteer({
      conversationId: "c.hudson-narrative",
      senderId: "operator",
      body: "@Tesla take this one.",
      currentDirectory: home,
      source: "scout-web",
    });

    expect(scopedResult).toMatchObject({
      usedBroker: true,
      conversationId: "c.hudson-narrative",
      invokedTargets: ["hudson.main.mini"],
      unresolvedTargets: [],
    });
    expect(requests.find((request) => request.path === "/v1/messages")?.body)
      .toMatchObject({
        mentions: [{ actorId: "hudson.main.mini", label: "@Tesla" }],
        audience: {
          notify: ["hudson.main.mini"],
          reason: "direct_message",
        },
      });
    expect(requests.filter((request) => request.path === "/v1/invocations").map((request) => request.body.targetAgentId))
      .toEqual(["hudson.main.mini"]);
  }, 15000);

  test("does not steer an offline cardless session participant", async () => {
    const home = useIsolatedOpenScoutHome();
    const requests: Array<{ method: string; path: string; body?: any }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ method: request.method, path: url.pathname, body });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {
            operator: {
              id: "operator",
              kind: "person",
              displayName: "Operator",
            },
            "session-lattices": {
              id: "session-lattices",
              kind: "session",
              displayName: "lattices-schubert",
              handle: "project-schubert",
              metadata: {
                cardless: true,
                handle: "project-schubert",
                projectRoot: "/Users/art/dev/lattices",
              },
            },
          },
          agents: {},
          endpoints: {
            "endpoint-lattices": {
              id: "endpoint-lattices",
              agentId: "session-lattices",
              nodeId: "node-1",
              harness: "codex",
              transport: "codex_app_server",
              state: "offline",
              sessionId: "session-lattices",
              projectRoot: "/Users/art/dev/lattices",
              cwd: "/Users/art/dev/lattices",
              metadata: {
                cardless: true,
                handle: "project-schubert",
              },
            },
          },
          conversations: {
            "c.session-lattices": {
              id: "c.session-lattices",
              kind: "direct",
              title: "lattices-schubert",
              visibility: "private",
              authorityNodeId: "node-1",
              participantIds: ["operator", "session-lattices"],
            },
          },
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/messages") {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await sendScoutConversationSteer({
      conversationId: "c.session-lattices",
      senderId: "operator",
      body: "still there?",
      targetParticipantIds: ["session-lattices"],
      currentDirectory: home,
      source: "scout-web",
    });

    expect(result).toMatchObject({
      usedBroker: true,
      conversationId: "c.session-lattices",
      invokedTargets: [],
      unresolvedTargets: ["session-lattices"],
    });
    expect(requests.filter((request) => request.path === "/v1/invocations")).toHaveLength(0);
    expect(requests.find((request) => request.path === "/v1/messages")?.body)
      .toMatchObject({
        conversationId: "c.session-lattices",
        metadata: {
          intent: "steer",
          relayTargetIds: [],
        },
      });
  }, 15000);
});

describe("loadScoutMessages", () => {
  test("resolves channel aliases to opaque conversation ids", async () => {
    const home = useIsolatedOpenScoutHome();
    const requests: Array<{ method: string; path: string; search: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname, search: url.search });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {},
          agents: {},
          endpoints: {},
          conversations: {
            "conv.11111111-1111-4111-8111-111111111111": {
              id: "conv.11111111-1111-4111-8111-111111111111",
              kind: "channel",
              title: "talkie-next",
              visibility: "workspace",
              authorityNodeId: "node-1",
              participantIds: ["operator"],
              metadata: {
                channel: "talkie-next",
                naturalKey: "channel:talkie-next",
              },
            },
          },
          messages: {},
          flights: {},
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/messages") {
        return jsonResponse([]);
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const messages = await loadScoutMessages({
      channel: "talkie-next",
      baseUrl: "http://broker.test",
    });

    const messagesRequest = requests.find((request) => request.path === "/v1/messages");
    const params = new URLSearchParams(messagesRequest?.search ?? "");

    expect(messages).toEqual([]);
    expect(params.get("conversationId")).toBe("conv.11111111-1111-4111-8111-111111111111");
  }, 15000);
});

describe("openScoutPeerSession", () => {
  test("auto-registers a configured local agent and creates a direct conversation", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const talkieRoot = join(workspaceRoot, "talkie");

    mkdirSync(join(talkieRoot, ".git"), { recursive: true });
    writeFileSync(join(talkieRoot, "AGENTS.md"), "# talkie\n", "utf8");

    await writeOpenScoutSettings({
      discovery: {
        workspaceRoots: [workspaceRoot],
        includeCurrentRepo: false,
      },
    });

    const requests: Array<{ method: string; path: string; body?: any }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ method: request.method, path: url.pathname, body });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {},
          agents: {},
          endpoints: {},
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/actors") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/agents") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/endpoints") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/conversations") {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await openScoutPeerSession({
      sourceId: "operator",
      targetId: "talkie",
      currentDirectory: talkieRoot,
      sourceName: "Operator",
    });

    expect(result.sourceId).toBe("operator");
    expect(result.targetId).toContain("talkie");
    expect(result.conversation.participantIds).toEqual(["operator", result.targetId]);
    expect(result.conversation.kind).toBe("direct");
    expect(result.existed).toBe(false);

    const actorPosts = requests.filter((request) => request.path === "/v1/actors");
    const agentPosts = requests.filter((request) => request.path === "/v1/agents");
    const endpointPosts = requests.filter((request) => request.path === "/v1/endpoints");
    const conversationPost = requests.find((request) => request.path === "/v1/conversations");

    expect(actorPosts.some((request) => request.body?.id === "operator")).toBe(true);
    expect(actorPosts.some((request) => request.body?.id === result.targetId)).toBe(true);
    expect(agentPosts.some((request) => request.body?.id === result.targetId)).toBe(true);
    expect(endpointPosts.some((request) => request.body?.agentId === result.targetId)).toBe(true);
    expect(conversationPost?.body).toEqual(expect.objectContaining({
      kind: "direct",
      participantIds: ["operator", result.targetId],
      visibility: "private",
    }));
  }, 15000);
});
