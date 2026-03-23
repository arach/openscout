import type {
  ActorIdentity,
  AgentDefinition,
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function actorIdsForMessage(snapshot: RuntimeRegistrySnapshot, conversation: ConversationDefinition, message: MessageRecord): string[] {
  return unique([
    ...conversation.participantIds,
    message.actorId,
    ...(message.mentions ?? []).map((mention) => mention.actorId),
    ...(message.audience?.notify ?? []),
    ...(message.audience?.invoke ?? []),
  ]).filter((id) => Boolean(snapshot.actors[id] || snapshot.agents[id]));
}

function actorIdsForInvocation(snapshot: RuntimeRegistrySnapshot, invocation: InvocationRequest): string[] {
  return unique([
    invocation.requesterId,
    invocation.targetAgentId,
  ]).filter((id) => Boolean(snapshot.actors[id] || snapshot.agents[id]));
}

export function buildMeshMessageBundle(
  snapshot: RuntimeRegistrySnapshot,
  originNode: NodeDefinition,
  message: MessageRecord,
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
    bindings: Object.values(snapshot.bindings).filter((binding) => binding.conversationId === conversation.id),
    message,
  };
}

export function buildMeshInvocationBundle(
  snapshot: RuntimeRegistrySnapshot,
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

async function postJson<TResponse>(url: string, payload: unknown): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`peer broker request failed: ${response.status} ${response.statusText}`);
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
