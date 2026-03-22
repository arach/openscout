import {
  readRelayEvents,
  readRelayEventsSync,
  type ReadRelayEventsOptions,
} from "../store/jsonl-store.js";
import type {
  RelayChannelBindingUpsertedEvent,
  RelayEvent,
} from "../protocol/events.js";

export interface RelayChannelBinding {
  bindingId: string;
  platform: string;
  externalChannelId: string;
  externalThreadId?: string;
  conversationId: string;
  mode: "inbound" | "outbound" | "bidirectional";
  metadata?: Record<string, unknown>;
  updatedAt: number;
  actor: string;
}

export function projectRelayChannelBindings(
  events: RelayEvent[],
): Record<string, RelayChannelBinding> {
  const bindings: Record<string, RelayChannelBinding> = {};

  for (const event of events) {
    if (event.kind !== "channel.binding.upserted") continue;
    const bindingEvent = event as RelayChannelBindingUpsertedEvent;

    bindings[bindingEvent.payload.bindingId] = {
      bindingId: bindingEvent.payload.bindingId,
      platform: bindingEvent.payload.platform,
      externalChannelId: bindingEvent.payload.externalChannelId,
      externalThreadId: bindingEvent.payload.externalThreadId,
      conversationId: bindingEvent.payload.conversationId,
      mode: bindingEvent.payload.mode,
      metadata: bindingEvent.payload.metadata,
      updatedAt: bindingEvent.ts,
      actor: bindingEvent.actor,
    };
  }

  return bindings;
}

export async function readProjectedRelayChannelBindings(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Promise<Record<string, RelayChannelBinding>> {
  const events = await readRelayEvents(hub, opts);
  return projectRelayChannelBindings(events);
}

export function readProjectedRelayChannelBindingsSync(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Record<string, RelayChannelBinding> {
  const events = readRelayEventsSync(hub, opts);
  return projectRelayChannelBindings(events);
}
