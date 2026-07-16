import { brokerAttemptTone } from "../../lib/status-tone.ts";
import type { BrokerRouteAttempt } from "../../lib/types.ts";

const FAILURE_DETAIL_CHARS = 220;
const SUCCESS_DETAIL_CHARS = 92;

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeFingerprintPart(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 220);
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = readString(metadata?.[key]);
    if (value) return value;
  }
  return null;
}

function rawDeliveryMetadata(attempt: BrokerRouteAttempt): Record<string, unknown> | null {
  const metadata = attempt.metadata ?? {};
  const raw = readRecord(metadata.raw);
  const delivery = readRecord(raw?.delivery);
  return readRecord(delivery?.metadata);
}

export function clippedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function brokerAttemptIsFailure(attempt: BrokerRouteAttempt): boolean {
  return brokerAttemptTone(attempt.kind, attempt.status) === "danger"
    || attempt.status === "error";
}

export function brokerAttemptDetailLimit(attempt: BrokerRouteAttempt): number {
  return brokerAttemptIsFailure(attempt) ? FAILURE_DETAIL_CHARS : SUCCESS_DETAIL_CHARS;
}

export function brokerAttemptErrorSummary(attempt: BrokerRouteAttempt): string | null {
  if (!brokerAttemptIsFailure(attempt)) return null;

  const metadata = attempt.metadata ?? {};
  const reason = readString(metadata.reason) ?? readString(metadata.error);
  const dispatchKind = readString(metadata.dispatchKind);
  const requestedLabel = readString(metadata.requestedLabel);

  const parts: string[] = [];
  if (dispatchKind) parts.push(dispatchKind);
  if (attempt.status && attempt.status !== "failed" && attempt.status !== "error") {
    parts.push(attempt.status);
  }
  if (reason && reason !== attempt.detail.trim()) parts.push(reason);
  if (requestedLabel && !attempt.detail.includes(requestedLabel)) parts.push(`asked ${requestedLabel}`);

  return parts.length > 0 ? [...new Set(parts)].join(" · ") : null;
}

export function formatMetadataScalar(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

const METADATA_SUMMARY_KEYS = [
  "source",
  "deliveryId",
  "messageId",
  "conversationId",
  "invocationId",
  "dispatchKind",
  "reason",
  "error",
  "requestedLabel",
  "requesterId",
  "targetId",
  "transport",
  "failureReason",
  "failureDetail",
  "reconciledReason",
  "attempt",
  "class",
  "actorId",
  "dispatchId",
  "attemptId",
] as const;

export type BrokerMetadataSummaryEntry = {
  key: string;
  value: string;
};

export function brokerMetadataSummary(
  metadata: Record<string, unknown> | null | undefined,
): BrokerMetadataSummaryEntry[] {
  if (!metadata) return [];

  const entries: BrokerMetadataSummaryEntry[] = [];
  const seen = new Set<string>();

  for (const key of METADATA_SUMMARY_KEYS) {
    if (!(key in metadata) || !isScalar(metadata[key])) continue;
    entries.push({ key, value: formatMetadataScalar(metadata[key]) });
    seen.add(key);
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (key === "raw" || seen.has(key) || !isScalar(value)) continue;
    entries.push({ key, value: formatMetadataScalar(value) });
  }

  return entries;
}

export function brokerAttemptDedupeFingerprint(attempt: BrokerRouteAttempt): string {
  const metadata = attempt.metadata ?? {};
  const messageId = attempt.messageId ?? metadataString(metadata, "messageId");
  const target = attempt.target ?? metadataString(metadata, "targetId");
  const transport = attempt.route ?? metadataString(metadata, "transport");
  if (attempt.kind === "failed_delivery" && messageId && target && transport) {
    return ["failed_delivery", messageId, target, transport].join("|");
  }

  return [
    attempt.kind,
    messageId ?? attempt.deliveryId ?? attempt.invocationId ?? attempt.id,
    target,
    transport,
    metadataString(metadata, "failureReason", "reconciledReason", "reason", "error") ?? attempt.detail,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(normalizeFingerprintPart)
    .join("|");
}

export function brokerAttemptRootCauseFingerprint(attempt: BrokerRouteAttempt): string {
  const metadata = attempt.metadata ?? {};
  const deliveryMetadata = rawDeliveryMetadata(attempt);
  return [
    attempt.kind,
    attempt.target ?? metadataString(metadata, "targetId"),
    attempt.route ?? metadataString(metadata, "transport"),
    metadataString(metadata, "failureReason", "reconciledReason", "error")
      ?? metadataString(deliveryMetadata, "failureReason", "reconciledReason", "error")
      ?? attempt.status,
    metadataString(metadata, "failureDetail")
      ?? metadataString(deliveryMetadata, "failureDetail")
      ?? metadataString(metadata, "reason")
      ?? attempt.detail,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => normalizeFingerprintPart(value).toLowerCase())
    .join("|");
}

export function brokerAttemptContextJson(attempt: BrokerRouteAttempt): Record<string, unknown> {
  return {
    copiedAt: new Date().toISOString(),
    dedupeFingerprint: brokerAttemptDedupeFingerprint(attempt),
    rootCauseFingerprint: brokerAttemptRootCauseFingerprint(attempt),
    sourceEndpoint: "/api/broker?limit=160",
    reviewEndpoint: "/api/broker/dispatch-review",
    attempt,
  };
}

export function brokerAttemptContextText(attempt: BrokerRouteAttempt): string {
  const context = brokerAttemptContextJson(attempt);
  const lines = [
    "OpenScout dispatch failure context",
    "",
    `id: ${attempt.id}`,
    `kind: ${attempt.kind}`,
    `status: ${attempt.status}`,
    `time: ${new Date(attempt.ts).toISOString()}`,
    `target: ${attempt.target ?? "none"}`,
    `transport/route: ${attempt.route ?? "none"}`,
    `messageId: ${attempt.messageId ?? "none"}`,
    `deliveryId: ${attempt.deliveryId ?? "none"}`,
    `invocationId: ${attempt.invocationId ?? "none"}`,
    `conversationId: ${attempt.conversationId ?? "none"}`,
    `detail: ${attempt.detail}`,
    `dedupeFingerprint: ${context.dedupeFingerprint}`,
    `rootCauseFingerprint: ${context.rootCauseFingerprint}`,
    "",
    "Full JSON:",
    JSON.stringify(context, null, 2),
  ];
  return lines.join("\n");
}

export function brokerMetadataPayload(
  metadata: Record<string, unknown> | null | undefined,
): unknown | null {
  if (!metadata) return null;
  if (metadata.raw !== undefined && metadata.raw !== null) return metadata.raw;

  const nested = Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => key !== "raw" && !isScalar(value)),
  );
  return Object.keys(nested).length > 0 ? nested : null;
}

export function brokerMetadataJson(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return "{}";
  return JSON.stringify(metadata, null, 2);
}
