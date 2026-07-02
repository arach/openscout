import type { DeliveryAttempt, DeliveryIntent } from "@openscout/protocol";

import { desc, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Declarative mirror of the canonical control-plane SQL schema
// (`CONTROL_PLANE_SQLITE_SCHEMA` in `schema.ts`). Phase 0 of the Drizzle
// schema/migration adoption: every control-plane table, constraint and index
// is modeled here, and `drizzle-schema-parity.test.ts` proves the DDL
// generated from this module is structurally identical to the raw string.
//
// The raw SQL string remains the runtime authority until Phase 1 seeds the
// baseline migration — do NOT wire this into the boot migrator yet.
const epochMsNow = sql`(CAST(strftime('%s','now') AS INTEGER) * 1000)`;

// -- nodes -------------------------------------------------------------------
export const nodesTable = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  meshId: text("mesh_id").notNull(),
  name: text("name").notNull(),
  hostName: text("host_name"),
  advertiseScope: text("advertise_scope").notNull(),
  brokerUrl: text("broker_url"),
  tailnetName: text("tailnet_name"),
  capabilitiesJson: text("capabilities_json"),
  labelsJson: text("labels_json"),
  metadataJson: text("metadata_json"),
  lastSeenAt: integer("last_seen_at"),
  registeredAt: integer("registered_at").notNull(),
}, (table) => [
  index("idx_nodes_mesh_id").on(table.meshId),
]);

// -- actors ------------------------------------------------------------------
export const actorsTable = sqliteTable("actors", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  displayName: text("display_name").notNull(),
  handle: text("handle"),
  labelsJson: text("labels_json"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull().default(epochMsNow),
});

// -- agents ------------------------------------------------------------------
export const agentsTable = sqliteTable("agents", {
  id: text("id").primaryKey().references(() => actorsTable.id, { onDelete: "cascade" }),
  definitionId: text("definition_id").notNull(),
  nodeQualifier: text("node_qualifier"),
  workspaceQualifier: text("workspace_qualifier"),
  selector: text("selector"),
  defaultSelector: text("default_selector"),
  agentClass: text("agent_class").notNull(),
  capabilitiesJson: text("capabilities_json").notNull(),
  wakePolicy: text("wake_policy").notNull(),
  homeNodeId: text("home_node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  authorityNodeId: text("authority_node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  advertiseScope: text("advertise_scope").notNull(),
  ownerId: text("owner_id"),
  metadataJson: text("metadata_json"),
});

// -- agent_endpoints ---------------------------------------------------------
export const agentEndpointsTable = sqliteTable("agent_endpoints", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  harness: text("harness").notNull(),
  transport: text("transport").notNull(),
  state: text("state").notNull(),
  address: text("address"),
  sessionId: text("session_id"),
  pane: text("pane"),
  cwd: text("cwd"),
  projectRoot: text("project_root"),
  metadataJson: text("metadata_json"),
  updatedAt: integer("updated_at").notNull().default(epochMsNow),
}, (table) => [
  index("idx_agent_endpoints_agent_updated_at").on(table.agentId, desc(table.updatedAt)),
]);

// -- runtime_sessions --------------------------------------------------------
export const runtimeSessionsTable = sqliteTable("runtime_sessions", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  endpointId: text("endpoint_id").notNull().references(() => agentEndpointsTable.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  harness: text("harness").notNull(),
  transport: text("transport").notNull(),
  state: text("state").notNull(),
  primaryAlias: text("primary_alias").notNull(),
  externalSessionId: text("external_session_id"),
  cwd: text("cwd"),
  projectRoot: text("project_root"),
  startedAt: integer("started_at"),
  lastSeenAt: integer("last_seen_at").notNull(),
  endedAt: integer("ended_at"),
  expiresAt: integer("expires_at"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull().default(epochMsNow),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_runtime_sessions_agent_last_seen").on(table.agentId, desc(table.lastSeenAt)),
  index("idx_runtime_sessions_endpoint_last_seen").on(table.endpointId, desc(table.lastSeenAt)),
  index("idx_runtime_sessions_external").on(table.externalSessionId),
  index("idx_runtime_sessions_expires").on(table.expiresAt).where(sql`expires_at IS NOT NULL`),
]);

// -- runtime_session_aliases -------------------------------------------------
export const runtimeSessionAliasesTable = sqliteTable("runtime_session_aliases", {
  alias: text("alias").notNull(),
  sessionId: text("session_id").notNull().references(() => runtimeSessionsTable.id, { onDelete: "cascade" }),
  aliasKind: text("alias_kind").notNull(),
  agentId: text("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  endpointId: text("endpoint_id").notNull().references(() => agentEndpointsTable.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  harness: text("harness").notNull(),
  transport: text("transport").notNull(),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at"),
}, (table) => [
  primaryKey({ columns: [table.alias, table.sessionId] }),
  index("idx_runtime_session_aliases_alias").on(table.alias, desc(table.lastSeenAt)),
  index("idx_runtime_session_aliases_session").on(table.sessionId),
  index("idx_runtime_session_aliases_expires").on(table.expiresAt).where(sql`expires_at IS NOT NULL`),
]);

// -- conversations -----------------------------------------------------------
export const conversationsTable = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  visibility: text("visibility").notNull(),
  shareMode: text("share_mode").notNull(),
  authorityNodeId: text("authority_node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  topic: text("topic"),
  parentConversationId: text("parent_conversation_id").references((): AnySQLiteColumn => conversationsTable.id, { onDelete: "set null" }),
  messageId: text("message_id"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull().default(epochMsNow),
}, (table) => [
  index("idx_conversations_created_at").on(desc(table.createdAt)),
]);

// -- conversation_members ----------------------------------------------------
export const conversationMembersTable = sqliteTable("conversation_members", {
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull().references(() => actorsTable.id, { onDelete: "cascade" }),
  role: text("role"),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.actorId] }),
]);

// -- messages ----------------------------------------------------------------
export const messagesTable = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull().references(() => actorsTable.id, { onDelete: "restrict" }),
  originNodeId: text("origin_node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  class: text("class").notNull(),
  body: text("body").notNull(),
  replyToMessageId: text("reply_to_message_id").references((): AnySQLiteColumn => messagesTable.id, { onDelete: "set null" }),
  threadConversationId: text("thread_conversation_id").references(() => conversationsTable.id, { onDelete: "set null" }),
  speechJson: text("speech_json"),
  audienceJson: text("audience_json"),
  visibility: text("visibility").notNull(),
  policy: text("policy").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_messages_conversation_created_at").on(table.conversationId, table.createdAt),
  index("idx_messages_created_at").on(desc(table.createdAt)),
  index("idx_messages_actor_created_at").on(table.actorId, desc(table.createdAt)),
]);

// -- message_mentions --------------------------------------------------------
export const messageMentionsTable = sqliteTable("message_mentions", {
  messageId: text("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull().references(() => actorsTable.id, { onDelete: "cascade" }),
  label: text("label"),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.actorId] }),
]);

// -- message_attachments -----------------------------------------------------
export const messageAttachmentsTable = sqliteTable("message_attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
  mediaType: text("media_type").notNull(),
  fileName: text("file_name"),
  blobKey: text("blob_key"),
  url: text("url"),
  metadataJson: text("metadata_json"),
});

// -- conversation_read_cursors -----------------------------------------------
export const conversationReadCursorsTable = sqliteTable("conversation_read_cursors", {
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull().references(() => actorsTable.id, { onDelete: "cascade" }),
  readerNodeId: text("reader_node_id").references(() => nodesTable.id, { onDelete: "set null" }),
  lastReadMessageId: text("last_read_message_id").references(() => messagesTable.id, { onDelete: "set null" }),
  lastReadSeq: integer("last_read_seq"),
  lastReadAt: integer("last_read_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  metadataJson: text("metadata_json"),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.actorId] }),
  index("idx_read_cursors_conversation_updated_at").on(table.conversationId, desc(table.updatedAt)),
]);

// -- invocations -------------------------------------------------------------
export const invocationsTable = sqliteTable("invocations", {
  id: text("id").primaryKey(),
  requesterId: text("requester_id").notNull().references(() => actorsTable.id, { onDelete: "restrict" }),
  requesterNodeId: text("requester_node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  targetAgentId: text("target_agent_id").notNull().references(() => agentsTable.id, { onDelete: "restrict" }),
  targetNodeId: text("target_node_id").references(() => nodesTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  task: text("task").notNull(),
  collaborationRecordId: text("collaboration_record_id").references(() => collaborationRecordsTable.id, { onDelete: "set null" }),
  conversationId: text("conversation_id").references(() => conversationsTable.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => messagesTable.id, { onDelete: "set null" }),
  contextJson: text("context_json"),
  executionJson: text("execution_json"),
  ensureAwake: integer("ensure_awake").notNull().default(1),
  stream: integer("stream").notNull().default(1),
  timeoutMs: integer("timeout_ms"),
  labelsJson: text("labels_json"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
  // Flight status columns (flight→invocation storage merge, expand/dual-write
  // phase): mirror the latest flight so invocations can serve reads alone.
  flightId: text("flight_id"),
  state: text("state"),
  summary: text("summary"),
  output: text("output"),
  error: text("error"),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
}, (table) => [
  index("idx_invocations_target_created_at").on(table.targetAgentId, table.createdAt),
  index("idx_invocations_requester_created_at").on(table.requesterId, desc(table.createdAt)),
  // idx_invocations_flight_id lives only in the imperative migration array
  // (like idx_invocations_collaboration_record_id_created_at): the raw schema
  // exec runs before the imperative column-adds, so an index here would crash
  // legacy databases whose invocations table predates the flight_id column.
]);

// -- flights -----------------------------------------------------------------
export const flightsTable = sqliteTable("flights", {
  id: text("id").primaryKey(),
  invocationId: text("invocation_id").notNull().references(() => invocationsTable.id, { onDelete: "cascade" }),
  requesterId: text("requester_id").notNull().references(() => actorsTable.id, { onDelete: "restrict" }),
  targetAgentId: text("target_agent_id").notNull().references(() => agentsTable.id, { onDelete: "restrict" }),
  state: text("state").notNull(),
  summary: text("summary"),
  output: text("output"),
  error: text("error"),
  labelsJson: text("labels_json"),
  metadataJson: text("metadata_json"),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
}, (table) => [
  index("idx_flights_target_state").on(table.targetAgentId, table.state),
  index("idx_flights_invocation_id").on(table.invocationId),
]);

// -- bindings ----------------------------------------------------------------
export const bindingsTable = sqliteTable("bindings", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  mode: text("mode").notNull(),
  externalChannelId: text("external_channel_id").notNull(),
  externalThreadId: text("external_thread_id"),
  metadataJson: text("metadata_json"),
});

// -- deliveries --------------------------------------------------------------
// Typed handle for the delivery query layer (sqlite-store.ts). $type<> keeps
// the domain unions on the raw-SQL read path.
export const deliveriesTable = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  messageId: text("message_id").references(() => messagesTable.id, { onDelete: "cascade" }),
  invocationId: text("invocation_id").references(() => invocationsTable.id, { onDelete: "cascade" }),
  targetId: text("target_id").notNull(),
  targetNodeId: text("target_node_id").references(() => nodesTable.id, { onDelete: "set null" }),
  targetKind: text("target_kind").$type<DeliveryIntent["targetKind"]>().notNull(),
  transport: text("transport").$type<DeliveryIntent["transport"]>().notNull(),
  reason: text("reason").$type<DeliveryIntent["reason"]>().notNull(),
  policy: text("policy").$type<DeliveryIntent["policy"]>().notNull(),
  status: text("status").$type<DeliveryIntent["status"]>().notNull(),
  bindingId: text("binding_id").references(() => bindingsTable.id, { onDelete: "set null" }),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: integer("lease_expires_at"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull().default(epochMsNow),
}, (table) => [
  index("idx_deliveries_status_transport").on(table.status, table.transport),
  index("idx_deliveries_created_at").on(desc(table.createdAt)),
]);

// -- delivery_attempts -------------------------------------------------------
export const deliveryAttemptsTable = sqliteTable("delivery_attempts", {
  id: text("id").primaryKey(),
  deliveryId: text("delivery_id").notNull().references(() => deliveriesTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  status: text("status").$type<DeliveryAttempt["status"]>().notNull(),
  error: text("error"),
  externalRef: text("external_ref"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_delivery_attempts_created_at").on(desc(table.createdAt)),
]);

// -- durable_actions ---------------------------------------------------------
// NOTE: `idx_durable_actions_kind_due_at_updated_at` is an expression index
// whose COALESCE/json_extract body contains commas. drizzle-kit 0.31.10's
// migration renderer splits an `sql` index expression on every comma, so it
// cannot emit this index. It is declared below via the `sql` escape hatch for
// documentation, and `DURABLE_ACTIONS_DUE_AT_INDEX_SQL` carries the exact DDL
// the parity test applies in its place. See deliverable (c) / the parity test.
export const durableActionsTable = sqliteTable("durable_actions", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  subjectId: text("subject_id").notNull(),
  authorityCellId: text("authority_cell_id").notNull(),
  state: text("state").notNull(),
  idempotencyKey: text("idempotency_key"),
  leaseOwner: text("lease_owner"),
  leaseGeneration: integer("lease_generation").notNull().default(0),
  leaseExpiresAt: integer("lease_expires_at"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_durable_actions_idempotency_key")
    .on(table.authorityCellId, table.kind, table.idempotencyKey)
    .where(sql`idempotency_key IS NOT NULL`),
  index("idx_durable_actions_authority_state_lease").on(table.authorityCellId, table.state, table.leaseExpiresAt),
  index("idx_durable_actions_subject").on(table.kind, table.subjectId),
  // Escape hatch (see note above): drizzle-kit cannot render this. Kept in the
  // declarative model; substituted by DURABLE_ACTIONS_DUE_AT_INDEX_SQL.
  index("idx_durable_actions_kind_due_at_updated_at").on(
    table.kind,
    sql`COALESCE(CAST(json_extract(metadata_json, '$.dueAt') AS REAL), CAST(json_extract(metadata_json, '$.due_at') AS REAL))`,
    table.updatedAt,
  ),
]);

// Exact DDL for the expression index drizzle-kit cannot serialize. Matches the
// raw statement in schema.ts; the parity test asserts it stays in lockstep.
export const DURABLE_ACTIONS_DUE_AT_INDEX_SQL =
  `CREATE INDEX idx_durable_actions_kind_due_at_updated_at
  ON durable_actions (
    kind,
    COALESCE(
      CAST(json_extract(metadata_json, '$.dueAt') AS REAL),
      CAST(json_extract(metadata_json, '$.due_at') AS REAL)
    ),
    updated_at
  )`;

// -- durable_attempts --------------------------------------------------------
export const durableAttemptsTable = sqliteTable("durable_attempts", {
  id: text("id").primaryKey(),
  actionId: text("action_id").notNull().references(() => durableActionsTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  state: text("state").notNull(),
  leaseGeneration: integer("lease_generation").notNull(),
  error: text("error"),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  metadataJson: text("metadata_json"),
}, (table) => [
  unique().on(table.actionId, table.attempt),
  index("idx_durable_attempts_action_attempt").on(table.actionId, table.attempt),
]);

// -- durable_checkpoints -----------------------------------------------------
export const durableCheckpointsTable = sqliteTable("durable_checkpoints", {
  actionId: text("action_id").notNull().references(() => durableActionsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  payloadJson: text("payload_json"),
  ownerAttemptId: text("owner_attempt_id").references(() => durableAttemptsTable.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.actionId, table.name] }),
]);

// -- durable_signals ---------------------------------------------------------
export const durableSignalsTable = sqliteTable("durable_signals", {
  actionId: text("action_id").notNull().references(() => durableActionsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  payloadJson: text("payload_json"),
  emittedAt: integer("emitted_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.actionId, table.name] }),
]);

// -- collaboration_records ---------------------------------------------------
export const collaborationRecordsTable = sqliteTable("collaboration_records", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  acceptanceState: text("acceptance_state").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  createdById: text("created_by_id").notNull().references(() => actorsTable.id, { onDelete: "restrict" }),
  ownerId: text("owner_id").references(() => actorsTable.id, { onDelete: "set null" }),
  nextMoveOwnerId: text("next_move_owner_id").references(() => actorsTable.id, { onDelete: "set null" }),
  conversationId: text("conversation_id").references(() => conversationsTable.id, { onDelete: "set null" }),
  parentId: text("parent_id").references((): AnySQLiteColumn => collaborationRecordsTable.id, { onDelete: "set null" }),
  priority: text("priority"),
  labelsJson: text("labels_json"),
  relationsJson: text("relations_json"),
  detailJson: text("detail_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_collaboration_records_state").on(table.state),
  index("idx_collaboration_records_updated_at").on(table.updatedAt),
  index("idx_collaboration_records_kind_state_updated_at").on(table.kind, table.state, desc(table.updatedAt)),
  index("idx_collaboration_records_parent_kind_state_updated_at").on(table.parentId, table.kind, table.state, desc(table.updatedAt)),
  index("idx_collaboration_records_owner_kind_state_updated_at").on(table.ownerId, table.kind, table.state, desc(table.updatedAt)),
  index("idx_collaboration_records_next_move_owner_kind_state_updated_at").on(table.nextMoveOwnerId, table.kind, table.state, desc(table.updatedAt)),
]);

// -- collaboration_events ----------------------------------------------------
export const collaborationEventsTable = sqliteTable("collaboration_events", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull().references(() => collaborationRecordsTable.id, { onDelete: "cascade" }),
  recordKind: text("record_kind").notNull(),
  kind: text("kind").notNull(),
  actorId: text("actor_id").notNull().references(() => actorsTable.id, { onDelete: "restrict" }),
  summary: text("summary"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_collaboration_events_record_created_at").on(table.recordId, table.createdAt),
]);

// -- events ------------------------------------------------------------------
export const eventsTable = sqliteTable("events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  actorId: text("actor_id").notNull(),
  nodeId: text("node_id"),
  ts: integer("ts").notNull(),
  payloadJson: text("payload_json").notNull(),
}, (table) => [
  index("idx_events_kind_ts").on(table.kind, table.ts),
]);

// -- thread_events -----------------------------------------------------------
export const threadEventsTable = sqliteTable("thread_events", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  authorityNodeId: text("authority_node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  seq: integer("seq").notNull(),
  kind: text("kind").notNull(),
  actorId: text("actor_id").references(() => actorsTable.id, { onDelete: "set null" }),
  ts: integer("ts").notNull(),
  payloadJson: text("payload_json").notNull(),
  notificationJson: text("notification_json"),
}, (table) => [
  unique().on(table.conversationId, table.seq),
  index("idx_thread_events_conversation_seq").on(table.conversationId, desc(table.seq)),
  index("idx_thread_events_conversation_ts").on(table.conversationId, desc(table.ts)),
]);

// -- thread_cursors ----------------------------------------------------------
export const threadCursorsTable = sqliteTable("thread_cursors", {
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  authorityNodeId: text("authority_node_id").notNull().references(() => nodesTable.id, { onDelete: "restrict" }),
  lastAppliedSeq: integer("last_applied_seq").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.authorityNodeId] }),
]);

// -- scout_dispatches --------------------------------------------------------
export const scoutDispatchesTable = sqliteTable("scout_dispatches", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  askedLabel: text("asked_label").notNull(),
  detail: text("detail").notNull(),
  invocationId: text("invocation_id"),
  conversationId: text("conversation_id"),
  requesterId: text("requester_id"),
  dispatcherNodeId: text("dispatcher_node_id").notNull(),
  dispatchedAt: integer("dispatched_at").notNull(),
  payloadJson: text("payload_json").notNull(),
}, (table) => [
  index("idx_scout_dispatches_dispatched_at").on(desc(table.dispatchedAt)),
  index("idx_scout_dispatches_conversation_ts").on(table.conversationId, desc(table.dispatchedAt)),
]);

// -- activity_items ----------------------------------------------------------
export const activityItemsTable = sqliteTable("activity_items", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  ts: integer("ts").notNull(),
  conversationId: text("conversation_id").references(() => conversationsTable.id, { onDelete: "cascade" }),
  messageId: text("message_id").references(() => messagesTable.id, { onDelete: "cascade" }),
  invocationId: text("invocation_id").references(() => invocationsTable.id, { onDelete: "cascade" }),
  flightId: text("flight_id").references(() => flightsTable.id, { onDelete: "cascade" }),
  recordId: text("record_id").references(() => collaborationRecordsTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").references(() => actorsTable.id, { onDelete: "set null" }),
  counterpartId: text("counterpart_id").references(() => actorsTable.id, { onDelete: "set null" }),
  agentId: text("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  workspaceRoot: text("workspace_root"),
  sessionId: text("session_id"),
  title: text("title"),
  summary: text("summary"),
  payloadJson: text("payload_json"),
}, (table) => [
  index("idx_activity_items_agent_ts").on(table.agentId, desc(table.ts)),
  index("idx_activity_items_actor_ts").on(table.actorId, desc(table.ts)),
  index("idx_activity_items_conversation_ts").on(table.conversationId, desc(table.ts)),
  index("idx_activity_items_ts").on(desc(table.ts)),
  index("idx_activity_items_workspace_ts").on(table.workspaceRoot, desc(table.ts)),
  index("idx_activity_items_kind_ts").on(table.kind, desc(table.ts)),
  index("idx_activity_items_session_ts").on(table.sessionId, desc(table.ts)),
]);

// -- budget_usage_events -----------------------------------------------------
export const budgetUsageEventsTable = sqliteTable("budget_usage_events", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  source: text("source").notNull(),
  provider: text("provider"),
  harness: text("harness"),
  transport: text("transport"),
  model: text("model"),
  agentId: text("agent_id"),
  endpointId: text("endpoint_id"),
  sessionId: text("session_id"),
  projectRoot: text("project_root"),
  conversationId: text("conversation_id"),
  messageId: text("message_id"),
  invocationId: text("invocation_id"),
  flightId: text("flight_id"),
  workId: text("work_id"),
  occurredAt: integer("occurred_at").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  reasoningOutputTokens: integer("reasoning_output_tokens"),
  cacheCreationInputTokens: integer("cache_creation_input_tokens"),
  cacheReadInputTokens: integer("cache_read_input_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedUsd: real("estimated_usd"),
  billedUsd: real("billed_usd"),
  currency: text("currency"),
  dedupKey: text("dedup_key"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull().default(epochMsNow),
}, (table) => [
  index("idx_budget_usage_events_scope_occurred").on(table.scope, desc(table.occurredAt)),
  index("idx_budget_usage_events_session_occurred").on(table.sessionId, desc(table.occurredAt)),
  index("idx_budget_usage_events_invocation").on(table.invocationId, desc(table.occurredAt)),
  index("idx_budget_usage_events_flight").on(table.flightId, desc(table.occurredAt)),
  uniqueIndex("idx_budget_usage_events_dedup")
    .on(table.scope, table.source, table.dedupKey)
    .where(sql`dedup_key IS NOT NULL AND dedup_key != ''`),
]);

// -- budget_quota_window_snapshots -------------------------------------------
export const budgetQuotaWindowSnapshotsTable = sqliteTable("budget_quota_window_snapshots", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  provider: text("provider"),
  harness: text("harness"),
  transport: text("transport"),
  model: text("model"),
  agentId: text("agent_id"),
  endpointId: text("endpoint_id"),
  sessionId: text("session_id"),
  userId: text("user_id"),
  accountId: text("account_id"),
  planType: text("plan_type"),
  label: text("label").notNull(),
  windowKind: text("window_kind"),
  usedPercent: real("used_percent"),
  percentRemaining: real("percent_remaining"),
  used: real("used"),
  limitValue: real("limit_value"),
  resetAt: integer("reset_at"),
  windowMs: integer("window_ms"),
  capturedAt: integer("captured_at").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull().default(epochMsNow),
}, (table) => [
  index("idx_budget_quota_windows_session_captured").on(table.sessionId, desc(table.capturedAt)),
  index("idx_budget_quota_windows_provider_label").on(table.provider, table.label, desc(table.capturedAt)),
]);

// -- mobile_push_registrations -----------------------------------------------
export const mobilePushRegistrationsTable = sqliteTable("mobile_push_registrations", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  platform: text("platform").notNull(),
  appBundleId: text("app_bundle_id").notNull(),
  apnsEnvironment: text("apns_environment").notNull(),
  pushToken: text("push_token").notNull(),
  authorizationStatus: text("authorization_status").notNull(),
  appVersion: text("app_version"),
  buildNumber: text("build_number"),
  deviceModel: text("device_model"),
  systemVersion: text("system_version"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_mobile_push_registrations_device_bundle_env").on(
    table.deviceId,
    table.platform,
    table.appBundleId,
    table.apnsEnvironment,
  ),
  uniqueIndex("idx_mobile_push_registrations_push_token").on(table.pushToken),
  index("idx_mobile_push_registrations_device_updated_at").on(table.deviceId, desc(table.updatedAt)),
]);

// -- briefings ---------------------------------------------------------------
// Typed handle for the Briefing Room query layer (packages/web/server/db/briefings.ts).
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
  index("idx_briefings_created_at").on(desc(table.createdAt)),
  index("idx_briefings_kind_created_at").on(table.kind, desc(table.createdAt)),
]);

export const controlPlaneDrizzleSchema = {
  nodes: nodesTable,
  actors: actorsTable,
  agents: agentsTable,
  agentEndpoints: agentEndpointsTable,
  runtimeSessions: runtimeSessionsTable,
  runtimeSessionAliases: runtimeSessionAliasesTable,
  conversations: conversationsTable,
  conversationMembers: conversationMembersTable,
  messages: messagesTable,
  messageMentions: messageMentionsTable,
  messageAttachments: messageAttachmentsTable,
  conversationReadCursors: conversationReadCursorsTable,
  invocations: invocationsTable,
  flights: flightsTable,
  bindings: bindingsTable,
  deliveries: deliveriesTable,
  deliveryAttempts: deliveryAttemptsTable,
  durableActions: durableActionsTable,
  durableAttempts: durableAttemptsTable,
  durableCheckpoints: durableCheckpointsTable,
  durableSignals: durableSignalsTable,
  collaborationRecords: collaborationRecordsTable,
  collaborationEvents: collaborationEventsTable,
  events: eventsTable,
  threadEvents: threadEventsTable,
  threadCursors: threadCursorsTable,
  scoutDispatches: scoutDispatchesTable,
  activityItems: activityItemsTable,
  budgetUsageEvents: budgetUsageEventsTable,
  budgetQuotaWindowSnapshots: budgetQuotaWindowSnapshotsTable,
  mobilePushRegistrations: mobilePushRegistrationsTable,
  briefings: briefingsTable,
} as const;
