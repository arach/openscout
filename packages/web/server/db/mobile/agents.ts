/**
 * Mobile-shaped agent listing and detail queries.
 *
 * Lifted from db-queries.ts as part of SCO-031 Phase C. These return the
 * `Mobile*` shapes that the iOS app's bridge router consumes; the
 * web-shaped equivalents live in `../agents.ts`.
 */

import { db } from "../internal/db.ts";
import { conversationIdForAgent } from "../internal/conversation-ids.ts";
import { compact } from "../internal/paths.ts";
import {
  LATEST_AGENT_ENDPOINT_JOIN,
  PRIMARY_AGENT_ENDPOINT_JOIN,
  activeAgentMetadataPredicate,
  queryExecutingAgentIds,
  sqlTimestampMsExpression,
  summarizeAgentState,
  summarizeAgentStatusLabel,
} from "../internal/sql-helpers.ts";
import type {
  MobileAgentDetail,
  MobileAgentSummary,
} from "../types/mobile.ts";

/**
 * The conversation the phone should open for an agent. Mirrors the broker
 * snapshot resolver (`resolveMobileConversation` in core/mobile/service): the
 * operator DM if it exists, else the most-recent conversation the agent has
 * posted in (its ask/`c.…` thread), else the canonical operator-DM id the broker
 * will create on first send. The phone routes taps by this — NOT `sessionId`,
 * which is only ever the operator-DM id and so misses ask threads (the bug where
 * multi-agent-project transcripts came up blank). Single-agent version for the
 * detail query; the list query (`queryMobileAgents`) resolves the same thing in
 * batch.
 */
function resolveAgentConversationId(agentId: string): string {
  const dm = conversationIdForAgent(agentId);
  if (db().prepare(`SELECT 1 FROM conversations WHERE id = ? LIMIT 1`).get(dm)) {
    return dm;
  }
  const recent = db().prepare(
    `SELECT conversation_id FROM messages WHERE actor_id = ?
       GROUP BY conversation_id ORDER BY MAX(created_at) DESC LIMIT 1`,
  ).get(agentId) as { conversation_id: string } | undefined;
  return recent?.conversation_id ?? dm;
}

export function queryMobileAgents(
  limit = 50,
  filters: { query?: string | null } = {},
): MobileAgentSummary[] {
  const executingAgentIds = queryExecutingAgentIds();
  const messageCreatedAtExpression = sqlTimestampMsExpression("created_at");
  const endpointUpdatedAtExpression = sqlTimestampMsExpression("ep.updated_at");
  const query = filters.query?.trim().toLowerCase();
  const whereClauses = [activeAgentMetadataPredicate("a")];
  const params: Array<string | number> = [];
  if (query) {
    whereClauses.push(`(
      lower(ac.display_name) LIKE ?
      OR lower(a.id) LIKE ?
      OR lower(COALESCE(a.default_selector, '')) LIKE ?
      OR lower(COALESCE(a.selector, '')) LIKE ?
      OR lower(COALESCE(ep.project_root, '')) LIKE ?
    )`);
    const pattern = `%${query}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  params.push(limit);

  // Latest message timestamp per actor (for lastActiveAt)
  const lastMessageAt = new Map(
    (db().prepare(
      `SELECT actor_id, MAX(${messageCreatedAtExpression}) AS last_at FROM messages GROUP BY actor_id`,
    ).all() as Array<{ actor_id: string; last_at: number }>).map((r) => [r.actor_id, r.last_at]),
  );

  // Conversation each agent should open (see `resolveAgentConversationId`).
  // Resolved in batch — the operator DMs that exist + the most-recent
  // conversation each actor has posted in — so the per-agent lookup below is a
  // map hit instead of two queries per row.
  const operatorDmIds = new Set(
    (db().prepare(
      `SELECT id FROM conversations WHERE id LIKE 'dm.operator.%'`,
    ).all() as Array<{ id: string }>).map((r) => r.id),
  );
  const recentConvByActor = new Map<string, string>();
  for (const r of db().prepare(
    `SELECT m.actor_id AS actor_id, m.conversation_id AS conversation_id
       FROM messages m
       JOIN (SELECT actor_id, MAX(created_at) AS mc FROM messages GROUP BY actor_id) t
         ON t.actor_id = m.actor_id AND t.mc = m.created_at`,
  ).all() as Array<{ actor_id: string; conversation_id: string }>) {
    if (!recentConvByActor.has(r.actor_id)) recentConvByActor.set(r.actor_id, r.conversation_id);
  }
  const resolveConversationId = (agentId: string): string => {
    const dm = conversationIdForAgent(agentId);
    if (operatorDmIds.has(dm)) return dm;
    return recentConvByActor.get(agentId) ?? dm;
  };

  const rows = db().prepare(
    `SELECT
       a.id,
       ac.display_name,
       a.default_selector,
       a.metadata_json,
       a.wake_policy,
       ep.harness,
       ep.transport,
       ep.state,
       ep.project_root,
       ep.session_id,
       ${endpointUpdatedAtExpression} AS updated_at
     FROM agents a
     JOIN actors ac ON ac.id = a.id
     ${PRIMARY_AGENT_ENDPOINT_JOIN}
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY COALESCE(${endpointUpdatedAtExpression}, 0) DESC, ac.display_name ASC
     LIMIT ?`,
  ).all(...params) as Array<{
    id: string;
    display_name: string;
    default_selector: string | null;
    metadata_json: string | null;
    wake_policy: string | null;
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
    const state = summarizeAgentState(r.state, isWorking, r.wake_policy);
    const statusLabel = summarizeAgentStatusLabel(r.state, isWorking, r.wake_policy);

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
      conversationId: resolveConversationId(r.id),
      lastActiveAt: lastMessageAt.get(r.id) ?? null,
    };
  });
}

/* ── Agent detail (single agent, richer data) ── */

export function queryMobileAgentDetail(agentId: string): MobileAgentDetail | null {
  const endpointUpdatedAtExpression = sqlTimestampMsExpression("ep.updated_at");
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
       ${endpointUpdatedAtExpression} AS updated_at
     FROM agents a
     JOIN actors ac ON ac.id = a.id
     ${PRIMARY_AGENT_ENDPOINT_JOIN}
     WHERE a.id = ?
       AND ${activeAgentMetadataPredicate("a")}`,
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
  const flightStartedAtExpression = sqlTimestampMsExpression("started_at");

  const activeFlights = (db().prepare(
    `SELECT id, state, summary, ${flightStartedAtExpression} AS started_at
     FROM flights
     WHERE target_agent_id = ? AND state NOT IN ('completed','failed','cancelled')
     ORDER BY ${flightStartedAtExpression} DESC`,
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

  const activityTsExpression = sqlTimestampMsExpression("ai.ts");
  const recentActivity = (db().prepare(
    `SELECT ai.id, ai.kind, ${activityTsExpression} AS ts, ai.title, ai.summary
     FROM activity_items ai
     WHERE ai.actor_id = ?
     ORDER BY ${activityTsExpression} DESC
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
    `SELECT MAX(${sqlTimestampMsExpression("created_at")}) AS last_at FROM messages WHERE actor_id = ?`,
  ).get(agentId) as { last_at: number | null } | null)?.last_at ?? null;

  const isWorking = executingAgentIds.has(row.id);
  const state = summarizeAgentState(row.state, isWorking, row.wake_policy);
  const statusLabel = summarizeAgentStatusLabel(row.state, isWorking, row.wake_policy);

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
    conversationId: resolveAgentConversationId(row.id),
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
