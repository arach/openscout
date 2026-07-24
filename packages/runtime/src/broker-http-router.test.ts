import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import {
  createBrokerHttpRouter,
  type BrokerHttpRouterDeps,
} from "./broker-http-router.js";
import { migrateControlPlaneDatabaseSchema } from "./control-plane-migrations.js";

class FakeResponse extends EventEmitter {
  body = "";
  destroyed = false;
  headers: Record<string, string> | undefined;
  status: number | undefined;
  writableEnded = false;

  writeHead(status: number, headers: Record<string, string> = {}): void {
    this.status = status;
    this.headers = headers;
  }

  write(chunk: string): void {
    this.body += chunk;
  }

  end(chunk?: string): void {
    if (chunk) {
      this.body += chunk;
    }
    this.writableEnded = true;
  }
}

type Harness = {
  cursorBodies: unknown[];
  deliverCalls: Array<{ payload: unknown; signal?: AbortSignal }>;
  invocationCalls: unknown[];
  deps: BrokerHttpRouterDeps;
  routed: ReturnType<typeof createBrokerHttpRouter>;
};

function createHarness(overrides: Partial<BrokerHttpRouterDeps> = {}): Harness {
  const cursorBodies: unknown[] = [];
  const deliverCalls: Array<{ payload: unknown; signal?: AbortSignal }> = [];
  const invocationCalls: unknown[] = [];
  const node = {
    id: "node-1",
    name: "Node 1",
    meshId: "mesh-1",
    endpoints: [],
    lastSeenAt: 1,
  };
  const cursor = {
    conversationId: "conversation-1",
    actorId: "agent-1",
    lastReadAt: 100,
    updatedAt: 100,
  };
  const deps = {
    host: "127.0.0.1",
    port: 43110,
    nodeId: "node-1",
    meshId: "mesh-1",
    operatorActorId: "operator",
    runtime: {
      snapshot: () => ({ nodes: { [node.id]: node } }),
      recentEvents: (limit: number) => [{ id: "evt-1", limit }],
      collaborationRecord: () => undefined,
      flightForInvocation: () => undefined,
      deleteEndpoint: () => {},
      upsertAgentIdentity: () => {},
      upsertEndpoint: () => {},
    },
    journal: {
      listDeliveries: () => [],
      listScoutDispatches: () => [],
    },
    knownInvocations: new Map(),
    brokerService: {
      baseUrl: "http://broker.test",
      readHealth: async () => ({ ok: true, nodeId: "node-1", meshId: "mesh-1" }),
      readNode: async () => node,
      readSnapshot: async () => ({ nodes: { [node.id]: node } }),
      executeCommand: async () => ({ ok: true }),
      deliver: async (payload: unknown, options?: { signal?: AbortSignal }) => {
        deliverCalls.push({ payload, signal: options?.signal });
        return { kind: "delivery", deliveryId: "delivery-1" };
      },
    },
    webControl: {
      corsHeaders: () => ({ "access-control-allow-origin": "http://app.test" }),
      status: async () => ({ ok: true }),
      startIfNeeded: async () => ({ ok: true }),
      restartIfManaged: async () => ({ ok: true }),
      startContextFromRequest: () => ({ from: "test" }),
      failureStatus: (error: unknown) => ({ ok: false, detail: String(error) }),
    },
    a2aService: {
      agentCardForRequest: async () => ({ name: "OpenScout" }),
      handleJsonRpc: async () => ({ jsonrpc: "2.0", id: null, result: {} }),
      listScoutAgentCards: async () => [],
    },
    brokerRepoTailService: {
      warmRepoWatchSnapshot: () => {},
      readRepoWatchSnapshotForUrl: async () => ({ ok: true }),
      readTailRecentPayloadWithTiming: async () => ({
        payload: { generatedAt: 1, limit: 0, cursor: null, events: [] },
        timings: [],
      }),
      readTailRecentPayload: async () => ({ generatedAt: 1, limit: 0, cursor: null, events: [] }),
    },
    getHarnessTopologySnapshot: async () => ({ nodes: [] }),
    getTailDiscovery: async () => ({ tails: [] }),
    nudgeHarnessTopologyScan: async () => ({ ok: true }),
    deliveryHttpService: {
      readInboxItems: async () => [],
      readInboxSnapshot: async () => ({ targetId: "agent-1", items: [] }),
      claimInboxItem: async () => ({ ok: true, claimed: null }),
      acknowledgeInboxItem: async () => ({ status: 200, body: { ok: true } }),
      nackInboxItem: async () => ({ status: 200, body: { ok: true } }),
      listDeliveries: () => [],
      claimDelivery: async () => ({ ok: true, claimed: null }),
      listDeliveryAttempts: () => [],
      recordDeliveryAttempt: async () => ({ ok: true }),
      updateDeliveryStatus: async () => ({ ok: true }),
    },
    durableActionHttpService: {
      recordAction: async () => ({ ok: true, actionId: "action-1" }),
      heartbeat: async () => ({ status: 200, body: { ok: true } }),
    },
    controlStreams: {
      addInboxStream: () => {},
      addInvocationStream: () => {},
      addEventStream: () => {},
    },
    managedSessionHttpService: {
      listPairingSessionCandidates: async () => [],
      attachPairingSession: async () => ({ ok: true }),
      detachPairingSession: async () => ({ ok: true }),
      attachLocalSession: async () => ({ ok: true }),
      ensureLocalSession: async () => ({ ok: true }),
      detachLocalSession: async () => ({ ok: true }),
    },
    meshDiscoveryService: {
      discoverPeers: async () => ({ discovered: [], probes: [] }),
    },
    meshHttpService: {
      receiveMessageBundle: async () => ({ status: 200, body: { ok: true } }),
      receiveInvocationBundle: async () => ({ status: 200, body: { ok: true } }),
      receiveCollaborationRecordBundle: async () => ({ status: 200, body: { ok: true } }),
      receiveCollaborationEventBundle: async () => ({ status: 200, body: { ok: true } }),
    },
    threadEvents: {
      streamWatch: async () => {},
    },
    handleCommand: async () => ({ ok: true }),
    handleInvocationRequest: async (payload: unknown) => {
      invocationCalls.push(payload);
      return { ok: true };
    },
    recordFlight: async () => {},
    listReadCursorsForConversation: () => [cursor],
    resolveReadCursor: async (_conversationId: string, body: unknown) => {
      cursorBodies.push(body);
      return cursor;
    },
    recordReadCursor: async () => {},
    acknowledgeDeliveriesForReadCursor: async () => ["delivery-1"],
    deliveryAcceptanceService: {
      accept: async () => ({ kind: "delivery", deliveryId: "fallback-delivery" }),
    },
    rendezvousService: {
      match: async (request: { topic: string; projectRoot: string; participantId: string }) => ({
        status: "waiting",
        topic: request.topic,
        projectRoot: request.projectRoot,
        participantId: request.participantId,
        joinedAt: 1,
        expiresAt: 2,
      }),
    },
    ...overrides,
  } as unknown as BrokerHttpRouterDeps;

  return {
    cursorBodies,
    deliverCalls,
    invocationCalls,
    deps,
    routed: createBrokerHttpRouter(deps),
  };
}

async function requestRouter(
  harness: Harness,
  method: string,
  path: string,
  options: { body?: unknown; rawBody?: string } = {},
): Promise<{ body: unknown; rawBody: string; response: FakeResponse }> {
  const request = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
    method: string;
    url: string;
  };
  request.headers = { host: "broker.test" };
  request.method = method;
  request.url = path;
  const response = new FakeResponse();

  const routed = harness.routed(request as never, response as never);
  if (options.rawBody !== undefined) {
    request.end(options.rawBody);
  } else if (options.body !== undefined) {
    request.end(JSON.stringify(options.body));
  } else {
    request.end();
  }
  await routed;

  return {
    body: response.body ? JSON.parse(response.body) : null,
    rawBody: response.body,
    response,
  };
}

describe("createBrokerHttpRouter", () => {
  test("forwards scoped alias writes to the authoritative broker without touching the local store", async () => {
    const forwards: Array<{ nodeSelector: string; path: string; method: string; body?: unknown }> = [];
    const harness = createHarness({
      routeAliasService: {} as BrokerHttpRouterDeps["routeAliasService"],
      forwardRouteAliasRequest: async (input) => {
        forwards.push(input);
        return { status: 201, body: { binding: { id: "alias-remote", revision: 1 } } };
      },
    });

    const result = await requestRouter(harness, "POST", "/v1/aliases", {
      body: {
        alias: "review",
        scope: { projectRoot: "/work/alpha", nodeId: "node-remote" },
        target: { kind: "agent_id", agentId: "agent-remote" },
        caller: { actorId: "operator", currentDirectory: "/work/alpha" },
      },
    });

    expect(result.response.status).toBe(201);
    expect(result.body).toEqual({ binding: { id: "alias-remote", revision: 1 } });
    expect(forwards).toEqual([expect.objectContaining({
      nodeSelector: "node-remote",
      path: "/v1/aliases",
      method: "POST",
      body: expect.objectContaining({ alias: "review" }),
    })]);
  });

  test("forwards host-qualified alias delivery wholesale so exact remote sessions resolve at authority", async () => {
    const forwards: Array<{ nodeSelector: string; path: string; method: string; body?: unknown }> = [];
    const harness = createHarness({
      forwardRouteAliasRequest: async (input) => {
        forwards.push(input);
        return { status: 202, body: { kind: "delivery", accepted: true, aliasResolution: { bindingId: "alias-remote", revision: 3 } } };
      },
    });

    const result = await requestRouter(harness, "POST", "/v1/deliver", {
      body: {
        body: "continue exactly there",
        intent: "consult",
        target: { kind: "route_alias", alias: "patch", scope: { projectRoot: "/work/alpha", nodeId: "node-remote" } },
      },
    });

    expect(result.response.status).toBe(202);
    expect(result.body).toEqual(expect.objectContaining({
      kind: "delivery",
      aliasResolution: { bindingId: "alias-remote", revision: 3 },
    }));
    expect(forwards).toEqual([expect.objectContaining({
      nodeSelector: "node-remote",
      path: "/v1/deliver",
      method: "POST",
    })]);
    expect(harness.deliverCalls).toEqual([]);
  });

  test("routes common JSON responses and CORS preflight without daemon state", async () => {
    const harness = createHarness();

    const health = await requestRouter(harness, "GET", "/health");
    expect(health.response.status).toBe(200);
    expect(health.body).toEqual({ ok: true, nodeId: "node-1", meshId: "mesh-1" });

    const preflight = await requestRouter(harness, "OPTIONS", "/v1/web/status");
    expect(preflight.response.status).toBe(204);
    expect(preflight.response.headers).toEqual({
      "access-control-allow-origin": "http://app.test",
    });
    expect(preflight.rawBody).toBe("");

    const missing = await requestRouter(harness, "GET", "/missing");
    expect(missing.response.status).toBe(404);
    expect(missing.body).toEqual({ error: "not_found" });
  });

  test("maps deliver outcomes onto transport status codes and passes an abort signal", async () => {
    const outcomes = [
      { kind: "delivery", deliveryId: "delivery-1" },
      { kind: "question", questionId: "question-1" },
      { kind: "unavailable", detail: "offline" },
    ];
    const harness = createHarness({
      brokerService: {
        ...createHarness().deps.brokerService,
        deliver: async (payload: unknown, options?: { signal?: AbortSignal }) => {
          harness.deliverCalls.push({ payload, signal: options?.signal });
          return outcomes.shift();
        },
      },
    } as Partial<BrokerHttpRouterDeps>);

    const delivery = await requestRouter(harness, "POST", "/v1/deliver", {
      body: { target: "agent-1", body: "hello", intent: "tell" },
    });
    const question = await requestRouter(harness, "POST", "/v1/deliver", {
      body: { target: "agent-2", body: "need input", intent: "tell" },
    });
    const unavailable = await requestRouter(harness, "POST", "/v1/deliver", {
      body: { target: "agent-3", body: "wake", intent: "tell" },
    });

    expect(delivery.response.status).toBe(202);
    expect(question.response.status).toBe(409);
    expect(unavailable.response.status).toBe(422);
    expect(harness.deliverCalls).toHaveLength(3);
    expect(harness.deliverCalls[0]?.payload).toEqual({
      target: "agent-1",
      body: "hello",
      intent: "tell",
    });
    expect(harness.deliverCalls[0]?.signal).toBeInstanceOf(AbortSignal);

    const malformedSignal = await requestRouter(harness, "POST", "/v1/deliver", {
      body: {
        targetLabel: "@operator",
        body: "Optional input",
        intent: "tell",
        operatorSignal: {
          kind: "consult",
          blocking: false,
          replyExpectation: "optional",
          defaultAction: " ",
        },
      },
    });
    expect(malformedSignal.response.status).toBe(400);
    expect(malformedSignal.body).toMatchObject({ error: "invalid_request" });
    expect(harness.deliverCalls).toHaveLength(3);
  });

  test("maps rendezvous results and validation failures onto HTTP statuses", async () => {
    const requests: unknown[] = [];
    const harness = createHarness({
      rendezvousService: {
        match: async (request: unknown) => {
          requests.push(request);
          if ((request as { topic?: string }).topic === "bad") {
            throw new Error("topic is invalid");
          }
          return {
            status: "topic_busy",
            topic: "pair",
            projectRoot: "/repo",
            participantId: "agent.three",
            participantCount: 2,
            expiresAt: 2,
            suggestion: "choose_another_topic",
          };
        },
      },
    } as Partial<BrokerHttpRouterDeps>);

    const busy = await requestRouter(harness, "POST", "/v1/rendezvous/match", {
      body: {
        topic: "pair",
        projectRoot: "/repo",
        participantId: "agent.three",
        waitMs: 0,
      },
    });
    const invalid = await requestRouter(harness, "POST", "/v1/rendezvous/match", {
      body: {
        topic: "bad",
        projectRoot: "/repo",
        participantId: "agent.three",
        waitMs: 0,
      },
    });

    expect(busy.response.status).toBe(409);
    expect(busy.body).toMatchObject({ status: "topic_busy", participantCount: 2 });
    expect(invalid.response.status).toBe(400);
    expect(requests).toHaveLength(2);
  });

  test("validates invocation requests before dispatch", async () => {
    const harness = createHarness();

    const accepted = await requestRouter(harness, "POST", "/v1/invocations", {
      body: {
        id: "inv-1",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-1",
        action: "consult",
        task: "help",
        ensureAwake: true,
        stream: false,
        createdAt: 100,
      },
    });
    expect(accepted.response.status).toBe(202);
    expect(accepted.body).toEqual({ ok: true });
    expect(harness.invocationCalls).toEqual([
      expect.objectContaining({
        id: "inv-1",
        action: "consult",
        task: "help",
      }),
    ]);

    const invalidShape = await requestRouter(harness, "POST", "/v1/invocations", {
      body: {
        id: "inv-2",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-1",
        action: "dance",
        task: "help",
        ensureAwake: true,
        stream: false,
        createdAt: 100,
      },
    });
    expect(invalidShape.response.status).toBe(400);
    expect(invalidShape.body).toMatchObject({
      error: "invalid_request",
    });

    const invalidContinuation = await requestRouter(harness, "POST", "/v1/invocations", {
      body: {
        id: "inv-3",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-1",
        action: "consult",
        task: "help",
        execution: { session: "existing" },
        ensureAwake: true,
        stream: false,
        createdAt: 100,
      },
    });
    expect(invalidContinuation.response.status).toBe(400);
    expect(invalidContinuation.body).toMatchObject({
      error: "invalid_request",
      detail: expect.stringContaining("session existing requires targetSessionId"),
    });
    expect(harness.invocationCalls).toHaveLength(1);
  });

  test("returns JSON-RPC parse errors on malformed A2A requests", async () => {
    const harness = createHarness();

    const result = await requestRouter(harness, "POST", "/v1/a2a/rpc", {
      rawBody: "{not-json",
    });

    expect(result.response.status).toBe(200);
    expect(result.response.headers?.["cache-control"]).toBe("no-cache");
    expect(result.body).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
      },
    });
  });

  test("wires read cursor GET and POST routes through explicit dependencies", async () => {
    const harness = createHarness();

    const listed = await requestRouter(harness, "GET", "/v1/conversations/conversation-1/read-cursors");
    expect(listed.response.status).toBe(200);
    expect(listed.body).toEqual([{
      conversationId: "conversation-1",
      actorId: "agent-1",
      lastReadAt: 100,
      updatedAt: 100,
    }]);

    const updated = await requestRouter(harness, "POST", "/v1/conversations/conversation-1/read-cursors", {
      body: {
        actorId: "agent-1",
        lastReadSeq: 7,
      },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body).toEqual({
      ok: true,
      cursor: {
        conversationId: "conversation-1",
        actorId: "agent-1",
        lastReadAt: 100,
        updatedAt: 100,
      },
      acknowledgedDeliveries: ["delivery-1"],
    });
    expect(harness.cursorBodies).toEqual([{ actorId: "agent-1", lastReadSeq: 7 }]);
  });

  test("routes assigned-role and mission-log writes through the broker database", async () => {
    const unavailable = createHarness();
    const unavailableResult = await requestRouter(
      unavailable,
      "GET",
      "/v1/roles/assignments",
    );
    expect(unavailableResult.response.status).toBe(503);

    const db = new Database(":memory:");
    try {
      migrateControlPlaneDatabaseSchema(db);
      const harness = createHarness({ openRolesDb: () => db });

      const catalog = await requestRouter(harness, "GET", "/v1/roles/catalog");
      expect(catalog.response.status).toBe(200);
      expect(catalog.body).toMatchObject({
        roles: [expect.objectContaining({ id: "orchestrator" })],
      });

      const assigned = await requestRouter(harness, "POST", "/v1/roles/assignments", {
        body: {
          roleId: "orchestrator",
          agentId: "agent-1",
          scope: { kind: "mission", missionId: "work-1" },
        },
      });
      expect(assigned.response.status).toBe(201);
      expect(assigned.body).toMatchObject({
        assignment: {
          roleId: "orchestrator",
          agentId: "agent-1",
          active: true,
        },
      });

      const listed = await requestRouter(
        harness,
        "GET",
        "/v1/roles/assignments?missionId=work-1",
      );
      expect(listed.response.status).toBe(200);
      expect(listed.body).toMatchObject({
        assignments: [expect.objectContaining({ agentId: "agent-1" })],
      });

      const appended = await requestRouter(harness, "POST", "/v1/missions/work-1/log", {
        body: {
          actorId: "agent-1",
          kind: "progress",
          intent: "Ship the role shell",
          status: "verified",
        },
      });
      expect(appended.response.status).toBe(201);
      expect(appended.body).toMatchObject({
        entry: {
          missionId: "work-1",
          actorId: "agent-1",
          seq: 1,
        },
      });

      const log = await requestRouter(harness, "GET", "/v1/missions/work-1/log");
      expect(log.response.status).toBe(200);
      expect(log.body).toMatchObject({
        missionId: "work-1",
        entries: [expect.objectContaining({ status: "verified" })],
      });

      const assignmentId = (assigned.body as { assignment: { id: string } }).assignment.id;
      const revoked = await requestRouter(
        harness,
        "POST",
        `/v1/roles/assignments/${encodeURIComponent(assignmentId)}/revoke`,
      );
      expect(revoked.response.status).toBe(200);
      expect(revoked.body).toMatchObject({ assignment: { active: false } });

      const denied = await requestRouter(harness, "POST", "/v1/missions/work-1/log", {
        body: {
          actorId: "agent-1",
          kind: "progress",
          intent: "Write after revoke",
          status: "should fail",
        },
      });
      expect(denied.response.status).toBe(400);
      expect(denied.body).toMatchObject({
        error: "bad_request",
        detail: expect.stringContaining("not an assigned mission-log writer"),
      });
    } finally {
      db.close();
    }
  });
});
