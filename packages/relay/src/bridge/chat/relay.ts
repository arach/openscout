import {
  appendRelayEvent,
  createRelayEventId,
  readProjectedRelayChannelBindings,
  type RelayChannelBinding,
} from "../../core/index.js";

export interface UpsertRelayChannelBindingInput {
  actor: string;
  platform: string;
  externalChannelId: string;
  externalThreadId: string;
  conversationId: string;
  mode?: RelayChannelBinding["mode"];
  metadata?: Record<string, unknown>;
}

export interface RequestRelayExternalDeliveryInput {
  actor: string;
  bindingId: string;
  conversationId: string;
  text: string;
  replyToEventId?: string;
}

export interface CompleteRelayExternalDeliveryInput {
  actor: string;
  deliveryId: string;
  bindingId: string;
  externalMessageId?: string;
}

function stableBindingKey(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function formatRelayExternalBindingChannel(
  platform: string,
  bindingId: string,
): string {
  return `${platform}:${bindingId}`;
}

export function parseRelayExternalBindingChannel(
  channel?: string,
): { platform: string; bindingId: string } | null {
  if (!channel) return null;
  const separator = channel.indexOf(":");
  if (separator <= 0 || separator === channel.length - 1) return null;

  return {
    platform: channel.slice(0, separator),
    bindingId: channel.slice(separator + 1),
  };
}

export function createRelayChannelBindingId(
  platform: string,
  externalThreadId: string,
  conversationId: string,
): string {
  return `${platform}-${stableBindingKey(externalThreadId)}-${stableBindingKey(conversationId)}`;
}

export async function findRelayChannelBindingByExternalThread(
  hub: string,
  platform: string,
  externalThreadId: string,
): Promise<RelayChannelBinding | null> {
  const bindings = await readProjectedRelayChannelBindings(hub);

  for (const binding of Object.values(bindings)) {
    if (
      binding.platform === platform &&
      binding.externalThreadId === externalThreadId
    ) {
      return binding;
    }
  }

  return null;
}

export async function upsertRelayChannelBinding(
  hub: string,
  input: UpsertRelayChannelBindingInput,
): Promise<RelayChannelBinding> {
  const existing = await findRelayChannelBindingByExternalThread(
    hub,
    input.platform,
    input.externalThreadId,
  );
  const bindingId = existing?.bindingId ?? createRelayChannelBindingId(
    input.platform,
    input.externalThreadId,
    input.conversationId,
  );
  const mode = input.mode ?? "bidirectional";
  const metadata = input.metadata ?? {};

  const unchanged = existing &&
    existing.externalChannelId === input.externalChannelId &&
    existing.conversationId === input.conversationId &&
    existing.mode === mode &&
    JSON.stringify(existing.metadata ?? {}) === JSON.stringify(metadata);

  if (!unchanged) {
    await appendRelayEvent(hub, {
      id: createRelayEventId("binding"),
      kind: "channel.binding.upserted",
      v: 1,
      ts: Math.floor(Date.now() / 1000),
      actor: input.actor,
      payload: {
        bindingId,
        platform: input.platform,
        externalChannelId: input.externalChannelId,
        externalThreadId: input.externalThreadId,
        conversationId: input.conversationId,
        mode,
        metadata,
      },
    });
  }

  return {
    bindingId,
    platform: input.platform,
    externalChannelId: input.externalChannelId,
    externalThreadId: input.externalThreadId,
    conversationId: input.conversationId,
    mode,
    metadata,
    updatedAt: Math.floor(Date.now() / 1000),
    actor: input.actor,
  };
}

export async function requestRelayExternalDelivery(
  hub: string,
  input: RequestRelayExternalDeliveryInput,
): Promise<string> {
  const deliveryId = createRelayEventId("delivery");

  await appendRelayEvent(hub, {
    id: createRelayEventId("event"),
    kind: "external.delivery.requested",
    v: 1,
    ts: Math.floor(Date.now() / 1000),
    actor: input.actor,
    payload: {
      deliveryId,
      bindingId: input.bindingId,
      conversationId: input.conversationId,
      text: input.text,
      replyToEventId: input.replyToEventId,
    },
  });

  return deliveryId;
}

export async function completeRelayExternalDelivery(
  hub: string,
  input: CompleteRelayExternalDeliveryInput,
): Promise<void> {
  await appendRelayEvent(hub, {
    id: createRelayEventId("event"),
    kind: "external.delivery.completed",
    v: 1,
    ts: Math.floor(Date.now() / 1000),
    actor: input.actor,
    payload: {
      deliveryId: input.deliveryId,
      bindingId: input.bindingId,
      externalMessageId: input.externalMessageId,
    },
  });
}

export async function queueRelayExternalDeliveryForChannel(
  hub: string,
  actor: string,
  channel: string | undefined,
  text: string,
  replyToEventId?: string,
): Promise<string | null> {
  const parsed = parseRelayExternalBindingChannel(channel);
  if (!parsed) return null;

  const bindings = await readProjectedRelayChannelBindings(hub);
  const binding = bindings[parsed.bindingId];
  if (!binding || binding.platform !== parsed.platform) {
    return null;
  }

  return requestRelayExternalDelivery(hub, {
    actor,
    bindingId: binding.bindingId,
    conversationId: binding.conversationId,
    text,
    replyToEventId,
  });
}
