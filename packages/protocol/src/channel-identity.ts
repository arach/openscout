import type { MetadataMap, ScoutId } from "./common.js";

export const CHANNEL_ID_PREFIX = "chn-";
export const CHAT_ID_PREFIX = CHANNEL_ID_PREFIX;
export const LEGACY_CHAT_ID_PREFIX = "chat_";
export const LEGACY_CHANNEL_ID_PREFIX = "c.";
export const CHANNEL_NATURAL_KEY_METADATA = "naturalKey";

export function mintChannelId(randomUuid: () => string): ScoutId {
  return `${CHAT_ID_PREFIX}${randomUuid().toLowerCase().replace(/-/g, "")}`;
}

export function isOpaqueChannelId(value: string | null | undefined): value is ScoutId {
  if (typeof value !== "string") return false;
  return (
    value.startsWith(CHAT_ID_PREFIX) && value.length > CHAT_ID_PREFIX.length
  ) || (
    value.startsWith(LEGACY_CHAT_ID_PREFIX)
    && value.length > LEGACY_CHAT_ID_PREFIX.length
  ) || (
    value.startsWith(LEGACY_CHANNEL_ID_PREFIX)
    && value.length > LEGACY_CHANNEL_ID_PREFIX.length
  );
}

export function directChannelNaturalKey(participantIds: ScoutId[]): string {
  return `direct:${stableIdentityParts(participantIds).join(",")}`;
}

export function namedChannelNaturalKey(channel: string): string {
  return `channel:${encodeIdentityPart(channel.trim().toLowerCase() || "shared")}`;
}

export function systemChannelNaturalKey(name: string): string {
  return `system:${encodeIdentityPart(name.trim().toLowerCase() || "system")}`;
}

export function channelNaturalKeyFromMetadata(
  metadata: MetadataMap | undefined,
): string | null {
  const value = metadata?.[CHANNEL_NATURAL_KEY_METADATA];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableIdentityParts(values: ScoutId[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .sort()
    .map(encodeIdentityPart);
}

function encodeIdentityPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
