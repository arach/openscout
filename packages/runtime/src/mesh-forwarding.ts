import type {
  ActorIdentity,
  AgentDefinition,
  CollaborationEvent,
  CollaborationRecord,
  ConversationBinding,
  ConversationDefinition,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
  NodeDefinition,
} from "@openscout/protocol";
import type { DeliveryIntent, ScoutId } from "@openscout/protocol";
import type { RuntimeRegistrySnapshot } from "./registry.js";

export interface MeshMessageBundle {
  originNode: NodeDefinition;
  conversation: ConversationDefinition;
  actors: ActorIdentity[];
  agents: AgentDefinition[];
  bindings: ConversationBinding[];
  message: MessageRecord;
}

export interface MeshInvocationBundle {
  originNode: NodeDefinition;
  actors: ActorIdentity[];
  agents: AgentDefinition[];
  conversation?: ConversationDefinition;
  invocation: InvocationRequest;
}

export interface MeshCollaborationRecordBundle {
  originNode: NodeDefinition;
  actors: ActorIdentity[];
  agents: AgentDefinition[];
  conversation?: ConversationDefinition;
  record: CollaborationRecord;
}

export interface MeshCollaborationEventBundle {
  originNode: NodeDefinition;
  actors: ActorIdentity[];
  agents: AgentDefinition[];
  conversation?: ConversationDefinition;
  record?: CollaborationRecord;
  event: CollaborationEvent;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function invocationMetadataValue(
  invocation: InvocationRequest,
  key: string,
): unknown {
  const contextValue = invocation.context?.[key];
  if (typeof contextValue !== "undefined") {
    return contextValue;
  }

  const nestedContext = invocation.context?.collaboration;
  if (nestedContext && typeof nestedContext === "object" && !Array.isArray(nestedContext) && key in nestedContext) {
    return (nestedContext as Record<string, unknown>)[key];
  }

  const metadataValue = invocation.metadata?.[key];
  if (typeof metadataValue !== "undefined") {
    return metadataValue;
  }

  const nestedMetadata = invocation.metadata?.collaboration;
  if (nestedMetadata && typeof nestedMetadata === "object" && !Array.isArray(nestedMetadata) && key in nestedMetadata) {
    return (nestedMetadata as Record<string, unknown>)[key];
  }

  return undefined;
}

function invocationStringValue(
  invocation: InvocationRequest,
  key: string,
): string | undefined {
  const value = invocationMetadataValue(invocation, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function actorIdsForMessage(
  snapshot: Readonly<RuntimeRegistrySnapshot>,
  conversation: ConversationDefinition,
  message: MessageRecord,
): string[] {
  return unique([
    ...conversation.participantIds,
    message.actorId,
    ...(message.mentions ?? []).map((mention) => mention.actorId),
    ...(message.audience?.notify ?? []),
    ...(message.audience?.invoke ?? []),
  ]).filter((id) => Boolean(snapshot.actors[id] || snapshot.agents[id]));
}

function actorIdsForInvocation(
  snapshot: Readonly<RuntimeRegistrySnapshot>,
  invocation: InvocationRequest,
): string[] {
  return unique([
    invocation.requesterId,
    invocation.targetAgentId,
    invocationStringValue(invocation, "ownerId"),
    invocationStringValue(invocation, "nextMoveOwnerId"),
    invocationStringValue(invocation, "requestedById"),
    invocationStringValue(invocation, "askedById"),
    invocationStringValue(invocation, "askedOfId"),
    invocationStringValue(invocation, "targetAgentId"),
    (() => {
      const waitingOn = invocationMetadataValue(invocation, "waitingOn");
      if (!waitingOn || typeof waitingOn !== "object" || Array.isArray(waitingOn)) {
        return undefined;
      }
      return typeof (waitingOn as { targetId?: unknown }).targetId === "string"
        ? String((waitingOn as { targetId: string }).targetId).trim()
        : undefined;
    })(),
  ].filter((id): id is string => typeof id === "string" && id.trim().length > 0))
    .filter((id) => Boolean(snapshot.actors[id] || snapshot.agents[id]));
}

function actorIdsForCollaboration(
  snapshot: Readonly<RuntimeRegistrySnapshot>,
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

  return [...ids].filter((id) => Boolean(snapshot.actors[id] || snapshot.agents[id]));
}

export function buildMeshMessageBundle(
  snapshot: Readonly<RuntimeRegistrySnapshot>,
  originNode: NodeDefinition,
  message: MessageRecord,
  options: { bindings?: ConversationBinding[] } = {},
): MeshMessageBundle {
  const conversation = snapshot.conversations[message.conversationId];
  if (!conversation) {
    throw new Error(`missing conversation ${message.conversationId} for mesh forward`);
  }

  const actorIds = actorIdsForMessage(snapshot, conversation, message);
  return {
    originNode,
    conversation,
    actors: actorIds
      .map((id) => snapshot.actors[id])
      .filter((entry): entry is ActorIdentity => Boolean(entry)),
    agents: actorIds
      .map((id) => snapshot.agents[id])
      .filter((entry): entry is AgentDefinition => Boolean(entry)),
    bindings: options.bindings ?? Object.values(snapshot.bindings).filter((binding) => binding.conversationId === conversation.id),
    message,
  };
}

export function buildMeshInvocationBundle(
  snapshot: Readonly<RuntimeRegistrySnapshot>,
  originNode: NodeDefinition,
  invocation: InvocationRequest,
): MeshInvocationBundle {
  const actorIds = actorIdsForInvocation(snapshot, invocation);

  return {
    originNode,
    actors: actorIds
      .map((id) => snapshot.actors[id])
      .filter((entry): entry is ActorIdentity => Boolean(entry)),
    agents: actorIds
      .map((id) => snapshot.agents[id])
      .filter((entry): entry is AgentDefinition => Boolean(entry)),
    conversation: invocation.conversationId
      ? snapshot.conversations[invocation.conversationId]
      : undefined,
    invocation,
  };
}

export function buildMeshCollaborationRecordBundle(
  snapshot: Readonly<RuntimeRegistrySnapshot>,
  originNode: NodeDefinition,
  record: CollaborationRecord,
): MeshCollaborationRecordBundle {
  const conversation = record.conversationId
    ? snapshot.conversations[record.conversationId]
    : undefined;
  const actorIds = actorIdsForCollaboration(snapshot, record, conversation);

  return {
    originNode,
    conversation,
    actors: actorIds
      .map((id) => snapshot.actors[id])
      .filter((entry): entry is ActorIdentity => Boolean(entry)),
    agents: actorIds
      .map((id) => snapshot.agents[id])
      .filter((entry): entry is AgentDefinition => Boolean(entry)),
    record,
  };
}

export function buildMeshCollaborationEventBundle(
  snapshot: Readonly<RuntimeRegistrySnapshot>,
  originNode: NodeDefinition,
  event: CollaborationEvent,
  record?: CollaborationRecord,
): MeshCollaborationEventBundle {
  const resolvedRecord = record ?? snapshot.collaborationRecords[event.recordId];
  const conversation = resolvedRecord?.conversationId
    ? snapshot.conversations[resolvedRecord.conversationId]
    : undefined;
  const actorIds = resolvedRecord
    ? actorIdsForCollaboration(snapshot, resolvedRecord, conversation)
    : [event.actorId];

  return {
    originNode,
    conversation,
    actors: actorIds
      .map((id) => snapshot.actors[id])
      .filter((entry): entry is ActorIdentity => Boolean(entry)),
    agents: actorIds
      .map((id) => snapshot.agents[id])
      .filter((entry): entry is AgentDefinition => Boolean(entry)),
    record: resolvedRecord,
    event,
  };
}

/**
 * Network-level failure reaching the peer broker (DNS, TCP, TLS, abort).
 * Originator outbox treats this as retry-able.
 */
export class PeerUnreachableError extends Error {
  override readonly name = "PeerUnreachableError";
  constructor(
    message: string,
    readonly url: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Peer broker responded but rejected the request (HTTP non-2xx).
 * Originator outbox treats 5xx as retry-able and 4xx as terminal.
 */
export class PeerRejectedError extends Error {
  override readonly name = "PeerRejectedError";
  constructor(
    message: string,
    readonly url: string,
    readonly status: number,
    readonly statusText: string,
    readonly body?: string,
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.status >= 500;
  }
}

async function postJson<TResponse>(url: string, payload: unknown): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new PeerUnreachableError(
      `peer broker unreachable: ${error instanceof Error ? error.message : String(error)}`,
      url,
      error,
    );
  }

  if (!response.ok) {
    let body: string | undefined;
    try {
      body = await response.text();
    } catch {
      body = undefined;
    }
    throw new PeerRejectedError(
      `peer broker rejected request: ${response.status} ${response.statusText}`,
      url,
      response.status,
      response.statusText,
      body,
    );
  }

  return await response.json() as TResponse;
}

export async function forwardMeshMessage(
  brokerUrl: string,
  bundle: MeshMessageBundle,
): Promise<{ ok: true; deliveries?: DeliveryIntent[]; duplicate?: boolean }> {
  return postJson(`${brokerUrl.replace(/\/$/, "")}/v1/mesh/messages`, bundle);
}

export async function forwardMeshInvocation(
  brokerUrl: string,
  bundle: MeshInvocationBundle,
): Promise<{ ok: true; flight: FlightRecord; duplicate?: boolean }> {
  return postJson(`${brokerUrl.replace(/\/$/, "")}/v1/mesh/invocations`, bundle);
}

export async function forwardMeshCollaborationRecord(
  brokerUrl: string,
  bundle: MeshCollaborationRecordBundle,
): Promise<{ ok: true; duplicate?: boolean }> {
  return postJson(`${brokerUrl.replace(/\/$/, "")}/v1/mesh/collaboration/records`, bundle);
}

export async function forwardMeshCollaborationEvent(
  brokerUrl: string,
  bundle: MeshCollaborationEventBundle,
): Promise<{ ok: true; duplicate?: boolean }> {
  return postJson(`${brokerUrl.replace(/\/$/, "")}/v1/mesh/collaboration/events`, bundle);
}

export async function fetchPeerAgents(
  brokerUrl: string,
): Promise<AgentDefinition[]> {
  const url = `${brokerUrl.replace(/\/$/, "")}/v1/snapshot`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return [];
  const snapshot = await response.json() as { agents?: Record<string, AgentDefinition> };
  return Object.values(snapshot.agents ?? {});
}
