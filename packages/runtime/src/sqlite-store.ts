import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { and, asc, eq } from "drizzle-orm";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  CollaborationEvent,
  CollaborationRecord,
  CollaborationRelation,
  CollaborationPriority,
  CollaborationWaitingOn,
  CollaborationProgress,
  QuestionState,
  WorkItemState,
  ControlEvent,
  ConversationBinding,
  ConversationDefinition,
  DeliveryAttempt,
  DeliveryIntent,
  FlightRecord,
  InvocationRequest,
  MessageAttachment,
  MessageMention,
  MessageRecord,
  NodeDefinition,
  ScoutDispatchRecord,
  ThreadCollaborationEventSummary,
  ThreadCollaborationSummary,
  ThreadEventEnvelope,
  ThreadEventKind,
  ThreadEventNotification,
  ThreadFlightSummary,
  ThreadMessageSummary,
  ThreadSnapshot,
} from "@openscout/protocol";

import {
  createRuntimeRegistrySnapshot,
  type RuntimeRegistrySnapshot,
} from "./registry.js";
import { openControlPlaneDrizzle } from "./drizzle-client.js";
import { applyControlPlaneDrizzleMigrations, stampControlPlaneSchemaVersion } from "./drizzle-migrate.js";
import { CONTROL_PLANE_SQLITE_SCHEMA, deliveryAttemptsTable, deliveriesTable } from "./schema.js";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringify(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function metadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): unknown {
  return metadata?.[key];
}

function stringValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadataValue(metadata, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function invocationStringValue(invocation: InvocationRequest, key: string): string | undefined {
  const contextValue = stringValue(invocation.context, key);
  if (contextValue) {
    return contextValue;
  }

  const nestedContext = metadataValue(invocation.context, "collaboration");
  if (nestedContext && typeof nestedContext === "object" && !Array.isArray(nestedContext)) {
    const nestedValue = stringValue(nestedContext as Record<string, unknown>, key);
    if (nestedValue) {
      return nestedValue;
    }
  }

  const metadataEntry = stringValue(invocation.metadata, key);
  if (metadataEntry) {
    return metadataEntry;
  }

  const nestedMetadata = metadataValue(invocation.metadata, "collaboration");
  if (nestedMetadata && typeof nestedMetadata === "object" && !Array.isArray(nestedMetadata)) {
    return stringValue(nestedMetadata as Record<string, unknown>, key);
  }

  return undefined;
}

function resolveInvocationCollaborationRecordId(invocation: InvocationRequest): string | undefined {
  return invocation.collaborationRecordId?.trim()
    || invocationStringValue(invocation, "collaborationRecordId")
    || invocationStringValue(invocation, "recordId");
}

type SQLiteBinding =
  | string
  | bigint
  | NodeJS.TypedArray
  | number
  | boolean
  | null
  | Record<string, string | bigint | NodeJS.TypedArray | number | boolean | null>;

type SQLiteStatementLike<Row, Params extends SQLiteBinding[]> = {
  all(...params: Params): Row[];
  get(...params: Params): Row | null;
};

type SQLiteDatabaseConstructor = {
  new (path: string, options?: { create?: boolean; strict?: boolean; readonly?: boolean }): Database;
};

type SQLiteTransactionalDatabase = Database & {
  transaction<TArgs extends unknown[]>(callback: (...args: TArgs) => void): (...args: TArgs) => void;
};

const SQLiteDatabase = Database as unknown as SQLiteDatabaseConstructor;

function queryAll<Row, Params extends SQLiteBinding[] = []>(
  db: Database,
  sql: string,
  ...params: Params
): Row[] {
  const statement = db.query(sql) as SQLiteStatementLike<Row, Params>;
  return statement.all(...params);
}

function queryGet<Row, Params extends SQLiteBinding[] = []>(
  db: Database,
  sql: string,
  ...params: Params
): Row | null {
  const statement = db.query(sql) as SQLiteStatementLike<Row, Params>;
  return statement.get(...params);
}

function summarizeText(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

interface ActorRow {
  id: string;
  kind: ActorIdentity["kind"];
  display_name: string;
  handle: string | null;
  labels_json: string | null;
  metadata_json: string | null;
}

interface NodeRow {
  id: string;
  mesh_id: string;
  name: string;
  host_name: string | null;
  advertise_scope: NodeDefinition["advertiseScope"];
  broker_url: string | null;
  tailnet_name: string | null;
  capabilities_json: string | null;
  labels_json: string | null;
  metadata_json: string | null;
  last_seen_at: number | null;
  registered_at: number;
}

interface AgentRow {
  id: string;
  definition_id: string;
  node_qualifier: string | null;
  workspace_qualifier: string | null;
  selector: string | null;
  default_selector: string | null;
  agent_class: AgentDefinition["agentClass"];
  capabilities_json: string;
  wake_policy: AgentDefinition["wakePolicy"];
  home_node_id: string;
  authority_node_id: string;
  advertise_scope: AgentDefinition["advertiseScope"];
  owner_id: string | null;
  metadata_json: string | null;
}

interface EndpointRow {
  id: string;
  agent_id: string;
  node_id: string;
  harness: AgentEndpoint["harness"];
  transport: AgentEndpoint["transport"];
  state: AgentEndpoint["state"];
  address: string | null;
  session_id: string | null;
  pane: string | null;
  cwd: string | null;
  project_root: string | null;
  metadata_json: string | null;
}

interface ConversationRow {
  id: string;
  kind: ConversationDefinition["kind"];
  title: string;
  visibility: ConversationDefinition["visibility"];
  share_mode: ConversationDefinition["shareMode"];
  authority_node_id: string;
  topic: string | null;
  parent_conversation_id: string | null;
  message_id: string | null;
  metadata_json: string | null;
}

interface BindingRow {
  id: string;
  conversation_id: string;
  platform: string;
  mode: ConversationBinding["mode"];
  external_channel_id: string;
  external_thread_id: string | null;
  metadata_json: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  actor_id: string;
  origin_node_id: string;
  class: MessageRecord["class"];
  body: string;
  reply_to_message_id: string | null;
  thread_conversation_id: string | null;
  speech_json: string | null;
  audience_json: string | null;
  visibility: MessageRecord["visibility"];
  policy: MessageRecord["policy"];
  metadata_json: string | null;
  created_at: number;
}

interface MentionRow {
  message_id: string;
  actor_id: string;
  label: string | null;
}

interface AttachmentRow {
  id: string;
  message_id: string;
  media_type: string;
  file_name: string | null;
  blob_key: string | null;
  url: string | null;
  metadata_json: string | null;
}

interface InvocationRow {
  id: string;
  requester_id: string;
  requester_node_id: string;
  target_agent_id: string;
  target_node_id: string | null;
  action: InvocationRequest["action"];
  task: string;
  collaboration_record_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  context_json: string | null;
  execution_json: string | null;
  ensure_awake: number;
  stream: number;
  timeout_ms: number | null;
  metadata_json: string | null;
  created_at: number;
}

interface FlightRow {
  id: string;
  invocation_id: string;
  requester_id: string;
  target_agent_id: string;
  state: FlightRecord["state"];
  summary: string | null;
  output: string | null;
  error: string | null;
  metadata_json: string | null;
  started_at: number | null;
  completed_at: number | null;
}

interface CollaborationRecordRow {
  id: string;
  kind: CollaborationRecord["kind"];
  state: string;
  acceptance_state: string;
  title: string;
  summary: string | null;
  created_by_id: string;
  owner_id: string | null;
  next_move_owner_id: string | null;
  conversation_id: string | null;
  parent_id: string | null;
  priority: string | null;
  labels_json: string | null;
  relations_json: string | null;
  detail_json: string | null;
  created_at: number;
  updated_at: number;
}

interface CollaborationEventRow {
  id: string;
  record_id: string;
  record_kind: string;
  kind: string;
  actor_id: string;
  summary: string | null;
  metadata_json: string | null;
  created_at: number;
}

interface EventRow {
  id: string;
  kind: string;
  actor_id: string;
  node_id: string | null;
  ts: number;
  payload_json: string;
}

interface ThreadEventRow {
  id: string;
  conversation_id: string;
  authority_node_id: string;
  seq: number;
  kind: ThreadEventKind;
  actor_id: string | null;
  ts: number;
  payload_json: string;
  notification_json: string | null;
}

interface ThreadCursorRow {
  conversation_id: string;
  authority_node_id: string;
  last_applied_seq: number;
  updated_at: number;
}

type ThreadEventInsert = {
  id: string;
  conversation: ConversationDefinition;
  kind: ThreadEventKind;
  actorId?: string;
  ts: number;
  payload: ThreadEventEnvelope["payload"];
  notification?: ThreadEventNotification;
};

export type ActivityItemKind =
  | "message_posted"
  | "agent_message"
  | "status_message"
  | "ask_opened"
  | "ask_working"
  | "ask_replied"
  | "ask_failed"
  | "handoff_sent"
  | "invocation_recorded"
  | "flight_updated"
  | "collaboration_event";

export type ActivityItem = {
  id: string;
  kind: ActivityItemKind;
  ts: number;
  conversationId?: string;
  messageId?: string;
  invocationId?: string;
  flightId?: string;
  recordId?: string;
  actorId?: string;
  counterpartId?: string;
  agentId?: string;
  workspaceRoot?: string;
  sessionId?: string;
  title?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

interface ActivityItemRow {
  id: string;
  kind: ActivityItemKind;
  ts: number;
  conversation_id: string | null;
  message_id: string | null;
  invocation_id: string | null;
  flight_id: string | null;
  record_id: string | null;
  actor_id: string | null;
  counterpart_id: string | null;
  agent_id: string | null;
  workspace_root: string | null;
  session_id: string | null;
  title: string | null;
  summary: string | null;
  payload_json: string | null;
}

function buildCollaborationRecord(row: CollaborationRecordRow): CollaborationRecord {
  const detail = parseJson<Record<string, unknown>>(row.detail_json, {});
  const base = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary ?? undefined,
    createdById: row.created_by_id,
    ownerId: row.owner_id ?? undefined,
    nextMoveOwnerId: row.next_move_owner_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    parentId: row.parent_id ?? undefined,
    priority: (row.priority ?? undefined) as CollaborationPriority | undefined,
    labels: parseJson<string[] | undefined>(row.labels_json, undefined),
    relations: parseJson<CollaborationRelation[] | undefined>(row.relations_json, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: (detail as { metadata?: Record<string, unknown> }).metadata,
  };

  if (row.kind === "question") {
    return {
      ...base,
      kind: "question",
      state: row.state as QuestionState,
      acceptanceState: row.acceptance_state as CollaborationRecord["acceptanceState"],
      askedById: detail.askedById as string | undefined,
      askedOfId: detail.askedOfId as string | undefined,
      answerMessageId: detail.answerMessageId as string | undefined,
      spawnedWorkItemId: detail.spawnedWorkItemId as string | undefined,
      closedAt: detail.closedAt as number | undefined,
    };
  }

  return {
    ...base,
    kind: "work_item",
    state: row.state as WorkItemState,
    acceptanceState: row.acceptance_state as CollaborationRecord["acceptanceState"],
    requestedById: detail.requestedById as string | undefined,
    waitingOn: detail.waitingOn as CollaborationWaitingOn | undefined,
    progress: detail.progress as CollaborationProgress | undefined,
    startedAt: detail.startedAt as number | undefined,
    reviewRequestedAt: detail.reviewRequestedAt as number | undefined,
    completedAt: detail.completedAt as number | undefined,
  };
}

export class SQLiteControlPlaneStore {
  private readonly db: Database;
  private readonly readDb: Database;
  private readonly drizzleDb: ReturnType<typeof openControlPlaneDrizzle>;
  private readonly drizzleReadDb: ReturnType<typeof openControlPlaneDrizzle>;
  private readonly persistEventsBatch: (events: ControlEvent[]) => void;
  private pendingEvents: ControlEvent[] = [];
  private flushPendingEventsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new SQLiteDatabase(dbPath, { create: true });
    // Set busy_timeout FIRST — journal_mode = WAL requires a write lock and will
    // fail with SQLITE_BUSY if another process holds one.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(CONTROL_PLANE_SQLITE_SCHEMA);
    applyControlPlaneDrizzleMigrations(this.db);
    this.ensureSchemaMigrations();
    stampControlPlaneSchemaVersion(this.db);
    this.readDb = new SQLiteDatabase(dbPath, { readonly: true });
    this.readDb.exec("PRAGMA busy_timeout = 5000;");
    this.readDb.exec("PRAGMA query_only = ON;");
    this.drizzleDb = openControlPlaneDrizzle(this.db);
    this.drizzleReadDb = openControlPlaneDrizzle(this.readDb);
    this.persistEventsBatch = (this.db as SQLiteTransactionalDatabase).transaction((events: ControlEvent[]) => {
      const statement = this.db.query(
        `INSERT OR REPLACE INTO events (id, kind, actor_id, node_id, ts, payload_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      );

      for (const event of events) {
        statement.run(
          event.id,
          event.kind,
          event.actorId,
          event.nodeId ?? null,
          event.ts,
          JSON.stringify(event.payload),
        );
      }
    });
  }

  private ensureSchemaMigrations(): void {
    if (!this.hasColumn("invocations", "collaboration_record_id")) {
      this.db.exec(
        "ALTER TABLE invocations ADD COLUMN collaboration_record_id TEXT REFERENCES collaboration_records(id) ON DELETE SET NULL",
      );
    }

    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_invocations_collaboration_record_id_created_at ON invocations(collaboration_record_id, created_at)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_invocations_requester_created_at ON invocations(requester_id, created_at DESC)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_flights_invocation_id ON flights(invocation_id)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_activity_items_ts ON activity_items(ts DESC)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC)",
    );
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const escapedTableName = tableName.replaceAll("'", "''");
    const rows = queryAll<{ name: string }>(
      this.db,
      `SELECT name FROM pragma_table_info('${escapedTableName}')`,
    );
    return rows.some((row) => row.name === columnName);
  }

  close(): void {
    this.flushPendingEvents();
    if (this.flushPendingEventsTimer) {
      clearTimeout(this.flushPendingEventsTimer);
      this.flushPendingEventsTimer = null;
    }
    this.readDb.close();
    this.db.close();
  }

  private flushPendingEvents(): void {
    if (this.pendingEvents.length === 0) {
      return;
    }

    const nextBatch = this.pendingEvents;
    this.pendingEvents = [];
    this.persistEventsBatch(nextBatch);
  }

  private schedulePendingEventFlush(): void {
    if (this.flushPendingEventsTimer) {
      return;
    }

    this.flushPendingEventsTimer = setTimeout(() => {
      this.flushPendingEventsTimer = null;
      this.flushPendingEvents();
    }, 0);
    this.flushPendingEventsTimer.unref?.();
  }

  loadSnapshot(): RuntimeRegistrySnapshot {
    const snapshot = createRuntimeRegistrySnapshot();

    const nodes = queryAll<NodeRow>(this.readDb, "SELECT * FROM nodes");
    for (const row of nodes) {
      snapshot.nodes[row.id] = {
        id: row.id,
        meshId: row.mesh_id,
        name: row.name,
        hostName: row.host_name ?? undefined,
        advertiseScope: row.advertise_scope,
        brokerUrl: row.broker_url ?? undefined,
        tailnetName: row.tailnet_name ?? undefined,
        capabilities: parseJson<string[]>(row.capabilities_json, []),
        labels: parseJson<string[]>(row.labels_json, []),
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
        lastSeenAt: row.last_seen_at ?? undefined,
        registeredAt: row.registered_at,
      };
    }

    const actors = queryAll<ActorRow>(this.readDb, "SELECT * FROM actors");
    for (const row of actors) {
      snapshot.actors[row.id] = {
        id: row.id,
        kind: row.kind,
        displayName: row.display_name,
        handle: row.handle ?? undefined,
        labels: parseJson<string[] | undefined>(row.labels_json, undefined),
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
      };
    }

    const agents = queryAll<AgentRow>(this.readDb, "SELECT * FROM agents");
    for (const row of agents) {
      const actor = snapshot.actors[row.id];
      if (!actor) continue;

      snapshot.agents[row.id] = {
        ...actor,
        kind: "agent",
        definitionId: row.definition_id,
        nodeQualifier: row.node_qualifier ?? undefined,
        workspaceQualifier: row.workspace_qualifier ?? undefined,
        selector: row.selector ?? undefined,
        defaultSelector: row.default_selector ?? undefined,
        agentClass: row.agent_class,
        capabilities: parseJson<AgentDefinition["capabilities"]>(row.capabilities_json, []),
        wakePolicy: row.wake_policy,
        homeNodeId: row.home_node_id,
        authorityNodeId: row.authority_node_id,
        advertiseScope: row.advertise_scope,
        ownerId: row.owner_id ?? undefined,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, actor.metadata),
      };
    }

    const endpoints = queryAll<EndpointRow>(this.readDb, "SELECT * FROM agent_endpoints");
    for (const row of endpoints) {
      snapshot.endpoints[row.id] = {
        id: row.id,
        agentId: row.agent_id,
        nodeId: row.node_id,
        harness: row.harness,
        transport: row.transport,
        state: row.state,
        address: row.address ?? undefined,
        sessionId: row.session_id ?? undefined,
        pane: row.pane ?? undefined,
        cwd: row.cwd ?? undefined,
        projectRoot: row.project_root ?? undefined,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
      };
    }

    const conversations = queryAll<ConversationRow>(this.readDb, "SELECT * FROM conversations");
    const members = queryAll<{ conversation_id: string; actor_id: string }>(
      this.readDb,
      "SELECT conversation_id, actor_id FROM conversation_members",
    );
    const memberMap = new Map<string, string[]>();
    for (const row of members) {
      const list = memberMap.get(row.conversation_id) ?? [];
      list.push(row.actor_id);
      memberMap.set(row.conversation_id, list);
    }
    for (const row of conversations) {
      snapshot.conversations[row.id] = {
        id: row.id,
        kind: row.kind,
        title: row.title,
        visibility: row.visibility,
        shareMode: row.share_mode,
        authorityNodeId: row.authority_node_id,
        participantIds: memberMap.get(row.id) ?? [],
        topic: row.topic ?? undefined,
        parentConversationId: row.parent_conversation_id ?? undefined,
        messageId: row.message_id ?? undefined,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
      };
    }

    const bindings = queryAll<BindingRow>(this.readDb, "SELECT * FROM bindings");
    for (const row of bindings) {
      snapshot.bindings[row.id] = {
        id: row.id,
        conversationId: row.conversation_id,
        platform: row.platform,
        mode: row.mode,
        externalChannelId: row.external_channel_id,
        externalThreadId: row.external_thread_id ?? undefined,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
      };
    }

    const messages = queryAll<MessageRow>(this.readDb, "SELECT * FROM messages");
    const mentionRows = queryAll<MentionRow>(this.readDb, "SELECT * FROM message_mentions");
    const attachmentRows = queryAll<AttachmentRow>(this.readDb, "SELECT * FROM message_attachments");
    const mentionsByMessage = new Map<string, MessageMention[]>();
    const attachmentsByMessage = new Map<string, MessageAttachment[]>();

    for (const row of mentionRows) {
      const list = mentionsByMessage.get(row.message_id) ?? [];
      list.push({ actorId: row.actor_id, label: row.label ?? undefined });
      mentionsByMessage.set(row.message_id, list);
    }
    for (const row of attachmentRows) {
      const list = attachmentsByMessage.get(row.message_id) ?? [];
      list.push({
        id: row.id,
        mediaType: row.media_type,
        fileName: row.file_name ?? undefined,
        blobKey: row.blob_key ?? undefined,
        url: row.url ?? undefined,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
      });
      attachmentsByMessage.set(row.message_id, list);
    }

    for (const row of messages) {
      snapshot.messages[row.id] = {
        id: row.id,
        conversationId: row.conversation_id,
        actorId: row.actor_id,
        originNodeId: row.origin_node_id,
        class: row.class,
        body: row.body,
        replyToMessageId: row.reply_to_message_id ?? undefined,
        threadConversationId: row.thread_conversation_id ?? undefined,
        mentions: mentionsByMessage.get(row.id),
        attachments: attachmentsByMessage.get(row.id),
        speech: parseJson<MessageRecord["speech"]>(row.speech_json, undefined),
        audience: parseJson<MessageRecord["audience"]>(row.audience_json, undefined),
        visibility: row.visibility,
        policy: row.policy,
        createdAt: row.created_at,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
      };
    }

    const invocations = queryAll<InvocationRow>(this.readDb, "SELECT * FROM invocations");
    for (const row of invocations) {
      snapshot.invocations[row.id] = {
        id: row.id,
        requesterId: row.requester_id,
        requesterNodeId: row.requester_node_id,
        targetAgentId: row.target_agent_id,
        targetNodeId: row.target_node_id ?? undefined,
        action: row.action,
        task: row.task,
        collaborationRecordId: row.collaboration_record_id ?? undefined,
        conversationId: row.conversation_id ?? undefined,
        messageId: row.message_id ?? undefined,
        context: parseJson<Record<string, unknown> | undefined>(row.context_json, undefined),
        execution: parseJson<InvocationRequest["execution"]>(row.execution_json, undefined),
        ensureAwake: row.ensure_awake === 1,
        stream: row.stream === 1,
        timeoutMs: row.timeout_ms ?? undefined,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
        createdAt: row.created_at,
      };
    }

    const flights = queryAll<FlightRow>(this.readDb, "SELECT * FROM flights");
    for (const row of flights) {
      snapshot.flights[row.id] = {
        id: row.id,
        invocationId: row.invocation_id,
        requesterId: row.requester_id,
        targetAgentId: row.target_agent_id,
        state: row.state,
        summary: row.summary ?? undefined,
        output: row.output ?? undefined,
        error: row.error ?? undefined,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
        startedAt: row.started_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
      };
    }

    const collaborationRows = queryAll<CollaborationRecordRow>(
      this.readDb,
      "SELECT * FROM collaboration_records",
    );
    for (const row of collaborationRows) {
      snapshot.collaborationRecords[row.id] = buildCollaborationRecord(row);
    }

    return snapshot;
  }

  recentEvents(limit = 100): ControlEvent[] {
    this.flushPendingEvents();
    const rows = queryAll<EventRow, [number]>(
      this.readDb,
      "SELECT * FROM events ORDER BY ts DESC LIMIT ?1",
      limit,
    ).reverse();

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      actorId: row.actor_id,
      nodeId: row.node_id ?? undefined,
      ts: row.ts,
      payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    })) as ControlEvent[];
  }

  latestThreadSeq(conversationId: string): number {
    const row = queryGet<{ max_seq: number | null }, [string]>(
      this.readDb,
      "SELECT MAX(seq) AS max_seq FROM thread_events WHERE conversation_id = ?1",
      conversationId,
    );
    return row?.max_seq ?? 0;
  }

  oldestThreadSeq(conversationId: string): number {
    const row = queryGet<{ seq: number }, [string]>(
      this.readDb,
      "SELECT seq FROM thread_events WHERE conversation_id = ?1 ORDER BY seq ASC LIMIT 1",
      conversationId,
    );
    return row?.seq ?? 0;
  }

  listThreadEvents(options: {
    conversationId: string;
    afterSeq?: number;
    limit?: number;
  }): ThreadEventEnvelope[] {
    const rows = queryAll<ThreadEventRow, [string, number, number]>(
      this.readDb,
      `SELECT *
      FROM thread_events
      WHERE conversation_id = ?1 AND seq > ?2
      ORDER BY seq ASC
      LIMIT ?3`,
      options.conversationId,
      options.afterSeq ?? 0,
      options.limit ?? 500,
    );

    return rows.map((row) => this.buildThreadEvent(row));
  }

  getThreadSnapshot(conversationId: string): ThreadSnapshot | null {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return null;
    }

    return {
      conversation,
      latestSeq: this.latestThreadSeq(conversationId),
      messages: this.listConversationThreadMessages(conversation),
      collaboration: this.listConversationThreadCollaboration(conversation),
      activeFlights: this.listConversationThreadFlights(conversation),
    };
  }

  upsertThreadCursor(
    conversationId: string,
    authorityNodeId: string,
    lastAppliedSeq: number,
    updatedAt: number,
  ): void {
    this.db.query(
      `INSERT INTO thread_cursors (
        conversation_id, authority_node_id, last_applied_seq, updated_at
      ) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(conversation_id, authority_node_id) DO UPDATE SET
        last_applied_seq = excluded.last_applied_seq,
        updated_at = excluded.updated_at`,
    ).run(
      conversationId,
      authorityNodeId,
      lastAppliedSeq,
      updatedAt,
    );
  }

  getThreadCursor(conversationId: string, authorityNodeId: string): {
    conversationId: string;
    authorityNodeId: string;
    lastAppliedSeq: number;
    updatedAt: number;
  } | null {
    const row = queryGet<ThreadCursorRow, [string, string]>(
      this.readDb,
      `SELECT *
      FROM thread_cursors
      WHERE conversation_id = ?1 AND authority_node_id = ?2
      LIMIT 1`,
      conversationId,
      authorityNodeId,
    );

    if (!row) {
      return null;
    }

    return {
      conversationId: row.conversation_id,
      authorityNodeId: row.authority_node_id,
      lastAppliedSeq: row.last_applied_seq,
      updatedAt: row.updated_at,
    };
  }

  upsertNode(node: NodeDefinition): void {
    this.db.query(
      `INSERT INTO nodes (
        id, mesh_id, name, host_name, advertise_scope, broker_url, tailnet_name,
        capabilities_json, labels_json, metadata_json, last_seen_at, registered_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      ON CONFLICT(id) DO UPDATE SET
        mesh_id = excluded.mesh_id,
        name = excluded.name,
        host_name = excluded.host_name,
        advertise_scope = excluded.advertise_scope,
        broker_url = excluded.broker_url,
        tailnet_name = excluded.tailnet_name,
        capabilities_json = excluded.capabilities_json,
        labels_json = excluded.labels_json,
        metadata_json = excluded.metadata_json,
        last_seen_at = excluded.last_seen_at,
        registered_at = excluded.registered_at`,
    ).run(
      node.id,
      node.meshId,
      node.name,
      node.hostName ?? null,
      node.advertiseScope,
      node.brokerUrl ?? null,
      node.tailnetName ?? null,
      stringify(node.capabilities),
      stringify(node.labels),
      stringify(node.metadata),
      node.lastSeenAt ?? null,
      node.registeredAt,
    );
  }

  upsertActor(actor: ActorIdentity): void {
    this.db.query(
      `INSERT INTO actors (
        id, kind, display_name, handle, labels_json, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        display_name = excluded.display_name,
        handle = excluded.handle,
        labels_json = excluded.labels_json,
        metadata_json = excluded.metadata_json`,
    ).run(
      actor.id,
      actor.kind,
      actor.displayName,
      actor.handle ?? null,
      stringify(actor.labels),
      stringify(actor.metadata),
    );
  }

  upsertAgent(agent: AgentDefinition): void {
    this.db.query(
      `INSERT INTO agents (
        id, definition_id, node_qualifier, workspace_qualifier, selector, default_selector,
        agent_class, capabilities_json, wake_policy, home_node_id, authority_node_id,
        advertise_scope, owner_id, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
      ON CONFLICT(id) DO UPDATE SET
        definition_id = excluded.definition_id,
        node_qualifier = excluded.node_qualifier,
        workspace_qualifier = excluded.workspace_qualifier,
        selector = excluded.selector,
        default_selector = excluded.default_selector,
        agent_class = excluded.agent_class,
        capabilities_json = excluded.capabilities_json,
        wake_policy = excluded.wake_policy,
        home_node_id = excluded.home_node_id,
        authority_node_id = excluded.authority_node_id,
        advertise_scope = excluded.advertise_scope,
        owner_id = excluded.owner_id,
        metadata_json = excluded.metadata_json`,
    ).run(
      agent.id,
      agent.definitionId,
      agent.nodeQualifier ?? null,
      agent.workspaceQualifier ?? null,
      agent.selector ?? null,
      agent.defaultSelector ?? null,
      agent.agentClass,
      stringify(agent.capabilities),
      agent.wakePolicy,
      agent.homeNodeId,
      agent.authorityNodeId,
      agent.advertiseScope,
      agent.ownerId ?? null,
      stringify(agent.metadata),
    );
  }

  upsertEndpoint(endpoint: AgentEndpoint): void {
    this.db.query(
      `INSERT INTO agent_endpoints (
        id, agent_id, node_id, harness, transport, state, address, session_id, pane, cwd,
        project_root, metadata_json, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        agent_id = excluded.agent_id,
        node_id = excluded.node_id,
        harness = excluded.harness,
        transport = excluded.transport,
        state = excluded.state,
        address = excluded.address,
        session_id = excluded.session_id,
        pane = excluded.pane,
        cwd = excluded.cwd,
        project_root = excluded.project_root,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`,
    ).run(
      endpoint.id,
      endpoint.agentId,
      endpoint.nodeId,
      endpoint.harness,
      endpoint.transport,
      endpoint.state,
      endpoint.address ?? null,
      endpoint.sessionId ?? null,
      endpoint.pane ?? null,
      endpoint.cwd ?? null,
      endpoint.projectRoot ?? null,
      stringify(endpoint.metadata),
    );
  }

  upsertConversation(conversation: ConversationDefinition): void {
    (this.db as SQLiteTransactionalDatabase).transaction((nextConversation: ConversationDefinition) => {
      this.db.query(
        `INSERT INTO conversations (
          id, kind, title, visibility, share_mode, authority_node_id, topic,
          parent_conversation_id, message_id, metadata_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          title = excluded.title,
          visibility = excluded.visibility,
          share_mode = excluded.share_mode,
          authority_node_id = excluded.authority_node_id,
          topic = excluded.topic,
          parent_conversation_id = excluded.parent_conversation_id,
          message_id = excluded.message_id,
          metadata_json = excluded.metadata_json`,
      ).run(
        nextConversation.id,
        nextConversation.kind,
        nextConversation.title,
        nextConversation.visibility,
        nextConversation.shareMode,
        nextConversation.authorityNodeId,
        nextConversation.topic ?? null,
        nextConversation.parentConversationId ?? null,
        nextConversation.messageId ?? null,
        stringify(nextConversation.metadata),
      );
      this.db.query("DELETE FROM conversation_members WHERE conversation_id = ?1").run(nextConversation.id);
      for (const participantId of nextConversation.participantIds) {
        this.db.query(
          "INSERT OR REPLACE INTO conversation_members (conversation_id, actor_id) VALUES (?1, ?2)",
        ).run(nextConversation.id, participantId);
      }
    })(conversation);
  }

  upsertBinding(binding: ConversationBinding): void {
    this.db.query(
      `INSERT INTO bindings (
        id, conversation_id, platform, mode, external_channel_id, external_thread_id, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        platform = excluded.platform,
        mode = excluded.mode,
        external_channel_id = excluded.external_channel_id,
        external_thread_id = excluded.external_thread_id,
        metadata_json = excluded.metadata_json`,
    ).run(
      binding.id,
      binding.conversationId,
      binding.platform,
      binding.mode,
      binding.externalChannelId,
      binding.externalThreadId ?? null,
      stringify(binding.metadata),
    );
  }

  recordMessage(message: MessageRecord): ThreadEventEnvelope[] {
    const activityItem = this.projectMessageActivity(message);
    const threadMessageEvent = this.buildThreadMessageEvent(message, this.readDb);
    let threadEvents: ThreadEventEnvelope[] = [];
    (this.db as SQLiteTransactionalDatabase).transaction((
      nextMessage: MessageRecord,
      nextActivityItem: ActivityItem,
      nextThreadMessageEvent: ThreadEventInsert | null,
    ) => {
      this.db.query(
        `INSERT OR REPLACE INTO messages (
          id, conversation_id, actor_id, origin_node_id, class, body, reply_to_message_id,
          thread_conversation_id, speech_json, audience_json, visibility, policy, metadata_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      ).run(
        nextMessage.id,
        nextMessage.conversationId,
        nextMessage.actorId,
        nextMessage.originNodeId,
        nextMessage.class,
        nextMessage.body,
        nextMessage.replyToMessageId ?? null,
        nextMessage.threadConversationId ?? null,
        stringify(nextMessage.speech),
        stringify(nextMessage.audience),
        nextMessage.visibility,
        nextMessage.policy,
        stringify(nextMessage.metadata),
        nextMessage.createdAt,
      );
      this.db.query("DELETE FROM message_mentions WHERE message_id = ?1").run(nextMessage.id);
      for (const mention of nextMessage.mentions ?? []) {
        this.db.query(
          "INSERT OR REPLACE INTO message_mentions (message_id, actor_id, label) VALUES (?1, ?2, ?3)",
        ).run(nextMessage.id, mention.actorId, mention.label ?? null);
      }
      this.db.query("DELETE FROM message_attachments WHERE message_id = ?1").run(nextMessage.id);
      for (const attachment of nextMessage.attachments ?? []) {
        this.db.query(
          `INSERT OR REPLACE INTO message_attachments (
            id, message_id, media_type, file_name, blob_key, url, metadata_json
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        ).run(
          attachment.id,
          nextMessage.id,
          attachment.mediaType,
          attachment.fileName ?? null,
          attachment.blobKey ?? null,
          attachment.url ?? null,
          stringify(attachment.metadata),
        );
      }
      this.recordActivityItem(nextActivityItem);
      threadEvents = nextThreadMessageEvent
        ? [this.appendThreadEvent(nextThreadMessageEvent)]
        : [];
    })(message, activityItem, threadMessageEvent);
    return threadEvents;
  }

  recordInvocation(invocation: InvocationRequest): void {
    const collaborationRecordId = resolveInvocationCollaborationRecordId(invocation);
    this.db.query(
      `INSERT OR REPLACE INTO invocations (
        id, requester_id, requester_node_id, target_agent_id, target_node_id, action, task,
        collaboration_record_id, conversation_id, message_id, context_json, execution_json,
        ensure_awake, stream, timeout_ms, metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
    ).run(
      invocation.id,
      invocation.requesterId,
      invocation.requesterNodeId,
      invocation.targetAgentId,
      invocation.targetNodeId ?? null,
      invocation.action,
      invocation.task,
      collaborationRecordId ?? null,
      invocation.conversationId ?? null,
      invocation.messageId ?? null,
      stringify(invocation.context),
      stringify(invocation.execution),
      invocation.ensureAwake ? 1 : 0,
      invocation.stream ? 1 : 0,
      invocation.timeoutMs ?? null,
      stringify(invocation.metadata),
      invocation.createdAt,
    );
    this.recordActivityItem(this.projectInvocationActivity(invocation));
  }

  recordFlight(flight: FlightRecord): ThreadEventEnvelope[] {
    this.db.query(
      `INSERT OR REPLACE INTO flights (
        id, invocation_id, requester_id, target_agent_id, state, summary, output, error,
        metadata_json, started_at, completed_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).run(
      flight.id,
      flight.invocationId,
      flight.requesterId,
      flight.targetAgentId,
      flight.state,
      flight.summary ?? null,
      flight.output ?? null,
      flight.error ?? null,
      stringify(flight.metadata),
      flight.startedAt ?? null,
      flight.completedAt ?? null,
    );

    this.recordActivityItem(this.projectFlightActivity(flight));
    return this.recordThreadFlightEvent(flight);
  }

  recordScoutDispatch(dispatch: ScoutDispatchRecord): void {
    this.db.query(
      `INSERT OR REPLACE INTO scout_dispatches (
        id, kind, asked_label, detail, invocation_id, conversation_id, requester_id,
        dispatcher_node_id, dispatched_at, payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).run(
      dispatch.id,
      dispatch.kind,
      dispatch.askedLabel,
      dispatch.detail,
      dispatch.invocationId ?? null,
      dispatch.conversationId ?? null,
      dispatch.requesterId ?? null,
      dispatch.dispatcherNodeId,
      dispatch.dispatchedAt,
      JSON.stringify(dispatch),
    );
  }

  recordCollaborationRecord(record: CollaborationRecord): ThreadEventEnvelope[] {
    const detail: Record<string, unknown> = {
      metadata: record.metadata,
    };

    if (record.kind === "question") {
      detail.askedById = record.askedById;
      detail.askedOfId = record.askedOfId;
      detail.answerMessageId = record.answerMessageId;
      detail.spawnedWorkItemId = record.spawnedWorkItemId;
      detail.closedAt = record.closedAt;
    } else {
      detail.requestedById = record.requestedById;
      detail.waitingOn = record.waitingOn;
      detail.progress = record.progress;
      detail.startedAt = record.startedAt;
      detail.reviewRequestedAt = record.reviewRequestedAt;
      detail.completedAt = record.completedAt;
    }

    this.db.query(
      `INSERT OR REPLACE INTO collaboration_records (
        id, kind, state, acceptance_state, title, summary, created_by_id, owner_id,
        next_move_owner_id, conversation_id, parent_id, priority, labels_json, relations_json,
        detail_json, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
    ).run(
      record.id,
      record.kind,
      record.state,
      record.acceptanceState,
      record.title,
      record.summary ?? null,
      record.createdById,
      record.ownerId ?? null,
      record.nextMoveOwnerId ?? null,
      record.conversationId ?? null,
      record.parentId ?? null,
      record.priority ?? null,
      stringify(record.labels),
      stringify(record.relations),
      stringify(detail),
      record.createdAt,
      record.updatedAt,
    );
    return this.recordThreadCollaborationEvent(record);
  }

  recordCollaborationEvent(event: CollaborationEvent): ThreadEventEnvelope[] {
    this.db.query(
      `INSERT OR REPLACE INTO collaboration_events (
        id, record_id, record_kind, kind, actor_id, summary, metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).run(
      event.id,
      event.recordId,
      event.recordKind,
      event.kind,
      event.actorId,
      event.summary ?? null,
      stringify(event.metadata),
      event.at,
    );

    this.recordActivityItem({
      id: `activity:record:${event.id}`,
      kind: "collaboration_event",
      ts: event.at,
      recordId: event.recordId,
      actorId: event.actorId,
      title: summarizeText(event.summary ?? event.kind),
      summary: event.summary ?? event.kind,
      payload: {
        recordKind: event.recordKind,
        kind: event.kind,
        metadata: event.metadata,
      },
    });
    return this.recordThreadCollaborationEventAppend(event);
  }

  listActivityItems(options: {
    agentId?: string;
    actorId?: string;
    conversationId?: string;
    limit?: number;
  } = {}): ActivityItem[] {
    const filters: string[] = [];
    const values: Array<string | number> = [];

    if (options.agentId) {
      filters.push(`agent_id = ?${values.length + 1}`);
      values.push(options.agentId);
    }
    if (options.actorId) {
      filters.push(`actor_id = ?${values.length + 1}`);
      values.push(options.actorId);
    }
    if (options.conversationId) {
      filters.push(`conversation_id = ?${values.length + 1}`);
      values.push(options.conversationId);
    }

    const limit = options.limit ?? 200;
    const sql = [
      "SELECT * FROM activity_items",
      filters.length ? `WHERE ${filters.join(" AND ")}` : "",
      "ORDER BY ts DESC",
      `LIMIT ?${values.length + 1}`,
    ].filter(Boolean).join(" ");
    const rows = queryAll<ActivityItemRow, Array<string | number>>(this.readDb, sql, ...values, limit);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      ts: row.ts,
      conversationId: row.conversation_id ?? undefined,
      messageId: row.message_id ?? undefined,
      invocationId: row.invocation_id ?? undefined,
      flightId: row.flight_id ?? undefined,
      recordId: row.record_id ?? undefined,
      actorId: row.actor_id ?? undefined,
      counterpartId: row.counterpart_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      workspaceRoot: row.workspace_root ?? undefined,
      sessionId: row.session_id ?? undefined,
      title: row.title ?? undefined,
      summary: row.summary ?? undefined,
      payload: parseJson<Record<string, unknown> | undefined>(row.payload_json, undefined),
    }));
  }

  listCollaborationRecords(options: {
    limit?: number;
    kind?: CollaborationRecord["kind"];
    state?: string;
    ownerId?: string;
    nextMoveOwnerId?: string;
  } = {}): CollaborationRecord[] {
    const filters: string[] = [];
    const values: Array<string | number> = [];

    if (options.kind) {
      filters.push(`kind = ?${values.length + 1}`);
      values.push(options.kind);
    }
    if (options.state) {
      filters.push(`state = ?${values.length + 1}`);
      values.push(options.state);
    }
    if (options.ownerId) {
      filters.push(`owner_id = ?${values.length + 1}`);
      values.push(options.ownerId);
    }
    if (options.nextMoveOwnerId) {
      filters.push(`next_move_owner_id = ?${values.length + 1}`);
      values.push(options.nextMoveOwnerId);
    }

    const limit = options.limit ?? 200;
    const sql = [
      "SELECT * FROM collaboration_records",
      filters.length ? `WHERE ${filters.join(" AND ")}` : "",
      "ORDER BY updated_at DESC",
      `LIMIT ?${values.length + 1}`,
    ].filter(Boolean).join(" ");
    const rows = queryAll<CollaborationRecordRow, Array<string | number>>(this.readDb, sql, ...values, limit);
    return rows.map(buildCollaborationRecord);
  }

  listCollaborationEvents(options: { limit?: number; recordId?: string } = {}): CollaborationEvent[] {
    const filters: string[] = [];
    const values: Array<string | number> = [];

    if (options.recordId) {
      filters.push(`record_id = ?${values.length + 1}`);
      values.push(options.recordId);
    }

    const limit = options.limit ?? 200;
    const sql = [
      "SELECT * FROM collaboration_events",
      filters.length ? `WHERE ${filters.join(" AND ")}` : "",
      "ORDER BY created_at DESC",
      `LIMIT ?${values.length + 1}`,
    ].filter(Boolean).join(" ");
    const rows = queryAll<CollaborationEventRow, Array<string | number>>(this.readDb, sql, ...values, limit);
    return rows.map((row) => ({
      id: row.id,
      recordId: row.record_id,
      recordKind: row.record_kind as CollaborationEvent["recordKind"],
      kind: row.kind as CollaborationEvent["kind"],
      actorId: row.actor_id,
      summary: row.summary ?? undefined,
      metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
      at: row.created_at,
    }));
  }

  recordDeliveries(deliveries: DeliveryIntent[]): void {
    for (const delivery of deliveries) {
      this.drizzleDb
        .insert(deliveriesTable)
        .values({
          id: delivery.id,
          messageId: delivery.messageId ?? null,
          invocationId: delivery.invocationId ?? null,
          targetId: delivery.targetId,
          targetNodeId: delivery.targetNodeId ?? null,
          targetKind: delivery.targetKind,
          transport: delivery.transport,
          reason: delivery.reason,
          policy: delivery.policy,
          status: delivery.status,
          bindingId: delivery.bindingId ?? null,
          leaseOwner: delivery.leaseOwner ?? null,
          leaseExpiresAt: delivery.leaseExpiresAt ?? null,
          metadataJson: stringify(delivery.metadata),
        })
        .onConflictDoUpdate({
          target: deliveriesTable.id,
          set: {
            messageId: delivery.messageId ?? null,
            invocationId: delivery.invocationId ?? null,
            targetId: delivery.targetId,
            targetNodeId: delivery.targetNodeId ?? null,
            targetKind: delivery.targetKind,
            transport: delivery.transport,
            reason: delivery.reason,
            policy: delivery.policy,
            status: delivery.status,
            bindingId: delivery.bindingId ?? null,
            leaseOwner: delivery.leaseOwner ?? null,
            leaseExpiresAt: delivery.leaseExpiresAt ?? null,
            metadataJson: stringify(delivery.metadata),
          },
        })
        .run();
    }
  }

  listDeliveries(options: {
    transport?: DeliveryIntent["transport"];
    status?: DeliveryIntent["status"];
    limit?: number;
  } = {}): DeliveryIntent[] {
    const limit = options.limit ?? 200;

    const baseQuery = this.drizzleReadDb
      .select()
      .from(deliveriesTable)
      .orderBy(asc(deliveriesTable.createdAt))
      .limit(limit);
    const rows = options.transport && options.status
      ? baseQuery.where(
        and(
          eq(deliveriesTable.transport, options.transport),
          eq(deliveriesTable.status, options.status),
        ),
      ).all()
      : options.transport
        ? baseQuery.where(eq(deliveriesTable.transport, options.transport)).all()
        : options.status
          ? baseQuery.where(eq(deliveriesTable.status, options.status)).all()
          : baseQuery.all();

    return rows.map((row) => ({
      id: row.id,
      messageId: row.messageId ?? undefined,
      invocationId: row.invocationId ?? undefined,
      targetId: row.targetId,
      targetNodeId: row.targetNodeId ?? undefined,
      targetKind: row.targetKind,
      transport: row.transport,
      reason: row.reason,
      policy: row.policy,
      status: row.status,
      bindingId: row.bindingId ?? undefined,
      leaseOwner: row.leaseOwner ?? undefined,
      leaseExpiresAt: row.leaseExpiresAt ?? undefined,
      metadata: parseJson<Record<string, unknown> | undefined>(row.metadataJson, undefined),
    }));
  }

  updateDeliveryStatus(
    deliveryId: string,
    status: DeliveryIntent["status"],
    options: {
      metadata?: Record<string, unknown> | undefined;
      leaseOwner?: string | null;
      leaseExpiresAt?: number | null;
    } = {},
  ): void {
    const current = this.drizzleDb
      .select({ metadataJson: deliveriesTable.metadataJson })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, deliveryId))
      .get();
    const mergedMetadata = options.metadata
      ? {
          ...parseJson<Record<string, unknown>>(current?.metadataJson, {}),
          ...options.metadata,
        }
      : current?.metadataJson
        ? parseJson<Record<string, unknown>>(current.metadataJson, {})
        : undefined;

    this.drizzleDb
      .update(deliveriesTable)
      .set({
        status,
        leaseOwner: options.leaseOwner ?? null,
        leaseExpiresAt: options.leaseExpiresAt ?? null,
        metadataJson: stringify(mergedMetadata),
      })
      .where(eq(deliveriesTable.id, deliveryId))
      .run();
  }

  listDeliveryAttempts(deliveryId: string): DeliveryAttempt[] {
    const rows = this.drizzleReadDb
      .select()
      .from(deliveryAttemptsTable)
      .where(eq(deliveryAttemptsTable.deliveryId, deliveryId))
      .orderBy(asc(deliveryAttemptsTable.attempt), asc(deliveryAttemptsTable.createdAt))
      .all();

    return rows.map((row) => ({
      id: row.id,
      deliveryId: row.deliveryId,
      attempt: row.attempt,
      status: row.status,
      error: row.error ?? undefined,
      externalRef: row.externalRef ?? undefined,
      createdAt: row.createdAt,
      metadata: parseJson<Record<string, unknown> | undefined>(row.metadataJson, undefined),
    }));
  }

  recordDeliveryAttempt(attempt: DeliveryAttempt): void {
    this.drizzleDb
      .insert(deliveryAttemptsTable)
      .values({
        id: attempt.id,
        deliveryId: attempt.deliveryId,
        attempt: attempt.attempt,
        status: attempt.status,
        error: attempt.error ?? null,
        externalRef: attempt.externalRef ?? null,
        metadataJson: stringify(attempt.metadata),
        createdAt: attempt.createdAt,
      })
      .onConflictDoUpdate({
        target: deliveryAttemptsTable.id,
        set: {
          deliveryId: attempt.deliveryId,
          attempt: attempt.attempt,
          status: attempt.status,
          error: attempt.error ?? null,
          externalRef: attempt.externalRef ?? null,
          metadataJson: stringify(attempt.metadata),
          createdAt: attempt.createdAt,
        },
      })
      .run();
  }

  private recordActivityItem(item: ActivityItem): void {
    this.db.query(
      `INSERT OR REPLACE INTO activity_items (
        id, kind, ts, conversation_id, message_id, invocation_id, flight_id, record_id,
        actor_id, counterpart_id, agent_id, workspace_root, session_id, title, summary, payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    ).run(
      item.id,
      item.kind,
      item.ts,
      item.conversationId ?? null,
      item.messageId ?? null,
      item.invocationId ?? null,
      item.flightId ?? null,
      item.recordId ?? null,
      item.actorId ?? null,
      item.counterpartId ?? null,
      item.agentId ?? null,
      item.workspaceRoot ?? null,
      item.sessionId ?? null,
      item.title ?? null,
      item.summary ?? null,
      stringify(item.payload),
    );
  }

  private projectMessageActivity(message: MessageRecord): ActivityItem {
    const agentId = this.resolveActivityAgentIdForMessage(message);
    const counterpartId = this.resolveCounterpartIdForMessage(message, agentId);
    const agentContext = this.resolveAgentContext(agentId);
    const kind = this.classifyMessageActivity(message, agentId, counterpartId);
    const bodySummary = summarizeText(message.body);

    return {
      id: `activity:message:${message.id}`,
      kind,
      ts: message.createdAt,
      conversationId: message.conversationId,
      messageId: message.id,
      actorId: message.actorId,
      counterpartId: counterpartId ?? undefined,
      agentId: agentId ?? undefined,
      workspaceRoot: agentContext.workspaceRoot ?? undefined,
      sessionId: agentContext.sessionId ?? undefined,
      title: bodySummary,
      summary: kind === "status_message" || kind === "ask_working" || kind === "ask_failed"
        ? bodySummary
        : undefined,
      payload: {
        class: message.class,
        replyToMessageId: message.replyToMessageId ?? null,
        mentionActorIds: (message.mentions ?? []).map((mention) => mention.actorId),
        visibility: message.visibility,
        policy: message.policy,
      },
    };
  }

  private projectInvocationActivity(invocation: InvocationRequest): ActivityItem {
    const agentContext = this.resolveAgentContext(invocation.targetAgentId);
    return {
      id: `activity:invocation:${invocation.id}`,
      kind: "invocation_recorded",
      ts: invocation.createdAt,
      conversationId: invocation.conversationId ?? undefined,
      messageId: invocation.messageId ?? undefined,
      invocationId: invocation.id,
      actorId: invocation.requesterId,
      counterpartId: invocation.targetAgentId,
      agentId: invocation.targetAgentId,
      workspaceRoot: agentContext.workspaceRoot ?? undefined,
      sessionId: agentContext.sessionId ?? undefined,
      title: summarizeText(invocation.task),
      summary: invocation.action,
      payload: {
        action: invocation.action,
        targetNodeId: invocation.targetNodeId ?? null,
        ensureAwake: invocation.ensureAwake,
        stream: invocation.stream,
        timeoutMs: invocation.timeoutMs ?? null,
      },
    };
  }

  private projectFlightActivity(flight: FlightRecord): ActivityItem {
    const agentContext = this.resolveAgentContext(flight.targetAgentId);
    return {
      id: `activity:flight:${flight.id}`,
      kind: "flight_updated",
      ts: flight.completedAt ?? flight.startedAt ?? Math.floor(Date.now() / 1000),
      invocationId: flight.invocationId,
      flightId: flight.id,
      actorId: flight.requesterId,
      counterpartId: flight.targetAgentId,
      agentId: flight.targetAgentId,
      workspaceRoot: agentContext.workspaceRoot ?? undefined,
      sessionId: agentContext.sessionId ?? undefined,
      title: summarizeText(flight.summary ?? flight.state),
      summary: flight.error ?? flight.output ?? flight.summary ?? flight.state,
      payload: {
        state: flight.state,
        startedAt: flight.startedAt ?? null,
        completedAt: flight.completedAt ?? null,
      },
    };
  }

  private classifyMessageActivity(
    message: MessageRecord,
    agentId: string | null,
    counterpartId: string | null,
  ): ActivityItemKind {
    const body = message.body.toLowerCase();
    if (message.class === "status") {
      if (/failed|timed out|error/.test(body)) {
        return "ask_failed";
      }
      if (/working|running|waking|queued/.test(body)) {
        return "ask_working";
      }
      return "status_message";
    }

    if (this.isKnownAgentId(message.actorId) && counterpartId && this.isKnownAgentId(counterpartId) && counterpartId !== message.actorId) {
      return "handoff_sent";
    }

    if (message.replyToMessageId && this.isKnownAgentId(message.actorId)) {
      return "ask_replied";
    }

    if (agentId && message.actorId !== agentId) {
      return "ask_opened";
    }

    if (this.isKnownAgentId(message.actorId)) {
      return "agent_message";
    }

    return "message_posted";
  }

  private resolveActivityAgentIdForMessage(message: MessageRecord): string | null {
    if (message.class === "status" && typeof message.metadata?.targetAgentId === "string" && this.isKnownAgentId(message.metadata.targetAgentId)) {
      return message.metadata.targetAgentId;
    }

    if (this.isKnownAgentId(message.actorId)) {
      return message.actorId;
    }

    const mentionedAgentIds = Array.from(new Set(
      (message.mentions ?? [])
        .map((mention) => mention.actorId)
        .filter((actorId) => this.isKnownAgentId(actorId)),
    ));
    if (mentionedAgentIds.length === 1) {
      return mentionedAgentIds[0] ?? null;
    }

    const conversationAgents = this.listConversationAgentIds(message.conversationId).filter((actorId) => actorId !== message.actorId);
    if (conversationAgents.length === 1) {
      return conversationAgents[0] ?? null;
    }

    return null;
  }

  private resolveCounterpartIdForMessage(message: MessageRecord, agentId: string | null): string | null {
    const conversationMembers = this.listConversationMemberIds(message.conversationId).filter((actorId) => actorId !== message.actorId);
    if (agentId && message.actorId !== agentId) {
      return message.actorId;
    }

    const explicitMentions = (message.mentions ?? [])
      .map((mention) => mention.actorId)
      .filter((actorId) => actorId !== message.actorId);
    if (explicitMentions.length === 1) {
      return explicitMentions[0] ?? null;
    }

    if (conversationMembers.length === 1) {
      return conversationMembers[0] ?? null;
    }

    return null;
  }

  private listConversationAgentIds(conversationId: string | undefined, db: Database = this.readDb): string[] {
    if (!conversationId) {
      return [];
    }

    return queryAll<{ actor_id: string }, [string]>(
      db,
      `SELECT cm.actor_id
      FROM conversation_members cm
      JOIN agents a ON a.id = cm.actor_id
      WHERE cm.conversation_id = ?1`,
      conversationId,
    ).map((row) => row.actor_id);
  }

  private listConversationMemberIds(conversationId: string | undefined, db: Database = this.readDb): string[] {
    if (!conversationId) {
      return [];
    }

    return queryAll<{ actor_id: string }, [string]>(
      db,
      "SELECT actor_id FROM conversation_members WHERE conversation_id = ?1",
      conversationId,
    ).map((row) => row.actor_id);
  }

  private isKnownAgentId(actorId: string | undefined | null, db: Database = this.readDb): actorId is string {
    if (!actorId) {
      return false;
    }

    const row = queryGet<{ id: string }, [string]>(
      db,
      "SELECT id FROM agents WHERE id = ?1 LIMIT 1",
      actorId,
    );
    return Boolean(row?.id);
  }

  private resolveAgentContext(agentId: string | undefined | null): { workspaceRoot: string | null; sessionId: string | null } {
    if (!agentId) {
      return { workspaceRoot: null, sessionId: null };
    }

    const row = queryGet<Pick<EndpointRow, "project_root" | "cwd" | "session_id">, [string]>(
      this.readDb,
      `SELECT project_root, cwd, session_id
      FROM agent_endpoints
      WHERE agent_id = ?1
      ORDER BY updated_at DESC
      LIMIT 1`,
      agentId,
    );

    return {
      workspaceRoot: row?.project_root ?? row?.cwd ?? null,
      sessionId: row?.session_id ?? null,
    };
  }

  private loadConversation(conversationId: string, db: Database = this.db): ConversationDefinition | null {
    const row = queryGet<ConversationRow, [string]>(
      db,
      "SELECT * FROM conversations WHERE id = ?1 LIMIT 1",
      conversationId,
    );
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      visibility: row.visibility,
      shareMode: row.share_mode,
      authorityNodeId: row.authority_node_id,
      participantIds: this.listConversationMemberIds(row.id, db),
      topic: row.topic ?? undefined,
      parentConversationId: row.parent_conversation_id ?? undefined,
      messageId: row.message_id ?? undefined,
      metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
    };
  }

  private buildThreadEvent(row: ThreadEventRow): ThreadEventEnvelope {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      authorityNodeId: row.authority_node_id,
      seq: row.seq,
      kind: row.kind,
      actorId: row.actor_id ?? undefined,
      ts: row.ts,
      payload: parseJson<ThreadEventEnvelope["payload"]>(
        row.payload_json,
        {} as ThreadEventEnvelope["payload"],
      ),
      notification: parseJson<ThreadEventNotification | undefined>(
        row.notification_json,
        undefined,
      ),
    };
  }

  private threadModeForConversation(conversation: ConversationDefinition): "summary" | "shared" {
    return conversation.shareMode === "summary" ? "summary" : "shared";
  }

  private appendThreadEvent(input: ThreadEventInsert): ThreadEventEnvelope {
    const existing = queryGet<ThreadEventRow, [string]>(
      this.db,
      "SELECT * FROM thread_events WHERE id = ?1 LIMIT 1",
      input.id,
    );
    if (existing) {
      return this.buildThreadEvent(existing);
    }

    const nextSeqRow = queryGet<{ next_seq: number | null }, [string]>(
      this.db,
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM thread_events WHERE conversation_id = ?1",
      input.conversation.id,
    );
    const seq = nextSeqRow?.next_seq ?? 1;

    this.db.query(
      `INSERT INTO thread_events (
        id, conversation_id, authority_node_id, seq, kind, actor_id, ts, payload_json, notification_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).run(
      input.id,
      input.conversation.id,
      input.conversation.authorityNodeId,
      seq,
      input.kind,
      input.actorId ?? null,
      input.ts,
      JSON.stringify(input.payload),
      stringify(input.notification),
    );

    return {
      id: input.id,
      conversationId: input.conversation.id,
      authorityNodeId: input.conversation.authorityNodeId,
      seq,
      kind: input.kind,
      actorId: input.actorId,
      ts: input.ts,
      payload: input.payload,
      notification: input.notification,
    };
  }

  private recordThreadMessageEvent(message: MessageRecord): ThreadEventEnvelope[] {
    const input = this.buildThreadMessageEvent(message);
    return input ? [this.appendThreadEvent(input)] : [];
  }

  private buildThreadMessageEvent(message: MessageRecord, db: Database = this.db): ThreadEventInsert | null {
    const conversation = this.loadConversation(message.conversationId, db);
    if (!conversation) {
      return null;
    }

    const payload = this.threadModeForConversation(conversation) === "summary"
      ? { message: this.buildThreadMessageSummary(message) }
      : { message };

    return {
      id: `thread-event:message:${message.id}:${message.createdAt}`,
      conversation,
      kind: "message.posted",
      actorId: message.actorId,
      ts: message.createdAt,
      payload,
      notification: this.buildMessageThreadNotification(message, db),
    };
  }

  private recordThreadFlightEvent(flight: FlightRecord): ThreadEventEnvelope[] {
    const invocation = queryGet<Pick<InvocationRow, "conversation_id">, [string]>(
      this.db,
      "SELECT conversation_id FROM invocations WHERE id = ?1 LIMIT 1",
      flight.invocationId,
    );
    if (!invocation?.conversation_id) {
      return [];
    }

    const conversation = this.loadConversation(invocation.conversation_id);
    if (!conversation) {
      return [];
    }

    const payload = this.threadModeForConversation(conversation) === "summary"
      ? { flight: this.buildThreadFlightSummary(flight) }
      : { flight };
    const ts = flight.completedAt ?? flight.startedAt ?? Date.now();

    return [this.appendThreadEvent({
      id: `thread-event:flight:${flight.id}:${flight.state}:${ts}`,
      conversation,
      kind: "flight.updated",
      actorId: flight.requesterId,
      ts,
      payload,
      notification: this.buildFlightThreadNotification(flight),
    })];
  }

  private recordThreadCollaborationEvent(record: CollaborationRecord): ThreadEventEnvelope[] {
    if (!record.conversationId) {
      return [];
    }

    const conversation = this.loadConversation(record.conversationId);
    if (!conversation) {
      return [];
    }

    const payload = this.threadModeForConversation(conversation) === "summary"
      ? { record: this.buildThreadCollaborationSummary(record) }
      : { record };

    return [this.appendThreadEvent({
      id: `thread-event:collaboration:${record.id}:${record.updatedAt}`,
      conversation,
      kind: "collaboration.upserted",
      actorId: record.createdById,
      ts: record.updatedAt,
      payload,
      notification: this.buildCollaborationThreadNotification(record),
    })];
  }

  private recordThreadCollaborationEventAppend(event: CollaborationEvent): ThreadEventEnvelope[] {
    const record = queryGet<CollaborationRecordRow, [string]>(
      this.db,
      "SELECT * FROM collaboration_records WHERE id = ?1 LIMIT 1",
      event.recordId,
    );
    if (!record?.conversation_id) {
      return [];
    }

    const conversation = this.loadConversation(record.conversation_id);
    if (!conversation) {
      return [];
    }

    const payload = this.threadModeForConversation(conversation) === "summary"
      ? { event: this.buildThreadCollaborationEventSummary(event) }
      : { event };

    return [this.appendThreadEvent({
      id: `thread-event:collaboration-event:${event.id}:${event.at}`,
      conversation,
      kind: "collaboration.event.appended",
      actorId: event.actorId,
      ts: event.at,
      payload,
      notification: undefined,
    })];
  }

  private buildThreadMessageSummary(message: MessageRecord): ThreadMessageSummary {
    return {
      id: message.id,
      actorId: message.actorId,
      class: message.class,
      replyToMessageId: message.replyToMessageId,
      threadConversationId: message.threadConversationId,
      mentionActorIds: (message.mentions ?? []).map((mention) => mention.actorId),
      createdAt: message.createdAt,
      summary: summarizeText(message.body),
    };
  }

  private buildThreadFlightSummary(flight: FlightRecord): ThreadFlightSummary {
    return {
      id: flight.id,
      invocationId: flight.invocationId,
      requesterId: flight.requesterId,
      targetAgentId: flight.targetAgentId,
      state: flight.state,
      summary: flight.summary,
      error: flight.error,
      startedAt: flight.startedAt,
      completedAt: flight.completedAt,
    };
  }

  private buildThreadCollaborationSummary(record: CollaborationRecord): ThreadCollaborationSummary {
    return {
      id: record.id,
      kind: record.kind,
      state: record.state,
      acceptanceState: record.acceptanceState,
      title: record.title,
      summary: record.summary,
      ownerId: record.ownerId,
      nextMoveOwnerId: record.nextMoveOwnerId,
      updatedAt: record.updatedAt,
    };
  }

  private buildThreadCollaborationEventSummary(event: CollaborationEvent): ThreadCollaborationEventSummary {
    return {
      id: event.id,
      recordId: event.recordId,
      recordKind: event.recordKind,
      kind: event.kind,
      actorId: event.actorId,
      at: event.at,
      summary: event.summary,
    };
  }

  private buildMessageThreadNotification(message: MessageRecord, db: Database = this.db): ThreadEventNotification | undefined {
    const mentionActorIds = [...new Set(
      (message.mentions ?? [])
        .map((mention) => mention.actorId)
        .filter((actorId) => actorId && actorId !== message.actorId),
    )];
    if (mentionActorIds.length > 0) {
      return {
        tier: "badge",
        targetActorIds: mentionActorIds,
        reason: "mention",
        summary: summarizeText(message.body, 80),
      };
    }

    if (!message.replyToMessageId) {
      return undefined;
    }

    const replyTarget = queryGet<{ actor_id: string }, [string]>(
      db,
      "SELECT actor_id FROM messages WHERE id = ?1 LIMIT 1",
      message.replyToMessageId,
    );
    if (!replyTarget?.actor_id || replyTarget.actor_id === message.actorId) {
      return undefined;
    }

    return {
      tier: "badge",
      targetActorIds: [replyTarget.actor_id],
      reason: "thread_reply",
      summary: summarizeText(message.body, 80),
    };
  }

  private buildFlightThreadNotification(flight: FlightRecord): ThreadEventNotification | undefined {
    if (flight.state === "completed") {
      return {
        tier: "badge",
        targetActorIds: [flight.requesterId],
        reason: "flight_completed",
        summary: summarizeText(flight.summary ?? `${flight.targetAgentId} completed`, 80),
      };
    }

    if (flight.state === "failed") {
      return {
        tier: "interrupt",
        targetActorIds: [flight.requesterId],
        reason: "flight_failed",
        summary: summarizeText(flight.error ?? flight.summary ?? `${flight.targetAgentId} failed`, 80),
      };
    }

    return undefined;
  }

  private buildCollaborationThreadNotification(record: CollaborationRecord): ThreadEventNotification | undefined {
    if (!record.nextMoveOwnerId || record.nextMoveOwnerId === record.createdById) {
      return undefined;
    }

    return {
      tier: record.kind === "question" ? "interrupt" : "badge",
      targetActorIds: [record.nextMoveOwnerId],
      reason: "next_move",
      summary: summarizeText(record.summary ?? record.title, 80),
    };
  }

  private listConversationThreadMessages(
    conversation: ConversationDefinition,
  ): ThreadSnapshot["messages"] {
    const snapshot = this.loadSnapshot();
    const messages = Object.values(snapshot.messages)
      .filter((message) => message.conversationId === conversation.id)
      .sort((lhs, rhs) => lhs.createdAt - rhs.createdAt);

    return messages.map((message) => (
      this.threadModeForConversation(conversation) === "summary"
        ? this.buildThreadMessageSummary(message)
        : message
    ));
  }

  private listConversationThreadCollaboration(
    conversation: ConversationDefinition,
  ): ThreadSnapshot["collaboration"] {
    const snapshot = this.loadSnapshot();
    const records = Object.values(snapshot.collaborationRecords)
      .filter((record) => record.conversationId === conversation.id)
      .sort((lhs, rhs) => lhs.updatedAt - rhs.updatedAt);

    return records.map((record) => (
      this.threadModeForConversation(conversation) === "summary"
        ? this.buildThreadCollaborationSummary(record)
        : record
    ));
  }

  private listConversationThreadFlights(
    conversation: ConversationDefinition,
  ): ThreadSnapshot["activeFlights"] {
    const rows = queryAll<FlightRow, [string]>(
      this.readDb,
      `SELECT f.*
      FROM flights f
      JOIN invocations i ON i.id = f.invocation_id
      WHERE i.conversation_id = ?1
        AND f.state IN ('queued', 'waking', 'running', 'waiting')
      ORDER BY COALESCE(f.completed_at, f.started_at, 0) ASC`,
      conversation.id,
    );

    return rows.map((row) => {
      const flight: FlightRecord = {
        id: row.id,
        invocationId: row.invocation_id,
        requesterId: row.requester_id,
        targetAgentId: row.target_agent_id,
        state: row.state,
        summary: row.summary ?? undefined,
        output: row.output ?? undefined,
        error: row.error ?? undefined,
        metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
        startedAt: row.started_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
      };

      return this.threadModeForConversation(conversation) === "summary"
        ? this.buildThreadFlightSummary(flight)
        : flight;
    });
  }

  recordEvent(event: ControlEvent): void {
    this.pendingEvents.push(event);
    this.schedulePendingEventFlush();
  }
}
