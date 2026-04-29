import { request as httpRequest } from "node:http";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  CollaborationEvent,
  CollaborationRecord,
  ControlCommand,
  ConversationBinding,
  ConversationDefinition,
  InvocationRequest,
  MessageRecord,
  NodeDefinition,
  ScoutDeliverRequest,
  ScoutDeliverResponse,
  ThreadEventEnvelope,
  ThreadSnapshot,
  ThreadWatchCloseRequest,
  ThreadWatchOpenRequest,
  ThreadWatchOpenResponse,
  ThreadWatchRenewRequest,
  ThreadWatchRenewResponse,
} from "@openscout/protocol";

import type { RuntimeRegistrySnapshot } from "./registry.js";
import type { BrokerRouteTargetInput } from "./scout-dispatcher.js";

export type ScoutBrokerHealthPayload = {
  ok: boolean;
  nodeId: string | null;
  meshId: string | null;
  counts: {
    nodes: number;
    actors: number;
    agents: number;
    conversations: number;
    messages: number;
    flights: number;
    collaborationRecords: number;
  } | null;
};

export type ScoutBrokerMessageQuery = {
  conversationId?: string;
  since?: number | null;
  limit?: number;
};

export type ScoutBrokerActivityQuery = {
  agentId?: string;
  actorId?: string;
  conversationId?: string;
  limit?: number;
};

export type ScoutBrokerCollaborationRecordQuery = {
  kind?: string;
  state?: string;
  ownerId?: string;
  nextMoveOwnerId?: string;
  limit?: number;
};

export type ScoutBrokerCollaborationEventQuery = {
  recordId?: string;
  limit?: number;
};

export type ScoutBrokerThreadEventQuery = {
  conversationId: string;
  afterSeq?: number;
  limit?: number;
};

export type ActiveScoutBrokerService = {
  baseUrl: string;
  matchesBaseUrl?: (baseUrl: string) => boolean;
  readHealth: () => Promise<ScoutBrokerHealthPayload>;
  readHome?: () => Promise<unknown>;
  readNode: () => Promise<NodeDefinition>;
  readSnapshot: () => Promise<RuntimeRegistrySnapshot>;
  readMessages?: (
    query: ScoutBrokerMessageQuery,
  ) => Promise<MessageRecord[]>;
  readActivity?: (query: ScoutBrokerActivityQuery) => Promise<unknown>;
  readCollaborationRecords?: (
    query: ScoutBrokerCollaborationRecordQuery,
  ) => Promise<unknown>;
  readCollaborationEvents?: (
    query: ScoutBrokerCollaborationEventQuery,
  ) => Promise<unknown>;
  readThreadEvents?: (
    query: ScoutBrokerThreadEventQuery,
  ) => Promise<ThreadEventEnvelope[]>;
  readThreadSnapshot?: (conversationId: string) => Promise<ThreadSnapshot>;
  openThreadWatch?: (
    request: ThreadWatchOpenRequest,
  ) => Promise<ThreadWatchOpenResponse>;
  renewThreadWatch?: (
    request: ThreadWatchRenewRequest,
  ) => Promise<ThreadWatchRenewResponse>;
  closeThreadWatch?: (
    request: ThreadWatchCloseRequest,
  ) => Promise<{ ok: boolean; watchId: string }>;
  executeCommand: (command: ControlCommand) => Promise<unknown>;
  postConversationMessage?: (message: MessageRecord) => Promise<unknown>;
  deliver?: (request: ScoutDeliverRequest) => Promise<ScoutDeliverResponse>;
  invokeAgent?: (
    request: InvocationRequest & BrokerRouteTargetInput,
  ) => Promise<unknown>;
};

export type ActiveScoutBrokerServiceResult<T> =
  | { handled: false }
  | { handled: true; value: T };

export type ScoutBrokerJsonRequestOptions<T> = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  socketPath?: string | null;
  signal?: AbortSignal;
  acceptErrorJson?: (value: unknown) => value is T;
};

type ScoutBrokerWireResponse = {
  ok: boolean;
  status: number;
  text: string;
};

const activeScoutBrokerServices: ActiveScoutBrokerService[] = [];

function handled<T>(value: T): ActiveScoutBrokerServiceResult<T> {
  return { handled: true, value };
}

function unhandled<T>(): ActiveScoutBrokerServiceResult<T> {
  return { handled: false };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed;
  }
}

function requestHeaders(options: ScoutBrokerJsonRequestOptions<any>): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined && !("content-type" in lowercaseKeys(headers))) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

function lowercaseKeys(value: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    result[key.toLowerCase()] = value[key] ?? "";
  }
  return result;
}

function requestBody(options: ScoutBrokerJsonRequestOptions<any>): string | undefined {
  return options.body === undefined ? undefined : JSON.stringify(options.body);
}

async function requestBrokerOverHttp<T>(
  baseUrl: string,
  path: string,
  options: ScoutBrokerJsonRequestOptions<T>,
): Promise<ScoutBrokerWireResponse> {
  const response = await fetch(new URL(path, normalizeBaseUrl(baseUrl)), {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: requestHeaders(options),
    body: requestBody(options),
    signal: options.signal,
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

function shouldFallbackFromUnixSocket(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return code === "ENOENT"
    || code === "ECONNREFUSED"
    || code === "ENOTSOCK"
    || code === "EACCES"
    || code === "FailedToOpenSocket";
}

function requestBrokerOverUnixSocket<T>(
  socketPath: string,
  baseUrl: string,
  path: string,
  options: ScoutBrokerJsonRequestOptions<T>,
): Promise<ScoutBrokerWireResponse> {
  return new Promise((resolve, reject) => {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const url = new URL(path, normalizedBaseUrl);
    const body = requestBody(options);
    const headers = requestHeaders(options);
    if (body !== undefined) {
      headers["content-length"] = Buffer.byteLength(body).toString();
    }

    const request = httpRequest(
      {
        socketPath,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? (body === undefined ? "GET" : "POST"),
        headers,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += String(chunk);
        });
        response.on("end", () => {
          options.signal?.removeEventListener("abort", handleAbort);
          resolve({
            ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
            status: response.statusCode ?? 0,
            text,
          });
        });
      },
    );

    const handleAbort = () => {
      request.destroy(
        options.signal?.reason instanceof Error
          ? options.signal.reason
          : new Error("Scout broker request aborted"),
      );
    };

    request.on("error", (error) => {
      options.signal?.removeEventListener("abort", handleAbort);
      reject(error);
    });
    if (options.signal) {
      if (options.signal.aborted) {
        handleAbort();
        return;
      }
      options.signal.addEventListener("abort", handleAbort, { once: true });
    }
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}

async function requestBrokerWire<T>(
  baseUrl: string,
  path: string,
  options: ScoutBrokerJsonRequestOptions<T>,
): Promise<ScoutBrokerWireResponse> {
  const socketPath = options.socketPath?.trim();
  if (socketPath) {
    try {
      return await requestBrokerOverUnixSocket(socketPath, baseUrl, path, options);
    } catch (error) {
      if (!shouldFallbackFromUnixSocket(error)) {
        throw error;
      }
    }
  }
  return requestBrokerOverHttp(baseUrl, path, options);
}

export async function requestScoutBrokerJson<T>(
  baseUrl: string,
  path: string,
  options: ScoutBrokerJsonRequestOptions<T> = {},
): Promise<T> {
  const response = await requestBrokerWire(baseUrl, path, options);
  let parsed: unknown;
  let parsedJson = false;
  if (response.text.length > 0) {
    try {
      parsed = JSON.parse(response.text);
      parsedJson = true;
    } catch {
      parsedJson = false;
    }
  }

  if (!response.ok) {
    if (parsedJson && options.acceptErrorJson?.(parsed)) {
      return parsed;
    }
    throw new Error(`${path} returned ${response.status}: ${response.text}`);
  }

  if (parsedJson) {
    return parsed as T;
  }
  return undefined as T;
}

function parsePositiveInt(
  value: string | null | undefined,
  fallback?: number,
): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseLimit(value: string | null | undefined): number {
  const parsed = parsePositiveInt(value, 100) ?? 100;
  return Math.min(parsed, 500);
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getActiveServiceForBaseUrl(
  baseUrl: string,
): ActiveScoutBrokerService | null {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  for (let index = activeScoutBrokerServices.length - 1; index >= 0; index -= 1) {
    const service = activeScoutBrokerServices[index];
    if (!service) {
      continue;
    }
    if (typeof service.matchesBaseUrl === "function") {
      if (service.matchesBaseUrl(normalizedBaseUrl)) {
        return service;
      }
      continue;
    }
    if (normalizeBaseUrl(service.baseUrl) === normalizedBaseUrl) {
      return service;
    }
  }
  return null;
}

export function registerActiveScoutBrokerService(
  service: ActiveScoutBrokerService | null,
): void {
  if (!service) {
    activeScoutBrokerServices.length = 0;
    return;
  }

  const normalizedBaseUrl = normalizeBaseUrl(service.baseUrl);
  const existingIndex = activeScoutBrokerServices.findIndex((candidate) =>
    candidate === service
      || normalizeBaseUrl(candidate.baseUrl) === normalizedBaseUrl
  );
  if (existingIndex >= 0) {
    activeScoutBrokerServices[existingIndex] = service;
    return;
  }

  activeScoutBrokerServices.push(service);
}

export function unregisterActiveScoutBrokerService(
  serviceOrBaseUrl?: ActiveScoutBrokerService | string | null,
): void {
  if (!serviceOrBaseUrl) {
    activeScoutBrokerServices.length = 0;
    return;
  }

  const normalizedBaseUrl = normalizeBaseUrl(
    typeof serviceOrBaseUrl === "string"
      ? serviceOrBaseUrl
      : serviceOrBaseUrl.baseUrl,
  );

  for (let index = activeScoutBrokerServices.length - 1; index >= 0; index -= 1) {
    const service = activeScoutBrokerServices[index];
    if (
      service === serviceOrBaseUrl
      || normalizeBaseUrl(service.baseUrl) === normalizedBaseUrl
    ) {
      activeScoutBrokerServices.splice(index, 1);
    }
  }
}

export function getActiveScoutBrokerService(
  baseUrl?: string,
): ActiveScoutBrokerService | null {
  if (!baseUrl) {
    return activeScoutBrokerServices[activeScoutBrokerServices.length - 1] ?? null;
  }
  return getActiveServiceForBaseUrl(baseUrl);
}

export async function maybeReadJsonFromActiveScoutBrokerService<T>(
  baseUrl: string,
  path: string,
): Promise<ActiveScoutBrokerServiceResult<T>> {
  const service = getActiveServiceForBaseUrl(baseUrl);
  if (!service) {
    return unhandled();
  }

  const url = new URL(path, normalizeBaseUrl(baseUrl));

  if (url.pathname === "/health") {
    return handled(await service.readHealth() as T);
  }

  if (url.pathname === "/v1/home") {
    if (!service.readHome) {
      return unhandled();
    }
    return handled(await service.readHome() as T);
  }

  if (url.pathname === "/v1/node") {
    return handled(await service.readNode() as T);
  }

  if (url.pathname === "/v1/snapshot") {
    return handled(await service.readSnapshot() as T);
  }

  if (url.pathname === "/v1/messages") {
    if (!service.readMessages) {
      return unhandled();
    }
    return handled(await service.readMessages({
      conversationId: trimOrUndefined(url.searchParams.get("conversationId")),
      since: parsePositiveInt(url.searchParams.get("since")) ?? null,
      limit: parseLimit(url.searchParams.get("limit")),
    }) as T);
  }

  if (url.pathname === "/v1/activity") {
    if (!service.readActivity) {
      return unhandled();
    }
    return handled(await service.readActivity({
      agentId: trimOrUndefined(url.searchParams.get("agentId")),
      actorId: trimOrUndefined(url.searchParams.get("actorId")),
      conversationId: trimOrUndefined(url.searchParams.get("conversationId")),
      limit: parseLimit(url.searchParams.get("limit")),
    }) as T);
  }

  if (url.pathname === "/v1/collaboration/records") {
    if (!service.readCollaborationRecords) {
      return unhandled();
    }
    return handled(await service.readCollaborationRecords({
      kind: trimOrUndefined(url.searchParams.get("kind")),
      state: trimOrUndefined(url.searchParams.get("state")),
      ownerId: trimOrUndefined(url.searchParams.get("ownerId")),
      nextMoveOwnerId: trimOrUndefined(
        url.searchParams.get("nextMoveOwnerId"),
      ),
      limit: parseLimit(url.searchParams.get("limit")),
    }) as T);
  }

  if (url.pathname === "/v1/collaboration/events") {
    if (!service.readCollaborationEvents) {
      return unhandled();
    }
    return handled(await service.readCollaborationEvents({
      recordId: trimOrUndefined(url.searchParams.get("recordId")),
      limit: parseLimit(url.searchParams.get("limit")),
    }) as T);
  }

  const threadEventsMatch = url.pathname.match(
    /^\/v1\/conversations\/([^/]+)\/thread-events$/,
  );
  if (threadEventsMatch) {
    if (!service.readThreadEvents) {
      return unhandled();
    }
    return handled(await service.readThreadEvents({
      conversationId: decodeURIComponent(threadEventsMatch[1] ?? ""),
      afterSeq: parsePositiveInt(url.searchParams.get("afterSeq")) ?? 0,
      limit: parseLimit(url.searchParams.get("limit")),
    }) as T);
  }

  const threadSnapshotMatch = url.pathname.match(
    /^\/v1\/conversations\/([^/]+)\/thread-snapshot$/,
  );
  if (threadSnapshotMatch) {
    if (!service.readThreadSnapshot) {
      return unhandled();
    }
    return handled(await service.readThreadSnapshot(
      decodeURIComponent(threadSnapshotMatch[1] ?? ""),
    ) as T);
  }

  return unhandled();
}

export async function maybePostJsonToActiveScoutBrokerService<T>(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<ActiveScoutBrokerServiceResult<T>> {
  const service = getActiveServiceForBaseUrl(baseUrl);
  if (!service) {
    return unhandled();
  }

  const url = new URL(path, normalizeBaseUrl(baseUrl));

  if (url.pathname === "/v1/commands") {
    return handled(await service.executeCommand(body as ControlCommand) as T);
  }

  if (url.pathname === "/v1/nodes") {
    const node = body as NodeDefinition;
    await service.executeCommand({ kind: "node.upsert", node });
    return handled({ ok: true, nodeId: node.id } as T);
  }

  if (url.pathname === "/v1/actors") {
    const actor = body as ActorIdentity;
    await service.executeCommand({ kind: "actor.upsert", actor });
    return handled({ ok: true, actorId: actor.id } as T);
  }

  if (url.pathname === "/v1/agents") {
    const agent = body as AgentDefinition;
    await service.executeCommand({ kind: "agent.upsert", agent });
    return handled({ ok: true, agentId: agent.id } as T);
  }

  if (url.pathname === "/v1/endpoints") {
    const endpoint = body as AgentEndpoint;
    await service.executeCommand({
      kind: "agent.endpoint.upsert",
      endpoint,
    });
    return handled({ ok: true, endpointId: endpoint.id } as T);
  }

  if (url.pathname === "/v1/conversations") {
    const conversation = body as ConversationDefinition;
    await service.executeCommand({ kind: "conversation.upsert", conversation });
    return handled({ ok: true, conversationId: conversation.id } as T);
  }

  if (url.pathname === "/v1/bindings") {
    const binding = body as ConversationBinding;
    await service.executeCommand({ kind: "binding.upsert", binding });
    return handled({ ok: true, bindingId: binding.id } as T);
  }

  if (url.pathname === "/v1/collaboration/records") {
    return handled(await service.executeCommand({
      kind: "collaboration.upsert",
      record: body as CollaborationRecord,
    }) as T);
  }

  if (url.pathname === "/v1/collaboration/events") {
    return handled(await service.executeCommand({
      kind: "collaboration.event.append",
      event: body as CollaborationEvent,
    }) as T);
  }

  if (url.pathname === "/v1/messages") {
    if (service.postConversationMessage) {
      return handled(await service.postConversationMessage(
        body as MessageRecord,
      ) as T);
    }
    return handled(await service.executeCommand({
      kind: "conversation.post",
      message: body as MessageRecord,
    }) as T);
  }

  if (url.pathname === "/v1/deliver") {
    if (!service.deliver) {
      return unhandled();
    }
    return handled(await service.deliver(body as ScoutDeliverRequest) as T);
  }

  if (url.pathname === "/v1/invocations") {
    const invocation = body as InvocationRequest & BrokerRouteTargetInput;
    if (service.invokeAgent) {
      return handled(await service.invokeAgent(invocation) as T);
    }
    if (invocation.targetLabel) {
      return unhandled();
    }
    return handled(await service.executeCommand({
      kind: "agent.invoke",
      invocation,
    }) as T);
  }

  if (url.pathname === "/v1/thread-watches/open") {
    if (!service.openThreadWatch) {
      return unhandled();
    }
    return handled(await service.openThreadWatch(
      body as ThreadWatchOpenRequest,
    ) as T);
  }

  if (url.pathname === "/v1/thread-watches/renew") {
    if (!service.renewThreadWatch) {
      return unhandled();
    }
    return handled(await service.renewThreadWatch(
      body as ThreadWatchRenewRequest,
    ) as T);
  }

  if (url.pathname === "/v1/thread-watches/close") {
    if (!service.closeThreadWatch) {
      return unhandled();
    }
    return handled(await service.closeThreadWatch(
      body as ThreadWatchCloseRequest,
    ) as T);
  }

  return unhandled();
}
