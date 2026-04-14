import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";

import {
  assertValidCollaborationEvent,
  assertValidCollaborationRecord,
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
  type ScoutDispatchEnvelope,
  type ScoutDispatchRecord,
  SCOUT_DISPATCHER_AGENT_ID,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
import { FileBackedBrokerJournal, type BrokerJournalEntry } from "./broker-journal.js";
import {
  buildDispatchEnvelope,
  resolveAgentLabel,
  type BrokerLabelResolution,
} from "./scout-dispatcher.js";
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
  fetchPeerAgents,
  forwardMeshMessage,
  type MeshCollaborationEventBundle,
  type MeshCollaborationRecordBundle,
  type MeshInvocationBundle,
  type MeshMessageBundle,
} from "./mesh-forwarding.js";
import { createPeerDeliveryWorker, type PeerDeliveryWorker } from "./peer-delivery.js";
import {
  ensureLocalAgentBindingOnline,
  isLocalAgentEndpointAlive,
  isLocalAgentSessionAlive,
  invokeLocalAgentEndpoint,
  loadRegisteredLocalAgentBindings,
  shouldDisableGeneratedCodexEndpoint,
} from "./local-agents.js";
import { RecoverableSQLiteProjection } from "./sqlite-projection.js";
import { ensureOpenScoutCleanSlateSync } from "./support-paths.js";
import {
  buildDefaultBrokerUrl,
  DEFAULT_BROKER_PORT,
  isLoopbackHost,
  resolveAdvertiseScope,
  resolveBrokerHost,
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
const journalPath = join(controlHome, "broker-journal.jsonl");
const port = Number.parseInt(process.env.OPENSCOUT_BROKER_PORT ?? String(DEFAULT_BROKER_PORT), 10);
const advertiseScope = resolveAdvertiseScope();
const host = resolveBrokerHost(advertiseScope);
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

const existingBroker = await probeExistingBroker();
if (existingBroker) {
  console.log(`[openscout-runtime] broker already running on ${existingBroker.brokerUrl}`);
  console.log(`[openscout-runtime] node ${existingBroker.nodeId} in mesh ${existingBroker.meshId ?? "unknown"}`);
  process.exit(0);
}

const journal = new FileBackedBrokerJournal(journalPath);
await journal.load();

const sqliteDisabled = process.env.OPENSCOUT_DISABLE_SQLITE === "1";
const runtime = createInMemoryControlRuntime(journal.snapshot(), { localNodeId: nodeId });
const projection = new RecoverableSQLiteProjection(dbPath, journal, { disabled: sqliteDisabled });
const eventClients = new Set<ServerResponse>();
const activeInvocationTasks = new Map<string, Promise<void>>();
const knownInvocations = new Map<string, InvocationRequest>();
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

// Per-invocation SSE subscribers. A single caller can watch one invocation
// without draining the entire global event firehose.
const invocationStreamClients = new Map<string, Set<ServerResponse>>();

function invocationIdsForEvent(event: ControlEvent): string[] {
  switch (event.kind) {
    case "invocation.requested":
      return [event.payload.invocation.id];
    case "flight.updated":
      return event.payload.flight.invocationId ? [event.payload.flight.invocationId] : [];
    case "delivery.planned":
      return event.payload.delivery.invocationId ? [event.payload.delivery.invocationId] : [];
    case "delivery.attempted": {
      const deliveryId = event.payload.attempt.deliveryId;
      const delivery = journal.listDeliveries({ limit: 1000 }).find((d) => d.id === deliveryId);
      return delivery?.invocationId ? [delivery.invocationId] : [];
    }
    case "delivery.state.changed":
      return event.payload.delivery.invocationId ? [event.payload.delivery.invocationId] : [];
    case "scout.dispatched":
      return event.payload.dispatch.invocationId ? [event.payload.dispatch.invocationId] : [];
    case "message.posted": {
      const dispatch = (event.payload.message.metadata as { scoutDispatch?: { invocationId?: string } } | undefined)
        ?.scoutDispatch;
      return dispatch?.invocationId ? [dispatch.invocationId] : [];
    }
    default:
      return [];
  }
}

function streamEvent(event: ControlEvent): void {
  projection.enqueueEvent(event);
  const payload = `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) {
    client.write(payload);
  }
  for (const invocationId of invocationIdsForEvent(event)) {
    const subscribers = invocationStreamClients.get(invocationId);
    if (!subscribers) continue;
    for (const client of subscribers) {
      client.write(payload);
    }
  }
}

function streamKeepAlive(): void {
  for (const client of eventClients) {
    client.write(": keepalive\n\n");
  }
  for (const subscribers of invocationStreamClients.values()) {
    for (const client of subscribers) {
      client.write(": keepalive\n\n");
    }
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
  advertiseScope,
  brokerUrl,
  tailnetName,
  capabilities: ["broker", "mesh", "local_runtime"],
  registeredAt: Date.now(),
  lastSeenAt: Date.now(),
};

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
    await upsertNodeDurably(node);
    // A previously-unreachable peer may have come back — flush any deferred
    // outbox entries targeting it without waiting for the next backoff window.
    peerDelivery.notifyPeerOnline(node.id);
  }

  // Sync agents from each discovered peer so local broker knows about remote agents.
  // This enables @mention resolution and message forwarding across the mesh.
  for (const node of result.discovered) {
    if (!node.brokerUrl) continue;
    try {
      const peerAgents = await fetchPeerAgents(node.brokerUrl);
      let syncedCount = 0;
      for (const agent of peerAgents) {
        if (agent.id === nodeId) continue;
        // Skip agents that claim to be from our own node — stale cached copies
        if (agent.homeNodeId === nodeId) continue;
        // Only accept agents whose home node is the peer itself
        const agentHome = agent.homeNodeId || node.id;
        if (agentHome !== node.id) continue;
        const remoteAgent: AgentDefinition = {
          ...agent,
          homeNodeId: agentHome,
          authorityNodeId: agent.authorityNodeId || node.id,
        };
        await upsertAgentDurably(remoteAgent);
        syncedCount++;
      }
      if (syncedCount > 0) {
        console.log(`[openscout-runtime] synced ${syncedCount} agent(s) from peer ${node.name || node.id}`);
      }
    } catch {
      // Best-effort: peer may be temporarily unreachable
    }
  }

  return result.discovered;
}

function currentLocalNode(): NodeDefinition {
  return runtime.node(nodeId) ?? localNode;
}

function normalizeJournalEntries(
  entriesInput: BrokerJournalEntry | BrokerJournalEntry[],
): BrokerJournalEntry[] {
  return Array.isArray(entriesInput) ? entriesInput : [entriesInput];
}

let durableWriteQueue = Promise.resolve();

function runDurableWrite<T>(work: () => Promise<T>): Promise<T> {
  const next = durableWriteQueue.then(work, work);
  durableWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function commitDurableEntries(
  entriesInput: BrokerJournalEntry | BrokerJournalEntry[],
  applyRuntime: (entries: BrokerJournalEntry[]) => Promise<void>,
  options: { enqueueProjection?: boolean } = {},
): Promise<BrokerJournalEntry[]> {
  const entries = await journal.appendEntries(normalizeJournalEntries(entriesInput));
  if (entries.length === 0) {
    return [];
  }
  await applyRuntime(entries);
  if (options.enqueueProjection !== false) {
    projection.enqueueEntries(entries);
  }
  return entries;
}

async function upsertNodeDurably(node: NodeDefinition): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      { kind: "node.upsert", node },
      async () => {
        await runtime.upsertNode(node);
      },
    );
  });
}

async function upsertActorDurably(actor: ActorIdentity): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      { kind: "actor.upsert", actor },
      async () => {
        await runtime.upsertActor(actor);
      },
    );
  });
}

async function upsertAgentDurably(agent: AgentDefinition): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      [
        { kind: "actor.upsert", actor: agent },
        { kind: "agent.upsert", agent },
      ],
      async (entries) => {
        if (entries.some((entry) => entry.kind === "actor.upsert")) {
          await runtime.upsertActor(agent);
        }
        if (entries.some((entry) => entry.kind === "agent.upsert")) {
          await runtime.upsertAgent(agent);
        }
      },
    );
  });
}

async function upsertEndpointDurably(endpoint: AgentEndpoint): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      { kind: "agent.endpoint.upsert", endpoint },
      async () => {
        await runtime.upsertEndpoint(endpoint);
      },
    );
  });
}

async function upsertConversationDurably(conversation: ConversationDefinition): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      { kind: "conversation.upsert", conversation },
      async () => {
        await runtime.upsertConversation(conversation);
      },
    );
  });
}

async function upsertBindingDurably(binding: ConversationBinding): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      { kind: "binding.upsert", binding },
      async () => {
        await runtime.upsertBinding(binding);
      },
    );
  });
}

async function recordCollaborationDurably(
  record: CollaborationRecord,
  options: { enqueueProjection?: boolean } = {},
): Promise<BrokerJournalEntry[]> {
  assertValidCollaborationRecord(record);
  return runDurableWrite(async () => {
    return commitDurableEntries(
      { kind: "collaboration.record", record },
      async () => {
        await runtime.upsertCollaboration(record);
      },
      options,
    );
  });
}

async function appendCollaborationEventDurably(
  event: CollaborationEvent,
  options: { enqueueProjection?: boolean } = {},
): Promise<BrokerJournalEntry[]> {
  return runDurableWrite(async () => {
    const record = runtime.collaborationRecord(event.recordId);
    if (!record) {
      throw new Error(`unknown collaboration record: ${event.recordId}`);
    }
    assertValidCollaborationEvent(event, record);

    return commitDurableEntries(
      { kind: "collaboration.event.record", event },
      async () => {
        await runtime.appendCollaborationEvent(event);
      },
      options,
    );
  });
}

async function recordMessageDurably(
  message: MessageRecord,
  options: {
    localOnly?: boolean;
    enqueueProjection?: boolean;
  } = {},
): Promise<{ deliveries: DeliveryIntent[]; entries: BrokerJournalEntry[] }> {
  return runDurableWrite(async () => {
    const deliveries = runtime.planMessage(message, {
      localOnly: options.localOnly,
    });
    const entries = await commitDurableEntries(
      [
        { kind: "message.record", message },
        { kind: "deliveries.record", deliveries },
      ],
      async () => {
        await runtime.commitMessage(message, deliveries);
      },
      { enqueueProjection: options.enqueueProjection },
    );
    return { deliveries, entries };
  });
}

async function recordScoutDispatchDurably(
  envelope: ScoutDispatchEnvelope,
  options: {
    invocationId?: string;
    conversationId?: string;
    requesterId?: string;
  } = {},
): Promise<{
  record: ScoutDispatchRecord;
  message: MessageRecord | null;
  entries: BrokerJournalEntry[];
}> {
  const record: ScoutDispatchRecord = {
    id: createRuntimeId("scout-dispatch"),
    invocationId: options.invocationId,
    conversationId: options.conversationId,
    requesterId: options.requesterId,
    ...envelope,
  };

  const dispatchEntries: BrokerJournalEntry[] = [
    { kind: "scout.dispatch.record", dispatch: record },
  ];

  let syntheticMessage: MessageRecord | null = null;
  if (options.conversationId) {
    syntheticMessage = {
      id: createRuntimeId("msg-scout"),
      conversationId: options.conversationId,
      actorId: SCOUT_DISPATCHER_AGENT_ID,
      originNodeId: nodeId,
      class: "system",
      body: record.detail,
      visibility: "workspace",
      policy: "best_effort",
      createdAt: record.dispatchedAt,
      metadata: {
        scoutDispatch: record,
      },
    };
  }

  return runDurableWrite(async () => {
    const appended = await commitDurableEntries(dispatchEntries, async () => {});
    if (!syntheticMessage) {
      return { record, message: null, entries: appended };
    }

    const deliveries = runtime.planMessage(syntheticMessage, { localOnly: true });
    const messageEntries = await commitDurableEntries(
      [
        { kind: "message.record", message: syntheticMessage },
        { kind: "deliveries.record", deliveries },
      ],
      async () => {
        await runtime.commitMessage(syntheticMessage!, deliveries);
      },
    );
    return { record, message: syntheticMessage, entries: [...appended, ...messageEntries] };
  });
}

async function recordInvocationDurably(
  invocation: InvocationRequest,
  options: {
    flight?: FlightRecord;
    enqueueProjection?: boolean;
  } = {},
): Promise<{ flight: FlightRecord; entries: BrokerJournalEntry[] }> {
  return runDurableWrite(async () => {
    const flight = options.flight ?? runtime.planInvocation(invocation);
    knownInvocations.set(invocation.id, invocation);
    const entries = await commitDurableEntries(
      [
        { kind: "invocation.record", invocation },
        { kind: "flight.record", flight },
      ],
      async () => {
        await runtime.commitInvocation(invocation, flight);
      },
      { enqueueProjection: options.enqueueProjection },
    );
    return { flight, entries };
  });
}

async function recordFlightDurably(flight: FlightRecord): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      { kind: "flight.record", flight },
      async () => {
        await runtime.upsertFlight(flight);
      },
    );
  });
}

async function recordDeliveryDurably(delivery: DeliveryIntent): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      { kind: "deliveries.record", deliveries: [delivery] },
      async () => {},
    );
  });
}

async function recordDeliveryAttemptDurably(attempt: {
  id: string;
  deliveryId: string;
  attempt: number;
  status: "sent" | "acknowledged" | "failed";
  error?: string;
  externalRef?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      {
        kind: "delivery.attempt.record",
        attempt: {
          id: attempt.id,
          deliveryId: attempt.deliveryId,
          attempt: attempt.attempt,
          status: attempt.status,
          error: attempt.error,
          externalRef: attempt.externalRef,
          createdAt: attempt.createdAt,
          metadata: attempt.metadata,
        },
      },
      async () => {},
    );
  });
}

async function updateDeliveryStatusDurably(input: {
  deliveryId: string;
  status: DeliveryIntent["status"];
  metadata?: Record<string, unknown>;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
}): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      {
        kind: "delivery.status.update",
        deliveryId: input.deliveryId,
        status: input.status,
        metadata: input.metadata,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseExpiresAt,
      },
      async () => {},
    );
  });
}

function buildMeshBundleEntries(bundle: {
  originNode: NodeDefinition;
  actors: ActorIdentity[];
  agents: AgentDefinition[];
  conversation?: ConversationDefinition;
  bindings?: ConversationBinding[];
  collaborationRecord?: CollaborationRecord;
  collaborationEvent?: CollaborationEvent;
}): BrokerJournalEntry[] {
  const entries: BrokerJournalEntry[] = [
    { kind: "node.upsert", node: bundle.originNode },
  ];
  const actorIds = new Set<string>();
  const agentIds = new Set<string>();
  const bindingIds = new Set<string>();

  for (const actor of bundle.actors) {
    if (actorIds.has(actor.id)) {
      continue;
    }
    actorIds.add(actor.id);
    entries.push({ kind: "actor.upsert", actor });
  }

  for (const agent of bundle.agents) {
    if (agentIds.has(agent.id)) {
      continue;
    }
    agentIds.add(agent.id);
    if (!actorIds.has(agent.id)) {
      actorIds.add(agent.id);
      entries.push({ kind: "actor.upsert", actor: agent });
    }
    entries.push({ kind: "agent.upsert", agent });
  }

  if (bundle.conversation) {
    entries.push({ kind: "conversation.upsert", conversation: bundle.conversation });
  }

  for (const binding of bundle.bindings ?? []) {
    if (bindingIds.has(binding.id)) {
      continue;
    }
    bindingIds.add(binding.id);
    entries.push({ kind: "binding.upsert", binding });
  }

  if (bundle.collaborationRecord) {
    entries.push({ kind: "collaboration.record", record: bundle.collaborationRecord });
  }

  if (bundle.collaborationEvent) {
    entries.push({ kind: "collaboration.event.record", event: bundle.collaborationEvent });
  }

  return entries;
}

async function applyMeshBundleDurably(bundle: {
  originNode: NodeDefinition;
  actors: ActorIdentity[];
  agents: AgentDefinition[];
  conversation?: ConversationDefinition;
  bindings?: ConversationBinding[];
  collaborationRecord?: CollaborationRecord;
  collaborationEvent?: CollaborationEvent;
}, options: { enqueueProjection?: boolean } = {}): Promise<BrokerJournalEntry[]> {
  if (bundle.collaborationRecord) {
    assertValidCollaborationRecord(bundle.collaborationRecord);
  }
  if (bundle.collaborationEvent) {
    const record = bundle.collaborationRecord ?? runtime.collaborationRecord(bundle.collaborationEvent.recordId);
    if (!record) {
      throw new Error(`unknown collaboration record: ${bundle.collaborationEvent.recordId}`);
    }
    assertValidCollaborationEvent(bundle.collaborationEvent, record);
  }

  const entries = buildMeshBundleEntries(bundle);
  return commitDurableEntries(
    entries,
    async (retainedEntries) => {
      for (const entry of retainedEntries) {
        switch (entry.kind) {
          case "node.upsert":
            await runtime.upsertNode(entry.node);
            break;
          case "actor.upsert":
            await runtime.upsertActor(entry.actor);
            break;
          case "agent.upsert":
            await runtime.upsertAgent(entry.agent);
            break;
          case "conversation.upsert":
            await runtime.upsertConversation(entry.conversation);
            break;
          case "binding.upsert":
            await runtime.upsertBinding(entry.binding);
            break;
          case "collaboration.record":
            await runtime.upsertCollaboration(entry.record);
            break;
          case "collaboration.event.record":
            await runtime.appendCollaborationEvent(entry.event);
            break;
          default:
            break;
        }
      }
    },
    options,
  );
}

async function persistFlight(flight: FlightRecord): Promise<void> {
  await recordFlightDurably(flight);
}

async function persistEndpoint(endpoint: AgentEndpoint): Promise<void> {
  await upsertEndpointDurably(endpoint);
  if (endpoint.state === "idle" || endpoint.state === "active") {
    deliverPendingMessages(endpoint.agentId);
  }
}

function deliverPendingMessages(agentId: string): void {
  const snapshot = runtime.snapshot();
  const queued = Object.values(snapshot.flights).filter(
    (flight) => flight.targetAgentId === agentId && flight.state === "queued",
  );
  for (const flight of queued) {
    const invocation = knownInvocations.get(flight.invocationId);
    if (!invocation) continue;
    if (activeInvocationTasks.has(invocation.id)) continue;
    console.log(`[openscout-runtime] draining queued flight ${flight.id} for ${agentId}`);
    launchLocalInvocation(invocation, flight);
  }
}

projection.warm();
await upsertNodeDurably(localNode);
await upsertActorDurably(systemActor);

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

function isStaleLocalAgent(agent: AgentDefinition | undefined): boolean {
  return agent?.metadata?.staleLocalRegistration === true;
}

function isStaleLocalEndpoint(snapshot: ReturnType<typeof runtime.snapshot>, endpoint: AgentEndpoint | null): boolean {
  if (!endpoint || endpoint.metadata?.staleLocalRegistration === true) {
    return true;
  }

  return isStaleLocalAgent(snapshot.agents[endpoint.agentId]);
}

function homeEndpointForAgent(snapshot: ReturnType<typeof runtime.snapshot>, agentId: string): AgentEndpoint | null {
  const candidates = Object.values(snapshot.endpoints).filter((endpoint) => (
    endpoint.agentId === agentId && !isStaleLocalEndpoint(snapshot, endpoint)
  ));
  const rank = (state: string | undefined) => {
    switch (state) {
      case "active":
        return 0;
      case "idle":
        return 1;
      case "waiting":
        return 2;
      case "offline":
        return 5;
      default:
        return 4;
    }
  };

  return [...candidates].sort((left, right) => rank(left.state) - rank(right.state))[0] ?? null;
}

function brokerActorDisplayName(snapshot: ReturnType<typeof runtime.snapshot>, actorId: string): string {
  if (actorId === operatorActorId) {
    return "Operator";
  }

  const agent = snapshot.agents[actorId];
  if (typeof agent?.displayName === "string" && agent.displayName.trim().length > 0) {
    return agent.displayName;
  }

  const actor = snapshot.actors[actorId];
  if (typeof actor?.displayName === "string" && actor.displayName.trim().length > 0) {
    return actor.displayName;
  }

  return actorId;
}

function brokerConversationChannel(snapshot: ReturnType<typeof runtime.snapshot>, conversationId: string | null | undefined): string | null {
  if (!conversationId) {
    return null;
  }

  const conversation = snapshot.conversations[conversationId];
  if (!conversation) {
    return null;
  }

  return conversation.id.startsWith("channel.")
    ? conversation.id.replace(/^channel\./, "")
    : null;
}

function summarizeHomeAgent(endpoint: AgentEndpoint | null): {
  state: "offline" | "available" | "working";
  reachable: boolean;
  statusLabel: string;
  statusDetail: string | null;
  lastSeenAt: number | null;
} {
  if (!endpoint) {
    return {
      state: "offline",
      reachable: false,
      statusLabel: "Offline",
      statusDetail: "No live endpoint detected.",
      lastSeenAt: null,
    };
  }

  const lastSeenAt = Math.max(endpointStartedAt(endpoint), endpointTerminalAt(endpoint)) || null;
  const runtimeLabel = [endpoint.harness, endpoint.transport].filter(Boolean).join(" · ");

  switch (endpoint.state) {
    case "active":
      return {
        state: "working",
        reachable: true,
        statusLabel: "Working",
        statusDetail: runtimeLabel || "Active endpoint",
        lastSeenAt,
      };
    case "idle":
      return {
        state: "available",
        reachable: true,
        statusLabel: "Available",
        statusDetail: runtimeLabel || "Idle endpoint",
        lastSeenAt,
      };
    case "waiting":
      return {
        state: "working",
        reachable: true,
        statusLabel: "Waiting",
        statusDetail: runtimeLabel || "Waiting for follow-up",
        lastSeenAt,
      };
    default:
      return {
        state: "offline",
        reachable: false,
        statusLabel: "Offline",
        statusDetail: runtimeLabel || "Endpoint offline",
        lastSeenAt,
      };
  }
}

async function brokerHomePayload() {
  const snapshot = runtime.snapshot();
  const agents = Object.values(snapshot.agents)
    .filter((agent) => !isStaleLocalAgent(agent))
    .map((agent) => {
      const endpoint = homeEndpointForAgent(snapshot, agent.id);
      const status = summarizeHomeAgent(endpoint);
      return {
        id: agent.id,
        title: brokerActorDisplayName(snapshot, agent.id),
        role: typeof agent.metadata?.role === "string" ? agent.metadata.role : null,
        summary: typeof agent.metadata?.summary === "string" ? agent.metadata.summary : null,
        projectRoot: endpoint?.projectRoot
          ?? endpoint?.cwd
          ?? (typeof agent.metadata?.projectRoot === "string" ? agent.metadata.projectRoot : null),
        state: status.state,
        reachable: status.reachable,
        statusLabel: status.statusLabel,
        statusDetail: status.statusDetail,
        activeTask: null,
        lastSeenAt: status.lastSeenAt,
      };
    })
    .sort((left, right) => {
      const rank = (state: typeof left.state) => {
        switch (state) {
          case "working":
            return 0;
          case "available":
            return 1;
          case "offline":
          default:
            return 2;
        }
      };

      return rank(left.state) - rank(right.state) || left.title.localeCompare(right.title);
    })
    .slice(0, 24);

  const activity = (await projection.listActivityItems({ limit: 96 }))
    .filter((item) => Boolean(item.messageId))
    .slice(0, 24)
    .map((item) => {
      const actorId = item.actorId ?? operatorActorId;
      return {
        id: item.messageId ?? item.id,
        kind: item.kind === "status_message" ? "system" : "message",
        actorId,
        actorName: brokerActorDisplayName(snapshot, actorId),
        title: item.title ?? brokerActorDisplayName(snapshot, actorId),
        detail: item.summary ?? item.title ?? null,
        conversationId: item.conversationId ?? null,
        channel: brokerConversationChannel(snapshot, item.conversationId),
        timestamp: item.ts,
      };
    });

  return {
    updatedAt: Date.now(),
    agents,
    activity,
  };
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
    await upsertAgentDurably(nextAgent);
    console.log(`[openscout-runtime] archived stale local agent ${agent.id}`);
  }
}

async function syncRegisteredLocalAgents(): Promise<void> {
  const bindings = await loadRegisteredLocalAgentBindings(nodeId);
  console.log(
    `[openscout-runtime] local agent sync found ${bindings.length} registered agent${bindings.length === 1 ? "" : "s"}`,
  );

  for (const binding of bindings) {
    if (binding.actor.id !== binding.agent.id) {
      await upsertActorDurably(binding.actor);
    }
    await upsertAgentDurably(binding.agent);
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
    if (binding.actor.id !== binding.agent.id) {
      await upsertActorDurably(binding.actor);
    }
    await upsertAgentDurably(binding.agent);
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
  const { deliveries, entries } = await recordMessageDurably(message, {
    enqueueProjection: false,
  });
  await forwardPeerBrokerDeliveries(message, deliveries);
  projection.enqueueEntries(entries);
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

  const conversation = runtime.conversation(invocation.conversationId);
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

function activeLocalEndpointForAgent(agentId: string, harness?: AgentEndpoint["harness"]): AgentEndpoint | undefined {
  const candidates = runtime.endpointsForAgent(agentId, {
    nodeId,
    harness,
  });
  return candidates.find((endpoint) => isLocalAgentEndpointAlive(endpoint));
}

async function resolveLocalEndpointForInvocation(invocation: InvocationRequest): Promise<AgentEndpoint | undefined> {
  const requestedHarness = invocation.execution?.harness;
  const existing = activeLocalEndpointForAgent(invocation.targetAgentId, requestedHarness);
  if (existing) {
    return existing;
  }

  const staleEndpoints = runtime.endpointsForAgent(invocation.targetAgentId, {
    nodeId,
    harness: requestedHarness,
  });

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

  if (binding.actor.id !== binding.agent.id) {
    await upsertActorDurably(binding.actor);
  }
  await upsertAgentDurably(binding.agent);
  await persistEndpoint(binding.endpoint);
  return binding.endpoint;
}

async function executeLocalInvocation(
  invocation: InvocationRequest,
  initialFlight: FlightRecord,
): Promise<void> {
  const endpoint = await resolveLocalEndpointForInvocation(invocation);
  const agent = runtime.agent(invocation.targetAgentId);

  if (!agent || !endpoint) {
    const queuedFlight = {
      ...initialFlight,
      state: "queued" as const,
      summary: `Message stored for ${agent?.displayName ?? invocation.targetAgentId}. Will deliver when online.`,
    };
    await persistFlight(queuedFlight);
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
      const conversation = runtime.conversation(invocation.conversationId);
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
      state: "offline",
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
  const conversation = runtime.conversation(message.conversationId);
  if (!conversation || conversation.shareMode === "local") {
    return { forwarded: [], failed: [] };
  }

  const targetNodeIds = [...new Set(
    deliveries
      .filter((delivery) => delivery.transport === "peer_broker" && delivery.targetNodeId)
      .map((delivery) => delivery.targetNodeId as string),
  )];
  if (targetNodeIds.length === 0) {
    return { forwarded: [], failed: [] };
  }

  const registry = runtime.peek();
  const originNode = currentLocalNode();
  const bundle = buildMeshMessageBundle(registry, originNode, message, {
    bindings: runtime.bindingsForConversation(conversation.id),
  });
  const forwarded: string[] = [];
  const failed: string[] = [];

  for (const targetNodeId of targetNodeIds) {
    const targetNode = runtime.node(targetNodeId);
    if (!targetNode?.brokerUrl) {
      failed.push(targetNodeId);
      continue;
    }

    try {
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
  const conversation = record.conversationId
    ? runtime.conversation(record.conversationId)
    : undefined;
  if (!conversation || conversation.shareMode === "local") {
    return { forwarded: [], failed: [] };
  }

  const registry = runtime.peek();
  const actorIds = actorIdsForCollaboration(record, conversation);
  const targetNodeIds = [...new Set(
    actorIds
      .map((actorId) => runtime.agent(actorId)?.authorityNodeId)
      .filter((id): id is string => Boolean(id && id !== nodeId)),
  )];
  if (targetNodeIds.length === 0) {
    return { forwarded: [], failed: [] };
  }

  const originNode = currentLocalNode();
  const bundle = buildMeshCollaborationRecordBundle(registry, originNode, record);
  const forwarded: string[] = [];
  const failed: string[] = [];

  for (const targetNodeId of targetNodeIds) {
    const targetNode = runtime.node(targetNodeId);
    if (!targetNode?.brokerUrl) {
      failed.push(targetNodeId);
      continue;
    }

    try {
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
  const record = runtime.collaborationRecord(event.recordId);
  if (!record) {
    return { forwarded: [], failed: [] };
  }
  const conversation = record.conversationId
    ? runtime.conversation(record.conversationId)
    : undefined;
  if (!conversation || conversation.shareMode === "local") {
    return { forwarded: [], failed: [] };
  }

  const registry = runtime.peek();
  const actorIds = actorIdsForCollaboration(record, conversation);
  const targetNodeIds = [...new Set(
    actorIds
      .map((actorId) => runtime.agent(actorId)?.authorityNodeId)
      .filter((id): id is string => Boolean(id && id !== nodeId)),
  )];
  if (targetNodeIds.length === 0) {
    return { forwarded: [], failed: [] };
  }

  const originNode = currentLocalNode();
  const bundle = buildMeshCollaborationEventBundle(registry, originNode, event, record);
  const forwarded: string[] = [];
  const failed: string[] = [];

  for (const targetNodeId of targetNodeIds) {
    const targetNode = runtime.node(targetNodeId);
    if (!targetNode?.brokerUrl) {
      failed.push(targetNodeId);
      continue;
    }

    try {
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
  const targetAgent = runtime.agent(invocation.targetAgentId);
  if (!targetAgent) {
    throw new Error(`unknown agent ${invocation.targetAgentId}`);
  }

  if (targetAgent.authorityNodeId === nodeId) {
    return { forwarded: false };
  }

  const authorityNode = runtime.node(targetAgent.authorityNodeId);
  if (!authorityNode?.brokerUrl) {
    throw new Error(`authority node ${targetAgent.authorityNodeId} is not reachable`);
  }

  const bundle = buildMeshInvocationBundle(runtime.peek(), currentLocalNode(), invocation);
  const result = await forwardMeshInvocation(authorityNode.brokerUrl, bundle);
  const { entries } = await recordInvocationDurably(invocation, {
    flight: result.flight,
    enqueueProjection: false,
  });
  projection.enqueueEntries(entries);
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
      await upsertNodeDurably(command.node);
      return { ok: true };
    case "actor.upsert":
      await upsertActorDurably(command.actor);
      return { ok: true };
    case "agent.upsert":
      await upsertAgentDurably(command.agent);
      return { ok: true };
    case "agent.endpoint.upsert":
      await upsertEndpointDurably(command.endpoint);
      return { ok: true };
    case "conversation.upsert":
      await upsertConversationDurably(command.conversation);
      return { ok: true };
    case "binding.upsert":
      await upsertBindingDurably(command.binding);
      return { ok: true };
    case "collaboration.upsert": {
      const entries = await recordCollaborationDurably(command.record, {
        enqueueProjection: false,
      });
      const mesh = await forwardPeerBrokerCollaborationRecord(command.record);
      projection.enqueueEntries(entries);
      return {
        ok: true,
        recordId: command.record.id,
        mesh,
      };
    }
    case "collaboration.event.append": {
      const entries = await appendCollaborationEventDurably(command.event, {
        enqueueProjection: false,
      });
      const mesh = await forwardPeerBrokerCollaborationEvent(command.event);
      projection.enqueueEntries(entries);
      return {
        ok: true,
        eventId: command.event.id,
        mesh,
      };
    }
    case "conversation.post": {
      const { deliveries, entries } = await recordMessageDurably(command.message, {
        enqueueProjection: false,
      });
      const mesh = await forwardPeerBrokerDeliveries(command.message, deliveries);
      projection.enqueueEntries(entries);
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
      const { flight, entries } = await recordInvocationDurably(command.invocation, {
        enqueueProjection: false,
      });
      console.log(
        `[openscout-runtime] invocation ${command.invocation.id} -> ${command.invocation.targetAgentId} is ${flight.state}${flight.summary ? ` (${flight.summary})` : ""}`,
      );
      if (flight.state === "failed") {
        await postInvocationStatusMessage(command.invocation, flight);
      } else {
        launchLocalInvocation(command.invocation, flight);
      }
      projection.enqueueEntries(entries);
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

async function acceptInvocationDurably(invocation: InvocationRequest): Promise<FlightRecord> {
  const { flight, entries } = await recordInvocationDurably(invocation, {
    enqueueProjection: false,
  });
  projection.enqueueEntries(entries);
  return flight;
}

async function dispatchAcceptedInvocation(invocation: InvocationRequest): Promise<void> {
  const targetAgent = runtime.agent(invocation.targetAgentId);
  if (!targetAgent) {
    await failAcceptedInvocation(invocation, `unknown agent ${invocation.targetAgentId}`);
    return;
  }

  const flight = runtime.flightForInvocation(invocation.id);
  if (!flight) {
    console.warn(`[openscout-runtime] dispatch skipped — flight missing for invocation ${invocation.id}`);
    return;
  }

  if (targetAgent.authorityNodeId && targetAgent.authorityNodeId !== nodeId) {
    // Cross-node: hand off to the outbox worker. Peer reachability is now a
    // delivery concern (deferred ↔ accepted retries), not an HTTP error.
    const authorityNode = runtime.node(targetAgent.authorityNodeId);
    if (!authorityNode) {
      await failAcceptedInvocation(invocation, `authority node ${targetAgent.authorityNodeId} is not reachable`);
      return;
    }
    await peerDelivery.enqueue(invocation, authorityNode);
    return;
  }

  // Local authority — run the normal launch path.
  if (flight.state === "failed") {
    await postInvocationStatusMessage(invocation, flight);
  } else {
    launchLocalInvocation(invocation, flight);
  }
}

async function failAcceptedInvocation(invocation: InvocationRequest, detail: string): Promise<void> {
  const now = Date.now();
  const existing = runtime.flightForInvocation(invocation.id);
  const failed: FlightRecord = {
    id: existing?.id ?? createRuntimeId("flt"),
    invocationId: invocation.id,
    requesterId: invocation.requesterId,
    targetAgentId: invocation.targetAgentId,
    state: "failed",
    startedAt: existing?.startedAt ?? now,
    completedAt: now,
    summary: detail,
    error: detail,
    metadata: invocation.metadata,
  };
  await recordFlightDurably(failed);
  await postInvocationStatusMessage(invocation, failed);
}

const peerDelivery: PeerDeliveryWorker = createPeerDeliveryWorker({
  journal,
  snapshot: () => runtime.peek(),
  localNode: currentLocalNode,
  localNodeId: nodeId,
  nodeFor: (id) => runtime.node(id),
  agentFor: (id) => runtime.agent(id),
  invocationFor: (id) => knownInvocations.get(id),
  recordDelivery: recordDeliveryDurably,
  updateDeliveryStatus: updateDeliveryStatusDurably,
  recordDeliveryAttempt: recordDeliveryAttemptDurably,
  recordFlight: recordFlightDurably,
  failInvocation: failAcceptedInvocation,
  emit: streamEvent,
});

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

  if (method === "GET" && url.pathname === "/v1/home") {
    json(response, 200, await brokerHomePayload());
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
    json(response, 200, runtime.recentEvents(parseLimit(url)));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/activity") {
    const agentId = url.searchParams.get("agentId") ?? undefined;
    const actorId = url.searchParams.get("actorId") ?? undefined;
    const conversationId = url.searchParams.get("conversationId") ?? undefined;
    json(response, 200, await projection.listActivityItems({
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
    const records = journal.listCollaborationRecords({
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
    const events = journal.listCollaborationEvents({
      limit: parseLimit(url),
      recordId: recordId ?? undefined,
    });
    json(response, 200, events);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/deliveries") {
    const transport = url.searchParams.get("transport") ?? undefined;
    const statusFilter = url.searchParams.get("status") ?? undefined;
    json(response, 200, journal.listDeliveries({
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
    json(response, 200, journal.listDeliveryAttempts(deliveryId));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/mesh/nodes") {
    json(response, 200, runtime.snapshot().nodes);
    return;
  }

  // Per-invocation snapshot — current state of the invocation, its flight,
  // its deliveries, and any scout dispatch that fired for it. Callers use
  // this to seed UI state before subscribing to the stream.
  const invocationSnapshotMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/invocations\/([^/]+)$/)
    : null;
  if (invocationSnapshotMatch) {
    const invocationId = decodeURIComponent(invocationSnapshotMatch[1] ?? "");
    const flight = runtime.flightForInvocation(invocationId);
    const deliveries = journal
      .listDeliveries({ limit: 500 })
      .filter((delivery) => delivery.invocationId === invocationId);
    const dispatches = journal
      .listScoutDispatches({ limit: 50 })
      .filter((record) => record.invocationId === invocationId);
    const invocation = knownInvocations.get(invocationId);
    json(response, 200, {
      invocationId,
      invocation: invocation ?? null,
      flight: flight ?? null,
      deliveries,
      dispatches,
    });
    return;
  }

  // Per-invocation SSE — initial snapshot frame, then every event whose
  // payload references this invocation. Caller closes the stream when done.
  const invocationStreamMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/invocations\/([^/]+)\/stream$/)
    : null;
  if (invocationStreamMatch) {
    const invocationId = decodeURIComponent(invocationStreamMatch[1] ?? "");
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    const flight = runtime.flightForInvocation(invocationId);
    const deliveries = journal
      .listDeliveries({ limit: 500 })
      .filter((delivery) => delivery.invocationId === invocationId);
    const dispatches = journal
      .listScoutDispatches({ limit: 50 })
      .filter((record) => record.invocationId === invocationId);
    const invocation = knownInvocations.get(invocationId);
    response.write(`event: snapshot\ndata: ${JSON.stringify({
      invocationId,
      invocation: invocation ?? null,
      flight: flight ?? null,
      deliveries,
      dispatches,
    })}\n\n`);

    let subscribers = invocationStreamClients.get(invocationId);
    if (!subscribers) {
      subscribers = new Set();
      invocationStreamClients.set(invocationId, subscribers);
    }
    subscribers.add(response);

    request.on("close", () => {
      const set = invocationStreamClients.get(invocationId);
      if (set) {
        set.delete(response);
        if (set.size === 0) invocationStreamClients.delete(invocationId);
      }
      response.end();
    });
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
      const result = await runDurableWrite(async () => {
        const bundleEntries = await applyMeshBundleDurably(bundle, {
          enqueueProjection: false,
        });

        if (runtime.message(bundle.message.id)) {
          return {
            duplicate: true as const,
            bundleEntries,
            messageEntries: [] as BrokerJournalEntry[],
            deliveries: [] as DeliveryIntent[],
          };
        }

        const deliveries = runtime.planMessage(bundle.message, { localOnly: true });
        const messageEntries = await commitDurableEntries(
          [
            { kind: "message.record", message: bundle.message },
            { kind: "deliveries.record", deliveries },
          ],
          async () => {
            await runtime.commitMessage(bundle.message, deliveries);
          },
          { enqueueProjection: false },
        );

        return {
          duplicate: false as const,
          bundleEntries,
          messageEntries,
          deliveries,
        };
      });

      projection.enqueueEntries([...result.bundleEntries, ...result.messageEntries]);
      json(response, 200, result.duplicate ? { ok: true, duplicate: true } : { ok: true, deliveries: result.deliveries });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/invocations") {
    try {
      const bundle = await readRequestBody<MeshInvocationBundle>(request);
      const result = await runDurableWrite(async () => {
        const bundleEntries = await applyMeshBundleDurably(bundle, {
          enqueueProjection: false,
        });

        const targetAgent = runtime.agent(bundle.invocation.targetAgentId);
        if (!targetAgent) {
          throw new Error(`unknown target agent ${bundle.invocation.targetAgentId}`);
        }
        if (targetAgent.authorityNodeId !== nodeId) {
          return {
            kind: "not_authority" as const,
            bundleEntries,
            targetAgent,
          };
        }

        const existing = runtime.flightForInvocation(bundle.invocation.id);
        if (existing) {
          return {
            kind: "duplicate" as const,
            bundleEntries,
            flight: existing,
          };
        }

        const flight = runtime.planInvocation(bundle.invocation);
        const invocationEntries = await commitDurableEntries(
          [
            { kind: "invocation.record", invocation: bundle.invocation },
            { kind: "flight.record", flight },
          ],
          async () => {
            await runtime.commitInvocation(bundle.invocation, flight);
          },
          { enqueueProjection: false },
        );

        return {
          kind: "ok" as const,
          bundleEntries,
          invocationEntries,
          flight,
        };
      });

      if (result.kind === "not_authority") {
        projection.enqueueEntries(result.bundleEntries);
        json(response, 409, {
          error: "not_authority",
          detail: `agent ${result.targetAgent.id} is owned by ${result.targetAgent.authorityNodeId}`,
        });
        return;
      }

      if (result.kind === "duplicate") {
        projection.enqueueEntries(result.bundleEntries);
        json(response, 200, { ok: true, duplicate: true, flight: result.flight });
        return;
      }

      projection.enqueueEntries([...result.bundleEntries, ...result.invocationEntries]);
      json(response, 200, { ok: true, flight: result.flight });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/collaboration/records") {
    try {
      const bundle = await readRequestBody<MeshCollaborationRecordBundle>(request);
      const result = await runDurableWrite(async () => {
        const existing = runtime.collaborationRecord(bundle.record.id);
        const entries = await applyMeshBundleDurably(bundle, {
          enqueueProjection: false,
        });
        return { existing, entries };
      });
      projection.enqueueEntries(result.entries);
      json(response, 200, result.existing ? { ok: true, duplicate: true } : { ok: true });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/collaboration/events") {
    try {
      const bundle = await readRequestBody<MeshCollaborationEventBundle>(request);
      const entries = await runDurableWrite(async () => applyMeshBundleDurably(bundle, {
        enqueueProjection: false,
      }));
      projection.enqueueEntries(entries);
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
      const record = runtime.collaborationRecord(recordId);
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
      await recordDeliveryAttemptDurably(attempt);
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
      await updateDeliveryStatusDurably(body);
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
      const payload = await readRequestBody<InvocationRequest & { targetLabel?: string }>(request);
      const resolved = resolveInvocationTarget(payload);
      if (resolved.kind !== "resolved") {
        const envelope = buildDispatchEnvelope(
          resolved,
          payload.targetLabel?.trim() || payload.targetAgentId || "",
          nodeId,
          runtime.snapshot(),
          { homeEndpointFor: homeEndpointForAgent },
        );
        const { record } = await recordScoutDispatchDurably(envelope, {
          invocationId: payload.id,
          conversationId: payload.conversationId,
          requesterId: payload.requesterId,
        });
        json(response, 202, {
          accepted: true,
          invocationId: payload.id,
          dispatch: record,
        });
        return;
      }
      const invocation: InvocationRequest = {
        ...payload,
        targetAgentId: resolved.agent.id,
      };
      const flight = await acceptInvocationDurably(invocation);
      json(response, 202, {
        accepted: true,
        invocationId: invocation.id,
        flightId: flight.id,
        targetAgentId: invocation.targetAgentId,
        state: flight.state,
        flight,
      });
      dispatchAcceptedInvocation(invocation).catch((error) => {
        console.error(`[openscout-runtime] background dispatch failed for invocation ${invocation.id}:`, error);
      });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  notFound(response);
}

type InvocationResolution =
  | { kind: "resolved"; agent: AgentDefinition }
  | BrokerLabelResolution;

function resolveInvocationTarget(
  payload: InvocationRequest & { targetLabel?: string },
): InvocationResolution {
  const snapshot = runtime.snapshot();
  const directId = payload.targetAgentId?.trim();
  if (directId) {
    const agent = snapshot.agents[directId];
    if (agent && !isStaleLocalAgent(agent)) {
      return { kind: "resolved", agent };
    }
  }

  const label = payload.targetLabel?.trim() || directId || "";
  if (!label) {
    return { kind: "unparseable", label: "" };
  }

  return resolveAgentLabel(snapshot, label, {
    preferLocalNodeId: nodeId,
    helpers: { isStale: isStaleLocalAgent },
  });
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
  peerDelivery.start();
  console.log(`[openscout-runtime] broker listening on ${host}:${port} (scope: ${advertiseScope}, url: ${brokerUrl})`);
  if (advertiseScope === "mesh" && isLoopbackHost(host)) {
    console.warn(`[openscout-runtime] WARNING: mesh scope bound to loopback ${host} — peers cannot reach this broker. Set OPENSCOUT_BROKER_HOST=0.0.0.0 or unset to use the mesh default.`);
  }
  console.log(`[openscout-runtime] node ${nodeId} in mesh ${meshId}`);
  console.log(`[openscout-runtime] journal ${journalPath}`);
  console.log(`[openscout-runtime] sqlite ${sqliteDisabled ? "disabled" : dbPath}`);
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
    peerDelivery.stop();
    for (const client of eventClients) {
      client.end();
    }
    for (const subscribers of invocationStreamClients.values()) {
      for (const client of subscribers) {
        client.end();
      }
    }
    invocationStreamClients.clear();
    projection.close();
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
      projection.close();
      server.close(() => process.exit(0));
    }
  }, 2_000).unref();
}
