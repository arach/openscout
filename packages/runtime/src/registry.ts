import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  CollaborationRecord,
  ConversationBinding,
  ConversationDefinition,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
  UnblockRequestRecord,
} from "@openscout/protocol";
import type { NodeDefinition } from "@openscout/protocol";

export interface RuntimeRegistrySnapshot {
  nodes: Record<string, NodeDefinition>;
  actors: Record<string, ActorIdentity>;
  agents: Record<string, AgentDefinition>;
  endpoints: Record<string, AgentEndpoint>;
  conversations: Record<string, ConversationDefinition>;
  bindings: Record<string, ConversationBinding>;
  messages: Record<string, MessageRecord>;
  invocations: Record<string, InvocationRequest>;
  flights: Record<string, FlightRecord>;
  collaborationRecords: Record<string, CollaborationRecord>;
  unblockRequests: Record<string, UnblockRequestRecord>;
}

export function createRuntimeRegistrySnapshot(
  value: Partial<RuntimeRegistrySnapshot> = {},
): RuntimeRegistrySnapshot {
  return {
    nodes: value.nodes ?? {},
    actors: value.actors ?? {},
    agents: value.agents ?? {},
    endpoints: value.endpoints ?? {},
    conversations: value.conversations ?? {},
    bindings: value.bindings ?? {},
    messages: value.messages ?? {},
    invocations: value.invocations ?? {},
    flights: value.flights ?? {},
    collaborationRecords: value.collaborationRecords ?? {},
    unblockRequests: value.unblockRequests ?? {},
  };
}
