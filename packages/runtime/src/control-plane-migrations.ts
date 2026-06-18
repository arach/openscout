import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { openControlPlaneDrizzle } from "./drizzle-client.js";
import {
  CONTROL_PLANE_RUNTIME_SESSION_SQLITE_SCHEMA,
  CONTROL_PLANE_SCHEMA_VERSION,
  CONTROL_PLANE_SQLITE_SCHEMA,
  CONTROL_PLANE_TERMINAL_SESSION_SQLITE_SCHEMA,
} from "./schema.js";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";

export type ControlPlaneSchemaMigration = {
  id: string;
  description: string;
  apply: (database: Database) => void;
};

function hasColumn(database: Database, tableName: string, columnName: string): boolean {
  const escapedTableName = tableName.replaceAll("'", "''");
  const rows = database.query(
    `SELECT name FROM pragma_table_info('${escapedTableName}')`,
  ).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

export const CONTROL_PLANE_SCHEMA_MIGRATIONS: ControlPlaneSchemaMigration[] = [
  {
    id: "runtime-session-mapping-read-model",
    description: "Creates the Scout-owned runtime session and session alias indexes.",
    apply(database) {
      database.exec(CONTROL_PLANE_RUNTIME_SESSION_SQLITE_SCHEMA);
    },
  },
  {
    id: "invocation-collaboration-record-link",
    description: "Adds invocation links back to collaboration records.",
    apply(database) {
      if (!hasColumn(database, "invocations", "collaboration_record_id")) {
        database.exec(
          "ALTER TABLE invocations ADD COLUMN collaboration_record_id TEXT REFERENCES collaboration_records(id) ON DELETE SET NULL",
        );
      }
    },
  },
  {
    id: "invocation-and-flight-labels",
    description: "Adds label metadata columns to invocations and flights.",
    apply(database) {
      if (!hasColumn(database, "invocations", "labels_json")) {
        database.exec("ALTER TABLE invocations ADD COLUMN labels_json TEXT");
      }
      if (!hasColumn(database, "flights", "labels_json")) {
        database.exec("ALTER TABLE flights ADD COLUMN labels_json TEXT");
      }
    },
  },
  {
    id: "terminal-session-registry",
    description: "Creates the Scout-owned terminal session registry (harness session + surfaces).",
    apply(database) {
      database.exec(CONTROL_PLANE_TERMINAL_SESSION_SQLITE_SCHEMA);
    },
  },
  {
    id: "read-model-indexes",
    description: "Creates durable read indexes used by broker and dashboard queries.",
    apply(database) {
      database.exec(`
CREATE INDEX IF NOT EXISTS idx_invocations_collaboration_record_id_created_at
  ON invocations(collaboration_record_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invocations_requester_created_at
  ON invocations(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flights_invocation_id
  ON flights(invocation_id);
CREATE INDEX IF NOT EXISTS idx_activity_items_ts
  ON activity_items(ts DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at
  ON conversations(created_at DESC);
`);
    },
  },
];

export function configureControlPlaneDatabase(database: Database): void {
  // busy_timeout must be set before WAL, because journal_mode can need a write lock.
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA synchronous = NORMAL;");
  database.exec("PRAGMA foreign_keys = ON;");
}

export function resolveControlPlaneDrizzleMigrationsFolder(): string {
  return fileURLToPath(new URL("../drizzle", import.meta.url));
}

export function applyControlPlaneDrizzleMigrations(database: Database): boolean {
  const migrationsFolder = resolveControlPlaneDrizzleMigrationsFolder();
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    return false;
  }

  migrate(openControlPlaneDrizzle(database), { migrationsFolder });
  return true;
}

export function applyControlPlaneSchemaMigrations(database: Database): void {
  for (const migration of CONTROL_PLANE_SCHEMA_MIGRATIONS) {
    migration.apply(database);
  }
}

export function stampControlPlaneSchemaVersion(database: Database): void {
  database.exec(`PRAGMA user_version = ${CONTROL_PLANE_SCHEMA_VERSION};`);
}

export function migrateControlPlaneDatabaseSchema(database: Database): void {
  database.exec(CONTROL_PLANE_SQLITE_SCHEMA);
  applyControlPlaneDrizzleMigrations(database);
  applyControlPlaneSchemaMigrations(database);
  stampControlPlaneSchemaVersion(database);
}

export function resolveControlPlaneDatabasePath(): string {
  const explicitPath = process.env.OPENSCOUT_CONTROL_PLANE_DB?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  return join(resolveOpenScoutSupportPaths().controlHome, "control-plane.sqlite");
}
