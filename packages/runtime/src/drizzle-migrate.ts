import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { openControlPlaneDrizzle } from "./drizzle-client.js";
import { CONTROL_PLANE_SQLITE_SCHEMA } from "./schema.js";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";

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

function resolveControlPlaneDatabasePath(): string {
  const explicitPath = process.env.OPENSCOUT_CONTROL_PLANE_DB?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  return join(resolveOpenScoutSupportPaths().controlHome, "control-plane.sqlite");
}

if (import.meta.main) {
  const dbPath = resolveControlPlaneDatabasePath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const database = new Database(dbPath, { create: true });
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA synchronous = NORMAL;");
    database.exec(CONTROL_PLANE_SQLITE_SCHEMA);
    applyControlPlaneDrizzleMigrations(database);
    console.log(`Drizzle migration check completed for ${dbPath}`);
  } finally {
    database.close();
  }
}
