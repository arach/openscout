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
};

/* ── DB path ── */

function resolveDbPath(): string {
  const controlHome =
    process.env.OPENSCOUT_CONTROL_HOME ??
    join(homedir(), ".openscout", "control-plane");
  return join(controlHome, "control-plane.sqlite");
}

/* ── Singleton readonly connection ── */

let _db: Database | null = null;

function db(): Database {
  if (!_db) {
    _db = new Database(resolveDbPath(), { readonly: true });
    _db.exec("PRAGMA journal_mode = WAL");
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

/* ── Queries ── */

export function queryAgents(limit = 50): WebAgent[] {
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
         ep.updated_at
       FROM agents a
       JOIN actors ac ON ac.id = a.id
       LEFT JOIN agent_endpoints ep ON ep.agent_id = a.id
       ORDER BY ep.updated_at DESC NULLS LAST
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
    updated_at: number | null;
  }>;

  return rows.map((r) => {
    let capabilities: string[] = [];
    try { capabilities = r.capabilities_json ? JSON.parse(r.capabilities_json) : []; } catch {}

    let meta: Record<string, unknown> = {};
    try { meta = r.metadata_json ? JSON.parse(r.metadata_json) : {}; } catch {}

    return {
      id: r.id,
      name: r.name,
      handle: r.handle,
      agentClass: r.agent_class,
      harness: r.harness,
      state: r.state,
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

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    ts: r.ts,
    actorName: r.actor_name,
    title: r.title,
    summary: r.summary,
    conversationId: r.conversation_id,
    workspaceRoot: compact(r.workspace_root),
  }));
}

export function queryRecentMessages(limit = 80): WebMessage[] {
  const rows = db()
    .prepare(
      `SELECT
         m.id,
         m.conversation_id,
         ac.display_name AS actor_name,
         m.body,
         m.created_at,
         m.class
       FROM messages m
       JOIN actors ac ON ac.id = m.actor_id
       ORDER BY m.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    conversation_id: string;
    actor_name: string;
    body: string;
    created_at: number;
    class: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    actorName: r.actor_name,
    body: r.body,
    createdAt: r.created_at,
    class: r.class,
  }));
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
  // Active flights determine "working" state
  const workingAgentIds = new Set(
    (db().prepare(
      `SELECT DISTINCT target_agent_id FROM flights
       WHERE state NOT IN ('completed','failed','cancelled')`,
    ).all() as Array<{ target_agent_id: string }>).map((r) => r.target_agent_id),
  );

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
     LEFT JOIN agent_endpoints ep ON ep.agent_id = a.id
     ORDER BY ep.updated_at DESC NULLS LAST
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

    const isWorking = workingAgentIds.has(r.id);
    const state: MobileAgentSummary["state"] = isWorking
      ? "working"
      : r.state && r.state !== "offline" ? "available" : "offline";

    const statusLabel = isWorking
      ? "Working"
      : r.state === "active" ? "Available"
      : r.state ?? "Offline";

    return {
      id: r.id,
      title: r.display_name,
      selector: (meta.selector as string) ?? null,
      defaultSelector: r.default_selector,
      workspaceRoot: compact(r.project_root),
      harness: r.harness,
      transport: r.transport,
      state,
      statusLabel: statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1),
      sessionId: r.session_id,
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
    `SELECT body FROM messages WHERE conversation_id = ? AND actor_id != 'operator'
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
    let branch: string | null = null;
    let workspaceRoot: string | null = null;

    if (agentId) {
      const agentRow = db().prepare(
        `SELECT ac.display_name, ep.harness, ep.project_root, a.metadata_json
         FROM agents a
         JOIN actors ac ON ac.id = a.id
         LEFT JOIN agent_endpoints ep ON ep.agent_id = a.id
         WHERE a.id = ?`,
      ).get(agentId) as {
        display_name: string;
        harness: string | null;
        project_root: string | null;
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
      }
    }

    const preview = (previewStmt.get(r.id) as { body: string } | null)?.body ?? null;

    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      participantIds: participants,
      agentId,
      agentName,
      harness,
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
