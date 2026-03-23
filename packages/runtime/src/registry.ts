import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  ConversationBinding,
  ConversationDefinition,
  FlightRecord,
  MessageRecord,
} from "@openscout/protocol";

export interface RuntimeRegistrySnapshot {
  actors: Record<string, ActorIdentity>;
  agents: Record<string, AgentDefinition>;
  endpoints: Record<string, AgentEndpoint>;
  conversations: Record<string, ConversationDefinition>;
  bindings: Record<string, ConversationBinding>;
  messages: Record<string, MessageRecord>;
  flights: Record<string, FlightRecord>;
}

export function createRuntimeRegistrySnapshot(
  value: Partial<RuntimeRegistrySnapshot> = {},
): RuntimeRegistrySnapshot {
  return {
    actors: value.actors ?? {},
    agents: value.agents ?? {},
    endpoints: value.endpoints ?? {},
    conversations: value.conversations ?? {},
    bindings: value.bindings ?? {},
    messages: value.messages ?? {},
    flights: value.flights ?? {},
  };
}
