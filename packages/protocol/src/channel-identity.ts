import type { MetadataMap, ScoutId } from "./common.js";

export const CHANNEL_ID_PREFIX = "c.";
export const CHANNEL_NATURAL_KEY_METADATA = "naturalKey";

export function mintChannelId(randomUuid: () => string): ScoutId {
  return `${CHANNEL_ID_PREFIX}${randomUuid().toLowerCase()}`;
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
