// Boot-path tests for the managed-migration layer (Phase 1 of
// plans/drizzle-schema-migrations.md): virgin databases build through the
// drizzle migrator, pre-baseline databases get the baseline seeded as
// already-applied, and a database stamped by a newer build refuses to open.
// The idempotent repair property itself is pinned by sqlite-store.test.ts.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  applyControlPlaneSchemaMigrations,
  assertControlPlaneSchemaNotNewer,
  migrateControlPlaneDatabaseSchema,
  resolveControlPlaneDrizzleMigrationsFolder,
} from "./control-plane-migrations.js";
import { CONTROL_PLANE_SCHEMA_VERSION, CONTROL_PLANE_SQLITE_SCHEMA } from "./schema.js";

const migrations = readMigrationFiles({
  migrationsFolder: resolveControlPlaneDrizzleMigrationsFolder(),
});
const baseline = migrations[0]!;

function ledgerRows(db: Database): Array<{ hash: string; created_at: number }> {
  return db
    .query('SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at')
    .all() as Array<{ hash: string; created_at: number }>;
}

function controlPlaneTableCount(db: Database): number {
  const row = db
    .query(
      "SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name != '__drizzle_migrations'",
    )
    .get() as { c: number };
  return row.c;
}

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

describe("control-plane managed migrations", () => {
  test("the checked-in journal has the baseline", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(baseline.folderMillis).toBeGreaterThan(0);
    expect(baseline.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("virgin database boots through the migrator: baseline executed, ledger recorded", () => {
    const db = new Database(":memory:");
    migrateControlPlaneDatabaseSchema(db);

    // A seeded ledger on an empty database is impossible (seeding requires
    // existing tables), so this row proves the migrator ran the baseline.
    expect(ledgerRows(db)).toEqual([
      { hash: baseline.hash, created_at: baseline.folderMillis },
    ]);
    expect(controlPlaneTableCount(db)).toBeGreaterThan(30);
    expect(userVersion(db)).toBe(CONTROL_PLANE_SCHEMA_VERSION);
  });

  test("existing raw-schema database gets the baseline seeded, data intact", () => {
    const db = new Database(":memory:");
    // Today's production state: raw schema + imperative array + version stamp
    // + the empty ledger table the pre-baseline migrate() call left behind.
    db.exec(CONTROL_PLANE_SQLITE_SCHEMA);
    applyControlPlaneSchemaMigrations(db);
    db.exec(`PRAGMA user_version = ${CONTROL_PLANE_SCHEMA_VERSION};`);
    db.exec(
      'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    db.query(
      "INSERT INTO actors (id, kind, display_name) VALUES ('actor-1', 'agent', 'Keeper')",
    ).run();

    migrateControlPlaneDatabaseSchema(db);

    expect(ledgerRows(db)).toEqual([
      { hash: baseline.hash, created_at: baseline.folderMillis },
    ]);
    const survivor = db
      .query("SELECT display_name FROM actors WHERE id = 'actor-1'")
      .get() as { display_name: string };
    expect(survivor.display_name).toBe("Keeper");
  });

  test("pre-drizzle-spike database (no ledger table at all) seeds cleanly", () => {
    const db = new Database(":memory:");
    db.exec(CONTROL_PLANE_SQLITE_SCHEMA);

    migrateControlPlaneDatabaseSchema(db);

    expect(ledgerRows(db)).toEqual([
      { hash: baseline.hash, created_at: baseline.folderMillis },
    ]);
  });

  test("partially created database (interrupted first boot) seeds and repairs", () => {
    const db = new Database(":memory:");
    // Only the baseline's first table exists — the seed condition must treat
    // any non-empty database as existing so the baseline's plain CREATE TABLE
    // statements never replay; the raw-schema repair layer fills in the rest.
    db.exec(baseline.sql[0]!);
    expect(controlPlaneTableCount(db)).toBe(1);

    migrateControlPlaneDatabaseSchema(db);

    expect(ledgerRows(db)).toEqual([
      { hash: baseline.hash, created_at: baseline.folderMillis },
    ]);
    expect(controlPlaneTableCount(db)).toBeGreaterThan(30);
  });

  test("running the full migration twice keeps exactly one ledger row", () => {
    const db = new Database(":memory:");
    migrateControlPlaneDatabaseSchema(db);
    migrateControlPlaneDatabaseSchema(db);
    expect(ledgerRows(db)).toHaveLength(1);
  });

  test("refuses to open a database stamped by a newer build", () => {
    const db = new Database(":memory:");
    migrateControlPlaneDatabaseSchema(db);
    db.exec(`PRAGMA user_version = ${CONTROL_PLANE_SCHEMA_VERSION + 1};`);

    expect(() => migrateControlPlaneDatabaseSchema(db)).toThrow(/newer build/);
    expect(() => assertControlPlaneSchemaNotNewer(db)).toThrow(
      new RegExp(`v${CONTROL_PLANE_SCHEMA_VERSION + 1}.*v${CONTROL_PLANE_SCHEMA_VERSION}`),
    );
  });

  test("a database at exactly the current version opens", () => {
    const db = new Database(":memory:");
    migrateControlPlaneDatabaseSchema(db);
    expect(() => migrateControlPlaneDatabaseSchema(db)).not.toThrow();
  });
});
