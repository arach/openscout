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
const fullChainLedger = migrations.map((m) => ({
  hash: m.hash,
  created_at: m.folderMillis,
}));

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

  test("preserves the historical schema v14 context migration identity at schema v15", () => {
    const contextMigration = migrations.find((migration) => migration.folderMillis === 1783665705710);

    expect(CONTROL_PLANE_SCHEMA_VERSION).toBe(15);
    expect(contextMigration?.hash).toBe("e576221a4547e38a8d92027deb1124055459bf800c12c562840cdcf6fbb8b560");
  });

  test("upgrades a fully ledgered schema v14 database through only the new role migration", () => {
    const db = new Database(":memory:");
    const v14Migrations = migrations.filter((migration) => migration.folderMillis <= 1783665705710);
    expect(v14Migrations).toHaveLength(4);
    db.exec(
      'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    for (const migration of v14Migrations) {
      db.transaction(() => {
        for (const statement of migration.sql) db.exec(statement);
        db.query(
          'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
        ).run(migration.hash, migration.folderMillis);
      })();
    }
    db.exec("PRAGMA user_version = 14");
    db.query(
      "INSERT INTO actors (id, kind, display_name) VALUES ('actor-v14', 'agent', 'Survivor')",
    ).run();
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role_assignments'").get(),
    ).toBeNull();

    migrateControlPlaneDatabaseSchema(db);

    expect(ledgerRows(db)).toEqual(fullChainLedger);
    expect(userVersion(db)).toBe(15);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role_assignments'").get(),
    ).toEqual({ name: "role_assignments" });
    expect(
      db.query("SELECT display_name FROM actors WHERE id = 'actor-v14'").get(),
    ).toEqual({ display_name: "Survivor" });
  });

  test("virgin database boots through the migrator: full chain executed, ledger recorded", () => {
    const db = new Database(":memory:");
    migrateControlPlaneDatabaseSchema(db);

    // A seeded ledger on an empty database is impossible (seeding requires
    // existing tables), so these rows prove the migrator ran the chain.
    expect(ledgerRows(db)).toEqual(fullChainLedger);
    expect(controlPlaneTableCount(db)).toBeGreaterThan(30);
    expect(userVersion(db)).toBe(CONTROL_PLANE_SCHEMA_VERSION);
  });

  test("existing raw-schema database gets the whole chain seeded, data intact", () => {
    const db = new Database(":memory:");
    // A pre-ledger production state: raw schema (current full shape) +
    // imperative array + version stamp + the empty ledger table the
    // pre-baseline migrate() call left behind. Seeding must record the whole
    // chain — replaying any migration (e.g. 0001's plain ADD COLUMNs) over
    // this database would fail.
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

    expect(ledgerRows(db)).toEqual(fullChainLedger);
    const survivor = db
      .query("SELECT display_name FROM actors WHERE id = 'actor-1'")
      .get() as { display_name: string };
    expect(survivor.display_name).toBe("Keeper");
  });

  test("pre-drizzle-spike database (no ledger table at all) seeds cleanly", () => {
    const db = new Database(":memory:");
    db.exec(CONTROL_PLANE_SQLITE_SCHEMA);

    migrateControlPlaneDatabaseSchema(db);

    expect(ledgerRows(db)).toEqual(fullChainLedger);
  });

  test("partially created database (interrupted first boot) seeds and repairs", () => {
    const db = new Database(":memory:");
    // Only the baseline's first table exists — the seed condition must treat
    // any non-empty database as existing so the baseline's plain CREATE TABLE
    // statements never replay; the raw-schema repair layer fills in the rest.
    db.exec(baseline.sql[0]!);
    expect(controlPlaneTableCount(db)).toBe(1);

    migrateControlPlaneDatabaseSchema(db);

    expect(ledgerRows(db)).toEqual(fullChainLedger);
    expect(controlPlaneTableCount(db)).toBeGreaterThan(30);
  });

  test("running the full migration twice keeps exactly one ledger row per migration", () => {
    const db = new Database(":memory:");
    migrateControlPlaneDatabaseSchema(db);
    migrateControlPlaneDatabaseSchema(db);
    expect(ledgerRows(db)).toEqual(fullChainLedger);
  });

  test("briefings-markdown backfill adds the column to pre-v8 databases", () => {
    const db = new Database(":memory:");
    db.exec(CONTROL_PLANE_SQLITE_SCHEMA);
    // Simulate a database provisioned before schema v8, whose briefings table
    // predates the markdown column (the CREATE IF NOT EXISTS repair layer
    // cannot add columns to an existing table).
    db.exec("ALTER TABLE briefings DROP COLUMN markdown");

    migrateControlPlaneDatabaseSchema(db);

    const cols = db.query("PRAGMA table_info('briefings')").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "markdown")).toBe(true);
  });

  function seedDivergedInvocation(db: Database): void {
    db.exec(`
      INSERT INTO invocations (id, requester_id, requester_node_id, target_agent_id, action, task, created_at)
        VALUES ('inv-1', 'operator', 'node-1', 'agent-1', 'consult', 'reconcile me', 100);
      INSERT INTO flights (id, invocation_id, requester_id, target_agent_id, state, summary, output, metadata_json, started_at, completed_at)
        VALUES ('flight-1', 'inv-1', 'operator', 'agent-1', 'completed', 'Done', 'Output', '{"model":"probe"}', 110, 120);
      UPDATE invocations
        SET flight_id = 'wrong-flight', state = 'running', summary = 'STALE',
            output = NULL, error = 'STALE', started_at = 999, completed_at = NULL,
            flight_metadata_json = NULL
        WHERE id = 'inv-1';
    `);
  }

  function shadowRow(db: Database): Record<string, unknown> {
    return db
      .query(
        `SELECT flight_id, state, summary, output, error, started_at, completed_at, flight_metadata_json
         FROM invocations WHERE id = 'inv-1'`,
      )
      .get() as Record<string, unknown>;
  }

  const healedShadow = {
    flight_id: "flight-1",
    state: "completed",
    summary: "Done",
    output: "Output",
    error: null,
    started_at: 110,
    completed_at: 120,
    flight_metadata_json: '{"model":"probe"}',
  };

  test("pre-ledger database with a diverged shadow heals: seed-all marks 0002 applied, so the imperative reconcile must repair it", () => {
    // The #297 adversarial review's blocker scenario: a pre-ledger database
    // seeds the whole chain as already-applied, so the checked-in 0002
    // wholesale reconciliation never executes — the imperative
    // invocation-flight-status-reconcile entry is the only thing standing
    // between a stale shadow and the read switch.
    const db = new Database(":memory:");
    migrateControlPlaneDatabaseSchema(db);
    seedDivergedInvocation(db);
    db.exec('DROP TABLE "__drizzle_migrations"');

    migrateControlPlaneDatabaseSchema(db);

    expect(ledgerRows(db)).toEqual(fullChainLedger);
    expect(shadowRow(db)).toEqual(healedShadow);
  });

  test("shadow reconcile is self-healing: a diverged shadow on a fully-ledgered database converges on the next boot", () => {
    // Covers divergence from any source after the ledgered migration already
    // ran once — crash windows on builds before the dual-write became
    // transactional, manual edits, raw /v1/flights posts.
    const db = new Database(":memory:");
    migrateControlPlaneDatabaseSchema(db);
    seedDivergedInvocation(db);

    migrateControlPlaneDatabaseSchema(db);

    expect(shadowRow(db)).toEqual(healedShadow);
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
