import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { lstat, mkdir, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

import { applyWSSHandler } from "@trpc/server/adapters/ws";

import { brokerRouter } from "./broker-trpc-router.js";

import {
  assertValidCollaborationEvent,
  assertValidCollaborationRecord,
  assertValidUnblockRequestEvent,
  assertValidUnblockRequestRecord,
  buildScoutReturnAddress,
  type ActorIdentity,
  type AgentDefinition,
  type AgentEndpoint,
  type CollaborationEvent,
  type CollaborationRecord,
  type CollaborationPriority,
  type ControlCommand,
  type ControlEvent,
  type ConversationBinding,
  type ConversationDefinition,
  type ConversationReadCursor,
  type DeliveryIntent,
  type DeliveryReason,
  type DeliveryStatus,
  type DurableAction,
  type DurableActionHeartbeatInput,
  type FlightRecord,
  type InboxAckRequest,
  type InboxClaimRequest,
  type InboxItem,
  type InboxNackRequest,
  type InvocationRequest,
  type MessageRecord,
  type NodeDefinition,
  type ScoutAgentCard,
  type ScoutDispatchEnvelope,
  type ScoutDispatchRecord,
  type ScoutDispatchUnavailableTarget,
  type ScoutDeliveryRemediationAction,
  type ScoutDeliveryReceipt,
  type ScoutDeliverRequest,
  type ScoutDeliverResponse,
  type ScoutDeliverRouteKind,
  type ThreadWatchCloseRequest,
  type ThreadWatchOpenRequest,
  type ThreadWatchRenewRequest,
  type UnblockRequestEvent,
  type UnblockRequestRecord,
  OPENSCOUT_IROH_MESH_ALPN,
  OPENSCOUT_MESH_PROTOCOL_VERSION,
  SCOUT_DISPATCHER_AGENT_ID,
  normalizeAgentSelectorSegment,
  parseAgentIdentity,
  type AgentHarness,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
import {
  publishControlEvent,
  replaceControlEventBacklog,
} from "./broker-control-events.js";
import { FileBackedBrokerJournal, type BrokerJournalEntry } from "./broker-journal.js";
import {
  askedLabelForRouteTarget,
  buildDispatchEnvelope,
  resolveBrokerRouteTarget,
  resolveAgentLabel,
  routeChannelForTarget,
  type BrokerLabelResolution,
  type BrokerRouteTargetInput,
} from "./scout-dispatcher.js";
import { buildCollaborationInvocation } from "./collaboration-invocations.js";
import { discoverMeshNodes } from "./mesh-discovery.js";
import {
  resolveIrohMeshEntrypointFromEnv,
  startIrohBridgeServeFromEnv,
  type IrohBridgeService,
} from "./iroh-bridge.js";
import {
  DEFAULT_MESH_FORWARD_TIMEOUT_MS,
  buildMeshCollaborationEventBundle,
  buildMeshCollaborationRecordBundle,
  buildMeshMessageBundle,
  forwardMeshCollaborationEvent,
  forwardMeshCollaborationRecord,
  fetchPeerAgents,
  forwardMeshMessage,
  type MeshCollaborationEventBundle,
  type MeshCollaborationRecordBundle,
  type MeshInvocationBundle,
  type MeshMessageBundle,
} from "./mesh-forwarding.js";
import { createPeerDeliveryWorker, type PeerDeliveryWorker } from "./peer-delivery.js";
import {
  ensureLocalSessionEndpointOnline,
  ensureLocalAgentBindingOnline,
  isLocalAgentEndpointAlive,
  isLocalAgentSessionAlive,
  invokeLocalAgentEndpoint,
  loadRegisteredLocalAgentBindings,
  pruneOneTimeLocalAgentCards,
  retireConsumedOneTimeLocalAgentCards,
  shutdownLocalSessionEndpoint,
  shouldDisableGeneratedCodexEndpoint,
  startLocalAgent,
  SUPPORTED_SCOUT_HARNESSES,
} from "./local-agents.js";
import {
  upsertScoutAgentCardFromInput,
  buildScoutAgentCard,
  type ExternalAgentCardInput,
} from "./scout-agent-cards.js";
import {
  buildManagedPairingEndpointBinding,
  buildPairingSessionCandidate,
  ensurePairingSessionForCodexThread,
  findPairingSession,
  getPairingSessionSnapshot,
  invokePairingSessionEndpoint,
  listPairingSessions,
  type PairingSession,
} from "./pairing-session-agents.js";
import { RecoverableSQLiteProjection } from "./sqlite-projection.js";
import { ThreadEventPlane, ThreadWatchProtocolError } from "./thread-events.js";
import { isRequesterWaitTimeoutError } from "./requester-timeout.js";
import { isDispatchStalledError } from "./dispatch-stalled.js";
import { isCodexAppServerExitError } from "./codex-app-server.js";
import { ensureOpenScoutCleanSlateSync, resolveOpenScoutSupportPaths } from "./support-paths.js";
import {
  requestScoutBrokerJson,
  registerActiveScoutBrokerService,
  unregisterActiveScoutBrokerService,
} from "./broker-api.js";
import { createBrokerCoreService } from "./broker-core-service.js";
import {
  buildDefaultBrokerUrl,
  DEFAULT_BROKER_PORT,
  isLoopbackHost,
  resolveAdvertiseScope,
  resolveBrokerServiceConfig,
  resolveBrokerHost,
} from "./broker-process-manager.js";
import { resolveWebPort } from "./local-config.js";
import {
  resolveBunExecutable,
  resolveOpenScoutRepoRoot,
  resolveRepoEntrypoint,
} from "./tool-resolution.js";
import {
  readMobilePairingMeshEntrypoint,
  resolveMeshRendezvousPublishConfig,
  startMeshRendezvousPublisher,
  type MeshRendezvousPublisher,
} from "./mesh-rendezvous.js";
import { clearGitBranchCache, readRelayAgentOverrides, writeRelayAgentOverrides } from "./setup.js";
import { broadcastApnsAlertToActiveMobileDevices } from "./mobile-push.js";
import {
  getHarnessTopologySnapshot,
  nudgeHarnessTopologyScan,
} from "./harness-topology/index.js";

const PROCESS_NAME = "scout-broker";
const WEB_PROCESS_NAME = "scout-web";

process.title = PROCESS_NAME;

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

function jsonWithHeaders(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string>): void {
  response.writeHead(status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
  });
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

function conflict(response: ServerResponse, detail: string): void {
  json(response, 409, {
    error: "conflict",
    detail,
  });
}

function threadWatchError(response: ServerResponse, error: unknown): void {
  if (error instanceof ThreadWatchProtocolError) {
    json(response, error.status, error.body);
    return;
  }
  badRequest(response, error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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
const brokerSocketPath = process.env.OPENSCOUT_BROKER_SOCKET_PATH
  ?? resolveBrokerServiceConfig().brokerSocketPath;
const nodeId = process.env.OPENSCOUT_NODE_ID ?? `${nodeName}-${meshId}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
const seedUrls = (process.env.OPENSCOUT_MESH_SEEDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const configuredCoreAgentIds = (process.env.OPENSCOUT_CORE_AGENTS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const discoveryIntervalMs = Number.parseInt(process.env.OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS ?? "60000", 10);
const parentPid = Number.parseInt(process.env.OPENSCOUT_PARENT_PID ?? "0", 10);
const localAgentSyncIntervalMs = Number.parseInt(process.env.OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS ?? "5000", 10);
let registeredLocalAgentsRegistrySignature: string | null = null;
let registeredLocalAgentsSyncInFlight: Promise<void> | null = null;
const DEFAULT_IMPLICIT_PROJECT_CARD_TTL_MS = 24 * 60 * 60 * 1000;

ensureOpenScoutCleanSlateSync();

const existingBroker = await probeExistingBroker();
if (existingBroker) {
  console.log(`[openscout-runtime] broker already running on ${existingBroker.brokerUrl}`);
  console.log(`[openscout-runtime] node ${existingBroker.nodeId} in mesh ${existingBroker.meshId ?? "unknown"}`);
  process.exit(0);
}

const journal = new FileBackedBrokerJournal(journalPath);
await journal.load();
const initialSnapshot = journal.snapshot();

const sqliteDisabled = process.env.OPENSCOUT_DISABLE_SQLITE === "1";
const runtime = createInMemoryControlRuntime(initialSnapshot, { localNodeId: nodeId });
replaceControlEventBacklog(runtime.recentEvents(500), 500);
const projection = new RecoverableSQLiteProjection(dbPath, journal, { disabled: sqliteDisabled });
const threadEvents = new ThreadEventPlane({
  nodeId,
  runtime,
  projection,
});
const eventClients = new Set<ServerResponse>();
const activeInvocationTasks = new Map<string, Promise<void>>();
const knownInvocations = new Map<string, InvocationRequest>(Object.entries(initialSnapshot.invocations));
let shuttingDown = false;
const sseKeepAliveIntervalMs = Number.parseInt(process.env.OPENSCOUT_SSE_KEEPALIVE_MS ?? "15000", 10);
const operatorActorId = "operator";
const BROKER_SHARED_CHANNEL_ID = "channel.shared";
const BROKER_VOICE_CHANNEL_ID = "channel.voice";
const BROKER_SYSTEM_CHANNEL_ID = "channel.system";
const WEB_START_POLL_TIMEOUT_MS = 15_000;
const WEB_START_POLL_INTERVAL_MS = 250;
let webServerProcess: ChildProcess | null = null;
let webStartInFlight: Promise<WebSupervisorStatus> | null = null;
let meshRendezvousPublisher: MeshRendezvousPublisher | null = null;

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
const inboxStreamClients = new Map<string, Set<ServerResponse>>();

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

function inboxTargetsForEvent(event: ControlEvent): string[] {
  switch (event.kind) {
    case "delivery.planned":
    case "delivery.state.changed":
      return [event.payload.delivery.targetId];
    default:
      return [];
  }
}

function inboxItemForDelivery(delivery: DeliveryIntent): InboxItem {
  const message = delivery.messageId ? runtime.message(delivery.messageId) : undefined;
  const invocation = delivery.invocationId ? knownInvocations.get(delivery.invocationId) : undefined;
  return {
    id: delivery.id,
    kind: delivery.invocationId ? "invocation" : "message",
    targetId: delivery.targetId,
    targetNodeId: delivery.targetNodeId,
    conversationId: message?.conversationId ?? invocation?.conversationId,
    messageId: delivery.messageId,
    invocationId: delivery.invocationId,
    reason: delivery.reason,
    status: delivery.status,
    leaseOwner: delivery.leaseOwner,
    leaseExpiresAt: delivery.leaseExpiresAt,
    delivery,
    message,
    invocation,
    metadata: delivery.metadata,
  };
}

const DEFAULT_INBOX_STATUSES = new Set<DeliveryStatus>([
  "pending",
  "accepted",
  "deferred",
  "leased",
]);

const STALE_MESH_AUTHORITY_NODE_MS = 24 * 60 * 60 * 1000;

async function listInboxItems(options: {
  targetId: string;
  statuses?: Set<DeliveryStatus>;
  reasons?: Set<DeliveryReason>;
  limit?: number;
}): Promise<InboxItem[]> {
  const statuses = options.statuses ?? DEFAULT_INBOX_STATUSES;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  return (await projection.listDeliveries({ limit: 5000 }))
    .filter((delivery) => delivery.targetId === options.targetId)
    .filter((delivery) => statuses.has(delivery.status))
    .filter((delivery) => !options.reasons || options.reasons.has(delivery.reason))
    .slice(0, limit)
    .map((delivery) => inboxItemForDelivery(delivery));
}

function parseInboxStatuses(url: URL): Set<DeliveryStatus> | undefined {
  const values = url.searchParams.getAll("status")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? new Set(values as DeliveryStatus[]) : undefined;
}

function parseInboxReasons(url: URL): Set<DeliveryReason> | undefined {
  const values = url.searchParams.getAll("reason")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? new Set(values as DeliveryReason[]) : undefined;
}

function writeInboxSse(response: ServerResponse, eventName: string, payload: unknown): void {
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function publishInboxDeliveryEvent(delivery: DeliveryIntent, eventName: string): void {
  const subscribers = inboxStreamClients.get(delivery.targetId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }
  const item = inboxItemForDelivery(delivery);
  for (const client of subscribers) {
    writeInboxSse(client, eventName, item);
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
  if (inboxTargetsForEvent(event).length > 0) {
    const delivery = (event as Extract<ControlEvent, { kind: "delivery.planned" | "delivery.state.changed" }>).payload.delivery;
    publishInboxDeliveryEvent(delivery, event.kind === "delivery.planned" ? "inbox.item" : "inbox.item.updated");
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
  publishControlEvent(event);
});

if (sseKeepAliveIntervalMs > 0) {
  setInterval(() => {
    streamKeepAlive();
  }, sseKeepAliveIntervalMs).unref();
}

let irohBridgeService: IrohBridgeService | undefined;
let localIrohEntrypoint = resolveIrohMeshEntrypointFromEnv();
if (!localIrohEntrypoint) {
  try {
    irohBridgeService = await startIrohBridgeServeFromEnv({ brokerUrl });
    localIrohEntrypoint = irohBridgeService?.entrypoint;
    if (irohBridgeService) {
      irohBridgeService.child.on("exit", (code, signal) => {
        if (!shuttingDown) {
          console.warn(`[openscout-runtime] Iroh bridge exited (${code ?? signal ?? "unknown"}); HTTP/Tailscale forwarding remains available`);
        }
      });
    }
  } catch (error) {
    console.warn(`[openscout-runtime] Iroh bridge unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const localNode: NodeDefinition = {
  id: nodeId,
  meshId,
  name: nodeName,
  hostName: hostname(),
  advertiseScope,
  brokerUrl,
  ...(localIrohEntrypoint ? { meshEntrypoints: [localIrohEntrypoint] } : {}),
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

async function migrateUnqualifiedRelayAgentKeys(): Promise<void> {
  const canonical = await readRelayAgentOverrides();
  await writeRelayAgentOverrides(canonical);
}

async function relayAgentRegistrySignature(): Promise<string | null> {
  try {
    const registryPath = resolveOpenScoutSupportPaths().relayAgentsRegistryPath;
    const info = await stat(registryPath);
    return `${info.mtimeMs}:${info.size}`;
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function syncRegisteredLocalAgentsIfChanged(reason: string): Promise<void> {
  const nextSignature = await relayAgentRegistrySignature();
  if (nextSignature === registeredLocalAgentsRegistrySignature) {
    return;
  }

  if (registeredLocalAgentsSyncInFlight) {
    await registeredLocalAgentsSyncInFlight;
    return;
  }

  registeredLocalAgentsSyncInFlight = (async () => {
    const latestSignature = await relayAgentRegistrySignature();
    if (latestSignature === registeredLocalAgentsRegistrySignature) {
      return;
    }

    clearGitBranchCache();
    console.log(`[openscout-runtime] local agent registry changed (${reason}); refreshing registered agents`);
    await syncRegisteredLocalAgents();
  })();

  try {
    await registeredLocalAgentsSyncInFlight;
  } finally {
    registeredLocalAgentsSyncInFlight = null;
  }
}

async function bootstrapRegisteredLocalAgents(): Promise<void> {
  await migrateUnqualifiedRelayAgentKeys();
  await syncRegisteredLocalAgents();
  await retireLegacyPairingSessionAgents();
  await reconcileManagedPairingEndpoints();
  await ensureCoreLocalAgentsOnline();
}

async function discoverPeers(seeds: string[] = []): Promise<{
  discovered: NodeDefinition[];
  probes: string[];
}> {
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

  const peersToSync = new Map<string, NodeDefinition>();
  for (const node of result.discovered) peersToSync.set(node.id, node);
  for (const node of Object.values(runtime.snapshot().nodes)) {
    if (node.id === nodeId || !node.brokerUrl) continue;
    peersToSync.set(node.id, node);
  }

  for (const node of peersToSync.values()) {
    if (!node.brokerUrl) continue;
    try {
      const peerAgents = await fetchPeerAgents(node.brokerUrl);
      let syncedCount = 0;
      for (const agent of peerAgents) {
        if (agent.id === nodeId) continue;
        if (agent.homeNodeId === nodeId) continue;
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

  return {
    discovered: result.discovered,
    probes: result.probes,
  };
}

function currentLocalNode(): NodeDefinition {
  return runtime.node(nodeId) ?? localNode;
}

function currentRendezvousNode(): NodeDefinition {
  const node = currentLocalNode();
  const mobilePairingEntrypoint = readMobilePairingMeshEntrypoint();
  if (!mobilePairingEntrypoint) {
    return node;
  }

  return {
    ...node,
    meshEntrypoints: [
      ...(node.meshEntrypoints ?? []).filter((entrypoint) => entrypoint.kind !== "mobile_pairing"),
      mobilePairingEntrypoint,
    ],
    lastSeenAt: Date.now(),
  };
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
    await applyProjectedEntries(entries);
  }
  return entries;
}

async function applyProjectedEntries(entriesInput: BrokerJournalEntry | BrokerJournalEntry[]): Promise<void> {
  const entries = normalizeJournalEntries(entriesInput);
  if (entries.length === 0) {
    return;
  }

  const threadEventEnvelopes = await projection.applyEntries(entries);
  if (threadEventEnvelopes.length > 0) {
    threadEvents.publish(threadEventEnvelopes);
  }
}

async function brokerPostJson<TResponse>(
  brokerBaseUrl: string,
  path: string,
  payload: unknown,
): Promise<TResponse> {
  const response = await fetch(`${brokerBaseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(DEFAULT_MESH_FORWARD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }

  return await response.json() as TResponse;
}

type WebSupervisorStatus = {
  ok: boolean;
  running: boolean;
  starting: boolean;
  webUrl: string;
  port: number;
  pid: number | null;
  error: string | null;
};

type WebStartContext = {
  publicOrigin?: string;
  trustedHost?: string;
};

function webServerPort(): number {
  const envPort = Number.parseInt(process.env.OPENSCOUT_WEB_PORT ?? "", 10);
  return Number.isInteger(envPort) && envPort > 0 && envPort < 65536
    ? envPort
    : resolveWebPort();
}

function webServerUrl(): string {
  return `http://127.0.0.1:${webServerPort()}`;
}

async function isWebServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${webServerUrl()}/api/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.json() as { ok?: boolean; surface?: string };
    return body.ok === true && body.surface === "openscout-web";
  } catch {
    return false;
  }
}

function resolveWebServerEntry(): string | null {
  const explicit = process.env.OPENSCOUT_WEB_SERVER_ENTRY?.trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const repoRoot = resolveWebServerRepoRoot();
  const repoEntry = resolveRepoEntrypoint(repoRoot, "packages/web/server/index.ts");
  if (repoEntry) {
    return repoEntry;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, "..", "scout-control-plane-web.mjs"),
    resolve(moduleDir, "..", "scout-web-server.mjs"),
    resolve(moduleDir, "..", "..", "scout-control-plane-web.mjs"),
    resolve(moduleDir, "..", "..", "scout-web-server.mjs"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveWebServerRepoRoot(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolveOpenScoutRepoRoot({
    startDirectories: [
      process.env.OPENSCOUT_SETUP_CWD,
      process.cwd(),
      moduleDir,
    ],
  });
}

function resolveWebServerSetupCwd(): string {
  return process.env.OPENSCOUT_SETUP_CWD?.trim() || resolveWebServerRepoRoot() || process.cwd();
}

function normalizeTrustedWebHost(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const candidate = trimmed.includes("://") ? new URL(trimmed) : new URL(`http://${trimmed}`);
    const hostName = candidate.hostname.toLowerCase();
    if (
      hostName === "scout.local"
      || hostName.endsWith(".scout.local")
      || hostName === "localhost"
      || hostName === "127.0.0.1"
      || hostName === "::1"
    ) {
      return hostName;
    }
  } catch {
    return null;
  }
  return null;
}

function webStartContextFromRequest(request: IncomingMessage): WebStartContext {
  const forwardedHost = Array.isArray(request.headers["x-forwarded-host"])
    ? request.headers["x-forwarded-host"][0]
    : request.headers["x-forwarded-host"];
  const forwardedProto = Array.isArray(request.headers["x-forwarded-proto"])
    ? request.headers["x-forwarded-proto"][0]
    : request.headers["x-forwarded-proto"];
  const trustedHost = normalizeTrustedWebHost(forwardedHost);
  if (!trustedHost) {
    return {};
  }
  const proto = forwardedProto?.trim().toLowerCase() === "https" ? "https" : "http";
  return {
    publicOrigin: `${proto}://${trustedHost}`,
    trustedHost,
  };
}

function appendCsvValue(input: string | undefined, value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return input;
  }
  const existing = (input ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!existing.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
    existing.push(normalized);
  }
  return existing.length > 0 ? existing.join(",") : undefined;
}

function resolveWebServerLogPath(): string {
  const config = resolveBrokerServiceConfig();
  const logDirectory = join(config.supportDirectory, "logs", "web");
  mkdirSync(logDirectory, { recursive: true });
  return join(logDirectory, "supervised-web.log");
}

function spawnWebServer(context: WebStartContext = {}): ChildProcess {
  const entry = resolveWebServerEntry();
  if (!entry) {
    throw new Error("Could not find the Scout web server entry.");
  }
  const bun = resolveBunExecutable();
  if (!bun) {
    throw new Error("Unable to locate Bun for Scout web startup.");
  }

  const logFd = openSync(resolveWebServerLogPath(), "a");
  const env = {
    ...process.env,
    OPENSCOUT_WEB_HOST: process.env.OPENSCOUT_WEB_HOST?.trim() || "0.0.0.0",
    OPENSCOUT_WEB_PORT: String(webServerPort()),
    OPENSCOUT_WEB_BUN_URL: webServerUrl(),
    ...(context.publicOrigin && !process.env.OPENSCOUT_WEB_PUBLIC_ORIGIN?.trim()
      ? { OPENSCOUT_WEB_PUBLIC_ORIGIN: context.publicOrigin }
      : {}),
    ...(context.trustedHost && context.trustedHost !== "scout.local" && !process.env.OPENSCOUT_WEB_ADVERTISED_HOST?.trim()
      ? { OPENSCOUT_WEB_ADVERTISED_HOST: context.trustedHost }
      : {}),
    ...(context.trustedHost
      ? { OPENSCOUT_WEB_TRUSTED_HOSTS: appendCsvValue(process.env.OPENSCOUT_WEB_TRUSTED_HOSTS, context.trustedHost) }
      : {}),
    OPENSCOUT_SETUP_CWD: resolveWebServerSetupCwd(),
  };
  console.log("[openscout-runtime] starting Scout web server", {
    webUrl: webServerUrl(),
    publicOrigin: env.OPENSCOUT_WEB_PUBLIC_ORIGIN,
    advertisedHost: env.OPENSCOUT_WEB_ADVERTISED_HOST,
    trustedHost: context.trustedHost,
  });
  const child = spawn(
    bun.path,
    entry.endsWith(".ts") ? ["run", "--hot", entry] : ["run", entry],
    {
      argv0: WEB_PROCESS_NAME,
      detached: true,
      env,
      stdio: ["ignore", logFd, logFd],
    },
  );
  child.once("exit", (code, signal) => {
    if (webServerProcess !== child) {
      // Either we already replaced this handle, or shutdown nulled it intentionally.
      return;
    }
    webServerProcess = null;
    if (shuttingDown) {
      return;
    }
    // Track failures within a sliding window so a broken entrypoint doesn't
    // produce an infinite respawn loop. Linear backoff escalates the delay
    // with each consecutive failure; we pause auto-respawn entirely once we
    // exceed the threshold and require an operator to call `scout server start`.
    const now = Date.now();
    while (webRespawnFailures.length > 0 && now - webRespawnFailures[0]! > WEB_RESPAWN_FAILURE_WINDOW_MS) {
      webRespawnFailures.shift();
    }
    webRespawnFailures.push(now);
    if (webRespawnFailures.length > WEB_RESPAWN_MAX_FAILURES) {
      console.error(
        `[openscout-runtime] Scout web server has exited ${webRespawnFailures.length} times within ${WEB_RESPAWN_FAILURE_WINDOW_MS / 1000}s — pausing auto-respawn. Use 'scout server start' to retry.`,
      );
      webRespawnFailures.length = 0;
      return;
    }
    const delay = Math.min(
      WEB_RESPAWN_BASE_DELAY_MS * webRespawnFailures.length,
      WEB_RESPAWN_MAX_DELAY_MS,
    );
    console.warn(
      `[openscout-runtime] Scout web server exited unexpectedly (code=${code}, signal=${signal}) — respawning in ${delay}ms (failure ${webRespawnFailures.length}/${WEB_RESPAWN_MAX_FAILURES})`,
    );
    setTimeout(() => {
      if (shuttingDown) return;
      startWebServerIfNeeded(context).catch((error) => {
        console.error("[openscout-runtime] web server respawn failed:", error);
      });
    }, delay).unref?.();
  });
  child.unref();
  return child;
}

const WEB_RESPAWN_BASE_DELAY_MS = 1_000;
const WEB_RESPAWN_MAX_DELAY_MS = 30_000;
const WEB_RESPAWN_MAX_FAILURES = 5;
const WEB_RESPAWN_FAILURE_WINDOW_MS = 60_000;
const webRespawnFailures: number[] = [];

async function webSupervisorStatus(error: string | null = null): Promise<WebSupervisorStatus> {
  const running = await isWebServerHealthy();
  return {
    ok: running,
    running,
    starting: Boolean(webStartInFlight),
    webUrl: webServerUrl(),
    port: webServerPort(),
    pid: webServerProcess?.pid ?? null,
    error,
  };
}

async function startWebServerIfNeeded(context: WebStartContext = {}): Promise<WebSupervisorStatus> {
  if (await isWebServerHealthy()) {
    return webSupervisorStatus();
  }
  if (webStartInFlight) {
    return webStartInFlight;
  }

  webStartInFlight = (async () => {
    try {
      if (!webServerProcess || webServerProcess.exitCode !== null) {
        webServerProcess = spawnWebServer(context);
      }
      const deadline = Date.now() + WEB_START_POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await isWebServerHealthy()) {
          return webSupervisorStatus();
        }
        await sleep(WEB_START_POLL_INTERVAL_MS);
      }
      return webSupervisorStatus("Timed out waiting for Scout web to become healthy.");
    } catch (error) {
      return webSupervisorStatus(error instanceof Error ? error.message : String(error));
    } finally {
      webStartInFlight = null;
    }
  })();

  return webStartInFlight;
}

function scoutWebSupervisorCorsHeaders(request: IncomingMessage): Record<string, string> {
  const origin = request.headers.origin;
  if (typeof origin !== "string") {
    return {};
  }
  let allowed = false;
  try {
    const originUrl = new URL(origin);
    const hostName = originUrl.hostname.toLowerCase();
    allowed = (
      hostName === "scout.local"
      || hostName.endsWith(".scout.local")
      || hostName === "127.0.0.1"
      || hostName === "localhost"
    );
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return {};
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
    "access-control-max-age": "600",
    vary: "Origin",
  };
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

async function recordUnblockRequestDurably(
  request: UnblockRequestRecord,
  options: { enqueueProjection?: boolean } = {},
): Promise<BrokerJournalEntry[]> {
  assertValidUnblockRequestRecord(request);
  return runDurableWrite(async () => {
    return commitDurableEntries(
      { kind: "unblock_request.record", request },
      async () => {
        await runtime.upsertUnblockRequest(request);
      },
      options,
    );
  });
}

async function appendUnblockRequestEventDurably(
  event: UnblockRequestEvent,
  options: { enqueueProjection?: boolean } = {},
): Promise<BrokerJournalEntry[]> {
  return runDurableWrite(async () => {
    const request = runtime.unblockRequest(event.requestId);
    if (!request) {
      throw new Error(`unknown unblock request: ${event.requestId}`);
    }
    assertValidUnblockRequestEvent(event, request);

    return commitDurableEntries(
      { kind: "unblock_request.event.record", event },
      async () => {
        await runtime.appendUnblockRequestEvent(event);
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
  let recordedFlight: FlightRecord | null = null;
  await runDurableWrite(async () => {
    const previous = runtime.snapshot().flights[flight.id];
    if (previous && shouldIgnoreFlightUpdate(previous, flight)) {
      console.warn(
        `[openscout-runtime] ignored stale flight update ${flight.id}: ${previous.state} -> ${flight.state}`,
      );
      return;
    }

    const entries = await commitDurableEntries(
      { kind: "flight.record", flight },
      async () => {
        await runtime.upsertFlight(flight);
      },
      { enqueueProjection: false },
    );
    await applyProjectedEntries(entries);
    recordedFlight = flight;
  });
  if (!recordedFlight) return;

  const invocation = knownInvocations.get(flight.invocationId)
    ?? runtime.snapshot().invocations[flight.invocationId];
  await reconcileMessageDeliveriesForFlight(flight, invocation);
  if (invocation && isTerminalFlightState(flight.state)) {
    try {
      await promoteInvocationFlightToWork(invocation, flight, flight.output ?? flight.error ?? flight.summary);
    } catch (error) {
      console.warn(
        `[openscout-runtime] failed to update work item for flight ${flight.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    await maybeForwardFlightToAuthority(flight);
  } catch (error) {
    console.warn(
      `[openscout-runtime] failed to forward flight ${flight.id} to conversation authority:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function shouldIgnoreFlightUpdate(previous: FlightRecord, next: FlightRecord): boolean {
  return isTerminalFlightState(previous.state) && !isTerminalFlightState(next.state);
}

const terminalDeliveryStatuses = new Set<DeliveryStatus>(["completed", "failed", "cancelled"]);
const staleReconcileableDeliveryStatuses = new Set<DeliveryStatus>([
  "accepted",
  "deferred",
  "leased",
  "pending",
  "running",
  "sent",
]);

function deliveryStatusForFlight(flight: FlightRecord): DeliveryStatus | null {
  if (flight.state === "running" || flight.state === "waiting") {
    return "running";
  }
  if (flight.state === "completed") {
    return "completed";
  }
  if (flight.state === "failed") {
    return "failed";
  }
  if (flight.state === "cancelled") {
    return "cancelled";
  }
  return null;
}

async function reconcileMessageDeliveriesForFlight(
  flight: FlightRecord,
  invocation: InvocationRequest | undefined,
): Promise<void> {
  const status = deliveryStatusForFlight(flight);
  if (!status || !invocation?.messageId) {
    return;
  }

  const updatedAt = flight.completedAt ?? Date.now();
  const deliveries = journal
    .listDeliveries({ limit: 5000 })
    .filter((delivery) => (
      delivery.messageId === invocation.messageId
      && delivery.targetId === flight.targetAgentId
      && delivery.status !== status
      && !terminalDeliveryStatuses.has(delivery.status)
    ));

  for (const delivery of deliveries) {
    await updateDeliveryStatusDurably({
      deliveryId: delivery.id,
      status,
      metadata: {
        invocationId: flight.invocationId,
        flightId: flight.id,
        flightState: flight.state,
        flightStatusUpdatedAt: updatedAt,
        ...(flight.error ? { failureDetail: flight.error } : {}),
      },
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }
}

function staleLocalDeliveryReason(
  snapshot: ReturnType<typeof runtime.snapshot>,
  delivery: DeliveryIntent,
): string | null {
  if (delivery.targetKind !== "agent" || !staleReconcileableDeliveryStatuses.has(delivery.status)) {
    return null;
  }

  const endpoints = Object.values(snapshot.endpoints)
    .filter((endpoint) => endpoint.agentId === delivery.targetId);
  if (endpoints.length === 0) {
    return null;
  }
  if (endpoints.some((endpoint) => staleLocalEndpointReason(endpoint) === null)) {
    return null;
  }

  const staleEndpoints = endpoints
    .filter((endpoint) => staleLocalEndpointReason(endpoint) !== null)
    .sort((left, right) => endpointStartedAt(right) - endpointStartedAt(left));
  const transportMatch = staleEndpoints.find((endpoint) => endpoint.transport === delivery.transport);
  return staleLocalEndpointReason(transportMatch ?? staleEndpoints[0] ?? null);
}

async function reconcileStaleLocalDeliveries(): Promise<void> {
  const snapshot = runtime.snapshot();
  const now = Date.now();

  for (const delivery of journal.listDeliveries({ limit: 5000 })) {
    const reason = staleLocalDeliveryReason(snapshot, delivery);
    if (!reason) {
      continue;
    }

    await updateDeliveryStatusDurably({
      deliveryId: delivery.id,
      status: "failed",
      metadata: {
        failureReason: "agent_offline",
        failureDetail: `Stale local delivery reconciled: ${reason}`,
        staleLocalRegistration: true,
        reconciledStaleDelivery: true,
        reconciledReason: reason,
        reconciledAt: now,
      },
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    console.warn(`[openscout-runtime] reconciled stale local delivery ${delivery.id}: ${reason}`);
  }
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

async function heartbeatDurableActionDurably(
  input: DurableActionHeartbeatInput,
): Promise<DurableAction | null> {
  // Durable action heartbeats renew ledger ownership only; they do not mutate
  // InboxItem delivery state, so there is no delivery SSE event to publish.
  return runDurableWrite(async () => {
    const current = journal.getDurableAction(input.actionId);
    if (
      !current
      || current.leaseOwner !== input.owner
      || current.leaseGeneration !== input.generation
      || current.state === "completed"
      || current.state === "failed"
      || current.state === "cancelled"
    ) {
      return null;
    }
    const heartbeat = {
      ...current,
      leaseExpiresAt: input.heartbeatAt + input.leaseMs,
      updatedAt: input.heartbeatAt,
    };
    await commitDurableEntries(
      { kind: "durable.action.heartbeat", input },
      async () => {},
    );
    return heartbeat;
  });
}

async function updateDeliveryStatusDurably(input: {
  deliveryId: string;
  status: DeliveryIntent["status"];
  metadata?: Record<string, unknown>;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
  expectedLeaseOwner?: string;
  requireActiveLease?: boolean;
}): Promise<void> {
  let previous: DeliveryIntent | undefined;
  await runDurableWrite(async () => {
    previous = journal.listDeliveries({ limit: 5000 })
      .find((delivery) => delivery.id === input.deliveryId);
    if (input.expectedLeaseOwner || input.requireActiveLease) {
      if (!previous) {
        throw new Error("delivery not found");
      }
      const now = Date.now();
      if (
        previous.status !== "leased"
        || !previous.leaseOwner
        || previous.leaseOwner !== input.expectedLeaseOwner
        || typeof previous.leaseExpiresAt !== "number"
        || previous.leaseExpiresAt <= now
      ) {
        throw new Error("delivery lease is missing, expired, or owned by another worker");
      }
    }

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
  const updated = journal.listDeliveries({ limit: 5000 })
    .find((delivery) => delivery.id === input.deliveryId);
  if (updated) {
    streamEvent({
      id: createRuntimeId("evt"),
      kind: "delivery.state.changed",
      ts: Date.now(),
      actorId: "system",
      nodeId,
      payload: {
        delivery: updated,
        previousStatus: previous?.status,
      },
    });
  }
}

function listReadCursorsForConversation(conversationId: string): ConversationReadCursor[] {
  return Object.values(runtime.snapshot().readCursors)
    .filter((cursor) => cursor.conversationId === conversationId)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function latestMessageForConversation(conversationId: string): MessageRecord | undefined {
  return Object.values(runtime.snapshot().messages)
    .filter((message) => message.conversationId === conversationId)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

function messageCreatedAt(messageId: string | undefined): number | undefined {
  return messageId ? runtime.message(messageId)?.createdAt : undefined;
}

function cursorProgressRank(cursor: {
  lastReadSeq?: number;
  lastReadMessageId?: string;
}): number | undefined {
  if (typeof cursor.lastReadSeq === "number" && Number.isFinite(cursor.lastReadSeq)) {
    return cursor.lastReadSeq;
  }
  return messageCreatedAt(cursor.lastReadMessageId);
}

function finitePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

async function resolveReadCursor(
  conversationId: string,
  input: {
    actorId?: string;
    readerNodeId?: string;
    lastReadMessageId?: string;
    lastReadSeq?: number;
    lastReadAt?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<ConversationReadCursor> {
  const conversation = runtime.conversation(conversationId);
  if (!conversation) {
    throw new Error(`conversation ${conversationId} not found`);
  }

  const actorId = input.actorId?.trim() || operatorActorId;
  await ensureBrokerActorForDelivery(actorId);

  const explicitMessageId = input.lastReadMessageId?.trim();
  const lastReadMessage = explicitMessageId
    ? runtime.message(explicitMessageId)
    : latestMessageForConversation(conversationId);

  if (explicitMessageId && !lastReadMessage) {
    throw new Error(`message ${explicitMessageId} not found`);
  }
  if (lastReadMessage && lastReadMessage.conversationId !== conversationId) {
    throw new Error(`message ${lastReadMessage.id} does not belong to ${conversationId}`);
  }

  const latestThreadSeq = await projection.latestThreadSeq(conversationId);
  const providedSeq = finitePositiveNumber(input.lastReadSeq);
  let lastReadSeq = providedSeq
    ?? (!explicitMessageId && latestThreadSeq > 0 ? latestThreadSeq : undefined);
  let lastReadAt = finitePositiveNumber(input.lastReadAt) ?? Date.now();
  let lastReadMessageId = lastReadMessage?.id;

  const current = runtime.readCursor(conversationId, actorId);
  if (current) {
    const currentRank = cursorProgressRank(current);
    const nextRank = cursorProgressRank({ lastReadSeq, lastReadMessageId });
    if (
      currentRank !== undefined
      && (nextRank === undefined || nextRank < currentRank)
    ) {
      lastReadMessageId = current.lastReadMessageId;
      lastReadSeq = current.lastReadSeq;
      lastReadAt = current.lastReadAt;
    }
  }

  return {
    conversationId,
    actorId,
    readerNodeId: input.readerNodeId?.trim() || nodeId,
    lastReadMessageId,
    lastReadSeq,
    lastReadAt,
    updatedAt: Date.now(),
    metadata: input.metadata,
  };
}

async function recordReadCursorDurably(cursor: ConversationReadCursor): Promise<void> {
  await runDurableWrite(async () => {
    await commitDurableEntries(
      { kind: "conversation.read_cursor.upsert", cursor },
      async () => {
        await runtime.upsertReadCursor(cursor);
      },
    );
  });
}

async function acknowledgeDeliveriesForReadCursor(cursor: ConversationReadCursor): Promise<number> {
  const boundaryMessage = cursor.lastReadMessageId
    ? runtime.message(cursor.lastReadMessageId)
    : latestMessageForConversation(cursor.conversationId);
  if (!boundaryMessage) {
    return 0;
  }

  const readableStatuses = new Set<DeliveryIntent["status"]>([
    "pending",
    "accepted",
    "deferred",
    "sent",
  ]);
  const readReasons = new Set<DeliveryIntent["reason"]>([
    "conversation_visibility",
    "direct_message",
    "mention",
    "thread_reply",
  ]);
  let acknowledged = 0;

  const deliveries = await projection.listDeliveries({ limit: 5000 });
  for (const delivery of deliveries) {
    if (delivery.targetId !== cursor.actorId) continue;
    if (!delivery.messageId) continue;
    if (!readableStatuses.has(delivery.status)) continue;
    if (!readReasons.has(delivery.reason)) continue;

    const message = runtime.message(delivery.messageId);
    if (!message || message.conversationId !== cursor.conversationId) continue;
    if (message.createdAt > boundaryMessage.createdAt) continue;

    await updateDeliveryStatusDurably({
      deliveryId: delivery.id,
      status: "acknowledged",
      metadata: {
        acknowledgedByReadCursor: true,
        readAt: cursor.lastReadAt,
        readCursorUpdatedAt: cursor.updatedAt,
        readMessageId: cursor.lastReadMessageId,
      },
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    acknowledged += 1;
  }

  return acknowledged;
}

function isDeliveryClaimable(delivery: DeliveryIntent, now: number): boolean {
  if (delivery.status === "pending" || delivery.status === "accepted" || delivery.status === "deferred") {
    return true;
  }
  return delivery.status === "leased"
    && typeof delivery.leaseExpiresAt === "number"
    && delivery.leaseExpiresAt <= now;
}

async function claimDeliveryDurably(input: {
  itemId?: string;
  messageId?: string;
  targetId: string;
  reasons?: DeliveryReason[];
  leaseOwner?: string;
  leaseMs?: number;
}): Promise<DeliveryIntent | null> {
  let previousStatus: DeliveryStatus | undefined;
  const claimed = await runDurableWrite(async () => {
    const now = Date.now();
    const reasons = input.reasons?.length ? new Set(input.reasons) : null;
    const delivery = journal
      .listDeliveries({ limit: 5000 })
      .find((candidate) => (
        (!input.itemId || candidate.id === input.itemId)
        && (!input.messageId || candidate.messageId === input.messageId)
        && candidate.targetId === input.targetId
        && (!reasons || reasons.has(candidate.reason))
        && isDeliveryClaimable(candidate, now)
      ));

    if (!delivery) {
      return null;
    }
    previousStatus = delivery.status;

    const leaseOwner = input.leaseOwner?.trim() || `delivery-claim-${nodeId}`;
    const leaseMs = Number.isFinite(input.leaseMs) && input.leaseMs! > 0 ? input.leaseMs! : 30_000;
    const leaseExpiresAt = now + leaseMs;
    const metadata = {
      claimedAt: now,
      claimedBy: leaseOwner,
    };

    await commitDurableEntries(
      {
        kind: "delivery.status.update",
        deliveryId: delivery.id,
        status: "leased",
        leaseOwner,
        leaseExpiresAt,
        metadata,
      },
      async () => {},
    );

    return {
      ...delivery,
      status: "leased" as const,
      leaseOwner,
      leaseExpiresAt,
      metadata: {
        ...(delivery.metadata ?? {}),
        ...metadata,
      },
    };
  });
  if (claimed) {
    streamEvent({
      id: createRuntimeId("evt"),
      kind: "delivery.state.changed",
      ts: Date.now(),
      actorId: "system",
      nodeId,
      payload: {
        delivery: claimed,
        previousStatus,
      },
    });
  }
  return claimed;
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

function isTerminalFlightState(state: FlightRecord["state"]): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function flightTimestamp(flight: FlightRecord): number {
  return flight.completedAt ?? flight.startedAt ?? 0;
}

function endpointLastInvocationId(endpoint: AgentEndpoint): string | null {
  const value = endpoint.metadata?.lastInvocationId;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function staleLocalEndpointReason(endpoint: AgentEndpoint | null): string | null {
  if (!endpoint || endpoint.metadata?.staleLocalRegistration !== true) {
    return null;
  }

  const replacementAgentId = endpoint.metadata.replacedByAgentId;
  const replacement = typeof replacementAgentId === "string" && replacementAgentId.trim().length > 0
    ? `; replacement agent is ${replacementAgentId.trim()}`
    : "";
  return `endpoint ${endpoint.id} is a stale local registration superseded by current setup${replacement}`;
}

function flightDispatchEndpointId(flight: FlightRecord): string | null {
  const dispatchAck = flight.metadata?.dispatchAck;
  if (!dispatchAck || typeof dispatchAck !== "object" || Array.isArray(dispatchAck)) {
    return null;
  }

  const endpointId = (dispatchAck as Record<string, unknown>).endpointId;
  return typeof endpointId === "string" && endpointId.trim().length > 0
    ? endpointId.trim()
    : null;
}

function endpointForFlight(snapshot: ReturnType<typeof runtime.snapshot>, flight: FlightRecord): AgentEndpoint | null {
  const dispatchedEndpointId = flightDispatchEndpointId(flight);
  if (dispatchedEndpointId) {
    const endpoint = snapshot.endpoints[dispatchedEndpointId];
    if (endpoint?.agentId === flight.targetAgentId) {
      return endpoint;
    }
    return null;
  }

  return latestEndpointForAgent(snapshot, flight.targetAgentId);
}

function flightDispatchEndpointUnavailableReason(
  snapshot: ReturnType<typeof runtime.snapshot>,
  flight: FlightRecord,
): string | null {
  const dispatchedEndpointId = flightDispatchEndpointId(flight);
  if (!dispatchedEndpointId) {
    return null;
  }

  const endpoint = snapshot.endpoints[dispatchedEndpointId];
  if (!endpoint) {
    return `dispatched endpoint ${dispatchedEndpointId} is no longer registered`;
  }
  if (endpoint.agentId !== flight.targetAgentId) {
    return `dispatched endpoint ${dispatchedEndpointId} no longer belongs to target agent ${flight.targetAgentId}`;
  }
  return null;
}

function isReconciledStaleFlightActivityItem(item: {
  kind: string;
  summary?: string | null;
}): boolean {
  return item.kind === "flight_updated"
    && typeof item.summary === "string"
    && item.summary.startsWith("Stale running flight reconciled:");
}

function isRetiredLocalAgent(agent: AgentDefinition | undefined): boolean {
  return agent?.metadata?.retiredFromFleet === true;
}

function isInactiveLocalAgent(agent: AgentDefinition | undefined): boolean {
  return isRetiredLocalAgent(agent) || agent?.metadata?.staleLocalRegistration === true;
}

function isStaleLocalEndpoint(snapshot: ReturnType<typeof runtime.snapshot>, endpoint: AgentEndpoint | null): boolean {
  if (!endpoint || endpoint.metadata?.staleLocalRegistration === true) {
    return true;
  }

  return isInactiveLocalAgent(snapshot.agents[endpoint.agentId]);
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

function titleCaseName(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function sanitizeConversationSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "shared";
}

function metadataStringValue(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function scoutbotReplyProvenanceMetadata(invocation: InvocationRequest): Record<string, unknown> {
  if (invocation.targetAgentId !== "scoutbot") {
    return {};
  }
  return {
    source: metadataStringValue(invocation.metadata, "source") ?? "scoutbot",
    requestedBy: metadataStringValue(invocation.metadata, "requestedBy") ?? invocation.requesterId,
    sourceMessageId: metadataStringValue(invocation.metadata, "sourceMessageId") ?? invocation.messageId ?? null,
    parentScoutbotTurnId: metadataStringValue(invocation.metadata, "parentScoutbotTurnId"),
    generatedBy: metadataStringValue(invocation.metadata, "generatedBy") ?? "scoutbot",
    scoutbotThreadId: metadataStringValue(invocation.metadata, "scoutbotThreadId"),
    targetSessionId: metadataStringValue(invocation.metadata, "targetSessionId"),
  };
}

function brokerTargetProjectRoot(agent: AgentDefinition, endpoint: AgentEndpoint | null): string | null {
  return endpoint?.projectRoot
    ?? endpoint?.cwd
    ?? metadataStringValue(agent.metadata, "projectRoot");
}

function brokerTargetLabel(agent: AgentDefinition): string {
  const selector = agent.selector
    ?? agent.defaultSelector
    ?? metadataStringValue(agent.metadata, "selector")
    ?? metadataStringValue(agent.metadata, "defaultSelector");
  if (selector) {
    return selector;
  }
  const handle = agent.handle?.trim();
  return `@${handle && handle.length > 0 ? handle : agent.id}`;
}

function brokerRouteKind(conversation: Pick<ConversationDefinition, "id" | "kind">): ScoutDeliverRouteKind {
  if (conversation.kind === "direct") {
    return "dm";
  }
  return conversation.id === BROKER_SHARED_CHANNEL_ID ? "broadcast" : "channel";
}

function normalizeBrokerProductTarget(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

function isLocalScoutProductTarget(payload: BrokerRouteTargetInput): boolean {
  const target = payload.target;
  if (target) {
    if (target.kind !== "agent_label" && target.kind !== "agent_id") {
      return false;
    }
    const value = target.kind === "agent_label" ? target.label : target.agentId;
    const normalized = normalizeBrokerProductTarget(value);
    return normalized === "scout" || normalized === "openscout";
  }

  const normalizedLabel = normalizeBrokerProductTarget(payload.targetLabel ?? "");
  const normalizedAgentId = normalizeBrokerProductTarget(payload.targetAgentId ?? "");
  return normalizedLabel === "scout"
    || normalizedLabel === "openscout"
    || normalizedAgentId === "scout"
    || normalizedAgentId === "openscout";
}

function isOperatorDeliveryTarget(payload: BrokerRouteTargetInput): boolean {
  const target = payload.target;
  if (target) {
    if (target.kind !== "agent_label" && target.kind !== "agent_id") {
      return false;
    }
    const value = target.kind === "agent_label" ? target.label : target.agentId;
    return normalizeBrokerProductTarget(value) === operatorActorId;
  }

  return normalizeBrokerProductTarget(payload.targetLabel ?? "") === operatorActorId
    || normalizeBrokerProductTarget(payload.targetAgentId ?? "") === operatorActorId;
}

function messageRefCandidateForRouteTarget(payload: BrokerRouteTargetInput): string | null {
  const target = payload.target;
  const raw = target?.kind === "binding_ref"
    ? target.ref
    : target?.kind === "agent_label"
    ? target.label
    : payload.targetLabel ?? "";
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const withoutPrefix = trimmed.startsWith("ref:") ? trimmed.slice("ref:".length).trim() : trimmed;
  return /^(?:msg|m)-[a-z0-9][a-z0-9._-]*$/i.test(withoutPrefix) ? withoutPrefix : null;
}

function resolveBrokerMessageRef(snapshot: ReturnType<typeof runtime.snapshot>, ref: string): MessageRecord | null {
  const direct = snapshot.messages[ref];
  if (direct) {
    return direct;
  }
  const normalized = ref.toLowerCase();
  const matches = Object.values(snapshot.messages).filter((message) =>
    message.id.toLowerCase() === normalized
    || message.id.toLowerCase().endsWith(normalized)
  );
  return matches.length === 1 ? matches[0]! : null;
}

function resolveConversationShareMode(
  snapshot: ReturnType<typeof runtime.snapshot>,
  participantIds: string[],
  fallback: "local" | "shared",
): "local" | "shared" {
  if (fallback === "shared") {
    return "shared";
  }

  const hasRemoteParticipant = participantIds.some((participantId) => {
    const participant = snapshot.agents[participantId];
    return Boolean(participant?.authorityNodeId && participant.authorityNodeId !== nodeId);
  });
  return hasRemoteParticipant ? "shared" : fallback;
}

function directConversationIdForActors(sourceId: string, targetId: string): string {
  if (sourceId === targetId) {
    return `dm.${sourceId}.${targetId}`;
  }
  if (sourceId === operatorActorId || targetId === operatorActorId) {
    const peerId = sourceId === operatorActorId ? targetId : sourceId;
    return `dm.${operatorActorId}.${peerId}`;
  }
  return `dm.${[sourceId, targetId].sort().join(".")}`;
}

async function ensureBrokerActorForDelivery(actorId: string): Promise<void> {
  const snapshot = runtime.snapshot();
  if (snapshot.actors[actorId] || snapshot.agents[actorId]) {
    return;
  }
  await upsertActorDurably({
    id: actorId,
    kind: actorId === operatorActorId ? "person" : "agent",
    displayName: titleCaseName(actorId),
    handle: actorId,
    labels: ["scout"],
    metadata: { source: "broker-deliver" },
  });
}

async function ensureBrokerDeliveryConversation(input: {
  requesterId: string;
  targetAgentId?: string;
  channel?: string;
}): Promise<ConversationDefinition> {
  const snapshot = runtime.snapshot();
  const normalizedChannel = input.channel?.trim();
  const targetAgentId = input.targetAgentId?.trim();

  if (!normalizedChannel && targetAgentId) {
    const conversationId = targetAgentId === SCOUT_DISPATCHER_AGENT_ID && input.requesterId === operatorActorId
      ? BROKER_SHARED_CHANNEL_ID
      : directConversationIdForActors(input.requesterId, targetAgentId);
    const participantIds = [...new Set([input.requesterId, targetAgentId])].sort();
    const shareMode = resolveConversationShareMode(snapshot, participantIds, "local");
    const existing = snapshot.conversations[conversationId];
    const alreadyMatches = existing
      && existing.kind === "direct"
      && existing.visibility === "private"
      && existing.shareMode === shareMode
      && existing.participantIds.join("\u0000") === participantIds.join("\u0000");
    if (alreadyMatches) {
      return existing;
    }

    const nonOperatorParticipants = participantIds.filter((participantId) => participantId !== operatorActorId);
    const conversationTitle = input.requesterId === operatorActorId || targetAgentId === operatorActorId
      ? brokerActorDisplayName(snapshot, nonOperatorParticipants[0] ?? targetAgentId)
      : `${brokerActorDisplayName(snapshot, input.requesterId)} <> ${brokerActorDisplayName(snapshot, targetAgentId)}`;
    const conversation: ConversationDefinition = {
      id: conversationId,
      kind: "direct",
      title: targetAgentId === SCOUT_DISPATCHER_AGENT_ID && input.requesterId === operatorActorId ? "Scout" : conversationTitle,
      visibility: "private",
      shareMode,
      authorityNodeId: nodeId,
      participantIds,
      metadata: {
        surface: "broker",
        ...(targetAgentId === SCOUT_DISPATCHER_AGENT_ID && input.requesterId === operatorActorId ? { role: "partner" } : {}),
      },
    };
    await upsertConversationDurably(conversation);
    return conversation;
  }

  const channel = normalizedChannel || "shared";
  const sharedParticipants = [...new Set([operatorActorId, input.requesterId, ...Object.keys(snapshot.agents)])].sort();
  const scopedParticipants = [...new Set([
    operatorActorId,
    input.requesterId,
    ...(targetAgentId ? [targetAgentId] : []),
  ])].sort();

  let definition: ConversationDefinition;
  if (channel === "voice") {
    definition = {
      id: BROKER_VOICE_CHANNEL_ID,
      kind: "channel",
      title: "voice",
      visibility: "workspace",
      shareMode: resolveConversationShareMode(snapshot, scopedParticipants, "local"),
      authorityNodeId: nodeId,
      participantIds: scopedParticipants,
      metadata: { surface: "broker", channel: "voice" },
    };
  } else if (channel === "system") {
    definition = {
      id: BROKER_SYSTEM_CHANNEL_ID,
      kind: "system",
      title: "system",
      visibility: "system",
      shareMode: "local",
      authorityNodeId: nodeId,
      participantIds: [operatorActorId, input.requesterId].sort(),
      metadata: { surface: "broker", channel: "system" },
    };
  } else if (channel === "shared") {
    definition = {
      id: BROKER_SHARED_CHANNEL_ID,
      kind: "channel",
      title: "shared-channel",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: nodeId,
      participantIds: sharedParticipants,
      metadata: { surface: "broker", channel: "shared" },
    };
  } else {
    definition = {
      id: `channel.${sanitizeConversationSegment(channel)}`,
      kind: "channel",
      title: channel,
      visibility: "workspace",
      shareMode: resolveConversationShareMode(snapshot, scopedParticipants, "local"),
      authorityNodeId: nodeId,
      participantIds: scopedParticipants,
      metadata: { surface: "broker", channel },
    };
  }

  const existing = snapshot.conversations[definition.id];
  const nextParticipants = [...new Set([...(existing?.participantIds ?? []), ...definition.participantIds])].sort();
  if (
    existing
    && existing.kind === definition.kind
    && existing.visibility === definition.visibility
    && existing.shareMode === definition.shareMode
    && existing.participantIds.join("\u0000") === nextParticipants.join("\u0000")
  ) {
    return existing;
  }

  const conversation: ConversationDefinition = {
    ...definition,
    participantIds: nextParticipants,
  };
  await upsertConversationDurably(conversation);
  return conversation;
}

function buildBrokerReturnAddressForActor(
  snapshot: ReturnType<typeof runtime.snapshot>,
  actorId: string,
  options: {
    conversationId?: string;
    replyToMessageId?: string;
    sessionId?: string;
  } = {},
) {
  const agent = snapshot.agents[actorId];
  const actor = snapshot.actors[actorId];
  const endpoint = homeEndpointForAgent(snapshot, actorId);
  return buildScoutReturnAddress({
    actorId,
    handle: agent?.handle?.trim() || actor?.handle?.trim() || actorId,
    displayName: agent?.displayName || actor?.displayName,
    selector: agent?.selector ?? metadataStringValue(agent?.metadata, "selector") ?? metadataStringValue(actor?.metadata, "selector") ?? undefined,
    defaultSelector: agent?.defaultSelector
      ?? metadataStringValue(agent?.metadata, "defaultSelector")
      ?? metadataStringValue(actor?.metadata, "defaultSelector")
      ?? undefined,
    conversationId: options.conversationId,
    replyToMessageId: options.replyToMessageId,
    nodeId: endpoint?.nodeId || agent?.authorityNodeId || agent?.homeNodeId,
    projectRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? metadataStringValue(agent?.metadata, "projectRoot") ?? undefined,
    sessionId: options.sessionId ?? endpoint?.sessionId,
  });
}

function describeUnavailableDeliveryTarget(
  snapshot: ReturnType<typeof runtime.snapshot>,
  agent: AgentDefinition,
): ScoutDispatchUnavailableTarget | null {
  const endpoint = homeEndpointForAgent(snapshot, agent.id);
  const projectRoot = brokerTargetProjectRoot(agent, endpoint);

  if (agent.metadata?.retiredFromFleet === true) {
    return {
      agentId: agent.id,
      displayName: agent.displayName ?? agent.id,
      reason: "retired",
      detail: `${agent.displayName ?? agent.id} is retired from the fleet and cannot receive new broker deliveries.`,
      wakePolicy: agent.wakePolicy,
      endpointState: endpoint?.state === "offline" ? "offline" : "unknown",
      transport: endpoint?.transport ?? null,
      projectRoot,
    };
  }

  if (agent.authorityNodeId && agent.authorityNodeId !== nodeId) {
    return describeRemoteAuthorityIssue(agent, snapshot.nodes[agent.authorityNodeId]);
  }

  if (agent.wakePolicy !== "manual") {
    return null;
  }

  if (endpoint && (endpoint.state === "active" || endpoint.state === "idle" || endpoint.state === "waiting")) {
    return null;
  }

  if (
    endpoint
    && isManagedLocalSessionMetadata(endpoint.metadata)
    && (endpoint.transport === "codex_app_server" || endpoint.transport === "claude_stream_json")
  ) {
    return null;
  }

  return {
    agentId: agent.id,
    displayName: agent.displayName ?? agent.id,
    reason: "manual_wake_required",
    detail: `${agent.displayName ?? agent.id} is currently offline with a manual wake policy, so the broker cannot bring it online without operator help.`,
    wakePolicy: agent.wakePolicy,
    endpointState: endpoint?.state === "offline"
      ? "offline"
      : endpoint?.state === "active" || endpoint?.state === "idle" || endpoint?.state === "waiting"
      ? "online"
      : "unknown",
    transport: endpoint?.transport ?? null,
    projectRoot,
  };
}

function buildUnavailableDispatchEnvelope(
  askedLabel: string,
  target: ScoutDispatchUnavailableTarget,
): ScoutDispatchEnvelope {
  return {
    kind: "unavailable",
    askedLabel,
    detail: target.detail,
    candidates: [],
    target,
    dispatchedAt: Date.now(),
    dispatcherNodeId: nodeId,
  };
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
    .filter((agent) => !isInactiveLocalAgent(agent))
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
    .filter((item) => !isReconciledStaleFlightActivityItem(item))
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
  if (activeInvocationTasks.has(flight.invocationId)) {
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

  const agent = snapshot.agents[flight.targetAgentId];
  if (isRetiredLocalAgent(agent)) {
    return `target agent ${flight.targetAgentId} was retired from the fleet`;
  }
  if (agent?.metadata?.staleLocalRegistration === true) {
    return `target agent ${flight.targetAgentId} is a stale local registration superseded by current setup`;
  }

  const dispatchEndpointReason = flightDispatchEndpointUnavailableReason(snapshot, flight);
  if (dispatchEndpointReason) {
    return dispatchEndpointReason;
  }

  const endpoint = endpointForFlight(snapshot, flight);
  if (!endpoint) {
    return null;
  }

  const staleEndpointReason = staleLocalEndpointReason(endpoint);
  if (staleEndpointReason) {
    return staleEndpointReason;
  }

  const terminalAt = endpointTerminalAt(endpoint);
  if (endpoint.state !== "active" && terminalAt > startedAt) {
    return `endpoint ${endpoint.id} moved to ${endpoint.state} at ${terminalAt}`;
  }

  const startedEndpointAt = endpointStartedAt(endpoint);
  const endpointInvocationId = endpointLastInvocationId(endpoint);
  if (
    endpoint.state === "active"
    && endpointInvocationId === flight.invocationId
    && !activeInvocationTasks.has(flight.invocationId)
    && startedEndpointAt >= startedAt
  ) {
    return `endpoint ${endpoint.id} was replayed active for invocation ${flight.invocationId} without a live broker task`;
  }
  if (
    endpoint.state === "active"
    && startedEndpointAt > startedAt
    && endpointInvocationId !== null
    && endpointInvocationId !== flight.invocationId
  ) {
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

function localAgentMetadataFlag(metadata: Record<string, unknown> | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

function isGeneratedLocalAgentMetadata(metadata: Record<string, unknown> | undefined): boolean {
  const source = localAgentMetadataSource(metadata);
  return source === "relay-agent-registry" || source === "project-inferred";
}

function isPairingSessionMetadata(metadata: Record<string, unknown> | undefined): boolean {
  return localAgentMetadataSource(metadata) === "pairing-session";
}

function isManagedPairingSessionMetadata(metadata: Record<string, unknown> | undefined): boolean {
  return isPairingSessionMetadata(metadata) && localAgentMetadataFlag(metadata, "managedByScout");
}

function isLegacyPairingSessionMetadata(metadata: Record<string, unknown> | undefined): boolean {
  return isPairingSessionMetadata(metadata) && !localAgentMetadataFlag(metadata, "managedByScout");
}

function isLocalSessionMetadata(metadata: Record<string, unknown> | undefined): boolean {
  return localAgentMetadataSource(metadata) === "local-session";
}

function isManagedLocalSessionMetadata(metadata: Record<string, unknown> | undefined): boolean {
  return isLocalSessionMetadata(metadata) && localAgentMetadataFlag(metadata, "managedByScout");
}

function pairingExternalSessionId(endpoint: AgentEndpoint): string | null {
  const direct = endpoint.sessionId?.trim();
  if (direct) {
    return direct;
  }

  const external = endpoint.metadata?.externalSessionId;
  return typeof external === "string" && external.trim().length > 0 ? external.trim() : null;
}

function normalizeManagedAgentSelector(value: string): string {
  const normalized = normalizeAgentSelectorSegment(value.trim().replace(/^@+/, ""));
  if (!normalized) {
    throw new Error("Alias must contain at least one alphanumeric character.");
  }
  return `@${normalized}`;
}

function selectorHandle(selector: string): string {
  return selector.replace(/^@+/, "");
}

function uniqueManagedAgentSelector(
  snapshot: ReturnType<typeof runtime.snapshot>,
  requestedSelector: string,
  currentAgentId?: string,
): string {
  const normalized = normalizeManagedAgentSelector(requestedSelector);
  const base = selectorHandle(normalized);
  let candidate = normalized;

  for (let counter = 2; counter <= 101; counter += 1) {
    const resolution = resolveAgentLabel(snapshot, candidate, {
      preferLocalNodeId: nodeId,
      helpers: { isStale: isInactiveLocalAgent },
    });

    if (resolution.kind === "unknown") {
      return candidate;
    }

    if (resolution.kind === "resolved" && resolution.agent.id === currentAgentId) {
      return candidate;
    }

    candidate = `@${base}-${counter}`;
  }

  throw new Error(`Unable to allocate a unique Scout alias for ${normalized}.`);
}

function pairingAgentDisplayName(session: PairingSession): string {
  return buildPairingSessionCandidate(session).name;
}

function buildManagedPairingAgent(input: {
  session: PairingSession;
  selector: string;
  displayName?: string;
}): AgentDefinition {
  const id = createRuntimeId("pairing-agent");
  const displayName = input.displayName?.trim() || pairingAgentDisplayName(input.session);
  const handle = selectorHandle(input.selector);
  return {
    id,
    kind: "agent",
    definitionId: id,
    displayName,
    handle,
    labels: ["pairing", "managed", input.session.adapterType],
    metadata: {
      source: "scout-managed",
      managedByScout: true,
      identityKind: "scout_managed_pairing_agent",
      externalSource: "pairing-session",
      selector: input.selector,
      defaultSelector: input.selector,
      sessionBacked: true,
    },
    selector: input.selector,
    defaultSelector: input.selector,
    agentClass: "general",
    capabilities: ["chat", "invoke", "deliver"],
    wakePolicy: "manual",
    homeNodeId: nodeId,
    authorityNodeId: nodeId,
    advertiseScope: "local",
  };
}

function updateManagedSessionAgent(
  agent: AgentDefinition,
  input: {
    selector?: string;
    displayName?: string;
  },
): AgentDefinition {
  const nextSelector = input.selector ?? agent.selector ?? agent.defaultSelector
    ?? (typeof agent.metadata?.selector === "string" ? String(agent.metadata.selector) : undefined);
  const nextDisplayName = input.displayName?.trim() || agent.displayName;
  const nextMetadata = {
    ...(agent.metadata ?? {}),
    managedByScout: true,
    sessionBacked: true,
    ...(nextSelector ? { selector: nextSelector, defaultSelector: nextSelector } : {}),
  };

  return {
    ...agent,
    displayName: nextDisplayName,
    handle: nextSelector ? selectorHandle(nextSelector) : agent.handle,
    selector: nextSelector,
    defaultSelector: nextSelector ?? agent.defaultSelector,
    metadata: nextMetadata,
  };
}

type ManagedLocalSessionTransport = "codex_app_server" | "claude_stream_json";

function managedLocalSessionDefaultDisplayName(input: {
  transport: ManagedLocalSessionTransport;
  projectRoot?: string;
  cwd: string;
}): string {
  const projectName = basename(input.projectRoot ?? input.cwd) || input.cwd;
  return input.transport === "codex_app_server"
    ? `Codex (${projectName})`
    : `Claude (${projectName})`;
}

function suggestedManagedLocalSessionSelector(input: {
  transport: ManagedLocalSessionTransport;
  projectRoot?: string;
  cwd: string;
}): string {
  const projectName = normalizeAgentSelectorSegment(basename(input.projectRoot ?? input.cwd) || "session") || "session";
  const prefix = input.transport === "codex_app_server" ? "codex" : "claude";
  return `@${prefix}-${projectName}`;
}

function buildManagedLocalSessionAgent(input: {
  transport: ManagedLocalSessionTransport;
  selector: string;
  cwd: string;
  projectRoot?: string;
  displayName?: string;
}): AgentDefinition {
  const id = createRuntimeId("local-session-agent");
  const displayName = input.displayName?.trim() || managedLocalSessionDefaultDisplayName(input);
  const handle = selectorHandle(input.selector);
  return {
    id,
    kind: "agent",
    definitionId: id,
    displayName,
    handle,
    labels: ["local-session", "managed", input.transport],
    metadata: {
      source: "scout-managed",
      managedByScout: true,
      identityKind: "scout_managed_local_session_agent",
      externalSource: "local-session",
      selector: input.selector,
      defaultSelector: input.selector,
      sessionBacked: true,
      attachedTransport: input.transport,
    },
    selector: input.selector,
    defaultSelector: input.selector,
    agentClass: "general",
    capabilities: ["chat", "invoke", "deliver"],
    wakePolicy: "manual",
    homeNodeId: nodeId,
    authorityNodeId: nodeId,
    advertiseScope: "local",
  };
}

function buildManagedLocalSessionEndpointBinding(input: {
  agentId: string;
  transport: ManagedLocalSessionTransport;
  harness: "codex" | "claude";
  sessionId: string;
  cwd: string;
  projectRoot?: string;
  existingEndpoint?: AgentEndpoint | null;
  selector?: string | null;
  definitionId?: string | null;
}): AgentEndpoint {
  const runtimeInstanceId = typeof input.existingEndpoint?.metadata?.runtimeInstanceId === "string"
    && input.existingEndpoint.metadata.runtimeInstanceId.trim().length > 0
    ? input.existingEndpoint.metadata.runtimeInstanceId.trim()
    : typeof input.existingEndpoint?.metadata?.runtimeSessionId === "string"
      && input.existingEndpoint.metadata.runtimeSessionId.trim().length > 0
      ? input.existingEndpoint.metadata.runtimeSessionId.trim()
      : `attached-${input.agentId}`;
  const projectRoot = resolve(input.projectRoot ?? input.cwd);
  const cwd = resolve(input.cwd);
  const projectName = basename(projectRoot) || projectRoot;
  const definitionId = input.definitionId?.trim() || selectorHandle(input.selector ?? input.agentId);

  return {
    id: input.existingEndpoint?.id ?? `endpoint.${input.agentId}.${nodeId}.${input.transport}`,
    agentId: input.agentId,
    nodeId,
    harness: input.harness,
    transport: input.transport,
    state: "idle",
    cwd,
    projectRoot,
    sessionId: input.sessionId,
    metadata: {
      ...(input.existingEndpoint?.metadata ?? {}),
      source: "local-session",
      managedByScout: true,
      sessionBacked: true,
      externalSource: "local-session",
      agentName: input.agentId,
      definitionId,
      runtimeSessionId: undefined,
      runtimeInstanceId,
      transport: input.transport,
      project: projectName,
      projectRoot,
      threadId: input.transport === "codex_app_server" ? input.sessionId : undefined,
      externalSessionId: input.sessionId,
      startedAt: String(Date.now()),
    },
  };
}

function buildManagedLocalSessionPairingEndpointBinding(input: {
  agentId: string;
  transport: ManagedLocalSessionTransport;
  threadId: string;
  session: PairingSession;
  cwd: string;
  projectRoot?: string;
  existingEndpoint?: AgentEndpoint | null;
  selector?: string | null;
  definitionId?: string | null;
}): AgentEndpoint {
  const projectRoot = resolve(input.projectRoot ?? input.cwd);
  const cwd = resolve(input.cwd);
  const projectName = basename(projectRoot) || projectRoot;
  const definitionId = input.definitionId?.trim() || selectorHandle(input.selector ?? input.agentId);
  const base = buildManagedPairingEndpointBinding({
    agentId: input.agentId,
    nodeId,
    session: input.session,
    existingEndpoint: input.existingEndpoint ?? null,
    agentName: input.agentId,
  });

  return {
    ...base,
    cwd,
    projectRoot,
    metadata: {
      ...(base.metadata ?? {}),
      source: "local-session",
      externalSource: "local-session",
      attachedTransport: input.transport,
      definitionId,
      agentName: input.agentId,
      project: projectName,
      projectRoot,
      threadId: input.threadId,
      externalSessionId: input.threadId,
      pairingSessionId: input.session.id,
      pairingAdapterType: input.session.adapterType,
      startedAt: String(Date.now()),
    },
  };
}

function managedPairingEndpointForAgent(
  snapshot: ReturnType<typeof runtime.snapshot>,
  agentId: string,
): AgentEndpoint | null {
  return Object.values(snapshot.endpoints).find((endpoint) => (
    endpoint.agentId === agentId
    && endpoint.transport === "pairing_bridge"
    && isManagedPairingSessionMetadata(endpoint.metadata)
  )) ?? null;
}

function managedPairingEndpoints(snapshot: ReturnType<typeof runtime.snapshot>): AgentEndpoint[] {
  return Object.values(snapshot.endpoints).filter((endpoint) => (
    endpoint.transport === "pairing_bridge"
    && endpoint.nodeId === nodeId
    && isManagedPairingSessionMetadata(endpoint.metadata)
  ));
}

function legacyPairingEndpoints(snapshot: ReturnType<typeof runtime.snapshot>): AgentEndpoint[] {
  return Object.values(snapshot.endpoints).filter((endpoint) => (
    endpoint.transport === "pairing_bridge"
    && endpoint.nodeId === nodeId
    && isLegacyPairingSessionMetadata(endpoint.metadata)
  ));
}

function managedLocalSessionEndpointForAgent(
  snapshot: ReturnType<typeof runtime.snapshot>,
  agentId: string,
): AgentEndpoint | null {
  return Object.values(snapshot.endpoints).find((endpoint) => (
    endpoint.agentId === agentId
    && endpoint.nodeId === nodeId
    && (
      endpoint.transport === "codex_app_server"
      || endpoint.transport === "claude_stream_json"
      || endpoint.transport === "pairing_bridge"
    )
    && isManagedLocalSessionMetadata(endpoint.metadata)
  )) ?? null;
}

function resolveManagedSessionAttachTarget(
  snapshot: ReturnType<typeof runtime.snapshot>,
  input: { agentId?: string; selector?: string },
): AgentDefinition | null {
  let target: AgentDefinition | null = null;

  const directAgentId = input.agentId?.trim();
  if (directAgentId) {
    const agent = snapshot.agents[directAgentId];
    if (!agent || isInactiveLocalAgent(agent)) {
      throw new Error(`unknown Scout agent ${directAgentId}`);
    }
    if (agent.authorityNodeId !== nodeId) {
      throw new Error(`agent ${directAgentId} is owned by ${agent.authorityNodeId}, not ${nodeId}`);
    }
    target = agent;
  }

  const selector = input.selector?.trim();
  if (!selector) {
    return target;
  }

  const resolution = resolveAgentLabel(snapshot, selector, {
    preferLocalNodeId: nodeId,
    helpers: { isStale: isInactiveLocalAgent },
  });

  switch (resolution.kind) {
    case "resolved":
      if (resolution.agent.authorityNodeId !== nodeId) {
        throw new Error(`alias ${selector} is owned by ${resolution.agent.authorityNodeId}, not ${nodeId}`);
      }
      if (target && target.id !== resolution.agent.id) {
        throw new Error(`alias ${selector} already resolves to ${resolution.agent.id}`);
      }
      return resolution.agent;
    case "ambiguous":
      throw new Error(`alias ${selector} is ambiguous across ${resolution.candidates.length} agents`);
    case "unparseable":
      throw new Error(`could not parse alias ${selector}`);
    case "unknown":
      return target;
  }
}

function sameSerializedRecord<T>(left: T | undefined, right: T): boolean {
  if (!left) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function staleLocalAgentReplacementId(
  definitionId: string | null,
  activeAgentIdsByDefinition: Map<string, string[]>,
): string | null {
  if (!definitionId) {
    return null;
  }

  const matches = activeAgentIdsByDefinition.get(definitionId) ?? [];
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  if (matches.length > 1) {
    // Prefer the agent on "main" or "master" branch when multiple share a definitionId.
    const mainCandidate = matches.find((id) => /\.(main|master)\./.test(id));
    return mainCandidate ?? matches[0] ?? null;
  }
  return null;
}

function staleRegistrationMetadataMatches(
  metadata: Record<string, unknown> | undefined,
  replacementAgentId: string | null,
): boolean {
  if (metadata?.staleLocalRegistration !== true) {
    return false;
  }
  const existingReplacement = typeof metadata.replacedByAgentId === "string"
    ? metadata.replacedByAgentId.trim()
    : "";
  return replacementAgentId
    ? existingReplacement === replacementAgentId
    : existingReplacement.length === 0;
}

function staleLocalRegistrationMetadata(
  metadata: Record<string, unknown> | undefined,
  staleAt: number,
  replacementAgentId: string | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(metadata ?? {}),
    staleLocalRegistration: true,
    staleAt,
  };
  if (replacementAgentId) {
    next.replacedByAgentId = replacementAgentId;
  } else {
    delete next.replacedByAgentId;
  }
  return next;
}

function clearStaleLocalEndpointMetadata(metadata: AgentEndpoint["metadata"]): AgentEndpoint["metadata"] {
  const {
    staleLocalRegistration,
    staleAt,
    replacedByAgentId,
    ...rest
  } = metadata ?? {};
  void staleLocalRegistration;
  void staleAt;
  void replacedByAgentId;
  return rest;
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
    if (agent?.authorityNodeId && agent.authorityNodeId !== nodeId) {
      continue;
    }
    if (isLocalAgentEndpointAlive(endpoint)) {
      if (endpoint.metadata?.staleLocalRegistration === true) {
        await persistEndpoint({
          ...endpoint,
          metadata: clearStaleLocalEndpointMetadata(endpoint.metadata),
        });
      }
      continue;
    }
    const replacementAgentId = staleLocalAgentReplacementId(
      typeof agent?.definitionId === "string" ? agent.definitionId : null,
      activeAgentIdsByDefinition,
    );

    if (agent && !staleRegistrationMetadataMatches(agent.metadata, replacementAgentId)) {
      await upsertAgentDurably({
        ...agent,
        metadata: staleLocalRegistrationMetadata(agent.metadata, staleAt, replacementAgentId),
      });
    }

    if (endpoint.state === "offline" && staleRegistrationMetadataMatches(endpoint.metadata, replacementAgentId)) {
      continue;
    }

    await persistEndpoint({
      ...endpoint,
      state: "offline",
      metadata: {
        ...staleLocalRegistrationMetadata(endpoint.metadata, staleAt, replacementAgentId),
        lastError: "stale local agent registration superseded by current setup",
        lastFailedAt: staleAt,
      },
    });
    console.log(`[openscout-runtime] archived stale local endpoint ${endpoint.id}`);
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
  await reconcileStaleWorkingFlights();
  await reconcileStaleLocalDeliveries();

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

  registeredLocalAgentsRegistrySignature = await relayAgentRegistrySignature();
}

async function retireLegacyPairingSessionAgents(): Promise<void> {
  const snapshot = runtime.snapshot();
  const retiredAt = Date.now();

  for (const endpoint of legacyPairingEndpoints(snapshot)) {
    const nextEndpoint = {
      ...endpoint,
      state: "offline" as const,
      metadata: {
        ...(endpoint.metadata ?? {}),
        legacyAutoSync: true,
        retiredFromFleet: true,
        stalePairingSession: true,
        retiredAt,
        lastError: "legacy pairing auto-sync retired; re-attach through Scout to manage this session",
        lastFailedAt: retiredAt,
      },
    };
    if (!sameSerializedRecord(endpoint, nextEndpoint)) {
      await persistEndpoint(nextEndpoint);
      console.log(`[openscout-runtime] retired legacy pairing endpoint ${endpoint.id}`);
    }
  }

  for (const agent of Object.values(snapshot.agents)) {
    if (!isLegacyPairingSessionMetadata(agent.metadata)) {
      continue;
    }
    if (agent.authorityNodeId && agent.authorityNodeId !== nodeId) {
      continue;
    }

    const nextAgent = {
      ...agent,
      metadata: {
        ...(agent.metadata ?? {}),
        legacyAutoSync: true,
        retiredFromFleet: true,
        stalePairingSession: true,
        retiredAt,
      },
    };
    if (!sameSerializedRecord(agent, nextAgent)) {
      await upsertAgentDurably(nextAgent);
      console.log(`[openscout-runtime] retired legacy pairing agent ${agent.id}`);
    }
  }
}

async function reconcileManagedPairingEndpoints(): Promise<void> {
  const snapshot = runtime.snapshot();

  for (const endpoint of managedPairingEndpoints(snapshot)) {
    const externalSessionId = pairingExternalSessionId(endpoint);
    if (!externalSessionId) {
      if (endpoint.state !== "offline") {
        await persistEndpoint({
          ...endpoint,
          state: "offline",
          metadata: {
            ...(endpoint.metadata ?? {}),
            stalePairingSession: true,
            lastError: "pairing binding has no active external session id",
            lastFailedAt: Date.now(),
          },
        });
      }
      continue;
    }

    const sessionSnapshot = await getPairingSessionSnapshot(externalSessionId);
    if (!sessionSnapshot) {
      const nextEndpoint = {
        ...endpoint,
        state: "offline" as const,
        metadata: {
          ...(endpoint.metadata ?? {}),
          stalePairingSession: true,
          lastError: `pairing session ${externalSessionId} is offline or unreachable`,
          lastFailedAt: Date.now(),
        },
      };
      if (!sameSerializedRecord(endpoint, nextEndpoint)) {
        await persistEndpoint(nextEndpoint);
        console.log(`[openscout-runtime] reconciled offline pairing binding ${endpoint.id}`);
      }
      continue;
    }

    const agent = snapshot.agents[endpoint.agentId];
    const nextEndpoint = buildManagedPairingEndpointBinding({
      agentId: endpoint.agentId,
      nodeId,
      session: sessionSnapshot.session,
      existingEndpoint: endpoint,
      agentName: agent?.handle ?? agent?.displayName ?? endpoint.agentId,
    });
    if (!sameSerializedRecord(endpoint, nextEndpoint)) {
      await persistEndpoint(nextEndpoint);
      console.log(`[openscout-runtime] reconciled pairing binding ${endpoint.id} -> ${externalSessionId}`);
    }
  }
}

async function attachManagedPairingSession(input: {
  externalSessionId: string;
  agentId?: string;
  alias?: string;
  displayName?: string;
}): Promise<{ agentId: string; selector: string | null; endpointId: string }> {
  const externalSessionId = input.externalSessionId.trim();
  if (!externalSessionId) {
    throw new Error("externalSessionId is required");
  }

  const session = await findPairingSession(externalSessionId);
  if (!session) {
    throw new Error(`pairing session ${externalSessionId} is not available`);
  }

  const requestedSelector = input.alias?.trim()
    ? normalizeManagedAgentSelector(input.alias)
    : undefined;
  const snapshot = runtime.snapshot();
  const existingAgent = resolveManagedSessionAttachTarget(snapshot, {
    agentId: input.agentId,
    selector: requestedSelector,
  });

  const targetSelector = existingAgent
    ? (
      requestedSelector
      ?? existingAgent.selector
      ?? existingAgent.defaultSelector
      ?? (typeof existingAgent.metadata?.selector === "string" ? String(existingAgent.metadata.selector) : null)
      ?? uniqueManagedAgentSelector(snapshot, buildPairingSessionCandidate(session).suggestedSelector, existingAgent.id)
    )
    : uniqueManagedAgentSelector(
      snapshot,
      requestedSelector ?? buildPairingSessionCandidate(session).suggestedSelector,
    );

  const agent = existingAgent
    ? updateManagedSessionAgent(existingAgent, {
      selector: targetSelector ?? undefined,
      displayName: input.displayName,
    })
    : buildManagedPairingAgent({
      session,
      selector: targetSelector ?? uniqueManagedAgentSelector(snapshot, buildPairingSessionCandidate(session).suggestedSelector),
      displayName: input.displayName,
    });

  await upsertAgentDurably(agent);

  const existingEndpoint = managedPairingEndpointForAgent(runtime.snapshot(), agent.id);
  const endpoint = buildManagedPairingEndpointBinding({
    agentId: agent.id,
    nodeId,
    session,
    existingEndpoint,
    agentName: agent.handle ?? agent.displayName,
  });
  await persistEndpoint(endpoint);

  return {
    agentId: agent.id,
    selector: agent.selector ?? agent.defaultSelector ?? null,
    endpointId: endpoint.id,
  };
}

async function detachManagedPairingSession(input: {
  agentId?: string;
  alias?: string;
}): Promise<{ agentId: string; endpointId: string | null; detached: boolean }> {
  const requestedSelector = input.alias?.trim()
    ? normalizeManagedAgentSelector(input.alias)
    : undefined;
  const snapshot = runtime.snapshot();
  const agent = resolveManagedSessionAttachTarget(snapshot, {
    agentId: input.agentId,
    selector: requestedSelector,
  });

  if (!agent) {
    throw new Error("Detach requires an existing Scout-managed agent id or alias.");
  }

  const endpoint = managedPairingEndpointForAgent(snapshot, agent.id);
  if (!endpoint) {
    return { agentId: agent.id, endpointId: null, detached: false };
  }

  const detachedAt = Date.now();
  const nextEndpoint = {
    ...endpoint,
    state: "offline" as const,
    sessionId: undefined,
    metadata: {
      ...(endpoint.metadata ?? {}),
      detachedAt,
      stalePairingSession: false,
      externalSessionId: undefined,
      pairingSessionId: undefined,
      lastError: "pairing session detached",
      lastFailedAt: detachedAt,
    },
  };
  await persistEndpoint(nextEndpoint);
  return {
    agentId: agent.id,
    endpointId: nextEndpoint.id,
    detached: true,
  };
}

async function attachManagedLocalSession(input: {
  externalSessionId: string;
  transport: ManagedLocalSessionTransport;
  cwd: string;
  projectRoot?: string;
  agentId?: string;
  alias?: string;
  displayName?: string;
}): Promise<{ agentId: string; selector: string | null; endpointId: string; sessionId: string }> {
  const externalSessionId = input.externalSessionId.trim();
  if (!externalSessionId) {
    throw new Error("externalSessionId is required");
  }

  if (input.transport !== "codex_app_server" && input.transport !== "claude_stream_json") {
    throw new Error(`unsupported local session transport ${input.transport}`);
  }

  if (input.transport !== "codex_app_server") {
    throw new Error("local session attach currently supports codex_app_server only");
  }

  const cwd = resolve(input.cwd.trim() || process.cwd());
  const projectRoot = resolve(input.projectRoot?.trim() || cwd);
  const requestedSelector = input.alias?.trim()
    ? normalizeManagedAgentSelector(input.alias)
    : undefined;
  const snapshot = runtime.snapshot();
  const existingAgent = resolveManagedSessionAttachTarget(snapshot, {
    agentId: input.agentId,
    selector: requestedSelector,
  });

  const targetSelector = existingAgent
    ? (
      requestedSelector
      ?? existingAgent.selector
      ?? existingAgent.defaultSelector
      ?? (typeof existingAgent.metadata?.selector === "string" ? String(existingAgent.metadata.selector) : null)
      ?? uniqueManagedAgentSelector(
        snapshot,
        suggestedManagedLocalSessionSelector({ transport: input.transport, cwd, projectRoot }),
        existingAgent.id,
      )
    )
    : uniqueManagedAgentSelector(
      snapshot,
      requestedSelector ?? suggestedManagedLocalSessionSelector({ transport: input.transport, cwd, projectRoot }),
    );

  const agent = existingAgent
    ? updateManagedSessionAgent(existingAgent, {
      selector: targetSelector ?? undefined,
      displayName: input.displayName,
    })
    : buildManagedLocalSessionAgent({
      transport: input.transport,
      selector: targetSelector ?? uniqueManagedAgentSelector(snapshot, suggestedManagedLocalSessionSelector({ transport: input.transport, cwd, projectRoot })),
      cwd,
      projectRoot,
      displayName: input.displayName,
    });

  const existingEndpoint = managedLocalSessionEndpointForAgent(runtime.snapshot(), agent.id);
  const session = await ensurePairingSessionForCodexThread({
    threadId: externalSessionId,
    cwd,
    name: input.displayName?.trim() || managedLocalSessionDefaultDisplayName({ transport: input.transport, cwd, projectRoot }),
    systemPrompt: "Resume the existing session without changing its identity or prior context.",
  });
  const endpoint = buildManagedLocalSessionPairingEndpointBinding({
    agentId: agent.id,
    transport: input.transport,
    threadId: externalSessionId,
    session,
    cwd,
    projectRoot,
    existingEndpoint,
    selector: agent.selector ?? agent.defaultSelector ?? null,
    definitionId: agent.handle ?? agent.displayName,
  });

  if (existingEndpoint && existingEndpoint.transport !== "pairing_bridge") {
    await shutdownLocalSessionEndpoint(existingEndpoint).catch(() => undefined);
  }
  await upsertAgentDurably(agent);
  await persistEndpoint(endpoint);

  return {
    agentId: agent.id,
    selector: agent.selector ?? agent.defaultSelector ?? null,
    endpointId: endpoint.id,
    sessionId: endpoint.sessionId ?? session.id,
  };
}

async function detachManagedLocalSession(input: {
  agentId?: string;
  alias?: string;
}): Promise<{ agentId: string; endpointId: string | null; detached: boolean }> {
  const requestedSelector = input.alias?.trim()
    ? normalizeManagedAgentSelector(input.alias)
    : undefined;
  const snapshot = runtime.snapshot();
  const agent = resolveManagedSessionAttachTarget(snapshot, {
    agentId: input.agentId,
    selector: requestedSelector,
  });

  if (!agent) {
    throw new Error("Detach requires an existing Scout-managed agent id or alias.");
  }

  const endpoint = managedLocalSessionEndpointForAgent(snapshot, agent.id);
  if (!endpoint) {
    return { agentId: agent.id, endpointId: null, detached: false };
  }

  if (endpoint.transport !== "pairing_bridge") {
    await shutdownLocalSessionEndpoint(endpoint).catch(() => undefined);
  }
  const detachedAt = Date.now();
  const nextEndpoint = {
    ...endpoint,
    state: "offline" as const,
    metadata: {
      ...(endpoint.metadata ?? {}),
      detachedAt,
      lastError: "local session detached",
      lastFailedAt: detachedAt,
    },
  };
  await persistEndpoint(nextEndpoint);
  return {
    agentId: agent.id,
    endpointId: nextEndpoint.id,
    detached: true,
  };
}

async function ensureCoreLocalAgentsOnline(): Promise<void> {
  if (configuredCoreAgentIds.length === 0) {
    console.log("[openscout-runtime] no configured core local agents to warm");
    return;
  }

  // configuredCoreAgentIds may be either fully-qualified agent IDs or bare
  // definitionIds (e.g. "ranger"). Resolve each to the concrete qualified ID
  // registered on this node so the lookup works regardless of branch.
  const overrides = await readRelayAgentOverrides();
  const resolvedIds = configuredCoreAgentIds.map((configuredId) =>
    resolveConfiguredCoreAgentId(configuredId, overrides),
  );

  const coreBindings = await loadRegisteredLocalAgentBindings(nodeId, {
    ensureOnline: true,
    agentIds: resolvedIds,
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

function resolveConfiguredCoreAgentId(
  configuredId: string,
  overrides: Awaited<ReturnType<typeof readRelayAgentOverrides>>,
): string {
  if (overrides[configuredId]) {
    return configuredId;
  }

  const matches = Object.entries(overrides)
    .filter(([registeredId, override]) => {
      const definitionId = override.definitionId ?? registeredId.split(".")[0];
      return definitionId === configuredId;
    })
    .map(([registeredId]) => registeredId);
  if (matches.length === 0) {
    return configuredId;
  }

  return matches.sort((left, right) =>
    coreAgentPreferenceRank(left) - coreAgentPreferenceRank(right)
      || left.localeCompare(right),
  )[0]!;
}

function coreAgentPreferenceRank(agentId: string): number {
  if (/\.(main)\./.test(agentId)) {
    return 0;
  }
  if (/\.(master)\./.test(agentId)) {
    return 1;
  }
  return 2;
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

function hasReachableMeshEntrypoint(node: NodeDefinition | undefined): boolean {
  return Boolean(node?.meshEntrypoints?.some((entrypoint) =>
    entrypoint.kind === "iroh"
    && entrypoint.alpn === OPENSCOUT_IROH_MESH_ALPN
    && entrypoint.bridgeProtocolVersion === OPENSCOUT_MESH_PROTOCOL_VERSION
  ));
}

function isReachableMeshNode(node: NodeDefinition | undefined): node is NodeDefinition {
  return Boolean(node?.brokerUrl || hasReachableMeshEntrypoint(node));
}

function meshNodeLastSeenAt(node: NodeDefinition | undefined): number {
  return typeof node?.lastSeenAt === "number" && Number.isFinite(node.lastSeenAt)
    ? node.lastSeenAt
    : typeof node?.registeredAt === "number" && Number.isFinite(node.registeredAt)
    ? node.registeredAt
    : 0;
}

function isStaleMeshAuthorityNode(node: NodeDefinition | undefined): boolean {
  if (!node) {
    return false;
  }
  const lastSeenAt = meshNodeLastSeenAt(node);
  return lastSeenAt > 0 && Date.now() - lastSeenAt > STALE_MESH_AUTHORITY_NODE_MS;
}

function formatMeshNodeLastSeen(node: NodeDefinition | undefined): string {
  const lastSeenAt = meshNodeLastSeenAt(node);
  if (!lastSeenAt) {
    return "with no recent heartbeat";
  }
  return `last seen ${new Date(lastSeenAt).toISOString()}`;
}

function describeRemoteAuthorityIssue(
  agent: AgentDefinition,
  authorityNode: NodeDefinition | undefined,
): ScoutDispatchUnavailableTarget | null {
  const displayName = agent.displayName ?? agent.id;
  const authorityNodeId = agent.authorityNodeId;
  if (!authorityNodeId || authorityNodeId === nodeId) {
    return null;
  }

  const nodeLabel = authorityNode?.name
    ? `${authorityNode.name} (${authorityNodeId})`
    : authorityNodeId;

  const unavailable = !authorityNode || !isReachableMeshNode(authorityNode);
  const stale = isStaleMeshAuthorityNode(authorityNode);
  if (!unavailable && !stale) {
    return null;
  }

  const endpoint = homeEndpointForAgent(runtime.snapshot(), agent.id);
  const projectRoot = brokerTargetProjectRoot(agent, endpoint);
  const detail = unavailable
    ? `${displayName} belongs to peer node ${nodeLabel}, but that peer has no reachable broker URL or mesh entrypoint.`
    : `${displayName} belongs to peer node ${nodeLabel}, but that peer is stale (${formatMeshNodeLastSeen(authorityNode)}).`;

  return {
    agentId: agent.id,
    displayName,
    reason: "unknown",
    detail,
    wakePolicy: agent.wakePolicy,
    endpointState: endpoint?.state === "active" || endpoint?.state === "idle" || endpoint?.state === "waiting"
      ? "online"
      : endpoint?.state === "offline"
      ? "offline"
      : "unknown",
    transport: endpoint?.transport ?? null,
    projectRoot,
  };
}

function authorityNodeForConversation(conversationId: string): {
  conversation: ConversationDefinition;
  authorityNode: NodeDefinition;
} | null {
  const conversation = runtime.conversation(conversationId);
  if (!conversation || conversation.authorityNodeId === nodeId) {
    return null;
  }

  const authorityNode = runtime.node(conversation.authorityNodeId);
  if (!isReachableMeshNode(authorityNode)) {
    throw new Error(`authority node ${conversation.authorityNodeId} is not reachable`);
  }

  return { conversation, authorityNode };
}

async function forwardConversationMessageToAuthority(message: MessageRecord): Promise<{
  forwarded: true;
  authorityNodeId: string;
  duplicate?: boolean;
  deliveries?: DeliveryIntent[];
}> {
  const authority = authorityNodeForConversation(message.conversationId);
  if (!authority) {
    throw new Error(`conversation ${message.conversationId} is locally owned`);
  }

  const bundle = buildMeshMessageBundle(runtime.peek(), currentLocalNode(), message, {
    bindings: runtime.bindingsForConversation(authority.conversation.id),
  });
  const result = await forwardMeshMessage(authority.authorityNode, bundle);
  return {
    forwarded: true,
    authorityNodeId: authority.conversation.authorityNodeId,
    duplicate: result.duplicate,
    deliveries: result.deliveries,
  };
}

async function forwardCollaborationRecordToAuthority(record: CollaborationRecord): Promise<{
  forwarded: true;
  authorityNodeId: string;
  duplicate?: boolean;
}> {
  if (!record.conversationId) {
    throw new Error(`collaboration record ${record.id} is not thread-scoped`);
  }

  const authority = authorityNodeForConversation(record.conversationId);
  if (!authority) {
    throw new Error(`conversation ${record.conversationId} is locally owned`);
  }

  const bundle = buildMeshCollaborationRecordBundle(runtime.peek(), currentLocalNode(), record);
  const result = await forwardMeshCollaborationRecord(authority.authorityNode, bundle);
  return {
    forwarded: true,
    authorityNodeId: authority.conversation.authorityNodeId,
    duplicate: result.duplicate,
  };
}

async function forwardCollaborationEventToAuthority(event: CollaborationEvent): Promise<{
  forwarded: true;
  authorityNodeId: string;
  duplicate?: boolean;
}> {
  const record = runtime.collaborationRecord(event.recordId);
  if (!record?.conversationId) {
    throw new Error(`collaboration event ${event.id} is not thread-scoped`);
  }

  const authority = authorityNodeForConversation(record.conversationId);
  if (!authority) {
    throw new Error(`conversation ${record.conversationId} is locally owned`);
  }

  const bundle = buildMeshCollaborationEventBundle(runtime.peek(), currentLocalNode(), event, record);
  const result = await forwardMeshCollaborationEvent(authority.authorityNode, bundle);
  return {
    forwarded: true,
    authorityNodeId: authority.conversation.authorityNodeId,
    duplicate: result.duplicate,
  };
}

async function maybeForwardFlightToAuthority(flight: FlightRecord): Promise<void> {
  const invocation = knownInvocations.get(flight.invocationId);
  if (!invocation?.conversationId) {
    return;
  }

  const authority = authorityNodeForConversation(invocation.conversationId);
  if (!authority) {
    return;
  }
  if (!authority.authorityNode.brokerUrl) {
    return;
  }

  await brokerPostJson<{ ok: boolean }>(authority.authorityNode.brokerUrl!, "/v1/flights", flight);
}

async function retireConsumedOneTimeCardsForMessage(message: MessageRecord): Promise<void> {
  if (message.class !== "agent" || message.actorId === systemActor.id) {
    return;
  }
  const conversation = runtime.conversation(message.conversationId);
  if (!conversation || conversation.kind !== "direct") {
    return;
  }
  const retired = await retireConsumedOneTimeLocalAgentCards({
    conversationId: conversation.id,
    actorId: message.actorId,
    participantIds: conversation.participantIds,
  }).catch((error) => {
    console.warn(`[openscout-runtime] one-time card cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });
  if (retired.length === 0) {
    return;
  }
  console.log(
    `[openscout-runtime] retired ${retired.length} consumed one-time card${retired.length === 1 ? "" : "s"}`,
  );
  await syncRegisteredLocalAgentsIfChanged("one-time card consumed").catch((error) => {
    console.warn(`[openscout-runtime] one-time card broker sync failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function postConversationMessage(
  message: MessageRecord,
): Promise<{
  ok: true;
  message: MessageRecord;
  deliveries: DeliveryIntent[];
  forwarded?: true;
  authorityNodeId?: string;
  duplicate?: boolean;
}> {
  const authority = authorityNodeForConversation(message.conversationId);
  if (authority) {
    const forwarded = await forwardConversationMessageToAuthority(message);
    return {
      ok: true,
      message,
      deliveries: forwarded.deliveries ?? [],
      ...forwarded,
    };
  }

  const { deliveries, entries } = await recordMessageDurably(message, {
    enqueueProjection: false,
  });
  await forwardPeerBrokerDeliveries(message, deliveries);
  await applyProjectedEntries(entries);
  await reconcileStaleLocalDeliveries();
  await retireConsumedOneTimeCardsForMessage(message);
  await completeInvocationsForBrokerReply(message);
  return { ok: true, message, deliveries };
}

async function postInvocationStatusMessage(
  invocation: InvocationRequest,
  flight: {
    id?: string;
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
      ...(flight.id ? { flightId: flight.id } : {}),
      invocationId: invocation.id,
      source: "broker",
      targetAgentId: invocation.targetAgentId,
    },
  });
}

function existingBrokerReplyForInvocation(
  invocation: InvocationRequest,
  agentId: string,
  sinceMs: number,
): MessageRecord | null {
  if (!invocation.conversationId || !invocation.messageId) {
    return null;
  }

  const since = Math.max(0, sinceMs - 5_000);
  const replies = Object.values(runtime.peek().messages)
    .filter((message) =>
      message.conversationId === invocation.conversationId
      && message.replyToMessageId === invocation.messageId
      && message.actorId === agentId
      && message.class === "agent"
      && message.createdAt >= since
    )
    .sort((lhs, rhs) => rhs.createdAt - lhs.createdAt);

  return replies[0] ?? null;
}

function messageAnswersInvocation(message: MessageRecord, invocation: InvocationRequest): boolean {
  if (invocation.action === "wake") {
    return false;
  }
  if (!invocation.conversationId || !invocation.messageId) {
    return false;
  }
  return message.class === "agent"
    && message.actorId === invocation.targetAgentId
    && message.conversationId === invocation.conversationId
    && message.replyToMessageId === invocation.messageId
    && message.body.trim().length > 0;
}

function completedFlightFromBrokerReply(
  invocation: InvocationRequest,
  flight: FlightRecord,
  reply: MessageRecord,
): FlightRecord {
  const agent = runtime.agent(invocation.targetAgentId);
  const replySource = metadataStringValue(reply.metadata, "source");
  return {
    ...flight,
    state: "completed",
    summary: `${agent?.displayName ?? invocation.targetAgentId} replied.`,
    output: reply.body,
    error: undefined,
    completedAt: reply.createdAt,
    metadata: {
      ...(flight.metadata ?? {}),
      completedByBrokerReply: true,
      replyMessageId: reply.id,
      ...(replySource ? { replySource } : {}),
    },
  };
}

async function completeInvocationForBrokerReply(
  invocation: InvocationRequest,
  reply: MessageRecord,
): Promise<boolean> {
  const flight = runtime.flightForInvocation(invocation.id);
  if (!flight || !isWorkingFlightState(flight.state)) {
    return false;
  }
  const startedAt = flight.startedAt ?? invocation.createdAt;
  if (reply.createdAt < Math.max(0, startedAt - 5_000)) {
    return false;
  }

  await persistFlight(completedFlightFromBrokerReply(invocation, flight, reply));
  return true;
}

async function completeInvocationsForBrokerReply(message: MessageRecord): Promise<void> {
  if (message.class !== "agent" || !message.replyToMessageId || !message.body.trim()) {
    return;
  }

  const invocations = Object.values(runtime.snapshot().invocations)
    .filter((invocation) => messageAnswersInvocation(message, invocation));
  for (const invocation of invocations) {
    await completeInvocationForBrokerReply(invocation, message);
  }
}

function endpointMatchesTargetSession(endpoint: AgentEndpoint, sessionId: string): boolean {
  return endpoint.sessionId?.trim() === sessionId || endpoint.id === sessionId;
}

function invocationTargetSessionId(invocation: InvocationRequest): string | undefined {
  return invocation.execution?.targetSessionId?.trim()
    || metadataStringValue(invocation.metadata, "targetSessionId")
    || undefined;
}

function activeLocalEndpointForAgent(
  agentId: string,
  harness?: AgentEndpoint["harness"],
  targetSessionId?: string,
): AgentEndpoint | undefined {
  const candidates = runtime.endpointsForAgent(agentId, {
    nodeId,
    harness,
  }).filter((endpoint) => {
    if (endpoint.metadata?.staleLocalRegistration === true) {
      return false;
    }
    return targetSessionId ? endpointMatchesTargetSession(endpoint, targetSessionId) : true;
  });
  return candidates.find((endpoint) => (
    endpoint.transport === "pairing_bridge"
      ? endpoint.state !== "offline"
      : isLocalAgentEndpointAlive(endpoint)
  ));
}

function dispatchAckStrategyForEndpoint(input: {
  invocation: InvocationRequest;
  endpoint: AgentEndpoint;
  previousEndpoint?: AgentEndpoint;
}): string {
  if (input.invocation.execution?.session === "existing") {
    return "steer";
  }
  if (input.previousEndpoint?.id === input.endpoint.id) {
    return "attach";
  }
  const lastResumedAt = Number(input.endpoint.metadata?.lastResumedAt);
  if (Number.isFinite(lastResumedAt) && Date.now() - lastResumedAt < 10_000) {
    return "wake";
  }
  if (input.invocation.ensureAwake) {
    return "spawn";
  }
  return "queued";
}

function onlineConversationNotifyTargets(
  conversation: ConversationDefinition,
  requesterId: string,
): string[] {
  return conversation.participantIds.filter((participantId) => {
    if (participantId === requesterId) {
      return false;
    }
    if (!runtime.agent(participantId)) {
      return false;
    }
    return Boolean(activeLocalEndpointForAgent(participantId));
  });
}

async function reviveManagedLocalSessionEndpoint(endpoint: AgentEndpoint): Promise<AgentEndpoint | null> {
  if (!isManagedLocalSessionMetadata(endpoint.metadata)) {
    return null;
  }

  const sessionResult = await ensureLocalSessionEndpointOnline(endpoint);
  const externalSessionId = sessionResult.externalSessionId?.trim();
  const { lastError: _lastError, lastFailedAt: _lastFailedAt, ...baseMetadata } = endpoint.metadata ?? {};
  const revivedEndpoint: AgentEndpoint = {
    ...endpoint,
    state: "idle",
    ...(externalSessionId ? { sessionId: externalSessionId } : {}),
    metadata: {
      ...baseMetadata,
      lastResumedAt: Date.now(),
      ...(externalSessionId ? {
        externalSessionId,
        ...(endpoint.transport === "codex_app_server" ? { threadId: externalSessionId } : {}),
      } : {}),
    },
  };
  await persistEndpoint(revivedEndpoint);
  return revivedEndpoint;
}

async function resolveLocalEndpointForInvocation(invocation: InvocationRequest): Promise<AgentEndpoint | undefined> {
  const requestedHarness = invocation.execution?.harness;
  const targetSessionId = invocationTargetSessionId(invocation);
  const sessionPreference = invocation.execution?.session ?? "new";
  const existing = activeLocalEndpointForAgent(
    invocation.targetAgentId,
    requestedHarness,
    targetSessionId,
  );
  if (existing && (sessionPreference !== "new" || existing.transport === "pairing_bridge")) {
    return existing;
  }

  const staleEndpoints = runtime.endpointsForAgent(invocation.targetAgentId, {
    nodeId,
    harness: requestedHarness,
  }).filter((endpoint) =>
    endpoint.id !== existing?.id
    && (targetSessionId ? endpointMatchesTargetSession(endpoint, targetSessionId) : true)
  );
  const staleLocalReason = staleEndpoints
    .map((endpoint) => staleLocalEndpointReason(endpoint))
    .find((reason): reason is string => Boolean(reason));
  if (staleLocalReason) {
    throw new Error(staleLocalReason);
  }

  if (invocation.ensureAwake) {
    for (const endpoint of staleEndpoints) {
      try {
        const revived = await reviveManagedLocalSessionEndpoint(endpoint);
        if (revived) return revived;
      } catch (error) {
        await persistEndpoint({
          ...endpoint,
          state: "offline",
          metadata: {
            ...(endpoint.metadata ?? {}),
            lastError: error instanceof Error ? error.message : String(error),
            lastFailedAt: Date.now(),
          },
        });
      }
    }
  }

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

  if (sessionPreference === "existing") {
    return undefined;
  }

  if (targetSessionId) {
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
  const agent = runtime.agent(invocation.targetAgentId);
  let endpoint: AgentEndpoint | undefined;
  const previousEndpoint = activeLocalEndpointForAgent(
    invocation.targetAgentId,
    invocation.execution?.harness,
    invocationTargetSessionId(invocation),
  );

  try {
    endpoint = await resolveLocalEndpointForInvocation(invocation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedFlight = {
      ...initialFlight,
      state: "failed" as const,
      summary: `${agent?.displayName ?? invocation.targetAgentId} could not be prepared.`,
      error: `Endpoint resolution failed before execution: ${message}`,
      completedAt: Date.now(),
      metadata: {
        ...(initialFlight.metadata ?? {}),
        failureStage: "endpoint_resolution",
      },
    };
    await persistFlight(failedFlight);
    await postInvocationStatusMessage(invocation, failedFlight);
    return;
  }

  if (!agent || !endpoint) {
    const staleEndpointReason = staleLocalEndpointReason(
      latestEndpointForAgent(runtime.snapshot(), invocation.targetAgentId),
    );
    if (staleEndpointReason) {
      const failedFlight = {
        ...initialFlight,
        state: "failed" as const,
        summary: `${agent?.displayName ?? invocation.targetAgentId} could not be prepared.`,
        error: `Endpoint resolution failed before execution: ${staleEndpointReason}`,
        completedAt: Date.now(),
        metadata: {
          ...(initialFlight.metadata ?? {}),
          failureStage: "endpoint_resolution",
          staleLocalRegistration: true,
        },
      };
      await persistFlight(failedFlight);
      await postInvocationStatusMessage(invocation, failedFlight);
      return;
    }

    const queuedFlight = {
      ...initialFlight,
      state: "queued" as const,
      summary: `Message stored for ${agent?.displayName ?? invocation.targetAgentId}. Will deliver when online.`,
    };
    await persistFlight(queuedFlight);
    return;
  }

  if (
    endpoint.transport !== "pairing_bridge"
    && endpoint.transport !== "tmux"
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

  const dispatchAck = {
    strategy: dispatchAckStrategyForEndpoint({
      invocation,
      endpoint: runningEndpoint,
      previousEndpoint,
    }),
    endpointId: runningEndpoint.id,
    transport: runningEndpoint.transport,
    harness: runningEndpoint.harness,
    sessionId: runningEndpoint.sessionId ?? null,
    nodeId: runningEndpoint.nodeId,
    acknowledgedAt: Date.now(),
  };
  const runningFlight = {
    ...initialFlight,
    state: "running" as const,
    summary: `${agent.displayName} acknowledged via ${dispatchAck.strategy}.`,
    error: undefined,
    completedAt: undefined,
    metadata: {
      ...(initialFlight.metadata ?? {}),
      dispatchAck,
    },
  };
  await persistFlight(runningFlight);

  try {
    const result = endpoint.transport === "pairing_bridge"
      ? await invokePairingSessionEndpoint(runningEndpoint, invocation)
      : await invokeLocalAgentEndpoint(runningEndpoint, invocation);
    const rawResultExternalSessionId = "externalSessionId" in result ? result.externalSessionId : undefined;
    const resultExternalSessionId = typeof rawResultExternalSessionId === "string" && rawResultExternalSessionId.trim()
      ? rawResultExternalSessionId.trim()
      : undefined;
    const completedEndpoint: AgentEndpoint = {
      ...runningEndpoint,
      ...(resultExternalSessionId ? { sessionId: resultExternalSessionId } : {}),
      metadata: {
        ...(runningEndpoint.metadata ?? {}),
        lastCompletedAt: Date.now(),
        ...(resultExternalSessionId ? {
          externalSessionId: resultExternalSessionId,
          ...(runningEndpoint.transport === "codex_app_server" ? { threadId: resultExternalSessionId } : {}),
        } : {}),
      },
    };

    if (invocation.action === "wake") {
      const completedFlight = {
        ...runningFlight,
        state: "completed" as const,
        summary: `${agent.displayName} received the message.`,
        output: result.output,
        completedAt: Date.now(),
      };
      await persistFlight(completedFlight);

      await persistEndpoint({
        ...completedEndpoint,
        state: "idle",
      });
      return;
    }

    const currentFlight = runtime.flightForInvocation(invocation.id);
    if (currentFlight && isTerminalFlightState(currentFlight.state)) {
      await persistEndpoint({
        ...completedEndpoint,
        state: "idle",
      });
      return;
    }

    const postedReply = existingBrokerReplyForInvocation(
      invocation,
      agent.id,
      runningFlight.startedAt ?? Date.now(),
    );
    const output = postedReply?.body || result.output;
    if (!output.trim()) {
      const failedFlight = {
        ...runningFlight,
        state: "failed" as const,
        summary: `${agent.displayName} returned an empty reply.`,
        error: `Local agent ${agent.id} completed without broker-visible output.`,
        completedAt: Date.now(),
        metadata: {
          ...(runningFlight.metadata ?? {}),
          failureStage: "empty_reply",
        },
      };
      await persistFlight(failedFlight);

      await persistEndpoint({
        ...runningEndpoint,
        state: "idle",
        metadata: {
          ...(runningEndpoint.metadata ?? {}),
          lastFailedAt: Date.now(),
          lastError: failedFlight.error,
        },
      });

      await postInvocationStatusMessage(invocation, failedFlight);
      return;
    }

    const completedFlight = {
      ...runningFlight,
      state: "completed" as const,
      summary: `${agent.displayName} replied.`,
      output,
      completedAt: Date.now(),
    };
    await persistFlight(completedFlight);

    await persistEndpoint({
      ...completedEndpoint,
      state: "idle",
    });

    if (invocation.conversationId && !postedReply) {
      const conversation = runtime.conversation(invocation.conversationId);
      if (conversation) {
        await postConversationMessage({
          id: createRuntimeId("msg"),
          conversationId: invocation.conversationId,
          actorId: agent.id,
          originNodeId: nodeId,
          class: "agent",
          body: output,
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
            ...scoutbotReplyProvenanceMetadata(invocation),
            returnAddress: buildScoutReturnAddress({
              actorId: agent.id,
              handle: agent.handle?.trim() || agent.definitionId,
              displayName: agent.displayName,
              selector: agent.selector,
              defaultSelector: agent.defaultSelector,
              conversationId: invocation.conversationId,
              replyToMessageId: invocation.messageId,
              nodeId: completedEndpoint.nodeId,
              projectRoot: completedEndpoint.projectRoot ?? completedEndpoint.cwd,
              sessionId: completedEndpoint.sessionId,
            }),
            requestedReturnAddress: invocation.metadata?.["returnAddress"],
            responderHarness: completedEndpoint.harness,
            responderTransport: completedEndpoint.transport,
            responderSessionId: completedEndpoint.sessionId ?? "",
            responderCwd: completedEndpoint.cwd ?? "",
            responderProjectRoot: completedEndpoint.projectRoot ?? "",
            responderAgentName: String(completedEndpoint.metadata?.agentName ?? agent.id),
            responderStartedAt: String(completedEndpoint.metadata?.startedAt ?? ""),
            responderNodeId: completedEndpoint.nodeId,
          },
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isRequesterWaitTimeoutError(error)) {
      const currentFlight = runtime.flightForInvocation(invocation.id);
      if (currentFlight && isTerminalFlightState(currentFlight.state)) {
        return;
      }
      const postedReply = existingBrokerReplyForInvocation(
        invocation,
        agent.id,
        runningFlight.startedAt ?? Date.now(),
      );
      if (postedReply && await completeInvocationForBrokerReply(invocation, postedReply)) {
        return;
      }

      const waitingFlight = {
        ...runningFlight,
        state: "waiting" as const,
        summary: `${agent.displayName} is still working; Scout stopped waiting for a synchronous result after ${error.timeoutMs}ms.`,
        error: undefined,
        completedAt: undefined,
        metadata: {
          ...(runningFlight.metadata ?? {}),
          requesterTimedOut: true,
          timeoutMs: error.timeoutMs,
          timeoutScope: "requester_wait",
        },
      };
      await persistFlight(waitingFlight);
      console.warn(`[openscout-runtime] ${waitingFlight.summary}`);
      return;
    }

    if (isDispatchStalledError(error)) {
      const stalledFlight = {
        ...runningFlight,
        state: "failed" as const,
        summary: `${agent.displayName} dispatch stalled — prompt left in composer after submit + retry.`,
        error: message,
        completedAt: Date.now(),
        metadata: {
          ...(runningFlight.metadata ?? {}),
          failureStage: "dispatch_stalled",
          dispatchStalledSession: error.sessionName,
          dispatchStalledRetries: error.retries,
          dispatchStalledPaneTail: error.paneTail.slice(0, 1_000),
        },
      };
      await persistFlight(stalledFlight);

      await persistEndpoint({
        ...runningEndpoint,
        state: "offline",
        metadata: {
          ...(runningEndpoint.metadata ?? {}),
          lastError: message,
          lastFailedAt: Date.now(),
          lastFailureStage: "dispatch_stalled",
        },
      });

      await postInvocationStatusMessage(invocation, stalledFlight);
      return;
    }

    if (isCodexAppServerExitError(error) && error.noteworthy) {
      const interruptedAt = Date.now();
      const failureStage = error.exitKind === "proactive_shutdown"
        ? "codex_app_server_proactive_shutdown"
        : "codex_app_server_sigterm";
      const summary = error.exitKind === "proactive_shutdown"
        ? `${agent.displayName} was stopped by OpenScout before it could reply.`
        : `${agent.displayName} was interrupted by a local Codex app-server SIGTERM.`;
      const interruptedFlight = {
        ...runningFlight,
        state: "failed" as const,
        summary,
        error: undefined,
        completedAt: interruptedAt,
        metadata: {
          ...(runningFlight.metadata ?? {}),
          failureStage,
          failureSeverity: "noteworthy",
          noteworthy: true,
          exitKind: error.exitKind,
          exitSignal: error.signal,
          exitCode: error.exitCode,
          ...(error.reason ? { shutdownReason: error.reason } : {}),
        },
      };
      await persistFlight(interruptedFlight);

      await persistEndpoint({
        ...runningEndpoint,
        state: "offline",
        metadata: {
          ...(runningEndpoint.metadata ?? {}),
          lastNotice: message,
          lastInterruptedAt: interruptedAt,
          lastInterruptionStage: failureStage,
        },
      });

      await postInvocationStatusMessage(invocation, interruptedFlight);
      return;
    }

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
  void message;
  void deliveries;
  // Canonical thread history stays on the authority broker. Remote nodes learn
  // about updates through watches/replay instead of mirrored message writes.
  return { forwarded: [], failed: [] };
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
    if (!isReachableMeshNode(targetNode)) {
      failed.push(targetNodeId);
      continue;
    }

    try {
      await forwardMeshCollaborationRecord(targetNode, bundle);
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
    if (!isReachableMeshNode(targetNode)) {
      failed.push(targetNodeId);
      continue;
    }

    try {
      await forwardMeshCollaborationEvent(targetNode, bundle);
      forwarded.push(targetNodeId);
    } catch {
      failed.push(targetNodeId);
    }
  }

  return { forwarded, failed };
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
  try {
    const [health, node] = await Promise.all([
      requestScoutBrokerJson<{
        ok?: boolean;
        nodeId?: string;
        meshId?: string;
      }>(brokerUrl, "/health", { socketPath: brokerSocketPath }),
      requestScoutBrokerJson<NodeDefinition>(brokerUrl, "/v1/node", { socketPath: brokerSocketPath }),
    ]);

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

async function prepareBrokerSocketPath(socketPath: string): Promise<void> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  try {
    const existing = await lstat(socketPath);
    if (!existing.isSocket()) {
      throw new Error(`broker socket path exists but is not a socket: ${socketPath}`);
    }
    await unlink(socketPath);
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: string }).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

async function listenTcp(serverInstance: ReturnType<typeof createServer>): Promise<void> {
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

async function listenUnixSocket(
  serverInstance: ReturnType<typeof createServer>,
  socketPath: string,
): Promise<void> {
  await prepareBrokerSocketPath(socketPath);
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
    serverInstance.listen(socketPath);
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
      if (command.record.conversationId) {
        const authority = authorityNodeForConversation(command.record.conversationId);
        if (authority) {
          return {
            ok: true,
            recordId: command.record.id,
            mesh: await forwardCollaborationRecordToAuthority(command.record),
          };
        }
      }

      const entries = await recordCollaborationDurably(command.record, {
        enqueueProjection: false,
      });
      const mesh = command.record.conversationId
        ? { forwarded: [], failed: [] }
        : await forwardPeerBrokerCollaborationRecord(command.record);
      await applyProjectedEntries(entries);
      return {
        ok: true,
        recordId: command.record.id,
        mesh,
      };
    }
    case "collaboration.event.append": {
      const record = runtime.collaborationRecord(command.event.recordId);
      if (record?.conversationId) {
        const authority = authorityNodeForConversation(record.conversationId);
        if (authority) {
          return {
            ok: true,
            eventId: command.event.id,
            mesh: await forwardCollaborationEventToAuthority(command.event),
          };
        }
      }

      const entries = await appendCollaborationEventDurably(command.event, {
        enqueueProjection: false,
      });
      const mesh = record?.conversationId
        ? { forwarded: [], failed: [] }
        : await forwardPeerBrokerCollaborationEvent(command.event);
      await applyProjectedEntries(entries);
      return {
        ok: true,
        eventId: command.event.id,
        mesh,
      };
    }
    case "unblock_request.upsert": {
      const entries = await recordUnblockRequestDurably(command.request);
      return {
        ok: true,
        requestId: command.request.id,
        entries: entries.length,
      };
    }
    case "unblock_request.event.append": {
      const entries = await appendUnblockRequestEventDurably(command.event);
      return {
        ok: true,
        eventId: command.event.id,
        entries: entries.length,
      };
    }
    case "conversation.post": {
      const authority = authorityNodeForConversation(command.message.conversationId);
      if (authority) {
        return {
          ok: true,
          message: command.message,
          mesh: await forwardConversationMessageToAuthority(command.message),
        };
      }

      const { deliveries, entries } = await recordMessageDurably(command.message, {
        enqueueProjection: false,
      });
      const mesh = await forwardPeerBrokerDeliveries(command.message, deliveries);
      await applyProjectedEntries(entries);
      await reconcileStaleLocalDeliveries();
      console.log(
        `[openscout-runtime] message ${command.message.id} posted by ${command.message.actorId} to ${command.message.conversationId} with ${deliveries.length} deliveries`,
      );
      return { ok: true, message: command.message, deliveries, mesh };
    }
    case "agent.invoke": {
      const flight = await acceptInvocationDurably(command.invocation);
      console.log(
        `[openscout-runtime] invocation ${command.invocation.id} accepted for ${command.invocation.targetAgentId} (state=${flight.state})`,
      );
      dispatchAcceptedInvocation(command.invocation).catch((error) => {
        console.error(
          `[openscout-runtime] background dispatch failed for invocation ${command.invocation.id}:`,
          error,
        );
      });
      return {
        ok: true,
        accepted: true,
        invocationId: command.invocation.id,
        flightId: flight.id,
        targetAgentId: command.invocation.targetAgentId,
        state: flight.state,
        flight,
      };
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

async function handleInvocationRequest(
  payload: InvocationRequest & BrokerRouteTargetInput,
) {
  await syncRegisteredLocalAgentsIfChanged("invocation");
  const resolved = await resolveInvocationTarget(payload);
  if (resolved.kind !== "resolved") {
    const envelope = buildDispatchEnvelope(
      resolved,
      askedLabelForRouteTarget(payload),
      nodeId,
      runtime.snapshot(),
      { homeEndpointFor: homeEndpointForAgent },
    );
    const { record } = await recordScoutDispatchDurably(envelope, {
      invocationId: payload.id,
      conversationId: payload.conversationId,
      requesterId: payload.requesterId,
    });
    return {
      accepted: true,
      invocationId: payload.id,
      dispatch: record,
    };
  }

  const invocation: InvocationRequest = {
    ...payload,
    targetAgentId: resolved.agent.id,
  };
  const flight = await acceptInvocationDurably(invocation);
  dispatchAcceptedInvocation(invocation).catch((error) => {
    console.error(
      `[openscout-runtime] background dispatch failed for invocation ${invocation.id}:`,
      error,
    );
  });
  return {
    accepted: true,
    invocationId: invocation.id,
    flightId: flight.id,
    targetAgentId: invocation.targetAgentId,
    state: flight.state,
    flight,
  };
}

async function acceptInvocationDurably(invocation: InvocationRequest): Promise<FlightRecord> {
  const { flight, entries } = await recordInvocationDurably(invocation, {
    enqueueProjection: false,
  });
  await applyProjectedEntries(entries);
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
    const authorityIssue = describeRemoteAuthorityIssue(targetAgent, authorityNode);
    if (authorityIssue) {
      await failAcceptedInvocation(invocation, authorityIssue.detail);
      return;
    }
    await peerDelivery.enqueue(invocation, authorityNode!);
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

const brokerService = createBrokerCoreService({
  baseUrl: brokerUrl,
  nodeId,
  meshId,
  localNode,
  runtime,
  projection,
  journal,
  threadEvents,
  isReconciledStaleFlightActivityItem,
  readHome: brokerHomePayload,
  executeCommand: handleCommand,
  postConversationMessage,
  deliver: acceptBrokerDelivery,
  invokeAgent: handleInvocationRequest,
});

registerActiveScoutBrokerService(brokerService);

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  const collaborationInvokeMatch = method === "POST"
    ? url.pathname.match(/^\/v1\/collaboration\/records\/([^/]+)\/invoke$/)
    : null;
  const durableActionHeartbeatMatch = method === "POST"
    ? url.pathname.match(/^\/v1\/durable-actions\/([^/]+)\/heartbeat$/)
    : null;
  const threadEventsMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/conversations\/([^/]+)\/thread-events$/)
    : null;
  const threadSnapshotMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/conversations\/([^/]+)\/thread-snapshot$/)
    : null;
  const readCursorsMatch = method === "GET" || method === "POST"
    ? url.pathname.match(/^\/v1\/conversations\/([^/]+)\/read-cursors$/)
    : null;
  const threadWatchStreamMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/thread-watches\/([^/]+)\/stream$/)
    : null;
  if ((url.pathname === "/v1/web/status" || url.pathname === "/v1/web/start") && method === "OPTIONS") {
    response.writeHead(204, scoutWebSupervisorCorsHeaders(request));
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    json(response, 200, await brokerService.readHealth());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/web/status") {
    jsonWithHeaders(response, 200, await webSupervisorStatus(), scoutWebSupervisorCorsHeaders(request));
    return;
  }

  if (method === "POST" && url.pathname === "/v1/web/start") {
    try {
      jsonWithHeaders(
        response,
        200,
        await startWebServerIfNeeded(webStartContextFromRequest(request)),
        scoutWebSupervisorCorsHeaders(request),
      );
    } catch (error) {
      jsonWithHeaders(
        response,
        500,
        {
          ok: false,
          running: false,
          starting: false,
          webUrl: webServerUrl(),
          port: webServerPort(),
          pid: webServerProcess?.pid ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
        scoutWebSupervisorCorsHeaders(request),
      );
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/node") {
    json(response, 200, await brokerService.readNode());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/home") {
    json(response, 200, await brokerService.readHome?.());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/snapshot") {
    json(response, 200, await brokerService.readSnapshot());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/topology/snapshot") {
    json(response, 200, await getHarnessTopologySnapshot(url.searchParams.get("force") === "1"));
    return;
  }

  if (method === "POST" && url.pathname === "/v1/topology/nudge") {
    json(response, 200, await nudgeHarnessTopologyScan());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/messages") {
    json(response, 200, await brokerService.readMessages?.({
      conversationId: url.searchParams.get("conversationId")?.trim() || undefined,
      participantId: url.searchParams.get("participantId")?.trim() || undefined,
      inboxOnly: url.searchParams.get("inboxOnly") === "1",
      since: parseSince(url),
      limit: parseLimit(url),
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/broker/messages") {
    const agentId = url.searchParams.get("agentId")?.trim();
    if (!agentId) {
      badRequest(response, new Error("agentId is required"));
      return;
    }
    json(response, 200, await brokerService.readAgentBrokerFeed?.({
      agentId,
      since: parseSince(url),
      limit: parseLimit(url),
      includeAcknowledged: url.searchParams.get("includeAcknowledged") === "1"
        || url.searchParams.get("includeAcknowledged") === "true",
    }));
    return;
  }

  if (threadEventsMatch) {
    try {
      const conversationId = decodeURIComponent(threadEventsMatch[1] ?? "");
      const afterSeq = Number.parseInt(url.searchParams.get("afterSeq") ?? "0", 10);
      json(response, 200, await brokerService.readThreadEvents?.({
        conversationId,
        afterSeq: Number.isFinite(afterSeq) && afterSeq > 0 ? afterSeq : 0,
        limit: parseLimit(url),
      }));
    } catch (error) {
      threadWatchError(response, error);
    }
    return;
  }

  if (threadSnapshotMatch) {
    try {
      const conversationId = decodeURIComponent(threadSnapshotMatch[1] ?? "");
      json(response, 200, await brokerService.readThreadSnapshot?.(conversationId));
    } catch (error) {
      threadWatchError(response, error);
    }
    return;
  }

  if (readCursorsMatch && method === "GET") {
    const conversationId = decodeURIComponent(readCursorsMatch[1] ?? "");
    json(response, 200, listReadCursorsForConversation(conversationId));
    return;
  }

  if (readCursorsMatch && method === "POST") {
    try {
      const conversationId = decodeURIComponent(readCursorsMatch[1] ?? "");
      const body = await readRequestBody<{
        actorId?: string;
        readerNodeId?: string;
        lastReadMessageId?: string;
        lastReadSeq?: number;
        lastReadAt?: number;
        metadata?: Record<string, unknown>;
      }>(request);
      const cursor = await resolveReadCursor(conversationId, body);
      await recordReadCursorDurably(cursor);
      const acknowledgedDeliveries = await acknowledgeDeliveriesForReadCursor(cursor);
      json(response, 200, { ok: true, cursor, acknowledgedDeliveries });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/events") {
    json(response, 200, runtime.recentEvents(parseLimit(url)));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/activity") {
    json(response, 200, await brokerService.readActivity?.({
      limit: parseLimit(url),
      agentId: url.searchParams.get("agentId") ?? undefined,
      actorId: url.searchParams.get("actorId") ?? undefined,
      conversationId: url.searchParams.get("conversationId") ?? undefined,
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/collaboration/records") {
    json(response, 200, await brokerService.readCollaborationRecords?.({
      limit: parseLimit(url),
      kind: url.searchParams.get("kind") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      ownerId: url.searchParams.get("ownerId") ?? undefined,
      nextMoveOwnerId: url.searchParams.get("nextMoveOwnerId") ?? undefined,
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/collaboration/events") {
    json(response, 200, await brokerService.readCollaborationEvents?.({
      limit: parseLimit(url),
      recordId: url.searchParams.get("recordId") ?? undefined,
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/unblock-requests") {
    json(response, 200, await brokerService.readUnblockRequests?.({
      limit: parseLimit(url),
      kind: url.searchParams.get("kind") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      ownerId: url.searchParams.get("ownerId") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
      sourceRef: url.searchParams.get("sourceRef") ?? undefined,
      active: url.searchParams.get("active") === "true" ? true : undefined,
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/unblock-requests/events") {
    json(response, 200, await brokerService.readUnblockRequestEvents?.({
      limit: parseLimit(url),
      requestId: url.searchParams.get("requestId") ?? undefined,
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/inbox") {
    const targetId = url.searchParams.get("targetId")?.trim();
    if (!targetId) {
      badRequest(response, new Error("targetId is required"));
      return;
    }
    json(response, 200, await listInboxItems({
      targetId,
      statuses: parseInboxStatuses(url),
      reasons: parseInboxReasons(url),
      limit: parseLimit(url),
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/inbox/stream") {
    const targetId = url.searchParams.get("targetId")?.trim();
    if (!targetId) {
      badRequest(response, new Error("targetId is required"));
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    writeInboxSse(response, "snapshot", {
      targetId,
      items: await listInboxItems({
        targetId,
        statuses: parseInboxStatuses(url),
        reasons: parseInboxReasons(url),
        limit: parseLimit(url),
      }),
    });
    const subscribers = inboxStreamClients.get(targetId) ?? new Set<ServerResponse>();
    subscribers.add(response);
    inboxStreamClients.set(targetId, subscribers);
    request.on("close", () => {
      const set = inboxStreamClients.get(targetId);
      if (set) {
        set.delete(response);
        if (set.size === 0) inboxStreamClients.delete(targetId);
      }
      response.end();
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/inbox/claim") {
    try {
      const body = await readRequestBody<InboxClaimRequest>(request);
      const targetId = body.targetId?.trim();
      if (!targetId) {
        throw new Error("targetId is required");
      }
      const claimedDelivery = await claimDeliveryDurably({
        itemId: body.itemId,
        messageId: body.messageId,
        targetId,
        reasons: body.reasons,
        leaseOwner: body.leaseOwner,
        leaseMs: body.leaseMs,
      });
      json(response, 200, {
        ok: true,
        claimed: claimedDelivery ? inboxItemForDelivery(claimedDelivery) : null,
      });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/inbox/ack") {
    try {
      const body = await readRequestBody<InboxAckRequest>(request);
      const itemId = body.itemId?.trim();
      if (!itemId) {
        throw new Error("itemId is required");
      }
      const leaseOwner = body.leaseOwner?.trim();
      if (!leaseOwner) {
        throw new Error("leaseOwner is required");
      }
      await updateDeliveryStatusDurably({
        deliveryId: itemId,
        status: "acknowledged",
        metadata: {
          ...(body.metadata ?? {}),
          acknowledgedAt: Date.now(),
          acknowledgedBy: leaseOwner,
        },
        leaseOwner: null,
        leaseExpiresAt: null,
        expectedLeaseOwner: leaseOwner,
        requireActiveLease: true,
      });
      json(response, 200, { ok: true, itemId, status: "acknowledged" });
    } catch (error) {
      if (error instanceof Error && /delivery (not found|lease)/.test(error.message)) {
        conflict(response, error.message);
        return;
      }
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/inbox/nack") {
    try {
      const body = await readRequestBody<InboxNackRequest>(request);
      const itemId = body.itemId?.trim();
      if (!itemId) {
        throw new Error("itemId is required");
      }
      const leaseOwner = body.leaseOwner?.trim();
      if (!leaseOwner) {
        throw new Error("leaseOwner is required");
      }
      const retryAfterMs = typeof body.retryAfterMs === "number" && Number.isFinite(body.retryAfterMs) && body.retryAfterMs > 0
        ? Math.floor(body.retryAfterMs)
        : 0;
      await updateDeliveryStatusDurably({
        deliveryId: itemId,
        status: retryAfterMs > 0 ? "deferred" : "pending",
        metadata: {
          ...(body.metadata ?? {}),
          nackedAt: Date.now(),
          nackedBy: leaseOwner,
          ...(body.reason ? { nackReason: body.reason } : {}),
          ...(retryAfterMs > 0 ? { nextAttemptAt: Date.now() + retryAfterMs } : {}),
        },
        leaseOwner: null,
        leaseExpiresAt: null,
        expectedLeaseOwner: leaseOwner,
        requireActiveLease: true,
      });
      json(response, 200, { ok: true, itemId, status: retryAfterMs > 0 ? "deferred" : "pending" });
    } catch (error) {
      if (error instanceof Error && /delivery (not found|lease)/.test(error.message)) {
        conflict(response, error.message);
        return;
      }
      badRequest(response, error);
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/deliveries") {
    const transport = url.searchParams.get("transport") ?? undefined;
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const targetId = url.searchParams.get("targetId")?.trim();
    const messageId = url.searchParams.get("messageId")?.trim();
    const reason = url.searchParams.get("reason")?.trim();
    const deliveries = journal.listDeliveries({
      limit: parseLimit(url),
      transport: transport as DeliveryIntent["transport"] | undefined,
      status: statusFilter as DeliveryIntent["status"] | undefined,
    }).filter((delivery) => (
      (!targetId || delivery.targetId === targetId)
      && (!messageId || delivery.messageId === messageId)
      && (!reason || delivery.reason === reason)
    ));
    json(response, 200, deliveries);
    return;
  }

  if (method === "POST" && url.pathname === "/v1/deliveries/claim") {
    try {
      const body = await readRequestBody<{
        messageId: string;
        targetId: string;
        reasons?: DeliveryReason[];
        leaseOwner?: string;
        leaseMs?: number;
      }>(request);
      const claimed = await claimDeliveryDurably({
        messageId: body.messageId,
        targetId: body.targetId,
        reasons: body.reasons,
        leaseOwner: body.leaseOwner,
        leaseMs: body.leaseMs,
      });
      json(response, 200, { ok: true, claimed });
    } catch (error) {
      badRequest(response, error);
    }
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

  const invocationLifecycleMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/invocations\/([^/]+)\/lifecycle$/)
    : null;
  if (invocationLifecycleMatch) {
    const invocationId = decodeURIComponent(invocationLifecycleMatch[1] ?? "");
    const lifecycle = await brokerService.readInvocationLifecycle?.({ invocationId });
    if (!lifecycle) {
      notFound(response);
      return;
    }
    json(response, 200, lifecycle);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/mesh/nodes") {
    json(response, 200, runtime.snapshot().nodes);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/pairing/sessions") {
    try {
      const sessions = await listPairingSessions();
      json(response, 200, sessions.map((session) => buildPairingSessionCandidate(session)));
    } catch (error) {
      badRequest(response, error);
    }
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

  if (threadWatchStreamMatch) {
    try {
      const watchId = decodeURIComponent(threadWatchStreamMatch[1] ?? "");
      await threadEvents.streamWatch(watchId, request, response);
    } catch (error) {
      threadWatchError(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/commands") {
    try {
      const command = await readRequestBody<ControlCommand>(request);
      const result = await brokerService.executeCommand(command);
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/thread-watches/open") {
    try {
      const body = await readRequestBody<ThreadWatchOpenRequest>(request);
      json(response, 200, await brokerService.openThreadWatch?.(body));
    } catch (error) {
      threadWatchError(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/thread-watches/renew") {
    try {
      const body = await readRequestBody<ThreadWatchRenewRequest>(request);
      json(response, 200, await brokerService.renewThreadWatch?.(body));
    } catch (error) {
      threadWatchError(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/thread-watches/close") {
    try {
      const body = await readRequestBody<ThreadWatchCloseRequest>(request);
      json(response, 200, await brokerService.closeThreadWatch?.(body));
    } catch (error) {
      threadWatchError(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/discover") {
    try {
      const body = await readRequestBody<{ seeds?: string[] }>(request);
      const result = await discoverPeers(body.seeds ?? []);
      json(response, 200, {
        ok: true,
        discovered: result.discovered,
        probes: result.probes,
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

        if (bundle.conversation.authorityNodeId !== nodeId) {
          return {
            kind: "not_authority" as const,
            bundleEntries,
            authorityNodeId: bundle.conversation.authorityNodeId,
          };
        }

        if (runtime.message(bundle.message.id)) {
          return {
            kind: "duplicate" as const,
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
          kind: "ok" as const,
          bundleEntries,
          messageEntries,
          deliveries,
        };
      });

      if (result.kind === "not_authority") {
        await applyProjectedEntries(result.bundleEntries);
        json(response, 409, {
          error: "not_authority",
          detail: `conversation ${bundle.conversation.id} is owned by ${result.authorityNodeId}`,
        });
        return;
      }

      await applyProjectedEntries([...result.bundleEntries, ...result.messageEntries]);
      json(
        response,
        200,
        result.kind === "duplicate"
          ? { ok: true, duplicate: true }
          : { ok: true, deliveries: result.deliveries },
      );
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
        knownInvocations.set(bundle.invocation.id, bundle.invocation);
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
        await applyProjectedEntries(result.bundleEntries);
        json(response, 409, {
          error: "not_authority",
          detail: `agent ${result.targetAgent.id} is owned by ${result.targetAgent.authorityNodeId}`,
        });
        return;
      }

      if (result.kind === "duplicate") {
        await applyProjectedEntries(result.bundleEntries);
        json(response, 200, { ok: true, duplicate: true, flight: result.flight });
        return;
      }

      await applyProjectedEntries([...result.bundleEntries, ...result.invocationEntries]);
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
        if (bundle.conversation && bundle.conversation.authorityNodeId !== nodeId) {
          return {
            kind: "not_authority" as const,
            authorityNodeId: bundle.conversation.authorityNodeId,
            entries: [] as BrokerJournalEntry[],
            existing: null as CollaborationRecord | null,
          };
        }

        const existing = runtime.collaborationRecord(bundle.record.id);
        const entries = await applyMeshBundleDurably(bundle, {
          enqueueProjection: false,
        });
        return { kind: "ok" as const, existing, entries };
      });

      if (result.kind === "not_authority") {
        json(response, 409, {
          error: "not_authority",
          detail: `conversation ${bundle.conversation?.id ?? bundle.record.conversationId ?? bundle.record.id} is owned by ${result.authorityNodeId}`,
        });
        return;
      }

      await applyProjectedEntries(result.entries);
      json(response, 200, result.existing ? { ok: true, duplicate: true } : { ok: true });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/collaboration/events") {
    try {
      const bundle = await readRequestBody<MeshCollaborationEventBundle>(request);
      if (bundle.conversation && bundle.conversation.authorityNodeId !== nodeId) {
        json(response, 409, {
          error: "not_authority",
          detail: `conversation ${bundle.conversation.id} is owned by ${bundle.conversation.authorityNodeId}`,
        });
        return;
      }

      const entries = await runDurableWrite(async () => applyMeshBundleDurably(bundle, {
        enqueueProjection: false,
      }));
      await applyProjectedEntries(entries);
      json(response, 200, { ok: true });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pairing/attach") {
    try {
      const input = await readRequestBody<{
        externalSessionId?: string;
        agentId?: string;
        alias?: string;
        displayName?: string;
      }>(request);
      const result = await attachManagedPairingSession({
        externalSessionId: String(input.externalSessionId ?? ""),
        agentId: input.agentId,
        alias: input.alias,
        displayName: input.displayName,
      });
      json(response, 200, { ok: true, ...result });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pairing/detach") {
    try {
      const input = await readRequestBody<{
        agentId?: string;
        alias?: string;
      }>(request);
      const result = await detachManagedPairingSession(input);
      json(response, 200, { ok: true, ...result });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/local-sessions/attach") {
    try {
      const input = await readRequestBody<{
        externalSessionId?: string;
        transport?: ManagedLocalSessionTransport;
        cwd?: string;
        projectRoot?: string;
        agentId?: string;
        alias?: string;
        displayName?: string;
      }>(request);
      const result = await attachManagedLocalSession({
        externalSessionId: String(input.externalSessionId ?? ""),
        transport: input.transport ?? "codex_app_server",
        cwd: String(input.cwd ?? process.cwd()),
        projectRoot: input.projectRoot,
        agentId: input.agentId,
        alias: input.alias,
        displayName: input.displayName,
      });
      json(response, 200, { ok: true, ...result });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/local-sessions/ensure") {
    try {
      const input = await readRequestBody<{
        agentId?: string;
        endpointId?: string;
      }>(request);
      const snapshot = runtime.snapshot();
      const endpoint = input.endpointId?.trim()
        ? snapshot.endpoints[input.endpointId.trim()]
        : Object.values(snapshot.endpoints).find((candidate) => (
          candidate.agentId === input.agentId?.trim()
          && candidate.nodeId === nodeId
          && (candidate.transport === "codex_app_server" || candidate.transport === "claude_stream_json")
          && candidate.state !== "offline"
        ));
      if (!endpoint) {
        throw new Error("local session endpoint not found");
      }
      if (endpoint.transport !== "codex_app_server" && endpoint.transport !== "claude_stream_json") {
        throw new Error(`endpoint ${endpoint.id} does not use a local session transport`);
      }
      const sessionResult = await ensureLocalSessionEndpointOnline(endpoint);
      const externalSessionId = sessionResult.externalSessionId?.trim();
      const nextEndpoint: AgentEndpoint = {
        ...endpoint,
        state: endpoint.state === "offline" ? "waiting" : endpoint.state,
        ...(externalSessionId ? { sessionId: externalSessionId } : {}),
        metadata: {
          ...(endpoint.metadata ?? {}),
          ...(externalSessionId ? {
            externalSessionId,
            threadId: endpoint.transport === "codex_app_server" ? externalSessionId : endpoint.metadata?.threadId,
          } : {}),
          lastEnsuredAt: Date.now(),
        },
      };
      await persistEndpoint(nextEndpoint);
      json(response, 200, { ok: true, endpoint: nextEndpoint, externalSessionId: externalSessionId ?? null });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/local-sessions/detach") {
    try {
      const input = await readRequestBody<{
        agentId?: string;
        alias?: string;
      }>(request);
      const result = await detachManagedLocalSession(input);
      json(response, 200, { ok: true, ...result });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/nodes") {
    try {
      const node = await readRequestBody<NodeDefinition>(request);
      await brokerService.executeCommand({ kind: "node.upsert", node });
      json(response, 200, { ok: true, nodeId: node.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/actors") {
    try {
      const actor = await readRequestBody<ActorIdentity>(request);
      await brokerService.executeCommand({ kind: "actor.upsert", actor });
      json(response, 200, { ok: true, actorId: actor.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/agents") {
    try {
      const agent = await readRequestBody<AgentDefinition>(request);
      await brokerService.executeCommand({ kind: "agent.upsert", agent });
      json(response, 200, { ok: true, agentId: agent.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/endpoints") {
    try {
      const endpoint = await readRequestBody<AgentEndpoint>(request);
      await brokerService.executeCommand({
        kind: "agent.endpoint.upsert",
        endpoint,
      });
      json(response, 200, { ok: true, endpointId: endpoint.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/conversations") {
    try {
      const conversation = await readRequestBody<ConversationDefinition>(request);
      await brokerService.executeCommand({
        kind: "conversation.upsert",
        conversation,
      });
      json(response, 200, { ok: true, conversationId: conversation.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/bindings") {
    try {
      const binding = await readRequestBody<ConversationBinding>(request);
      await brokerService.executeCommand({ kind: "binding.upsert", binding });
      json(response, 200, { ok: true, bindingId: binding.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/collaboration/records") {
    try {
      const record = await readRequestBody<CollaborationRecord>(request);
      const result = await brokerService.executeCommand({
        kind: "collaboration.upsert",
        record,
      });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/collaboration/events") {
    try {
      const event = await readRequestBody<CollaborationEvent>(request);
      const result = await brokerService.executeCommand({
        kind: "collaboration.event.append",
        event,
      });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/unblock-requests") {
    try {
      const requestRecord = await readRequestBody<UnblockRequestRecord>(request);
      const result = await brokerService.executeCommand({
        kind: "unblock_request.upsert",
        request: requestRecord,
      });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/unblock-requests/events") {
    try {
      const event = await readRequestBody<UnblockRequestEvent>(request);
      const result = await brokerService.executeCommand({
        kind: "unblock_request.event.append",
        event,
      });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/flights") {
    try {
      const flight = await readRequestBody<FlightRecord>(request);
      await recordFlightDurably(flight);
      json(response, 200, { ok: true, flightId: flight.id });
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

  if (method === "POST" && url.pathname === "/v1/durable-actions") {
    try {
      const action = await readRequestBody<DurableAction>(request);
      if (!action.id?.trim()) {
        throw new Error("action.id is required");
      }
      await runDurableWrite(async () => {
        await commitDurableEntries(
          { kind: "durable.action.record", action },
          async () => {},
        );
      });
      json(response, 200, { ok: true, actionId: action.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (durableActionHeartbeatMatch) {
    try {
      const actionId = decodeURIComponent(durableActionHeartbeatMatch[1] ?? "");
      const body = await readRequestBody<{
        owner: string;
        generation: number;
        leaseMs: number;
        heartbeatAt?: number;
      }>(request);
      if (!actionId || !body.owner?.trim()) {
        throw new Error("actionId and owner are required.");
      }
      if (!Number.isFinite(body.generation) || body.generation < 0) {
        throw new Error("generation must be a non-negative number.");
      }
      if (!Number.isFinite(body.leaseMs) || body.leaseMs <= 0) {
        throw new Error("leaseMs must be a positive number.");
      }
      const heartbeatAt = Number.isFinite(body.heartbeatAt)
        ? body.heartbeatAt!
        : Date.now();
      const heartbeat = await heartbeatDurableActionDurably({
        actionId,
        owner: body.owner.trim(),
        generation: body.generation,
        leaseMs: body.leaseMs,
        heartbeatAt,
      });
      if (!heartbeat) {
        const current = journal.getDurableAction(actionId);
        if (!current) {
          json(response, 404, {
            error: "not_found",
            detail: "durable action not found",
          });
          return;
        }
        conflict(response, "durable action lease is stale, terminal, or owned by another worker");
        return;
      }
      json(response, 200, {
        ok: true,
        actionId,
        leaseOwner: heartbeat.leaseOwner,
        leaseGeneration: heartbeat.leaseGeneration,
        leaseExpiresAt: heartbeat.leaseExpiresAt,
      });
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
      const result = await brokerService.postConversationMessage?.(message);
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/deliver") {
    try {
      const payload = await readRequestBody<ScoutDeliverRequest>(request);
      const result = brokerService.deliver
        ? await brokerService.deliver(payload)
        : await acceptBrokerDelivery(payload);
      json(
        response,
        result.kind === "delivery" ? 202 : result.kind === "question" ? 409 : 422,
        result,
      );
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/invocations") {
    try {
      const payload = await readRequestBody<InvocationRequest & BrokerRouteTargetInput>(request);
      const result = brokerService.invokeAgent
        ? await brokerService.invokeAgent(payload)
        : await handleInvocationRequest(payload);
      json(response, 202, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  // ─── External agent endpoints (SCO-016) ────────────────────────────────────
  if (method === "POST" && url.pathname === "/v1/endpoints") {
    try {
      const endpoint = await readRequestBody<AgentEndpoint>(request);
      await runtime.upsertEndpoint(endpoint);
      json(response, 200, { ok: true, endpoint });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }
  if (method === "DELETE" && url.pathname.startsWith("/v1/endpoints/")) {
    const id = decodeURIComponent(url.pathname.slice("/v1/endpoints/".length));
    runtime.deleteEndpoint(id);
    json(response, 200, { ok: true });
    return;
  }

  // ─── External agent cards (SCO-016) ────────────────────────────────────────
  if (method === "GET" && url.pathname === "/v1/agent-cards") {
    const bindings = await loadRegisteredLocalAgentBindings(nodeId, { ensureOnline: false });
    const local = bindings.map((b) => buildScoutAgentCard(b, { brokerRegistered: true }));
    const external = Object.values(runtime.snapshot().agents)
      .filter((a) => a.metadata?.brokerRegistered === true)
      .map((agent) => {
        const eps = Object.values(runtime.snapshot().endpoints).filter((e) => e.agentId === agent.id);
        const ep = eps[0];
        return ep ? buildScoutAgentCard(
          { agent, endpoint: ep, actor: runtime.snapshot().actors[agent.id] ?? { id: agent.id, kind: "agent" } },
          { brokerRegistered: true },
        ) : null;
      })
      .filter(Boolean) as ScoutAgentCard[];
    json(response, 200, { cards: [...local, ...external] });
    return;
  }
  if (method === "POST" && url.pathname === "/v1/agent-cards") {
    try {
      const input = await readRequestBody<ExternalAgentCardInput>(request);
      const card = upsertScoutAgentCardFromInput(runtime, input);
      json(response, 200, { ok: true, card });
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

function callerContextForDelivery(payload: ScoutDeliverRequest): { requesterId: string; requesterNodeId: string } {
  return {
    requesterId: payload.caller?.actorId?.trim() || payload.requesterId?.trim() || operatorActorId,
    requesterNodeId: payload.caller?.nodeId?.trim() || payload.requesterNodeId?.trim() || nodeId,
  };
}

function agentLabelForRouteParams(payload: ScoutDeliverRequest): string | undefined {
  if (payload.target?.kind === "agent_label") {
    return payload.target.label;
  }
  if (!payload.target && payload.targetLabel?.trim()) {
    return payload.targetLabel;
  }
  return undefined;
}

function supportedRouteHarness(value: string | undefined): AgentHarness | undefined {
  const normalized = value?.trim() as AgentHarness | undefined;
  if (normalized && SUPPORTED_SCOUT_HARNESSES.includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function executionWithRouteParams(payload: ScoutDeliverRequest): InvocationRequest["execution"] | undefined {
  const label = agentLabelForRouteParams(payload);
  const identity = label
    ? parseAgentIdentity(label.startsWith("@") ? label : `@${label}`)
    : null;
  const harness = supportedRouteHarness(identity?.harness);
  if (!harness || payload.execution?.harness) {
    return payload.execution;
  }

  return {
    ...(payload.execution ?? {}),
    harness,
  };
}

function resolveBrokerDeliveryTarget(
  input: BrokerRouteTargetInput,
): InvocationResolution {
  return resolveBrokerRouteTarget(runtime.snapshot(), input, {
    preferLocalNodeId: nodeId,
    helpers: { isStale: isInactiveLocalAgent },
  });
}

function projectPathRouteTarget(input: BrokerRouteTargetInput): string | undefined {
  return input.target?.kind === "project_path"
    ? input.target.projectPath.trim() || undefined
    : undefined;
}

function implicitProjectAgentName(projectPath: string): string {
  const base = normalizeAgentSelectorSegment(basename(projectPath)) || "agent";
  return `${base}-card-${createRuntimeId("one").slice(-8)}`;
}

async function resolveBrokerDeliveryTargetWithImplicitProjectCard(
  input: BrokerRouteTargetInput & { execution?: InvocationRequest["execution"] },
  options: {
    requesterId?: string;
    currentDirectory?: string;
    reason: string;
  },
): Promise<InvocationResolution> {
  const resolved = resolveBrokerDeliveryTarget(input);
  const projectPath = projectPathRouteTarget(input);
  const shouldCreateImplicitProjectCard =
    projectPath
    && (
      resolved.kind === "unknown"
      || (resolved.kind === "ambiguous" && (input.execution?.session ?? "new") === "new")
    );
  if (!shouldCreateImplicitProjectCard) {
    return resolved;
  }

  const createdAt = Date.now();
  const requesterId = options.requesterId?.trim();
  const status = await startLocalAgent({
    projectPath,
    agentName: implicitProjectAgentName(projectPath),
    currentDirectory: options.currentDirectory ?? projectPath,
    harness: input.execution?.harness,
    ensureOnline: false,
    card: {
      kind: "one_time",
      createdAt,
      ...(requesterId ? { createdById: requesterId } : {}),
      expiresAt: createdAt + DEFAULT_IMPLICIT_PROJECT_CARD_TTL_MS,
      maxUses: 1,
    },
  }).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not create an agent card for project ${projectPath}: ${detail}`);
  });

  await pruneOneTimeLocalAgentCards({
    ...(requesterId ? { createdById: requesterId } : {}),
    projectRoot: status.projectRoot,
    excludeAgentIds: [status.agentId],
  }).catch((error) => {
    console.warn(`[openscout-runtime] implicit project card cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  await syncRegisteredLocalAgentsIfChanged(options.reason);
  const agent = runtime.snapshot().agents[status.agentId];
  if (agent && !isInactiveLocalAgent(agent)) {
    return { kind: "resolved", agent };
  }

  return resolveBrokerDeliveryTarget(input);
}

async function resolveInvocationTarget(
  payload: InvocationRequest & BrokerRouteTargetInput,
): Promise<InvocationResolution> {
  return resolveBrokerDeliveryTargetWithImplicitProjectCard({
    target: payload.target,
    targetAgentId: payload.targetAgentId,
    targetSessionId: payload.targetSessionId,
    targetLabel: payload.targetLabel,
    routePolicy: payload.routePolicy,
    execution: payload.execution,
  }, {
    requesterId: payload.requesterId,
    currentDirectory: projectPathRouteTarget(payload),
    reason: "implicit project invocation card",
  });
}

function remediationForDispatch(
  dispatch: ScoutDispatchRecord,
): ScoutDeliveryRemediationAction {
  if (dispatch.kind === "ambiguous") {
    return {
      kind: "choose_target",
      detail: dispatch.detail,
      targetLabel: dispatch.askedLabel,
      dispatchId: dispatch.id,
    };
  }
  if (dispatch.kind === "unavailable") {
    return {
      kind: dispatch.target?.reason === "manual_wake_required" ? "wake_target" : "retry_later",
      detail: dispatch.target?.detail ?? dispatch.detail,
      targetAgentId: dispatch.target?.agentId,
      targetLabel: dispatch.askedLabel,
      dispatchId: dispatch.id,
    };
  }
  return {
    kind: dispatch.kind === "unknown" ? "register_target" : "choose_target",
    detail: dispatch.detail,
    targetLabel: dispatch.askedLabel,
    dispatchId: dispatch.id,
  };
}

function buildDeliveryReceipt(input: {
  requestId: string;
  routeKind: ScoutDeliverRouteKind;
  requesterId: string;
  requesterNodeId: string;
  targetAgentId?: string;
  targetSessionId?: string;
  targetLabel: string;
  bindingRef?: string;
  conversationId: string;
  messageId: string;
  flightId?: string;
}): ScoutDeliveryReceipt {
  return {
    requestId: input.requestId,
    routeKind: input.routeKind,
    requesterId: input.requesterId,
    requesterNodeId: input.requesterNodeId,
    targetAgentId: input.targetAgentId,
    targetSessionId: input.targetSessionId,
    targetLabel: input.targetLabel,
    ...(input.bindingRef ? { bindingRef: input.bindingRef } : {}),
    conversationId: input.conversationId,
    messageId: input.messageId,
    ...(input.flightId ? { flightId: input.flightId } : {}),
    acceptedAt: Date.now(),
  };
}

function invocationCollaborationRecordId(invocation: InvocationRequest): string | undefined {
  const nested = invocation.context?.["collaboration"];
  const nestedRecordId =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? metadataStringValue(nested as Record<string, unknown>, "recordId")
      : undefined;
  return invocation.collaborationRecordId?.trim()
    || metadataStringValue(invocation.metadata, "collaborationRecordId")
    || metadataStringValue(invocation.context, "collaborationRecordId")
    || nestedRecordId
    || undefined;
}

function compactWorkSummary(value: string | undefined, maxLength = 320): string | undefined {
  const normalized = value
    ?.replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeScoutLabels(labels: string[] | undefined): string[] {
  if (!labels) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function mergeScoutLabels(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const merged = normalizeScoutLabels([...(left ?? []), ...(right ?? [])]);
  return merged.length ? merged : undefined;
}

function buildDeliveryWorkItem(input: {
  payload: ScoutDeliverRequest;
  requestId: string;
  requesterId: string;
  targetAgentId: string;
  conversationId: string;
  createdAt: number;
}): CollaborationRecord | null {
  const workItem = input.payload.workItem;
  if (!workItem?.title?.trim()) {
    return null;
  }
  const source =
    metadataStringValue(input.payload.invocationMetadata, "source")
    || metadataStringValue(input.payload.messageMetadata, "source")
    || "broker-delivery";
  const recordId = workItem.id?.trim()
    || input.payload.collaborationRecordId?.trim()
    || createRuntimeId("work");
  const labels = mergeScoutLabels(input.payload.labels, workItem.labels);
  return {
    id: recordId,
    kind: "work_item",
    state: "working",
    acceptanceState: workItem.acceptanceState ?? "pending",
    title: workItem.title.trim(),
    ...(workItem.summary?.trim() ? { summary: workItem.summary.trim() } : {}),
    createdById: input.requesterId,
    ownerId: input.targetAgentId,
    nextMoveOwnerId: input.targetAgentId,
    conversationId: input.conversationId,
    ...(workItem.parentId?.trim() ? { parentId: workItem.parentId.trim() } : {}),
    ...(workItem.priority ? { priority: workItem.priority as CollaborationPriority } : {}),
    ...(labels ? { labels } : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    requestedById: input.requesterId,
    startedAt: input.createdAt,
    metadata: {
      source,
      ...(workItem.metadata ?? {}),
      deliveryRequestId: input.requestId,
    },
  };
}

type DeliveryWorkItemResolution = {
  record: CollaborationRecord | null;
  collaborationRecordId?: string;
};

function normalizeComparableDeliveryValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableDeliveryValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeComparableDeliveryValue(entry)] as const),
    );
  }
  return value;
}

function sameDeliveryWorkItemValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeComparableDeliveryValue(left))
    === JSON.stringify(normalizeComparableDeliveryValue(right));
}

function sameDeliveryWorkItemLabels(left: string[] | undefined, right: string[] | undefined): boolean {
  return sameDeliveryWorkItemValue(left ?? [], right ?? []);
}

function metadataContainsDeliveryWorkItemValues(
  existing: Record<string, unknown> | undefined,
  expected: Record<string, unknown> | undefined,
): boolean {
  for (const [key, value] of Object.entries(expected ?? {})) {
    if (value === undefined) {
      continue;
    }
    if (!sameDeliveryWorkItemValue(existing?.[key], value)) {
      return false;
    }
  }
  return true;
}

function existingDeliveryWorkItemMatches(
  existing: CollaborationRecord,
  proposed: CollaborationRecord,
): boolean {
  if (existing.kind !== "work_item" || proposed.kind !== "work_item") {
    return false;
  }

  return existing.title === proposed.title
    && (existing.summary ?? "") === (proposed.summary ?? "")
    && existing.acceptanceState === proposed.acceptanceState
    && existing.createdById === proposed.createdById
    && existing.ownerId === proposed.ownerId
    && existing.nextMoveOwnerId === proposed.nextMoveOwnerId
    && existing.conversationId === proposed.conversationId
    && existing.parentId === proposed.parentId
    && existing.priority === proposed.priority
    && sameDeliveryWorkItemLabels(existing.labels, proposed.labels)
    && existing.requestedById === proposed.requestedById
    && metadataContainsDeliveryWorkItemValues(existing.metadata, proposed.metadata);
}

function buildDeliveryWorkItemCreatedEvent(
  record: CollaborationRecord,
  input: {
    payload: ScoutDeliverRequest;
    requestId: string;
    requesterId: string;
    createdAt: number;
  },
): CollaborationEvent {
  return {
    id: createRuntimeId("evt"),
    recordId: record.id,
    recordKind: "work_item",
    kind: "created",
    actorId: input.requesterId,
    at: input.createdAt,
    summary: record.summary ?? record.title,
    metadata: {
      source: metadataStringValue(record.metadata, "source") ?? "broker-delivery",
      deliveryRequestId: input.requestId,
    },
  };
}

async function recordDeliveryWorkItemIfNeeded(input: {
  payload: ScoutDeliverRequest;
  requestId: string;
  requesterId: string;
  targetAgentId: string;
  conversationId: string;
  createdAt: number;
}): Promise<DeliveryWorkItemResolution> {
  const record = buildDeliveryWorkItem(input);
  if (!record) {
    const collaborationRecordId = input.payload.collaborationRecordId?.trim();
    return {
      record: null,
      ...(collaborationRecordId ? { collaborationRecordId } : {}),
    };
  }

  const result = await runDurableWrite(async (): Promise<DeliveryWorkItemResolution & { entries?: BrokerJournalEntry[] }> => {
    const existing = runtime.collaborationRecord(record.id);
    if (existing) {
      if (existingDeliveryWorkItemMatches(existing, record)) {
        return {
          record: existing,
          collaborationRecordId: existing.id,
        };
      }
      return { record: null };
    }

    const event = buildDeliveryWorkItemCreatedEvent(record, input);
    assertValidCollaborationRecord(record);
    assertValidCollaborationEvent(event, record);
    const entries = await commitDurableEntries(
      [
        { kind: "collaboration.record", record },
        { kind: "collaboration.event.record", event },
      ],
      async (retainedEntries) => {
        for (const entry of retainedEntries) {
          if (entry.kind === "collaboration.record") {
            await runtime.upsertCollaboration(entry.record);
          } else if (entry.kind === "collaboration.event.record") {
            await runtime.appendCollaborationEvent(entry.event);
          }
        }
      },
      { enqueueProjection: false },
    );
    return {
      record,
      collaborationRecordId: record.id,
      entries,
    };
  });

  if (result.entries) {
    await applyProjectedEntries(result.entries);
  }
  return {
    record: result.record,
    ...(result.collaborationRecordId ? { collaborationRecordId: result.collaborationRecordId } : {}),
  };
}

function deliveryWorkItemResolutionForTell(payload: ScoutDeliverRequest): DeliveryWorkItemResolution {
  const collaborationRecordId = payload.collaborationRecordId?.trim();
  return {
    record: null,
    ...(collaborationRecordId ? { collaborationRecordId } : {}),
  };
}

async function promoteInvocationFlightToWork(
  invocation: InvocationRequest,
  flight: FlightRecord,
  output: string | undefined,
): Promise<void> {
  const workId = invocationCollaborationRecordId(invocation);
  if (!workId) {
    return;
  }
  const record = runtime.collaborationRecord(workId);
  if (!record || record.kind !== "work_item") {
    return;
  }
  if (record.state === "done" || record.state === "cancelled") {
    return;
  }

  const now = flight.completedAt ?? Date.now();
  const nextState = flight.state === "completed"
    ? "done"
    : flight.state === "cancelled"
    ? "cancelled"
    : "waiting";
  const nextEventKind = flight.state === "completed"
    ? "done"
    : flight.state === "cancelled"
    ? "cancelled"
    : "waiting";
  const summary = compactWorkSummary(output)
    ?? compactWorkSummary(flight.output)
    ?? compactWorkSummary(flight.error)
    ?? compactWorkSummary(flight.summary)
    ?? `${flight.targetAgentId} completed.`;
  const nextRecord: CollaborationRecord = {
    ...record,
    state: nextState,
    summary: record.summary ?? summary,
    updatedAt: now,
    progress: {
      ...(record.progress ?? {}),
      summary,
      completedSteps: flight.state === "completed" ? 1 : record.progress?.completedSteps,
      totalSteps: flight.state === "completed" ? 1 : record.progress?.totalSteps,
    },
    ...(flight.state === "completed" ? { completedAt: record.completedAt ?? now } : {}),
    metadata: {
      ...(record.metadata ?? {}),
      lastInvocationId: invocation.id,
      lastFlightId: flight.id,
      lastFlightState: flight.state,
    },
  };

  const recordEntries = await recordCollaborationDurably(nextRecord, {
    enqueueProjection: false,
  });
  const eventEntries = await appendCollaborationEventDurably({
    id: createRuntimeId("evt"),
    recordId: nextRecord.id,
    recordKind: "work_item",
    kind: nextEventKind,
    actorId: flight.targetAgentId,
    at: now,
    summary,
    metadata: {
      source: "broker",
      invocationId: invocation.id,
      flightId: flight.id,
      flightState: flight.state,
      conversationId: invocation.conversationId,
      messageId: invocation.messageId,
    },
  }, {
    enqueueProjection: false,
  });
  await applyProjectedEntries([...recordEntries, ...eventEntries]);
}

type OperatorDeliveryIssueKind = "unassigned_scout" | "rejected" | "unavailable";

let loggedMissingOperatorDeliveryApnsCredentials = false;

function queueOperatorDeliveryIssue(input: {
  kind: OperatorDeliveryIssueKind;
  requestId: string;
  requesterId: string;
  requesterNodeId: string;
  targetLabel: string;
  detail: string;
}): void {
  if (input.requesterId === operatorActorId) {
    return;
  }

  void recordOperatorDeliveryIssue(input).catch((error) => {
    console.warn(
      "[openscout-runtime] failed to notify operator about delivery issue:",
      error instanceof Error ? error.message : String(error),
    );
  });
}

async function recordOperatorDeliveryIssue(input: {
  kind: OperatorDeliveryIssueKind;
  requestId: string;
  requesterId: string;
  requesterNodeId: string;
  targetLabel: string;
  detail: string;
}): Promise<void> {
  await ensureBrokerActorForDelivery(operatorActorId);
  const conversation = await ensureBrokerDeliveryConversation({
    requesterId: systemActor.id,
    channel: "system",
  });
  const itemId = `delivery:${input.requestId}`;
  const targetLabel = input.targetLabel.trim() || "Scout";
  const detail = input.detail.trim();

  await postConversationMessage({
    id: createRuntimeId("msg"),
    conversationId: conversation.id,
    actorId: systemActor.id,
    originNodeId: nodeId,
    class: "system",
    body: detail,
    audience: {
      notify: [operatorActorId],
      reason: "mention",
    },
    visibility: messageVisibilityForConversation(conversation),
    policy: "durable",
    createdAt: Date.now(),
    metadata: {
      source: "broker",
      operatorAttention: "delivery_issue",
      deliveryIssueKind: input.kind,
      requestId: input.requestId,
      requesterId: input.requesterId,
      requesterNodeId: input.requesterNodeId,
      targetLabel,
      itemId,
    },
  });

  const result = await broadcastApnsAlertToActiveMobileDevices({
    title: "Scout delivery needs attention",
    body: detail,
    sound: "default",
    threadId: "scout.delivery",
    payload: {
      destination: "inbox",
      itemId,
      kind: "delivery_issue",
      requestId: input.requestId,
      requesterId: input.requesterId,
      requesterNodeId: input.requesterNodeId,
      targetLabel,
      reason: input.kind,
    },
  });

  if (result.configMissing && !loggedMissingOperatorDeliveryApnsCredentials) {
    loggedMissingOperatorDeliveryApnsCredentials = true;
    console.warn("[openscout-runtime] mobile push credentials are missing; operator delivery issue was recorded without APNS.");
  }
  if (result.rateLimited) {
    console.warn(
      `[openscout-runtime] push relay rate-limited (${result.rateLimitWindow ?? "unknown"}); retry in ${result.retryAfterSeconds ?? "?"}s.`,
    );
  }
  for (const failure of result.failures) {
    console.warn(
      `[openscout-runtime] failed to send operator delivery issue push to ${failure.deviceId} (${failure.tokenSuffix}): ${failure.reason ?? failure.status ?? "unknown"}`,
    );
  }
}

async function acceptBrokerDelivery(
  payload: ScoutDeliverRequest,
): Promise<ScoutDeliverResponse> {
  await syncRegisteredLocalAgentsIfChanged("delivery");
  const requestId = payload.id?.trim() || createRuntimeId("deliver");
  const createdAt = typeof payload.createdAt === "number" && Number.isFinite(payload.createdAt)
    ? payload.createdAt
    : Date.now();
  const { requesterId, requesterNodeId } = callerContextForDelivery(payload);
  const askedLabel = askedLabelForRouteTarget(payload);
  const execution = executionWithRouteParams(payload);
  const deliveryChannel = routeChannelForTarget(payload) ?? payload.channel?.trim();
  const targetSessionId =
    payload.target?.kind === "session_id"
      ? payload.target.sessionId.trim()
      : payload.targetSessionId?.trim()
      || metadataStringValue(payload.invocationMetadata, "targetSessionId")
      || metadataStringValue(payload.messageMetadata, "targetSessionId")
      || undefined;
  const replyToSessionId =
    payload.replyToSessionId?.trim()
    || metadataStringValue(payload.invocationMetadata, "replyToSessionId")
    || metadataStringValue(payload.messageMetadata, "replyToSessionId")
    || undefined;
  const labels = normalizeScoutLabels(payload.labels);
  const typedChannelTarget = payload.target?.kind === "channel" || payload.target?.kind === "broadcast";
  const hasAgentTarget = Boolean(
    payload.target?.kind === "agent_id"
      || payload.target?.kind === "agent_label"
      || payload.target?.kind === "session_id"
      || payload.target?.kind === "project_path",
  ) || (!payload.target && Boolean(payload.targetSessionId?.trim() || payload.targetAgentId?.trim() || payload.targetLabel?.trim()));

  const messageRef = messageRefCandidateForRouteTarget(payload);
  const replyTarget = messageRef ? resolveBrokerMessageRef(runtime.snapshot(), messageRef) : null;
  if (replyTarget) {
    await ensureBrokerActorForDelivery(requesterId);
    await ensureBrokerActorForDelivery(replyTarget.actorId);
    const snapshot = runtime.snapshot();
    const conversation = snapshot.conversations[replyTarget.conversationId];
    if (conversation) {
      const messageId = createRuntimeId("msg");
      const routeKind = brokerRouteKind(conversation);
      const notifyTargets = replyTarget.actorId !== requesterId ? [replyTarget.actorId] : [];
      const message: MessageRecord = {
        id: messageId,
        conversationId: conversation.id,
        actorId: requesterId,
        originNodeId: requesterNodeId,
        class: conversation.kind === "system" ? "system" : "agent",
        body: payload.body.trim(),
        replyToMessageId: replyTarget.id,
        ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
        audience: {
          reason: "thread_reply",
          ...(notifyTargets.length > 0 ? { notify: notifyTargets } : {}),
        },
        visibility: messageVisibilityForConversation(conversation),
        policy: "durable",
        createdAt,
        metadata: {
          ...(payload.messageMetadata ?? {}),
          ...(labels.length ? { labels } : {}),
          relayChannel: conversation.kind === "direct" ? "dm" : conversation.id.replace(/^channel\./, ""),
          relayMessageId: messageId,
          relayTarget: replyTarget.actorId,
          relayTargetIds: notifyTargets,
          returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
            conversationId: conversation.id,
            replyToMessageId: messageId,
            sessionId: replyToSessionId,
          }),
        },
      };
      await postConversationMessage(message);
      return {
        kind: "delivery",
        accepted: true,
        routeKind,
        receipt: buildDeliveryReceipt({
          requestId,
          routeKind,
          requesterId,
          requesterNodeId,
          targetLabel: `ref:${replyTarget.id}`,
          conversationId: conversation.id,
          messageId,
        }),
        conversation,
        message,
      };
    }
  }

  if (isOperatorDeliveryTarget(payload)) {
    await ensureBrokerActorForDelivery(requesterId);
    await ensureBrokerActorForDelivery(operatorActorId);
    const conversation = await ensureBrokerDeliveryConversation({
      requesterId,
      targetAgentId: operatorActorId,
      channel: deliveryChannel,
    });
    const snapshot = runtime.snapshot();
    const messageId = createRuntimeId("msg");
    const routeKind = brokerRouteKind(conversation);
    const notifyTargets = requesterId !== operatorActorId ? [operatorActorId] : [];
    const message: MessageRecord = {
      id: messageId,
      conversationId: conversation.id,
      actorId: requesterId,
      originNodeId: requesterNodeId,
      class: conversation.kind === "system" ? "system" : "agent",
      body: payload.body.trim(),
      ...(payload.replyToMessageId?.trim() ? { replyToMessageId: payload.replyToMessageId.trim() } : {}),
      mentions: [{ actorId: operatorActorId, label: "@operator" }],
      ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
      audience: {
        reason: conversation.kind === "direct" ? "direct_message" : "mention",
        ...(notifyTargets.length > 0 ? { notify: notifyTargets } : {}),
      },
      visibility: messageVisibilityForConversation(conversation),
      policy: "durable",
      createdAt,
      metadata: {
        ...(payload.messageMetadata ?? {}),
        ...(labels.length ? { labels } : {}),
        relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
        relayTarget: operatorActorId,
        relayTargetIds: notifyTargets,
        relayMessageId: messageId,
        returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
          conversationId: conversation.id,
          replyToMessageId: messageId,
          sessionId: replyToSessionId,
        }),
      },
    };
    await postConversationMessage(message);
    return {
      kind: "delivery",
      accepted: true,
      routeKind,
      receipt: buildDeliveryReceipt({
        requestId,
        routeKind,
        requesterId,
        requesterNodeId,
        targetAgentId: operatorActorId,
        targetLabel: "@operator",
        conversationId: conversation.id,
        messageId,
      }),
      conversation,
      message,
      targetAgentId: operatorActorId,
    };
  }

  if (isLocalScoutProductTarget(payload)) {
    await ensureBrokerActorForDelivery(requesterId);
    await ensureBrokerActorForDelivery(SCOUT_DISPATCHER_AGENT_ID);
    const conversation = await ensureBrokerDeliveryConversation({
      requesterId,
      targetAgentId: SCOUT_DISPATCHER_AGENT_ID,
      channel: deliveryChannel,
    });
    const snapshot = runtime.snapshot();
    const messageId = createRuntimeId("msg");
    const routeKind = brokerRouteKind(conversation);
    const message: MessageRecord = {
      id: messageId,
      conversationId: conversation.id,
      actorId: requesterId,
      originNodeId: requesterNodeId,
      class: conversation.kind === "system" ? "system" : "agent",
      body: payload.body.trim(),
      ...(payload.replyToMessageId?.trim() ? { replyToMessageId: payload.replyToMessageId.trim() } : {}),
      mentions: [{ actorId: SCOUT_DISPATCHER_AGENT_ID, label: "@scout" }],
      ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
      audience: {
        notify: [],
        reason: conversation.kind === "direct" ? "direct_message" : "mention",
      },
      visibility: messageVisibilityForConversation(conversation),
      policy: "durable",
      createdAt,
      metadata: {
        ...(payload.messageMetadata ?? {}),
        ...(labels.length ? { labels } : {}),
        relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
        relayTarget: SCOUT_DISPATCHER_AGENT_ID,
        relayTargetIds: [SCOUT_DISPATCHER_AGENT_ID],
        relayMessageId: messageId,
        returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
          conversationId: conversation.id,
          replyToMessageId: messageId,
          sessionId: replyToSessionId,
        }),
      },
    };
    await postConversationMessage(message);
    queueOperatorDeliveryIssue({
      kind: "unassigned_scout",
      requestId,
      requesterId,
      requesterNodeId,
      targetLabel: askedLabel || "Scout",
      detail: `${titleCaseName(requesterId)} sent a request to Scout, but no operator session accepted it.`,
    });
    return {
      kind: "delivery",
      accepted: true,
      routeKind,
      receipt: buildDeliveryReceipt({
        requestId,
        routeKind,
        requesterId,
        requesterNodeId,
        targetAgentId: SCOUT_DISPATCHER_AGENT_ID,
        targetLabel: "Scout",
        conversationId: conversation.id,
        messageId,
      }),
      conversation,
      message,
      targetAgentId: SCOUT_DISPATCHER_AGENT_ID,
    };
  }

  if (deliveryChannel && (typedChannelTarget || !hasAgentTarget) && payload.intent === "tell") {
    await ensureBrokerActorForDelivery(requesterId);
    const conversation = await ensureBrokerDeliveryConversation({
      requesterId,
      channel: deliveryChannel,
    });
    const snapshot = runtime.snapshot();
    const messageId = createRuntimeId("msg");
    const routeKind = brokerRouteKind(conversation);
    const notifyTargets = conversation.kind === "direct"
      ? []
      : onlineConversationNotifyTargets(conversation, requesterId);
    const message: MessageRecord = {
      id: messageId,
      conversationId: conversation.id,
      actorId: requesterId,
      originNodeId: requesterNodeId,
      class: conversation.kind === "system" ? "system" : "agent",
      body: payload.body.trim(),
      ...(payload.replyToMessageId?.trim() ? { replyToMessageId: payload.replyToMessageId.trim() } : {}),
      ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
      audience: {
        reason: conversation.kind === "direct" ? "direct_message" : "conversation_visibility",
        ...(notifyTargets.length > 0 ? { notify: notifyTargets } : {}),
      },
      visibility: messageVisibilityForConversation(conversation),
      policy: "durable",
      createdAt,
      metadata: {
        ...(payload.messageMetadata ?? {}),
        ...(labels.length ? { labels } : {}),
        relayChannel: deliveryChannel,
        relayMessageId: messageId,
        returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
          conversationId: conversation.id,
          replyToMessageId: messageId,
          sessionId: replyToSessionId,
        }),
      },
    };
    await postConversationMessage(message);
    return {
      kind: "delivery",
      accepted: true,
      routeKind,
      receipt: buildDeliveryReceipt({
        requestId,
        routeKind,
        requesterId,
        requesterNodeId,
        targetLabel: deliveryChannel,
        conversationId: conversation.id,
        messageId,
      }),
      conversation,
      message,
    };
  }

  const resolved = await resolveBrokerDeliveryTargetWithImplicitProjectCard({
    ...payload,
    execution,
  }, {
    requesterId,
    currentDirectory: projectPathRouteTarget(payload),
    reason: "implicit project delivery card",
  });

  if (resolved.kind !== "resolved") {
    const { record } = await recordScoutDispatchDurably(
      buildDispatchEnvelope(
        resolved,
        askedLabel,
        nodeId,
        runtime.snapshot(),
        { homeEndpointFor: homeEndpointForAgent },
      ),
      {
        requesterId,
      },
    );
    queueOperatorDeliveryIssue({
      kind: "rejected",
      requestId,
      requesterId,
      requesterNodeId,
      targetLabel: askedLabel || "Scout",
      detail: `Scout could not route ${askedLabel || "the requested target"} from ${titleCaseName(requesterId)}: ${record.detail}`,
    });
    return {
      kind: "rejected",
      accepted: false,
      reason: resolved.kind === "ambiguous"
        ? "ambiguous_target"
        : resolved.kind === "unknown"
        ? "unknown_target"
        : askedLabel.trim().length > 0
        ? "invalid_target"
        : "missing_target",
      rejection: record,
      remediation: remediationForDispatch(record),
    };
  }

  const unavailable = describeUnavailableDeliveryTarget(runtime.snapshot(), resolved.agent);
  if (unavailable) {
    const { record } = await recordScoutDispatchDurably(
      buildUnavailableDispatchEnvelope(askedLabel || brokerTargetLabel(resolved.agent), unavailable),
      {
        requesterId,
      },
    );
    queueOperatorDeliveryIssue({
      kind: "unavailable",
      requestId,
      requesterId,
      requesterNodeId,
      targetLabel: askedLabel || brokerTargetLabel(resolved.agent),
      detail: `Scout could not reach ${askedLabel || brokerTargetLabel(resolved.agent)} for ${titleCaseName(requesterId)}: ${record.detail}`,
    });
    return {
      kind: "question",
      accepted: false,
      question: record,
      remediation: remediationForDispatch(record),
    };
  }

  await ensureBrokerActorForDelivery(requesterId);
  const conversation = await ensureBrokerDeliveryConversation({
    requesterId,
    targetAgentId: resolved.agent.id,
    channel: deliveryChannel,
  });
  const workResolution = payload.intent === "consult"
    ? await recordDeliveryWorkItemIfNeeded({
        payload,
        requestId,
        requesterId,
        targetAgentId: resolved.agent.id,
        conversationId: conversation.id,
        createdAt,
      })
    : deliveryWorkItemResolutionForTell(payload);
  const workRecord = workResolution.record;
  const collaborationRecordId = workResolution.collaborationRecordId;
  const snapshot = runtime.snapshot();
  const messageId = createRuntimeId("msg");
  const targetLabel = brokerTargetLabel(resolved.agent);
  const routeKind = brokerRouteKind(conversation);
  const message: MessageRecord = {
    id: messageId,
    conversationId: conversation.id,
    actorId: requesterId,
    originNodeId: requesterNodeId,
    class: conversation.kind === "system" ? "system" : "agent",
    body: payload.body.trim(),
    ...(payload.replyToMessageId?.trim() ? { replyToMessageId: payload.replyToMessageId.trim() } : {}),
    mentions: [{ actorId: resolved.agent.id, label: targetLabel }],
    ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
    audience: {
      notify: [resolved.agent.id],
      reason: conversation.kind === "direct" ? "direct_message" : "mention",
    },
    visibility: messageVisibilityForConversation(conversation),
    policy: "durable",
    createdAt,
    metadata: {
      ...(payload.messageMetadata ?? {}),
      ...(labels.length ? { labels } : {}),
      ...(targetSessionId ? { targetSessionId } : {}),
      relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
      relayTarget: resolved.agent.id,
      relayTargetIds: [resolved.agent.id],
      relayMessageId: messageId,
      ...(collaborationRecordId ? { collaborationRecordId, workId: collaborationRecordId } : {}),
      returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
        conversationId: conversation.id,
        replyToMessageId: messageId,
        sessionId: replyToSessionId,
      }),
    },
  };
  await postConversationMessage(message);

  const shouldDispatchTargetTurn =
    payload.intent === "consult"
    || (payload.intent === "tell"
      && conversation.kind === "direct"
      && payload.ensureAwake !== false);

  if (!shouldDispatchTargetTurn) {
    const receipt = buildDeliveryReceipt({
      requestId,
      routeKind,
      requesterId,
      requesterNodeId,
      targetAgentId: resolved.agent.id,
      targetSessionId,
      targetLabel,
      conversationId: conversation.id,
      messageId,
    });
    return {
      kind: "delivery",
      accepted: true,
      routeKind,
      receipt,
      conversation,
      message,
      targetAgentId: resolved.agent.id,
      ...(targetSessionId ? { targetSessionId } : {}),
      ...(workRecord?.kind === "work_item" ? { workItem: workRecord } : {}),
    };
  }

  const invocationMetadata = {
    ...(typeof payload.messageMetadata?.source === "string" && payload.invocationMetadata?.source === undefined
      ? { source: payload.messageMetadata.source }
      : {}),
    ...(payload.invocationMetadata ?? {}),
    ...(targetSessionId ? { targetSessionId } : {}),
    ...(payload.intent === "tell" && payload.invocationMetadata?.sourceIntent === undefined
      ? { sourceIntent: "direct_message" }
      : {}),
  };
  const invocationExecution = {
    ...(execution ?? (payload.intent === "tell" ? { session: "any" as const } : {})),
    ...(targetSessionId ? { session: "existing" as const, targetSessionId } : {}),
  };
  const invocation: InvocationRequest = {
    id: createRuntimeId("inv"),
    requesterId,
    requesterNodeId,
    targetAgentId: resolved.agent.id,
    action: payload.intent === "tell" ? "wake" : "consult",
    task: payload.body.trim(),
    ...(collaborationRecordId ? { collaborationRecordId } : {}),
    conversationId: conversation.id,
    messageId,
    ...(Object.keys(invocationExecution).length > 0 ? { execution: invocationExecution } : {}),
    ensureAwake: payload.ensureAwake ?? true,
    stream: false,
    createdAt,
    ...(labels.length ? { labels } : {}),
    metadata: {
      ...invocationMetadata,
      ...(labels.length ? { labels } : {}),
      ...(targetSessionId ? { targetSessionId } : {}),
      relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
      relayTarget: resolved.agent.id,
      ...(collaborationRecordId ? { collaborationRecordId, workId: collaborationRecordId } : {}),
      returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
        conversationId: conversation.id,
        replyToMessageId: messageId,
        sessionId: replyToSessionId,
      }),
    },
  };
  const flight = await acceptInvocationDurably(invocation);
  const bindingRef = flight.id.slice(-8);
  dispatchAcceptedInvocation(invocation).catch((error) => {
    console.error(`[openscout-runtime] background dispatch failed for invocation ${invocation.id}:`, error);
  });
  return {
    kind: "delivery",
    accepted: true,
    routeKind,
    receipt: buildDeliveryReceipt({
      requestId,
      routeKind,
      requesterId,
      requesterNodeId,
      targetAgentId: resolved.agent.id,
      targetSessionId,
      targetLabel,
      bindingRef,
      conversationId: conversation.id,
      messageId,
      flightId: flight.id,
    }),
    conversation,
    message,
    targetAgentId: resolved.agent.id,
    ...(targetSessionId ? { targetSessionId } : {}),
    bindingRef,
    flight,
    ...(workRecord?.kind === "work_item" ? { workItem: workRecord } : {}),
  };
}

function createBrokerHttpServer(): ReturnType<typeof createServer> {
  return createServer((request, response) => {
    routeRequest(request, response).catch((error) => {
      json(response, 500, {
        error: "internal_error",
        detail: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

const server = createBrokerHttpServer();
const socketServer = createBrokerHttpServer();
server.on("close", () => {
  unregisterActiveScoutBrokerService(brokerService);
});

// ─── tRPC over WebSocket — broker firehose endpoints ───────────────────────
// Mounted at /trpc. Tail and topology firehoses live here. Future endpoints
// (agent activity, control events) get added to broker-trpc-router.ts and
// consumers pick up the new procedures via end-to-end type inference.
//
// See docs/tail-firehose.md.

const wsRequire = createRequire(import.meta.url);
const { WebSocketServer } = wsRequire("ws") as typeof import("ws");

const trpcWss = new WebSocketServer({ noServer: true });

function handleBrokerUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (url.pathname === "/trpc") {
    trpcWss.handleUpgrade(request, socket, head, (ws) => {
      trpcWss.emit("connection", ws, request);
    });
    return;
  }
  socket.destroy();
}

server.on("upgrade", handleBrokerUpgrade);
socketServer.on("upgrade", handleBrokerUpgrade);

const trpcHandler = applyWSSHandler({
  wss: trpcWss,
  router: brokerRouter,
  createContext: () => ({}),
});

try {
  await listenTcp(server);
  await listenUnixSocket(socketServer, brokerSocketPath);
  peerDelivery.start();
  const meshRendezvousConfig = resolveMeshRendezvousPublishConfig();
  if (meshRendezvousConfig) {
    meshRendezvousPublisher = startMeshRendezvousPublisher(currentRendezvousNode, {
      config: meshRendezvousConfig,
      logger: console,
    });
  }
  console.log(`[openscout-runtime] broker listening on ${host}:${port} (scope: ${advertiseScope}, url: ${brokerUrl})`);
  console.log(`[openscout-runtime] broker local socket ${brokerSocketPath}`);
  if (advertiseScope === "mesh" && isLoopbackHost(host)) {
    console.warn(`[openscout-runtime] WARNING: mesh scope bound to loopback ${host} — peers cannot reach this broker. Set OPENSCOUT_BROKER_HOST=0.0.0.0 or unset to use the mesh default.`);
  }
  console.log(`[openscout-runtime] node ${nodeId} in mesh ${meshId}`);
  console.log(`[openscout-runtime] journal ${journalPath}`);
  console.log(`[openscout-runtime] sqlite ${sqliteDisabled ? "disabled" : dbPath}`);
} catch (error) {
  unregisterActiveScoutBrokerService(brokerService);
  await Promise.all([closeServer(socketServer), closeServer(server)]).catch(() => undefined);
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
  reconcileStaleLocalDeliveries().catch((error) => {
    console.error("[openscout-runtime] stale delivery reconciliation failed:", error);
  });
}, 0).unref();

discoverPeers().catch((error) => {
  console.error("[openscout-runtime] initial mesh discovery failed:", error);
});

if (Number.isFinite(discoveryIntervalMs) && discoveryIntervalMs > 0) {
  setInterval(() => {
    discoverPeers().catch((error) => {
      console.error("[openscout-runtime] periodic mesh discovery failed:", error);
    });
  }, discoveryIntervalMs).unref();
}

if (Number.isFinite(localAgentSyncIntervalMs) && localAgentSyncIntervalMs > 0) {
  setInterval(() => {
    syncRegisteredLocalAgentsIfChanged("periodic").catch((error) => {
      console.error("[openscout-runtime] periodic local agent sync failed:", error);
    });
  }, localAgentSyncIntervalMs).unref();
}

function closeServer(serverInstance: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    if (!serverInstance.listening) {
      resolve();
      return;
    }
    serverInstance.close(() => resolve());
  });
}

async function shutdownBroker(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (webServerProcess && !webServerProcess.killed) {
    webServerProcess.kill("SIGTERM");
    webServerProcess = null;
  }
  peerDelivery.stop();
  meshRendezvousPublisher?.stop();
  irohBridgeService?.stop();
  for (const client of eventClients) {
    client.end();
  }
  for (const subscribers of invocationStreamClients.values()) {
    for (const client of subscribers) {
      client.end();
    }
  }
  invocationStreamClients.clear();
  trpcHandler.broadcastReconnectNotification();
  projection.close();
  await Promise.all([closeServer(socketServer), closeServer(server)]);
  await unlink(brokerSocketPath).catch(() => undefined);
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdownBroker(0).catch((error) => {
      console.error("[openscout-runtime] shutdown failed:", error);
      process.exit(1);
    });
  });
}

if (Number.isFinite(parentPid) && parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      console.log(`[openscout-runtime] parent ${parentPid} is gone, exiting broker`);
      shutdownBroker(0).catch((error) => {
        console.error("[openscout-runtime] shutdown failed:", error);
        process.exit(1);
      });
    }
  }, 2_000).unref();
}
