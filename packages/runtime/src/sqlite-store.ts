import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  ControlEvent,
  ConversationBinding,
  ConversationDefinition,
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

interface EventRow {
  id: string;
  kind: string;
  actor_id: string;
  node_id: string | null;
  ts: number;
  payload_json: string;
}

export class SQLiteControlPlaneStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec(CONTROL_PLANE_SQLITE_SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  loadSnapshot(): RuntimeRegistrySnapshot {
    const snapshot = createRuntimeRegistrySnapshot();

    const nodes = this.db.query<NodeRow>("SELECT * FROM nodes").all();
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

    const actors = this.db.query<ActorRow>("SELECT * FROM actors").all();
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

    const agents = this.db.query<AgentRow>("SELECT * FROM agents").all();
    for (const row of agents) {
      const actor = snapshot.actors[row.id];
      if (!actor) continue;

      snapshot.agents[row.id] = {
        ...actor,
        kind: "agent",
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

    const endpoints = this.db.query<EndpointRow>("SELECT * FROM agent_endpoints").all();
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

    const conversations = this.db.query<ConversationRow>("SELECT * FROM conversations").all();
    const members = this.db.query<{ conversation_id: string; actor_id: string }>(
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

    const bindings = this.db.query<BindingRow>("SELECT * FROM bindings").all();
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

    const messages = this.db.query<MessageRow>("SELECT * FROM messages").all();
    const mentionRows = this.db.query<MentionRow>("SELECT * FROM message_mentions").all();
    const attachmentRows = this.db.query<AttachmentRow>("SELECT * FROM message_attachments").all();
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

    const flights = this.db.query<FlightRow>("SELECT * FROM flights").all();
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

    return snapshot;
  }

  recentEvents(limit = 100): ControlEvent[] {
    const rows = this.db
      .query<EventRow>("SELECT * FROM events ORDER BY ts DESC LIMIT ?1")
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
        id, agent_class, capabilities_json, wake_policy, home_node_id, authority_node_id,
        advertise_scope, owner_id, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(id) DO UPDATE SET
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
  }

  recordInvocation(invocation: InvocationRequest): void {
    this.db.query(
      `INSERT OR REPLACE INTO invocations (
        id, requester_id, requester_node_id, target_agent_id, target_node_id, action, task,
        conversation_id, message_id, context_json, ensure_awake, stream, timeout_ms, metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
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
      invocation.ensureAwake ? 1 : 0,
      invocation.stream ? 1 : 0,
      invocation.timeoutMs ?? null,
      stringify(invocation.metadata),
      invocation.createdAt,
    );
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
