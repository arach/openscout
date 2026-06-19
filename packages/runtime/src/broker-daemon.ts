import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import type { Duplex } from "node:stream";

import { applyWSSHandler } from "@trpc/server/adapters/ws";

import { brokerRouter } from "./broker-trpc-router.js";

import {
  type ActorIdentity,
  type AgentEndpoint,
  type ControlCommand,
  type ConversationDefinition,
  type DeliveryIntent,
  type FlightRecord,
  type InvocationRequest,
  type MessageRecord,
  type NodeDefinition,
  type ScoutDispatchEnvelope,
  type ScoutDispatchRecord,
  mintChannelId,
  OPENSCOUT_COORDINATOR_AGENT_ID,
  SCOUT_DISPATCHER_AGENT_ID,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
import {
  publishControlEvent,
  replaceControlEventBacklog,
} from "./broker-control-events.js";
import { BrokerDeliveryStore } from "./broker-delivery-store.js";
import { FileBackedBrokerJournal, type BrokerJournalEntry } from "./broker-journal.js";
import { BrokerDurableRecordStore } from "./broker-durable-record-store.js";
import { BrokerDurableStore } from "./broker-durable-store.js";
import { BrokerReadCursorStore } from "./broker-read-cursor-store.js";
import { BrokerWorkItemStore } from "./broker-work-item-store.js";
import { BrokerDeliveryRouter } from "./broker-delivery-routing.js";
import { BrokerDeliveryAcceptanceService } from "./broker-delivery-acceptance-service.js";
import { BrokerDeliveryHttpService } from "./broker-delivery-http-service.js";
import { BrokerDurableActionHttpService } from "./broker-durable-action-http-service.js";
import { BrokerFlightLifecycleService } from "./broker-flight-lifecycle-service.js";
import { BrokerRepoTailService } from "./broker-repo-tail-service.js";
import { BrokerOperatorAttentionService } from "./broker-operator-attention-service.js";
import { BrokerLocalAgentSyncService } from "./broker-local-agent-sync-service.js";
import {
  resolveAgentLabel,
  type BrokerRouteTargetInput,
} from "./scout-dispatcher.js";
import { buildCollaborationInvocation } from "./collaboration-invocations.js";
import { resolveOperatorName } from "./user-config.js";
import {
  resolveIrohMeshEntrypointFromEnv,
  startIrohBridgeServeFromEnv,
  type IrohBridgeService,
} from "./iroh-bridge.js";
import { createPeerDeliveryWorker, type PeerDeliveryWorker } from "./peer-delivery.js";
import {
  ensureLocalSessionEndpointOnline,
  ensureLocalAgentBindingOnline,
  isLocalAgentEndpointAlive,
  isLocalAgentSessionAlive,
  invokeLocalAgentEndpoint,
  loadRegisteredLocalAgentBindings,
  shutdownLocalSessionEndpoint,
  shouldDisableGeneratedCodexEndpoint,
} from "./local-agents.js";
import {
  ensurePairingSessionForCodexThread,
  findPairingSession,
  getPairingSessionSnapshot,
  invokePairingSessionEndpoint,
  listPairingSessions,
} from "./pairing-session-agents.js";
import { RecoverableSQLiteProjection } from "./sqlite-projection.js";
import { ThreadEventPlane } from "./thread-events.js";
import { invokeA2AHttpEndpoint } from "./a2a-http-endpoint.js";
import { ensureOpenScoutCleanSlateSync, resolveOpenScoutSupportPaths } from "./support-paths.js";
import {
  requestScoutBrokerJson,
  registerActiveScoutBrokerService,
  unregisterActiveScoutBrokerService,
} from "./broker-api.js";
import { createBrokerCoreService } from "./broker-core-service.js";
import {
  buildDefaultBrokerUrl,
  buildLocalBrokerControlUrl,
  DEFAULT_BROKER_PORT,
  isLoopbackHost,
  resolveBrokerServiceConfig,
  resolveAdvertiseScope,
  resolveBrokerHost,
} from "./broker-process-manager.js";
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
import {
  getTailDiscovery,
  readRecentLiveEvents,
  readRecentTranscriptEvents,
} from "./tail/index.js";
import {
  getRepoWatchSnapshot,
  repoWatchHintsFromBrokerSnapshot,
  repoWatchHintsFromTailDiscovery,
} from "./repo-watch/index.js";
import { readTailscaleSelfWebHostsSync } from "./tailscale.js";
import { BrokerWebControlService } from "./broker-web-control-service.js";
import { BrokerA2AService } from "./broker-a2a-service.js";
import { BrokerCapabilityMatrixService } from "./broker-capability-matrix-service.js";
import { isGeneratedLocalAgentMetadata } from "./broker-managed-session-helpers.js";
import { BrokerManagedSessionService } from "./broker-managed-session-service.js";
import { BrokerManagedSessionHttpService } from "./broker-managed-session-http-service.js";
import { BrokerLocalEndpointResolver } from "./broker-local-endpoint-resolver.js";
import { BrokerLocalInvocationService } from "./broker-local-invocation-service.js";
import { BrokerControlStreamService } from "./broker-control-stream-service.js";
import { json } from "./broker-http-helpers.js";
import { createBrokerHttpRouter } from "./broker-http-router.js";
import {
  closeServer,
  isAddressInUse,
  listenTcp,
  listenUnixSocket,
} from "./broker-server-lifecycle.js";
import { BrokerMeshBundleService } from "./broker-mesh-bundle-service.js";
import { BrokerMeshForwardingService } from "./broker-mesh-forwarding-service.js";
import { BrokerMeshDiscoveryService } from "./broker-mesh-discovery-service.js";
import { BrokerMeshHttpService } from "./broker-mesh-http-service.js";
import { BrokerConversationService } from "./broker-conversation-service.js";
import { BrokerMessageService } from "./broker-message-service.js";
import { BrokerInvocationDispatchService } from "./broker-invocation-dispatch-service.js";
import { BrokerCommandService } from "./broker-command-service.js";
import { BrokerDispatchRecoveryService } from "./broker-dispatch-recovery-service.js";
import {
  brokerActorDisplayName as resolveBrokerActorDisplayName,
  brokerRouteKind,
  brokerTargetLabel,
  brokerTargetProjectRoot,
  buildBrokerReturnAddressForActor,
  isLocalScoutProductTarget,
  isOperatorDeliveryTarget,
  messageRefCandidateForRouteTarget,
  messageVisibilityForConversation,
  metadataStringValue,
  resolveBrokerMessageRef,
  scoutbotReplyProvenanceMetadata,
  titleCaseName,
} from "./broker-conversation-helpers.js";
import {
  isReconciledStaleFlightActivityItem,
  isTerminalFlightState,
  staleLocalEndpointReason,
} from "./broker-local-invocation-helpers.js";
import {
  homeEndpointForAgent,
  isInactiveLocalAgent,
} from "./broker-endpoint-selection.js";
import { BrokerHomeService } from "./broker-home-service.js";
import { BrokerUnavailableTargetService } from "./broker-unavailable-target-service.js";

const PROCESS_NAME = "scout-broker";

process.title = PROCESS_NAME;

function createRuntimeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveControlPlaneHome(): string {
  return process.env.OPENSCOUT_CONTROL_HOME
    ?? join(process.env.HOME ?? process.cwd(), ".openscout", "control-plane");
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
const brokerControlUrl = buildLocalBrokerControlUrl(host, port);
const brokerSocketPath = process.env.OPENSCOUT_BROKER_SOCKET_PATH
  ?? resolveBrokerServiceConfig().brokerSocketPath;
const nodeId = process.env.OPENSCOUT_NODE_ID ?? `${nodeName}-${meshId}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
const tailnetWebHosts = readTailscaleSelfWebHostsSync();
const nodeLocalProductAgentIds = new Set([
  SCOUT_DISPATCHER_AGENT_ID,
  OPENSCOUT_COORDINATOR_AGENT_ID,
  "scoutbot",
]);
const seedUrls = (process.env.OPENSCOUT_MESH_SEEDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const webStartTrustedHosts = new Set(
  [
    ...(process.env.OPENSCOUT_WEB_TRUSTED_HOSTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ...tailnetWebHosts,
  ].map((value) => value.replace(/\.$/, "").toLowerCase()),
);
const configuredCoreAgentIds = (process.env.OPENSCOUT_CORE_AGENTS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const discoveryIntervalMs = Number.parseInt(process.env.OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS ?? "60000", 10);
const parentPid = Number.parseInt(process.env.OPENSCOUT_PARENT_PID ?? "0", 10);
const localAgentSyncIntervalMs = Number.parseInt(process.env.OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS ?? "5000", 10);
const repoWatchServeCacheTtlMs = Number.parseInt(process.env.OPENSCOUT_REPO_WATCH_CACHE_TTL_MS ?? "1200000", 10);
const repoWatchRehydrateAfterMs = Number.parseInt(process.env.OPENSCOUT_REPO_WATCH_REHYDRATE_AFTER_MS ?? "30000", 10);

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
const durableStore = new BrokerDurableStore({
  journal,
  projection,
  threadEvents,
});
const runDurableWrite = durableStore.runWrite;
const commitDurableEntries = durableStore.commitEntries;
const applyProjectedEntries = durableStore.applyProjectedEntries;
const meshBundleService = new BrokerMeshBundleService({
  nodeId,
  runtime,
  commitEntries: commitDurableEntries,
});
const applyMeshBundleDurably = meshBundleService.applyBundle;
const activeInvocationTasks = new Map<string, Promise<void>>();
const knownInvocations = new Map<string, InvocationRequest>(Object.entries(initialSnapshot.invocations));
const meshHttpService = new BrokerMeshHttpService({
  nodeId,
  runtime,
  runDurableWrite,
  applyMeshBundle: applyMeshBundleDurably,
  commitEntries: commitDurableEntries,
  applyProjectedEntries,
  rememberInvocation: (invocation) => {
    knownInvocations.set(invocation.id, invocation);
  },
  runDispatchJob: (job, invocation) => invocationDispatchService.runDispatchJob(job, invocation),
  warn: (message, detail) => console.warn(message, detail),
});
const meshForwardingService = new BrokerMeshForwardingService({
  nodeId,
  runtime,
  currentLocalNode,
  invocationFor: (invocationId) => knownInvocations.get(invocationId),
  endpointForAgent: (agentId) => homeEndpointForAgent(runtime.snapshot(), agentId),
  projectRootForTarget: brokerTargetProjectRoot,
});
const controlStreams = new BrokerControlStreamService({
  enqueueEvent: (event) => projection.enqueueEvent(event),
  findDeliveryById: (deliveryId) => journal.listDeliveries({ limit: 1000 }).find((delivery) => delivery.id === deliveryId),
  listDeliveries: (options) => projection.listDeliveries(options),
  messageById: (messageId) => runtime.message(messageId),
  invocationById: (invocationId) => knownInvocations.get(invocationId),
});
const operatorActorId = "operator";
const durableRecords = new BrokerDurableRecordStore({
  runtime,
  durableStore,
  knownInvocations,
});
const upsertNodeDurably = durableRecords.upsertNode;
const upsertActorDurably = durableRecords.upsertActor;
const upsertAgentDurably = durableRecords.upsertAgent;
const upsertEndpointDurably = durableRecords.upsertEndpoint;
const deleteEndpointDurably = durableRecords.deleteEndpoint;
const upsertConversationDurably = durableRecords.upsertConversation;
const upsertBindingDurably = durableRecords.upsertBinding;
const recordCollaborationDurably = durableRecords.recordCollaboration;
const appendCollaborationEventDurably = durableRecords.appendCollaborationEvent;
const recordUnblockRequestDurably = durableRecords.recordUnblockRequest;
const appendUnblockRequestEventDurably = durableRecords.appendUnblockRequestEvent;
const recordMessageDurably = durableRecords.recordMessage;
const recordInvocationDurably = durableRecords.recordInvocation;
const recordInvocationDispatchJobDurably = durableRecords.recordInvocationDispatchJob;
const conversationService = new BrokerConversationService({
  nodeId,
  operatorActorId,
  dispatcherAgentId: SCOUT_DISPATCHER_AGENT_ID,
  runtime,
  operatorDisplayName: operatorActorDisplayName,
  createChannelId: () => mintChannelId(randomUUID),
  upsertActor: upsertActorDurably,
  upsertConversation: upsertConversationDurably,
});
const meshDiscoveryService = new BrokerMeshDiscoveryService({
  nodeId,
  brokerUrl,
  defaultPort: port,
  meshId,
  seedUrls,
  nodeLocalProductAgentIds,
  runtime,
  upsertNode: upsertNodeDurably,
  upsertAgent: upsertAgentDurably,
  notifyPeerOnline: (peerNodeId) => peerDelivery.notifyPeerOnline(peerNodeId),
  log: (message) => console.log(message),
});
const deliveryStore = new BrokerDeliveryStore({
  journal,
  durableStore,
  nodeId,
  createEventId: () => createRuntimeId("evt"),
  publishEvent: (event) => controlStreams.streamEvent(event),
});
const recordDeliveryDurably = deliveryStore.recordDelivery;
const recordDeliveryAttemptDurably = deliveryStore.recordDeliveryAttempt;
const heartbeatDurableActionDurably = deliveryStore.heartbeatDurableAction;
const updateDeliveryStatusDurably = deliveryStore.updateDeliveryStatus;
const claimDeliveryDurably = deliveryStore.claimDelivery;
const readCursorStore = new BrokerReadCursorStore({
  runtime,
  projection,
  durableStore,
  operatorActorId,
  nodeId,
  ensureActor: ensureBrokerActorForDelivery,
  updateDeliveryStatus: updateDeliveryStatusDurably,
});
const listReadCursorsForConversation = readCursorStore.listForConversation;
const resolveReadCursor = readCursorStore.resolve;
const recordReadCursorDurably = readCursorStore.record;
const acknowledgeDeliveriesForReadCursor = readCursorStore.acknowledgeDeliveries;
const deliveryHttpService = new BrokerDeliveryHttpService({
  listInboxItems: (options) => controlStreams.listInboxItems(options),
  inboxItemForDelivery: (delivery) => controlStreams.inboxItemForDelivery(delivery),
  claimDelivery: claimDeliveryDurably,
  updateDeliveryStatus: updateDeliveryStatusDurably,
  listDeliveries: (options) => journal.listDeliveries(options),
  listDeliveryAttempts: (deliveryId) => journal.listDeliveryAttempts(deliveryId),
  recordDeliveryAttempt: recordDeliveryAttemptDurably,
});
const durableActionHttpService = new BrokerDurableActionHttpService({
  runDurableWrite,
  commitEntries: commitDurableEntries,
  heartbeatDurableAction: heartbeatDurableActionDurably,
  getDurableAction: (actionId) => journal.getDurableAction(actionId),
});
const workItemStore = new BrokerWorkItemStore({
  runtime,
  durableStore,
  createId: createRuntimeId,
});
const recordDeliveryWorkItemIfNeeded = workItemStore.recordDeliveryWorkItemIfNeeded;
const deliveryWorkItemResolutionForTell = workItemStore.deliveryWorkItemResolutionForTell;
const promoteInvocationFlightToWork = workItemStore.promoteInvocationFlightToWork;
const deliveryRouter = new BrokerDeliveryRouter({
  runtimeSnapshot: () => runtime.snapshot(),
  nodeId,
  isInactiveLocalAgent,
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
});
const resolveBrokerDeliveryTargetWithImplicitProjectAgent =
  deliveryRouter.resolveWithImplicitProjectAgent.bind(deliveryRouter);
const resolveInvocationTarget = deliveryRouter.resolveInvocationTarget.bind(deliveryRouter);
const webControl = new BrokerWebControlService({
  brokerControlUrl,
  tailnetWebHosts,
  trustedHosts: webStartTrustedHosts,
  env: process.env,
  log: (message, detail) => {
    if (detail === undefined) {
      console.log(message);
    } else {
      console.log(message, detail);
    }
  },
  warn: (message) => console.warn(message),
  error: (message, detail) => {
    if (detail === undefined) {
      console.error(message);
    } else {
      console.error(message, detail);
    }
  },
});
const a2aService = new BrokerA2AService({
  nodeId,
  brokerUrl,
  runtime,
  knownInvocations,
  activeInvocationTasks,
  createId: createRuntimeId,
  acceptInvocation: acceptInvocationDurably,
  dispatchInvocation: dispatchAcceptedInvocation,
  recordFlight: recordFlightDurably,
  loadRegisteredLocalAgentBindings,
  sleep,
  error: (message, detail) => {
    if (detail === undefined) {
      console.error(message);
    } else {
      console.error(message, detail);
    }
  },
});
const capabilityMatrixService = new BrokerCapabilityMatrixService({
  nodeId,
  env: process.env,
});
const readBrokerCapabilityMatrixSnapshot = capabilityMatrixService.read.bind(capabilityMatrixService);
let shuttingDown = false;
const sseKeepAliveIntervalMs = Number.parseInt(process.env.OPENSCOUT_SSE_KEEPALIVE_MS ?? "15000", 10);
const BROKER_SHARED_CHANNEL_ID = "channel.shared";
const BROKER_VOICE_CHANNEL_ID = "channel.voice";
const BROKER_SYSTEM_CHANNEL_ID = "channel.system";
let meshRendezvousPublisher: MeshRendezvousPublisher | null = null;
let parentWatcher: ReturnType<typeof setInterval> | null = null;

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

runtime.subscribe((event) => {
  controlStreams.streamEvent(event);
  publishControlEvent(event);
});

if (sseKeepAliveIntervalMs > 0) {
  setInterval(() => {
    controlStreams.streamKeepAlive();
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

async function readRelayAgentRegistrySignature(): Promise<string | null> {
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
  await localAgentSyncService.syncIfChanged(reason);
}

async function bootstrapRegisteredLocalAgents(): Promise<void> {
  await localAgentSyncService.bootstrap();
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

const flightLifecycleService = new BrokerFlightLifecycleService({
  runtime,
  journal,
  durableStore,
  invocationFor: (invocationId) => knownInvocations.get(invocationId),
  updateDeliveryStatus: updateDeliveryStatusDurably,
  promoteInvocationFlightToWork,
  maybeForwardFlightToAuthority: (flight) => meshForwardingService.maybeForwardFlightToAuthority(flight),
  isInvocationActive: (invocationId) => localInvocationService.hasActiveInvocation(invocationId),
  warn: (message, detail) => {
    if (detail === undefined) {
      console.warn(message);
    } else {
      console.warn(message, detail);
    }
  },
});

async function recordFlightDurably(flight: FlightRecord): Promise<void> {
  await flightLifecycleService.recordFlight(flight);
}

async function reconcileStaleLocalDeliveries(): Promise<void> {
  await flightLifecycleService.reconcileStaleLocalDeliveries();
}

async function persistFlight(flight: FlightRecord): Promise<void> {
  await recordFlightDurably(flight);
}

async function persistEndpoint(endpoint: AgentEndpoint): Promise<void> {
  await upsertEndpointDurably(endpoint);
  if (endpoint.state === "idle" || endpoint.state === "active") {
    dispatchRecoveryService.recoverQueuedFlights({
      reason: "endpoint_online",
      agentId: endpoint.agentId,
    }).catch((error) => {
      console.error("[openscout-runtime] queued dispatch recovery failed:", error);
    });
  }
}

const managedSessionService = new BrokerManagedSessionService({
  nodeId,
  runtime,
  createId: createRuntimeId,
  isInactiveLocalAgent,
  upsertAgent: upsertAgentDurably,
  persistEndpoint,
  findPairingSession,
  getPairingSessionSnapshot,
  ensurePairingSessionForCodexThread,
  shutdownLocalSessionEndpoint,
  log: (message) => console.log(message),
});

const managedSessionHttpService = new BrokerManagedSessionHttpService({
  nodeId,
  runtimeSnapshot: () => runtime.snapshot(),
  processCwd: () => process.cwd(),
  listPairingSessions,
  attachManagedPairingSession: (input) => managedSessionService.attachManagedPairingSession(input),
  detachManagedPairingSession: (input) => managedSessionService.detachManagedPairingSession(input),
  attachManagedLocalSession: (input) => managedSessionService.attachManagedLocalSession(input),
  detachManagedLocalSession: (input) => managedSessionService.detachManagedLocalSession(input),
  ensureLocalSessionEndpointOnline,
  persistEndpoint,
});

const localEndpointResolver = new BrokerLocalEndpointResolver({
  nodeId,
  runtime,
  isLocalAgentEndpointAlive,
  ensureLocalSessionEndpointOnline,
  ensureLocalAgentBindingOnline,
  upsertActor: upsertActorDurably,
  upsertAgent: upsertAgentDurably,
  persistEndpoint,
});

const messageService = new BrokerMessageService({
  nodeId,
  systemActorId: systemActor.id,
  runtime,
  mesh: meshForwardingService,
  createId: createRuntimeId,
  recordMessage: recordMessageDurably,
  applyProjectedEntries,
  reconcileStaleLocalDeliveries,
  persistFlight,
  activeLocalEndpointForAgent: (agentId) => localEndpointResolver.activeLocalEndpointForAgent(agentId),
});

const localInvocationService = new BrokerLocalInvocationService({
  nodeId,
  runtime,
  endpointResolver: localEndpointResolver,
  activeInvocationTasks,
  createId: createRuntimeId,
  persistFlight,
  persistEndpoint,
  postInvocationStatusMessage,
  postConversationMessage,
  existingBrokerReplyForInvocation,
  completeInvocationForBrokerReply,
  messageVisibilityForConversation,
  scoutbotReplyProvenanceMetadata,
  invokePairingSessionEndpoint,
  invokeA2AHttpEndpoint,
  invokeLocalAgentEndpoint,
  error: (message, detail) => console.error(message, detail),
  warn: (message) => console.warn(message),
});

const localAgentSyncService = new BrokerLocalAgentSyncService({
  nodeId,
  configuredCoreAgentIds,
  runtime,
  registrySignature: readRelayAgentRegistrySignature,
  migrateRelayAgentKeys: migrateUnqualifiedRelayAgentKeys,
  readRelayAgentOverrides,
  loadRegisteredLocalAgentBindings,
  clearGitBranchCache,
  isGeneratedLocalAgentMetadata,
  isLocalAgentEndpointAlive,
  isLocalAgentSessionAlive,
  shouldDisableGeneratedCodexEndpoint,
  upsertActor: upsertActorDurably,
  upsertAgent: upsertAgentDurably,
  persistEndpoint,
  retireLegacyPairingSessionAgents: () => managedSessionService.retireLegacyPairingSessionAgents(),
  reconcileManagedPairingEndpoints: () => managedSessionService.reconcileManagedPairingEndpoints(),
  reconcileStaleWorkingFlights,
  reconcileStaleLocalDeliveries,
  log: (message) => console.log(message),
});

projection.warm();
await upsertNodeDurably(localNode);
await upsertActorDurably(systemActor);

function operatorActorDisplayName(): string {
  return resolveOperatorName().trim() || operatorActorId;
}

function brokerActorDisplayName(snapshot: ReturnType<typeof runtime.snapshot>, actorId: string): string {
  return resolveBrokerActorDisplayName(snapshot, actorId, {
    operatorActorId,
    operatorDisplayName: operatorActorDisplayName(),
  });
}

async function ensureBrokerActorForDelivery(actorId: string): Promise<void> {
  await conversationService.ensureActorForDelivery(actorId);
}

async function ensureBrokerDeliveryConversation(input: {
  requesterId: string;
  targetAgentId?: string;
  channel?: string;
}): Promise<ConversationDefinition> {
  return await conversationService.ensureDeliveryConversation(input);
}

async function reconcileStaleWorkingFlights(): Promise<void> {
  await flightLifecycleService.reconcileStaleWorkingFlights();
}

async function syncRegisteredLocalAgents(): Promise<void> {
  await localAgentSyncService.sync();
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
  return await messageService.postConversationMessage(message);
}

async function postInvocationStatusMessage(
  invocation: InvocationRequest,
  flight: {
    id?: string;
    summary?: string;
    error?: string;
  },
): Promise<void> {
  await messageService.postInvocationStatusMessage(invocation, flight);
}

function existingBrokerReplyForInvocation(
  invocation: InvocationRequest,
  agentId: string,
  sinceMs: number,
): MessageRecord | null {
  return messageService.existingBrokerReplyForInvocation(invocation, agentId, sinceMs);
}

async function completeInvocationForBrokerReply(
  invocation: InvocationRequest,
  reply: MessageRecord,
): Promise<boolean> {
  return await messageService.completeInvocationForBrokerReply(invocation, reply);
}

function onlineConversationNotifyTargets(
  conversation: ConversationDefinition,
  requesterId: string,
): string[] {
  return messageService.onlineConversationNotifyTargets(conversation, requesterId);
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

async function handleCommand(command: ControlCommand): Promise<unknown> {
  return await commandService.execute(command);
}

async function handleInvocationRequest(
  payload: InvocationRequest & BrokerRouteTargetInput,
) {
  return await invocationDispatchService.handleInvocationRequest(payload);
}

async function acceptInvocationDurably(invocation: InvocationRequest): Promise<FlightRecord> {
  const { flight } = await invocationDispatchService.acceptInvocation(invocation);
  return flight;
}

async function dispatchAcceptedInvocation(invocation: InvocationRequest): Promise<void> {
  const job = journal.getInvocationDispatchJobForInvocation(invocation.id);
  if (job) {
    await invocationDispatchService.runDispatchJob(job, invocation);
    return;
  }
  await invocationDispatchService.dispatchAcceptedInvocation(invocation);
}

async function failAcceptedInvocation(invocation: InvocationRequest, detail: string): Promise<void> {
  await invocationDispatchService.failAcceptedInvocation(invocation, detail);
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
  emit: (event) => controlStreams.streamEvent(event),
});

const invocationDispatchService = new BrokerInvocationDispatchService({
  nodeId,
  runtime,
  createId: createRuntimeId,
  syncRegisteredLocalAgentsIfChanged,
  resolveInvocationTarget,
  recordScoutDispatch: recordScoutDispatchDurably,
  recordInvocation: recordInvocationDurably,
  recordInvocationDispatchJob: recordInvocationDispatchJobDurably,
  applyProjectedEntries,
  recordFlight: recordFlightDurably,
  postInvocationStatusMessage,
  describeRemoteAuthorityIssue: (agent, authorityNode) =>
    meshForwardingService.describeRemoteAuthorityIssue(agent, authorityNode),
  describeUnavailableInvocationTarget: (snapshot, agent, targetSessionId) =>
    unavailableTargetService.describe(snapshot, agent, targetSessionId),
  buildUnavailableDispatchEnvelope: (askedLabel, unavailable) =>
    unavailableTargetService.buildEnvelope(askedLabel, unavailable),
  enqueuePeerInvocation: async (invocation, authorityNode) => {
    await peerDelivery.enqueue(invocation, authorityNode);
  },
  launchLocalInvocation: (invocation, flight) => localInvocationService.launch(invocation, flight),
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message, detail) => console.error(message, detail),
});

const dispatchRecoveryService = new BrokerDispatchRecoveryService({
  runtimeSnapshot: () => runtime.snapshot(),
  dispatchJobs: () => journal.listInvocationDispatchJobs({ limit: 5000 }),
  invocationFor: (invocationId) => knownInvocations.get(invocationId),
  isInvocationActive: (invocationId) => localInvocationService.hasActiveInvocation(invocationId),
  runDispatchJob: (job, invocation) => invocationDispatchService.runDispatchJob(job, invocation),
  dispatchAcceptedInvocation: (invocation) => invocationDispatchService.dispatchAcceptedInvocation(invocation),
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
});

const commandService = new BrokerCommandService({
  runtime,
  mesh: meshForwardingService,
  upsertNode: upsertNodeDurably,
  upsertActor: upsertActorDurably,
  upsertAgent: upsertAgentDurably,
  persistEndpoint,
  upsertConversation: upsertConversationDurably,
  upsertBinding: upsertBindingDurably,
  recordCollaboration: recordCollaborationDurably,
  appendCollaborationEvent: appendCollaborationEventDurably,
  recordUnblockRequest: recordUnblockRequestDurably,
  appendUnblockRequestEvent: appendUnblockRequestEventDurably,
  recordMessage: recordMessageDurably,
  applyProjectedEntries,
  reconcileStaleLocalDeliveries,
  acceptAndDispatchInvocation: (invocation, options) =>
    invocationDispatchService.acceptAndDispatch(invocation, options),
  log: (message) => console.log(message),
});

const operatorAttentionService = new BrokerOperatorAttentionService({
  nodeId,
  systemActorId: systemActor.id,
  operatorActorId,
  createId: createRuntimeId,
  ensureBrokerActorForDelivery,
  ensureBrokerDeliveryConversation,
  messageVisibilityForConversation,
  postConversationMessage,
  broadcastApnsAlertToActiveMobileDevices,
  warn: (message) => console.warn(message),
});

const unavailableTargetService = new BrokerUnavailableTargetService({
  nodeId,
  describeRemoteAuthorityIssue: (agent, authorityNode) =>
    meshForwardingService.describeRemoteAuthorityIssue(agent, authorityNode),
});

const deliveryAcceptanceService = new BrokerDeliveryAcceptanceService({
  nodeId,
  operatorActorId,
  runtimeSnapshot: () => runtime.snapshot(),
  createId: createRuntimeId,
  syncRegisteredLocalAgentsIfChanged,
  metadataStringValue,
  messageRefCandidateForRouteTarget,
  resolveBrokerMessageRef,
  ensureBrokerActorForDelivery,
  ensureBrokerDeliveryConversation,
  brokerRouteKind,
  messageVisibilityForConversation,
  brokerActorDisplayName,
  brokerTargetLabel,
  homeEndpointForAgent,
  titleCaseName,
  buildBrokerReturnAddressForActor,
  isOperatorDeliveryTarget,
  isLocalScoutProductTarget,
  onlineConversationNotifyTargets,
  resolveBrokerDeliveryTargetWithImplicitProjectAgent,
  recordScoutDispatch: recordScoutDispatchDurably,
  describeUnavailableDeliveryTarget: (snapshot, agent, targetSessionId) =>
    unavailableTargetService.describe(snapshot, agent, targetSessionId),
  buildUnavailableDispatchEnvelope: (askedLabel, unavailable) =>
    unavailableTargetService.buildEnvelope(askedLabel, unavailable),
  recordDeliveryWorkItemIfNeeded,
  deliveryWorkItemResolutionForTell,
  postConversationMessage,
  acceptInvocation: acceptInvocationDurably,
  dispatchAcceptedInvocation,
  queueOperatorDeliveryIssue: (input) => operatorAttentionService.queueDeliveryIssue(input),
  warn: (message, detail) => console.warn(message, detail),
});

const homeService = new BrokerHomeService({
  runtimeSnapshot: () => runtime.snapshot(),
  listActivityItems: (options) => projection.listActivityItems(options),
  actorDisplayName: brokerActorDisplayName,
  operatorActorId,
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
  readChildServices: () => webControl.readChildServiceSnapshots(),
  readHome: () => homeService.read(),
  readCapabilities: readBrokerCapabilityMatrixSnapshot,
  executeCommand: handleCommand,
  postConversationMessage,
  deliver: (payload, options) => deliveryAcceptanceService.accept(payload, options),
  invokeAgent: handleInvocationRequest,
});

const brokerRepoTailService = new BrokerRepoTailService({
  readBrokerSnapshot: () => brokerService.readSnapshot(),
  getRepoWatchSnapshot,
  repoWatchHintsFromBrokerSnapshot,
  repoWatchHintsFromTailDiscovery,
  getTailDiscovery,
  readRecentLiveEvents,
  readRecentTranscriptEvents,
  repoWatchServeCacheTtlMs,
  repoWatchRehydrateAfterMs,
  warn: (message) => console.warn(message),
});

registerActiveScoutBrokerService(brokerService);

const routeRequest = createBrokerHttpRouter({
  host,
  port,
  nodeId,
  meshId,
  operatorActorId,
  runtime,
  journal,
  knownInvocations,
  brokerService,
  webControl,
  a2aService,
  brokerRepoTailService,
  getHarnessTopologySnapshot,
  getTailDiscovery,
  nudgeHarnessTopologyScan,
  deliveryHttpService,
  durableActionHttpService,
  controlStreams,
  managedSessionHttpService,
  meshDiscoveryService,
  meshHttpService,
  threadEvents,
  handleCommand,
  handleInvocationRequest,
  deleteEndpoint: deleteEndpointDurably,
  recordFlight: recordFlightDurably,
  listReadCursorsForConversation,
  resolveReadCursor,
  recordReadCursor: recordReadCursorDurably,
  acknowledgeDeliveriesForReadCursor,
  deliveryAcceptanceService,
});
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
  await listenTcp(server, { host, port });
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
  bootstrapRegisteredLocalAgents()
    .then(() => dispatchRecoveryService.recoverQueuedFlights({ reason: "startup" }))
    .catch((error) => {
      console.error("[openscout-runtime] local agent bootstrap or dispatch recovery failed:", error);
    });
  reconcileStaleWorkingFlights().catch((error) => {
    console.error("[openscout-runtime] stale flight reconciliation failed:", error);
  });
  reconcileStaleLocalDeliveries().catch((error) => {
    console.error("[openscout-runtime] stale delivery reconciliation failed:", error);
  });
}, 0).unref();

meshDiscoveryService.discoverPeers().catch((error) => {
  console.error("[openscout-runtime] initial mesh discovery failed:", error);
});

if (Number.isFinite(discoveryIntervalMs) && discoveryIntervalMs > 0) {
  setInterval(() => {
    meshDiscoveryService.discoverPeers().catch((error) => {
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

async function shutdownBroker(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (parentWatcher) {
    clearInterval(parentWatcher);
    parentWatcher = null;
  }
  webControl.stop();
  peerDelivery.stop();
  meshRendezvousPublisher?.stop();
  irohBridgeService?.stop();
  controlStreams.closeAll();
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
  parentWatcher = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      console.log(`[openscout-runtime] parent ${parentPid} is gone, exiting broker`);
      shutdownBroker(0).catch((error) => {
        console.error("[openscout-runtime] shutdown failed:", error);
        process.exit(1);
      });
    }
  }, 2_000);
  parentWatcher.unref();
}
