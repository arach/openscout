import {
  readRelayEvents,
  readRelayEventsSync,
  type ReadRelayEventsOptions,
} from "../store/jsonl-store.js";
import type {
  RelayAgentSessionClearedEvent,
  RelayAgentSessionRegisteredEvent,
  RelayEvent,
} from "../protocol/events.js";

export interface RelayAgentSessionRecord {
  pane?: string;
  cwd: string;
  project: string;
  sessionId?: string;
  registeredAt: number;
  actor: string;
}

export function projectRelayAgentSessions(
  events: RelayEvent[],
): Record<string, RelayAgentSessionRecord> {
  const sessions: Record<string, RelayAgentSessionRecord> = {};

  for (const event of events) {
    if (event.kind === "agent.session_registered") {
      const sessionEvent = event as RelayAgentSessionRegisteredEvent;
      sessions[sessionEvent.actor] = {
        pane: sessionEvent.payload.pane,
        cwd: sessionEvent.payload.cwd,
        project: sessionEvent.payload.project,
        sessionId: sessionEvent.payload.sessionId,
        registeredAt: sessionEvent.payload.registeredAt,
        actor: sessionEvent.actor,
      };
      continue;
    }

    if (event.kind === "agent.session_cleared") {
      const sessionEvent = event as RelayAgentSessionClearedEvent;
      delete sessions[sessionEvent.actor];
    }
  }

  return sessions;
}

export async function readProjectedRelayAgentSessions(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Promise<Record<string, RelayAgentSessionRecord>> {
  const events = await readRelayEvents(hub, opts);
  return projectRelayAgentSessions(events);
}

export function readProjectedRelayAgentSessionsSync(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Record<string, RelayAgentSessionRecord> {
  const events = readRelayEventsSync(hub, opts);
  return projectRelayAgentSessions(events);
}
