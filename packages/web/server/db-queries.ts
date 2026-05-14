/**
 * Direct SQLite reads for the web UI.
 *
 * All queries hit the control-plane database in readonly mode — no shell
 * commands, no tmux, no snapshot rebuilds.  Bun's native SQLite driver is
 * synchronous and fast (< 1 ms for the queries below on a typical machine).
 *
 * Most domains have been split into per-file modules under `./db/` as
 * part of SCO-031 Phase C. The session/conversation cluster
 * (`querySessions`, `querySessionById`, `queryConversationDefinitionById`,
 * `synthesizeDirectSession`, the participant pickers) stays here pending
 * the next step that introduces `ConversationsRepo` (SCO-031 §5 + SCO-030).
 *
 * Identity helpers (`conversationIdForAgent` and friends) physically live
 * in `./db/internal/conversation-ids.ts` to avoid an import cycle once
 * domain files needed them. Their canonical home migrates to
 * `ConversationsRepo` in the next phase.
 */

import {
  closeDb,
  configureReadonlyDb,
  db,
} from "./db/internal/db.ts";
import {
  configuredOperatorActorIds,
  conversationIdForAgent,
  isLikelyLocalSessionAgentId,
  parseDirectConversationId,
} from "./db/internal/conversation-ids.ts";
import {
  compact,
  resolveHarnessLogPath,
  resolveHarnessSessionId,
} from "./db/internal/paths.ts";
import {
  LATEST_AGENT_ENDPOINT_JOIN,
  transientBrokerWorkingStatusPredicate,
} from "./db/internal/sql-helpers.ts";

// Re-export internal helpers so existing consumers of db-queries.ts keep working.
export { closeDb, configureReadonlyDb };
// The canonical conversation-ID derivation for the operator↔agent direct
// chat — re-exported here for back-compat with consumers that imported it
// before the SCO-031 split.
export { conversationIdForAgent } from "./db/internal/conversation-ids.ts";

/* ── Types ──
 *
 * Public type surface lives in `./db/types/`. Phase B keeps the
 * `import { WebAgent, ... } from "./db-queries.ts"` consumer API valid by
 * re-exporting from this module.
 */

export type {
  WebActivityItem,
  WebAgent,
  WebAgentRun,
  WebBrokerDialogueItem,
  WebBrokerDiagnostics,
  WebBrokerRouteAttempt,
  WebFleetActivity,
  WebFleetAsk,
  WebFleetAskStatus,
  WebFleetAttentionItem,
  WebFleetState,
  WebFlight,
  WebFollowTarget,
  WebMessage,
  WebWorkDetail,
  WebWorkItem,
  WebWorkTimelineItem,
  WebWorkTimelineKind,
} from "./db/types/web.ts";
export type {
  MobileAgentDetail,
  MobileAgentSummary,
  MobileSessionSummary,
  MobileWorkspaceSummary,
} from "./db/types/mobile.ts";
export type { HeartrateBucket } from "./db/types/common.ts";

import type { MobileSessionSummary } from "./db/types/mobile.ts";

/* ── Re-exports for queries moved to per-domain files (SCO-031 Phase C) ── */

export { queryAgents } from "./db/agents.ts";
export { queryRecentMessages } from "./db/messages.ts";
export { queryActivity, queryHeartrate } from "./db/activity.ts";
export { queryBrokerDiagnostics } from "./db/broker.ts";
export {
  queryRuns,
  queryFlights,
  queryFlightRecordById,
  queryFollowTarget,
} from "./db/runs.ts";
export {
  queryWorkItemById,
  queryWorkItems,
} from "./db/work.ts";
export {
  queryFleet,
  queryFleetActivity,
  queryFleetAskRows,
  queryFleetAttentionRows,
} from "./db/fleet.ts";
export {
  queryMobileAgents,
  queryMobileAgentDetail,
} from "./db/mobile/agents.ts";
export { queryMobileSessions } from "./db/mobile/sessions.ts";
export { queryMobileWorkspaces } from "./db/mobile/workspaces.ts";

/* ── Sessions (all conversation kinds) ──
 *
 * These remain in db-queries.ts pending the SCO-031 §5 introduction of
 * `ConversationsRepo`, which will take over conversation identity reads
 * across runtime and web.
 */

function pickDirectConversationAgentId(
  participants: string[],
  candidateAgentIds: string[],
): string | null {
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

export function queryConversationDefinitionById(
  conversationId: string,
): {
  id: string;
  kind: string;
  title: string;
  visibility: string;
  shareMode: string;
  authorityNodeId: string;
  topic: string | null;
  parentConversationId: string | null;
  messageId: string | null;
  metadata: Record<string, unknown>;
  participantIds: string[];
} | null {
  const row = db().prepare(
    `SELECT id, kind, title, visibility, share_mode, authority_node_id,
            topic, parent_conversation_id, message_id, metadata_json
     FROM conversations WHERE id = ?`,
  ).get(conversationId) as {
    id: string;
    kind: string;
    title: string;
    visibility: string;
    share_mode: string;
    authority_node_id: string;
    topic: string | null;
    parent_conversation_id: string | null;
    message_id: string | null;
    metadata_json: string | null;
  } | null;
  if (!row) return null;
  const participants = (db().prepare(
    `SELECT actor_id FROM conversation_members WHERE conversation_id = ?`,
  ).all(conversationId) as Array<{ actor_id: string }>).map((m) => m.actor_id);
  let metadata: Record<string, unknown> = {};
  if (row.metadata_json) {
    try { metadata = JSON.parse(row.metadata_json) as Record<string, unknown>; } catch {}
  }
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    visibility: row.visibility,
    shareMode: row.share_mode,
    authorityNodeId: row.authority_node_id,
    topic: row.topic,
    parentConversationId: row.parent_conversation_id,
    messageId: row.message_id,
    metadata,
    participantIds: participants,
  };
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
