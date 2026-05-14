/**
 * Flights and run-graph projections.
 *
 * Lifted from db-queries.ts as part of SCO-031 Phase C. Includes
 * `queryRuns` (merged invocation+flight projection), `queryFlights` (raw
 * flight rows for the UI), `queryFlightRecordById` (canonical FlightRecord
 * lookup), and `queryFollowTarget` (single helper that resolves
 * conversation/flight/work/session deep-links).
 *
 * `queryFollowTarget` defers to `queryWorkItemById` (`./work.ts`) and
 * `querySessionById` (db-queries.ts) when the requested target is sparse;
 * the latter creates a small import cycle with db-queries.ts that is only
 * exercised at call time, not at module load. Per SCO-031 §6, the session
 * cluster moves to `ConversationsRepo` in a follow-up step, at which point
 * the cycle disappears.
 */

import {
  projectAgentRunFromInvocationFlight,
  type AgentRun,
  type AgentRunSource,
  type AgentRunState,
  type FlightRecord,
  type InvocationExecutionPreference,
  type InvocationRequest,
  type MetadataMap,
} from "@openscout/protocol";

import { db } from "./internal/db.ts";
import { conversationIdAliases } from "./internal/conversation-ids.ts";
import { coerceNumber, parseJson } from "./internal/parse.ts";
import { resolveHarnessSessionId } from "./internal/paths.ts";
import {
  ACTIVE_FLIGHT_MAX_AGE_MS,
  ACTIVE_FLIGHT_STATES_SQL,
  EPOCH_MILLISECONDS_FLOOR,
  isFreshActiveTimestamp,
  sqlJoinClauses,
  sqlPlaceholders,
  sqlWhereClause,
} from "./internal/sql-helpers.ts";
import { queryWorkItemById } from "./work.ts";
// Session-cluster reads moved to db/sessions.ts as the final SCO-031 Phase C
// extraction. The import is local to db/ so there is no cycle through the
// db-queries.ts barrel.
import { querySessionById } from "./sessions.ts";
import type { WebAgentRun, WebFlight, WebFollowTarget } from "./types/web.ts";

/* ── Row projection helpers (private) ── */

type RunQueryRow = {
  invocation_id: string;
  invocation_requester_id: string;
  requester_node_id: string;
  invocation_target_agent_id: string;
  target_node_id: string | null;
  action: string;
  task: string;
  collaboration_record_id: string | null;
  collaboration_record_kind: string | null;
  conversation_id: string | null;
  message_id: string | null;
  context_json: string | null;
  execution_json: string | null;
  ensure_awake: number | string;
  stream: number | string;
  timeout_ms: number | string | null;
  invocation_metadata_json: string | null;
  invocation_created_at: number;
  agent_name: string | null;
  flight_id: string | null;
  flight_invocation_id: string | null;
  flight_requester_id: string | null;
  flight_target_agent_id: string | null;
  flight_state: string | null;
  flight_summary: string | null;
  flight_output: string | null;
  flight_error: string | null;
  flight_metadata_json: string | null;
  started_at: number | null;
  completed_at: number | null;
};

function parseOptionalMetadata(value: string | null): MetadataMap | undefined {
  const parsed = parseJson<unknown>(value, undefined);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as MetadataMap
    : undefined;
}

function parseOptionalExecution(value: string | null): InvocationExecutionPreference | undefined {
  const parsed = parseJson<unknown>(value, undefined);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as InvocationExecutionPreference
    : undefined;
}

function optionalNumber(value: number | string | null): number | undefined {
  return coerceNumber(value) ?? undefined;
}

function sqlBoolean(value: number | string): boolean {
  return value === 1 || value === "1";
}

function projectInvocationFromRunRow(row: RunQueryRow): InvocationRequest {
  const invocation: InvocationRequest = {
    id: row.invocation_id,
    requesterId: row.invocation_requester_id,
    requesterNodeId: row.requester_node_id,
    targetAgentId: row.invocation_target_agent_id,
    action: row.action as InvocationRequest["action"],
    task: row.task,
    ensureAwake: sqlBoolean(row.ensure_awake),
    stream: sqlBoolean(row.stream),
    createdAt: row.invocation_created_at,
  };

  if (row.target_node_id) invocation.targetNodeId = row.target_node_id;
  if (row.collaboration_record_id) invocation.collaborationRecordId = row.collaboration_record_id;
  if (row.conversation_id) invocation.conversationId = row.conversation_id;
  if (row.message_id) invocation.messageId = row.message_id;

  const context = parseOptionalMetadata(row.context_json);
  if (context) invocation.context = context;
  const execution = parseOptionalExecution(row.execution_json);
  if (execution) invocation.execution = execution;
  const timeoutMs = optionalNumber(row.timeout_ms);
  if (timeoutMs !== undefined) invocation.timeoutMs = timeoutMs;
  const metadata = parseOptionalMetadata(row.invocation_metadata_json);
  if (metadata) invocation.metadata = metadata;

  return invocation;
}

function projectFlightFromRunRow(row: RunQueryRow): FlightRecord | undefined {
  if (!row.flight_id || !row.flight_state) {
    return undefined;
  }

  const flight: FlightRecord = {
    id: row.flight_id,
    invocationId: row.flight_invocation_id ?? row.invocation_id,
    requesterId: row.flight_requester_id ?? row.invocation_requester_id,
    targetAgentId: row.flight_target_agent_id ?? row.invocation_target_agent_id,
    state: row.flight_state as FlightRecord["state"],
  };

  if (row.flight_summary) flight.summary = row.flight_summary;
  if (row.flight_output) flight.output = row.flight_output;
  if (row.flight_error) flight.error = row.flight_error;
  const metadata = parseOptionalMetadata(row.flight_metadata_json);
  if (metadata) flight.metadata = metadata;
  if (row.started_at !== null) flight.startedAt = row.started_at;
  if (row.completed_at !== null) flight.completedAt = row.completed_at;

  return flight;
}

const ACTIVE_RUN_STATES = new Set<AgentRunState>([
  "queued",
  "waking",
  "running",
  "waiting",
  "review",
  "unknown",
]);

function isActiveRun(run: AgentRun): boolean {
  return ACTIVE_RUN_STATES.has(run.state) && isFreshActiveTimestamp(run.updatedAt);
}

export function queryRuns(opts?: {
  agentId?: string;
  conversationId?: string;
  collaborationRecordId?: string;
  workId?: string;
  state?: AgentRunState | string;
  source?: AgentRunSource | string;
  active?: boolean;
  limit?: number;
}): WebAgentRun[] {
  const conversationIds = opts?.conversationId ? conversationIdAliases(opts.conversationId) : [];
  const requestedWorkId = opts?.collaborationRecordId ?? opts?.workId;
  const where = sqlJoinClauses([
    opts?.agentId ? `inv.target_agent_id = ?` : null,
    conversationIds.length > 0
      ? `inv.conversation_id IN (${sqlPlaceholders(conversationIds.length)})`
      : null,
  ]);
  const requestedLimit = opts?.limit;
  const limit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
    ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
    : 100;

  const params: string[] = [];
  if (opts?.agentId) params.push(opts.agentId);
  if (conversationIds.length > 0) params.push(...conversationIds);

  const rows = db().prepare(
    `SELECT
       inv.id AS invocation_id,
       inv.requester_id AS invocation_requester_id,
       inv.requester_node_id,
       inv.target_agent_id AS invocation_target_agent_id,
       inv.target_node_id,
       inv.action,
       inv.task,
       inv.collaboration_record_id,
       cr.kind AS collaboration_record_kind,
       inv.conversation_id,
       inv.message_id,
       inv.context_json,
       inv.execution_json,
       inv.ensure_awake,
       inv.stream,
       inv.timeout_ms,
       inv.metadata_json AS invocation_metadata_json,
       inv.created_at AS invocation_created_at,
       ac.display_name AS agent_name,
       f.id AS flight_id,
       f.invocation_id AS flight_invocation_id,
       f.requester_id AS flight_requester_id,
       f.target_agent_id AS flight_target_agent_id,
       f.state AS flight_state,
       f.summary AS flight_summary,
       f.output AS flight_output,
       f.error AS flight_error,
       f.metadata_json AS flight_metadata_json,
       f.started_at,
       f.completed_at
     FROM invocations inv
     LEFT JOIN flights f ON f.id = (
       SELECT f2.id
       FROM flights f2
       WHERE f2.invocation_id = inv.id
       ORDER BY COALESCE(f2.completed_at, f2.started_at, 0) DESC, f2.id DESC
       LIMIT 1
     )
     LEFT JOIN actors ac ON ac.id = inv.target_agent_id
     LEFT JOIN collaboration_records cr ON cr.id = inv.collaboration_record_id
     ${sqlWhereClause([where])}
     ORDER BY COALESCE(f.completed_at, f.started_at, inv.created_at) DESC, inv.created_at DESC`,
  ).all(...params) as RunQueryRow[];

  const explicitActiveFilter = opts?.active;
  const activeOnly = explicitActiveFilter ?? (opts?.state ? false : true);

  return rows
    .map((row) => {
      const run = projectAgentRunFromInvocationFlight({
        invocation: projectInvocationFromRunRow(row),
        flight: projectFlightFromRunRow(row),
      });
      if (!run.workId && row.collaboration_record_kind === "work_item" && row.collaboration_record_id) {
        run.workId = row.collaboration_record_id;
      }
      return {
        ...run,
        agentName: row.agent_name,
      };
    })
    .filter((run) => requestedWorkId
      ? run.collaborationRecordId === requestedWorkId || run.workId === requestedWorkId
      : true)
    .filter((run) => opts?.state ? run.state === opts.state : true)
    .filter((run) => opts?.source ? run.source === opts.source : true)
    .filter((run) => activeOnly ? isActiveRun(run) : true)
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function queryFlights(opts?: {
  agentId?: string;
  conversationId?: string;
  collaborationRecordId?: string;
  activeOnly?: boolean;
}): WebFlight[] {
  const conversationIds = opts?.conversationId ? conversationIdAliases(opts.conversationId) : [];
  const where = sqlJoinClauses([
    opts?.activeOnly ? `f.state IN ${ACTIVE_FLIGHT_STATES_SQL}` : null,
    opts?.activeOnly ? `(COALESCE(f.started_at, inv.created_at, 0) < ${EPOCH_MILLISECONDS_FLOOR} OR COALESCE(f.started_at, inv.created_at, 0) >= ?)` : null,
    opts?.agentId ? `f.target_agent_id = ?` : null,
    conversationIds.length > 0
      ? `inv.conversation_id IN (${sqlPlaceholders(conversationIds.length)})`
      : null,
    opts?.collaborationRecordId ? `inv.collaboration_record_id = ?` : null,
  ]);

  const sql = `SELECT
    f.id,
    f.invocation_id,
    f.target_agent_id,
    ac.display_name AS agent_name,
    inv.conversation_id,
    inv.collaboration_record_id,
    f.state,
    f.summary,
    f.started_at,
    f.completed_at
  FROM flights f
  JOIN invocations inv ON inv.id = f.invocation_id
  LEFT JOIN actors ac ON ac.id = f.target_agent_id
  ${sqlWhereClause([where])}
  ORDER BY f.started_at DESC NULLS LAST
  LIMIT 100`;

  const params: string[] = [];
  if (opts?.activeOnly) params.push(String(Date.now() - ACTIVE_FLIGHT_MAX_AGE_MS));
  if (opts?.agentId) params.push(opts.agentId);
  if (conversationIds.length > 0) params.push(...conversationIds);
  if (opts?.collaborationRecordId) params.push(opts.collaborationRecordId);

  const rows = db().prepare(sql).all(...params) as Array<{
    id: string;
    invocation_id: string;
    target_agent_id: string;
    agent_name: string | null;
    conversation_id: string | null;
    collaboration_record_id: string | null;
    state: string;
    summary: string | null;
    started_at: number | null;
    completed_at: number | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    invocationId: r.invocation_id,
    agentId: r.target_agent_id,
    agentName: r.agent_name,
    conversationId: r.conversation_id,
    collaborationRecordId: r.collaboration_record_id,
    state: r.state,
    summary: r.summary,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  }));
}

export function queryFlightRecordById(id: string): FlightRecord | null {
  const row = db().prepare(
    `SELECT
       id,
       invocation_id,
       requester_id,
       target_agent_id,
       state,
       summary,
       output,
       error,
       metadata_json,
       started_at,
       completed_at
     FROM flights
     WHERE id = ?
     LIMIT 1`,
  ).get(id) as {
    id: string;
    invocation_id: string;
    requester_id: string;
    target_agent_id: string;
    state: FlightRecord["state"];
    summary: string | null;
    output: string | null;
    error: string | null;
    metadata_json: string | null;
    started_at: number | null;
    completed_at: number | null;
  } | null;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    invocationId: row.invocation_id,
    requesterId: row.requester_id,
    targetAgentId: row.target_agent_id,
    state: row.state,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.output ? { output: row.output } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
  };
}

export function queryFollowTarget(opts: {
  flightId?: string;
  invocationId?: string;
  conversationId?: string;
  workId?: string;
  sessionId?: string;
  targetAgentId?: string;
}): WebFollowTarget {
  const target: WebFollowTarget = {
    flightId: opts.flightId?.trim() || null,
    invocationId: opts.invocationId?.trim() || null,
    conversationId: opts.conversationId?.trim() || null,
    workId: opts.workId?.trim() || null,
    sessionId: opts.sessionId?.trim() || null,
    targetAgentId: opts.targetAgentId?.trim() || null,
  };

  if (target.flightId || target.invocationId) {
    const flightJoin = target.flightId
      ? "JOIN flights f ON f.invocation_id = inv.id"
      : `LEFT JOIN flights f ON f.id = (
           SELECT f2.id
           FROM flights f2
           WHERE f2.invocation_id = inv.id
           ORDER BY COALESCE(f2.completed_at, f2.started_at, 0) DESC
           LIMIT 1
         )`;
    const where = target.flightId ? "f.id = ?" : "inv.id = ?";
    const param = target.flightId ?? target.invocationId ?? "";
    const row = db().prepare(
      `SELECT
         f.id AS flight_id,
         inv.id AS invocation_id,
         inv.conversation_id,
         inv.collaboration_record_id,
         inv.target_agent_id,
         ep.transport,
         ep.session_id,
         ep.metadata_json AS endpoint_metadata_json
       FROM invocations inv
       ${flightJoin}
       LEFT JOIN agent_endpoints ep ON ep.id = (
         SELECT ep2.id
         FROM agent_endpoints ep2
         WHERE ep2.agent_id = inv.target_agent_id
         ORDER BY ep2.updated_at DESC
         LIMIT 1
       )
       WHERE ${where}
       LIMIT 1`,
    ).get(param) as {
      flight_id: string | null;
      invocation_id: string;
      conversation_id: string | null;
      collaboration_record_id: string | null;
      target_agent_id: string | null;
      transport: string | null;
      session_id: string | null;
      endpoint_metadata_json: string | null;
    } | null;

    if (row) {
      let endpointMeta: Record<string, unknown> = {};
      try {
        endpointMeta = row.endpoint_metadata_json
          ? JSON.parse(row.endpoint_metadata_json)
          : {};
      } catch {
        endpointMeta = {};
      }
      target.flightId = target.flightId ?? row.flight_id;
      target.invocationId = target.invocationId ?? row.invocation_id;
      target.conversationId = target.conversationId ?? row.conversation_id;
      target.workId = target.workId ?? row.collaboration_record_id;
      target.targetAgentId = target.targetAgentId ?? row.target_agent_id;
      target.sessionId = target.sessionId ?? resolveHarnessSessionId(
        row.transport,
        row.session_id,
        endpointMeta,
      );
    }
  }

  if (target.workId && !target.conversationId) {
    const work = queryWorkItemById(target.workId);
    target.conversationId = work?.conversationId ?? target.conversationId;
  }

  if (target.conversationId && (!target.sessionId || !target.targetAgentId)) {
    // querySessionById now lives in db/sessions.ts (SCO-031 final extraction).
    // SCO-030 may fold this back into `ConversationsRepo` once opaque ids land.
    const session = querySessionById(target.conversationId);
    target.sessionId = target.sessionId ?? session?.harnessSessionId ?? null;
    target.targetAgentId = target.targetAgentId ?? session?.agentId ?? null;
  }

  return target;
}
