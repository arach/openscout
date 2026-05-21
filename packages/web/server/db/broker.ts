/**
 * Broker diagnostics — surfaces routing successes/failures, delivery
 * attempts, and recent dialogue for the operator console.
 *
 * Lifted from db-queries.ts as part of SCO-031 Phase C. Helper predicates
 * for metadata shape (`metadataTarget`, `metadataRoute`,
 * `isBrokerRoutedMessage`, `shortBrokerBody`) are kept private to this
 * module — they are only used by `queryBrokerDiagnostics`.
 */

import { db } from "./internal/db.ts";
import { sqlTimestampMsExpression } from "./internal/sql-helpers.ts";
import { normalizeTimestampMs, parseJson } from "./internal/parse.ts";
import type {
  WebBrokerDialogueItem,
  WebBrokerDiagnostics,
  WebBrokerRouteAttempt,
} from "./types/web.ts";

function metadataTarget(metadata: Record<string, unknown> | null): string | null {
  const relayTarget = metadata?.relayTarget;
  if (typeof relayTarget === "string" && relayTarget.trim()) {
    return relayTarget.trim();
  }
  const targets = metadata?.relayTargetIds;
  if (Array.isArray(targets)) {
    const rendered = targets
      .map((target) => typeof target === "string" ? target.trim() : "")
      .filter(Boolean);
    return rendered.length > 0 ? rendered.join(", ") : null;
  }
  return null;
}

function metadataRoute(metadata: Record<string, unknown> | null): string | null {
  const relayChannel = metadata?.relayChannel;
  return typeof relayChannel === "string" && relayChannel.trim()
    ? relayChannel.trim()
    : null;
}

function isBrokerRoutedMessage(metadata: Record<string, unknown> | null): boolean {
  return metadata?.source === "scout-cli"
    || typeof metadata?.relayTarget === "string"
    || Array.isArray(metadata?.relayTargetIds)
    || typeof metadata?.relayChannel === "string";
}

function shortBrokerBody(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

export function queryBrokerDiagnostics(opts?: {
  limit?: number;
  windowMs?: number;
}): WebBrokerDiagnostics {
  const limit = opts?.limit ?? 120;
  const windowMs = opts?.windowMs ?? 24 * 60 * 60_000;
  const now = Date.now();
  const since = now - windowMs;
  const messageCreatedAtExpression = sqlTimestampMsExpression("m.created_at");
  const deliveryCreatedAtExpression = sqlTimestampMsExpression("d.created_at");
  const attemptCreatedAtExpression = sqlTimestampMsExpression("da.created_at");

  const messageRows = db()
    .prepare(
      `SELECT
         m.id,
         m.conversation_id,
         m.actor_id,
         ac.display_name AS actor_name,
         m.body,
         m.class,
         m.metadata_json,
         m.created_at
       FROM messages m
       LEFT JOIN actors ac ON ac.id = m.actor_id
       WHERE ${messageCreatedAtExpression} >= ?
       ORDER BY ${messageCreatedAtExpression} DESC
       LIMIT ?`,
    )
    .all(since, Math.max(limit * 2, 200)) as Array<{
    id: string;
    conversation_id: string;
    actor_id: string;
    actor_name: string | null;
    body: string;
    class: string;
    metadata_json: string | null;
    created_at: number;
  }>;

  const dialogue: WebBrokerDialogueItem[] = messageRows.slice(0, limit).map((row) => ({
    id: row.id,
    ts: normalizeTimestampMs(row.created_at) ?? row.created_at,
    actorName: row.actor_name ?? row.actor_id,
    conversationId: row.conversation_id,
    body: row.body,
    class: row.class,
  }));

  const successfulDispatches: WebBrokerRouteAttempt[] = messageRows
    .map((row): WebBrokerRouteAttempt | null => {
      const metadata = parseJson<Record<string, unknown> | null>(row.metadata_json, null);
      if (!isBrokerRoutedMessage(metadata)) {
        return null;
      }
      const ts = normalizeTimestampMs(row.created_at) ?? row.created_at;
      return {
        id: `message:${row.id}`,
        kind: "success" as const,
        status: "sent",
        ts,
        actorName: row.actor_name ?? row.actor_id,
        target: metadataTarget(metadata),
        route: metadataRoute(metadata) ?? (row.conversation_id.startsWith("dm.") ? "dm" : "channel"),
        detail: shortBrokerBody(row.body),
        conversationId: row.conversation_id,
        messageId: row.id,
        deliveryId: null,
        invocationId: null,
        metadata: {
          source: "messages",
          actorId: row.actor_id,
          class: row.class,
          raw: metadata,
        },
      };
    })
    .filter((item): item is WebBrokerRouteAttempt => item !== null);

  const dispatchRows = db()
    .prepare(
      `SELECT
         sd.id,
         sd.kind,
         sd.asked_label,
         sd.detail,
         sd.invocation_id,
         sd.conversation_id,
         sd.requester_id,
         ac.display_name AS actor_name,
         sd.dispatched_at
       FROM scout_dispatches sd
       LEFT JOIN actors ac ON ac.id = sd.requester_id
       WHERE sd.dispatched_at >= ?
       ORDER BY sd.dispatched_at DESC
       LIMIT ?`,
    )
    .all(since, limit) as Array<{
    id: string;
    kind: string;
    asked_label: string;
    detail: string;
    invocation_id: string | null;
    conversation_id: string | null;
    requester_id: string | null;
    actor_name: string | null;
    dispatched_at: number;
  }>;

  const failedQueries: WebBrokerRouteAttempt[] = dispatchRows.map((row) => ({
    id: `dispatch:${row.id}`,
    kind: "failed_query",
    status: row.kind,
    ts: normalizeTimestampMs(row.dispatched_at) ?? row.dispatched_at,
    actorName: row.actor_name ?? row.requester_id,
    target: row.asked_label,
    route: null,
    detail: row.detail,
    conversationId: row.conversation_id,
    messageId: null,
    deliveryId: null,
    invocationId: row.invocation_id,
    metadata: {
      source: "scout_dispatches",
      dispatchId: row.id,
      dispatchKind: row.kind,
      requestedLabel: row.asked_label,
      requesterId: row.requester_id,
    },
  }));

  const deliveryRows = db()
    .prepare(
      `SELECT
         d.id,
         d.message_id,
         d.invocation_id,
         d.target_id,
         d.transport,
         d.reason,
         d.status,
         d.created_at,
         m.conversation_id,
         ac.display_name AS actor_name
       FROM deliveries d
       LEFT JOIN messages m ON m.id = d.message_id
       LEFT JOIN actors ac ON ac.id = d.target_id
       WHERE ${deliveryCreatedAtExpression} >= ?
       ORDER BY ${deliveryCreatedAtExpression} DESC
       LIMIT ?`,
    )
    .all(since, limit) as Array<{
    id: string;
    message_id: string | null;
    invocation_id: string | null;
    target_id: string;
    transport: string;
    reason: string;
    status: string;
    created_at: number;
    conversation_id: string | null;
    actor_name: string | null;
  }>;

  const failedDeliveryStatuses = new Set(["failed", "cancelled"]);
  const failedDeliveries: WebBrokerRouteAttempt[] = deliveryRows
    .filter((row) => failedDeliveryStatuses.has(row.status))
    .map((row) => ({
      id: `delivery:${row.id}`,
      kind: "failed_delivery",
      status: row.status,
      ts: normalizeTimestampMs(row.created_at) ?? row.created_at,
      actorName: row.actor_name,
      target: row.target_id,
      route: row.transport,
      detail: row.reason,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      deliveryId: row.id,
      invocationId: row.invocation_id,
      metadata: {
        source: "deliveries",
        targetId: row.target_id,
        transport: row.transport,
        reason: row.reason,
      },
    }));

  const attemptRows = db()
    .prepare(
      `SELECT
         da.id,
         da.delivery_id,
         da.attempt,
         da.status,
         da.error,
         da.created_at,
         d.target_id,
         d.transport,
         d.message_id,
         d.invocation_id,
         m.conversation_id,
         ac.display_name AS actor_name
       FROM delivery_attempts da
       JOIN deliveries d ON d.id = da.delivery_id
       LEFT JOIN messages m ON m.id = d.message_id
       LEFT JOIN actors ac ON ac.id = d.target_id
       WHERE ${attemptCreatedAtExpression} >= ?
       ORDER BY ${attemptCreatedAtExpression} DESC
       LIMIT ?`,
    )
    .all(since, limit) as Array<{
    id: string;
    delivery_id: string;
    attempt: number;
    status: string;
    error: string | null;
    created_at: number;
    target_id: string;
    transport: string;
    message_id: string | null;
    invocation_id: string | null;
    conversation_id: string | null;
    actor_name: string | null;
  }>;

  const deliveryAttempts: WebBrokerRouteAttempt[] = attemptRows.map((row) => ({
    id: `attempt:${row.id}`,
    kind: "delivery_attempt",
    status: row.status,
    ts: normalizeTimestampMs(row.created_at) ?? row.created_at,
    actorName: row.actor_name,
    target: row.target_id,
    route: row.transport,
    detail: row.error ?? `attempt ${row.attempt}`,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    deliveryId: row.delivery_id,
    invocationId: row.invocation_id,
    metadata: {
      source: "delivery_attempts",
      attemptId: row.id,
      attempt: row.attempt,
      targetId: row.target_id,
      transport: row.transport,
      error: row.error,
    },
  }));

  const attempts = [
    ...successfulDispatches,
    ...failedQueries,
    ...failedDeliveries,
    ...deliveryAttempts,
  ]
    .sort((left, right) => right.ts - left.ts)
    .slice(0, limit);
  const failedDeliveryAttempts = deliveryAttempts.filter((attempt) => attempt.status === "failed").length;
  const hours = Math.max(windowMs / 3_600_000, 1);
  const failureCount = failedQueries.length + failedDeliveries.length + failedDeliveryAttempts;
  const attemptCount = successfulDispatches.length + failureCount;

  return {
    generatedAt: now,
    windowMs,
    totals: {
      successfulDispatches: successfulDispatches.length,
      failedQueries: failedQueries.length,
      failedDeliveries: failedDeliveries.length,
      deliveryAttempts: deliveryAttempts.length,
      failedDeliveryAttempts,
      dialogueMessages: dialogue.length,
    },
    rates: {
      messagesPerHour: Number((dialogue.length / hours).toFixed(1)),
      failedQueriesPerHour: Number((failedQueries.length / hours).toFixed(1)),
      failedDeliveriesPerHour: Number(((failedDeliveries.length + failedDeliveryAttempts) / hours).toFixed(1)),
      failureRate: attemptCount > 0 ? Number((failureCount / attemptCount).toFixed(3)) : 0,
    },
    attempts,
    failedQueries,
    failedDeliveries,
    dialogue,
  };
}
