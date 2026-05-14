/**
 * SQL builders, predicate clauses, and shared activity helpers used by the
 * web server's direct reads. Lifted from db-queries.ts in SCO-031 Phase A.
 *
 * Domain-specific projections (e.g. `projectWorkItemRow`) live in their
 * domain files (e.g. `../work.ts`). Only cross-domain SQL plumbing and
 * row helpers belong here.
 */

import type { AgentSummaryState } from "../types/common.ts";
import type { WebActivityItem } from "../types/web.ts";

import { db } from "./db.ts";
import { normalizeTimestampMs } from "./parse.ts";

/* ── Internal-only SQL helper types ── */

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

/** Active-flight freshness — shared between runs and fleet projections. */
export function isFreshActiveTimestamp(timestamp: number): boolean {
  return timestamp < EPOCH_MILLISECONDS_FLOOR || Date.now() - timestamp <= ACTIVE_FLIGHT_MAX_AGE_MS;
}

export function isStaleActiveFlight(startedAt: number | null, createdAt: number): boolean {
  const timestamp = normalizeTimestampMs(startedAt ?? createdAt) ?? createdAt;
  return !isFreshActiveTimestamp(timestamp);
}

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

