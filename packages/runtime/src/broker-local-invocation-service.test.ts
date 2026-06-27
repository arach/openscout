import { describe, expect, test } from "bun:test";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  ConversationDefinition,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
} from "@openscout/protocol";

import { BrokerLocalInvocationService } from "./broker-local-invocation-service.js";
import { RequesterWaitTimeoutError } from "./requester-timeout.js";

function testAgent(input: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agent-1",
    kind: "agent",
    definitionId: "agent-1",
    displayName: "Agent One",
    handle: "agent-one",
    labels: ["agent"],
    metadata: {},
    selector: "@agent-one",
    defaultSelector: "@agent-one",
    agentClass: "general",
    capabilities: ["chat", "invoke", "deliver"],
    wakePolicy: "on_demand",
    homeNodeId: "node-1",
    authorityNodeId: "node-1",
    advertiseScope: "local",
    ...input,
  };
}

function testActor(input: Partial<ActorIdentity> = {}): ActorIdentity {
  return {
    id: "agent-1",
    kind: "agent",
    displayName: "Agent One",
    handle: "agent-one",
    metadata: {},
    ...input,
  };
}

function testEndpoint(input: Partial<AgentEndpoint> = {}): AgentEndpoint {
  return {
    id: "endpoint-1",
    agentId: "agent-1",
    nodeId: "node-1",
    harness: "codex",
    transport: "pairing_bridge",
    state: "idle",
    sessionId: "session-1",
    metadata: { agentName: "agent-one" },
    ...input,
  };
}

function testInvocation(input: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    id: "invocation-1",
    requesterId: "operator",
    requesterNodeId: "node-1",
    targetAgentId: "agent-1",
    action: "consult",
    task: "hello",
    conversationId: "conversation-1",
    messageId: "message-1",
    ensureAwake: false,
    stream: false,
    createdAt: 1_000,
    metadata: {},
    ...input,
  };
}

function testFlight(input: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: "flight-1",
    invocationId: "invocation-1",
    requesterId: "operator",
    targetAgentId: "agent-1",
    state: "waking",
    startedAt: 1_000,
    metadata: {},
    ...input,
  };
}

function testConversation(input: Partial<ConversationDefinition> = {}): ConversationDefinition {
  return {
    id: "conversation-1",
    kind: "direct",
    title: "Agent One",
    visibility: "workspace",
    shareMode: "local",
    authorityNodeId: "node-1",
    participantIds: ["operator", "agent-1"],
    metadata: {},
    ...input,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await tick();
  }
  throw new Error("condition was not met");
}

function createHarness(input: {
  endpoint?: AgentEndpoint;
  resolveError?: Error;
  invokeResult?: { output: string; externalSessionId?: string; metadata?: Record<string, unknown> };
  invokeError?: Error;
  invokeEndpoint?: (endpoint: AgentEndpoint, invocation: InvocationRequest) => Promise<{ output: string; externalSessionId?: string; metadata?: Record<string, unknown> }>;
  previousEndpoint?: AgentEndpoint;
  actor?: ActorIdentity;
  agent?: AgentDefinition;
  conversation?: ConversationDefinition;
  now?: number;
} = {}) {
  const agents: Record<string, AgentDefinition> = {};
  const actors: Record<string, ActorIdentity> = {};
  const conversations: Record<string, ConversationDefinition> = {};
  const flights: Record<string, FlightRecord> = {};
  const endpoints: Record<string, AgentEndpoint> = {};
  const persistedFlights: FlightRecord[] = [];
  const persistedEndpoints: AgentEndpoint[] = [];
  const postedMessages: MessageRecord[] = [];
  const statusMessages: Array<{ invocation: InvocationRequest; flight: { summary?: string; error?: string } }> = [];
  const warnings: string[] = [];
  const activeInvocationTasks = new Map<string, Promise<void>>();
  const endpoint = input.endpoint;
  if (input.agent !== null) {
    const agent = input.agent ?? testAgent();
    agents[agent.id] = agent;
    actors[agent.id] = testActor(agent);
  }
  if (input.actor) {
    actors[input.actor.id] = input.actor;
  }
  const conversation = input.conversation ?? testConversation();
  conversations[conversation.id] = conversation;
  if (endpoint) {
    endpoints[endpoint.id] = endpoint;
  }

  const service = new BrokerLocalInvocationService({
    nodeId: "node-1",
    runtime: {
      actor: (actorId) => actors[actorId],
      agent: (agentId) => agents[agentId],
      conversation: (conversationId) => conversations[conversationId],
      flightForInvocation: (invocationId) =>
        Object.values(flights).find((flight) => flight.invocationId === invocationId),
      snapshot: () => ({
        nodes: {},
        actors,
        agents,
        endpoints,
        conversations,
        bindings: {},
        messages: {},
        readCursors: {},
        invocations: {},
        flights,
        collaborationRecords: {},
        unblockRequests: {},
      }),
    },
    endpointResolver: {
      activeLocalEndpointForAgent: () => input.previousEndpoint ?? endpoint,
      async resolveLocalEndpointForInvocation() {
        if (input.resolveError) {
          throw input.resolveError;
        }
        return endpoint;
      },
    },
    activeInvocationTasks,
    createId: () => "msg-generated",
    async persistFlight(flight) {
      persistedFlights.push(flight);
      flights[flight.id] = flight;
    },
    async persistEndpoint(nextEndpoint) {
      persistedEndpoints.push(nextEndpoint);
      endpoints[nextEndpoint.id] = nextEndpoint;
    },
    async postInvocationStatusMessage(invocation, flight) {
      statusMessages.push({ invocation, flight });
    },
    async postConversationMessage(message) {
      postedMessages.push(message);
      return { ok: true };
    },
    existingBrokerReplyForInvocation: () => null,
    completeInvocationForBrokerReply: async () => false,
    messageVisibilityForConversation: (conversationInput) => conversationInput?.visibility ?? "workspace",
    scoutbotReplyProvenanceMetadata: () => ({ provenance: "test" }),
    async invokePairingSessionEndpoint(nextEndpoint, nextInvocation) {
      if (input.invokeEndpoint) {
        return input.invokeEndpoint(nextEndpoint, nextInvocation);
      }
      if (input.invokeError) {
        throw input.invokeError;
      }
      return input.invokeResult ?? { output: "agent reply" };
    },
    async invokeLocalAgentEndpoint() {
      if (input.invokeError) {
        throw input.invokeError;
      }
      return input.invokeResult ?? { output: "agent reply" };
    },
    warn: (message) => warnings.push(message),
    now: () => input.now ?? 10_000,
  });

  return {
    activeInvocationTasks,
    persistedFlights,
    persistedEndpoints,
    postedMessages,
    service,
    statusMessages,
    warnings,
  };
}

describe("BrokerLocalInvocationService", () => {
  test("queues when no runnable endpoint is available", async () => {
    const harness = createHarness({ endpoint: undefined, now: 11_000 });

    await harness.service.execute(testInvocation(), testFlight());

    expect(harness.persistedFlights).toEqual([
      expect.objectContaining({
        id: "flight-1",
        state: "queued",
        summary: "Message stored for Agent One. Will deliver when online.",
        metadata: expect.objectContaining({
          dispatchOutcome: {
            status: "queued_until_online",
            reason: "no_runnable_endpoint",
            checkedAt: 11_000,
          },
        }),
      }),
    ]);
    expect(harness.persistedEndpoints).toEqual([]);
    expect(harness.postedMessages).toEqual([]);
  });

  test("runs a pairing endpoint to completion and posts a broker reply", async () => {
    const endpoint = testEndpoint({
      id: "endpoint-pairing",
      transport: "pairing_bridge",
      metadata: { agentName: "Agent One", startedAt: "1" },
    });
    const harness = createHarness({
      endpoint,
      previousEndpoint: endpoint,
      invokeResult: {
        output: "done",
        externalSessionId: "provider-session-2",
        metadata: { traceId: "trace-1" },
      },
      now: 20_000,
    });

    await harness.service.execute(testInvocation(), testFlight());

    expect(harness.persistedFlights.map((flight) => flight.state)).toEqual(["running", "completed"]);
    expect(harness.persistedFlights[0]?.metadata?.dispatchAck).toEqual(expect.objectContaining({
      endpointId: "endpoint-pairing",
      transport: "pairing_bridge",
      strategy: "attach",
    }));
    expect(harness.persistedFlights[1]).toEqual(expect.objectContaining({
      state: "completed",
      summary: "Agent One replied.",
      output: "done",
    }));
    expect(harness.persistedEndpoints).toHaveLength(2);
    expect(harness.persistedEndpoints[0]).toEqual(expect.objectContaining({
      id: "endpoint-pairing",
      state: "active",
    }));
    expect(harness.persistedEndpoints[1]).toEqual(expect.objectContaining({
      id: "endpoint-pairing",
      state: "idle",
      sessionId: "session-1",
      metadata: expect.objectContaining({
        traceId: "trace-1",
        externalSessionId: "provider-session-2",
        lastCompletedAt: 20_000,
      }),
    }));
    expect(harness.postedMessages).toHaveLength(1);
    expect(harness.postedMessages[0]).toEqual(expect.objectContaining({
      id: "msg-generated",
      actorId: "agent-1",
      body: "done",
      replyToMessageId: "message-1",
      metadata: expect.objectContaining({
        invocationId: "invocation-1",
        flightId: "flight-1",
        provenance: "test",
        responderTransport: "pairing_bridge",
      }),
    }));
  });

  test("runs a cardless session endpoint without an agent card", async () => {
    const sessionActor = testActor({
      id: "session-cardless-1",
      kind: "session",
      displayName: "openscout:session",
      handle: "session-cardless-1",
      metadata: { cardless: true },
    });
    const endpoint = testEndpoint({
      id: "endpoint-cardless",
      agentId: sessionActor.id,
      transport: "tmux",
      harness: "claude",
      sessionId: sessionActor.id,
      metadata: {
        cardless: true,
        sessionBacked: true,
        pendingExternalSession: true,
      },
    });
    const harness = createHarness({
      agent: null,
      actor: sessionActor,
      endpoint,
      invokeResult: {
        output: "session reply",
        externalSessionId: "provider-session-1",
      },
      now: 25_000,
    });

    await harness.service.execute(
      testInvocation({ targetAgentId: sessionActor.id }),
      testFlight({ targetAgentId: sessionActor.id }),
    );

    expect(harness.persistedFlights.map((flight) => flight.state)).toEqual(["running", "completed"]);
    expect(harness.persistedFlights[1]).toEqual(expect.objectContaining({
      state: "completed",
      summary: "openscout:session replied.",
      output: "session reply",
    }));
    expect(harness.persistedEndpoints.at(-1)).toEqual(expect.objectContaining({
      id: "endpoint-cardless",
      state: "idle",
      metadata: expect.objectContaining({
        externalSessionId: "provider-session-1",
        pendingExternalSession: false,
      }),
    }));
    expect(harness.postedMessages).toHaveLength(1);
    expect(harness.postedMessages[0]).toEqual(expect.objectContaining({
      actorId: sessionActor.id,
      body: "session reply",
      metadata: expect.objectContaining({
        responderSessionId: sessionActor.id,
        responderAgentName: sessionActor.handle,
      }),
    }));
  });

  test("uses pointer-forward alias copy for cardless session dispatch acks", async () => {
    const sessionActor = testActor({
      id: "session-chopin-1",
      kind: "session",
      displayName: "Project Chopin",
      handle: "project-chopin",
      metadata: { cardless: true, handle: "project-chopin" },
    });
    const endpoint = testEndpoint({
      id: "endpoint-chopin",
      agentId: sessionActor.id,
      transport: "codex_app_server",
      harness: "codex",
      sessionId: sessionActor.id,
      projectRoot: "/Users/art/dev/scope",
      cwd: "/Users/art/dev/scope",
      metadata: {
        cardless: true,
        handle: "project-chopin",
        sessionBacked: true,
        pendingExternalSession: true,
      },
    });
    const harness = createHarness({
      agent: null,
      actor: sessionActor,
      endpoint,
      invokeResult: { output: "done" },
      now: 25_000,
    });

    await harness.service.execute(
      testInvocation({ targetAgentId: sessionActor.id }),
      testFlight({ targetAgentId: sessionActor.id }),
    );

    expect(harness.persistedFlights[0]?.summary).toBe(
      "alias project-chopin → session-chopin-1 (scope, codex) acknowledged via attach.",
    );
  });

  test("keeps requester wait timeout flights running", async () => {
    const endpoint = testEndpoint({
      id: "endpoint-tmux",
      transport: "tmux",
    });
    const harness = createHarness({
      endpoint,
      invokeError: new RequesterWaitTimeoutError({ label: "agent", timeoutMs: 5_000 }),
      now: 30_000,
    });

    await harness.service.execute(testInvocation(), testFlight());

    expect(harness.persistedFlights.map((flight) => flight.state)).toEqual(["running", "running"]);
    expect(harness.persistedFlights[1]).toEqual(expect.objectContaining({
      state: "running",
      summary: "Agent One is still working.",
      error: undefined,
      completedAt: undefined,
      metadata: expect.objectContaining({
        requesterTimedOut: true,
        timeoutMs: 5_000,
        timeoutScope: "requester_wait",
      }),
    }));
    expect(harness.statusMessages).toEqual([]);
    expect(harness.warnings).toEqual([
      "[openscout-runtime] Agent One is still working; requester wait timed out after 5000ms.",
    ]);
  });

  test("launch deduplicates active invocation tasks", async () => {
    const endpoint = testEndpoint();
    const harness = createHarness({ endpoint });
    const invocation = testInvocation();
    const flight = testFlight();

    harness.service.launch(invocation, flight);
    harness.service.launch(invocation, flight);
    expect(harness.service.hasActiveInvocation(invocation.id)).toBe(true);
    expect(harness.activeInvocationTasks).toHaveLength(1);
    await harness.activeInvocationTasks.get(invocation.id);
    expect(harness.service.hasActiveInvocation(invocation.id)).toBe(false);
  });

  test("serializes different invocations for the same local route", async () => {
    const endpoint = testEndpoint();
    const firstGate = deferred();
    const started: string[] = [];
    const harness = createHarness({
      endpoint,
      async invokeEndpoint(_endpoint, nextInvocation) {
        started.push(nextInvocation.id);
        if (nextInvocation.id === "invocation-1") {
          await firstGate.promise;
        }
        return { output: `reply ${nextInvocation.id}` };
      },
    });

    const firstInvocation = testInvocation({ id: "invocation-1" });
    const secondInvocation = testInvocation({ id: "invocation-2" });
    harness.service.launch(firstInvocation, testFlight({ id: "flight-1", invocationId: firstInvocation.id }));
    harness.service.launch(secondInvocation, testFlight({ id: "flight-2", invocationId: secondInvocation.id }));

    await waitFor(() => started.length === 1);
    expect(started).toEqual(["invocation-1"]);

    firstGate.resolve();
    await harness.activeInvocationTasks.get(secondInvocation.id);

    expect(started).toEqual(["invocation-1", "invocation-2"]);
    expect(harness.persistedFlights.filter((flight) => flight.state === "running").map((flight) => flight.invocationId))
      .toEqual(["invocation-1", "invocation-2"]);
  });
});
