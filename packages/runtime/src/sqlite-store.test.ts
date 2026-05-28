import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import { CONTROL_PLANE_SCHEMA_VERSION } from "./schema.ts";
import { SQLiteControlPlaneStore } from "./sqlite-store.ts";

const dbRoots = new Set<string>();

afterEach(() => {
  for (const root of dbRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  dbRoots.clear();
});

function createStore(): SQLiteControlPlaneStore {
  const root = mkdtempSync(join(tmpdir(), "openscout-sqlite-store-"));
  dbRoots.add(root);
  return new SQLiteControlPlaneStore(join(root, "control-plane.sqlite"));
}

function createStoreWithPath(): { store: SQLiteControlPlaneStore; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "openscout-sqlite-store-"));
  dbRoots.add(root);
  const dbPath = join(root, "control-plane.sqlite");
  return {
    store: new SQLiteControlPlaneStore(dbPath),
    dbPath,
  };
}

function getIndexNames(db: Database, tables: string[]): string[] {
  const placeholders = tables.map(() => "?").join(", ");
  const rows = db.query(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'index'
       AND tbl_name IN (${placeholders})
     ORDER BY name ASC`,
  ).all(...tables) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function getWritableDb(store: SQLiteControlPlaneStore): Database {
  return (store as unknown as { db: Database }).db;
}

function countRows(db: Database, table: string, where: string, value: string): number {
  const row = db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where} = ?1`).get(value) as {
    count: number;
  } | null;
  return row?.count ?? 0;
}

describe("SQLiteControlPlaneStore", () => {
  test("persists a new conversation before its members and allows messages to be recorded", () => {
    const store = createStore();

    try {
      store.upsertNode({
        id: "node-1",
        meshId: "mesh-1",
        name: "Test node",
        advertiseScope: "local",
        registeredAt: Date.now(),
      });
      store.upsertActor({
        id: "operator",
        kind: "person",
        displayName: "Operator",
      });
      store.upsertActor({
        id: "agent-1",
        kind: "agent",
        displayName: "Agent One",
      });
      store.upsertAgent({
        id: "agent-1",
        kind: "agent",
        definitionId: "agent-1",
        displayName: "Agent One",
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });

      store.upsertConversation({
        id: "conv-1",
        kind: "direct",
        title: "Direct",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["agent-1", "operator"],
      });

      store.recordMessage({
        id: "msg-1",
        conversationId: "conv-1",
        actorId: "operator",
        originNodeId: "node-1",
        class: "agent",
        body: "hello",
        visibility: "private",
        policy: "durable",
        createdAt: Date.now(),
      });

      const snapshot = store.loadSnapshot();
      expect(snapshot.conversations["conv-1"]?.participantIds.sort()).toEqual(["agent-1", "operator"]);
      expect(snapshot.messages["msg-1"]?.conversationId).toBe("conv-1");
    } finally {
      store.close();
    }
  });

  test("derives replayable thread events and summary snapshots for summary conversations", () => {
    const store = createStore();

    try {
      store.upsertNode({
        id: "node-1",
        meshId: "mesh-1",
        name: "Test node",
        advertiseScope: "local",
        registeredAt: Date.now(),
      });
      store.upsertActor({
        id: "operator",
        kind: "person",
        displayName: "Operator",
      });
      store.upsertConversation({
        id: "conv-summary",
        kind: "channel",
        title: "Summary",
        visibility: "workspace",
        shareMode: "summary",
        authorityNodeId: "node-1",
        participantIds: ["operator"],
      });

      store.recordMessage({
        id: "msg-summary-1",
        conversationId: "conv-summary",
        actorId: "operator",
        originNodeId: "node-1",
        class: "agent",
        body: "hello from a summary conversation",
        visibility: "workspace",
        policy: "durable",
        createdAt: Date.now(),
      });

      const threadEvents = store.listThreadEvents({ conversationId: "conv-summary" });
      expect(threadEvents).toHaveLength(1);
      expect(threadEvents[0]?.seq).toBe(1);
      expect(threadEvents[0]?.kind).toBe("message.posted");
      expect((threadEvents[0]?.payload as { message?: { summary?: string; body?: string } }).message?.summary).toBe(
        "hello from a summary conversation",
      );
      expect((threadEvents[0]?.payload as { message?: { body?: string } }).message?.body).toBeUndefined();

      const snapshot = store.getThreadSnapshot("conv-summary");
      expect(snapshot?.latestSeq).toBe(1);
      expect((snapshot?.messages?.[0] as { summary?: string; body?: string } | undefined)?.summary).toBe(
        "hello from a summary conversation",
      );
      expect((snapshot?.messages?.[0] as { body?: string } | undefined)?.body).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("indexes latest endpoint lookups used by activity projection", () => {
    const { store, dbPath } = createStoreWithPath();
    const db = new Database(dbPath, { readonly: true });

    try {
      const plan = db.query(
        `EXPLAIN QUERY PLAN
        SELECT project_root, cwd, session_id
        FROM agent_endpoints
        WHERE agent_id = ?1
        ORDER BY updated_at DESC
        LIMIT 1`,
      ).all("agent-1") as Array<{ detail?: string }>;

      expect(plan.some((row) => String(row.detail ?? "").includes("idx_agent_endpoints_agent_updated_at"))).toBe(true);
    } finally {
      db.close();
      store.close();
    }
  });

  test("creates dashboard read indexes on fresh databases", () => {
    const { store, dbPath } = createStoreWithPath();
    const db = new Database(dbPath, { readonly: true });

    try {
      const indexNames = getIndexNames(db, [
        "messages",
        "deliveries",
        "delivery_attempts",
        "durable_actions",
        "collaboration_records",
        "conversations",
        "flights",
        "activity_items",
        "invocations",
        "unblock_requests",
        "unblock_request_events",
      ]);

      expect(indexNames).toContain("idx_messages_created_at");
      expect(indexNames).toContain("idx_messages_actor_created_at");
      expect(indexNames).toContain("idx_deliveries_created_at");
      expect(indexNames).toContain("idx_delivery_attempts_created_at");
      expect(indexNames).toContain("idx_durable_actions_kind_due_at_updated_at");
      expect(indexNames).toContain("idx_collaboration_records_kind_state_updated_at");
      expect(indexNames).toContain("idx_collaboration_records_parent_kind_state_updated_at");
      expect(indexNames).toContain("idx_collaboration_records_owner_kind_state_updated_at");
      expect(indexNames).toContain("idx_collaboration_records_next_move_owner_kind_state_updated_at");
      expect(indexNames).toContain("idx_conversations_created_at");
      expect(indexNames).toContain("idx_flights_invocation_id");
      expect(indexNames).toContain("idx_activity_items_ts");
      expect(indexNames).toContain("idx_invocations_requester_created_at");
      expect(indexNames).toContain("idx_unblock_requests_state_owner_updated_at");
      expect(indexNames).toContain("idx_unblock_requests_source_ref");
      expect(indexNames).toContain("idx_unblock_request_events_request_created_at");
    } finally {
      db.close();
      store.close();
    }
  });

  test("persists and reloads durable unblock requests", () => {
    const store = createStore();

    try {
      store.recordUnblockRequest({
        id: "unblock-1",
        kind: "permission",
        state: "open",
        source: "test-permission-source",
        sourceRef: "permission:req-1",
        title: "Allow tool: Bash",
        ownerId: "operator",
        createdById: "system",
        severity: "warning",
        actions: [
          { kind: "approve", label: "Allow" },
          { kind: "deny", label: "Deny" },
        ],
        createdAt: 100,
        updatedAt: 100,
      });
      store.recordUnblockRequestEvent({
        id: "evt-1",
        requestId: "unblock-1",
        kind: "created",
        actorId: "system",
        at: 100,
      });

      expect(store.loadSnapshot().unblockRequests["unblock-1"]?.sourceRef).toBe("permission:req-1");
      expect(store.listUnblockRequests({ ownerId: "operator", active: true })).toHaveLength(1);
      expect(store.listUnblockRequestEvents({ requestId: "unblock-1" })).toHaveLength(1);

      store.recordUnblockRequest({
        ...store.loadSnapshot().unblockRequests["unblock-1"]!,
        state: "resolved",
        updatedAt: 140,
        resolvedAt: 140,
        actions: undefined,
      });

      expect(store.listUnblockRequests({ ownerId: "operator", active: true })).toHaveLength(0);
      expect(store.loadSnapshot().unblockRequests["unblock-1"]?.state).toBe("resolved");
    } finally {
      store.close();
    }
  });

  test("persists invocation collaboration record ids, including context fallback", () => {
    const { store, dbPath } = createStoreWithPath();
    const db = new Database(dbPath, { readonly: true });

    try {
      store.upsertNode({
        id: "node-1",
        meshId: "mesh-1",
        name: "Test node",
        advertiseScope: "local",
        registeredAt: Date.now(),
      });
      store.upsertActor({
        id: "operator",
        kind: "person",
        displayName: "Operator",
      });
      store.upsertActor({
        id: "agent-1",
        kind: "agent",
        displayName: "Agent One",
      });
      store.upsertAgent({
        id: "agent-1",
        kind: "agent",
        definitionId: "agent-1",
        displayName: "Agent One",
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.recordCollaborationRecord({
        id: "work-1",
        kind: "work_item",
        title: "Top-level work",
        createdById: "operator",
        ownerId: "agent-1",
        nextMoveOwnerId: "agent-1",
        state: "working",
        acceptanceState: "none",
        requestedById: "operator",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      store.recordCollaborationRecord({
        id: "work-2",
        kind: "work_item",
        title: "Context work",
        createdById: "operator",
        ownerId: "agent-1",
        nextMoveOwnerId: "agent-1",
        state: "working",
        acceptanceState: "none",
        requestedById: "operator",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      store.recordInvocation({
        id: "inv-top-level",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-1",
        action: "consult",
        task: "Handle the top-level join",
        collaborationRecordId: "work-1",
        ensureAwake: true,
        stream: false,
        createdAt: Date.now(),
      });

      store.recordInvocation({
        id: "inv-context-fallback",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-1",
        action: "consult",
        task: "Handle the context join",
        context: {
          collaborationRecordId: "work-2",
        },
        ensureAwake: true,
        stream: false,
        createdAt: Date.now(),
      });

      const rows = db.query(
        `SELECT id, collaboration_record_id
         FROM invocations
         WHERE id IN ('inv-top-level', 'inv-context-fallback')
         ORDER BY id ASC`,
      ).all() as Array<{ id: string; collaboration_record_id: string | null }>;

      expect(rows).toEqual([
        { id: "inv-context-fallback", collaboration_record_id: "work-2" },
        { id: "inv-top-level", collaboration_record_id: "work-1" },
      ]);
    } finally {
      db.close();
      store.close();
    }
  });

  test("parent record upserts preserve children when SQLite foreign keys are enabled", () => {
    const store = createStore();
    const db = getWritableDb(store);
    db.exec("PRAGMA foreign_keys = ON;");

    try {
      store.upsertNode({
        id: "node-1",
        meshId: "mesh-1",
        name: "Test node",
        advertiseScope: "local",
        registeredAt: 1,
      });
      store.upsertActor({
        id: "operator",
        kind: "person",
        displayName: "Operator",
      });
      store.upsertActor({
        id: "agent-1",
        kind: "agent",
        displayName: "Agent One",
      });
      store.upsertAgent({
        id: "agent-1",
        kind: "agent",
        definitionId: "agent-1",
        displayName: "Agent One",
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertConversation({
        id: "conv-1",
        kind: "direct",
        title: "Direct",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["agent-1", "operator"],
      });

      const message = {
        id: "msg-1",
        conversationId: "conv-1",
        actorId: "operator",
        originNodeId: "node-1",
        class: "agent" as const,
        body: "hello",
        visibility: "private" as const,
        policy: "durable" as const,
        createdAt: 100,
      };
      store.recordMessage(message);
      store.recordDeliveries([{
        id: "delivery-msg-1",
        messageId: "msg-1",
        targetId: "agent-1",
        targetKind: "agent",
        transport: "local_socket",
        reason: "direct_message",
        policy: "best_effort",
        status: "accepted",
      }]);
      store.recordMessage({ ...message, body: "hello again" });
      expect(countRows(db, "deliveries", "message_id", "msg-1")).toBe(1);

      const invocation = {
        id: "inv-1",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-1",
        action: "consult" as const,
        task: "Handle this",
        ensureAwake: true,
        stream: false,
        labels: ["release:0.2.66"],
        createdAt: 110,
      };
      store.recordInvocation(invocation);
      store.recordFlight({
        id: "flight-1",
        invocationId: "inv-1",
        requesterId: "operator",
        targetAgentId: "agent-1",
        state: "running",
        labels: ["release:0.2.66"],
        startedAt: 120,
      });
      store.recordInvocation({ ...invocation, task: "Handle this updated" });
      expect(countRows(db, "flights", "invocation_id", "inv-1")).toBe(1);
      expect((db.query("SELECT labels_json FROM flights WHERE id = 'flight-1'").get() as { labels_json: string } | null)?.labels_json)
        .toBe("[\"release:0.2.66\"]");

      const collaborationRecord = {
        id: "work-1",
        kind: "work_item" as const,
        title: "Top-level work",
        createdById: "operator",
        ownerId: "agent-1",
        nextMoveOwnerId: "agent-1",
        state: "working" as const,
        acceptanceState: "none" as const,
        requestedById: "operator",
        createdAt: 130,
        updatedAt: 130,
      };
      store.recordCollaborationRecord(collaborationRecord);
      store.recordCollaborationEvent({
        id: "collab-event-1",
        recordId: "work-1",
        recordKind: "work_item",
        kind: "commented",
        actorId: "operator",
        at: 140,
      });
      store.recordCollaborationRecord({
        ...collaborationRecord,
        state: "completed",
        updatedAt: 150,
        completedAt: 150,
      });
      expect(countRows(db, "collaboration_events", "record_id", "work-1")).toBe(1);

      const unblockRequest = {
        id: "unblock-1",
        kind: "permission" as const,
        state: "open" as const,
        source: "test",
        sourceRef: "test:req-1",
        title: "Approve test",
        ownerId: "operator",
        createdById: "operator",
        createdAt: 160,
        updatedAt: 160,
      };
      store.recordUnblockRequest(unblockRequest);
      store.recordUnblockRequestEvent({
        id: "unblock-event-1",
        requestId: "unblock-1",
        kind: "created",
        actorId: "operator",
        at: 170,
      });
      store.recordUnblockRequest({
        ...unblockRequest,
        state: "resolved",
        updatedAt: 180,
        resolvedAt: 180,
      });
      store.recordUnblockRequest({
        ...unblockRequest,
        id: "unblock-duplicate-source",
        state: "resolved",
        updatedAt: 190,
        resolvedAt: 190,
      });
      expect(countRows(db, "unblock_request_events", "request_id", "unblock-1")).toBe(1);
      expect(countRows(db, "unblock_requests", "id", "unblock-duplicate-source")).toBe(0);

      store.recordDurableAction({
        id: "action-1",
        kind: "message_delivery",
        subjectId: "delivery-msg-1",
        authorityCellId: "node-1",
        state: "pending",
        idempotencyKey: "delivery-msg-1:create",
        leaseGeneration: 0,
        createdAt: 190,
        updatedAt: 190,
      });
      store.recordDurableAttempt({
        id: "attempt-1",
        actionId: "action-1",
        attempt: 1,
        state: "running",
        leaseGeneration: 1,
        startedAt: 200,
      });
      store.recordDurableAction({
        id: "action-1",
        kind: "message_delivery",
        subjectId: "delivery-msg-1",
        authorityCellId: "node-1",
        state: "running",
        idempotencyKey: "delivery-msg-1:create",
        leaseGeneration: 1,
        createdAt: 190,
        updatedAt: 210,
      });
      store.recordDurableAction({
        id: "action-duplicate-idempotency",
        kind: "message_delivery",
        subjectId: "delivery-msg-1",
        authorityCellId: "node-1",
        state: "running",
        idempotencyKey: "delivery-msg-1:create",
        leaseGeneration: 1,
        createdAt: 190,
        updatedAt: 220,
      });
      expect(countRows(db, "durable_attempts", "action_id", "action-1")).toBe(1);
      expect(countRows(db, "durable_actions", "id", "action-duplicate-idempotency")).toBe(0);
    } finally {
      store.close();
    }
  });

  test("migrates legacy databases to add invocation collaboration joins", () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-sqlite-store-"));
    dbRoots.add(root);
    const dbPath = join(root, "control-plane.sqlite");

    {
      const legacyDb = new Database(dbPath);
      legacyDb.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS flights (
          id TEXT PRIMARY KEY,
          invocation_id TEXT NOT NULL,
          target_agent_id TEXT NOT NULL,
          state TEXT NOT NULL,
          started_at INTEGER,
          completed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS activity_items (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          ts INTEGER NOT NULL,
          conversation_id TEXT,
          agent_id TEXT,
          actor_id TEXT,
          workspace_root TEXT,
          session_id TEXT
        );
        CREATE TABLE IF NOT EXISTS invocations (
          id TEXT PRIMARY KEY,
          requester_id TEXT NOT NULL,
          requester_node_id TEXT NOT NULL,
          target_agent_id TEXT NOT NULL,
          target_node_id TEXT,
          action TEXT NOT NULL,
          task TEXT NOT NULL,
          conversation_id TEXT,
          message_id TEXT,
          context_json TEXT,
          execution_json TEXT,
          ensure_awake INTEGER NOT NULL DEFAULT 1,
          stream INTEGER NOT NULL DEFAULT 1,
          timeout_ms INTEGER,
          metadata_json TEXT,
          created_at INTEGER NOT NULL
        );
      `);
      legacyDb.close();
    }

    const store = new SQLiteControlPlaneStore(dbPath);
    const db = new Database(dbPath, { readonly: true });

    try {
      const invocationColumns = db.query("SELECT name FROM pragma_table_info('invocations')").all() as Array<{ name: string }>;
      const flightColumns = db.query("SELECT name FROM pragma_table_info('flights')").all() as Array<{ name: string }>;
      const indexNames = getIndexNames(db, ["conversations", "flights", "activity_items", "invocations"]);

      expect(invocationColumns.some((column) => column.name === "collaboration_record_id")).toBe(true);
      expect(invocationColumns.some((column) => column.name === "labels_json")).toBe(true);
      expect(flightColumns.some((column) => column.name === "labels_json")).toBe(true);
      expect(indexNames).toContain("idx_invocations_collaboration_record_id_created_at");
      expect(indexNames).toContain("idx_invocations_requester_created_at");
      expect(indexNames).toContain("idx_flights_invocation_id");
      expect(indexNames).toContain("idx_activity_items_ts");
      expect(indexNames).toContain("idx_conversations_created_at");
    } finally {
      db.close();
      store.close();
    }
  });

  test("stamps the control-plane user_version on startup", () => {
    const { store, dbPath } = createStoreWithPath();
    const db = new Database(dbPath, { readonly: true });

    try {
      const row = db.query("PRAGMA user_version").get() as { user_version: number } | null;
      expect(row?.user_version).toBe(CONTROL_PLANE_SCHEMA_VERSION);
    } finally {
      db.close();
      store.close();
    }
  });

  test("migrates schema version 5 databases to durable action ledger tables", () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-sqlite-store-"));
    dbRoots.add(root);
    const dbPath = join(root, "control-plane.sqlite");

    {
      const legacyDb = new Database(dbPath);
      legacyDb.exec("PRAGMA user_version = 5;");
      legacyDb.close();
    }

    const store = new SQLiteControlPlaneStore(dbPath);
    const db = new Database(dbPath, { readonly: true });

    try {
      const tables = db.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'durable_%' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const version = db.query("PRAGMA user_version").get() as { user_version: number } | null;

      expect(tables.map((table) => table.name)).toEqual([
        "durable_actions",
        "durable_attempts",
        "durable_checkpoints",
        "durable_signals",
      ]);
      expect(version?.user_version).toBe(CONTROL_PLANE_SCHEMA_VERSION);
    } finally {
      db.close();
      store.close();
    }
  });

  test("round-trips deliveries and delivery attempts through the Drizzle proof path", () => {
    const store = createStore();

    try {
      store.recordDeliveries([
        {
          id: "delivery-1",
          targetId: "peer-node",
          targetKind: "node",
          transport: "peer_broker",
          reason: "invocation",
          policy: "must_ack",
          status: "accepted",
          metadata: {
            firstAttemptQueuedAt: 100,
          },
        },
        {
          id: "delivery-2",
          targetId: "thread-1",
          targetKind: "binding",
          transport: "thread_binding",
          reason: "message",
          policy: "best_effort",
          status: "accepted",
        },
      ]);

      store.updateDeliveryStatus("delivery-1", "peer_acked", {
        metadata: {
          peerAckedAt: 200,
        },
      });
      store.recordDeliveryAttempt({
        id: "attempt-1",
        deliveryId: "delivery-1",
        attempt: 1,
        status: "acknowledged",
        externalRef: "peer-flight-1",
        createdAt: 250,
        metadata: {
          durationMs: 50,
        },
      });

      expect(store.listDeliveries({ transport: "peer_broker" })).toEqual([
        {
          id: "delivery-1",
          targetId: "peer-node",
          targetKind: "node",
          transport: "peer_broker",
          reason: "invocation",
          policy: "must_ack",
          status: "peer_acked",
          metadata: {
            firstAttemptQueuedAt: 100,
            peerAckedAt: 200,
          },
        },
      ]);
      expect(store.listDeliveries({ status: "accepted" })).toEqual([
        {
          id: "delivery-2",
          targetId: "thread-1",
          targetKind: "binding",
          transport: "thread_binding",
          reason: "message",
          policy: "best_effort",
          status: "accepted",
          metadata: undefined,
        },
      ]);
      expect(store.listDeliveryAttempts("delivery-1")).toEqual([
        {
          id: "attempt-1",
          deliveryId: "delivery-1",
          attempt: 1,
          status: "acknowledged",
          externalRef: "peer-flight-1",
          createdAt: 250,
          metadata: {
            durationMs: 50,
          },
        },
      ]);
    } finally {
      store.close();
    }
  });

  test("enforces durable action idempotency, leases, attempts, and first-write-wins facts", () => {
    const store = createStore();

    try {
      const created = store.createOrGetDurableAction({
        id: "action-1",
        kind: "message_delivery",
        subjectId: "delivery-1",
        authorityCellId: "node-1",
        idempotencyKey: "delivery-1:create",
        createdAt: 100,
        metadata: { source: "test" },
      });
      expect(created.duplicate).toBe(false);
      expect(created.action.state).toBe("pending");

      const duplicate = store.createOrGetDurableAction({
        id: "action-duplicate",
        kind: "message_delivery",
        subjectId: "delivery-other",
        authorityCellId: "node-1",
        idempotencyKey: "delivery-1:create",
        createdAt: 101,
      });
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.action.id).toBe("action-1");
      expect(store.getDurableActionByIdempotencyKey({
        authorityCellId: "node-1",
        kind: "message_delivery",
        idempotencyKey: "delivery-1:create",
      })?.id).toBe("action-1");
      expect(store.getDurableActionByIdempotencyKey({
        authorityCellId: "node-other",
        kind: "message_delivery",
        idempotencyKey: "delivery-1:create",
      })).toBeNull();
      expect(store.getDurableActionByIdempotencyKey({
        authorityCellId: "node-1",
        kind: "ask",
        idempotencyKey: "delivery-1:create",
      })).toBeNull();
      expect(store.getDurableActionByIdempotencyKey({
        authorityCellId: "node-1",
        kind: "message_delivery",
        idempotencyKey: "delivery-other:create",
      })).toBeNull();

      const claimed = store.claimDurableAction({
        actionId: "action-1",
        owner: "worker-a",
        leaseMs: 30_000,
        claimedAt: 200,
      });
      expect(claimed?.state).toBe("leased");
      expect(claimed?.leaseOwner).toBe("worker-a");
      expect(claimed?.leaseGeneration).toBe(1);

      const blockedClaim = store.claimDurableAction({
        actionId: "action-1",
        owner: "worker-b",
        leaseMs: 30_000,
        claimedAt: 250,
      });
      expect(blockedClaim?.leaseOwner).toBe("worker-a");
      expect(blockedClaim?.leaseGeneration).toBe(1);

      const heartbeat = store.heartbeatDurableAction({
        actionId: "action-1",
        owner: "worker-a",
        generation: 1,
        leaseMs: 60_000,
        heartbeatAt: 275,
      });
      expect(heartbeat?.leaseExpiresAt).toBe(60_275);
      expect(store.heartbeatDurableAction({
        actionId: "action-1",
        owner: "worker-b",
        generation: 1,
        leaseMs: 60_000,
        heartbeatAt: 276,
      })).toBeNull();

      const attempt = store.startDurableAttempt({
        id: "attempt-1",
        actionId: "action-1",
        owner: "worker-a",
        generation: 1,
        startedAt: 300,
      });
      expect(attempt?.attempt).toBe(1);

      const running = store.transitionDurableAction({
        actionId: "action-1",
        owner: "worker-a",
        generation: 1,
        nextState: "running",
        transitionedAt: 350,
      });
      expect(running?.state).toBe("running");

      expect(store.startDurableAttempt({
        id: "attempt-stale",
        actionId: "action-1",
        owner: "worker-b",
        generation: 1,
        startedAt: 301,
      })).toBeNull();

      expect(() => store.recordDurableAttempt({
        id: "attempt-conflict",
        actionId: "action-1",
        attempt: 1,
        state: "running",
        leaseGeneration: 1,
        startedAt: 302,
      })).toThrow();
      expect(store.listDurableAttempts("action-1")).toHaveLength(1);

      const checkpoint = store.commitDurableCheckpoint({
        actionId: "action-1",
        name: "peer_acked",
        payload: { peerFlightId: "flight-1" },
        ownerAttemptId: "attempt-1",
        leaseOwner: "worker-a",
        leaseGeneration: 1,
        createdAt: 400,
      });
      expect(checkpoint?.duplicate).toBe(false);
      const duplicateCheckpoint = store.commitDurableCheckpoint({
        actionId: "action-1",
        name: "peer_acked",
        payload: { peerFlightId: "flight-ignored" },
        leaseOwner: "worker-a",
        leaseGeneration: 1,
        createdAt: 401,
      });
      expect(duplicateCheckpoint?.duplicate).toBe(true);
      expect(duplicateCheckpoint?.checkpoint.payload).toEqual({ peerFlightId: "flight-1" });

      const signal = store.emitDurableSignal({
        actionId: "action-1",
        name: "cancel_requested",
        payload: { by: "operator" },
        leaseOwner: "worker-a",
        leaseGeneration: 1,
        emittedAt: 500,
      });
      expect(signal?.duplicate).toBe(false);
      const duplicateSignal = store.emitDurableSignal({
        actionId: "action-1",
        name: "cancel_requested",
        payload: { by: "other" },
        leaseOwner: "worker-a",
        leaseGeneration: 1,
        emittedAt: 501,
      });
      expect(duplicateSignal?.duplicate).toBe(true);
      expect(duplicateSignal?.signal.payload).toEqual({ by: "operator" });

      const reclaimed = store.claimDurableAction({
        actionId: "action-1",
        owner: "worker-c",
        leaseMs: 30_000,
        claimedAt: 60_276,
      });
      expect(reclaimed?.state).toBe("leased");
      expect(reclaimed?.leaseOwner).toBe("worker-c");
      expect(reclaimed?.leaseGeneration).toBe(2);

      expect(store.commitDurableCheckpoint({
        actionId: "action-1",
        name: "stale",
        payload: { ignored: true },
        ownerAttemptId: "attempt-1",
        leaseOwner: "worker-a",
        leaseGeneration: 1,
        createdAt: 402,
      })).toBeNull();
      expect(store.emitDurableSignal({
        actionId: "action-1",
        name: "stale_signal",
        payload: { ignored: true },
        leaseOwner: "worker-a",
        leaseGeneration: 1,
        emittedAt: 502,
      })).toBeNull();

      expect(store.transitionDurableAction({
        actionId: "action-1",
        owner: "worker-b",
        generation: 1,
        nextState: "completed",
        transitionedAt: 600,
      })).toBeNull();

      const completed = store.transitionDurableAction({
        actionId: "action-1",
        owner: "worker-c",
        generation: 2,
        nextState: "completed",
        transitionedAt: 650,
      });
      expect(completed?.state).toBe("completed");
    } finally {
      store.close();
    }
  });

  test("lists due checkback durable actions that are claimable", () => {
    const store = createStore();

    try {
      store.createOrGetDurableAction({
        id: "checkback-due",
        kind: "checkback",
        subjectId: "reminder-1",
        authorityCellId: "node-1",
        idempotencyKey: "reminder-1",
        createdAt: 100,
        metadata: {
          dueAt: 1_000,
          mode: "scoutbot",
          body: "check lattices status",
        },
      });
      store.createOrGetDurableAction({
        id: "checkback-future",
        kind: "checkback",
        subjectId: "reminder-2",
        authorityCellId: "node-1",
        createdAt: 101,
        metadata: {
          dueAt: 10_000,
          mode: "notify",
          body: "later",
        },
      });
      store.createOrGetDurableAction({
        id: "delivery-due",
        kind: "message_delivery",
        subjectId: "delivery-1",
        authorityCellId: "node-1",
        createdAt: 102,
        metadata: {
          dueAt: 1_000,
        },
      });

      expect(store.listDueDurableActions({
        kind: "checkback",
        dueAtLte: 1_500,
      }).map((action) => action.id)).toEqual(["checkback-due"]);

      const claimed = store.claimDurableAction({
        actionId: "checkback-due",
        owner: "checkback-worker",
        leaseMs: 30_000,
        claimedAt: 1_600,
      });
      expect(claimed?.state).toBe("leased");
      expect(store.listDueDurableActions({
        kind: "checkback",
        dueAtLte: 2_000,
        claimableAt: 2_000,
      })).toEqual([]);

      expect(store.listDueDurableActions({
        kind: "checkback",
        dueAtLte: 32_000,
        claimableAt: 32_000,
      }).map((action) => action.id)).toEqual(["checkback-due", "checkback-future"]);

      const completed = store.transitionDurableAction({
        actionId: "checkback-due",
        owner: "checkback-worker",
        generation: 1,
        nextState: "completed",
        transitionedAt: 32_100,
      });
      expect(completed?.state).toBe("completed");
      expect(store.listDueDurableActions({
        kind: "checkback",
        dueAtLte: 32_200,
        claimableAt: 32_200,
      }).map((action) => action.id)).toEqual(["checkback-future"]);
    } finally {
      store.close();
    }
  });
});
