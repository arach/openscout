import {
  readRelayEvents,
  readRelayEventsSync,
  type ReadRelayEventsOptions,
} from "../store/jsonl-store.js";
import type { RelayAgentStateSetEvent, RelayEvent } from "../protocol/events.js";

export interface RelayAgentStateSnapshot {
  state: string;
  updatedAt: number;
  eventId: string;
}

export function projectRelayAgentStates(
  events: RelayEvent[],
): Record<string, RelayAgentStateSnapshot> {
  const states: Record<string, RelayAgentStateSnapshot> = {};

  for (const event of events) {
    if (event.kind !== "agent.state_set") continue;

    const stateEvent = event as RelayAgentStateSetEvent;
    const rawState = stateEvent.payload.state?.trim();

    if (!rawState || rawState === "idle" || rawState === "clear") {
      delete states[stateEvent.actor];
      continue;
    }

    states[stateEvent.actor] = {
      state: rawState,
      updatedAt: stateEvent.ts,
      eventId: stateEvent.id,
    };
  }

  return states;
}

export async function readProjectedRelayAgentStates(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Promise<Record<string, RelayAgentStateSnapshot>> {
  const events = await readRelayEvents(hub, opts);
  return projectRelayAgentStates(events);
}

export function readProjectedRelayAgentStatesSync(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Record<string, RelayAgentStateSnapshot> {
  const events = readRelayEventsSync(hub, opts);
  return projectRelayAgentStates(events);
}
