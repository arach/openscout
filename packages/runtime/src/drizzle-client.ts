import { createRequire } from "node:module";

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import { controlPlaneDrizzleSchema } from "./drizzle-schema.js";
import {
  controlPlaneSqliteAdapterKind,
  type ControlPlaneSqliteDatabase,
} from "./sqlite-adapter.js";

export type ControlPlaneDrizzleDatabase =
  BunSQLiteDatabase<typeof controlPlaneDrizzleSchema> & {
    $client: ControlPlaneSqliteDatabase;
  };

type BunSqliteDrizzleModule = {
  drizzle<TSchema extends Record<string, unknown>>(
    client: never,
    config: { schema: TSchema },
  ): BunSQLiteDatabase<TSchema> & { $client: ControlPlaneSqliteDatabase };
};

const require = createRequire(import.meta.url);

export function openControlPlaneDrizzle(client: ControlPlaneSqliteDatabase): ControlPlaneDrizzleDatabase {
  const adapter = controlPlaneSqliteAdapterKind();
  if (adapter !== "bun-sqlite") {
    throw new Error(
      "The node-sqlite Drizzle adapter is not implemented yet. "
      + "Run Drizzle-backed control-plane operations with Bun until the Node SQLite adapter lands.",
    );
  }

  const { drizzle } = require("drizzle-orm/bun-sqlite") as BunSqliteDrizzleModule;
  return drizzle(client as never, { schema: controlPlaneDrizzleSchema }) as ControlPlaneDrizzleDatabase;
}
