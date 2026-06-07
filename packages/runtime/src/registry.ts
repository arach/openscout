import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  AssetRecord,
  CollaborationRecord,
  ConversationBinding,
  ConversationDefinition,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
  ConversationReadCursor,
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
  assets: Record<string, AssetRecord>;
  messages: Record<string, MessageRecord>;
  readCursors: Record<string, ConversationReadCursor>;
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
    assets: value.assets ?? {},
    messages: value.messages ?? {},
    readCursors: value.readCursors ?? {},
    invocations: value.invocations ?? {},
    flights: value.flights ?? {},
    collaborationRecords: value.collaborationRecords ?? {},
    unblockRequests: value.unblockRequests ?? {},
  };
}
