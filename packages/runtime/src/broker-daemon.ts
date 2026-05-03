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
  buildScoutReturnAddress,
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
  type DeliveryReason,
  type FlightRecord,
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
  SCOUT_DISPATCHER_AGENT_ID,
  normalizeAgentSelectorSegment,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
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
  shutdownLocalSessionEndpoint,
  shouldDisableGeneratedCodexEndpoint,
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
import { clearGitBranchCache, readRelayAgentOverrides, writeRelayAgentOverrides } from "./setup.js";

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
const discoveryIntervalMs = Number.parseInt(process.env.OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS ?? "0", 10);
const parentPid = Number.parseInt(process.env.OPENSCOUT_PARENT_PID ?? "0", 10);
const localAgentSyncIntervalMs = Number.parseInt(process.env.OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS ?? "5000", 10);
let registeredLocalAgentsRegistrySignature: string | null = null;
let registeredLocalAgentsSyncInFlight: Promise<void> | null = null;

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
const threadEvents = new ThreadEventPlane({
  nodeId,
  runtime,
  projection,
});
const eventClients = new Set<ServerResponse>();
const activeInvocationTasks = new Map<string, Promise<void>>();
const knownInvocations = new Map<string, InvocationRequest>();
const sseKeepAliveIntervalMs = Number.parseInt(process.env.OPENSCOUT_SSE_KEEPALIVE_MS ?? "15000", 10);
const operatorActorId = "operator";
const BROKER_SHARED_CHANNEL_ID = "channel.shared";
const BROKER_VOICE_CHANNEL_ID = "channel.voice";
const BROKER_SYSTEM_CHANNEL_ID = "channel.system";
const WEB_START_POLL_TIMEOUT_MS = 15_000;
const WEB_START_POLL_INTERVAL_MS = 250;
let webServerProcess: ChildProcess | null = null;
let webStartInFlight: Promise<WebSupervisorStatus> | null = null;

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
  const child = spawn(bun.path, ["run", entry], {
    detached: true,
    env,
    stdio: ["ignore", logFd, logFd],
  });
  child.once("exit", () => {
    if (webServerProcess === child) {
      webServerProcess = null;
    }
  });
  child.unref();
  return child;
}

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
    const entries = await commitDurableEntries(
      { kind: "flight.record", flight },
      async () => {
        await runtime.upsertFlight(flight);
      },
      { enqueueProjection: false },
    );
    await applyProjectedEntries(entries);
    try {
      await maybeForwardFlightToAuthority(flight);
    } catch (error) {
      console.warn(
        `[openscout-runtime] failed to forward flight ${flight.id} to conversation authority:`,
        error instanceof Error ? error.message : String(error),
      );
    }
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

function isDeliveryClaimable(delivery: DeliveryIntent, now: number): boolean {
  if (delivery.status === "pending" || delivery.status === "accepted" || delivery.status === "deferred") {
    return true;
  }
  return delivery.status === "leased"
    && typeof delivery.leaseExpiresAt === "number"
    && delivery.leaseExpiresAt <= now;
}

async function claimDeliveryDurably(input: {
  messageId: string;
  targetId: string;
  reasons?: DeliveryReason[];
  leaseOwner?: string;
  leaseMs?: number;
}): Promise<DeliveryIntent | null> {
  return runDurableWrite(async () => {
    const now = Date.now();
    const reasons = input.reasons?.length ? new Set(input.reasons) : null;
    const delivery = journal
      .listDeliveries({ limit: 5000 })
      .find((candidate) => (
        candidate.messageId === input.messageId
        && candidate.targetId === input.targetId
        && (!reasons || reasons.has(candidate.reason))
        && isDeliveryClaimable(candidate, now)
      ));

    if (!delivery) {
      return null;
    }

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
      status: "leased",
      leaseOwner,
      leaseExpiresAt,
      metadata: {
        ...(delivery.metadata ?? {}),
        ...metadata,
      },
    };
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

function isReconciledStaleFlightActivityItem(item: {
  kind: string;
  summary?: string | null;
}): boolean {
  return item.kind === "flight_updated"
    && typeof item.summary === "string"
    && item.summary.startsWith("Stale running flight reconciled:");
}

function isStaleLocalAgent(agent: AgentDefinition | undefined): boolean {
  return agent?.metadata?.staleLocalRegistration === true
    || agent?.metadata?.retiredFromFleet === true;
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
    sessionId: endpoint?.sessionId,
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

  if (agent.metadata?.staleLocalRegistration === true) {
    return {
      agentId: agent.id,
      displayName: agent.displayName ?? agent.id,
      reason: "stale_registration",
      detail: `${agent.displayName ?? agent.id} has a stale registration and needs operator follow-up before the broker can route to it again.`,
      wakePolicy: agent.wakePolicy,
      endpointState: endpoint?.state === "offline" ? "offline" : "unknown",
      transport: endpoint?.transport ?? null,
      projectRoot,
    };
  }

  if (agent.authorityNodeId && agent.authorityNodeId !== nodeId) {
    return null;
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
  const endpointInvocationId = endpointLastInvocationId(endpoint);
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
      helpers: { isStale: isStaleLocalAgent },
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
    if (!agent || isStaleLocalAgent(agent)) {
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
    helpers: { isStale: isStaleLocalAgent },
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
    const replacementAgentId = staleLocalAgentReplacementId(
      typeof agent?.definitionId === "string" ? agent.definitionId : null,
      activeAgentIdsByDefinition,
    );

    if (endpoint.state === "offline" && endpoint.metadata?.staleLocalRegistration === true && replacementAgentId && endpoint.metadata?.replacedByAgentId === replacementAgentId) {
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
    if (agent.authorityNodeId && agent.authorityNodeId !== nodeId) {
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

  const coreBindings = await loadRegisteredLocalAgentBindings(nodeId, {
    ensureOnline: true,
    agentIds: configuredCoreAgentIds,
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

function authorityNodeForConversation(conversationId: string): {
  conversation: ConversationDefinition;
  authorityNode: NodeDefinition;
} | null {
  const conversation = runtime.conversation(conversationId);
  if (!conversation || conversation.authorityNodeId === nodeId) {
    return null;
  }

  const authorityNode = runtime.node(conversation.authorityNodeId);
  if (!authorityNode?.brokerUrl) {
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
  const result = await forwardMeshMessage(authority.authorityNode.brokerUrl!, bundle);
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
  const result = await forwardMeshCollaborationRecord(authority.authorityNode.brokerUrl!, bundle);
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
  const result = await forwardMeshCollaborationEvent(authority.authorityNode.brokerUrl!, bundle);
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

  await brokerPostJson<{ ok: boolean }>(authority.authorityNode.brokerUrl!, "/v1/flights", flight);
}

async function postConversationMessage(
  message: MessageRecord,
): Promise<void> {
  const authority = authorityNodeForConversation(message.conversationId);
  if (authority) {
    await forwardConversationMessageToAuthority(message);
    return;
  }

  const { deliveries, entries } = await recordMessageDurably(message, {
    enqueueProjection: false,
  });
  await forwardPeerBrokerDeliveries(message, deliveries);
  await applyProjectedEntries(entries);
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
  return candidates.find((endpoint) => (
    endpoint.transport === "pairing_bridge"
      ? endpoint.state !== "offline"
      : isLocalAgentEndpointAlive(endpoint)
  ));
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

async function resolveLocalEndpointForInvocation(invocation: InvocationRequest): Promise<AgentEndpoint | undefined> {
  const requestedHarness = invocation.execution?.harness;
  const sessionPreference = invocation.execution?.session ?? "new";
  const existing = activeLocalEndpointForAgent(invocation.targetAgentId, requestedHarness);
  if (existing && sessionPreference !== "new") {
    return existing;
  }

  const staleEndpoints = runtime.endpointsForAgent(invocation.targetAgentId, {
    nodeId,
    harness: requestedHarness,
  }).filter((endpoint) => endpoint.id !== existing?.id);

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

  for (const endpoint of staleEndpoints) {
    if (!isManagedLocalSessionMetadata(endpoint.metadata)) {
      continue;
    }

    try {
      const sessionResult = await ensureLocalSessionEndpointOnline(endpoint);
      const revivedEndpoint: AgentEndpoint = {
        ...endpoint,
        state: "idle",
        metadata: {
          ...(endpoint.metadata ?? {}),
          lastResumedAt: Date.now(),
          ...(sessionResult.externalSessionId ? { externalSessionId: sessionResult.externalSessionId } : {}),
        },
      };
      await persistEndpoint(revivedEndpoint);
      return revivedEndpoint;
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

  const runningFlight = {
    ...initialFlight,
    state: "running" as const,
    summary: `${agent.displayName} is working.`,
    error: undefined,
    completedAt: undefined,
  };
  await persistFlight(runningFlight);

  try {
    const result = endpoint.transport === "pairing_bridge"
      ? await invokePairingSessionEndpoint(runningEndpoint, invocation)
      : await invokeLocalAgentEndpoint(runningEndpoint, invocation);

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
            returnAddress: buildScoutReturnAddress({
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
  const resolved = resolveInvocationTarget(payload);
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
  const threadEventsMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/conversations\/([^/]+)\/thread-events$/)
    : null;
  const threadSnapshotMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/conversations\/([^/]+)\/thread-snapshot$/)
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

  if (method === "GET" && url.pathname === "/v1/messages") {
    json(response, 200, await brokerService.readMessages?.({
      conversationId: url.searchParams.get("conversationId")?.trim() || undefined,
      since: parseSince(url),
      limit: parseLimit(url),
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

function resolveBrokerDeliveryTarget(
  input: BrokerRouteTargetInput,
): InvocationResolution {
  return resolveBrokerRouteTarget(runtime.snapshot(), input, {
    preferLocalNodeId: nodeId,
    helpers: { isStale: isStaleLocalAgent },
  });
}

function resolveInvocationTarget(
  payload: InvocationRequest & BrokerRouteTargetInput,
): InvocationResolution {
  return resolveBrokerDeliveryTarget({
    target: payload.target,
    targetAgentId: payload.targetAgentId,
    targetLabel: payload.targetLabel,
    routePolicy: payload.routePolicy,
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
    targetLabel: input.targetLabel,
    ...(input.bindingRef ? { bindingRef: input.bindingRef } : {}),
    conversationId: input.conversationId,
    messageId: input.messageId,
    ...(input.flightId ? { flightId: input.flightId } : {}),
    acceptedAt: Date.now(),
  };
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
  const deliveryChannel = routeChannelForTarget(payload) ?? payload.channel?.trim();
  const typedChannelTarget = payload.target?.kind === "channel" || payload.target?.kind === "broadcast";
  const hasAgentTarget = Boolean(
    payload.target?.kind === "agent_id"
      || payload.target?.kind === "agent_label",
  ) || (!payload.target && Boolean(payload.targetAgentId?.trim() || payload.targetLabel?.trim()));

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
        relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
        relayTarget: SCOUT_DISPATCHER_AGENT_ID,
        relayTargetIds: [SCOUT_DISPATCHER_AGENT_ID],
        relayMessageId: messageId,
        returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
          conversationId: conversation.id,
          replyToMessageId: messageId,
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
        relayChannel: deliveryChannel,
        relayMessageId: messageId,
        returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
          conversationId: conversation.id,
          replyToMessageId: messageId,
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

  const resolved = resolveBrokerDeliveryTarget(payload);

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
      relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
      relayTarget: resolved.agent.id,
      relayTargetIds: [resolved.agent.id],
      relayMessageId: messageId,
      returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
        conversationId: conversation.id,
        replyToMessageId: messageId,
      }),
    },
  };
  await postConversationMessage(message);

  if (payload.intent !== "consult") {
    const receipt = buildDeliveryReceipt({
      requestId,
      routeKind,
      requesterId,
      requesterNodeId,
      targetAgentId: resolved.agent.id,
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
    };
  }

  const invocation: InvocationRequest = {
    id: createRuntimeId("inv"),
    requesterId,
    requesterNodeId,
    targetAgentId: resolved.agent.id,
    action: "consult",
    task: payload.body.trim(),
    ...(payload.collaborationRecordId ? { collaborationRecordId: payload.collaborationRecordId } : {}),
    conversationId: conversation.id,
    messageId,
    execution: payload.execution,
    ensureAwake: payload.ensureAwake ?? true,
    stream: false,
    createdAt,
    metadata: {
      ...(payload.invocationMetadata ?? {}),
      relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
      relayTarget: resolved.agent.id,
      ...(payload.collaborationRecordId ? { collaborationRecordId: payload.collaborationRecordId } : {}),
      returnAddress: buildBrokerReturnAddressForActor(snapshot, requesterId, {
        conversationId: conversation.id,
        replyToMessageId: messageId,
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
      targetLabel,
      bindingRef,
      conversationId: conversation.id,
      messageId,
      flightId: flight.id,
    }),
    conversation,
    message,
    targetAgentId: resolved.agent.id,
    bindingRef,
    flight,
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
// Mounted at /trpc. Today: tail.events. Future endpoints (agent activity,
// control events) get added to broker-trpc-router.ts and consumers pick up
// the new procedures via end-to-end type inference.
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

let shuttingDown = false;

async function shutdownBroker(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
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
