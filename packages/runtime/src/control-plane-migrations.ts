import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

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

function databaseFilename(database: Database): string {
  return (database as Database & { filename?: string }).filename ?? "unknown path";
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
  // This module runs from several on-disk layouts: packages/runtime/src (dev)
  // and packages/runtime/dist resolve the folder as a sibling of their parent,
  // while the CLI's bundles embed it at two depths (dist/main.mjs and
  // dist/runtime/*.mjs) around the dist/drizzle copy the CLI build makes.
  const candidates = ["../drizzle", "./drizzle"];
  for (const candidate of candidates) {
    const folder = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(join(folder, "meta", "_journal.json"))) {
      return folder;
    }
  }
  return fileURLToPath(new URL(candidates[0]!, import.meta.url));
}

// Identical to the DDL drizzle-orm's bun-sqlite migrator creates for its
// ledger (sqlite-core dialect `migrate`), so seeding and the real migrator
// always agree on the table shape.
const DRIZZLE_MIGRATIONS_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at numeric
)
`;

function seedControlPlaneDrizzleBaseline(database: Database, migrationsFolder: string): void {
  const baseline = readMigrationFiles({ migrationsFolder })[0];
  if (!baseline) {
    return;
  }

  database.exec(DRIZZLE_MIGRATIONS_LEDGER_SQL);
  // Databases that predate the managed-migration baseline were built by the
  // raw schema exec; replaying the baseline's plain CREATE TABLE statements
  // over them would fail. When the ledger is empty but the database already
  // has tables, record the baseline as applied instead — the migrator then
  // only runs migrations newer than it. A truly virgin database keeps an
  // empty ledger so the migrator applies the baseline for real. Single
  // statement so concurrent boots cannot double-seed.
  database
    .query(
      `INSERT INTO "__drizzle_migrations" (hash, created_at)
       SELECT $hash, $createdAt
       WHERE NOT EXISTS (SELECT 1 FROM "__drizzle_migrations")
         AND EXISTS (
           SELECT 1 FROM sqlite_master
           WHERE type = 'table'
             AND name NOT GLOB 'sqlite_*'
             AND name != '__drizzle_migrations'
         )`,
    )
    .run({ $hash: baseline.hash, $createdAt: baseline.folderMillis });
}

export function applyControlPlaneDrizzleMigrations(database: Database): boolean {
  const migrationsFolder = resolveControlPlaneDrizzleMigrationsFolder();
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    return false;
  }

  seedControlPlaneDrizzleBaseline(database, migrationsFolder);
  migrate(openControlPlaneDrizzle(database), { migrationsFolder });
  return true;
}

export function assertControlPlaneSchemaNotNewer(database: Database): void {
  const row = database.query("PRAGMA user_version").get() as { user_version: number } | null;
  const stampedVersion = row?.user_version ?? 0;
  if (stampedVersion > CONTROL_PLANE_SCHEMA_VERSION) {
    throw new Error(
      `Control-plane database "${databaseFilename(database)}" is stamped schema v${stampedVersion}, ` +
        `but this build only knows v${CONTROL_PLANE_SCHEMA_VERSION}. Refusing to open a ` +
        `database written by a newer build — upgrade OpenScout instead of downgrading.`,
    );
  }
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
  assertControlPlaneSchemaNotNewer(database);
  // Managed migrations run first: a virgin database gets its schema from the
  // baseline through the migrator; an existing database gets the baseline
  // seeded as already-applied and only newer migrations execute. The raw
  // schema exec and the imperative array then act as the idempotent repair
  // layer, exactly as before.
  applyControlPlaneDrizzleMigrations(database);
  database.exec(CONTROL_PLANE_SQLITE_SCHEMA);
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
