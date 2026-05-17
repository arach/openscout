/**
 * Mobile-shaped agent listing and detail queries.
 *
 * Lifted from db-queries.ts as part of SCO-031 Phase C. These return the
 * `Mobile*` shapes that the iOS app's bridge router consumes; the
 * web-shaped equivalents live in `../agents.ts`.
 */

import { db } from "../internal/db.ts";
import { conversationIdForAgent } from "../internal/conversation-ids.ts";
import { normalizeTimestampMs } from "../internal/parse.ts";
import { compact } from "../internal/paths.ts";
import {
  LATEST_AGENT_ENDPOINT_JOIN,
  activeAgentMetadataPredicate,
  queryExecutingAgentIds,
  summarizeAgentState,
  summarizeAgentStatusLabel,
} from "../internal/sql-helpers.ts";
import type {
  MobileAgentDetail,
  MobileAgentSummary,
} from "../types/mobile.ts";

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
       a.wake_policy,
       ep.harness,
       ep.transport,
       ep.state,
       ep.project_root,
       ep.session_id,
       ep.updated_at
     FROM agents a
     JOIN actors ac ON ac.id = a.id
     ${LATEST_AGENT_ENDPOINT_JOIN}
     WHERE ${activeAgentMetadataPredicate("a")}
     ORDER BY COALESCE(ep.updated_at, 0) DESC, ac.display_name ASC
     LIMIT ?`,
  ).all(limit) as Array<{
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
      lastActiveAt: normalizeTimestampMs(lastMessageAt.get(r.id) ?? null),
    };
  });
}

/* ── Agent detail (single agent, richer data) ── */

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
