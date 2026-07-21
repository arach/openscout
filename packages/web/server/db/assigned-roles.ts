/**
 * Assigned roles + mission log — web-side control-plane DB access.
 *
 * Same WAL multi-process pattern as briefings.ts. Schema is owned by the
 * runtime control-plane store (role_assignments, mission_log_entries).
 */

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  appendMissionLogEntry,
  assignRole,
  getRoleAssignment,
  listMissionLogEntries,
  listRoleAssignments,
  revokeRole,
  type AssignRoleInput,
  type ListMissionLogOpts,
  type ListRoleAssignmentsOpts,
  type RevokeRoleInput,
} from "@openscout/runtime";
import type {
  ScoutMissionLogAppendInput,
  ScoutMissionLogEntry,
  ScoutRoleAssignment,
} from "@openscout/protocol";

const DB_BUSY_TIMEOUT_MS = 2_500;

let _db: Database | null = null;

function resolveDbPath(): string {
  const explicit = process.env.OPENSCOUT_CONTROL_PLANE_DB?.trim();
  if (explicit) return explicit;
  const controlHome =
    process.env.OPENSCOUT_CONTROL_HOME ??
    join(homedir(), ".openscout", "control-plane");
  return join(controlHome, "control-plane.sqlite");
}

function getDb(): Database {
  if (!_db) {
    _db = new Database(resolveDbPath(), { create: true });
    _db.exec(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS};`);
    _db.exec("PRAGMA journal_mode = WAL;");
    _db.exec("PRAGMA synchronous = NORMAL;");
    // Belt for brokers that have not yet migrated this process: ensure tables.
    ensureAssignedRolesTables(_db);
  }
  return _db;
}

function ensureAssignedRolesTables(db: Database): void {
  try {
    db.exec(`
CREATE TABLE IF NOT EXISTS role_assignments (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  mission_id TEXT,
  project_root TEXT,
  assigned_by_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  revoked_at INTEGER,
  revoked_by_id TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_role_assignments_agent_active
  ON role_assignments (agent_id, active);
CREATE INDEX IF NOT EXISTS idx_role_assignments_mission_role_active
  ON role_assignments (mission_id, role_id, active);
CREATE INDEX IF NOT EXISTS idx_role_assignments_role_active
  ON role_assignments (role_id, active);
CREATE TABLE IF NOT EXISTS mission_log_entries (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  node_id TEXT,
  at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  checkpoint TEXT,
  blockers_json TEXT,
  refs_json TEXT,
  note TEXT,
  metadata_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_log_entries_mission_seq
  ON mission_log_entries (mission_id, seq);
CREATE INDEX IF NOT EXISTS idx_mission_log_entries_mission_at
  ON mission_log_entries (mission_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_mission_log_entries_actor_at
  ON mission_log_entries (actor_id, at DESC);
`);
  } catch {
    // Broker may still be creating the control plane; caller retries.
  }
}

export function webListRoleAssignments(
  opts?: ListRoleAssignmentsOpts,
): ScoutRoleAssignment[] {
  return listRoleAssignments(getDb(), opts);
}

export function webGetRoleAssignment(id: string): ScoutRoleAssignment | null {
  return getRoleAssignment(getDb(), id);
}

export function webAssignRole(input: AssignRoleInput): ScoutRoleAssignment {
  return assignRole(getDb(), input);
}

export function webRevokeRole(input: RevokeRoleInput): ScoutRoleAssignment {
  return revokeRole(getDb(), input);
}

export function webListMissionLog(
  opts: ListMissionLogOpts,
): ScoutMissionLogEntry[] {
  return listMissionLogEntries(getDb(), opts);
}

export function webAppendMissionLog(
  input: ScoutMissionLogAppendInput,
  opts?: { bypassPermission?: boolean },
): ScoutMissionLogEntry {
  return appendMissionLogEntry(getDb(), input, opts);
}

/** Test helper */
export function resetAssignedRolesDbForTests(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore
    }
  }
  _db = null;
}
