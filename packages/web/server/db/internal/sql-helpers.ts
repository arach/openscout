/**
 * SQL builders, predicate clauses, and shared row projections used by the
 * web server's direct reads. Lifted from db-queries.ts as part of SCO-031
 * Phase A.
 *
 * Per the SCO-031 plan, the domain-aware helpers `projectWorkItemRow` and
 * `workAttention` live here for Phase A; they will move to a future
 * `db/work.ts` in Phase C alongside the work-item queries.
 */

import type { WebActivityItem, WebWorkItem } from "../../db-queries.ts";

import { db } from "./db.ts";
import { coerceNumber } from "./parse.ts";

/* ── Shared internal types ── */

export type WorkAttention = "silent" | "badge" | "interrupt";
export type AgentSummaryState = "offline" | "available" | "working";
export type SqlClause = string | null | undefined | false;

/* ── SQL clause builders ── */

export function sqlJoinClauses(clauses: SqlClause[], operator: "AND" | "OR" = "AND"): string {
  return clauses.filter((clause): clause is string => Boolean(clause)).join(` ${operator} `);
}

export function sqlWhereClause(clauses: SqlClause[], operator: "AND" | "OR" = "AND"): string {
  const joined = sqlJoinClauses(clauses, operator);
  return joined ? `WHERE ${joined}` : "";
}

export function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function sqlQuoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlStringList(values: readonly string[]): string {
  return `(${values.map(sqlQuoteLiteral).join(",")})`;
}

/* ── Agent endpoint join + flight predicates ── */

export const LATEST_AGENT_ENDPOINT_JOIN = `LEFT JOIN agent_endpoints ep ON ep.id = (
  SELECT ep2.id
  FROM agent_endpoints ep2
  WHERE ep2.agent_id = a.id
  ORDER BY ep2.updated_at DESC
  LIMIT 1
)`;

export function isExecutingFlightState(state: string | null): boolean {
  return state === "running";
}

export function queryExecutingAgentIds(): Set<string> {
  return new Set(
    (db().prepare(
      `SELECT DISTINCT target_agent_id FROM flights
       WHERE state = 'running'`,
    ).all() as Array<{ target_agent_id: string }>).map((row) => row.target_agent_id),
  );
}

export function activeAgentMetadataPredicate(alias: string): string {
  return `COALESCE(json_extract(${alias}.metadata_json, '$.retiredFromFleet'), 0) != 1
    AND COALESCE(json_extract(${alias}.metadata_json, '$.staleLocalRegistration'), 0) != 1`;
}

export function summarizeAgentState(
  rawState: string | null,
  isWorking: boolean,
  wakePolicy?: string | null,
): AgentSummaryState {
  if (isWorking) {
    return "working";
  }
  if (rawState === "offline" && wakePolicy === "on_demand") {
    return "available";
  }
  return rawState && rawState !== "offline" ? "available" : "offline";
}

export function summarizeAgentStatusLabel(
  rawState: string | null,
  isWorking: boolean,
  wakePolicy?: string | null,
): string {
  switch (summarizeAgentState(rawState, isWorking, wakePolicy)) {
    case "working":
      return "Working";
    case "available":
      return "Available";
    default:
      return "Offline";
  }
}

/* ── Activity / work state constants and predicates ── */

export const ACTIVE_FLIGHT_STATES_SQL = sqlStringList(["running", "waking", "waiting", "queued"]);
export const ACTIVE_FLIGHT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const EPOCH_MILLISECONDS_FLOOR = 1_000_000_000_000;
export const ACTIVE_WORK_STATES_SQL = sqlStringList(["open", "working", "waiting", "review"]);

export function isDuplicateActivityFeedItem(
  previous: WebActivityItem | null,
  next: WebActivityItem,
): boolean {
  if (!previous) {
    return false;
  }
  return previous.kind === next.kind
    && previous.title === next.title
    && previous.summary === next.summary
    && previous.conversationId === next.conversationId
    && Math.abs(previous.ts - next.ts) <= 5_000;
}

export function transientBrokerWorkingStatusPredicate(alias: string): string {
  return `NOT (
    ${alias}.class = 'status'
    AND COALESCE(json_extract(${alias}.metadata_json, '$.source'), '') = 'broker'
    AND ${alias}.body LIKE '% is working.'
  )`;
}

export function staleFlightActivityPredicate(alias: string): string {
  return `NOT (
    ${alias}.kind = 'flight_updated'
    AND COALESCE(${alias}.summary, '') LIKE 'Stale running flight reconciled:%'
  )`;
}

/* ── Work-item phase + attention helpers ── */

export function workPhaseFromFlightState(state: string | null): string | null {
  switch (state) {
    case "queued":
      return "Queued";
    case "waking":
      return "Waking";
    case "waiting":
      return "Waiting";
    case "running":
      return "Working";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return null;
  }
}

export function workPhaseFromState(state: string): string {
  switch (state) {
    case "open":
      return "Open";
    case "working":
      return "Working";
    case "waiting":
      return "Waiting";
    case "review":
      return "In review";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
    default:
      return state.replace(/_/g, " ");
  }
}

export function workAttention(row: {
  updated_at: number;
  state: string;
  acceptance_state: string;
  latest_flight_state: string | null;
  latest_flight_at: number | string | null;
  latest_dismissed_at: number | string | null;
}): WorkAttention {
  const dismissedAt = coerceNumber(row.latest_dismissed_at);
  const updatedAt = coerceNumber(row.updated_at) ?? 0;
  const latestFlightAt = coerceNumber(row.latest_flight_at);
  const failedFlightDismissed = Boolean(
    dismissedAt !== null
    && dismissedAt >= (latestFlightAt ?? updatedAt),
  );
  const recordAttentionDismissed = Boolean(
    dismissedAt !== null
    && dismissedAt >= updatedAt,
  );

  if (row.latest_flight_state === "failed" && !failedFlightDismissed) {
    return "interrupt";
  }
  if (
    !recordAttentionDismissed
    && (row.state === "waiting" || row.state === "review" || row.acceptance_state === "pending")
  ) {
    return "badge";
  }
  return "silent";
}

export function projectWorkItemRow(row: {
  id: string;
  title: string;
  summary: string | null;
  owner_id: string | null;
  owner_name: string | null;
  next_move_owner_id: string | null;
  next_move_owner_name: string | null;
  conversation_id: string | null;
  created_at?: number;
  state: string;
  acceptance_state: string;
  priority: string | null;
  updated_at: number;
  parent_id?: string | null;
  parent_title?: string | null;
  active_child_work_count: number;
  active_flight_count: number;
  active_flight_state: string | null;
  active_flight_summary: string | null;
  latest_flight_state: string | null;
  latest_flight_at: number | string | null;
  latest_dismissed_at: number | string | null;
  latest_event_summary: string | null;
  latest_event_at: number | string | null;
  progress_summary: string | null;
}): WebWorkItem {
  const updatedAt = coerceNumber(row.updated_at) ?? 0;
  const latestFlightAt = coerceNumber(row.latest_flight_at);
  const latestEventAt = coerceNumber(row.latest_event_at);
  const currentPhase = workPhaseFromFlightState(row.active_flight_state)
    ?? (row.latest_flight_state === "failed" ? "Failed" : workPhaseFromState(row.state));
  const attention = workAttention(row);

  const candidates = [
    {
      at: latestEventAt,
      summary: row.latest_event_summary,
    },
    {
      at: latestFlightAt,
      summary: row.active_flight_summary ?? workPhaseFromFlightState(row.latest_flight_state),
    },
    {
      at: updatedAt,
      summary: row.progress_summary ?? row.summary ?? row.title,
    },
  ].filter((candidate): candidate is { at: number; summary: string | null } => typeof candidate.at === "number");

  candidates.sort((left, right) => right.at - left.at);
  const latest = candidates[0] ?? { at: updatedAt, summary: row.summary ?? row.title };

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    nextMoveOwnerId: row.next_move_owner_id,
    nextMoveOwnerName: row.next_move_owner_name,
    conversationId: row.conversation_id,
    createdAt: coerceNumber(row.created_at ?? row.updated_at) ?? updatedAt,
    updatedAt,
    parentId: row.parent_id ?? null,
    parentTitle: row.parent_title ?? null,
    state: row.state,
    acceptanceState: row.acceptance_state,
    priority: row.priority,
    currentPhase,
    attention,
    activeChildWorkCount: row.active_child_work_count ?? 0,
    activeFlightCount: row.active_flight_count ?? 0,
    lastMeaningfulAt: latest.at,
    lastMeaningfulSummary: latest.summary,
  };
}
