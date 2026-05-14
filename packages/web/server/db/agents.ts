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
import { metadataString, normalizeTimestampMs } from "./internal/parse.ts";
import { compact, resolveHarnessLogPath, resolveHarnessSessionId } from "./internal/paths.ts";
import {
  LATEST_AGENT_ENDPOINT_JOIN,
  activeAgentMetadataPredicate,
  queryExecutingAgentIds,
  summarizeAgentState,
} from "./internal/sql-helpers.ts";
import type { WebAgent } from "./types/web.ts";

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
       WHERE ${activeAgentMetadataPredicate("a")}
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
      state: summarizeAgentState(r.state, executingAgentIds.has(r.id), r.wake_policy),
      projectRoot: compact(r.project_root),
      cwd: compact(r.cwd),
      updatedAt: normalizeTimestampMs(r.updated_at),
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
    };
  });
}
