import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  writeOpenScoutSettings,
  writeProjectConfig,
  writeRelayAgentOverrides,
} from "@openscout/runtime/setup";

import {
  askScoutQuestion,
  resolveScoutSenderId,
  sendScoutMessage,
  updateScoutWorkItem,
  watchScoutMessages,
} from "./service.ts";

const originalHome = process.env.HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
const originalBrokerUrl = process.env.OPENSCOUT_BROKER_URL;
const originalSkipUserProjectHints =
  process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS;
const originalOpenScoutAgent = process.env.OPENSCOUT_AGENT;
const originalOpenScoutOperatorName = process.env.OPENSCOUT_OPERATOR_NAME;
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
  if (originalSkipUserProjectHints === undefined) {
    delete process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS;
  } else {
    process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS =
      originalSkipUserProjectHints;
  }
  if (originalOpenScoutAgent === undefined) {
    delete process.env.OPENSCOUT_AGENT;
  } else {
    process.env.OPENSCOUT_AGENT = originalOpenScoutAgent;
  }
  if (originalOpenScoutOperatorName === undefined) {
    delete process.env.OPENSCOUT_OPERATOR_NAME;
  } else {
    process.env.OPENSCOUT_OPERATOR_NAME = originalOpenScoutOperatorName;
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
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(
    home,
    "Library",
    "Application Support",
    "OpenScout",
  );
  process.env.OPENSCOUT_CONTROL_HOME = join(
    home,
    ".openscout",
    "control-plane",
  );
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

    const requests: Array<{ method: string; path: string }> = [];
    const captured = {
      postedMessage: null as {
        conversationId: string;
        audience?: { notify: string[]; reason: string };
        metadata?: { relayChannel?: string; relayTarget?: string };
      } | null,
      postedInvocation: null as {
        id: string;
        requesterId: string;
        conversationId: string;
        metadata?: { relayChannel?: string; relayTarget?: string };
      } | null,
    };
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
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
        captured.postedMessage = (await request.json()) as NonNullable<
          typeof captured.postedMessage
        >;
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/conversations") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        const body = (await request.json()) as {
          requesterId: string;
          body: string;
        };
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
            audience: {
              notify: ["talkie"],
              reason: "direct_message",
            },
            visibility: "private",
            policy: "durable",
            createdAt: Date.now(),
            metadata: {
              relayChannel: "dm",
            },
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
    expect(result.conversationId?.startsWith("dm.")).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.flight?.id).toBe("flt-1");
    expect(result.flight?.state).toBe("waking");
    expect(result.unresolvedTarget).toBeUndefined();
    expect(result.targetDiagnostic).toBeUndefined();
    expect(requests.some((request) => request.path === "/v1/deliver")).toBe(
      true,
    );
    expect(requests.some((request) => request.path === "/v1/agents")).toBe(
      false,
    );
    expect(requests.some((request) => request.path === "/v1/messages")).toBe(
      false,
    );
    expect(requests.some((request) => request.path === "/v1/invocations")).toBe(
      false,
    );
    expect(requests.some((request) => request.path === "/v1/endpoints")).toBe(
      false,
    );
  }, 15000);

  test("returns an ambiguous diagnostic when @name matches multiple agents", async () => {
    useIsolatedOpenScoutHome();

    const voxCodexAgent = {
      id: "vox.mini.codex",
      kind: "agent",
      definitionId: "vox",
      displayName: "Vox (codex)",
      handle: "vox",
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {
        definitionId: "vox",
        nodeQualifier: "mini",
      },
    };
    const voxClaudeAgent = {
      id: "vox.mini.claude",
      kind: "agent",
      definitionId: "vox",
      displayName: "Vox (claude)",
      handle: "vox",
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {
        definitionId: "vox",
        nodeQualifier: "mini",
      },
    };
    const voxCodexEndpoint = {
      id: "ep-vox-codex",
      agentId: "vox.mini.codex",
      nodeId: "node-1",
      harness: "codex",
      transport: "local_socket",
      state: "active",
    };
    const voxClaudeEndpoint = {
      id: "ep-vox-claude",
      agentId: "vox.mini.claude",
      nodeId: "node-1",
      harness: "claude",
      transport: "local_socket",
      state: "active",
    };

    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {},
          agents: {
            [voxCodexAgent.id]: voxCodexAgent,
            [voxClaudeAgent.id]: voxClaudeAgent,
          },
          endpoints: {
            [voxCodexEndpoint.id]: voxCodexEndpoint,
            [voxClaudeEndpoint.id]: voxClaudeEndpoint,
          },
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/actors") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        return jsonResponse({
          kind: "rejected",
          accepted: false,
          reason: "ambiguous_target",
          rejection: {
            id: "dispatch-1",
            kind: "ambiguous",
            askedLabel: "@vox",
            detail: "@vox matches multiple agents; pick one",
            candidates: [
              {
                agentId: "vox.mini.codex",
                displayName: "Vox (codex)",
                label: "@vox.harness:codex",
                endpointState: "online",
                transport: "local_socket",
              },
              {
                agentId: "vox.mini.claude",
                displayName: "Vox (claude)",
                label: "@vox.harness:claude",
                endpointState: "online",
                transport: "local_socket",
              },
            ],
            dispatchedAt: Date.now(),
            dispatcherNodeId: "node-1",
          },
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await askScoutQuestion({
      senderId: "operator",
      targetLabel: "vox",
      body: "are you there?",
      currentDirectory: process.cwd(),
    });

    expect(result.usedBroker).toBe(true);
    expect(result.flight).toBeUndefined();
    expect(result.unresolvedTarget).toBe("vox");
    expect(result.targetDiagnostic?.state).toBe("ambiguous");
    if (result.targetDiagnostic?.state === "ambiguous") {
      const ids = result.targetDiagnostic.candidates
        .map((candidate) => candidate.agentId)
        .sort();
      expect(ids).toEqual(["vox.mini.claude", "vox.mini.codex"]);
      const labels = result.targetDiagnostic.candidates
        .map((candidate) => candidate.label)
        .sort();
      expect(labels).toEqual(["@vox.harness:claude", "@vox.harness:codex"]);
    }
  }, 15000);

  test("prefers the current project agent over a stale worktree alias", async () => {
    useIsolatedOpenScoutHome();

    const workspaceRoot = join(tmpdir(), "openscout-current-project");
    const currentRoot = join(workspaceRoot, "openscout");
    const staleRoot = join(workspaceRoot, "openscout-pr9-merge");
    mkdirSync(join(currentRoot, ".git"), { recursive: true });
    mkdirSync(join(staleRoot, ".git"), { recursive: true });
    writeFileSync(join(currentRoot, "AGENTS.md"), "# openscout\n", "utf8");
    writeFileSync(join(staleRoot, "AGENTS.md"), "# openscout pr9\n", "utf8");

    const staleAgent = {
      id: "openscout.codex-pr9-merge-snapshot.mini",
      kind: "agent",
      definitionId: "openscout",
      displayName: "Openscout",
      handle: "openscout",
      defaultSelector: "@openscout",
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {
        definitionId: "openscout",
        defaultSelector: "@openscout",
        workspaceQualifier: "codex-pr9-merge-snapshot",
        projectRoot: staleRoot,
      },
    };
    const discoveredAgent = {
      id: "openscout.codex-control-plane-foundation.mini",
      kind: "agent",
      definitionId: "openscout",
      displayName: "Openscout",
      handle: "openscout",
      defaultSelector: "@openscout",
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {
        definitionId: "openscout",
        defaultSelector: "@openscout",
        workspaceQualifier: "codex-control-plane-foundation",
        projectRoot: join(workspaceRoot, "other-worktree"),
      },
    };
    const currentAgent = {
      id: "openscout-4.main.mini",
      kind: "agent",
      definitionId: "openscout-4",
      displayName: "Openscout 4",
      handle: "openscout-4",
      defaultSelector: "@openscout-4",
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {
        definitionId: "openscout-4",
        defaultSelector: "@openscout-4",
        workspaceQualifier: "main",
        projectRoot: currentRoot,
      },
    };
    const staleEndpoint = {
      id: "ep-openscout-stale",
      agentId: staleAgent.id,
      nodeId: "node-1",
      harness: "claude",
      transport: "local_socket",
      state: "idle",
      projectRoot: staleRoot,
    };
    const currentEndpoint = {
      id: "ep-openscout-current",
      agentId: currentAgent.id,
      nodeId: "node-1",
      harness: "claude",
      transport: "local_socket",
      state: "idle",
      projectRoot: currentRoot,
    };
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {},
          agents: {
            [staleAgent.id]: staleAgent,
            [discoveredAgent.id]: discoveredAgent,
            [currentAgent.id]: currentAgent,
          },
          endpoints: {
            [staleEndpoint.id]: staleEndpoint,
            [currentEndpoint.id]: currentEndpoint,
          },
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        const body = await request.json() as { requesterId: string; body: string };
        return jsonResponse({
          kind: "delivery",
          accepted: true,
          routeKind: "dm",
          conversation: {
            id: `dm.operator.${currentAgent.id}`,
            kind: "direct",
            title: "Openscout 4",
            visibility: "private",
            authorityNodeId: "node-1",
            participantIds: ["operator", currentAgent.id],
          },
          message: {
            id: "msg-current",
            conversationId: `dm.operator.${currentAgent.id}`,
            actorId: body.requesterId,
            originNodeId: "node-1",
            class: "agent",
            body: body.body,
            visibility: "private",
            policy: "durable",
            createdAt: Date.now(),
          },
          targetAgentId: currentAgent.id,
          flight: {
            id: "flt-current",
            invocationId: "inv-current",
            requesterId: "operator",
            targetAgentId: currentAgent.id,
            state: "waking",
          },
        });
      }
      if (request.method === "POST") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await askScoutQuestion({
      senderId: "operator",
      targetLabel: "openscout",
      body: "please look at this",
      currentDirectory: currentRoot,
    });

    expect(result.usedBroker).toBe(true);
    expect(result.unresolvedTarget).toBeUndefined();
    expect(result.targetDiagnostic).toBeUndefined();
    expect(result.flight?.targetAgentId).toBe(currentAgent.id);
  }, 15000);

  test("creates a durable work item beyond the message and flight ids", async () => {
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

    const captured = {
      postedRecord: null as {
        id: string;
        kind: string;
        title: string;
        ownerId?: string;
      } | null,
      postedEvent: null as {
        recordId: string;
        kind: string;
        actorId: string;
        summary?: string;
      } | null,
    };

    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

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
          collaborationRecords: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/actors") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/agents") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/conversations") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        const body = (await request.json()) as { requesterId: string; body: string };
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
          targetAgentId: "talkie.main.mini",
          flight: {
            id: "flt-1",
            invocationId: "inv-1",
            requesterId: body.requesterId,
            targetAgentId: "talkie.main.mini",
            state: "running",
          },
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/collaboration/records"
      ) {
        captured.postedRecord = (await request.json()) as NonNullable<
          typeof captured.postedRecord
        >;
        return jsonResponse({ ok: true, recordId: captured.postedRecord.id });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/collaboration/events"
      ) {
        captured.postedEvent = (await request.json()) as NonNullable<typeof captured.postedEvent>;
        return jsonResponse({ ok: true, eventId: captured.postedEvent.recordId });
      }
      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await askScoutQuestion({
      senderId: "operator",
      targetLabel: "talkie",
      body: "build it for me",
      currentDirectory: workspaceRoot,
      workItem: {
        title: "Build the talkie feature",
        summary: "Track the delegated implementation request",
      },
    });

    expect(result.usedBroker).toBe(true);
    expect(result.workItem?.id.startsWith("work-")).toBe(true);
    expect(result.workItem?.title).toBe("Build the talkie feature");
    expect(captured.postedRecord?.kind).toBe("work_item");
    expect(captured.postedRecord?.ownerId).toBe("talkie.main.mini");
    expect(captured.postedEvent?.recordId).toBe(result.workItem?.id);
    expect(captured.postedEvent?.kind).toBe("created");
  }, 15000);
});

describe("updateScoutWorkItem", () => {
  test("updates an existing work item and appends a collaboration event", async () => {
    useIsolatedOpenScoutHome();

    const snapshot: {
      actors: Record<string, unknown>;
      agents: Record<string, unknown>;
      endpoints: Record<string, unknown>;
      conversations: Record<string, unknown>;
      messages: Record<string, unknown>;
      flights: Record<string, unknown>;
      collaborationRecords: Record<string, {
        id: string;
        kind: string;
        title: string;
        summary?: string;
        state: string;
        acceptanceState: string;
        createdById?: string;
        ownerId?: string;
        nextMoveOwnerId?: string;
        requestedById?: string;
        conversationId?: string;
        createdAt: number;
        updatedAt: number;
        reviewRequestedAt?: number;
      }>;
    } = {
      actors: {},
      agents: {},
      endpoints: {},
      conversations: {},
      messages: {},
      flights: {},
      collaborationRecords: {
        "work-1": {
          id: "work-1",
          kind: "work_item",
          title: "Render the promo clip",
          summary: "Initial request",
          state: "working",
          acceptanceState: "pending",
          createdById: "premotion.master.mini",
          requestedById: "premotion.master.mini",
          ownerId: "hudson.main",
          nextMoveOwnerId: "hudson.main",
          conversationId: "dm.premotion.master.mini.hudson.main",
          createdAt: 100,
          updatedAt: 100,
        },
      },
    };
    const captured = {
      postedRecord: null as {
        id: string;
        kind: string;
        title: string;
        summary?: string;
        state: string;
        acceptanceState: string;
        createdById?: string;
        ownerId?: string;
        nextMoveOwnerId?: string;
        requestedById?: string;
        conversationId?: string;
        createdAt: number;
        updatedAt: number;
        reviewRequestedAt?: number;
      } | null,
      postedEvent: null as { kind: string; summary?: string } | null,
    };

    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse(snapshot);
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/collaboration/records"
      ) {
        const body = (await request.json()) as NonNullable<typeof captured.postedRecord>;
        captured.postedRecord = body;
        snapshot.collaborationRecords["work-1"] = body;
        return jsonResponse({ ok: true, recordId: body.id });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/collaboration/events"
      ) {
        captured.postedEvent = (await request.json()) as NonNullable<typeof captured.postedEvent>;
        return jsonResponse({ ok: true, eventId: "evt-1" });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const updated = await updateScoutWorkItem({
      workId: "work-1",
      actorId: "hudson.main",
      state: "review",
      summary: "Ready for operator review",
    });

    expect(updated?.id).toBe("work-1");
    expect(updated?.state).toBe("review");
    expect(updated?.summary).toBe("Ready for operator review");
    expect(captured.postedRecord?.state).toBe("review");
    expect(captured.postedRecord?.summary).toBe("Ready for operator review");
    expect(typeof captured.postedRecord?.reviewRequestedAt).toBe("number");
    expect(captured.postedEvent?.kind).toBe("review_requested");
    expect(captured.postedEvent?.summary).toBe("Ready for operator review");
  });
});

describe("resolveScoutSenderId", () => {
  test("falls back to the operator name outside a project", async () => {
    const home = useIsolatedOpenScoutHome();
    const scratch = join(home, "scratch");
    mkdirSync(scratch, { recursive: true });
    process.env.OPENSCOUT_OPERATOR_NAME = "arach";

    const senderId = await resolveScoutSenderId(null, scratch);

    expect(senderId).toBe("arach");
  });

  test("prefers OPENSCOUT_AGENT when present", async () => {
    const home = useIsolatedOpenScoutHome();
    const scratch = join(home, "scratch");
    mkdirSync(scratch, { recursive: true });
    process.env.OPENSCOUT_AGENT = "vox.main.mini";
    process.env.OPENSCOUT_OPERATOR_NAME = "arach";

    const senderId = await resolveScoutSenderId(null, scratch);

    expect(senderId).toBe("vox.main.mini");
  });

  test("uses the current project root instead of a duplicate basename", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceA = join(home, "workspace-a");
    const workspaceB = join(home, "workspace-b");
    const repoA = join(workspaceA, "shared");
    const repoB = join(workspaceB, "shared");
    const nestedRepoB = join(repoB, "src", "feature");

    mkdirSync(join(repoA, ".git"), { recursive: true });
    mkdirSync(join(repoB, ".git"), { recursive: true });
    mkdirSync(nestedRepoB, { recursive: true });

    await writeProjectConfig(repoA, {
      version: 1,
      project: {
        id: "alpha-project",
        name: "Alpha Project",
      },
      agent: {
        id: "alpha",
      },
    });
    await writeProjectConfig(repoB, {
      version: 1,
      project: {
        id: "beta-project",
        name: "Beta Project",
      },
      agent: {
        id: "beta",
      },
    });

    const senderA = await resolveScoutSenderId(null, repoA);
    const senderB = await resolveScoutSenderId(null, nestedRepoB);

    expect(senderA).toMatch(/^alpha\./);
    expect(senderB).toMatch(/^beta\./);
    expect(senderA).not.toBe(senderB);
  });

  test("prefers the project-configured agent when multiple local cards share the root", async () => {
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
        id: "ranger",
      },
    });
    await writeRelayAgentOverrides({
      "openscout-canvas-nav.main.mini": {
        agentId: "openscout-canvas-nav.main.mini",
        definitionId: "openscout-canvas-nav",
        projectName: "OpenScout",
        projectRoot: repo,
        source: "manual",
      },
      "ranger.main.mini": {
        agentId: "ranger.main.mini",
        definitionId: "ranger",
        projectName: "OpenScout",
        projectRoot: repo,
        source: "manual",
      },
    });

    const senderId = await resolveScoutSenderId(null, repo);

    expect(senderId.startsWith("ranger.")).toBe(true);
    expect(senderId.startsWith("openscout-canvas-nav.")).toBe(false);
  });
});

describe("sendScoutMessage", () => {
  test("posts a durable message without creating an invocation", async () => {
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

    const requests: Array<{ method: string; path: string }> = [];
    const captured = {
      postedMessage: null as {
        id: string;
        conversationId: string;
        audience?: { notify: string[]; reason: string };
        metadata?: { relayChannel?: string };
      } | null,
    };
    const snapshot = {
      actors: {} as Record<string, unknown>,
      agents: {} as Record<string, unknown>,
      endpoints: {} as Record<string, unknown>,
      conversations: {} as Record<string, unknown>,
      messages: {} as Record<string, unknown>,
      flights: {} as Record<string, unknown>,
    };

    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse(snapshot);
      }
      if (request.method === "POST" && url.pathname === "/v1/actors") {
        const body = (await request.json()) as { id: string };
        snapshot.actors[body.id] = body;
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/agents") {
        const body = (await request.json()) as { id: string };
        snapshot.agents[body.id] = body;
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/conversations") {
        const body = (await request.json()) as { id: string };
        snapshot.conversations[body.id] = body;
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        const body = (await request.json()) as { requesterId: string; body: string };
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
            audience: {
              notify: ["talkie"],
              reason: "direct_message",
            },
            visibility: "private",
            policy: "durable",
            createdAt: Date.now(),
            metadata: {
              relayChannel: "dm",
            },
          },
          targetAgentId: "talkie",
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await sendScoutMessage({
      senderId: "operator",
      body: "@talkie hello",
      currentDirectory: workspaceRoot,
    });

    expect(result.usedBroker).toBe(true);
    expect(result.conversationId?.startsWith("dm.")).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.unresolvedTargets).toEqual([]);
    expect(result.invokedTargets).toHaveLength(1);
    expect(requests.some((request) => request.path === "/v1/deliver")).toBe(
      true,
    );
    expect(requests.some((request) => request.path === "/v1/messages")).toBe(
      false,
    );
    expect(requests.some((request) => request.path === "/v1/invocations")).toBe(
      false,
    );
  }, 15000);

  test("fails closed when a mention target is unresolved", async () => {
    useIsolatedOpenScoutHome();

    const requests: Array<{ method: string; path: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
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
      if (request.method === "POST" && url.pathname === "/v1/deliver") {
        return jsonResponse({
          kind: "rejected",
          accepted: false,
          reason: "unknown_target",
          rejection: {
            id: "dispatch-unknown",
            kind: "unknown",
            askedLabel: "@missing",
            detail: "no agent matches @missing",
            candidates: [],
            dispatchedAt: Date.now(),
            dispatcherNodeId: "node-1",
          },
        });
      }

      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await sendScoutMessage({
      senderId: "operator",
      body: "@missing hello",
      currentDirectory: process.cwd(),
    });

    expect(result.usedBroker).toBe(true);
    expect(result.invokedTargets).toEqual([]);
    expect(result.unresolvedTargets).toEqual(["@missing"]);
    expect(result.targetDiagnostic?.state).toBe("unknown");
    expect(requests.some((request) => request.path === "/v1/deliver")).toBe(
      true,
    );
    expect(requests.some((request) => request.path === "/v1/messages")).toBe(
      false,
    );
    expect(
      requests.some((request) => request.path === "/v1/conversations"),
    ).toBe(false);
    expect(requests.some((request) => request.path === "/v1/invocations")).toBe(
      false,
    );
  }, 15000);

  test("fails closed when send has no explicit destination", async () => {
    useIsolatedOpenScoutHome();

    const requests: Array<{ method: string; path: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
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

      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await sendScoutMessage({
      senderId: "operator",
      body: "hello without an addressee",
      currentDirectory: process.cwd(),
    });

    expect(result.usedBroker).toBe(true);
    expect(result.routingError).toBe("missing_destination");
    expect(result.invokedTargets).toEqual([]);
    expect(result.unresolvedTargets).toEqual([]);
    expect(requests.some((request) => request.path === "/v1/messages")).toBe(
      false,
    );
    expect(
      requests.some((request) => request.path === "/v1/conversations"),
    ).toBe(false);
  }, 15000);

  test("fails closed when send mentions multiple agents without an explicit channel", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const talkieRoot = join(workspaceRoot, "talkie");
    const hudsonRoot = join(workspaceRoot, "hudson");

    mkdirSync(join(talkieRoot, ".git"), { recursive: true });
    writeFileSync(join(talkieRoot, "AGENTS.md"), "# talkie\n", "utf8");
    mkdirSync(join(hudsonRoot, ".git"), { recursive: true });
    writeFileSync(join(hudsonRoot, "AGENTS.md"), "# hudson\n", "utf8");

    await writeOpenScoutSettings({
      discovery: {
        workspaceRoots: [workspaceRoot],
        includeCurrentRepo: false,
      },
    });

    const requests: Array<{ method: string; path: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
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

      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await sendScoutMessage({
      senderId: "operator",
      body: "@talkie @hudson please review this",
      currentDirectory: workspaceRoot,
    });

    expect(result.usedBroker).toBe(true);
    expect(result.routingError).toBe(
      "multi_target_requires_explicit_channel",
    );
    expect(result.invokedTargets).toEqual([]);
    expect(result.unresolvedTargets).toEqual([]);
    expect(requests.some((request) => request.path === "/v1/messages")).toBe(
      false,
    );
    expect(
      requests.some((request) => request.path === "/v1/conversations"),
    ).toBe(false);
  }, 15000);
});

describe("watchScoutMessages", () => {
  test("does not suppress messages from the same actor id", async () => {
    useIsolatedOpenScoutHome();

    const encoder = new TextEncoder();
    const received: Array<{ actorId: string; body: string }> = [];

    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

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
      if (request.method === "GET" && url.pathname === "/v1/events/stream") {
        const payload = JSON.stringify({
          kind: "message.posted",
          payload: {
            message: {
              id: "m-1",
              conversationId: "channel.shared",
              actorId: "scout.main.mini",
              body: "hello from a sibling session",
              class: "agent",
              createdAt: Date.now(),
            },
          },
        });
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(`event: message.posted\ndata: ${payload}\n\n`),
              );
              controller.close();
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        );
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    await watchScoutMessages({
      channel: "shared",
      onMessage(message) {
        received.push({ actorId: message.actorId, body: message.body });
      },
    });

    expect(received).toEqual([
      {
        actorId: "scout.main.mini",
        body: "hello from a sibling session",
      },
    ]);
  });
});
