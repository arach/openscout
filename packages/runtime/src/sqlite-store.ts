import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

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
} from "@openscout/protocol";

import {
  createRuntimeRegistrySnapshot,
  type RuntimeRegistrySnapshot,
} from "./registry.js";
import { CONTROL_PLANE_SQLITE_SCHEMA } from "./schema.js";

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

interface DeliveryRow {
  id: string;
  message_id: string | null;
  invocation_id: string | null;
  target_id: string;
  target_node_id: string | null;
  target_kind: DeliveryIntent["targetKind"];
  transport: DeliveryIntent["transport"];
  reason: DeliveryIntent["reason"];
  policy: DeliveryIntent["policy"];
  status: DeliveryIntent["status"];
  binding_id: string | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  metadata_json: string | null;
}

interface DeliveryAttemptRow {
  id: string;
  delivery_id: string;
  attempt: number;
  status: DeliveryAttempt["status"];
  error: string | null;
  external_ref: string | null;
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

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    // The broker does frequent snapshot reads alongside short delivery-state writes.
    // WAL mode and a busy timeout reduce transient SQLITE_BUSY/database locked errors.
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(CONTROL_PLANE_SQLITE_SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  loadSnapshot(): RuntimeRegistrySnapshot {
    const snapshot = createRuntimeRegistrySnapshot();

    const nodes = this.db.query<NodeRow, any[]>("SELECT * FROM nodes").all();
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

    const actors = this.db.query<ActorRow, any[]>("SELECT * FROM actors").all();
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

    const agents = this.db.query<AgentRow, any[]>("SELECT * FROM agents").all();
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

    const endpoints = this.db.query<EndpointRow, any[]>("SELECT * FROM agent_endpoints").all();
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

    const conversations = this.db.query<ConversationRow, any[]>("SELECT * FROM conversations").all();
    const members = this.db.query<{ conversation_id: string; actor_id: string }, any[]>(
      "SELECT conversation_id, actor_id FROM conversation_members",
    ).all();
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

    const bindings = this.db.query<BindingRow, any[]>("SELECT * FROM bindings").all();
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

    const messages = this.db.query<MessageRow, any[]>("SELECT * FROM messages").all();
    const mentionRows = this.db.query<MentionRow, any[]>("SELECT * FROM message_mentions").all();
    const attachmentRows = this.db.query<AttachmentRow, any[]>("SELECT * FROM message_attachments").all();
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

    const flights = this.db.query<FlightRow, any[]>("SELECT * FROM flights").all();
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

    const collaborationRows = this.db.query<CollaborationRecordRow, any[]>(
      "SELECT * FROM collaboration_records",
    ).all();
    for (const row of collaborationRows) {
      snapshot.collaborationRecords[row.id] = buildCollaborationRecord(row);
    }

    return snapshot;
  }

  recentEvents(limit = 100): ControlEvent[] {
    const rows = this.db
      .query<EventRow, any[]>("SELECT * FROM events ORDER BY ts DESC LIMIT ?1")
      .all(limit)
      .reverse();

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      actorId: row.actor_id,
      nodeId: row.node_id ?? undefined,
      ts: row.ts,
      payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    })) as ControlEvent[];
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
      `INSERT INTO actors (id, kind, display_name, handle, labels_json, metadata_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
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
        updated_at = unixepoch()`,
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
      conversation.id,
      conversation.kind,
      conversation.title,
      conversation.visibility,
      conversation.shareMode,
      conversation.authorityNodeId,
      conversation.topic ?? null,
      conversation.parentConversationId ?? null,
      conversation.messageId ?? null,
      stringify(conversation.metadata),
    );

    this.db.query("DELETE FROM conversation_members WHERE conversation_id = ?1").run(conversation.id);
    for (const participantId of conversation.participantIds) {
      this.db.query(
        "INSERT OR REPLACE INTO conversation_members (conversation_id, actor_id) VALUES (?1, ?2)",
      ).run(conversation.id, participantId);
    }
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

  recordMessage(message: MessageRecord): void {
    this.db.query(
      `INSERT OR REPLACE INTO messages (
        id, conversation_id, actor_id, origin_node_id, class, body, reply_to_message_id,
        thread_conversation_id, speech_json, audience_json, visibility, policy, metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    ).run(
      message.id,
      message.conversationId,
      message.actorId,
      message.originNodeId,
      message.class,
      message.body,
      message.replyToMessageId ?? null,
      message.threadConversationId ?? null,
      stringify(message.speech),
      stringify(message.audience),
      message.visibility,
      message.policy,
      stringify(message.metadata),
      message.createdAt,
    );

    this.db.query("DELETE FROM message_mentions WHERE message_id = ?1").run(message.id);
    for (const mention of message.mentions ?? []) {
      this.db.query(
        "INSERT OR REPLACE INTO message_mentions (message_id, actor_id, label) VALUES (?1, ?2, ?3)",
      ).run(message.id, mention.actorId, mention.label ?? null);
    }

    this.db.query("DELETE FROM message_attachments WHERE message_id = ?1").run(message.id);
    for (const attachment of message.attachments ?? []) {
      this.db.query(
        `INSERT OR REPLACE INTO message_attachments (
          id, message_id, media_type, file_name, blob_key, url, metadata_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).run(
        attachment.id,
        message.id,
        attachment.mediaType,
        attachment.fileName ?? null,
        attachment.blobKey ?? null,
        attachment.url ?? null,
        stringify(attachment.metadata),
      );
    }

    this.recordActivityItem(this.projectMessageActivity(message));
  }

  recordInvocation(invocation: InvocationRequest): void {
    this.db.query(
      `INSERT OR REPLACE INTO invocations (
        id, requester_id, requester_node_id, target_agent_id, target_node_id, action, task,
        conversation_id, message_id, context_json, execution_json, ensure_awake, stream, timeout_ms, metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    ).run(
      invocation.id,
      invocation.requesterId,
      invocation.requesterNodeId,
      invocation.targetAgentId,
      invocation.targetNodeId ?? null,
      invocation.action,
      invocation.task,
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

  recordFlight(flight: FlightRecord): void {
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
  }

  recordCollaborationRecord(record: CollaborationRecord): void {
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
  }

  recordCollaborationEvent(event: CollaborationEvent): void {
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
    const rows = this.db.query<ActivityItemRow, any[]>(sql).all(...values, limit);
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
    const rows = this.db.query<CollaborationRecordRow, any[]>(sql).all(...values, limit);
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
    const rows = this.db.query<CollaborationEventRow, any[]>(sql).all(...values, limit);
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
    const stmt = this.db.query(
      `INSERT OR REPLACE INTO deliveries (
        id, message_id, invocation_id, target_id, target_node_id, target_kind, transport,
        reason, policy, status, binding_id, lease_owner, lease_expires_at, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    );
    for (const delivery of deliveries) {
      stmt.run(
        delivery.id,
        delivery.messageId ?? null,
        delivery.invocationId ?? null,
        delivery.targetId,
        delivery.targetNodeId ?? null,
        delivery.targetKind,
        delivery.transport,
        delivery.reason,
        delivery.policy,
        delivery.status,
        delivery.bindingId ?? null,
        delivery.leaseOwner ?? null,
        delivery.leaseExpiresAt ?? null,
        stringify(delivery.metadata),
      );
    }
  }

  listDeliveries(options: {
    transport?: DeliveryIntent["transport"];
    status?: DeliveryIntent["status"];
    limit?: number;
  } = {}): DeliveryIntent[] {
    const filters: string[] = [];
    const values: Array<string | number> = [];

    if (options.transport) {
      filters.push(`transport = ?${values.length + 1}`);
      values.push(options.transport);
    }
    if (options.status) {
      filters.push(`status = ?${values.length + 1}`);
      values.push(options.status);
    }

    const limit = options.limit ?? 200;
    const sql = [
      "SELECT * FROM deliveries",
      filters.length ? `WHERE ${filters.join(" AND ")}` : "",
      "ORDER BY created_at ASC",
      `LIMIT ?${values.length + 1}`,
    ].filter(Boolean).join(" ");
    const rows = this.db.query<DeliveryRow, any[]>(sql).all(...values, limit);
    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id ?? undefined,
      invocationId: row.invocation_id ?? undefined,
      targetId: row.target_id,
      targetNodeId: row.target_node_id ?? undefined,
      targetKind: row.target_kind,
      transport: row.transport,
      reason: row.reason,
      policy: row.policy,
      status: row.status,
      bindingId: row.binding_id ?? undefined,
      leaseOwner: row.lease_owner ?? undefined,
      leaseExpiresAt: row.lease_expires_at ?? undefined,
      metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
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
    const current = this.db.query<Pick<DeliveryRow, "metadata_json">, any[]>(
      "SELECT metadata_json FROM deliveries WHERE id = ?1",
    ).get(deliveryId);
    const mergedMetadata = options.metadata
      ? {
          ...parseJson<Record<string, unknown>>(current?.metadata_json, {}),
          ...options.metadata,
        }
      : current?.metadata_json
        ? parseJson<Record<string, unknown>>(current.metadata_json, {})
        : undefined;

    this.db.query(
      `UPDATE deliveries
      SET status = ?2,
          lease_owner = ?3,
          lease_expires_at = ?4,
          metadata_json = ?5
      WHERE id = ?1`,
    ).run(
      deliveryId,
      status,
      options.leaseOwner ?? null,
      options.leaseExpiresAt ?? null,
      stringify(mergedMetadata),
    );
  }

  listDeliveryAttempts(deliveryId: string): DeliveryAttempt[] {
    const rows = this.db.query<DeliveryAttemptRow, any[]>(
      "SELECT * FROM delivery_attempts WHERE delivery_id = ?1 ORDER BY attempt ASC, created_at ASC",
    ).all(deliveryId);

    return rows.map((row) => ({
      id: row.id,
      deliveryId: row.delivery_id,
      attempt: row.attempt,
      status: row.status,
      error: row.error ?? undefined,
      externalRef: row.external_ref ?? undefined,
      createdAt: row.created_at,
      metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
    }));
  }

  recordDeliveryAttempt(attempt: DeliveryAttempt): void {
    this.db.query(
      `INSERT OR REPLACE INTO delivery_attempts (
        id, delivery_id, attempt, status, error, external_ref, metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).run(
      attempt.id,
      attempt.deliveryId,
      attempt.attempt,
      attempt.status,
      attempt.error ?? null,
      attempt.externalRef ?? null,
      stringify(attempt.metadata),
      attempt.createdAt,
    );
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

  private listConversationAgentIds(conversationId: string | undefined): string[] {
    if (!conversationId) {
      return [];
    }

    return this.db.query<{ actor_id: string }, any[]>(
      `SELECT cm.actor_id
      FROM conversation_members cm
      JOIN agents a ON a.id = cm.actor_id
      WHERE cm.conversation_id = ?1`,
    ).all(conversationId).map((row) => row.actor_id);
  }

  private listConversationMemberIds(conversationId: string | undefined): string[] {
    if (!conversationId) {
      return [];
    }

    return this.db.query<{ actor_id: string }, any[]>(
      "SELECT actor_id FROM conversation_members WHERE conversation_id = ?1",
    ).all(conversationId).map((row) => row.actor_id);
  }

  private isKnownAgentId(actorId: string | undefined | null): actorId is string {
    if (!actorId) {
      return false;
    }

    const row = this.db.query<{ id: string }, any[]>(
      "SELECT id FROM agents WHERE id = ?1 LIMIT 1",
    ).get(actorId);
    return Boolean(row?.id);
  }

  private resolveAgentContext(agentId: string | undefined | null): { workspaceRoot: string | null; sessionId: string | null } {
    if (!agentId) {
      return { workspaceRoot: null, sessionId: null };
    }

    const row = this.db.query<Pick<EndpointRow, "project_root" | "cwd" | "session_id">, any[]>(
      `SELECT project_root, cwd, session_id
      FROM agent_endpoints
      WHERE agent_id = ?1
      ORDER BY updated_at DESC
      LIMIT 1`,
    ).get(agentId);

    return {
      workspaceRoot: row?.project_root ?? row?.cwd ?? null,
      sessionId: row?.session_id ?? null,
    };
  }

  recordEvent(event: ControlEvent): void {
    this.db.query(
      `INSERT OR REPLACE INTO events (id, kind, actor_id, node_id, ts, payload_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).run(
      event.id,
      event.kind,
      event.actorId,
      event.nodeId ?? null,
      event.ts,
      JSON.stringify(event.payload),
    );
  }
}
