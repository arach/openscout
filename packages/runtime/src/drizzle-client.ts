import type { Database } from "bun:sqlite";

import { drizzle } from "drizzle-orm/bun-sqlite";

import { controlPlaneDrizzleSchema } from "./drizzle-schema.js";

export function openControlPlaneDrizzle(client: Database) {
  return drizzle(client, { schema: controlPlaneDrizzleSchema });
}
