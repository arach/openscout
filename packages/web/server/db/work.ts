/**
 * Work-item queries — current state, child-work fan-out, timeline.
 *
 * Lifted from db-queries.ts as part of SCO-031 Phase C. `queryWorkItemById`
 * composes its detail page from the shallow record, the per-record flight
 * list (`queryFlights` from `./runs.ts`), and a synthesized timeline of
 * collaboration events plus flight start/complete markers. The shallow
 * helper `queryWorkItemShallow` is kept private — it is only used to flesh
 * out child-work entries.
 *
 * `projectWorkItemRow` + its phase/attention helpers live here (moved out of
 * `./internal/sql-helpers.ts` per codex review: domain logic belongs with
 * the domain, not in shared SQL plumbing).
 *
 * There is a small import cycle work.ts ↔ runs.ts (work needs
 * `queryFlights`, runs needs `queryWorkItemById`). It is safe because
 * neither reference is evaluated at module-init time; both are called
 * from function bodies that run after both modules have finished loading.
 */

import { db } from "./internal/db.ts";
import { configuredOperatorActorIds, conversationIdAliases } from "./internal/conversation-ids.ts";
import { coerceNumber } from "./internal/parse.ts";
import {
  ACTIVE_WORK_STATES_SQL,
  sqlJoinClauses,
  sqlPlaceholders,
  sqlWhereClause,
} from "./internal/sql-helpers.ts";
import { queryFlights } from "./runs.ts";
import type { WorkAttention } from "./types/common.ts";
import type {
  WebWorkDetail,
  WebWorkItem,
  WebWorkTimelineItem,
} from "./types/web.ts";

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

export function queryWorkItemById(id: string): WebWorkDetail | null {
  const operatorIds = configuredOperatorActorIds();
  const operatorClause = sqlPlaceholders(operatorIds.length);
  const sql = `SELECT
    cr.id,
    cr.title,
    cr.summary,
    cr.owner_id,
    owner.display_name AS owner_name,
    cr.next_move_owner_id,
    next.display_name AS next_move_owner_name,
    cr.conversation_id,
    cr.state,
    cr.acceptance_state,
    cr.priority,
    cr.created_at,
    cr.updated_at,
    cr.parent_id,
    parent.title AS parent_title,
    json_extract(cr.detail_json, '$.progress.summary') AS progress_summary,
    (
      SELECT COUNT(*)
      FROM collaboration_records child
      WHERE child.parent_id = cr.id
        AND child.kind = 'work_item'
        AND child.state IN ${ACTIVE_WORK_STATES_SQL}
    ) AS active_child_work_count,
    (
      SELECT COUNT(*)
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
        AND f.state NOT IN ('completed','failed','cancelled')
    ) AS active_flight_count,
    (
      SELECT f.state
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
        AND f.state NOT IN ('completed','failed','cancelled')
      ORDER BY COALESCE(f.started_at, f.completed_at, 0) DESC
      LIMIT 1
    ) AS active_flight_state,
    (
      SELECT f.summary
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
        AND f.state NOT IN ('completed','failed','cancelled')
      ORDER BY COALESCE(f.started_at, f.completed_at, 0) DESC
      LIMIT 1
    ) AS active_flight_summary,
    (
      SELECT f.state
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
      ORDER BY COALESCE(f.completed_at, f.started_at, 0) DESC
      LIMIT 1
    ) AS latest_flight_state,
    (
      SELECT COALESCE(f.completed_at, f.started_at)
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
      ORDER BY COALESCE(f.completed_at, f.started_at, 0) DESC
      LIMIT 1
    ) AS latest_flight_at,
    (
      SELECT e.summary
      FROM collaboration_events e
      WHERE e.record_id = cr.id
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_event_summary,
    (
      SELECT e.created_at
      FROM collaboration_events e
      WHERE e.record_id = cr.id
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_event_at,
    (
      SELECT e.created_at
      FROM collaboration_events e
      WHERE e.record_id = cr.id
        AND e.kind = 'dismissed'
        AND e.actor_id IN (${operatorClause})
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_dismissed_at
  FROM collaboration_records cr
  LEFT JOIN actors owner ON owner.id = cr.owner_id
  LEFT JOIN actors next ON next.id = cr.next_move_owner_id
  LEFT JOIN collaboration_records parent ON parent.id = cr.parent_id
  WHERE cr.kind = 'work_item' AND cr.id = ?
  LIMIT 1`;

  const row = db().prepare(sql).get(...operatorIds, id) as ({
    id: string;
    title: string;
    summary: string | null;
    owner_id: string | null;
    owner_name: string | null;
    next_move_owner_id: string | null;
    next_move_owner_name: string | null;
    conversation_id: string | null;
    state: string;
    acceptance_state: string;
    priority: string | null;
    created_at: number;
    updated_at: number;
    parent_id: string | null;
    parent_title: string | null;
    progress_summary: string | null;
    active_child_work_count: number;
    active_flight_count: number;
    active_flight_state: string | null;
    active_flight_summary: string | null;
    latest_flight_state: string | null;
    latest_flight_at: number | string | null;
    latest_dismissed_at: number | string | null;
    latest_event_summary: string | null;
    latest_event_at: number | string | null;
  }) | null;

  if (!row) return null;

  const base = projectWorkItemRow(row);

  const childWorkRows = db().prepare(
    `SELECT cr.id FROM collaboration_records cr
     WHERE cr.parent_id = ? AND cr.kind = 'work_item'
     ORDER BY cr.updated_at DESC
     LIMIT 50`,
  ).all(row.id) as Array<{ id: string }>;

  const childWork: WebWorkItem[] = childWorkRows
    .map((c) => queryWorkItemShallow(c.id))
    .filter((item): item is WebWorkItem => item !== null);

  const activeFlights = queryFlights({
    collaborationRecordId: row.id,
    activeOnly: true,
  });

  const timeline = queryWorkTimeline(row.id, {
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    nextMoveOwnerId: row.next_move_owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  return {
    ...base,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    parentId: row.parent_id,
    parentTitle: row.parent_title,
    childWork,
    activeFlights,
    timeline,
  };
}

export function queryWorkItemShallow(id: string): WebWorkItem | null {
  const operatorIds = configuredOperatorActorIds();
  const operatorClause = sqlPlaceholders(operatorIds.length);
  const sql = `SELECT
    cr.id,
    cr.title,
    cr.summary,
    cr.owner_id,
    owner.display_name AS owner_name,
    cr.next_move_owner_id,
    next.display_name AS next_move_owner_name,
    cr.conversation_id,
    cr.created_at,
    cr.state,
    cr.acceptance_state,
    cr.priority,
    cr.updated_at,
    cr.parent_id,
    parent.title AS parent_title,
    json_extract(cr.detail_json, '$.progress.summary') AS progress_summary,
    0 AS active_child_work_count,
    0 AS active_flight_count,
    NULL AS active_flight_state,
    NULL AS active_flight_summary,
    NULL AS latest_flight_state,
    NULL AS latest_flight_at,
    (
      SELECT e.created_at
      FROM collaboration_events e
      WHERE e.record_id = cr.id
        AND e.kind = 'dismissed'
        AND e.actor_id IN (${operatorClause})
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_dismissed_at,
    (
      SELECT e.summary
      FROM collaboration_events e
      WHERE e.record_id = cr.id
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_event_summary,
    (
      SELECT e.created_at
      FROM collaboration_events e
      WHERE e.record_id = cr.id
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_event_at
  FROM collaboration_records cr
  LEFT JOIN actors owner ON owner.id = cr.owner_id
  LEFT JOIN actors next ON next.id = cr.next_move_owner_id
  LEFT JOIN collaboration_records parent ON parent.id = cr.parent_id
  WHERE cr.kind = 'work_item' AND cr.id = ?
  LIMIT 1`;

  const row = db().prepare(sql).get(...operatorIds, id) as Parameters<typeof projectWorkItemRow>[0] | null;
  return row ? projectWorkItemRow(row) : null;
}

export function queryWorkTimeline(
  workId: string,
  context?: {
    conversationId?: string | null;
    ownerId?: string | null;
    nextMoveOwnerId?: string | null;
    createdAt?: number | null;
    updatedAt?: number | null;
  },
): WebWorkTimelineItem[] {
  const items: WebWorkTimelineItem[] = [];

  const events = db().prepare(
    `SELECT e.id, e.kind, e.summary, e.created_at, e.actor_id,
            ac.display_name AS actor_name
     FROM collaboration_events e
     LEFT JOIN actors ac ON ac.id = e.actor_id
     WHERE e.record_id = ?
     ORDER BY e.created_at DESC
     LIMIT 50`,
  ).all(workId) as Array<{
    id: string;
    kind: string;
    summary: string | null;
    created_at: number;
    actor_id: string | null;
    actor_name: string | null;
  }>;
  for (const e of events) {
    items.push({
      id: `event:${e.id}`,
      kind: "collaboration_event",
      at: e.created_at,
      actorId: e.actor_id,
      actorName: e.actor_name,
      title: e.kind.replace(/[._]/g, " "),
      summary: e.summary,
      detailKind: e.kind,
      flightId: null,
      messageId: null,
      conversationId: null,
    });
  }

  const explicitFlightIds = new Set<string>();
  const flights = db().prepare(
    `SELECT f.id, f.state, f.summary, f.started_at, f.completed_at,
            f.target_agent_id,
            ac.display_name AS agent_name
     FROM flights f
     JOIN invocations inv ON inv.id = f.invocation_id
     LEFT JOIN actors ac ON ac.id = f.target_agent_id
     WHERE inv.collaboration_record_id = ?
     ORDER BY COALESCE(f.completed_at, f.started_at, 0) DESC
     LIMIT 50`,
  ).all(workId) as Array<{
    id: string;
    state: string;
    summary: string | null;
    started_at: number | null;
    completed_at: number | null;
    target_agent_id: string;
    agent_name: string | null;
  }>;
  for (const f of flights) {
    explicitFlightIds.add(f.id);
    if (typeof f.started_at === "number") {
      items.push({
        id: `flight:${f.id}:started`,
        kind: "flight_started",
        at: f.started_at,
        actorId: f.target_agent_id,
        actorName: f.agent_name,
        title: "flight started",
        summary: f.summary,
        detailKind: f.state,
        flightId: f.id,
        messageId: null,
        conversationId: null,
      });
    }
    if (typeof f.completed_at === "number") {
      items.push({
        id: `flight:${f.id}:completed`,
        kind: "flight_completed",
        at: f.completed_at,
        actorId: f.target_agent_id,
        actorName: f.agent_name,
        title: `flight ${f.state}`,
        summary: f.summary,
        detailKind: f.state,
        flightId: f.id,
        messageId: null,
        conversationId: null,
      });
    }
  }

  if (flights.length === 0 && context?.conversationId) {
    const inferredFlights = queryInferredWorkTimelineFlights(context, explicitFlightIds);
    for (const f of inferredFlights) {
      if (typeof f.started_at === "number") {
        items.push({
          id: `inferred-flight:${f.id}:started`,
          kind: "flight_started",
          at: f.started_at,
          actorId: f.target_agent_id,
          actorName: f.agent_name,
          title: "related flight started",
          summary: f.summary,
          detailKind: `${f.state}:inferred`,
          flightId: f.id,
          messageId: f.message_id,
          conversationId: f.conversation_id,
        });
      }
      if (typeof f.completed_at === "number") {
        items.push({
          id: `inferred-flight:${f.id}:completed`,
          kind: "flight_completed",
          at: f.completed_at,
          actorId: f.target_agent_id,
          actorName: f.agent_name,
          title: `related flight ${f.state}`,
          summary: f.summary,
          detailKind: `${f.state}:inferred`,
          flightId: f.id,
          messageId: f.message_id,
          conversationId: f.conversation_id,
        });
      }
    }
  }

  items.sort((left, right) => right.at - left.at);
  return items.slice(0, 80);
}

export function queryInferredWorkTimelineFlights(
  context: {
    conversationId?: string | null;
    ownerId?: string | null;
    nextMoveOwnerId?: string | null;
    createdAt?: number | null;
    updatedAt?: number | null;
  },
  explicitFlightIds: Set<string>,
): Array<{
  id: string;
  state: string;
  summary: string | null;
  started_at: number | null;
  completed_at: number | null;
  target_agent_id: string;
  agent_name: string | null;
  conversation_id: string | null;
  message_id: string | null;
}> {
  if (!context.conversationId) {
    return [];
  }
  const conversationIds = conversationIdAliases(context.conversationId);
  if (conversationIds.length === 0) {
    return [];
  }

  const createdAt = typeof context.createdAt === "number" ? context.createdAt : 0;
  const lowerBound = Math.max(0, createdAt - 30_000);
  const upperBound = Math.max(
    typeof context.updatedAt === "number" ? context.updatedAt : createdAt,
    createdAt + 6 * 60 * 60 * 1000,
  );
  const ownerIds = Array.from(new Set([
    context.ownerId?.trim(),
    context.nextMoveOwnerId?.trim(),
  ].filter((value): value is string => Boolean(value))));
  const ownerClause = ownerIds.length > 0
    ? `(inv.target_agent_id IN (${sqlPlaceholders(ownerIds.length)}) OR f.target_agent_id IN (${sqlPlaceholders(ownerIds.length)}))`
    : null;

  const rows = db().prepare(
    `SELECT f.id, f.state, f.summary, f.started_at, f.completed_at,
            f.target_agent_id,
            inv.conversation_id,
            inv.message_id,
            ac.display_name AS agent_name
     FROM flights f
     JOIN invocations inv ON inv.id = f.invocation_id
     LEFT JOIN actors ac ON ac.id = f.target_agent_id
     WHERE inv.collaboration_record_id IS NULL
       AND inv.conversation_id IN (${sqlPlaceholders(conversationIds.length)})
       AND inv.created_at BETWEEN ? AND ?
       ${ownerClause ? `AND ${ownerClause}` : ""}
     ORDER BY COALESCE(f.completed_at, f.started_at, 0) DESC
     LIMIT 20`,
  ).all(
    ...conversationIds,
    lowerBound,
    upperBound,
    ...(ownerClause ? [...ownerIds, ...ownerIds] : []),
  ) as Array<{
    id: string;
    state: string;
    summary: string | null;
    started_at: number | null;
    completed_at: number | null;
    target_agent_id: string;
    agent_name: string | null;
    conversation_id: string | null;
    message_id: string | null;
  }>;

  return rows.filter((row) => !explicitFlightIds.has(row.id));
}

export function queryWorkItems(opts?: {
  agentId?: string;
  conversationId?: string;
  activeOnly?: boolean;
  limit?: number;
}): WebWorkItem[] {
  const operatorIds = configuredOperatorActorIds();
  const operatorClause = sqlPlaceholders(operatorIds.length);
  const conversationIds = opts?.conversationId ? conversationIdAliases(opts.conversationId) : [];
  const where = sqlJoinClauses([
    "cr.kind = 'work_item'",
    opts?.activeOnly !== false ? `cr.state IN ${ACTIVE_WORK_STATES_SQL}` : null,
    conversationIds.length > 0
      ? `cr.conversation_id IN (${sqlPlaceholders(conversationIds.length)})`
      : null,
    opts?.agentId ? "(cr.owner_id = ? OR cr.next_move_owner_id = ?)" : null,
  ]);

  const sql = `SELECT
    cr.id,
    cr.title,
    cr.summary,
    cr.owner_id,
    owner.display_name AS owner_name,
    cr.next_move_owner_id,
    next.display_name AS next_move_owner_name,
    cr.conversation_id,
    cr.created_at,
    cr.state,
    cr.acceptance_state,
    cr.priority,
    cr.updated_at,
    cr.parent_id,
    parent.title AS parent_title,
    json_extract(cr.detail_json, '$.progress.summary') AS progress_summary,
    (
      SELECT COUNT(*)
      FROM collaboration_records child
      WHERE child.parent_id = cr.id
        AND child.kind = 'work_item'
        AND child.state IN ${ACTIVE_WORK_STATES_SQL}
    ) AS active_child_work_count,
    (
      SELECT COUNT(*)
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
        AND f.state NOT IN ('completed','failed','cancelled')
    ) AS active_flight_count,
    (
      SELECT f.state
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
        AND f.state NOT IN ('completed','failed','cancelled')
      ORDER BY COALESCE(f.started_at, f.completed_at, 0) DESC
      LIMIT 1
    ) AS active_flight_state,
    (
      SELECT f.summary
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
        AND f.state NOT IN ('completed','failed','cancelled')
      ORDER BY COALESCE(f.started_at, f.completed_at, 0) DESC
      LIMIT 1
    ) AS active_flight_summary,
    (
      SELECT f.state
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
      ORDER BY COALESCE(f.completed_at, f.started_at, 0) DESC
      LIMIT 1
    ) AS latest_flight_state,
    (
      SELECT COALESCE(f.completed_at, f.started_at)
      FROM flights f
      JOIN invocations inv ON inv.id = f.invocation_id
      WHERE inv.collaboration_record_id = cr.id
      ORDER BY COALESCE(f.completed_at, f.started_at, 0) DESC
      LIMIT 1
    ) AS latest_flight_at,
    (
      SELECT e.created_at
      FROM collaboration_events e
      WHERE e.record_id = cr.id
        AND e.kind = 'dismissed'
        AND e.actor_id IN (${operatorClause})
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_dismissed_at,
    (
      SELECT e.summary
      FROM collaboration_events e
      WHERE e.record_id = cr.id
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_event_summary,
    (
      SELECT e.created_at
      FROM collaboration_events e
      WHERE e.record_id = cr.id
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_event_at,
    MAX(
      cr.updated_at,
      COALESCE((
        SELECT e.created_at
        FROM collaboration_events e
        WHERE e.record_id = cr.id
        ORDER BY e.created_at DESC
        LIMIT 1
      ), 0),
      COALESCE((
        SELECT COALESCE(f.completed_at, f.started_at)
        FROM flights f
        JOIN invocations inv ON inv.id = f.invocation_id
        WHERE inv.collaboration_record_id = cr.id
        ORDER BY COALESCE(f.completed_at, f.started_at, 0) DESC
        LIMIT 1
      ), 0)
    ) AS sort_ts
  FROM collaboration_records cr
  LEFT JOIN actors owner ON owner.id = cr.owner_id
  LEFT JOIN actors next ON next.id = cr.next_move_owner_id
  LEFT JOIN collaboration_records parent ON parent.id = cr.parent_id
  ${sqlWhereClause([where])}
  ORDER BY sort_ts DESC, cr.updated_at DESC
  LIMIT ?`;

  const limit = opts?.limit ?? 50;
  const params: Array<string | number> = [...operatorIds];
  if (conversationIds.length > 0) {
    params.push(...conversationIds);
  }
  if (opts?.agentId) {
    params.push(opts.agentId, opts.agentId);
  }
  params.push(limit);

  const rows = db().prepare(sql).all(...params) as Array<{
    id: string;
    title: string;
    summary: string | null;
    owner_id: string | null;
    owner_name: string | null;
    next_move_owner_id: string | null;
    next_move_owner_name: string | null;
    conversation_id: string | null;
    created_at: number;
    state: string;
    acceptance_state: string;
    priority: string | null;
    updated_at: number;
    parent_id: string | null;
    parent_title: string | null;
    progress_summary: string | null;
    active_child_work_count: number;
    active_flight_count: number;
    active_flight_state: string | null;
    active_flight_summary: string | null;
    latest_flight_state: string | null;
    latest_flight_at: number | string | null;
    latest_dismissed_at: number | string | null;
    latest_event_summary: string | null;
    latest_event_at: number | string | null;
    sort_ts: number;
  }>;

  return rows.map(projectWorkItemRow);
}
