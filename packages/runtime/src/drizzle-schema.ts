import type { DeliveryAttempt, DeliveryIntent } from "@openscout/protocol";

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const epochMsNow = sql`(CAST(strftime('%s','now') AS INTEGER) * 1000)`;

// Bounded proof-path schema for the first Drizzle adoption slice. The raw
// control-plane SQL schema remains canonical until more tables migrate over.
export const deliveriesTable = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  messageId: text("message_id"),
  invocationId: text("invocation_id"),
  targetId: text("target_id").notNull(),
  targetNodeId: text("target_node_id"),
  targetKind: text("target_kind").$type<DeliveryIntent["targetKind"]>().notNull(),
  transport: text("transport").$type<DeliveryIntent["transport"]>().notNull(),
  reason: text("reason").$type<DeliveryIntent["reason"]>().notNull(),
  policy: text("policy").$type<DeliveryIntent["policy"]>().notNull(),
  status: text("status").$type<DeliveryIntent["status"]>().notNull(),
  bindingId: text("binding_id"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: integer("lease_expires_at"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull().default(epochMsNow),
}, (table) => [
  index("idx_deliveries_status_transport").on(table.status, table.transport),
]);

export const deliveryAttemptsTable = sqliteTable("delivery_attempts", {
  id: text("id").primaryKey(),
  deliveryId: text("delivery_id").notNull(),
  attempt: integer("attempt").notNull(),
  status: text("status").$type<DeliveryAttempt["status"]>().notNull(),
  error: text("error"),
  externalRef: text("external_ref"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
});

// Briefing Room — three-layer archive of Ranger-generated briefs. Raw schema
// in `schema.ts`; this Drizzle mirror gives type-safe access for the web
// server. See packages/web/server/db/briefings.ts for queries.
export const briefingsTable = sqliteTable("briefings", {
  id: text("id").primaryKey(),
  kind: text("kind").$type<"fleet-home" | "tour">().notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  recommendation: text("recommendation"),
  preparedAt: integer("prepared_at").notNull(),
  ttlMs: integer("ttl_ms").notNull(),
  briefJson: text("brief_json").notNull(),
  observationsJson: text("observations_json").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  callJson: text("call_json").notNull(),
  /**
   * Canonical markdown body (SCO-037 step 3). Nullable for backward
   * compatibility with rows persisted before the markdown pipeline.
   */
  markdown: text("markdown"),
  createdAt: integer("created_at").notNull().default(epochMsNow),
}, (table) => [
  index("idx_briefings_created_at").on(table.createdAt),
  index("idx_briefings_kind_created_at").on(table.kind, table.createdAt),
]);

export const controlPlaneDrizzleSchema = {
  deliveries: deliveriesTable,
  deliveryAttempts: deliveryAttemptsTable,
  briefings: briefingsTable,
} as const;
