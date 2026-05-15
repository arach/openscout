/**
 * Fleet view — operator-scoped rollup of asks, attention items, and a
 * synthesized activity feed.
 *
 * Lifted from db-queries.ts as part of SCO-031 Phase C. The fleet
 * projection types (`FleetActivityRow`, `FleetAskRow`, `FleetAttentionRow`)
 * remain private to this module — they shape only the rows consumed
 * directly by the projection helpers below.
 *
 * The freshness predicate `isFreshActiveTimestamp` and its companion
 * `isStaleActiveFlight` were promoted to `internal/sql-helpers.ts` because
 * the runs domain (queryRuns) needs the same logic.
 */

import { resolveOperatorName } from "@openscout/runtime/user-config";

import { db } from "./internal/db.ts";
import { normalizeTimestampMs } from "./internal/parse.ts";
import { compact } from "./internal/paths.ts";
import {
  isExecutingFlightState,
  isStaleActiveFlight,
  sqlJoinClauses,
  sqlPlaceholders,
  sqlWhereClause,
  staleFlightActivityPredicate,
  summarizeAgentState,
} from "./internal/sql-helpers.ts";
import type {
  WebFleetActivity,
  WebFleetAsk,
  WebFleetAskStatus,
  WebFleetState,
} from "./types/web.ts";

/* ── Row projection types (private to this domain) ── */

type FleetActivityRow = {
  id: string;
  kind: string;
  ts: number;
  actor_name: string | null;
  title: string | null;
  summary: string | null;
  conversation_id: string | null;
  workspace_root: string | null;
  actor_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  message_id: string | null;
  invocation_id: string | null;
  flight_id: string | null;
  record_id: string | null;
  session_id: string | null;
};

type FleetAskRow = {
  invocation_id: string;
  requester_id: string;
  target_agent_id: string;
  agent_name: string | null;
  conversation_id: string | null;
  collaboration_record_id: string | null;
  task: string;
  created_at: number;
  flight_id: string | null;
  flight_state: string | null;
  flight_summary: string | null;
  started_at: number | null;
  completed_at: number | null;
  flight_dismissed_at: number | string | null;
  status_kind: string | null;
  status_title: string | null;
  status_summary: string | null;
  status_ts: number | string | null;
  harness: string | null;
  transport: string | null;
  endpoint_state: string | null;
  work_title: string | null;
  work_summary: string | null;
  work_state: string | null;
  acceptance_state: string | null;
  next_move_owner_id: string | null;
  work_updated_at: number | string | null;
};

type FleetAttentionRow = {
  record_kind: "question" | "work_item";
  record_id: string;
  title: string;
  summary: string | null;
  conversation_id: string | null;
  state: string;
  acceptance_state: string;
  updated_at: number;
  agent_id: string | null;
  agent_name: string | null;
};

function projectFleetActivity(row: FleetActivityRow): WebFleetActivity {
  return {
    id: row.id,
    kind: row.kind,
    ts: row.ts,
    actorName: row.actor_name,
    title: row.title,
    summary: row.summary,
    conversationId: row.conversation_id,
    workspaceRoot: compact(row.workspace_root),
    actorId: row.actor_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    flightId: row.flight_id,
    invocationId: row.invocation_id,
    messageId: row.message_id,
    recordId: row.record_id,
    sessionId: row.session_id,
  };
}

export function queryFleetActivity(opts?: {
  limit?: number;
  agentId?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
}): WebFleetActivity[] {
  const filters: string[] = [];
  const params: Array<string | number> = [];

  if (opts?.agentId) {
    filters.push(`(
      ai.agent_id = ?
      OR ai.actor_id = ?
      OR ai.record_id IN (
        SELECT cr.id
        FROM collaboration_records cr
        WHERE cr.owner_id = ?
          OR cr.next_move_owner_id = ?
      )
    )`);
    params.push(opts.agentId, opts.agentId, opts.agentId, opts.agentId);
  }
  if (opts?.sessionId) {
    filters.push("ai.session_id = ?");
    params.push(opts.sessionId);
  }
  if (opts?.conversationId) {
    filters.push("ai.conversation_id = ?");
    params.push(opts.conversationId);
  }

  const scopedFilters = sqlJoinClauses(filters, "OR");
  const sql = `SELECT
    ai.id,
    ai.kind,
    ai.ts,
    ac.display_name AS actor_name,
    ai.title,
    ai.summary,
    ai.conversation_id,
    ai.workspace_root,
    ai.actor_id,
    ai.agent_id,
    agent_actor.display_name AS agent_name,
    ai.message_id,
    ai.invocation_id,
    ai.flight_id,
    ai.record_id,
    ai.session_id
  FROM activity_items ai
  LEFT JOIN actors ac ON ac.id = ai.actor_id
  LEFT JOIN actors agent_actor ON agent_actor.id = ai.agent_id
  ${sqlWhereClause([
    staleFlightActivityPredicate("ai"),
    scopedFilters ? `(${scopedFilters})` : null,
  ])}
  ORDER BY ai.ts DESC
  LIMIT ?`;

  const rows = db().prepare(sql).all(...params, opts?.limit ?? 80) as Array<FleetActivityRow>;
  return rows.map(projectFleetActivity);
}

const TERMINAL_FLIGHT_STATES = new Set(["completed", "failed", "cancelled"]);
const FLEET_RECENT_COMPLETED_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function fleetRequesterIds(): string[] {
  const operatorName = resolveOperatorName().trim() || "operator";
  return Array.from(new Set([operatorName, "operator"]));
}

function fleetStatusLabel(status: WebFleetAskStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "working":
      return "Working";
    case "needs_attention":
      return "Needs your input";
    case "failed":
      return "Failed";
    default:
      return "Completed";
  }
}

export function queryFleetAskRows(requesterIds: string[], limit: number): FleetAskRow[] {
  const requesterClause = sqlPlaceholders(requesterIds.length);
  return db().prepare(
    `SELECT
       inv.id AS invocation_id,
       inv.requester_id,
       inv.target_agent_id,
       ac.display_name AS agent_name,
       inv.conversation_id,
       inv.collaboration_record_id,
       inv.task,
       inv.created_at,
       f.id AS flight_id,
       f.state AS flight_state,
       f.summary AS flight_summary,
       f.started_at,
       f.completed_at,
       json_extract(f.metadata_json, '$.operatorAttentionDismissedAt') AS flight_dismissed_at,
       latest_ai.kind AS status_kind,
       latest_ai.title AS status_title,
       latest_ai.summary AS status_summary,
       latest_ai.ts AS status_ts,
       ep.harness,
       ep.transport,
       ep.state AS endpoint_state,
       cr.title AS work_title,
       cr.summary AS work_summary,
       cr.state AS work_state,
       cr.acceptance_state,
       cr.next_move_owner_id,
       cr.updated_at AS work_updated_at
     FROM invocations inv
     LEFT JOIN actors ac ON ac.id = inv.target_agent_id
     LEFT JOIN flights f ON f.id = (
       SELECT f2.id
       FROM flights f2
       WHERE f2.invocation_id = inv.id
       ORDER BY COALESCE(f2.completed_at, f2.started_at, 0) DESC
       LIMIT 1
     )
     LEFT JOIN activity_items latest_ai ON latest_ai.id = (
       SELECT ai.id
       FROM activity_items ai
       WHERE ai.conversation_id = inv.conversation_id
         AND ai.agent_id = inv.target_agent_id
         AND ai.kind IN ('ask_replied', 'ask_failed', 'ask_working', 'status_message')
         AND ai.ts >= inv.created_at
       ORDER BY ai.ts DESC
       LIMIT 1
     )
     LEFT JOIN agent_endpoints ep ON ep.id = (
       SELECT ep2.id
       FROM agent_endpoints ep2
       WHERE ep2.agent_id = inv.target_agent_id
       ORDER BY ep2.updated_at DESC
       LIMIT 1
     )
     LEFT JOIN collaboration_records cr ON cr.id = inv.collaboration_record_id
     WHERE inv.requester_id IN (${requesterClause})
       AND NOT (
         COALESCE(f.state, '') = 'failed'
         AND COALESCE(f.error, '') LIKE 'Stale running flight reconciled:%'
       )
     ORDER BY COALESCE(f.completed_at, f.started_at, inv.created_at) DESC
     LIMIT ?`,
  ).all(...requesterIds, limit) as Array<FleetAskRow>;
}

function projectFleetAsk(row: FleetAskRow, requesterIdSet: Set<string>): WebFleetAsk {
  const hasFlight = typeof row.flight_id === "string" && row.flight_id.length > 0;
  const replied = row.status_kind === "ask_replied";
  const failed = row.flight_state === "failed" || row.status_kind === "ask_failed";
  const staleActiveFlight = hasFlight
    && row.flight_state !== null
    && !TERMINAL_FLIGHT_STATES.has(row.flight_state)
    && isStaleActiveFlight(row.started_at, row.created_at);
  const isActiveFlight = hasFlight
    && row.flight_state !== null
    && !TERMINAL_FLIGHT_STATES.has(row.flight_state)
    && !replied
    && !failed
    && !staleActiveFlight;
  const awaitingOperator = Boolean(
    (row.next_move_owner_id && requesterIdSet.has(row.next_move_owner_id))
    || row.acceptance_state === "pending",
  );

  const updatedAt = normalizeTimestampMs(
    row.status_ts ?? row.completed_at ?? row.started_at ?? row.work_updated_at ?? row.created_at,
  ) ?? Date.now();
  const dismissedAt = normalizeTimestampMs(row.flight_dismissed_at);
  const failedDismissed = Boolean(dismissedAt !== null && dismissedAt >= updatedAt);

  let status: WebFleetAskStatus;
  if (!hasFlight) {
    status = "queued";
  } else if (isActiveFlight) {
    status = "working";
  } else if (awaitingOperator) {
    status = "needs_attention";
  } else if (failed || staleActiveFlight) {
    status = "failed";
  } else {
    status = "completed";
  }

  return {
    invocationId: row.invocation_id,
    flightId: row.flight_id,
    agentId: row.target_agent_id,
    agentName: row.agent_name,
    conversationId: row.conversation_id,
    collaborationRecordId: row.collaboration_record_id,
    task: row.task,
    status,
    statusLabel: fleetStatusLabel(status),
    attention: status === "needs_attention" ? "badge" : status === "failed" && !failedDismissed ? "interrupt" : "silent",
    agentState: summarizeAgentState(row.endpoint_state, isExecutingFlightState(row.flight_state)),
    harness: row.harness,
    transport: row.transport,
    summary: row.status_summary ?? row.status_title ?? row.flight_summary ?? row.work_summary ?? row.work_title ?? null,
    startedAt: normalizeTimestampMs(row.started_at ?? row.created_at),
    completedAt: normalizeTimestampMs(row.completed_at),
    updatedAt,
  };
}

export function queryFleetAttentionRows(requesterIds: string[], limit: number): FleetAttentionRow[] {
  const requesterClause = sqlPlaceholders(requesterIds.length);
  return db().prepare(
    `SELECT
       cr.kind AS record_kind,
       cr.id AS record_id,
       cr.title,
       cr.summary,
       cr.conversation_id,
       cr.state,
       cr.acceptance_state,
       cr.updated_at,
       cr.owner_id AS agent_id,
       owner.display_name AS agent_name
     FROM collaboration_records cr
     LEFT JOIN actors owner ON owner.id = cr.owner_id
     WHERE (
         (cr.kind = 'work_item' AND cr.state IN ('open', 'working', 'waiting', 'review'))
         OR (cr.kind = 'question' AND cr.state IN ('open', 'answered'))
       )
       AND (
         cr.next_move_owner_id IN (${requesterClause})
         OR (
           cr.acceptance_state = 'pending'
           AND NOT EXISTS (
             SELECT 1
             FROM collaboration_events e
             WHERE e.record_id = cr.id
               AND e.created_at > cr.updated_at
           )
           AND NOT EXISTS (
             SELECT 1
             FROM flights f
             JOIN invocations inv ON inv.id = f.invocation_id
             WHERE inv.collaboration_record_id = cr.id
               AND COALESCE(f.completed_at, f.started_at, 0) > cr.updated_at
           )
           AND NOT EXISTS (
             SELECT 1
             FROM messages m
             WHERE m.conversation_id = cr.conversation_id
               AND m.actor_id = cr.owner_id
               AND m.created_at > cr.updated_at
           )
         )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM collaboration_events dismissed
         WHERE dismissed.record_id = cr.id
           AND dismissed.kind = 'dismissed'
           AND dismissed.actor_id IN (${requesterClause})
           AND dismissed.created_at >= cr.updated_at
       )
     ORDER BY cr.updated_at DESC
     LIMIT ?`,
  ).all(...requesterIds, ...requesterIds, limit) as Array<FleetAttentionRow>;
}

export function queryFleet(opts?: {
  limit?: number;
  activityLimit?: number;
}): WebFleetState {
  const limit = opts?.limit ?? 12;
  const activityLimit = opts?.activityLimit ?? 80;
  const requesterIds = fleetRequesterIds();
  const requesterIdSet = new Set(requesterIds);
  const asks = queryFleetAskRows(requesterIds, Math.max(limit * 3, 24)).map((row) => projectFleetAsk(row, requesterIdSet));
  const activeAsks = asks
    .filter((ask) => ask.status === "queued" || ask.status === "working")
    .slice(0, limit);
  const recentCompleted = asks
    .filter((ask) => ask.status === "completed" || (ask.status === "failed" && ask.attention !== "silent"))
    .filter((ask) => Date.now() - ask.updatedAt <= FLEET_RECENT_COMPLETED_MAX_AGE_MS)
    .slice(0, limit);
  const needsAttention = queryFleetAttentionRows(requesterIds, limit).map((row) => ({
    kind: row.record_kind,
    recordId: row.record_id,
    title: row.title,
    summary: row.summary,
    agentId: row.agent_id,
    agentName: row.agent_name,
    conversationId: row.conversation_id,
    state: row.state,
    acceptanceState: row.acceptance_state,
    updatedAt: normalizeTimestampMs(row.updated_at) ?? Date.now(),
  }));
  const activity = queryFleetActivity({ limit: activityLimit });

  return {
    generatedAt: Date.now(),
    totals: {
      active: activeAsks.length,
      recentCompleted: recentCompleted.length,
      needsAttention: needsAttention.length,
      activity: activity.length,
    },
    activeAsks,
    recentCompleted,
    needsAttention,
    activity,
  };
}
