import {
  readRelayEvents,
  readRelayEventsSync,
  type ReadRelayEventsOptions,
} from "../store/jsonl-store.js";
import type {
  RelayEvent,
  RelayFlightOpenedEvent,
  RelayMessagePostedEvent,
} from "../protocol/events.js";

export interface RelayFlightRecord {
  id: string;
  from: string;
  to: string;
  message: string;
  sentAt: number;
  status: "pending" | "completed";
  response?: string;
  respondedAt?: number;
}

function completeFlightIfMatched(
  flight: RelayFlightRecord,
  messageEvent: RelayMessagePostedEvent,
): void {
  if (flight.status !== "pending") return;
  if (messageEvent.actor !== flight.to) return;
  if (messageEvent.ts <= flight.sentAt) return;

  flight.status = "completed";
  flight.response = messageEvent.payload.body;
  flight.respondedAt = messageEvent.ts;
}

export function projectRelayFlights(
  events: RelayEvent[],
  now = Math.floor(Date.now() / 1000),
): RelayFlightRecord[] {
  const flights: RelayFlightRecord[] = [];

  for (const event of events) {
    if (event.kind === "flight.opened") {
      const flightEvent = event as RelayFlightOpenedEvent;
      flights.push({
        id: flightEvent.payload.flightId,
        from: flightEvent.actor,
        to: flightEvent.payload.to,
        message: flightEvent.payload.message,
        sentAt: flightEvent.ts,
        status: "pending",
      });
      continue;
    }

    if (event.kind === "message.posted") {
      const messageEvent = event as RelayMessagePostedEvent;
      if (messageEvent.payload.type !== "MSG") continue;

      for (const flight of flights) {
        completeFlightIfMatched(flight, messageEvent);
      }
    }
  }

  for (const flight of flights) {
    if (flight.status === "pending" && now - flight.sentAt > 300) {
      flight.status = "completed";
      flight.response = "(expired)";
      flight.respondedAt = now;
    }
  }

  return flights.slice(-50);
}

export async function readProjectedRelayFlights(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Promise<RelayFlightRecord[]> {
  const events = await readRelayEvents(hub, opts);
  return projectRelayFlights(events);
}

export function readProjectedRelayFlightsSync(
  hub: string,
  opts?: ReadRelayEventsOptions,
): RelayFlightRecord[] {
  const events = readRelayEventsSync(hub, opts);
  return projectRelayFlights(events);
}
