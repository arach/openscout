/**
 * Web-shaped agent listing queries.
 *
 * Lifted from db-queries.ts as part of SCO-031 Phase C. The
 * conversation-ID derivation for each agent is delegated to
 * `internal/conversation-ids.ts` so this module does not need to import
 * back into db-queries.ts.
 */

import { db } from "./internal/db.ts";
import { conversationIdForAgent } from "./internal/conversation-ids.ts";
import { metadataString } from "./internal/parse.ts";
import { compact, resolveHarnessLogPath, resolveHarnessSessionId } from "./internal/paths.ts";
import {
  LATEST_AGENT_ENDPOINT_JOIN,
  activeAgentMetadataPredicate,
  queryExecutingAgentIds,
  sqlTimestampMsExpression,
  summarizeAgentState,
} from "./internal/sql-helpers.ts";
import type { WebAgent } from "./types/web.ts";

type AgentQueryRow = {
  id: string;
  name: string;
  handle: string | null;
  actor_created_at: number | null;
  agent_class: string;
  default_selector: string | null;
  wake_policy: string | null;
  capabilities_json: string | null;
  metadata_json: string | null;
  authority_node_id: string | null;
  authority_node_name: string | null;
  home_node_id: string | null;
  home_node_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_handle: string | null;
  harness: string | null;
  transport: string | null;
  state: string | null;
  project_root: string | null;
  cwd: string | null;
  session_id: string | null;
  endpoint_metadata_json: string | null;
  updated_at: number | null;
};

export function queryAgents(limit = 500): WebAgent[] {
  const executingAgentIds = queryExecutingAgentIds();
  const actorCreatedAtExpression = sqlTimestampMsExpression("ac.created_at");
  const endpointUpdatedAtExpression = sqlTimestampMsExpression("ep.updated_at");
  const rows = db()
    .prepare(
      `SELECT
         a.id,
         ac.display_name AS name,
         ac.handle,
         ${actorCreatedAtExpression} AS actor_created_at,
         a.agent_class,
         a.default_selector,
         a.wake_policy,
         a.capabilities_json,
         a.metadata_json,
         a.authority_node_id,
         an.name AS authority_node_name,
         a.home_node_id,
         hn.name AS home_node_name,
         a.owner_id,
         oa.display_name AS owner_name,
         oa.handle AS owner_handle,
         ep.harness,
         ep.transport,
         ep.state,
         ep.project_root,
         ep.cwd,
         ep.session_id,
         ep.metadata_json AS endpoint_metadata_json,
         ${endpointUpdatedAtExpression} AS updated_at
       FROM agents a
       JOIN actors ac ON ac.id = a.id
       LEFT JOIN nodes an ON an.id = a.authority_node_id
       LEFT JOIN nodes hn ON hn.id = a.home_node_id
       LEFT JOIN actors oa ON oa.id = a.owner_id
       ${LATEST_AGENT_ENDPOINT_JOIN}
       WHERE ${activeAgentMetadataPredicate("a")}
       ORDER BY COALESCE(${endpointUpdatedAtExpression}, 0) DESC, ac.display_name ASC
       LIMIT ?`,
    )
    .all(limit) as AgentQueryRow[];

  return mapAgentRows(rows, executingAgentIds);
}

export function queryAgentById(agentId: string): WebAgent | null {
  const executingAgentIds = queryExecutingAgentIds();
  const actorCreatedAtExpression = sqlTimestampMsExpression("ac.created_at");
  const endpointUpdatedAtExpression = sqlTimestampMsExpression("ep.updated_at");
  const row = db()
    .prepare(
      `SELECT
         a.id,
         ac.display_name AS name,
         ac.handle,
         ${actorCreatedAtExpression} AS actor_created_at,
         a.agent_class,
         a.default_selector,
         a.wake_policy,
         a.capabilities_json,
         a.metadata_json,
         a.authority_node_id,
         an.name AS authority_node_name,
         a.home_node_id,
         hn.name AS home_node_name,
         a.owner_id,
         oa.display_name AS owner_name,
         oa.handle AS owner_handle,
         ep.harness,
         ep.transport,
         ep.state,
         ep.project_root,
         ep.cwd,
         ep.session_id,
         ep.metadata_json AS endpoint_metadata_json,
         ${endpointUpdatedAtExpression} AS updated_at
       FROM agents a
       JOIN actors ac ON ac.id = a.id
       LEFT JOIN nodes an ON an.id = a.authority_node_id
       LEFT JOIN nodes hn ON hn.id = a.home_node_id
       LEFT JOIN actors oa ON oa.id = a.owner_id
       ${LATEST_AGENT_ENDPOINT_JOIN}
       WHERE a.id = ?
         AND ${activeAgentMetadataPredicate("a")}
       LIMIT 1`,
    )
    .get(agentId) as AgentQueryRow | null;

  return row ? mapAgentRows([row], executingAgentIds)[0] ?? null : null;
}

function mapAgentRows(rows: AgentQueryRow[], executingAgentIds: Set<string>): WebAgent[] {
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
      state: summarizeAgentState(r.state, executingAgentIds.has(r.id), r.wake_policy),
      projectRoot: compact(r.project_root),
      cwd: compact(r.cwd),
      updatedAt: r.updated_at,
      createdAt: r.actor_created_at,
      transport: r.transport,
      selector: r.default_selector,
      wakePolicy: r.wake_policy,
      capabilities,
      project: (meta.project as string) ?? null,
      branch: (meta.branch as string) ?? null,
      role: (meta.role as string) ?? null,
      model: (meta.model as string) ?? metadataString(endpointMeta, "model"),
      harnessSessionId: resolveHarnessSessionId(r.transport, r.session_id, endpointMeta),
      harnessLogPath: resolveHarnessLogPath(r.id, r.transport, r.session_id, endpointMeta),
      conversationId: conversationIdForAgent(r.id),
      authorityNodeId: r.authority_node_id,
      authorityNodeName: r.authority_node_name,
      homeNodeId: r.home_node_id,
      homeNodeName: r.home_node_name,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      ownerHandle: r.owner_handle,
    };
  });
}
