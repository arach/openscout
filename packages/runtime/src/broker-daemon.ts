import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  ControlCommand,
  ControlEvent,
  ConversationBinding,
  ConversationDefinition,
  DeliveryIntent,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
  NodeDefinition,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
import { discoverMeshNodes } from "./mesh-discovery.js";
import {
  buildMeshInvocationBundle,
  buildMeshMessageBundle,
  forwardMeshInvocation,
  forwardMeshMessage,
  type MeshInvocationBundle,
  type MeshMessageBundle,
} from "./mesh-forwarding.js";
import {
  invokeProjectTwinEndpoint,
  loadRegisteredProjectTwinBindings,
  shouldDisableGeneratedCodexEndpoint,
} from "./project-twins.js";
import { SQLiteControlPlaneStore } from "./sqlite-store.js";

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
const port = Number.parseInt(process.env.OPENSCOUT_BROKER_PORT ?? "65535", 10);
const host = process.env.OPENSCOUT_BROKER_HOST ?? "127.0.0.1";
const meshId = process.env.OPENSCOUT_MESH_ID ?? "openscout";
const nodeName = process.env.OPENSCOUT_NODE_NAME ?? hostname();
const tailnetName = process.env.TAILSCALE_TAILNET ?? undefined;
const brokerUrl = process.env.OPENSCOUT_BROKER_URL ?? `http://${host}:${port}`;
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

const store = new SQLiteControlPlaneStore(dbPath);
const runtime = createInMemoryControlRuntime(store.loadSnapshot(), { localNodeId: nodeId });
const eventClients = new Set<ServerResponse>();
const activeInvocationTasks = new Map<string, Promise<void>>();
const sseKeepAliveIntervalMs = Number.parseInt(process.env.OPENSCOUT_SSE_KEEPALIVE_MS ?? "15000", 10);
const legacyRelayHub = join(process.env.HOME ?? process.cwd(), ".openscout", "relay");
const legacyRelayChannelPath = join(legacyRelayHub, "channel.jsonl");
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
  advertiseScope: host === "127.0.0.1" ? "local" : "mesh",
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

async function bootstrapRegisteredProjectTwins(): Promise<void> {
  await syncRegisteredProjectTwins();
  await importLegacyRelayBacklog();
  await ensureCoreProjectTwinsOnline();
}

function titleCaseIdentity(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function importedRelayConversationDefinition(
  senderId: string,
  mentionTargets: string[],
  entry: LegacyRelayMessage,
): ConversationDefinition {
  const normalizedChannel = entry.channel?.trim() || (entry.type === "SYS" ? "system" : "shared");
  const participants = Array.from(new Set([
    operatorActorId,
    senderId,
    ...mentionTargets,
  ])).sort();

  if (normalizedChannel === "system") {
    return {
      id: "channel.system",
      kind: "system",
      title: "system",
      visibility: "system",
      shareMode: "local",
      authorityNodeId: nodeId,
      participantIds: participants,
      metadata: {
        surface: "relay-import",
        channel: "system",
        legacyRelay: true,
      },
    };
  }

  if (normalizedChannel === "voice") {
    return {
      id: "channel.voice",
      kind: "channel",
      title: "voice",
      visibility: "workspace",
      shareMode: "local",
      authorityNodeId: nodeId,
      participantIds: participants,
      metadata: {
        surface: "relay-import",
        channel: "voice",
        legacyRelay: true,
      },
    };
  }

  if (normalizedChannel === "shared") {
    return {
      id: "channel.shared",
      kind: "channel",
      title: "shared-channel",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: nodeId,
      participantIds: participants,
      metadata: {
        surface: "relay-import",
        channel: "shared",
        legacyRelay: true,
      },
    };
  }

  return {
    id: `channel.${normalizedChannel.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "shared"}`,
    kind: "channel",
    title: normalizedChannel,
    visibility: "workspace",
    shareMode: "local",
    authorityNodeId: nodeId,
    participantIds: participants,
    metadata: {
      surface: "relay-import",
      channel: normalizedChannel,
      legacyRelay: true,
    },
  };
}

async function ensureImportedRelayActor(actorId: string): Promise<void> {
  const snapshot = runtime.snapshot();
  if (snapshot.actors[actorId] || snapshot.agents[actorId]) {
    return;
  }

  const actor: ActorIdentity = {
    id: actorId,
    kind: actorId === operatorActorId ? "person" : "agent",
    displayName: titleCaseIdentity(actorId),
    handle: actorId,
    labels: ["relay", "imported"],
    metadata: {
      source: "relay-legacy-import",
    },
  };

  await handleCommand({ kind: "actor.upsert", actor });
}

async function ensureImportedRelayConversation(conversation: ConversationDefinition): Promise<ConversationDefinition> {
  const existing = runtime.snapshot().conversations[conversation.id];
  if (!existing) {
    await handleCommand({ kind: "conversation.upsert", conversation });
    return conversation;
  }

  const participantIds = Array.from(new Set([
    ...existing.participantIds,
    ...conversation.participantIds,
  ])).sort();

  if (participantIds.length === existing.participantIds.length) {
    return existing;
  }

  const nextConversation: ConversationDefinition = {
    ...existing,
    participantIds,
    metadata: {
      ...(existing.metadata ?? {}),
      legacyRelay: true,
    },
  };
  await handleCommand({ kind: "conversation.upsert", conversation: nextConversation });
  return nextConversation;
}

async function importLegacyRelayBacklog(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(legacyRelayChannelPath, "utf8");
  } catch {
    return;
  }

  const entries = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LegacyRelayMessage;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is LegacyRelayMessage => Boolean(entry?.id && entry?.from && entry?.type));

  if (entries.length === 0) {
    return;
  }

  const snapshot = runtime.snapshot();
  const existingMessageIds = new Set(Object.keys(snapshot.messages));
  const latestBrokerCreatedAt = Object.values(snapshot.messages).reduce(
    (latest, message) => Math.max(latest, message.createdAt),
    0,
  );
  const pending = entries.filter((entry) => (
    !existingMessageIds.has(entry.id)
    && entry.ts * 1000 > latestBrokerCreatedAt
  ));

  if (pending.length === 0) {
    return;
  }

  console.log(
    `[openscout-runtime] importing ${pending.length} legacy relay message${pending.length === 1 ? "" : "s"} into broker`,
  );

  for (const entry of pending.sort((lhs, rhs) => lhs.ts - rhs.ts)) {
    const mentionTargets = Array.from(new Set([
      ...(entry.to ?? []),
      ...Array.from(entry.body.matchAll(/@([\w.-]+)/g)).map((match) => match[1]).filter(Boolean),
    ])).filter((actorId) => actorId !== entry.from);

    await ensureImportedRelayActor(entry.from);
    for (const actorId of mentionTargets) {
      await ensureImportedRelayActor(actorId);
    }

    const conversation = await ensureImportedRelayConversation(
      importedRelayConversationDefinition(entry.from, mentionTargets, entry),
    );

    await handleCommand({
      kind: "conversation.post",
      message: {
        id: entry.id,
        conversationId: conversation.id,
        actorId: entry.from,
        originNodeId: nodeId,
        class: entry.type === "SYS" ? "system" : "agent",
        body: entry.body,
        mentions: mentionTargets.map((actorId) => ({ actorId, label: `@${actorId}` })),
        speech: entry.tags?.includes("speak")
          ? {
            text: entry.body.replace(/@[\w.-]+\s*/g, "").trim(),
          }
          : undefined,
        visibility: messageVisibilityForConversation(conversation),
        policy: "durable",
        createdAt: entry.ts * 1000,
        metadata: {
          source: "relay-legacy-import",
          relayChannel: entry.channel ?? (entry.type === "SYS" ? "system" : "shared"),
          legacyRelayMessageId: entry.id,
          legacyRelay: true,
        },
      },
    });
  }
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
}

async function persistFlight(flight: FlightRecord): Promise<void> {
  await runtime.upsertFlight(flight);
  store.recordFlight(flight);
}

async function persistEndpoint(endpoint: AgentEndpoint): Promise<void> {
  await runtime.upsertEndpoint(endpoint);
  store.upsertEndpoint(endpoint);
}

async function syncRegisteredProjectTwins(): Promise<void> {
  const bindings = await loadRegisteredProjectTwinBindings(nodeId);
  console.log(
    `[openscout-runtime] project twin sync found ${bindings.length} registered twin${bindings.length === 1 ? "" : "s"}`,
  );

  for (const binding of bindings) {
    await runtime.upsertActor(binding.actor);
    await runtime.upsertAgent(binding.agent);
    store.upsertActor(binding.actor);
    store.upsertAgent(binding.agent);
    await persistEndpoint(binding.endpoint);
    console.log(
      `[openscout-runtime] project twin ${binding.agent.id} -> ${binding.endpoint.transport}:${binding.endpoint.sessionId ?? binding.endpoint.id}`,
    );
  }

  const snapshot = runtime.snapshot();
  for (const endpoint of Object.values(snapshot.endpoints)) {
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

async function ensureCoreProjectTwinsOnline(): Promise<void> {
  const coreBindings = await loadRegisteredProjectTwinBindings(nodeId, {
    ensureOnline: true,
    agentIds: configuredCoreAgentIds.length > 0 ? configuredCoreAgentIds : undefined,
  });

  if (coreBindings.length === 0) {
    console.log("[openscout-runtime] no configured core twins to warm");
    return;
  }

  console.log(
    `[openscout-runtime] warming ${coreBindings.length} core twin${coreBindings.length === 1 ? "" : "s"}`,
  );

  for (const binding of coreBindings) {
    await runtime.upsertActor(binding.actor);
    await runtime.upsertAgent(binding.agent);
    store.upsertActor(binding.actor);
    store.upsertAgent(binding.agent);
    await persistEndpoint(binding.endpoint);
    console.log(
      `[openscout-runtime] core twin ready ${binding.agent.id} -> ${binding.endpoint.transport}:${binding.endpoint.sessionId ?? binding.endpoint.id}`,
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

function activeLocalEndpointForAgent(agentId: string): AgentEndpoint | undefined {
  const candidates = Object.values(runtime.snapshot().endpoints).filter((endpoint) => (
    endpoint.agentId === agentId
    && endpoint.nodeId === nodeId
    && endpoint.state !== "offline"
    && endpoint.transport === "tmux"
  ));
  return candidates[0];
}

async function executeLocalInvocation(
  invocation: InvocationRequest,
  initialFlight: FlightRecord,
): Promise<void> {
  const snapshot = runtime.snapshot();
  const agent = snapshot.agents[invocation.targetAgentId];
  const endpoint = activeLocalEndpointForAgent(invocation.targetAgentId);

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

  if (endpoint.transport !== "tmux") {
    const failedFlight = {
      ...initialFlight,
      state: "failed" as const,
      summary: `${agent.displayName} has no supported twin executor.`,
      error: `Endpoint transport ${endpoint.transport} is registered for ${agent.id}, but the broker only routes through tmux-backed twins right now.`,
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
    const result = await invokeProjectTwinEndpoint(runningEndpoint, invocation);

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
            responderHarness: runningEndpoint.harness,
            responderTransport: runningEndpoint.transport,
            responderSessionId: runningEndpoint.sessionId ?? "",
            responderCwd: runningEndpoint.cwd ?? "",
            responderProjectRoot: runningEndpoint.projectRoot ?? "",
            responderTwinName: String(runningEndpoint.metadata?.twinName ?? agent.id),
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

  if (method === "GET" && url.pathname === "/v1/events") {
    json(response, 200, store.recentEvents(parseLimit(url)));
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
  bootstrapRegisteredProjectTwins().catch((error) => {
    console.error("[openscout-runtime] project twin bootstrap failed:", error);
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
