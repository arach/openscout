import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";

import {
  buildRelayReturnAddress,
  type ActorIdentity,
  type AgentDefinition,
  type AgentEndpoint,
  type CollaborationEvent,
  type CollaborationRecord,
  type ControlCommand,
  type ControlEvent,
  type ConversationBinding,
  type ConversationDefinition,
  type DeliveryIntent,
  type FlightRecord,
  type InvocationRequest,
  type MessageRecord,
  type NodeDefinition,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
import { buildCollaborationInvocation } from "./collaboration-invocations.js";
import { discoverMeshNodes } from "./mesh-discovery.js";
import {
  buildMeshCollaborationEventBundle,
  buildMeshCollaborationRecordBundle,
  buildMeshInvocationBundle,
  buildMeshMessageBundle,
  forwardMeshCollaborationEvent,
  forwardMeshCollaborationRecord,
  forwardMeshInvocation,
  forwardMeshMessage,
  type MeshCollaborationEventBundle,
  type MeshCollaborationRecordBundle,
  type MeshInvocationBundle,
  type MeshMessageBundle,
} from "./mesh-forwarding.js";
import {
  ensureLocalAgentBindingOnline,
  isLocalAgentEndpointAlive,
  isLocalAgentSessionAlive,
  invokeLocalAgentEndpoint,
  loadRegisteredLocalAgentBindings,
  shouldDisableGeneratedCodexEndpoint,
} from "./local-agents.js";
import { SQLiteControlPlaneStore } from "./sqlite-store.js";
import { ensureOpenScoutCleanSlateSync } from "./support-paths.js";
import {
  buildDefaultBrokerUrl,
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
} from "./broker-service.js";

function createRuntimeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveControlPlaneHome(): string {
  return process.env.OPENSCOUT_CONTROL_HOME
    ?? join(process.env.HOME ?? process.cwd(), ".openscout", "control-plane");
}

function readRequestBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve((raw ? JSON.parse(raw) : {}) as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function notFound(response: ServerResponse): void {
  json(response, 404, { error: "not_found" });
}

function badRequest(response: ServerResponse, error: unknown): void {
  json(response, 400, {
    error: "bad_request",
    detail: error instanceof Error ? error.message : String(error),
  });
}

const controlHome = resolveControlPlaneHome();
const dbPath = join(controlHome, "control-plane.sqlite");
const port = Number.parseInt(process.env.OPENSCOUT_BROKER_PORT ?? String(DEFAULT_BROKER_PORT), 10);
const host = process.env.OPENSCOUT_BROKER_HOST ?? DEFAULT_BROKER_HOST;
const meshId = process.env.OPENSCOUT_MESH_ID ?? "openscout";
const nodeName = process.env.OPENSCOUT_NODE_NAME ?? hostname();
const tailnetName = process.env.TAILSCALE_TAILNET ?? undefined;
const brokerUrl = process.env.OPENSCOUT_BROKER_URL ?? buildDefaultBrokerUrl(host, port);
const nodeId = process.env.OPENSCOUT_NODE_ID ?? `${nodeName}-${meshId}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
const seedUrls = (process.env.OPENSCOUT_MESH_SEEDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const configuredCoreAgentIds = (process.env.OPENSCOUT_CORE_AGENTS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const discoveryIntervalMs = Number.parseInt(process.env.OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS ?? "0", 10);
const parentPid = Number.parseInt(process.env.OPENSCOUT_PARENT_PID ?? "0", 10);

ensureOpenScoutCleanSlateSync();

const store = new SQLiteControlPlaneStore(dbPath);
const runtime = createInMemoryControlRuntime(store.loadSnapshot(), { localNodeId: nodeId });
const eventClients = new Set<ServerResponse>();
const activeInvocationTasks = new Map<string, Promise<void>>();
const sseKeepAliveIntervalMs = Number.parseInt(process.env.OPENSCOUT_SSE_KEEPALIVE_MS ?? "15000", 10);
const operatorActorId = "operator";

type LegacyRelayMessage = {
  id: string;
  ts: number;
  from: string;
  type: "MSG" | "SYS";
  body: string;
  tags?: string[];
  to?: string[];
  channel?: string;
};

function streamEvent(event: ControlEvent): void {
  store.recordEvent(event);
  const payload = `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) {
    client.write(payload);
  }
}

function streamKeepAlive(): void {
  if (eventClients.size == 0) {
    return;
  }

  for (const client of eventClients) {
    client.write(": keepalive\n\n");
  }
}

runtime.subscribe((event) => {
  streamEvent(event);
});

if (sseKeepAliveIntervalMs > 0) {
  setInterval(() => {
    streamKeepAlive();
  }, sseKeepAliveIntervalMs).unref();
}

const localNode: NodeDefinition = {
  id: nodeId,
  meshId,
  name: nodeName,
  hostName: hostname(),
  advertiseScope: host === DEFAULT_BROKER_HOST ? "local" : "mesh",
  brokerUrl,
  tailnetName,
  capabilities: ["broker", "mesh", "local_runtime"],
  registeredAt: Date.now(),
  lastSeenAt: Date.now(),
};

await runtime.upsertNode(localNode);
store.upsertNode(localNode);

const systemActor: ActorIdentity = {
  id: "system",
  kind: "system",
  displayName: "System",
  handle: "system",
  labels: ["runtime"],
  metadata: {
    source: "broker",
  },
};

await runtime.upsertActor(systemActor);
store.upsertActor(systemActor);

async function bootstrapRegisteredLocalAgents(): Promise<void> {
  await syncRegisteredLocalAgents();
  await ensureCoreLocalAgentsOnline();
}

async function discoverPeers(seeds: string[] = []): Promise<NodeDefinition[]> {
  const result = await discoverMeshNodes({
    localNodeId: nodeId,
    localBrokerUrl: brokerUrl,
    defaultPort: port,
    meshId,
    seeds: [...seedUrls, ...seeds],
  });

  for (const node of result.discovered) {
    await runtime.upsertNode(node);
    store.upsertNode(node);
  }

  return result.discovered;
}

function currentLocalNode(): NodeDefinition {
  return runtime.snapshot().nodes[nodeId] ?? localNode;
}

async function applyMeshBundle(bundle: {
  originNode: NodeDefinition;
  actors: ActorIdentity[];
  agents: AgentDefinition[];
  conversation?: ConversationDefinition;
  bindings?: ConversationBinding[];
  collaborationRecord?: CollaborationRecord;
  collaborationEvent?: CollaborationEvent;
}): Promise<void> {
  await runtime.upsertNode(bundle.originNode);
  store.upsertNode(bundle.originNode);

  for (const actor of bundle.actors) {
    await runtime.upsertActor(actor);
    store.upsertActor(actor);
  }

  for (const agent of bundle.agents) {
    await runtime.upsertActor(agent);
    await runtime.upsertAgent(agent);
    store.upsertActor(agent);
    store.upsertAgent(agent);
  }

  if (bundle.conversation) {
    await runtime.upsertConversation(bundle.conversation);
    store.upsertConversation(bundle.conversation);
  }

  for (const binding of bundle.bindings ?? []) {
    await runtime.upsertBinding(binding);
    store.upsertBinding(binding);
  }

  if (bundle.collaborationRecord) {
    await runtime.upsertCollaboration(bundle.collaborationRecord);
    store.recordCollaborationRecord(bundle.collaborationRecord);
  }

  if (bundle.collaborationEvent) {
    await runtime.appendCollaborationEvent(bundle.collaborationEvent);
    store.recordCollaborationEvent(bundle.collaborationEvent);
  }
}

async function persistFlight(flight: FlightRecord): Promise<void> {
  await runtime.upsertFlight(flight);
  store.recordFlight(flight);
}

async function persistEndpoint(endpoint: AgentEndpoint): Promise<void> {
  await runtime.upsertEndpoint(endpoint);
  store.upsertEndpoint(endpoint);
}

function isWorkingFlightState(state: FlightRecord["state"]): boolean {
  return state === "queued" || state === "waking" || state === "running" || state === "waiting";
}

function flightTimestamp(flight: FlightRecord): number {
  return flight.completedAt ?? flight.startedAt ?? 0;
}

function endpointStartedAt(endpoint: AgentEndpoint): number {
  const value = endpoint.metadata?.lastStartedAt;
  return typeof value === "number" ? value : 0;
}

function endpointTerminalAt(endpoint: AgentEndpoint): number {
  const completedAt = endpoint.metadata?.lastCompletedAt;
  const failedAt = endpoint.metadata?.lastFailedAt;
  return Math.max(
    typeof completedAt === "number" ? completedAt : 0,
    typeof failedAt === "number" ? failedAt : 0,
  );
}

function latestEndpointForAgent(snapshot: ReturnType<typeof runtime.snapshot>, agentId: string): AgentEndpoint | null {
  const candidates = Object.values(snapshot.endpoints).filter((endpoint) => endpoint.agentId === agentId);
  return [...candidates].sort((left, right) => (
    Math.max(endpointTerminalAt(right), endpointStartedAt(right))
    - Math.max(endpointTerminalAt(left), endpointStartedAt(left))
  ))[0] ?? null;
}

function staleWorkingFlightReason(
  snapshot: ReturnType<typeof runtime.snapshot>,
  flight: FlightRecord,
): string | null {
  if (!isWorkingFlightState(flight.state)) {
    return null;
  }

  const startedAt = flightTimestamp(flight);
  const newerTerminalFlight = Object.values(snapshot.flights)
    .filter((candidate) => (
      candidate.targetAgentId === flight.targetAgentId
      && candidate.id !== flight.id
      && !isWorkingFlightState(candidate.state)
      && flightTimestamp(candidate) > startedAt
    ))
    .sort((left, right) => flightTimestamp(right) - flightTimestamp(left))[0] ?? null;
  if (newerTerminalFlight) {
    return `superseded by newer ${newerTerminalFlight.state} flight ${newerTerminalFlight.id}`;
  }

  const endpoint = latestEndpointForAgent(snapshot, flight.targetAgentId);
  if (!endpoint) {
    return null;
  }

  const terminalAt = endpointTerminalAt(endpoint);
  if (endpoint.state !== "active" && terminalAt > startedAt) {
    return `endpoint ${endpoint.id} moved to ${endpoint.state} at ${terminalAt}`;
  }

  const startedEndpointAt = endpointStartedAt(endpoint);
  if (endpoint.state === "active" && startedEndpointAt > startedAt) {
    return `endpoint ${endpoint.id} started newer work at ${startedEndpointAt}`;
  }

  return null;
}

async function reconcileStaleWorkingFlights(): Promise<void> {
  const snapshot = runtime.snapshot();
  const now = Date.now();

  for (const flight of Object.values(snapshot.flights)) {
    const reason = staleWorkingFlightReason(snapshot, flight);
    if (!reason) {
      continue;
    }

    const agent = snapshot.agents[flight.targetAgentId];
    const reconciledFlight: FlightRecord = {
      ...flight,
      state: "failed",
      summary: `${agent?.displayName ?? flight.targetAgentId} did not finish cleanly.`,
      error: `Stale running flight reconciled: ${reason}`,
      completedAt: now,
      metadata: {
        ...(flight.metadata ?? {}),
        reconciledStaleFlight: true,
        reconciledReason: reason,
        reconciledAt: now,
      },
    };
    await persistFlight(reconciledFlight);
    console.warn(`[openscout-runtime] reconciled stale running flight ${flight.id}: ${reason}`);
  }
}

function localAgentMetadataSource(metadata: Record<string, unknown> | undefined): string | null {
  const source = metadata?.source;
  return typeof source === "string" && source.trim().length > 0 ? source : null;
}

function isGeneratedLocalAgentMetadata(metadata: Record<string, unknown> | undefined): boolean {
  const source = localAgentMetadataSource(metadata);
  return source === "relay-agent-registry" || source === "project-inferred";
}

function staleLocalAgentReplacementId(
  definitionId: string | null,
  activeAgentIdsByDefinition: Map<string, string[]>,
): string | null {
  if (!definitionId) {
    return null;
  }

  const matches = activeAgentIdsByDefinition.get(definitionId) ?? [];
  return matches.length === 1 ? matches[0] ?? null : null;
}

async function archiveStaleRegisteredLocalAgents(bindings: Awaited<ReturnType<typeof loadRegisteredLocalAgentBindings>>): Promise<void> {
  const activeAgentIds = new Set(bindings.map((binding) => binding.agent.id));
  const activeAgentIdsByDefinition = bindings.reduce((map, binding) => {
    const definitionId = binding.agent.definitionId?.trim();
    if (!definitionId) {
      return map;
    }

    const next = map.get(definitionId) ?? [];
    next.push(binding.agent.id);
    map.set(definitionId, next);
    return map;
  }, new Map<string, string[]>());
  const snapshot = runtime.snapshot();
  const staleAt = Date.now();

  for (const endpoint of Object.values(snapshot.endpoints)) {
    if (activeAgentIds.has(endpoint.agentId) || !isGeneratedLocalAgentMetadata(endpoint.metadata)) {
      continue;
    }

    const agent = snapshot.agents[endpoint.agentId];
    const replacementAgentId = staleLocalAgentReplacementId(
      typeof agent?.definitionId === "string" ? agent.definitionId : null,
      activeAgentIdsByDefinition,
    );

    if (endpoint.state === "offline" && endpoint.metadata?.staleLocalRegistration === true) {
      continue;
    }

    await persistEndpoint({
      ...endpoint,
      state: "offline",
      metadata: {
        ...(endpoint.metadata ?? {}),
        staleLocalRegistration: true,
        staleAt,
        replacedByAgentId: replacementAgentId ?? endpoint.metadata?.replacedByAgentId,
        lastError: "stale local agent registration superseded by current setup",
        lastFailedAt: staleAt,
      },
    });
    console.log(`[openscout-runtime] archived stale local endpoint ${endpoint.id}`);
  }

  for (const agent of Object.values(snapshot.agents)) {
    if (activeAgentIds.has(agent.id) || !isGeneratedLocalAgentMetadata(agent.metadata)) {
      continue;
    }

    const replacementAgentId = staleLocalAgentReplacementId(agent.definitionId, activeAgentIdsByDefinition);
    const nextMetadata = {
      ...(agent.metadata ?? {}),
      staleLocalRegistration: true,
      staleAt,
      replacedByAgentId: replacementAgentId ?? agent.metadata?.replacedByAgentId,
    };

    if (agent.metadata?.staleLocalRegistration === true && nextMetadata.replacedByAgentId === agent.metadata?.replacedByAgentId) {
      continue;
    }

    const nextAgent = {
      ...agent,
      metadata: nextMetadata,
    };
    await runtime.upsertAgent(nextAgent);
    store.upsertAgent(nextAgent);
    console.log(`[openscout-runtime] archived stale local agent ${agent.id}`);
  }
}

async function syncRegisteredLocalAgents(): Promise<void> {
  const bindings = await loadRegisteredLocalAgentBindings(nodeId);
  console.log(
    `[openscout-runtime] local agent sync found ${bindings.length} registered agent${bindings.length === 1 ? "" : "s"}`,
  );

  for (const binding of bindings) {
    await runtime.upsertActor(binding.actor);
    await runtime.upsertAgent(binding.agent);
    store.upsertActor(binding.actor);
    store.upsertAgent(binding.agent);
    await persistEndpoint(binding.endpoint);
    console.log(
      `[openscout-runtime] local agent ${binding.agent.id} -> ${binding.endpoint.transport}:${binding.endpoint.sessionId ?? binding.endpoint.id}`,
    );
  }

  await archiveStaleRegisteredLocalAgents(bindings);

  const snapshot = runtime.snapshot();
  for (const endpoint of Object.values(snapshot.endpoints)) {
    if (endpoint.transport === "tmux") {
      const sessionId =
        endpoint.sessionId
        ?? (typeof endpoint.metadata?.tmuxSession === "string" ? String(endpoint.metadata.tmuxSession) : null);
      const sessionAlive = sessionId ? isLocalAgentSessionAlive(sessionId) : false;
      if (!sessionAlive) {
        if (endpoint.state !== "offline") {
          await persistEndpoint({
            ...endpoint,
            state: "offline",
            metadata: {
              ...(endpoint.metadata ?? {}),
              lastError: sessionId ? `tmux session missing: ${sessionId}` : "tmux session missing",
              lastFailedAt: Date.now(),
            },
          });
          console.log(`[openscout-runtime] marked stale tmux endpoint offline ${endpoint.id}`);
        }
        continue;
      }
    }

    if (!shouldDisableGeneratedCodexEndpoint(endpoint)) {
      continue;
    }

    if (endpoint.state === "offline") {
      continue;
    }

    await persistEndpoint({
      ...endpoint,
      state: "offline",
      metadata: {
        ...(endpoint.metadata ?? {}),
        disabledReason: "synthetic_executor_disabled",
      },
    });
    console.log(`[openscout-runtime] disabled synthetic endpoint ${endpoint.id}`);
  }
}

async function ensureCoreLocalAgentsOnline(): Promise<void> {
  const coreBindings = await loadRegisteredLocalAgentBindings(nodeId, {
    ensureOnline: true,
    agentIds: configuredCoreAgentIds.length > 0 ? configuredCoreAgentIds : undefined,
  });

  if (coreBindings.length === 0) {
    console.log("[openscout-runtime] no configured core local agents to warm");
    return;
  }

  console.log(
    `[openscout-runtime] warming ${coreBindings.length} core local agent${coreBindings.length === 1 ? "" : "s"}`,
  );

  for (const binding of coreBindings) {
    await runtime.upsertActor(binding.actor);
    await runtime.upsertAgent(binding.agent);
    store.upsertActor(binding.actor);
    store.upsertAgent(binding.agent);
    await persistEndpoint(binding.endpoint);
    console.log(
      `[openscout-runtime] core local agent ready ${binding.agent.id} -> ${binding.endpoint.transport}:${binding.endpoint.sessionId ?? binding.endpoint.id}`,
    );
  }
}

function messageVisibilityForConversation(conversation?: ConversationDefinition): MessageRecord["visibility"] {
  switch (conversation?.visibility) {
    case "private":
    case "public":
    case "system":
      return conversation.visibility;
    case "workspace":
    default:
      return "workspace";
  }
}

async function postConversationMessage(
  message: MessageRecord,
): Promise<void> {
  const deliveries = await runtime.postMessage(message);
  store.recordMessage(message);
  store.recordDeliveries(deliveries);
  await forwardPeerBrokerDeliveries(message, deliveries);
}

async function postInvocationStatusMessage(
  invocation: InvocationRequest,
  flight: {
    summary?: string;
    error?: string;
  },
): Promise<void> {
  if (!invocation.conversationId) {
    return;
  }

  const snapshot = runtime.snapshot();
  const conversation = snapshot.conversations[invocation.conversationId];
  if (!conversation) {
    return;
  }

  const body = [flight.summary, flight.error]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join("\n");
  if (!body) {
    return;
  }

  await postConversationMessage({
    id: createRuntimeId("msg"),
    conversationId: invocation.conversationId,
    actorId: systemActor.id,
    originNodeId: nodeId,
    class: "status",
    body,
    replyToMessageId: invocation.messageId,
    audience: {
      notify: [invocation.requesterId],
    },
    visibility: messageVisibilityForConversation(conversation),
    policy: "durable",
    createdAt: Date.now(),
    metadata: {
      flightId: invocation.id,
      source: "broker",
      targetAgentId: invocation.targetAgentId,
    },
  });
}

function activeLocalEndpointForAgent(agentId: string, harness?: string): AgentEndpoint | undefined {
  const candidates = Object.values(runtime.snapshot().endpoints).filter((endpoint) => (
    endpoint.agentId === agentId
    && endpoint.nodeId === nodeId
    && endpoint.state !== "offline"
    && (!harness || endpoint.harness === harness)
  ));
  return candidates.find((endpoint) => isLocalAgentEndpointAlive(endpoint));
}

async function resolveLocalEndpointForInvocation(invocation: InvocationRequest): Promise<AgentEndpoint | undefined> {
  const requestedHarness = invocation.execution?.harness;
  const existing = activeLocalEndpointForAgent(invocation.targetAgentId, requestedHarness);
  if (existing) {
    return existing;
  }

  const staleEndpoints = Object.values(runtime.snapshot().endpoints).filter((endpoint) => (
    endpoint.agentId === invocation.targetAgentId
    && endpoint.nodeId === nodeId
    && endpoint.state !== "offline"
    && (!requestedHarness || endpoint.harness === requestedHarness)
  ));

  for (const endpoint of staleEndpoints) {
    await persistEndpoint({
      ...endpoint,
      state: "offline",
      metadata: {
        ...(endpoint.metadata ?? {}),
        lastError: endpoint.transport === "tmux"
          ? `tmux session missing: ${endpoint.sessionId ?? endpoint.id}`
          : `${endpoint.transport} session unavailable: ${endpoint.sessionId ?? endpoint.id}`,
        lastFailedAt: Date.now(),
      },
    });
  }

  if (!invocation.ensureAwake) {
    return undefined;
  }

  const binding = await ensureLocalAgentBindingOnline(invocation.targetAgentId, nodeId, {
    includeDiscovered: true,
    harness: requestedHarness,
  });
  if (!binding) {
    return undefined;
  }

  await runtime.upsertActor(binding.actor);
  await runtime.upsertAgent(binding.agent);
  store.upsertActor(binding.actor);
  store.upsertAgent(binding.agent);
  await persistEndpoint(binding.endpoint);
  return binding.endpoint;
}

async function executeLocalInvocation(
  invocation: InvocationRequest,
  initialFlight: FlightRecord,
): Promise<void> {
  const endpoint = await resolveLocalEndpointForInvocation(invocation);
  const snapshot = runtime.snapshot();
  const agent = snapshot.agents[invocation.targetAgentId];

  if (!agent || !endpoint) {
    const failedFlight = {
      ...initialFlight,
      state: "failed" as const,
      summary: `${agent?.displayName ?? invocation.targetAgentId} is not runnable yet.`,
      error: `No runnable endpoint is registered for agent ${invocation.targetAgentId}.`,
      completedAt: Date.now(),
    };
    await persistFlight(failedFlight);
    await postInvocationStatusMessage(invocation, failedFlight);
    return;
  }

  if (
    endpoint.transport !== "tmux"
    && endpoint.transport !== "codex_app_server"
    && endpoint.transport !== "claude_stream_json"
  ) {
    const failedFlight = {
      ...initialFlight,
      state: "failed" as const,
      summary: `${agent.displayName} has no supported local executor.`,
      error: `Endpoint transport ${endpoint.transport} is registered for ${agent.id}, but the broker only routes through direct local session adapters.`,
      completedAt: Date.now(),
    };
    await persistFlight(failedFlight);
    await postInvocationStatusMessage(invocation, failedFlight);
    return;
  }

  const runningEndpoint: AgentEndpoint = {
    ...endpoint,
    state: "active",
    metadata: {
      ...(endpoint.metadata ?? {}),
      lastInvocationId: invocation.id,
      lastStartedAt: Date.now(),
    },
  };
  await persistEndpoint(runningEndpoint);

  const runningFlight = {
    ...initialFlight,
    state: "running" as const,
    summary: `${agent.displayName} is working.`,
    error: undefined,
    completedAt: undefined,
  };
  await persistFlight(runningFlight);
  await postInvocationStatusMessage(invocation, runningFlight);

  try {
    const result = await invokeLocalAgentEndpoint(runningEndpoint, invocation);

    const completedFlight = {
      ...runningFlight,
      state: "completed" as const,
      summary: `${agent.displayName} replied.`,
      output: result.output,
      completedAt: Date.now(),
    };
    await persistFlight(completedFlight);

    await persistEndpoint({
      ...runningEndpoint,
      state: "idle",
      metadata: {
        ...(runningEndpoint.metadata ?? {}),
        lastCompletedAt: Date.now(),
      },
    });

    if (invocation.conversationId) {
      const conversation = runtime.snapshot().conversations[invocation.conversationId];
      if (conversation) {
        await postConversationMessage({
          id: createRuntimeId("msg"),
          conversationId: invocation.conversationId,
          actorId: agent.id,
          originNodeId: nodeId,
          class: "agent",
          body: result.output,
          replyToMessageId: invocation.messageId,
          audience: {
            notify: [invocation.requesterId],
          },
          visibility: messageVisibilityForConversation(conversation),
          policy: "durable",
          createdAt: Date.now(),
          metadata: {
            invocationId: invocation.id,
            flightId: completedFlight.id,
            source: "broker",
            returnAddress: buildRelayReturnAddress({
              actorId: agent.id,
              handle: agent.handle?.trim() || agent.definitionId,
              displayName: agent.displayName,
              selector: agent.selector,
              defaultSelector: agent.defaultSelector,
              conversationId: invocation.conversationId,
              replyToMessageId: invocation.messageId,
              nodeId: runningEndpoint.nodeId,
              projectRoot: runningEndpoint.projectRoot ?? runningEndpoint.cwd,
              sessionId: runningEndpoint.sessionId,
            }),
            requestedReturnAddress: invocation.metadata?.["returnAddress"],
            responderHarness: runningEndpoint.harness,
            responderTransport: runningEndpoint.transport,
            responderSessionId: runningEndpoint.sessionId ?? "",
            responderCwd: runningEndpoint.cwd ?? "",
            responderProjectRoot: runningEndpoint.projectRoot ?? "",
            responderAgentName: String(runningEndpoint.metadata?.agentName ?? agent.id),
            responderStartedAt: String(runningEndpoint.metadata?.startedAt ?? ""),
            responderNodeId: runningEndpoint.nodeId,
          },
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedFlight = {
      ...runningFlight,
      state: "failed" as const,
      summary: `${agent.displayName} failed to respond.`,
      error: message,
      completedAt: Date.now(),
    };
    await persistFlight(failedFlight);

    await persistEndpoint({
      ...runningEndpoint,
      state: "degraded",
      metadata: {
        ...(runningEndpoint.metadata ?? {}),
        lastError: message,
        lastFailedAt: Date.now(),
      },
    });

    await postInvocationStatusMessage(invocation, failedFlight);
  }
}

function launchLocalInvocation(
  invocation: InvocationRequest,
  initialFlight: FlightRecord,
): void {
  if (activeInvocationTasks.has(invocation.id)) {
    return;
  }

  const task = executeLocalInvocation(invocation, initialFlight)
    .catch((error) => {
      console.error(`[openscout-runtime] local invocation ${invocation.id} crashed:`, error);
    })
    .finally(() => {
      activeInvocationTasks.delete(invocation.id);
    });
  activeInvocationTasks.set(invocation.id, task);
}

async function forwardPeerBrokerDeliveries(
  message: MessageRecord,
  deliveries: DeliveryIntent[],
): Promise<{ forwarded: string[]; failed: string[] }> {
  const snapshot = runtime.snapshot();
  const conversation = snapshot.conversations[message.conversationId];
  if (!conversation || conversation.shareMode === "local") {
    return { forwarded: [], failed: [] };
  }

  const targetNodeIds = [...new Set(
    deliveries
      .filter((delivery) => delivery.transport === "peer_broker" && delivery.targetNodeId)
      .map((delivery) => delivery.targetNodeId as string),
  )];
  const originNode = currentLocalNode();
  const forwarded: string[] = [];
  const failed: string[] = [];

  for (const targetNodeId of targetNodeIds) {
    const targetNode = snapshot.nodes[targetNodeId];
    if (!targetNode?.brokerUrl) {
      failed.push(targetNodeId);
      continue;
    }

    try {
      const bundle = buildMeshMessageBundle(snapshot, originNode, message);
      await forwardMeshMessage(targetNode.brokerUrl, bundle);
      forwarded.push(targetNodeId);
    } catch {
      failed.push(targetNodeId);
    }
  }

  return { forwarded, failed };
}

function actorIdsForCollaboration(
  record: CollaborationRecord,
  conversation?: ConversationDefinition,
): string[] {
  const ids = new Set<string>();

  ids.add(record.createdById);
  if (record.ownerId) ids.add(record.ownerId);
  if (record.nextMoveOwnerId) ids.add(record.nextMoveOwnerId);

  if (record.kind === "question") {
    if (record.askedById) ids.add(record.askedById);
    if (record.askedOfId) ids.add(record.askedOfId);
  } else {
    if (record.requestedById) ids.add(record.requestedById);
    if (record.waitingOn?.kind === "actor" && record.waitingOn.targetId) {
      ids.add(record.waitingOn.targetId);
    }
  }

  for (const participantId of conversation?.participantIds ?? []) {
    ids.add(participantId);
  }

  return [...ids];
}

async function forwardPeerBrokerCollaborationRecord(
  record: CollaborationRecord,
): Promise<{ forwarded: string[]; failed: string[] }> {
  const snapshot = runtime.snapshot();
  const conversation = record.conversationId
    ? snapshot.conversations[record.conversationId]
    : undefined;
  if (!conversation || conversation.shareMode === "local") {
    return { forwarded: [], failed: [] };
  }

  const actorIds = actorIdsForCollaboration(record, conversation);
  const targetNodeIds = [...new Set(
    actorIds
      .map((actorId) => snapshot.agents[actorId]?.authorityNodeId)
      .filter((id): id is string => Boolean(id && id !== nodeId)),
  )];
  const originNode = currentLocalNode();
  const forwarded: string[] = [];
  const failed: string[] = [];

  for (const targetNodeId of targetNodeIds) {
    const targetNode = snapshot.nodes[targetNodeId];
    if (!targetNode?.brokerUrl) {
      failed.push(targetNodeId);
      continue;
    }

    try {
      const bundle = buildMeshCollaborationRecordBundle(snapshot, originNode, record);
      await forwardMeshCollaborationRecord(targetNode.brokerUrl, bundle);
      forwarded.push(targetNodeId);
    } catch {
      failed.push(targetNodeId);
    }
  }

  return { forwarded, failed };
}

async function forwardPeerBrokerCollaborationEvent(
  event: CollaborationEvent,
): Promise<{ forwarded: string[]; failed: string[] }> {
  const snapshot = runtime.snapshot();
  const record = snapshot.collaborationRecords[event.recordId];
  if (!record) {
    return { forwarded: [], failed: [] };
  }
  const conversation = record.conversationId
    ? snapshot.conversations[record.conversationId]
    : undefined;
  if (!conversation || conversation.shareMode === "local") {
    return { forwarded: [], failed: [] };
  }

  const actorIds = actorIdsForCollaboration(record, conversation);
  const targetNodeIds = [...new Set(
    actorIds
      .map((actorId) => snapshot.agents[actorId]?.authorityNodeId)
      .filter((id): id is string => Boolean(id && id !== nodeId)),
  )];
  const originNode = currentLocalNode();
  const forwarded: string[] = [];
  const failed: string[] = [];

  for (const targetNodeId of targetNodeIds) {
    const targetNode = snapshot.nodes[targetNodeId];
    if (!targetNode?.brokerUrl) {
      failed.push(targetNodeId);
      continue;
    }

    try {
      const bundle = buildMeshCollaborationEventBundle(snapshot, originNode, event, record);
      await forwardMeshCollaborationEvent(targetNode.brokerUrl, bundle);
      forwarded.push(targetNodeId);
    } catch {
      failed.push(targetNodeId);
    }
  }

  return { forwarded, failed };
}

async function maybeForwardInvocation(
  invocation: InvocationRequest,
): Promise<{ forwarded: boolean; flight?: { id: string; invocationId: string; requesterId: string; targetAgentId: string; state: string; startedAt?: number; completedAt?: number; summary?: string; output?: string; error?: string; metadata?: Record<string, unknown> } }> {
  const snapshot = runtime.snapshot();
  const targetAgent = snapshot.agents[invocation.targetAgentId];
  if (!targetAgent) {
    throw new Error(`unknown agent ${invocation.targetAgentId}`);
  }

  if (targetAgent.authorityNodeId === nodeId) {
    return { forwarded: false };
  }

  const authorityNode = snapshot.nodes[targetAgent.authorityNodeId];
  if (!authorityNode?.brokerUrl) {
    throw new Error(`authority node ${targetAgent.authorityNodeId} is not reachable`);
  }

  const bundle = buildMeshInvocationBundle(snapshot, currentLocalNode(), invocation);
  const result = await forwardMeshInvocation(authorityNode.brokerUrl, bundle);
  await runtime.upsertFlight(result.flight);
  store.recordInvocation(invocation);
  store.recordFlight(result.flight);
  return { forwarded: true, flight: result.flight };
}

function parseLimit(url: URL): number {
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  if (!Number.isFinite(limit) || limit <= 0) return 100;
  return Math.min(limit, 500);
}

function parseSince(url: URL): number | null {
  const since = Number.parseInt(url.searchParams.get("since") ?? "", 10);
  if (!Number.isFinite(since) || since <= 0) {
    return null;
  }
  return since;
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "EADDRINUSE",
  );
}

async function probeExistingBroker() {
  const healthUrl = `${brokerUrl}/health`;
  const nodeUrl = `${brokerUrl}/v1/node`;

  try {
    const [healthResponse, nodeResponse] = await Promise.all([
      fetch(healthUrl, { headers: { accept: "application/json" } }),
      fetch(nodeUrl, { headers: { accept: "application/json" } }),
    ]);

    if (!healthResponse.ok || !nodeResponse.ok) {
      return null;
    }

    const health = await healthResponse.json() as {
      ok?: boolean;
      nodeId?: string;
      meshId?: string;
    };
    const node = await nodeResponse.json() as NodeDefinition;

    if (!health.ok || !node.id) {
      return null;
    }

    return {
      nodeId: node.id,
      meshId: node.meshId ?? health.meshId,
      brokerUrl: node.brokerUrl ?? brokerUrl,
    };
  } catch {
    return null;
  }
}

async function listen(serverInstance: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: unknown) => {
      serverInstance.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      serverInstance.off("error", handleError);
      resolve();
    };

    serverInstance.once("error", handleError);
    serverInstance.once("listening", handleListening);
    serverInstance.listen(port, host);
  });
}

async function handleCommand(command: ControlCommand): Promise<unknown> {
  switch (command.kind) {
    case "node.upsert":
      await runtime.upsertNode(command.node);
      store.upsertNode(command.node);
      return { ok: true };
    case "actor.upsert":
      await runtime.upsertActor(command.actor);
      store.upsertActor(command.actor);
      return { ok: true };
    case "agent.upsert":
      await runtime.upsertActor(command.agent);
      await runtime.upsertAgent(command.agent);
      store.upsertActor(command.agent);
      store.upsertAgent(command.agent);
      return { ok: true };
    case "agent.endpoint.upsert":
      await runtime.upsertEndpoint(command.endpoint);
      store.upsertEndpoint(command.endpoint);
      return { ok: true };
    case "conversation.upsert":
      await runtime.upsertConversation(command.conversation);
      store.upsertConversation(command.conversation);
      return { ok: true };
    case "binding.upsert":
      await runtime.upsertBinding(command.binding);
      store.upsertBinding(command.binding);
      return { ok: true };
    case "collaboration.upsert":
      await runtime.upsertCollaboration(command.record);
      store.recordCollaborationRecord(command.record);
      return {
        ok: true,
        recordId: command.record.id,
        mesh: await forwardPeerBrokerCollaborationRecord(command.record),
      };
    case "collaboration.event.append":
      await runtime.appendCollaborationEvent(command.event);
      store.recordCollaborationEvent(command.event);
      return {
        ok: true,
        eventId: command.event.id,
        mesh: await forwardPeerBrokerCollaborationEvent(command.event),
      };
    case "conversation.post": {
      const deliveries = await runtime.postMessage(command.message);
      store.recordMessage(command.message);
      store.recordDeliveries(deliveries);
      const mesh = await forwardPeerBrokerDeliveries(command.message, deliveries);
      console.log(
        `[openscout-runtime] message ${command.message.id} posted by ${command.message.actorId} to ${command.message.conversationId} with ${deliveries.length} deliveries`,
      );
      return { ok: true, message: command.message, deliveries, mesh };
    }
    case "agent.invoke": {
      const forwarded = await maybeForwardInvocation(command.invocation);
      if (forwarded.forwarded) {
        console.log(
          `[openscout-runtime] invocation ${command.invocation.id} forwarded to ${command.invocation.targetAgentId}`,
        );
        return { ok: true, flight: forwarded.flight, forwarded: true };
      }
      const flight = await runtime.invokeAgent(command.invocation);
      store.recordInvocation(command.invocation);
      store.recordFlight(flight);
      console.log(
        `[openscout-runtime] invocation ${command.invocation.id} -> ${command.invocation.targetAgentId} is ${flight.state}${flight.summary ? ` (${flight.summary})` : ""}`,
      );
      if (flight.state === "failed") {
        await postInvocationStatusMessage(command.invocation, flight);
      } else {
        launchLocalInvocation(command.invocation, flight);
      }
      return { ok: true, flight };
    }
    case "agent.ensure_awake":
      await runtime.dispatch(command);
      return { ok: true };
    case "stream.subscribe":
      return { ok: true };
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  const collaborationInvokeMatch = method === "POST"
    ? url.pathname.match(/^\/v1\/collaboration\/records\/([^/]+)\/invoke$/)
    : null;

  if (method === "GET" && url.pathname === "/health") {
    const snapshot = runtime.snapshot();
    json(response, 200, {
      ok: true,
      nodeId,
      meshId,
      counts: {
        nodes: Object.keys(snapshot.nodes).length,
        actors: Object.keys(snapshot.actors).length,
        agents: Object.keys(snapshot.agents).length,
        conversations: Object.keys(snapshot.conversations).length,
        messages: Object.keys(snapshot.messages).length,
        flights: Object.keys(snapshot.flights).length,
        collaborationRecords: Object.keys(snapshot.collaborationRecords).length,
      },
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/node") {
    json(response, 200, localNode);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/snapshot") {
    json(response, 200, runtime.snapshot());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/messages") {
    const snapshot = runtime.snapshot();
    const conversationId = url.searchParams.get("conversationId")?.trim();
    const since = parseSince(url);
    const limit = parseLimit(url);
    const messages = Object.values(snapshot.messages)
      .filter((message) => !conversationId || message.conversationId === conversationId)
      .filter((message) => since === null || message.createdAt >= since)
      .sort((lhs, rhs) => rhs.createdAt - lhs.createdAt)
      .slice(0, limit)
      .reverse();
    json(response, 200, messages);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/events") {
    json(response, 200, store.recentEvents(parseLimit(url)));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/activity") {
    const agentId = url.searchParams.get("agentId") ?? undefined;
    const actorId = url.searchParams.get("actorId") ?? undefined;
    const conversationId = url.searchParams.get("conversationId") ?? undefined;
    json(response, 200, store.listActivityItems({
      limit: parseLimit(url),
      agentId,
      actorId,
      conversationId,
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/collaboration/records") {
    const kind = url.searchParams.get("kind") ?? undefined;
    const state = url.searchParams.get("state") ?? undefined;
    const ownerId = url.searchParams.get("ownerId") ?? undefined;
    const nextMoveOwnerId = url.searchParams.get("nextMoveOwnerId") ?? undefined;
    const records = store.listCollaborationRecords({
      limit: parseLimit(url),
      kind: kind as CollaborationRecord["kind"] | undefined,
      state: state ?? undefined,
      ownerId: ownerId ?? undefined,
      nextMoveOwnerId: nextMoveOwnerId ?? undefined,
    });
    json(response, 200, records);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/collaboration/events") {
    const recordId = url.searchParams.get("recordId") ?? undefined;
    const events = store.listCollaborationEvents({
      limit: parseLimit(url),
      recordId: recordId ?? undefined,
    });
    json(response, 200, events);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/deliveries") {
    const transport = url.searchParams.get("transport") ?? undefined;
    const statusFilter = url.searchParams.get("status") ?? undefined;
    json(response, 200, store.listDeliveries({
      limit: parseLimit(url),
      transport: transport as DeliveryIntent["transport"] | undefined,
      status: statusFilter as DeliveryIntent["status"] | undefined,
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/delivery-attempts") {
    const deliveryId = url.searchParams.get("deliveryId")?.trim();
    if (!deliveryId) {
      badRequest(response, new Error("deliveryId is required"));
      return;
    }
    json(response, 200, store.listDeliveryAttempts(deliveryId));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/mesh/nodes") {
    json(response, 200, runtime.snapshot().nodes);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/events/stream") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    response.write(`event: hello\ndata: ${JSON.stringify({ nodeId, meshId })}\n\n`);
    eventClients.add(response);
    request.on("close", () => {
      eventClients.delete(response);
      response.end();
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/commands") {
    try {
      const command = await readRequestBody<ControlCommand>(request);
      const result = await handleCommand(command);
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/discover") {
    try {
      const body = await readRequestBody<{ seeds?: string[] }>(request);
      const discovered = await discoverPeers(body.seeds ?? []);
      json(response, 200, {
        ok: true,
        discovered,
      });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/messages") {
    try {
      const bundle = await readRequestBody<MeshMessageBundle>(request);
      await applyMeshBundle(bundle);

      if (runtime.snapshot().messages[bundle.message.id]) {
        json(response, 200, { ok: true, duplicate: true });
        return;
      }

      const deliveries = await runtime.postMessage(bundle.message, { localOnly: true });
      store.recordMessage(bundle.message);
      store.recordDeliveries(deliveries);
      json(response, 200, { ok: true, deliveries });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/invocations") {
    try {
      const bundle = await readRequestBody<MeshInvocationBundle>(request);
      await applyMeshBundle(bundle);

      const targetAgent = runtime.snapshot().agents[bundle.invocation.targetAgentId];
      if (!targetAgent) {
        throw new Error(`unknown target agent ${bundle.invocation.targetAgentId}`);
      }
      if (targetAgent.authorityNodeId !== nodeId) {
        json(response, 409, {
          error: "not_authority",
          detail: `agent ${targetAgent.id} is owned by ${targetAgent.authorityNodeId}`,
        });
        return;
      }

      const existing = Object.values(runtime.snapshot().flights)
        .find((flight) => flight.invocationId === bundle.invocation.id);
      if (existing) {
        json(response, 200, { ok: true, duplicate: true, flight: existing });
        return;
      }

      const flight = await runtime.invokeAgent(bundle.invocation);
      store.recordInvocation(bundle.invocation);
      store.recordFlight(flight);
      json(response, 200, { ok: true, flight });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/collaboration/records") {
    try {
      const bundle = await readRequestBody<MeshCollaborationRecordBundle>(request);
      const existing = runtime.snapshot().collaborationRecords[bundle.record.id];
      await applyMeshBundle(bundle);
      json(response, 200, existing ? { ok: true, duplicate: true } : { ok: true });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/collaboration/events") {
    try {
      const bundle = await readRequestBody<MeshCollaborationEventBundle>(request);
      await applyMeshBundle(bundle);
      json(response, 200, { ok: true });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/nodes") {
    try {
      const node = await readRequestBody<NodeDefinition>(request);
      await handleCommand({ kind: "node.upsert", node });
      json(response, 200, { ok: true, nodeId: node.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/actors") {
    try {
      const actor = await readRequestBody<ActorIdentity>(request);
      await handleCommand({ kind: "actor.upsert", actor });
      json(response, 200, { ok: true, actorId: actor.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/agents") {
    try {
      const agent = await readRequestBody<AgentDefinition>(request);
      await handleCommand({ kind: "agent.upsert", agent });
      json(response, 200, { ok: true, agentId: agent.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/endpoints") {
    try {
      const endpoint = await readRequestBody<AgentEndpoint>(request);
      await handleCommand({ kind: "agent.endpoint.upsert", endpoint });
      json(response, 200, { ok: true, endpointId: endpoint.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/conversations") {
    try {
      const conversation = await readRequestBody<ConversationDefinition>(request);
      await handleCommand({ kind: "conversation.upsert", conversation });
      json(response, 200, { ok: true, conversationId: conversation.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/bindings") {
    try {
      const binding = await readRequestBody<ConversationBinding>(request);
      await handleCommand({ kind: "binding.upsert", binding });
      json(response, 200, { ok: true, bindingId: binding.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/collaboration/records") {
    try {
      const record = await readRequestBody<CollaborationRecord>(request);
      const result = await handleCommand({ kind: "collaboration.upsert", record });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/collaboration/events") {
    try {
      const event = await readRequestBody<CollaborationEvent>(request);
      const result = await handleCommand({ kind: "collaboration.event.append", event });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (collaborationInvokeMatch) {
    try {
      const recordId = decodeURIComponent(collaborationInvokeMatch[1] ?? "");
      const record = runtime.snapshot().collaborationRecords[recordId];
      if (!record) {
        throw new Error(`unknown collaboration record: ${recordId}`);
      }

      const body = await readRequestBody<{
        requesterId?: string;
        requesterNodeId?: string;
        targetAgentId?: string;
        action?: InvocationRequest["action"];
        task?: string;
        messageId?: string;
        ensureAwake?: boolean;
        stream?: boolean;
        timeoutMs?: number;
        metadata?: Record<string, unknown>;
      }>(request);

      const invocation = buildCollaborationInvocation(record, {
        requesterId: body.requesterId?.trim() || operatorActorId,
        requesterNodeId: body.requesterNodeId?.trim() || nodeId,
        targetAgentId: body.targetAgentId?.trim() || undefined,
        action: body.action,
        task: body.task,
        messageId: body.messageId,
        ensureAwake: body.ensureAwake,
        stream: body.stream,
        timeoutMs: body.timeoutMs,
        metadata: body.metadata,
      });

      const result = await handleCommand({
        kind: "agent.invoke",
        invocation,
      });
      json(response, 200, {
        ...(result as Record<string, unknown>),
        recordId,
        targetAgentId: invocation.targetAgentId,
        wakeReason: invocation.wakeReason,
        invocation,
      });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/delivery-attempts") {
    try {
      const attempt = await readRequestBody<{
        id: string;
        deliveryId: string;
        attempt: number;
        status: "sent" | "acknowledged" | "failed";
        error?: string;
        externalRef?: string;
        createdAt: number;
        metadata?: Record<string, unknown>;
      }>(request);
      store.recordDeliveryAttempt({
        id: attempt.id,
        deliveryId: attempt.deliveryId,
        attempt: attempt.attempt,
        status: attempt.status,
        error: attempt.error,
        externalRef: attempt.externalRef,
        createdAt: attempt.createdAt,
        metadata: attempt.metadata,
      });
      json(response, 200, { ok: true, deliveryId: attempt.deliveryId, attemptId: attempt.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/deliveries/status") {
    try {
      const body = await readRequestBody<{
        deliveryId: string;
        status: DeliveryIntent["status"];
        metadata?: Record<string, unknown>;
        leaseOwner?: string | null;
        leaseExpiresAt?: number | null;
      }>(request);
      store.updateDeliveryStatus(body.deliveryId, body.status, {
        metadata: body.metadata,
        leaseOwner: body.leaseOwner,
        leaseExpiresAt: body.leaseExpiresAt,
      });
      json(response, 200, { ok: true, deliveryId: body.deliveryId, status: body.status });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/messages") {
    try {
      const message = await readRequestBody<MessageRecord>(request);
      const result = await handleCommand({ kind: "conversation.post", message });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/invocations") {
    try {
      const invocation = await readRequestBody<InvocationRequest>(request);
      const result = await handleCommand({ kind: "agent.invoke", invocation });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  notFound(response);
}

const server = createServer((request, response) => {
  routeRequest(request, response).catch((error) => {
    json(response, 500, {
      error: "internal_error",
      detail: error instanceof Error ? error.message : String(error),
    });
  });
});

try {
  await listen(server);
  console.log(`[openscout-runtime] broker listening on ${brokerUrl}`);
  console.log(`[openscout-runtime] node ${nodeId} in mesh ${meshId}`);
  console.log(`[openscout-runtime] sqlite ${dbPath}`);
} catch (error) {
  if (isAddressInUse(error)) {
    const existing = await probeExistingBroker();
    if (existing) {
      console.log(`[openscout-runtime] broker already running on ${brokerUrl}`);
      console.log(`[openscout-runtime] node ${existing.nodeId} in mesh ${existing.meshId ?? "unknown"}`);
      process.exit(0);
    }

    console.error(`[openscout-runtime] port ${port} is already in use by another process on ${host}`);
    process.exit(1);
  }

  throw error;
}

setTimeout(() => {
  bootstrapRegisteredLocalAgents().catch((error) => {
    console.error("[openscout-runtime] local agent bootstrap failed:", error);
  });
  reconcileStaleWorkingFlights().catch((error) => {
    console.error("[openscout-runtime] stale flight reconciliation failed:", error);
  });
}, 0).unref();

if (seedUrls.length > 0) {
  discoverPeers().catch((error) => {
    console.error("[openscout-runtime] initial mesh discovery failed:", error);
  });
}

if (Number.isFinite(discoveryIntervalMs) && discoveryIntervalMs > 0) {
  setInterval(() => {
    discoverPeers().catch((error) => {
      console.error("[openscout-runtime] periodic mesh discovery failed:", error);
    });
  }, discoveryIntervalMs).unref();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const client of eventClients) {
      client.end();
    }
    store.close();
    server.close(() => process.exit(0));
  });
}

if (Number.isFinite(parentPid) && parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      console.log(`[openscout-runtime] parent ${parentPid} is gone, exiting broker`);
      for (const client of eventClients) {
        client.end();
      }
      store.close();
      server.close(() => process.exit(0));
    }
  }, 2_000).unref();
}
