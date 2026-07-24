import type { RuntimeHttpRequestLike, RuntimeHttpResponseLike } from "./portable-types.js";
import { performance } from "node:perf_hooks";

import type {
  A2AJsonRpcRequest,
  AgentEndpoint,
  CollaborationRecord,
  ControlCommand,
  ConversationReadCursor,
  DeliveryIntent,
  DurableAction,
  FlightRecord,
  InboxAckRequest,
  InboxClaimRequest,
  InboxNackRequest,
  InvocationRequest,
  MessageRecord,
  ScoutRendezvousRequest,
  ScoutDeliverRequest,
  ScoutDispatchRecord,
  NodeDefinition,
  RouteAliasListRequest,
  RouteAliasMutationRequest,
  RouteAliasResolveRequest,
  RouteAliasSetRequest,
} from "@openscout/protocol";

import type { ActiveScoutBrokerService } from "./broker-api.js";
import { a2aJsonRpcError, type BrokerA2AService } from "./broker-a2a-service.js";
import {
  brokerDeliverRequestSchema,
  brokerInvocationRequestSchema,
} from "./broker-command-boundary-schemas.js";
import {
  parseInboxReasons,
  parseInboxStatuses,
  type BrokerControlStreamService,
} from "./broker-control-stream-service.js";
import type { BrokerDeliveryAcceptanceService } from "./broker-delivery-acceptance-service.js";
import {
  brokerAppendMissionLog,
  brokerAssignRole,
  brokerListMissionLog,
  brokerListRoleAssignments,
  brokerRevokeRole,
  brokerRolesCatalog,
  parseRoleScope,
} from "./broker-roles-http.js";
import type { ControlPlaneSqliteDatabase } from "./sqlite-adapter.js";
import type {
  BrokerDeliveryHttpService,
  DeliveryAttemptBody,
  DeliveryClaimBody,
  DeliveryStatusBody,
} from "./broker-delivery-http-service.js";
import type {
  BrokerDurableActionHttpService,
  DurableActionHeartbeatBody,
} from "./broker-durable-action-http-service.js";
import {
  a2aJson,
  badRequest,
  json,
  jsonWithHeaders,
  notFound,
  parseBooleanQueryParam,
  parseLimit,
  parseSince,
  readValidatedRequestBody,
  readRequestBody,
  requestAbortSignal,
  serverTimingHeader,
  threadWatchError,
  throwIfAborted,
} from "./broker-http-helpers.js";
import { handleBrokerHttpEntityWriteRoute } from "./broker-http-entity-write-routes.js";
import type { BrokerManagedSessionHttpService } from "./broker-managed-session-http-service.js";
import type {
  ManagedLocalSessionAttachBody,
  ManagedLocalSessionDetachBody,
  ManagedLocalSessionEnsureBody,
  ManagedPairingAttachBody,
  ManagedPairingDetachBody,
} from "./broker-managed-session-http-service.js";
import type { BrokerMeshDiscoveryService } from "./broker-mesh-discovery-service.js";
import type { BrokerMeshHttpService } from "./broker-mesh-http-service.js";
import type { BrokerRepoTailService } from "./broker-repo-tail-service.js";
import type { BrokerRendezvousService } from "./broker-rendezvous-service.js";
import type { BrokerWebControlService } from "./broker-web-control-service.js";
import { buildCollaborationInvocation } from "./collaboration-invocations.js";
import type { DiscoverySnapshot, TailDiscoveryOptions, TailDiscoveryScope } from "./tail/types.js";
import type {
  MeshCollaborationEventBundle,
  MeshCollaborationRecordBundle,
  MeshInvocationBundle,
  MeshMessageBundle,
} from "./mesh-forwarding.js";
import {
  upsertScoutAgentCardFromInput,
  type ExternalAgentCardInput,
} from "./scout-agent-cards.js";
import type { RuntimeRegistrySnapshot } from "./registry.js";
import type { BrokerRouteTargetInput } from "./scout-dispatcher.js";
import type { ThreadEventPlane } from "./thread-events.js";
import {
  BrokerRouteAliasError,
  type BrokerRouteAliasService,
} from "./broker-route-alias-service.js";

export type BrokerHttpRuntime = {
  snapshot: () => { nodes: Record<string, NodeDefinition> };
  recentEvents: (limit: number) => unknown;
  collaborationRecord: (recordId: string) => CollaborationRecord | undefined;
  flightForInvocation: (invocationId: string) => FlightRecord | undefined;
  upsertAgentIdentity: (agent: {
    id: string;
    displayName: string;
    handle: string;
    selector?: string;
    labels?: string[];
    authorityNodeId: string;
    metadata?: Record<string, unknown>;
  }) => void;
  upsertEndpoint: (endpoint: AgentEndpoint) => void;
};

export type BrokerHttpJournal = {
  listDeliveries: (options: { limit: number }) => DeliveryIntent[];
  listScoutDispatches: (options: { limit: number }) => ScoutDispatchRecord[];
};

export type BrokerHttpRouterDeps = {
  host: string;
  port: number;
  nodeId: string;
  meshId: string;
  operatorActorId: string;
  runtime: BrokerHttpRuntime;
  journal: BrokerHttpJournal;
  knownInvocations: Map<string, InvocationRequest>;
  brokerService: ActiveScoutBrokerService;
  webControl: BrokerWebControlService;
  readHostInfo?: () => unknown | Promise<unknown>;
  a2aService: BrokerA2AService;
  brokerRepoTailService: BrokerRepoTailService<RuntimeRegistrySnapshot>;
  getHarnessTopologySnapshot: (force: boolean) => unknown | Promise<unknown>;
  getTailDiscovery: (options?: boolean | TailDiscoveryOptions) => DiscoverySnapshot | Promise<DiscoverySnapshot>;
  nudgeHarnessTopologyScan: () => unknown | Promise<unknown>;
  deliveryHttpService: BrokerDeliveryHttpService;
  durableActionHttpService: BrokerDurableActionHttpService;
  controlStreams: BrokerControlStreamService;
  managedSessionHttpService: BrokerManagedSessionHttpService;
  meshDiscoveryService: BrokerMeshDiscoveryService;
  meshHttpService: BrokerMeshHttpService;
  threadEvents: ThreadEventPlane;
  handleCommand: (command: ControlCommand) => Promise<unknown>;
  handleInvocationRequest: (payload: InvocationRequest & BrokerRouteTargetInput) => Promise<unknown>;
  deleteEndpoint: (endpointId: string) => Promise<void>;
  recordFlight: (flight: FlightRecord) => Promise<void>;
  listReadCursorsForConversation: (conversationId: string) => ConversationReadCursor[];
  resolveReadCursor: (
    conversationId: string,
    body: {
      actorId?: string;
      readerNodeId?: string;
      lastReadMessageId?: string;
      lastReadSeq?: number;
      lastReadAt?: number;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<ConversationReadCursor>;
  recordReadCursor: (cursor: ConversationReadCursor) => Promise<void>;
  acknowledgeDeliveriesForReadCursor: (cursor: ConversationReadCursor) => Promise<unknown>;
  deliveryAcceptanceService: BrokerDeliveryAcceptanceService;
  rendezvousService: BrokerRendezvousService;
  routeAliasService?: BrokerRouteAliasService;
  forwardRouteAliasRequest?: (input: {
    nodeSelector: string;
    path: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
  }) => Promise<{ status: number; body: unknown } | null>;
  /**
   * Control-plane SQLite for assigned roles / mission log. When null/undefined,
   * role routes return 503 (tables owned by migrations; broker is writer).
   */
  openRolesDb?: () => ControlPlaneSqliteDatabase | null;
};

const tailDiscoveryScopes = new Set<TailDiscoveryScope>(["hot", "shallow", "deep"]);

function parseTailDiscoveryScope(value: string | null): TailDiscoveryScope | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return tailDiscoveryScopes.has(normalized as TailDiscoveryScope)
    ? (normalized as TailDiscoveryScope)
    : undefined;
}

function parseTailDiscoveryLimit(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1_000) : undefined;
}

function tailDiscoveryProcessKey(source: string, cwd: string | null | undefined): string | null {
  const cleanCwd = cwd?.trim();
  return cleanCwd ? `${source}\u0000${cleanCwd}` : null;
}

function trimTailDiscoverySnapshot(
  snapshot: DiscoverySnapshot,
  limit: number | undefined,
): DiscoverySnapshot {
  if (!limit || limit <= 0) return snapshot;
  const transcripts = snapshot.transcripts.slice(0, limit);
  const transcriptProcessKeys = new Set(
    transcripts
      .map((transcript) => tailDiscoveryProcessKey(transcript.source, transcript.cwd))
      .filter((key): key is string => Boolean(key)),
  );
  const processIds = new Set<string>();
  const processes: DiscoverySnapshot["processes"] = [];
  for (const process of snapshot.processes) {
    const key = tailDiscoveryProcessKey(process.source, process.cwd);
    if (!key || !transcriptProcessKeys.has(key)) continue;
    const processId = `${process.source}\u0000${process.pid}`;
    if (processIds.has(processId)) continue;
    processIds.add(processId);
    processes.push(process);
    if (processes.length >= limit) break;
  }
  for (const process of snapshot.processes) {
    if (processes.length >= limit) break;
    const processId = `${process.source}\u0000${process.pid}`;
    if (processIds.has(processId)) continue;
    processIds.add(processId);
    processes.push(process);
  }
  return {
    ...snapshot,
    processes,
    transcripts,
  };
}

export function createBrokerHttpRouter(
  deps: BrokerHttpRouterDeps,
): (request: RuntimeHttpRequestLike, response: RuntimeHttpResponseLike) => Promise<void> {
  const {
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
    readHostInfo,
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
    deleteEndpoint,
    recordFlight,
    listReadCursorsForConversation,
    resolveReadCursor,
    recordReadCursor,
    acknowledgeDeliveriesForReadCursor,
    deliveryAcceptanceService,
    rendezvousService,
    routeAliasService,
    forwardRouteAliasRequest,
  } = deps;

  return async function routeRequest(request: RuntimeHttpRequestLike, response: RuntimeHttpResponseLike): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  const forwardedNodeHeader = request.headers["x-openscout-forwarded-node-id"];
  const forwardedNodeId = Array.isArray(forwardedNodeHeader) ? forwardedNodeHeader[0] : forwardedNodeHeader;
  if (forwardedNodeId) {
    const forwardedMeshHeader = request.headers["x-openscout-mesh-id"];
    const forwardedMeshId = Array.isArray(forwardedMeshHeader) ? forwardedMeshHeader[0] : forwardedMeshHeader;
    const origin = runtime.snapshot().nodes[forwardedNodeId];
    if (forwardedMeshId !== meshId || !origin || origin.meshId !== meshId) {
      json(response, 403, { error: "not_authorized", detail: "forwarded broker request failed owner-realm authentication" });
      return;
    }
  }
  const aliasItemMatch = method === "PATCH" || method === "DELETE"
    ? url.pathname.match(/^\/v1\/aliases\/([^/]+)$/)
    : null;
  const aliasHistoryMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/aliases\/([^/]+)\/history$/)
    : null;

  const handleAliasError = (error: unknown): void => {
    if (error instanceof BrokerRouteAliasError) {
      json(response, error.code === "not_authorized" ? 403 : error.code === "unknown_alias" ? 404 : error.code === "revision_conflict" ? 409 : 400, {
        error: error.code,
        detail: error.message,
        ...(error.details ?? {}),
      });
      return;
    }
    badRequest(response, error);
  };

  const forwardAliasIfRemote = async (
    nodeSelector: string | undefined,
    path: string,
    aliasMethod: "GET" | "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<boolean> => {
    if (!nodeSelector?.trim() || !forwardRouteAliasRequest) return false;
    const forwarded = await forwardRouteAliasRequest({
      nodeSelector: nodeSelector.trim(),
      path,
      method: aliasMethod,
      body,
    });
    if (!forwarded) return false;
    json(response, forwarded.status, forwarded.body);
    return true;
  };

  if (url.pathname.startsWith("/v1/aliases") && !routeAliasService) {
    json(response, 503, { error: "aliases_unavailable", detail: "route aliases require broker SQLite persistence" });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/aliases") {
    try {
      const body = await readRequestBody<RouteAliasSetRequest>(request);
      if (await forwardAliasIfRemote(body.scope?.nodeId, url.pathname, "POST", body)) return;
      json(response, 201, { binding: routeAliasService!.set(body) });
    } catch (error) {
      handleAliasError(error);
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/aliases") {
    try {
      const query: RouteAliasListRequest = {
        scope: {
          projectKey: url.searchParams.get("projectKey") ?? undefined,
          projectRoot: url.searchParams.get("projectRoot") ?? undefined,
          nodeId: url.searchParams.get("nodeId") ?? undefined,
        },
        targetAgentId: url.searchParams.get("targetAgentId") ?? undefined,
        targetSessionId: url.searchParams.get("targetSessionId") ?? undefined,
        includeInactive: parseBooleanQueryParam(url.searchParams.get("includeInactive")) ?? false,
        limit: Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 1_000)),
        caller: {
          actorId: url.searchParams.get("actorId") ?? operatorActorId,
          currentDirectory: url.searchParams.get("currentDirectory") ?? undefined,
          nodeId,
        },
      };
      if (await forwardAliasIfRemote(query.scope?.nodeId, `${url.pathname}${url.search}`, "GET")) return;
      json(response, 200, { bindings: routeAliasService!.list(query) });
    } catch (error) {
      handleAliasError(error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/aliases/resolve") {
    try {
      const body = await readRequestBody<RouteAliasResolveRequest>(request);
      if (await forwardAliasIfRemote(body.scope?.nodeId, url.pathname, "POST", body)) return;
      json(response, 200, routeAliasService!.resolve(body));
    } catch (error) {
      handleAliasError(error);
    }
    return;
  }

  if (method === "GET" && aliasHistoryMatch) {
    try {
      if (await forwardAliasIfRemote(url.searchParams.get("nodeId") ?? undefined, `${url.pathname}${url.search}`, "GET")) return;
      json(response, 200, { history: routeAliasService!.history(decodeURIComponent(aliasHistoryMatch[1]!)) });
    } catch (error) {
      handleAliasError(error);
    }
    return;
  }

  if (method === "PATCH" && aliasItemMatch) {
    try {
      const body = await readRequestBody<RouteAliasMutationRequest>(request);
      if (await forwardAliasIfRemote(body.scope?.nodeId, url.pathname, "PATCH", body)) return;
      json(response, 200, { binding: routeAliasService!.repoint(decodeURIComponent(aliasItemMatch[1]!), body) });
    } catch (error) {
      handleAliasError(error);
    }
    return;
  }

  if (method === "DELETE" && aliasItemMatch) {
    try {
      const body: RouteAliasMutationRequest = await readRequestBody<RouteAliasMutationRequest>(request).catch(() => ({}));
      if (await forwardAliasIfRemote(body.scope?.nodeId, url.pathname, "DELETE", body)) return;
      json(response, 200, { binding: routeAliasService!.unset(decodeURIComponent(aliasItemMatch[1]!), body) });
    } catch (error) {
      handleAliasError(error);
    }
    return;
  }
  const collaborationInvokeMatch = method === "POST"
    ? url.pathname.match(/^\/v1\/collaboration\/records\/([^/]+)\/invoke$/)
    : null;
  const durableActionHeartbeatMatch = method === "POST"
    ? url.pathname.match(/^\/v1\/durable-actions\/([^/]+)\/heartbeat$/)
    : null;
  const a2aAgentCardMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/a2a\/agents\/([^/]+)\/agent-card\.json$/)
    : null;
  const a2aAgentRpcMatch = method === "POST"
    ? url.pathname.match(/^\/v1\/a2a\/agents\/([^/]+)\/rpc$/)
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
  if ((url.pathname === "/v1/web/status" || url.pathname === "/v1/web/start" || url.pathname === "/v1/web/restart") && method === "OPTIONS") {
    response.writeHead(204, webControl.corsHeaders(request));
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    json(response, 200, await brokerService.readHealth());
    return;
  }

  if (method === "GET" && url.pathname === "/.host-info") {
    json(response, 200, readHostInfo ? await readHostInfo() : {
      schemaVersion: 1,
      source: "openscout-broker",
      updatedAtMs: Date.now(),
      nodeId,
      meshId,
      brokerUrl: `http://${host}:${port}`,
      ports: { broker: port },
    });
    return;
  }

  if (
    method === "GET"
    && (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/v1/a2a/agent-card.json" || a2aAgentCardMatch)
  ) {
    const pathAgentId = a2aAgentCardMatch
      ? decodeURIComponent(a2aAgentCardMatch[1] ?? "")
      : url.searchParams.get("agentId")?.trim() || undefined;
    const card = await a2aService.agentCardForRequest(url.origin, pathAgentId);
    if (!card) {
      a2aJson(response, 404, {
        error: "not_found",
        detail: `A2A agent card not found: ${pathAgentId ?? "openscout"}`,
      });
      return;
    }
    a2aJson(response, 200, card);
    return;
  }

  if (method === "POST" && (url.pathname === "/a2a" || url.pathname === "/v1/a2a/rpc" || a2aAgentRpcMatch)) {
    try {
      const body = await readRequestBody<A2AJsonRpcRequest>(request);
      const pathAgentId = a2aAgentRpcMatch ? decodeURIComponent(a2aAgentRpcMatch[1] ?? "") : undefined;
      const result = await a2aService.handleJsonRpc(body, url.origin, pathAgentId);
      a2aJson(response, result.error ? 200 : 200, result);
    } catch (error) {
      a2aJson(response, 200, a2aJsonRpcError(
        null,
        -32700,
        `A2A JSON-RPC parse error: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/web/status") {
    jsonWithHeaders(response, 200, await webControl.status(), webControl.corsHeaders(request));
    return;
  }

  if (method === "POST" && url.pathname === "/v1/web/start") {
    try {
      jsonWithHeaders(
        response,
        200,
        await webControl.startIfNeeded(webControl.startContextFromRequest(request)),
        webControl.corsHeaders(request),
      );
    } catch (error) {
      jsonWithHeaders(
        response,
        500,
        webControl.failureStatus(error),
        webControl.corsHeaders(request),
      );
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/web/restart") {
    try {
      jsonWithHeaders(
        response,
        200,
        await webControl.restartIfManaged(webControl.startContextFromRequest(request)),
        webControl.corsHeaders(request),
      );
    } catch (error) {
      jsonWithHeaders(
        response,
        500,
        webControl.failureStatus(error),
        webControl.corsHeaders(request),
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

  if (method === "GET" && url.pathname === "/v1/capabilities/availability") {
    if (!brokerService.readCapabilityAvailability) {
      notFound(response);
      return;
    }
    const capabilityId = url.searchParams.get("capabilityId")?.trim();
    if (!capabilityId) {
      badRequest(response, "missing capabilityId");
      return;
    }
    json(response, 200, await brokerService.readCapabilityAvailability({
      capabilityId,
      methodName: url.searchParams.get("methodName")?.trim() || undefined,
      requireReady: parseBooleanQueryParam(url.searchParams.get("requireReady")),
      force: parseBooleanQueryParam(url.searchParams.get("force")),
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/capabilities") {
    if (!brokerService.readCapabilities) {
      notFound(response);
      return;
    }
    json(response, 200, await brokerService.readCapabilities({
      force: parseBooleanQueryParam(url.searchParams.get("force")),
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/topology/snapshot") {
    json(response, 200, await getHarnessTopologySnapshot(url.searchParams.get("force") === "1"));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/tail/discover") {
    const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
    const scope = parseTailDiscoveryScope(url.searchParams.get("scope"));
    const limit = parseTailDiscoveryLimit(url.searchParams.get("limit"));
    const start = performance.now();
    const discoveryOptions: TailDiscoveryOptions = {
      force,
      ...(scope ? { scope } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
    const timingDesc = [scope, limit ? `limit-${limit}` : null].filter(Boolean).join("-");
    const payload = trimTailDiscoverySnapshot(
      await getTailDiscovery(discoveryOptions),
      limit,
    );
    jsonWithHeaders(response, 200, payload, {
      "Server-Timing": serverTimingHeader([{
        name: force ? "tail-discover-force" : "tail-discover",
        dur: performance.now() - start,
        ...(timingDesc ? { desc: timingDesc } : {}),
      }]),
    });
    return;
  }

  if ((method === "GET" || method === "POST") && url.pathname === "/v1/repo-watch/warm") {
    void brokerRepoTailService.warmRepoWatchSnapshot("http-nudge");
    json(response, 202, { ok: true, status: "queued" });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/repo-watch/snapshot") {
    json(response, 200, await brokerRepoTailService.readRepoWatchSnapshotForUrl(url));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/tail/recent") {
    const result = await brokerRepoTailService.readTailRecentPayloadWithTiming(url);
    jsonWithHeaders(response, 200, result.payload, {
      "Server-Timing": serverTimingHeader(result.timings),
    });
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
      await recordReadCursor(cursor);
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

  // ── Assigned roles + mission log (broker-canonical writer) ──
  if (method === "GET" && url.pathname === "/v1/roles/catalog") {
    json(response, 200, brokerRolesCatalog());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/roles/assignments") {
    try {
      const db = deps.openRolesDb?.() ?? null;
      if (!db) {
        json(response, 503, { error: "roles_unavailable", detail: "control-plane roles store not open" });
        return;
      }
      json(response, 200, brokerListRoleAssignments(db, {
        agentId: url.searchParams.get("agentId") ?? undefined,
        missionId: url.searchParams.get("missionId") ?? undefined,
        roleId: url.searchParams.get("roleId") ?? undefined,
        activeOnly: url.searchParams.get("activeOnly") !== "0"
          && url.searchParams.get("activeOnly") !== "false",
        includeStanding: url.searchParams.get("includeStanding") !== "0",
        limit: parseLimit(url),
      }));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/roles/assignments") {
    try {
      const db = deps.openRolesDb?.() ?? null;
      if (!db) {
        json(response, 503, { error: "roles_unavailable", detail: "control-plane roles store not open" });
        return;
      }
      const body = await readRequestBody<{
        roleId?: string;
        agentId?: string;
        scope?: { kind?: string; missionId?: string; projectRoot?: string };
        assignedById?: string;
        enforceSingleOrchestrator?: boolean;
        metadata?: Record<string, unknown>;
      }>(request);
      if (!body.roleId?.trim() || !body.agentId?.trim()) {
        throw new Error("roleId and agentId are required");
      }
      const scope = parseRoleScope(body.scope ?? { kind: "agent" });
      json(response, 201, brokerAssignRole(db, {
        roleId: body.roleId.trim(),
        agentId: body.agentId.trim(),
        scope,
        assignedById: body.assignedById?.trim() || operatorActorId,
        enforceSingleOrchestrator: body.enforceSingleOrchestrator,
        metadata: body.metadata,
      }));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  const roleRevokeMatch = method === "POST"
    ? url.pathname.match(/^\/v1\/roles\/assignments\/([^/]+)\/revoke$/)
    : null;
  if (roleRevokeMatch) {
    try {
      const db = deps.openRolesDb?.() ?? null;
      if (!db) {
        json(response, 503, { error: "roles_unavailable", detail: "control-plane roles store not open" });
        return;
      }
      const assignmentId = decodeURIComponent(roleRevokeMatch[1] ?? "");
      const body = await readRequestBody<{ revokedById?: string }>(request).catch(() => ({} as { revokedById?: string }));
      json(response, 200, brokerRevokeRole(db, {
        assignmentId,
        revokedById: body.revokedById?.trim() || operatorActorId,
      }));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  const missionLogGetMatch = method === "GET"
    ? url.pathname.match(/^\/v1\/missions\/([^/]+)\/log$/)
    : null;
  if (missionLogGetMatch) {
    try {
      const db = deps.openRolesDb?.() ?? null;
      if (!db) {
        json(response, 503, { error: "roles_unavailable", detail: "control-plane roles store not open" });
        return;
      }
      const missionId = decodeURIComponent(missionLogGetMatch[1] ?? "");
      const afterSeqRaw = url.searchParams.get("afterSeq");
      const afterSeq = afterSeqRaw ? Number.parseInt(afterSeqRaw, 10) : undefined;
      json(response, 200, brokerListMissionLog(db, {
        missionId,
        limit: parseLimit(url),
        afterSeq: Number.isFinite(afterSeq) ? afterSeq : undefined,
      }));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  const missionLogPostMatch = method === "POST"
    ? url.pathname.match(/^\/v1\/missions\/([^/]+)\/log$/)
    : null;
  if (missionLogPostMatch) {
    try {
      const db = deps.openRolesDb?.() ?? null;
      if (!db) {
        json(response, 503, { error: "roles_unavailable", detail: "control-plane roles store not open" });
        return;
      }
      const missionId = decodeURIComponent(missionLogPostMatch[1] ?? "");
      const body = await readRequestBody<{
        actorId?: string;
        kind?: string;
        intent?: string;
        status?: string;
        checkpoint?: string;
        nodeId?: string;
        note?: string;
        blockers?: Array<{ label: string; ownerId?: string }>;
        refs?: Record<string, string>;
        projectRoot?: string;
      }>(request);
      // Intentionally ignore any client bypassPermission field.
      if (!body.actorId?.trim() || !body.kind || !body.intent?.trim() || !body.status?.trim()) {
        throw new Error("actorId, kind, intent, and status are required");
      }
      json(response, 201, brokerAppendMissionLog(db, {
        missionId,
        actorId: body.actorId.trim(),
        kind: body.kind as import("@openscout/protocol").ScoutMissionLogKind,
        intent: body.intent,
        status: body.status,
        checkpoint: body.checkpoint,
        nodeId: body.nodeId,
        note: body.note,
        blockers: body.blockers,
        refs: body.refs,
      }, { projectRoot: body.projectRoot }));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/inbox") {
    try {
      json(response, 200, await deliveryHttpService.readInboxItems({
        targetId: url.searchParams.get("targetId"),
        statuses: parseInboxStatuses(url),
        reasons: parseInboxReasons(url),
        limit: parseLimit(url),
      }));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/inbox/stream") {
    try {
      const snapshot = await deliveryHttpService.readInboxSnapshot({
        targetId: url.searchParams.get("targetId"),
        statuses: parseInboxStatuses(url),
        reasons: parseInboxReasons(url),
        limit: parseLimit(url),
      });
      controlStreams.addInboxStream({
        request,
        response,
        targetId: snapshot.targetId,
        snapshot,
      });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/inbox/claim") {
    try {
      const body = await readRequestBody<InboxClaimRequest>(request);
      json(response, 200, await deliveryHttpService.claimInboxItem(body));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/inbox/ack") {
    try {
      const body = await readRequestBody<InboxAckRequest>(request);
      const result = await deliveryHttpService.acknowledgeInboxItem(body);
      json(response, result.status, result.body);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/inbox/nack") {
    try {
      const body = await readRequestBody<InboxNackRequest>(request);
      const result = await deliveryHttpService.nackInboxItem(body);
      json(response, result.status, result.body);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/deliveries") {
    json(response, 200, deliveryHttpService.listDeliveries({
      limit: parseLimit(url),
      transport: (url.searchParams.get("transport") as DeliveryIntent["transport"] | null) ?? undefined,
      status: (url.searchParams.get("status") as DeliveryIntent["status"] | null) ?? undefined,
      targetId: url.searchParams.get("targetId"),
      messageId: url.searchParams.get("messageId"),
      reason: url.searchParams.get("reason"),
    }));
    return;
  }

  if (method === "POST" && url.pathname === "/v1/deliveries/claim") {
    try {
      const body = await readRequestBody<DeliveryClaimBody>(request);
      json(response, 200, await deliveryHttpService.claimDelivery(body));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "GET" && url.pathname === "/v1/delivery-attempts") {
    try {
      json(response, 200, deliveryHttpService.listDeliveryAttempts(url.searchParams.get("deliveryId")));
    } catch (error) {
      badRequest(response, error);
    }
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
      json(response, 200, await managedSessionHttpService.listPairingSessionCandidates());
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
    const flight = runtime.flightForInvocation(invocationId);
    const deliveries = journal
      .listDeliveries({ limit: 500 })
      .filter((delivery) => delivery.invocationId === invocationId);
    const dispatches = journal
      .listScoutDispatches({ limit: 50 })
      .filter((record) => record.invocationId === invocationId);
    const invocation = knownInvocations.get(invocationId);
    controlStreams.addInvocationStream({
      request,
      response,
      invocationId,
      snapshot: {
        invocationId,
        invocation: invocation ?? null,
        flight: flight ?? null,
        deliveries,
        dispatches,
      },
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/events/stream") {
    controlStreams.addEventStream({
      request,
      response,
      hello: { nodeId, meshId },
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

  if (await handleBrokerHttpEntityWriteRoute({
    method,
    url,
    request,
    response,
    deps: {
      brokerService,
      recordFlight,
    },
  })) {
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/discover") {
    try {
      const body = await readRequestBody<{ seeds?: string[] }>(request);
      const result = await meshDiscoveryService.discoverPeers(body.seeds ?? []);
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
      const result = await meshHttpService.receiveMessageBundle(bundle);
      json(response, result.status, result.body);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/invocations") {
    try {
      const bundle = await readRequestBody<MeshInvocationBundle>(request);
      const result = await meshHttpService.receiveInvocationBundle(bundle);
      json(response, result.status, result.body);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/collaboration/records") {
    try {
      const bundle = await readRequestBody<MeshCollaborationRecordBundle>(request);
      const result = await meshHttpService.receiveCollaborationRecordBundle(bundle);
      json(response, result.status, result.body);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/mesh/collaboration/events") {
    try {
      const bundle = await readRequestBody<MeshCollaborationEventBundle>(request);
      const result = await meshHttpService.receiveCollaborationEventBundle(bundle);
      json(response, result.status, result.body);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pairing/attach") {
    try {
      const input = await readRequestBody<ManagedPairingAttachBody>(request);
      json(response, 200, await managedSessionHttpService.attachPairingSession(input));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pairing/detach") {
    try {
      const input = await readRequestBody<ManagedPairingDetachBody>(request);
      json(response, 200, await managedSessionHttpService.detachPairingSession(input));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/local-sessions/attach") {
    try {
      const input = await readRequestBody<ManagedLocalSessionAttachBody>(request);
      json(response, 200, await managedSessionHttpService.attachLocalSession(input));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/local-sessions/ensure") {
    try {
      const input = await readRequestBody<ManagedLocalSessionEnsureBody>(request);
      json(response, 200, await managedSessionHttpService.ensureLocalSession(input));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/local-sessions/detach") {
    try {
      const input = await readRequestBody<ManagedLocalSessionDetachBody>(request);
      json(response, 200, await managedSessionHttpService.detachLocalSession(input));
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
      const attempt = await readRequestBody<DeliveryAttemptBody>(request);
      json(response, 200, await deliveryHttpService.recordDeliveryAttempt(attempt));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/durable-actions") {
    try {
      const action = await readRequestBody<DurableAction>(request);
      json(response, 200, await durableActionHttpService.recordAction(action));
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (durableActionHeartbeatMatch) {
    try {
      const actionId = decodeURIComponent(durableActionHeartbeatMatch[1] ?? "");
      const body = await readRequestBody<DurableActionHeartbeatBody>(request);
      const result = await durableActionHttpService.heartbeat(actionId, body);
      json(response, result.status, result.body);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/deliveries/status") {
    try {
      const body = await readRequestBody<DeliveryStatusBody>(request);
      json(response, 200, await deliveryHttpService.updateDeliveryStatus(body));
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

  if (method === "POST" && url.pathname === "/v1/rendezvous/match") {
    try {
      const payload = await readRequestBody<ScoutRendezvousRequest>(request);
      const result = await rendezvousService.match(payload);
      json(response, result.status === "topic_busy" ? 409 : 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/deliver") {
    const signal = requestAbortSignal(request, response);
    try {
      const payload = await readValidatedRequestBody(request, brokerDeliverRequestSchema);
      if (
        payload.target?.kind === "route_alias"
        && await forwardAliasIfRemote(payload.target.scope?.nodeId, url.pathname, "POST", payload)
      ) return;
      const result = brokerService.deliver
        ? await brokerService.deliver(payload, { signal })
        : await deliveryAcceptanceService.accept(payload, { signal });
      throwIfAborted(signal);
      json(
        response,
        result.kind === "delivery" ? 202 : result.kind === "question" ? 409 : 422,
        result,
      );
    } catch (error) {
      if (signal.aborted || response.destroyed || response.writableEnded) {
        return;
      }
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/invocations") {
    try {
      const payload = await readValidatedRequestBody(request, brokerInvocationRequestSchema);
      if (
        payload.target?.kind === "route_alias"
        && await forwardAliasIfRemote(payload.target.scope?.nodeId, url.pathname, "POST", payload)
      ) return;
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
  if (method === "DELETE" && url.pathname.startsWith("/v1/endpoints/")) {
    const id = decodeURIComponent(url.pathname.slice("/v1/endpoints/".length));
    await deleteEndpoint(id);
    json(response, 200, { ok: true });
    return;
  }

  // ─── External agent cards (SCO-016) ────────────────────────────────────────
  if (method === "GET" && url.pathname === "/v1/agent-cards") {
    json(response, 200, { cards: await a2aService.listScoutAgentCards() });
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
};
}
