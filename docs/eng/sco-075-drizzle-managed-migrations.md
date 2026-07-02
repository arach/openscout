# SCO-075: Drizzle-managed control-plane migrations

## Status

Accepted — decided by Arach 2026-07-01. The declarative model and parity proof
(Phase 0) and the baseline migration with ledger seeding (Phase 1) have landed;
new schema changes now flow through `db:generate` (Phase 2).

## Proposal ID

`sco-075`

## 1. Decision

Drizzle owns the declarative schema and the managed migrations for the
control-plane SQLite database. The query layer stays on the typed-`Row` raw-SQL
pattern — the ORM is not on the read path.

This supersedes SCO-031 §9's "**ORM/DB migration.** … Out of scope forever."
clause **on the migration point only**. The query-layer boundary drawn by
SCO-031 (raw SQL for reads, no migration off SQLite for the hot path) is
unchanged and reaffirmed here. SCO-031 §9 is revised in lockstep to point at
this ADR, which is the record of the supersession.

## 2. Why

The goal was always ORM-managed migrations plus a declarative schema, and that
is separable from converting the query layer to the ORM — the two were only ever
coupled by assumption. The blocker recorded in the earlier retirement analysis
was that a naive ledger model would brick live databases: replaying a baseline's
plain `CREATE TABLE`s over a database the raw-schema exec had already built would
fail. That blocker dissolves with a baseline migration plus ledger seeding: an
existing database records the baseline as already-applied instead of replaying
it, so only genuinely new migrations execute against it.

## 3. Architecture

The control-plane schema is modeled declaratively in
`packages/runtime/src/drizzle-schema.ts` (32 tables). drizzle-kit generates the
managed migrations into `packages/runtime/drizzle/` (baseline
`0000_curly_iron_monger.sql` plus `meta/`).

Boot runs `migrateControlPlaneDatabaseSchema`
(`packages/runtime/src/control-plane-migrations.ts`) in this order:

```text
assertControlPlaneSchemaNotNewer   # downgrade guard (user_version vs build)
applyControlPlaneDrizzleMigrations # ledger seeding + drizzle migrator
CONTROL_PLANE_SQLITE_SCHEMA (exec) # idempotent raw-schema repair layer
CONTROL_PLANE_SCHEMA_MIGRATIONS    # guarded imperative array (old-DB repair)
stampControlPlaneSchemaVersion     # PRAGMA user_version = <version>
```

- **Downgrade guard.** `assertControlPlaneSchemaNotNewer` refuses to open a
  database stamped (`user_version`) by a newer build than the running one,
  rather than silently corrupting it.
- **Seeding.** `seedControlPlaneDrizzleBaseline` records the baseline as applied
  for any non-empty database with an empty ledger, via a single race-safe
  `INSERT … SELECT … WHERE NOT EXISTS`. The hash and timestamp come from
  drizzle-orm's `readMigrationFiles`, so seeding cannot drift from what the
  migrator itself would record. A truly virgin database keeps an empty ledger,
  so the migrator runs the baseline for real.
- **Repair layer.** After the migrator, the raw `CONTROL_PLANE_SQLITE_SCHEMA`
  exec (`CREATE TABLE IF NOT EXISTS …`, `packages/runtime/src/schema.ts`) and
  the guarded imperative array `CONTROL_PLANE_SCHEMA_MIGRATIONS` run as an
  idempotent repair layer for databases predating a given change — the same role
  they held before managed migrations existed.
- **Parity gates.** `packages/runtime/src/drizzle-schema-parity.test.ts` holds
  two gates: (1) the raw string vs the DDL generated from the declarative model,
  and (2) the raw string vs the checked-in migration chain applied through the
  real production function (`applyControlPlaneDrizzleMigrations`). Boot-path
  behavior — virgin boot, seeding, downgrade refusal — is pinned by
  `packages/runtime/src/control-plane-migrations.test.ts`.
- **Packaging.** The folder resolver
  (`resolveControlPlaneDrizzleMigrationsFolder`) probes `../drizzle` and
  `./drizzle` relative to the module. The runtime package ships `drizzle/` via
  its `files` field (`packages/runtime/package.json`); the CLI build
  (`packages/cli/scripts/build.mjs`) copies it to `dist/drizzle` so both
  `dist/main.mjs` and the `dist/runtime/*.mjs` daemon bundles resolve it.

## 4. Authoring convention

The step-by-step runbook lives in `packages/runtime/drizzle/README.md`; this ADR
does not duplicate it. In one line: edit the model in `drizzle-schema.ts`, run
`bun run db:generate`, mirror the change into `CONTROL_PLANE_SQLITE_SCHEMA`, run
the parity and boot gates, and commit the generated SQL, journal, snapshot,
model edit, and mirror together.

## 5. Known tooling constraint

drizzle-kit 0.31.x comma-splits any `sql`-literal index expression when it
renders migration SQL, so it cannot emit such an index correctly. The one
affected index today is `idx_durable_actions_kind_due_at_updated_at` (a
`COALESCE` over two `json_extract` calls). Its correct DDL is the exported
constant `DURABLE_ACTIONS_DUE_AT_INDEX_SQL` in `drizzle-schema.ts`, and the
generated statement in `0000_curly_iron_monger.sql` was hand-fixed to match (see
the comment in that file). Any future generated migration touching a
`sql`-literal index needs the same hand-fix; the parity gates verify the result.
drizzle-kit is pinned exactly to `0.31.10` because both the generate output
format and this workaround are version-sensitive.

## 6. Open item (Phase 3)

Whether the idempotent raw-schema repair layer eventually retires, stays as a
belt, or moves into a `scout doctor --fix` reconcile command is deferred to a
later phase (Phase 3 of this effort) and is not decided here. Do not rush it:
it should wait until several generated migrations have shipped cleanly.
