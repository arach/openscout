import {
  readRelayEvents,
  readRelayEventsSync,
  type ReadRelayEventsOptions,
} from "../store/jsonl-store.js";
import type {
  ProjectTwinRecord,
} from "../protocol/twins.js";
import type {
  RelayEvent,
  RelayProjectTwinStartedEvent,
  RelayProjectTwinStoppedEvent,
} from "../protocol/events.js";

export function projectRelayTwins(
  events: RelayEvent[],
): Record<string, ProjectTwinRecord> {
  const twins: Record<string, ProjectTwinRecord> = {};

  for (const event of events) {
    if (event.kind === "project_twin.started") {
      const twinEvent = event as RelayProjectTwinStartedEvent;
      twins[twinEvent.payload.record.twinId] = twinEvent.payload.record;
      continue;
    }

    if (event.kind === "project_twin.stopped") {
      const twinEvent = event as RelayProjectTwinStoppedEvent;
      delete twins[twinEvent.payload.twinId];
    }
  }

  return twins;
}

export async function readProjectedRelayTwins(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Promise<Record<string, ProjectTwinRecord>> {
  const events = await readRelayEvents(hub, opts);
  return projectRelayTwins(events);
}

export function readProjectedRelayTwinsSync(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Record<string, ProjectTwinRecord> {
  const events = readRelayEventsSync(hub, opts);
  return projectRelayTwins(events);
}
