/**
 * Direct SQLite reads for the web UI.
 *
 * All queries hit the control-plane database in readonly mode — no shell
 * commands, no tmux, no snapshot rebuilds.  Bun's native SQLite driver is
 * synchronous and fast (< 1 ms for the queries below on a typical machine).
 */

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { relayAgentLogsDirectory } from "@openscout/runtime/support-paths";
import { resolveOperatorName } from "@openscout/runtime/user-config";

/* ── Types (match what the client expects) ── */

export type WebAgent = {
  id: string;
  name: string;
  handle: string | null;
  agentClass: string;
  harness: string | null;
  state: string | null;
  projectRoot: string | null;
  cwd: string | null;
  updatedAt: number | null;
  transport: string | null;
  selector: string | null;
  wakePolicy: string | null;
  capabilities: string[];
  project: string | null;
  branch: string | null;
  role: string | null;
  harnessSessionId: string | null;
  harnessLogPath: string | null;
  conversationId: string;
};

export type WebActivityItem = {
  id: string;
  kind: string;
  ts: number;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
};

export type WebMessage = {
  id: string;
  conversationId: string;
  actorName: string;
  body: string;
  createdAt: number;
  class: string;
  metadata: Record<string, unknown> | null;
};

type WorkAttention = "silent" | "badge" | "interrupt";
type AgentSummaryState = "offline" | "available" | "working";
type SqlClause = string | null | undefined | false;

export type WebWorkItem = {
  id: string;
  title: string;
  summary: string | null;
  ownerId: string | null;
  ownerName: string | null;
  nextMoveOwnerId: string | null;
  nextMoveOwnerName: string | null;
  conversationId: string | null;
  state: string;
  acceptanceState: string;
  priority: string | null;
  currentPhase: string;
  attention: WorkAttention;
  activeChildWorkCount: number;
  activeFlightCount: number;
  lastMeaningfulAt: number;
  lastMeaningfulSummary: string | null;
};

/* ── DB path ── */

function resolveDbPath(): string {
  const controlHome =
    process.env.OPENSCOUT_CONTROL_HOME ??
    join(homedir(), ".openscout", "control-plane");
  return join(controlHome, "control-plane.sqlite");
}

/* ── Readonly connection (WAL-visible without periodic reopen) ── */

let _db: Database | null = null;
const DB_BUSY_TIMEOUT_MS = 250; // keep UI reads short under broker write contention

export function configureReadonlyDb(db: Database): void {
  db.exec(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA query_only = ON");
}

function db(): Database {
  if (!_db) {
    _db = new Database(resolveDbPath(), { readonly: true });
    configureReadonlyDb(_db);
  }
  return _db;
}

/** Call on server shutdown. */
export function closeDb(): void {
  _db?.close();
  _db = null;
}

/* ── Compact home paths (~/...) ── */

const HOME = homedir();

function compact(p: string | null): string | null {
  if (!p) return null;
  return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pairingHarnessLogPath(adapterType: string | null, sessionId: string | null): string | null {
  const normalizedAdapter = adapterType?.trim();
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedAdapter || !normalizedSessionId) {
    return null;
  }
  return join(HOME, ".scout", "pairing", normalizedAdapter, normalizedSessionId, "logs", "stdout.log");
}

function relayHarnessLogPath(agentId: string): string {
  return join(relayAgentLogsDirectory(agentId), "stdout.log");
}

function resolveHarnessSessionId(
  transport: string | null,
  endpointSessionId: string | null,
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (transport === "pairing_bridge") {
    const attachedTransport = metadataString(metadata, "attachedTransport");
    if (attachedTransport === "codex_app_server") {
      return metadataString(metadata, "threadId")
        ?? metadataString(metadata, "externalSessionId")
        ?? endpointSessionId;
    }
    return metadataString(metadata, "externalSessionId") ?? endpointSessionId;
  }

  if (transport === "codex_app_server") {
    return metadataString(metadata, "threadId") ?? endpointSessionId;
  }

  if (transport === "claude_stream_json") {
    return metadataString(metadata, "externalSessionId") ?? endpointSessionId;
  }

  return null;
}

function resolveHarnessLogPath(
  agentId: string,
  transport: string | null,
  endpointSessionId: string | null,
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (transport === "pairing_bridge") {
    const pairingSessionId = metadataString(metadata, "pairingSessionId") ?? endpointSessionId;
    const attachedTransport = metadataString(metadata, "attachedTransport");
    const adapterType = metadataString(metadata, "pairingAdapterType")
      ?? (attachedTransport === "codex_app_server"
        ? "codex"
        : attachedTransport === "claude_stream_json"
          ? "claude"
          : null);
    return pairingHarnessLogPath(adapterType, pairingSessionId);
  }

  if (transport === "codex_app_server" || transport === "claude_stream_json") {
    return relayHarnessLogPath(agentId);
  }

  return null;
}

function coerceNumber(value: number | string | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sqlJoinClauses(clauses: SqlClause[], operator: "AND" | "OR" = "AND"): string {
  return clauses.filter((clause): clause is string => Boolean(clause)).join(` ${operator} `);
}

function sqlWhereClause(clauses: SqlClause[], operator: "AND" | "OR" = "AND"): string {
  const joined = sqlJoinClauses(clauses, operator);
  return joined ? `WHERE ${joined}` : "";
}

function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function sqlQuoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlStringList(values: readonly string[]): string {
  return `(${values.map(sqlQuoteLiteral).join(",")})`;
}

const LATEST_AGENT_ENDPOINT_JOIN = `LEFT JOIN agent_endpoints ep ON ep.id = (
  SELECT ep2.id
  FROM agent_endpoints ep2
  WHERE ep2.agent_id = a.id
  ORDER BY ep2.updated_at DESC
  LIMIT 1
)`;

function isExecutingFlightState(state: string | null): boolean {
  return state === "running";
}

function queryExecutingAgentIds(): Set<string> {
  return new Set(
    (db().prepare(
      `SELECT DISTINCT target_agent_id FROM flights
       WHERE state = 'running'`,
    ).all() as Array<{ target_agent_id: string }>).map((row) => row.target_agent_id),
  );
}

function summarizeAgentState(rawState: string | null, isWorking: boolean): AgentSummaryState {
  if (isWorking) {
    return "working";
  }
  return rawState && rawState !== "offline" ? "available" : "offline";
}

function summarizeAgentStatusLabel(rawState: string | null, isWorking: boolean): string {
  switch (summarizeAgentState(rawState, isWorking)) {
    case "working":
      return "Working";
    case "available":
      return "Available";
    default:
      return "Offline";
  }
}

function normalizeTimestampMs(value: number | string | null): number | null {
  const numeric = coerceNumber(value);
  if (numeric === null) {
    return null;
  }
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

const ACTIVE_FLIGHT_STATES_SQL = sqlStringList(["running", "waking", "waiting", "queued"]);
const ACTIVE_WORK_STATES_SQL = sqlStringList(["open", "working", "waiting", "review"]);

function isDuplicateActivityFeedItem(previous: WebActivityItem | null, next: WebActivityItem): boolean {
  if (!previous) {
    return false;
  }
  return previous.kind === next.kind
    && previous.title === next.title
    && previous.summary === next.summary
    && previous.conversationId === next.conversationId
    && Math.abs(previous.ts - next.ts) <= 5_000;
}

function transientBrokerWorkingStatusPredicate(alias: string): string {
  return `NOT (
    ${alias}.class = 'status'
    AND COALESCE(json_extract(${alias}.metadata_json, '$.source'), '') = 'broker'
    AND ${alias}.body LIKE '% is working.'
  )`;
}

function staleFlightActivityPredicate(alias: string): string {
  return `NOT (
    ${alias}.kind = 'flight_updated'
    AND COALESCE(${alias}.summary, '') LIKE 'Stale running flight reconciled:%'
  )`;
}

function workPhaseFromFlightState(state: string | null): string | null {
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

function workPhaseFromState(state: string): string {
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

function workAttention(row: {
  state: string;
  acceptance_state: string;
  latest_flight_state: string | null;
}): WorkAttention {
  if (row.latest_flight_state === "failed") {
    return "interrupt";
  }
  if (row.state === "waiting" || row.state === "review" || row.acceptance_state === "pending") {
    return "badge";
  }
  return "silent";
}

function projectWorkItemRow(row: {
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
  updated_at: number;
  active_child_work_count: number;
  active_flight_count: number;
  active_flight_state: string | null;
  active_flight_summary: string | null;
  latest_flight_state: string | null;
  latest_flight_at: number | string | null;
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

/* ── Queries ── */

export function queryAgents(limit = 50): WebAgent[] {
  const executingAgentIds = queryExecutingAgentIds();
  const rows = db()
    .prepare(
      `SELECT
         a.id,
         ac.display_name AS name,
         ac.handle,
         a.agent_class,
         a.default_selector,
         a.wake_policy,
         a.capabilities_json,
         a.metadata_json,
         ep.harness,
         ep.transport,
         ep.state,
         ep.project_root,
         ep.cwd,
         ep.session_id,
         ep.metadata_json AS endpoint_metadata_json,
         ep.updated_at
       FROM agents a
       JOIN actors ac ON ac.id = a.id
       ${LATEST_AGENT_ENDPOINT_JOIN}
       WHERE COALESCE(json_extract(a.metadata_json, '$.retiredFromFleet'), 0) != 1
       ORDER BY COALESCE(ep.updated_at, 0) DESC, ac.display_name ASC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    name: string;
    handle: string | null;
    agent_class: string;
    default_selector: string | null;
    wake_policy: string | null;
    capabilities_json: string | null;
    metadata_json: string | null;
    harness: string | null;
    transport: string | null;
    state: string | null;
    project_root: string | null;
    cwd: string | null;
    session_id: string | null;
    endpoint_metadata_json: string | null;
    updated_at: number | null;
  }>;

  return rows.map((r) => {
    let capabilities: string[] = [];
    try { capabilities = r.capabilities_json ? JSON.parse(r.capabilities_json) : []; } catch {}

    let meta: Record<string, unknown> = {};
    try { meta = r.metadata_json ? JSON.parse(r.metadata_json) : {}; } catch {}

    let endpointMeta: Record<string, unknown> = {};
    try { endpointMeta = r.endpoint_metadata_json ? JSON.parse(r.endpoint_metadata_json) : {}; } catch {}

    return {
      id: r.id,
      name: r.name,
      handle: r.handle,
      agentClass: r.agent_class,
      harness: r.harness,
      state: summarizeAgentState(r.state, executingAgentIds.has(r.id)),
      projectRoot: compact(r.project_root),
      cwd: compact(r.cwd),
      updatedAt: r.updated_at,
      transport: r.transport,
      selector: r.default_selector,
      wakePolicy: r.wake_policy,
      capabilities,
      project: (meta.project as string) ?? null,
      branch: (meta.branch as string) ?? null,
      role: (meta.role as string) ?? null,
      harnessSessionId: resolveHarnessSessionId(r.transport, r.session_id, endpointMeta),
      harnessLogPath: resolveHarnessLogPath(r.id, r.transport, r.session_id, endpointMeta),
      conversationId: conversationIdForAgent(r.id),
    };
  });
}

export function queryActivity(limit = 60): WebActivityItem[] {
  const rows = db()
    .prepare(
      `SELECT
         ai.id,
         ai.kind,
         ai.ts,
         ac.display_name AS actor_name,
         ai.title,
         ai.summary,
         ai.conversation_id,
         ai.workspace_root
       FROM activity_items ai
       LEFT JOIN actors ac ON ac.id = ai.actor_id
       WHERE ai.kind != 'ask_replied'
         AND ${staleFlightActivityPredicate("ai")}
       ORDER BY ai.ts DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    kind: string;
    ts: number;
    actor_name: string | null;
    title: string | null;
    summary: string | null;
    conversation_id: string | null;
    workspace_root: string | null;
  }>;

  const items = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    ts: r.ts,
    actorName: r.actor_name,
    title: r.title,
    summary: r.summary,
    conversationId: r.conversation_id,
    workspaceRoot: compact(r.workspace_root),
  }));

  return items.filter((item, index) => !isDuplicateActivityFeedItem(items[index - 1] ?? null, item));
}

export function queryRecentMessages(limit = 80, opts?: { conversationId?: string }): WebMessage[] {
  const conversationIds = opts?.conversationId ? conversationIdAliases(opts.conversationId) : [];
  const where = sqlJoinClauses([
    transientBrokerWorkingStatusPredicate("m"),
    conversationIds.length > 0
      ? `m.conversation_id IN (${sqlPlaceholders(conversationIds.length)})`
      : null,
  ]);

  const rows = db()
    .prepare(
      `SELECT
         m.id,
         m.conversation_id,
         ac.display_name AS actor_name,
         m.body,
         m.created_at,
         m.class,
         m.metadata_json
       FROM messages m
       JOIN actors ac ON ac.id = m.actor_id
       WHERE ${where}
       ORDER BY m.created_at DESC
       LIMIT ?`,
    )
    .all(...conversationIds, limit) as Array<{
    id: string;
    conversation_id: string;
    actor_name: string;
    body: string;
    created_at: number;
    class: string;
    metadata_json: string | null;
  }>;

  return rows.map((r) => {
    let metadata: Record<string, unknown> | null = null;
    if (r.metadata_json) {
      try { metadata = JSON.parse(r.metadata_json); } catch { metadata = null; }
    }
    return {
      id: r.id,
      conversationId: r.conversation_id,
      actorName: r.actor_name,
      body: r.body,
      createdAt: r.created_at,
      class: r.class,
      metadata,
    };
  });
}

/* ── Flights (tasks) ── */

export type WebFlight = {
  id: string;
  invocationId: string;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  collaborationRecordId: string | null;
  state: string;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

export function queryFlights(opts?: {
  agentId?: string;
  conversationId?: string;
  collaborationRecordId?: string;
  activeOnly?: boolean;
}): WebFlight[] {
  const conversationIds = opts?.conversationId ? conversationIdAliases(opts.conversationId) : [];
  const where = sqlJoinClauses([
    opts?.activeOnly ? `f.state IN ${ACTIVE_FLIGHT_STATES_SQL}` : null,
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

export type WebWorkTimelineKind =
  | "collaboration_event"
  | "flight_started"
  | "flight_completed"
  | "message";

export type WebWorkTimelineItem = {
  id: string;
  kind: WebWorkTimelineKind;
  at: number;
  actorId: string | null;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  /** Discriminator: event sub-kind, flight state, or message class. */
  detailKind: string | null;
  flightId: string | null;
  messageId: string | null;
  conversationId: string | null;
};

export type WebWorkDetail = WebWorkItem & {
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  parentTitle: string | null;
  childWork: WebWorkItem[];
  activeFlights: WebFlight[];
  timeline: WebWorkTimelineItem[];
};

export function queryWorkItemById(id: string): WebWorkDetail | null {
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
    ) AS latest_event_at
  FROM collaboration_records cr
  LEFT JOIN actors owner ON owner.id = cr.owner_id
  LEFT JOIN actors next ON next.id = cr.next_move_owner_id
  LEFT JOIN collaboration_records parent ON parent.id = cr.parent_id
  WHERE cr.kind = 'work_item' AND cr.id = ?
  LIMIT 1`;

  const row = db().prepare(sql).get(id) as ({
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

  const timeline = queryWorkTimeline(row.id);

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

function queryWorkItemShallow(id: string): WebWorkItem | null {
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
    cr.updated_at,
    json_extract(cr.detail_json, '$.progress.summary') AS progress_summary,
    0 AS active_child_work_count,
    0 AS active_flight_count,
    NULL AS active_flight_state,
    NULL AS active_flight_summary,
    NULL AS latest_flight_state,
    NULL AS latest_flight_at,
    NULL AS latest_event_summary,
    NULL AS latest_event_at
  FROM collaboration_records cr
  LEFT JOIN actors owner ON owner.id = cr.owner_id
  LEFT JOIN actors next ON next.id = cr.next_move_owner_id
  WHERE cr.kind = 'work_item' AND cr.id = ?
  LIMIT 1`;
  const row = db().prepare(sql).get(id) as Parameters<typeof projectWorkItemRow>[0] | null;
  return row ? projectWorkItemRow(row) : null;
}

function queryWorkTimeline(workId: string): WebWorkTimelineItem[] {
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

  items.sort((left, right) => right.at - left.at);
  return items.slice(0, 80);
}

export function queryWorkItems(opts?: {
  agentId?: string;
  activeOnly?: boolean;
  limit?: number;
}): WebWorkItem[] {
  const where = sqlJoinClauses([
    "cr.kind = 'work_item'",
    opts?.activeOnly !== false ? `cr.state IN ${ACTIVE_WORK_STATES_SQL}` : null,
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
    cr.state,
    cr.acceptance_state,
    cr.priority,
    cr.updated_at,
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
  ${sqlWhereClause([where])}
  ORDER BY sort_ts DESC, cr.updated_at DESC
  LIMIT ?`;

  const limit = opts?.limit ?? 50;
  const params: Array<string | number> = [];
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
    state: string;
    acceptance_state: string;
    priority: string | null;
    updated_at: number;
    progress_summary: string | null;
    active_child_work_count: number;
    active_flight_count: number;
    active_flight_state: string | null;
    active_flight_summary: string | null;
    latest_flight_state: string | null;
    latest_flight_at: number | string | null;
    latest_event_summary: string | null;
    latest_event_at: number | string | null;
    sort_ts: number;
  }>;

  return rows.map(projectWorkItemRow);
}

/* ── Sessions (all conversation kinds) ── */

function isLikelyLocalSessionAgentId(actorId: string): boolean {
  return actorId.startsWith("local-session-agent-");
}

function pickDirectConversationAgentId(participants: string[], candidateAgentIds: string[]): string | null {
  const uniqueAgentIds = Array.from(new Set(candidateAgentIds.filter(Boolean)));
  if (uniqueAgentIds.length === 0) {
    return null;
  }
  if (uniqueAgentIds.length === 1) {
    return uniqueAgentIds[0] ?? null;
  }

  const operatorActorIds = new Set(configuredOperatorActorIds());
  const nonOperatorAgentIds = uniqueAgentIds.filter((agentId) => !operatorActorIds.has(agentId));
  if (nonOperatorAgentIds.length === 1) {
    return nonOperatorAgentIds[0] ?? null;
  }

  const localSessionCandidate = nonOperatorAgentIds.find(isLikelyLocalSessionAgentId)
    ?? uniqueAgentIds.find(isLikelyLocalSessionAgentId);
  if (localSessionCandidate) {
    return localSessionCandidate;
  }

  if (participants.length === 2) {
    const orderedAgentIds = participants.filter((participantId) => uniqueAgentIds.includes(participantId));
    if (orderedAgentIds.length > 0) {
      return orderedAgentIds[0] ?? null;
    }
  }

  return nonOperatorAgentIds[0] ?? uniqueAgentIds[0] ?? null;
}

function shouldPreferSessionSummary(
  candidate: MobileSessionSummary,
  existing: MobileSessionSummary,
  agentId: string,
): boolean {
  const canonicalConversationId = conversationIdForAgent(agentId);
  const candidateIsCanonical = candidate.id === canonicalConversationId;
  const existingIsCanonical = existing.id === canonicalConversationId;

  if (candidateIsCanonical !== existingIsCanonical) {
    return candidateIsCanonical;
  }

  const candidateLastAt = candidate.lastMessageAt ?? 0;
  const existingLastAt = existing.lastMessageAt ?? 0;
  if (candidateLastAt !== existingLastAt) {
    return candidateLastAt > existingLastAt;
  }

  if (candidate.messageCount !== existing.messageCount) {
    return candidate.messageCount > existing.messageCount;
  }

  return candidate.id < existing.id;
}

export function querySessions(limit = 80): MobileSessionSummary[] {
  const rows = db().prepare(
    `SELECT
       c.id,
       c.kind,
       c.title,
       c.metadata_json
     FROM conversations c
     ORDER BY c.created_at DESC
     LIMIT ?`,
  ).all(limit) as Array<{
    id: string;
    kind: string;
    title: string;
    metadata_json: string | null;
  }>;

  const memberStmt = db().prepare(
    `SELECT actor_id FROM conversation_members WHERE conversation_id = ?`,
  );
  const agentMemberStmt = db().prepare(
    `SELECT
       a.id AS agent_id,
       ac.display_name,
       ep.harness,
       ep.transport,
       ep.project_root,
       ep.session_id,
       ep.metadata_json AS endpoint_metadata_json,
       a.metadata_json
     FROM conversation_members cm
     JOIN agents a ON a.id = cm.actor_id
     JOIN actors ac ON ac.id = a.id
     ${LATEST_AGENT_ENDPOINT_JOIN}
     WHERE cm.conversation_id = ?`,
  );
  const statsStmt = db().prepare(
    `SELECT COUNT(*) AS cnt, MAX(created_at) AS last_at FROM messages WHERE conversation_id = ?`,
  );
  const previewStmt = db().prepare(
    `SELECT body
     FROM messages m
     WHERE conversation_id = ?
       AND ${transientBrokerWorkingStatusPredicate("m")}
     ORDER BY created_at DESC
     LIMIT 1`,
  );

  const summaries = rows.flatMap((r) => {
    const participants = (memberStmt.all(r.id) as Array<{ actor_id: string }>)
      .map((m) => m.actor_id);
    const agentParticipants = agentMemberStmt.all(r.id) as Array<{
      agent_id: string;
      display_name: string;
      harness: string | null;
      transport: string | null;
      project_root: string | null;
      session_id: string | null;
      endpoint_metadata_json: string | null;
      metadata_json: string | null;
    }>;
    const primaryAgentId = r.kind === "direct"
      ? pickDirectConversationAgentId(participants, agentParticipants.map((entry) => entry.agent_id))
      : (agentParticipants.length === 1 ? agentParticipants[0]?.agent_id ?? null : null);
    const primaryAgent = primaryAgentId
      ? agentParticipants.find((entry) => entry.agent_id === primaryAgentId) ?? null
      : null;
    const agentId = primaryAgent?.agent_id ?? null;
    const stats = statsStmt.get(r.id) as { cnt: number; last_at: number | null } | null;

    let agentName: string | null = null;
    let harness: string | null = null;
    let harnessSessionId: string | null = null;
    let harnessLogPath: string | null = null;
    let branch: string | null = null;
    let workspaceRoot: string | null = null;

    if (primaryAgent) {
      agentName = primaryAgent.display_name;
      harness = primaryAgent.harness;
      workspaceRoot = compact(primaryAgent.project_root);
      try {
        const meta = primaryAgent.metadata_json ? JSON.parse(primaryAgent.metadata_json) : {};
        if ((meta.retiredFromFleet as boolean | undefined) === true) {
          return [];
        }
        branch = (meta.branch as string) ?? (meta.workspaceQualifier as string) ?? null;
      } catch {}
      try {
        const endpointMeta = primaryAgent.endpoint_metadata_json
          ? JSON.parse(primaryAgent.endpoint_metadata_json)
          : {};
        harnessSessionId = resolveHarnessSessionId(
          primaryAgent.transport,
          primaryAgent.session_id,
          endpointMeta,
        );
        harnessLogPath = resolveHarnessLogPath(
          primaryAgent.agent_id,
          primaryAgent.transport,
          primaryAgent.session_id,
          endpointMeta,
        );
      } catch {
        harnessSessionId = resolveHarnessSessionId(
          primaryAgent.transport,
          primaryAgent.session_id,
          undefined,
        );
        harnessLogPath = resolveHarnessLogPath(
          primaryAgent.agent_id,
          primaryAgent.transport,
          primaryAgent.session_id,
          undefined,
        );
      }
    }

    const preview = (previewStmt.get(r.id) as { body: string } | null)?.body ?? null;

    return [{
      id: r.id,
      kind: r.kind,
      title: agentName ?? r.title,
      participantIds: participants,
      agentId,
      agentName,
      harness,
      harnessSessionId,
      harnessLogPath,
      currentBranch: branch,
      preview: preview ? preview.slice(0, 200) : null,
      messageCount: stats?.cnt ?? 0,
      lastMessageAt: stats?.last_at ?? null,
      workspaceRoot,
    }];
  });

  const deduped = new Map<string, MobileSessionSummary>();

  for (const summary of summaries) {
    if (
      summary.kind !== "direct"
      || !summary.agentId
      || !isLikelyLocalSessionAgentId(summary.agentId)
    ) {
      deduped.set(`id:${summary.id}`, summary);
      continue;
    }

    const key = `local-session-direct:${summary.agentId}`;
    const current = deduped.get(key);
    if (!current || shouldPreferSessionSummary(summary, current, summary.agentId)) {
      deduped.set(key, summary);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    const leftTs = left.lastMessageAt ?? 0;
    const rightTs = right.lastMessageAt ?? 0;
    if (rightTs !== leftTs) {
      return rightTs - leftTs;
    }
    return right.messageCount - left.messageCount;
  }).slice(0, limit);
}

export function querySessionById(conversationId: string): MobileSessionSummary | null {
  const results = querySessions(200);
  const existing = results.find((s) => s.id === conversationId) ?? null;
  if (existing) {
    return existing;
  }

  const directConversation = parseDirectConversationId(conversationId);
  if (!directConversation) {
    return null;
  }

  return synthesizeDirectSession(conversationId, directConversation.agentId, directConversation.operatorId);
}

/* ── ID derivation (no DB needed) ── */

/**
 * Derive the direct conversation ID for an operator↔agent chat.
 */
export function conversationIdForAgent(agentId: string): string {
  return buildDirectConversationId("operator", agentId);
}

function configuredOperatorActorIds(): string[] {
  const operatorName = resolveOperatorName().trim() || "operator";
  return Array.from(new Set(["operator", operatorName]));
}

function buildDirectConversationId(operatorId: string, agentId: string): string {
  return `dm.${operatorId}.${agentId}`;
}

function buildLegacyScoutSessionConversationId(agentId: string): string {
  return `dm.${[agentId, "scout.main.mini"].sort().join(".")}`;
}

function directConversationIdCandidates(agentId: string): string[] {
  const ids = [
    conversationIdForAgent(agentId),
    ...configuredOperatorActorIds().map((operatorId) => buildDirectConversationId(operatorId, agentId)),
  ];
  if (isLikelyLocalSessionAgentId(agentId)) {
    ids.push(buildLegacyScoutSessionConversationId(agentId));
  }
  return Array.from(new Set(ids));
}

function parseLegacyScoutSessionConversationId(conversationId: string): string | null {
  const match = conversationId.match(/^dm\.(local-session-agent-[^.]+)\.scout\.main\.mini$/);
  return match?.[1] ?? null;
}

function conversationIdAliases(conversationId: string): string[] {
  const fromDirect = parseDirectConversationId(conversationId);
  if (fromDirect && isLikelyLocalSessionAgentId(fromDirect.agentId)) {
    return directConversationIdCandidates(fromDirect.agentId);
  }

  const fromLegacyScout = parseLegacyScoutSessionConversationId(conversationId);
  if (fromLegacyScout) {
    return directConversationIdCandidates(fromLegacyScout);
  }

  return [conversationId];
}

function parseDirectConversationId(conversationId: string): { operatorId: string; agentId: string } | null {
  const legacyScoutAgentId = parseLegacyScoutSessionConversationId(conversationId);
  if (legacyScoutAgentId) {
    return { operatorId: "operator", agentId: legacyScoutAgentId };
  }

  for (const operatorId of configuredOperatorActorIds()) {
    const prefix = `dm.${operatorId}.`;
    if (!conversationId.startsWith(prefix)) {
      continue;
    }

    const agentId = conversationId.slice(prefix.length);
    if (agentId.length > 0) {
      return { operatorId, agentId };
    }
  }

  return null;
}

function synthesizeDirectSession(
  conversationId: string,
  agentId: string,
  operatorId: string,
): MobileSessionSummary | null {
  const agent = db().prepare(
     `SELECT
        a.id AS agent_id,
        ac.display_name,
        ep.harness,
        ep.transport,
        ep.project_root,
       ep.session_id,
       ep.metadata_json AS endpoint_metadata_json,
        a.metadata_json
      FROM agents a
      JOIN actors ac ON ac.id = a.id
      ${LATEST_AGENT_ENDPOINT_JOIN}
      WHERE a.id = ?`,
  ).get(agentId) as {
    agent_id: string;
    display_name: string;
    harness: string | null;
    transport: string | null;
    project_root: string | null;
    session_id: string | null;
    endpoint_metadata_json: string | null;
    metadata_json: string | null;
  } | null;

  if (!agent) {
    return null;
  }

  let currentBranch: string | null = null;
  let endpointMeta: Record<string, unknown> = {};
  try {
    const metadata = agent.metadata_json ? JSON.parse(agent.metadata_json) : {};
    currentBranch = (metadata.branch as string) ?? (metadata.workspaceQualifier as string) ?? null;
  } catch {}
  try {
    endpointMeta = agent.endpoint_metadata_json ? JSON.parse(agent.endpoint_metadata_json) : {};
  } catch {}

  return {
    id: conversationId,
    kind: "direct",
    title: agent.display_name,
    participantIds: [operatorId, agentId],
    agentId,
    agentName: agent.display_name,
    harness: agent.harness,
    harnessSessionId: resolveHarnessSessionId(agent.transport, agent.session_id, endpointMeta),
    harnessLogPath: resolveHarnessLogPath(
      agentId,
      agent.transport,
      agent.session_id,
      endpointMeta,
    ),
    currentBranch,
    preview: null,
    messageCount: 0,
    lastMessageAt: null,
    workspaceRoot: compact(agent.project_root),
  };
}

/* ── Mobile-compatible queries ── */
/* Return the same shapes the iOS app expects so the bridge router
   can serve reads from SQLite instead of expensive broker snapshots. */

export type MobileAgentSummary = {
  id: string;
  title: string;
  selector: string | null;
  defaultSelector: string | null;
  workspaceRoot: string | null;
  harness: string | null;
  transport: string | null;
  state: "offline" | "available" | "working";
  statusLabel: string;
  sessionId: string | null;
  lastActiveAt: number | null;
};

export function queryMobileAgents(limit = 50): MobileAgentSummary[] {
  const executingAgentIds = queryExecutingAgentIds();

  // Latest message timestamp per actor (for lastActiveAt)
  const lastMessageAt = new Map(
    (db().prepare(
      `SELECT actor_id, MAX(created_at) AS last_at FROM messages GROUP BY actor_id`,
    ).all() as Array<{ actor_id: string; last_at: number }>).map((r) => [r.actor_id, r.last_at]),
  );

  const rows = db().prepare(
    `SELECT
       a.id,
       ac.display_name,
       a.default_selector,
       a.metadata_json,
       ep.harness,
       ep.transport,
       ep.state,
       ep.project_root,
       ep.session_id,
       ep.updated_at
     FROM agents a
     JOIN actors ac ON ac.id = a.id
     ${LATEST_AGENT_ENDPOINT_JOIN}
     ORDER BY COALESCE(ep.updated_at, 0) DESC, ac.display_name ASC
     LIMIT ?`,
  ).all(limit) as Array<{
    id: string;
    display_name: string;
    default_selector: string | null;
    metadata_json: string | null;
    harness: string | null;
    transport: string | null;
    state: string | null;
    project_root: string | null;
    session_id: string | null;
    updated_at: number | null;
  }>;

  return rows.map((r) => {
    let meta: Record<string, unknown> = {};
    try { meta = r.metadata_json ? JSON.parse(r.metadata_json) : {}; } catch {}

    const isWorking = executingAgentIds.has(r.id);
    const state = summarizeAgentState(r.state, isWorking);
    const statusLabel = summarizeAgentStatusLabel(r.state, isWorking);

    return {
      id: r.id,
      title: r.display_name,
      selector: (meta.selector as string) ?? null,
      defaultSelector: r.default_selector,
      workspaceRoot: compact(r.project_root),
      harness: r.harness,
      transport: r.transport,
      state,
      statusLabel,
      sessionId: conversationIdForAgent(r.id),
      lastActiveAt: lastMessageAt.get(r.id) ?? null,
    };
  });
}

export type MobileSessionSummary = {
  id: string;
  kind: string;
  title: string;
  participantIds: string[];
  agentId: string | null;
  agentName: string | null;
  harness: string | null;
  harnessSessionId: string | null;
  harnessLogPath: string | null;
  currentBranch: string | null;
  preview: string | null;
  messageCount: number;
  lastMessageAt: number | null;
  workspaceRoot: string | null;
};

export function queryMobileSessions(limit = 50): MobileSessionSummary[] {
  const rows = db().prepare(
    `SELECT
       c.id,
       c.kind,
       c.title,
       c.metadata_json
     FROM conversations c
     WHERE c.kind = 'direct'
     ORDER BY c.created_at DESC
     LIMIT ?`,
  ).all(limit) as Array<{
    id: string;
    kind: string;
    title: string;
    metadata_json: string | null;
  }>;

  // Batch-load participants, message stats, and latest preview
  const memberStmt = db().prepare(
    `SELECT actor_id FROM conversation_members WHERE conversation_id = ?`,
  );
  const statsStmt = db().prepare(
    `SELECT COUNT(*) AS cnt, MAX(created_at) AS last_at FROM messages WHERE conversation_id = ?`,
  );
  const previewStmt = db().prepare(
    `SELECT body
     FROM messages m
     WHERE conversation_id = ?
       AND actor_id != 'operator'
       AND ${transientBrokerWorkingStatusPredicate("m")}
     ORDER BY created_at DESC LIMIT 1`,
  );

  return rows.map((r) => {
    const participants = (memberStmt.all(r.id) as Array<{ actor_id: string }>)
      .map((m) => m.actor_id);
    const agentId = participants.find((p) => p !== "operator") ?? null;
    const stats = statsStmt.get(r.id) as { cnt: number; last_at: number | null } | null;

    // Get agent details if available
    let agentName: string | null = null;
    let harness: string | null = null;
    let harnessSessionId: string | null = null;
    let harnessLogPath: string | null = null;
    let branch: string | null = null;
    let workspaceRoot: string | null = null;

    if (agentId) {
      const agentRow = db().prepare(
        `SELECT
           ac.display_name,
           ep.harness,
           ep.transport,
           ep.project_root,
           ep.session_id,
           ep.metadata_json AS endpoint_metadata_json,
           a.metadata_json
         FROM agents a
         JOIN actors ac ON ac.id = a.id
         ${LATEST_AGENT_ENDPOINT_JOIN}
         WHERE a.id = ?`,
      ).get(agentId) as {
        display_name: string;
        harness: string | null;
        transport: string | null;
        project_root: string | null;
        session_id: string | null;
        endpoint_metadata_json: string | null;
        metadata_json: string | null;
      } | null;

      if (agentRow) {
        agentName = agentRow.display_name;
        harness = agentRow.harness;
        workspaceRoot = compact(agentRow.project_root);
        try {
          const meta = agentRow.metadata_json ? JSON.parse(agentRow.metadata_json) : {};
          branch = (meta.branch as string) ?? (meta.workspaceQualifier as string) ?? null;
        } catch {}
        try {
          const endpointMeta = agentRow.endpoint_metadata_json
            ? JSON.parse(agentRow.endpoint_metadata_json)
            : {};
          harnessSessionId = resolveHarnessSessionId(
            agentRow.transport,
            agentRow.session_id,
            endpointMeta,
          );
          harnessLogPath = resolveHarnessLogPath(
            agentId,
            agentRow.transport,
            agentRow.session_id,
            endpointMeta,
          );
        } catch {
          harnessSessionId = resolveHarnessSessionId(
            agentRow.transport,
            agentRow.session_id,
            undefined,
          );
          harnessLogPath = resolveHarnessLogPath(
            agentId,
            agentRow.transport,
            agentRow.session_id,
            undefined,
          );
        }
      }
    }

    const preview = (previewStmt.get(r.id) as { body: string } | null)?.body ?? null;

    return {
      id: r.id,
      kind: r.kind,
      title: agentName ?? r.title,
      participantIds: participants,
      agentId,
      agentName,
      harness,
      harnessSessionId,
      harnessLogPath,
      currentBranch: branch,
      preview: preview ? preview.slice(0, 200) : null,
      messageCount: stats?.cnt ?? 0,
      lastMessageAt: stats?.last_at ?? null,
      workspaceRoot,
    };
  });
}

export type MobileWorkspaceSummary = {
  id: string;
  title: string;
  projectName: string;
  root: string;
  sourceRoot: string;
  relativePath: string;
  registrationKind: string;
  defaultHarness: string;
  harnesses: Array<{
    harness: string;
    source: "manifest" | "marker" | "default" | "endpoint";
    detail: string;
    readinessState: "ready" | "configured" | "installed" | "missing" | null;
    readinessDetail: string | null;
  }>;
};

/** Derive workspaces from agents in the DB — no filesystem scan needed. */
export function queryMobileWorkspaces(limit = 50): MobileWorkspaceSummary[] {
  const rows = db().prepare(
    `SELECT DISTINCT
       ep.project_root,
       ac.display_name,
       a.metadata_json,
       ep.harness
     FROM agents a
     JOIN actors ac ON ac.id = a.id
     LEFT JOIN agent_endpoints ep ON ep.agent_id = a.id
     WHERE ep.project_root IS NOT NULL
     ORDER BY ep.updated_at DESC NULLS LAST
     LIMIT ?`,
  ).all(limit) as Array<{
    project_root: string;
    display_name: string;
    metadata_json: string | null;
    harness: string | null;
  }>;

  const seen = new Set<string>();
  const results: MobileWorkspaceSummary[] = [];

  for (const r of rows) {
    if (seen.has(r.project_root)) continue;
    seen.add(r.project_root);

    let meta: Record<string, unknown> = {};
    try { meta = r.metadata_json ? JSON.parse(r.metadata_json) : {}; } catch {}

    const projectName = (meta.project as string) ?? r.project_root.split("/").pop() ?? "unknown";
    const relativePath = r.project_root.replace(HOME + "/", "");

    results.push({
      id: r.project_root,
      title: projectName,
      projectName,
      root: r.project_root,
      sourceRoot: r.project_root,
      relativePath,
      registrationKind: "agent",
      defaultHarness: r.harness ?? "claude",
      harnesses: r.harness
        ? [{
            harness: r.harness,
            source: "default",
            detail: "Current endpoint",
            readinessState: "ready",
            readinessDetail: null,
          }]
        : [],
    });
  }

  return results;
}

/* ── Agent detail (single agent, richer data) ── */

export type MobileAgentDetail = MobileAgentSummary & {
  cwd: string | null;
  wakePolicy: string | null;
  capabilities: string[];
  branch: string | null;
  role: string | null;
  model: string | null;
  activeFlights: Array<{
    id: string;
    state: string;
    summary: string | null;
    startedAt: number | null;
  }>;
  recentActivity: Array<{
    id: string;
    kind: string;
    ts: number;
    title: string | null;
    summary: string | null;
  }>;
  messageCount: number;
};

export function queryMobileAgentDetail(agentId: string): MobileAgentDetail | null {
  const row = db().prepare(
    `SELECT
       a.id,
       ac.display_name,
       a.default_selector,
       a.wake_policy,
       a.capabilities_json,
       a.metadata_json,
       ep.harness,
       ep.transport,
       ep.state,
       ep.project_root,
       ep.cwd,
       ep.session_id,
       ep.updated_at
     FROM agents a
     JOIN actors ac ON ac.id = a.id
     ${LATEST_AGENT_ENDPOINT_JOIN}
     WHERE a.id = ?`,
  ).get(agentId) as {
    id: string;
    display_name: string;
    default_selector: string | null;
    wake_policy: string | null;
    capabilities_json: string | null;
    metadata_json: string | null;
    harness: string | null;
    transport: string | null;
    state: string | null;
    project_root: string | null;
    cwd: string | null;
    session_id: string | null;
    updated_at: number | null;
  } | null;

  if (!row) return null;

  let meta: Record<string, unknown> = {};
  try { meta = row.metadata_json ? JSON.parse(row.metadata_json) : {}; } catch {}

  let capabilities: string[] = [];
  try { capabilities = row.capabilities_json ? JSON.parse(row.capabilities_json) : []; } catch {}

  const executingAgentIds = queryExecutingAgentIds();

  const activeFlights = (db().prepare(
    `SELECT id, state, summary, started_at
     FROM flights
     WHERE target_agent_id = ? AND state NOT IN ('completed','failed','cancelled')
     ORDER BY started_at DESC`,
  ).all(agentId) as Array<{
    id: string;
    state: string;
    summary: string | null;
    started_at: number | null;
  }>).map((f) => ({
    id: f.id,
    state: f.state,
    summary: f.summary,
    startedAt: f.started_at,
  }));

  const recentActivity = (db().prepare(
    `SELECT ai.id, ai.kind, ai.ts, ai.title, ai.summary
     FROM activity_items ai
     WHERE ai.actor_id = ?
     ORDER BY ai.ts DESC
     LIMIT 20`,
  ).all(agentId) as Array<{
    id: string;
    kind: string;
    ts: number;
    title: string | null;
    summary: string | null;
  }>).map((a) => ({
    id: a.id,
    kind: a.kind,
    ts: a.ts,
    title: a.title,
    summary: a.summary,
  }));

  const msgRow = db().prepare(
    `SELECT COUNT(*) AS cnt FROM messages WHERE conversation_id = ?`,
  ).get(conversationIdForAgent(agentId)) as { cnt: number } | null;
  const messageCount = msgRow?.cnt ?? 0;

  const lastMessageAt = (db().prepare(
    `SELECT MAX(created_at) AS last_at FROM messages WHERE actor_id = ?`,
  ).get(agentId) as { last_at: number | null } | null)?.last_at ?? null;

  const isWorking = executingAgentIds.has(row.id);
  const state = summarizeAgentState(row.state, isWorking);
  const statusLabel = summarizeAgentStatusLabel(row.state, isWorking);

  return {
    id: row.id,
    title: row.display_name,
    selector: (meta.selector as string) ?? null,
    defaultSelector: row.default_selector,
    workspaceRoot: compact(row.project_root),
    harness: row.harness,
    transport: row.transport,
    state,
    statusLabel,
    sessionId: conversationIdForAgent(row.id),
    lastActiveAt: lastMessageAt,
    cwd: compact(row.cwd),
    wakePolicy: row.wake_policy,
    capabilities,
    branch: (meta.branch as string) ?? null,
    role: (meta.role as string) ?? null,
    model: (meta.model as string) ?? null,
    activeFlights,
    recentActivity,
    messageCount,
  };
}

/* ── Fleet ── */

export type WebFleetActivity = WebActivityItem & {
  actorId: string | null;
  agentId: string | null;
  flightId: string | null;
  invocationId: string | null;
  messageId: string | null;
  recordId: string | null;
  sessionId: string | null;
};

export type WebFleetAskStatus =
  | "queued"
  | "working"
  | "needs_attention"
  | "completed"
  | "failed";

export type WebFleetAsk = {
  invocationId: string;
  flightId: string | null;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  collaborationRecordId: string | null;
  task: string;
  status: WebFleetAskStatus;
  statusLabel: string;
  attention: WorkAttention;
  agentState: AgentSummaryState;
  harness: string | null;
  transport: string | null;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
};

export type WebFleetAttentionItem = {
  kind: "question" | "work_item";
  recordId: string;
  title: string;
  summary: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  state: string;
  acceptanceState: string;
  updatedAt: number;
};

export type WebFleetState = {
  generatedAt: number;
  totals: {
    active: number;
    recentCompleted: number;
    needsAttention: number;
    activity: number;
  };
  activeAsks: WebFleetAsk[];
  recentCompleted: WebFleetAsk[];
  needsAttention: WebFleetAttentionItem[];
  activity: WebFleetActivity[];
};

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
    flightId: row.flight_id,
    invocationId: row.invocation_id,
    messageId: row.message_id,
    recordId: row.record_id,
    sessionId: row.session_id,
  };
}

function queryFleetActivity(opts?: {
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
    ai.message_id,
    ai.invocation_id,
    ai.flight_id,
    ai.record_id,
    ai.session_id
  FROM activity_items ai
  LEFT JOIN actors ac ON ac.id = ai.actor_id
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

function queryFleetAskRows(requesterIds: string[], limit: number): FleetAskRow[] {
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
  const isActiveFlight = hasFlight && row.flight_state !== null && !TERMINAL_FLIGHT_STATES.has(row.flight_state);
  const awaitingOperator = Boolean(
    (row.next_move_owner_id && requesterIdSet.has(row.next_move_owner_id))
    || row.acceptance_state === "pending",
  );

  let status: WebFleetAskStatus;
  if (!hasFlight) {
    status = "queued";
  } else if (isActiveFlight) {
    status = "working";
  } else if (awaitingOperator) {
    status = "needs_attention";
  } else if (row.flight_state === "failed" || row.status_kind === "ask_failed") {
    status = "failed";
  } else {
    status = "completed";
  }

  const updatedAt = normalizeTimestampMs(
    row.status_ts ?? row.completed_at ?? row.started_at ?? row.work_updated_at ?? row.created_at,
  ) ?? Date.now();

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
    attention: status === "needs_attention" ? "badge" : status === "failed" ? "interrupt" : "silent",
    agentState: summarizeAgentState(row.endpoint_state, isExecutingFlightState(row.flight_state)),
    harness: row.harness,
    transport: row.transport,
    summary: row.status_summary ?? row.status_title ?? row.flight_summary ?? row.work_summary ?? row.work_title ?? null,
    startedAt: normalizeTimestampMs(row.started_at ?? row.created_at),
    completedAt: normalizeTimestampMs(row.completed_at),
    updatedAt,
  };
}

function queryFleetAttentionRows(requesterIds: string[], limit: number): FleetAttentionRow[] {
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
         OR cr.acceptance_state = 'pending'
       )
     ORDER BY cr.updated_at DESC
     LIMIT ?`,
  ).all(...requesterIds, limit) as Array<FleetAttentionRow>;
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
    .filter((ask) => ask.status === "completed" || ask.status === "failed")
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

/* ── Heartrate: smoothed activity over a trailing 7-day window ── */

export type HeartrateBucket = { ts: number; count: number; value: number };

type HeartrateResult = { windowLabel: string; bucketLabel: string; buckets: HeartrateBucket[] };

const HEARTRATE_WINDOW_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_HEARTRATE_BUCKETS = 56;
const SQLITE_MILLISECONDS_THRESHOLD = 1e12;

function normalizeActivityTimestampMs(ts: number): number {
  return ts < SQLITE_MILLISECONDS_THRESHOLD ? ts * 1000 : ts;
}

function smoothHeartrateCounts(counts: number[]): number[] {
  const energy = counts.map((count) => Math.sqrt(count));
  const weights = [0.56, 0.28, 0.11, 0.05];

  return energy.map((_, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -3; offset <= 3; offset++) {
      const nextIndex = index + offset;
      if (nextIndex < 0 || nextIndex >= energy.length) continue;
      const weight = weights[Math.abs(offset)] ?? 0;
      total += energy[nextIndex] * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? total / weightTotal : 0;
  });
}

function formatHeartrateBucketLabel(bucketMs: number): string {
  const minutes = Math.round(bucketMs / 60_000);
  if (minutes % (24 * 60) === 0) {
    return `${minutes / (24 * 60)}d buckets`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60}h buckets`;
  }
  return `${minutes}m buckets`;
}

export function queryHeartrate(
  numBuckets = DEFAULT_HEARTRATE_BUCKETS,
  nowMs = Date.now(),
): HeartrateResult {
  const bucketMs = HEARTRATE_WINDOW_MS / numBuckets;
  const currentBucketStart = Math.floor(nowMs / bucketMs) * bucketMs;
  const alignedStart = currentBucketStart - (numBuckets - 1) * bucketMs;
  const alignedStartSeconds = Math.floor(alignedStart / 1000);

  const rows = db()
    .prepare(
      `SELECT ts
       FROM activity_items
       WHERE ts >= ?1
          OR (ts < ?2 AND ts >= ?3)
       ORDER BY ts ASC`,
    )
    .all(alignedStart, SQLITE_MILLISECONDS_THRESHOLD, alignedStartSeconds) as Array<{ ts: number }>;

  const counts = new Array<number>(numBuckets).fill(0);
  for (const row of rows) {
    const ms = normalizeActivityTimestampMs(row.ts);
    if (ms < alignedStart || ms > nowMs) continue;
    const idx = Math.min(numBuckets - 1, Math.floor((ms - alignedStart) / bucketMs));
    if (idx >= 0) counts[idx]++;
  }

  const smoothed = smoothHeartrateCounts(counts);
  const peak = Math.max(1, ...smoothed);
  return {
    windowLabel: "trailing 7d",
    bucketLabel: formatHeartrateBucketLabel(bucketMs),
    buckets: counts.map((count, i) => ({
      ts: Math.round(alignedStart + i * bucketMs),
      count,
      value: smoothed[i] / peak,
    })),
  };
}
