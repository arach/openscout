import {
  readRelayEvents,
  readRelayEventsSync,
  type ReadRelayEventsOptions,
} from "../store/jsonl-store.js";
import type {
  RelayEvent,
  RelayExternalDeliveryCompletedEvent,
  RelayExternalDeliveryRequestedEvent,
} from "../protocol/events.js";

export interface RelayExternalDelivery {
  deliveryId: string;
  bindingId: string;
  conversationId: string;
  text: string;
  replyToEventId?: string;
  requestedAt: number;
  requestedBy: string;
  status: "pending" | "completed";
  completedAt?: number;
  completedBy?: string;
  externalMessageId?: string;
}

export function projectRelayExternalDeliveries(
  events: RelayEvent[],
): Record<string, RelayExternalDelivery> {
  const deliveries: Record<string, RelayExternalDelivery> = {};

  for (const event of events) {
    if (event.kind === "external.delivery.requested") {
      const deliveryEvent = event as RelayExternalDeliveryRequestedEvent;
      deliveries[deliveryEvent.payload.deliveryId] = {
        deliveryId: deliveryEvent.payload.deliveryId,
        bindingId: deliveryEvent.payload.bindingId,
        conversationId: deliveryEvent.payload.conversationId,
        text: deliveryEvent.payload.text,
        replyToEventId: deliveryEvent.payload.replyToEventId,
        requestedAt: deliveryEvent.ts,
        requestedBy: deliveryEvent.actor,
        status: "pending",
      };
      continue;
    }

    if (event.kind === "external.delivery.completed") {
      const deliveryEvent = event as RelayExternalDeliveryCompletedEvent;
      const current = deliveries[deliveryEvent.payload.deliveryId];
      if (!current) continue;

      deliveries[deliveryEvent.payload.deliveryId] = {
        ...current,
        status: "completed",
        completedAt: deliveryEvent.ts,
        completedBy: deliveryEvent.actor,
        externalMessageId: deliveryEvent.payload.externalMessageId,
      };
    }
  }

  return deliveries;
}

export async function readProjectedRelayExternalDeliveries(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Promise<Record<string, RelayExternalDelivery>> {
  const events = await readRelayEvents(hub, opts);
  return projectRelayExternalDeliveries(events);
}

export function readProjectedRelayExternalDeliveriesSync(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Record<string, RelayExternalDelivery> {
  const events = readRelayEventsSync(hub, opts);
  return projectRelayExternalDeliveries(events);
}
