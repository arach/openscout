import { describe, expect, test } from "bun:test";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  InvocationRequest,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
import { BrokerLocalEndpointResolver } from "./broker-local-endpoint-resolver.js";
import type { LocalAgentBinding } from "./local-agents.js";

function testActor(input: Partial<ActorIdentity> = {}): ActorIdentity {
  return {
    id: "agent-1",
    kind: "agent",
    displayName: "Agent One",
    handle: "agent-one",
    labels: ["agent"],
    metadata: {},
    ...input,
  };
}

function testAgent(input: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    ...testActor(input),
    id: "agent-1",
    kind: "agent",
    definitionId: "agent-1",
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

function testEndpoint(input: Partial<AgentEndpoint> = {}): AgentEndpoint {
  return {
    id: "endpoint-1",
    agentId: "agent-1",
    nodeId: "node-1",
    harness: "codex",
    transport: "codex_app_server",
    state: "idle",
    sessionId: "session-1",
    metadata: {},
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
    ensureAwake: false,
    stream: false,
    createdAt: 1_000,
    metadata: {},
    ...input,
  };
}

function createResolver(input: {
  bindings?: Record<string, LocalAgentBinding | null>;
  onlineSession?: {
    externalSessionId?: string | null;
    metadata?: Record<string, unknown>;
  };
  now?: number;
} = {}) {
  const runtime = createInMemoryControlRuntime({}, { localNodeId: "node-1" });
  const persistedEndpoints: AgentEndpoint[] = [];
  const upsertedActors: ActorIdentity[] = [];
  const upsertedAgents: AgentDefinition[] = [];
  const ensuredBindings: Array<{ agentId: string; harness?: string }> = [];
  const ensuredSessionEndpoints: AgentEndpoint[] = [];
  const resolver = new BrokerLocalEndpointResolver({
    nodeId: "node-1",
    runtime,
    isLocalAgentEndpointAlive: (endpoint) => endpoint.metadata?.alive === true,
    async ensureLocalSessionEndpointOnline(endpoint) {
      ensuredSessionEndpoints.push(endpoint);
      return input.onlineSession ?? { externalSessionId: "revived-session" };
    },
    async ensureLocalAgentBindingOnline(agentId, _nodeId, options) {
      ensuredBindings.push({ agentId, harness: options.harness });
      return input.bindings?.[agentId] ?? null;
    },
    async upsertActor(actor) {
      upsertedActors.push(actor);
      await runtime.upsertActor(actor);
    },
    async upsertAgent(agent) {
      upsertedAgents.push(agent);
      await runtime.upsertAgent(agent);
    },
    async persistEndpoint(endpoint) {
      persistedEndpoints.push(endpoint);
      await runtime.upsertEndpoint(endpoint);
    },
    now: () => input.now ?? 10_000,
  });

  return {
    runtime,
    resolver,
    persistedEndpoints,
    upsertedActors,
    upsertedAgents,
    ensuredBindings,
    ensuredSessionEndpoints,
  };
}

describe("BrokerLocalEndpointResolver", () => {
  test("selects active endpoints by transport preference and session aliases", async () => {
    const harness = createResolver();
    await harness.runtime.upsertEndpoint(testEndpoint({
      id: "codex",
      transport: "codex_app_server",
      metadata: { alive: true, lastStartedAt: 2_000 },
    }));
    await harness.runtime.upsertEndpoint(testEndpoint({
      id: "tmux",
      transport: "tmux",
      metadata: { alive: true, lastStartedAt: 1_000, tmuxSession: "tmux-session" },
    }));
    await harness.runtime.upsertEndpoint(testEndpoint({
      id: "stale",
      transport: "codex_app_server",
      metadata: { staleLocalRegistration: true, lastStartedAt: 10_000 },
    }));

    expect(harness.resolver.activeLocalEndpointForAgent("agent-1")?.id).toBe("tmux");
    expect(harness.resolver.activeLocalEndpointForAgent("agent-1", undefined, "tmux-session")?.id).toBe("tmux");
    expect(harness.resolver.activeLocalEndpointForAgent("agent-1", undefined, "missing")).toBeUndefined();
  });

  test("returns existing pairing endpoints and honors existing-session requests", async () => {
    const harness = createResolver();
    await harness.runtime.upsertEndpoint(testEndpoint({
      id: "pairing",
      transport: "pairing_bridge",
      sessionId: "pairing-session",
      metadata: { source: "pairing-session", managedByScout: true },
    }));

    await expect(harness.resolver.resolveLocalEndpointForInvocation(testInvocation({
      execution: { targetSessionId: "pairing-session" },
    }))).resolves.toEqual(expect.objectContaining({ id: "pairing" }));
    await expect(harness.resolver.resolveLocalEndpointForInvocation(testInvocation({
      targetAgentId: "missing-agent",
      execution: { session: "existing" },
      ensureAwake: true,
    }))).resolves.toBeUndefined();
  });

  test("rejects stale exact-session endpoints before trying to revive them", async () => {
    const harness = createResolver();
    await harness.runtime.upsertEndpoint(testEndpoint({
      id: "stale-session",
      sessionId: "thread-1",
      state: "waiting",
      metadata: {
        staleLocalRegistration: true,
        replacedByAgentId: "agent-2",
      },
    }));

    await expect(harness.resolver.resolveLocalEndpointForInvocation(testInvocation({
      execution: { targetSessionId: "thread-1" },
      ensureAwake: true,
    }))).rejects.toThrow("endpoint stale-session is a superseded local registration replaced by current setup");
    expect(harness.ensuredSessionEndpoints).toEqual([]);
  });

  test("revives managed local-session endpoints for exact-session wake requests", async () => {
    const harness = createResolver({
      onlineSession: {
        externalSessionId: "thread-revived",
        metadata: { runtimeInstanceId: "runtime-1" },
      },
      now: 12_000,
    });
    await harness.runtime.upsertEndpoint(testEndpoint({
      id: "local-session",
      transport: "codex_app_server",
      state: "waiting",
      sessionId: "thread-old",
      metadata: {
        source: "local-session",
        managedByScout: true,
        threadId: "thread-old",
        lastError: "offline",
        lastFailedAt: 9_000,
      },
    }));

    const endpoint = await harness.resolver.resolveLocalEndpointForInvocation(testInvocation({
      execution: { targetSessionId: "thread-old" },
      ensureAwake: true,
    }));

    expect(endpoint).toEqual(expect.objectContaining({
      id: "local-session",
      state: "idle",
      sessionId: "thread-old",
      metadata: expect.objectContaining({
        source: "local-session",
        managedByScout: true,
        runtimeInstanceId: "runtime-1",
        externalSessionId: "thread-revived",
        threadId: "thread-revived",
        lastResumedAt: 12_000,
      }),
    }));
    expect(endpoint?.metadata?.lastError).toBeUndefined();
    expect(endpoint?.metadata?.lastFailedAt).toBeUndefined();
    expect(harness.persistedEndpoints).toHaveLength(1);
  });

  test("selects a wakeable session-backed endpoint only when wake is requested", async () => {
    const harness = createResolver();
    const endpoint = testEndpoint({
      id: "cardless-session",
      agentId: "session-cardless",
      transport: "claude_stream_json",
      harness: "claude",
      sessionId: "session-cardless",
      metadata: {
        cardless: true,
        sessionBacked: true,
        pendingExternalSession: true,
      },
    });
    await harness.runtime.upsertEndpoint(endpoint);

    await expect(harness.resolver.resolveLocalEndpointForInvocation(testInvocation({
      targetAgentId: "session-cardless",
      ensureAwake: false,
      execution: { harness: "claude" },
    }))).resolves.toBeUndefined();
    await expect(harness.resolver.resolveLocalEndpointForInvocation(testInvocation({
      targetAgentId: "session-cardless",
      ensureAwake: true,
      execution: { harness: "claude" },
    }))).resolves.toEqual(endpoint);
    expect(harness.ensuredBindings).toEqual([]);
  });

  test("starts and persists a local binding when wake is requested without an exact session", async () => {
    const actor = testActor({ id: "actor-1" });
    const agent = testAgent({ id: "agent-1" });
    const endpoint = testEndpoint({ id: "started-endpoint" });
    const harness = createResolver({
      bindings: {
        "agent-1": { actor, agent, endpoint },
      },
    });

    await expect(harness.resolver.resolveLocalEndpointForInvocation(testInvocation({
      ensureAwake: true,
      execution: { harness: "codex" },
    }))).resolves.toEqual(endpoint);
    expect(harness.ensuredBindings).toEqual([{ agentId: "agent-1", harness: "codex" }]);
    expect(harness.upsertedActors).toEqual([actor]);
    expect(harness.upsertedAgents).toEqual([agent]);
    expect(harness.persistedEndpoints).toEqual([endpoint]);
  });
});
