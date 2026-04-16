import type { DeliveryAttempt, DeliveryIntent } from "@openscout/protocol";

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
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

export const controlPlaneDrizzleSchema = {
  deliveries: deliveriesTable,
  deliveryAttempts: deliveryAttemptsTable,
} as const;
