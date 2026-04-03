import {
  readRelayEvents,
  readRelayEventsSync,
  type ReadRelayEventsOptions,
} from "../store/jsonl-store.js";
import type {
  LocalAgentRecord,
} from "../protocol/local-agents.js";
import type {
  RelayEvent,
  RelayLocalAgentStartedEvent,
  RelayLocalAgentStoppedEvent,
} from "../protocol/events.js";

export function projectRelayLocalAgents(
  events: RelayEvent[],
): Record<string, LocalAgentRecord> {
  const localAgents: Record<string, LocalAgentRecord> = {};

  for (const event of events) {
    if (event.kind === "local_agent.started") {
      const localAgentEvent = event as RelayLocalAgentStartedEvent;
      localAgents[localAgentEvent.payload.record.agentId] = localAgentEvent.payload.record;
      continue;
    }

    if (event.kind === "local_agent.stopped") {
      const localAgentEvent = event as RelayLocalAgentStoppedEvent;
      delete localAgents[localAgentEvent.payload.agentId];
    }
  }

  return localAgents;
}

export async function readProjectedRelayLocalAgents(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Promise<Record<string, LocalAgentRecord>> {
  const events = await readRelayEvents(hub, opts);
  return projectRelayLocalAgents(events);
}

export function readProjectedRelayLocalAgentsSync(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Record<string, LocalAgentRecord> {
  const events = readRelayEventsSync(hub, opts);
  return projectRelayLocalAgents(events);
}
