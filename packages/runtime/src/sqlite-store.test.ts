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
      const indexNames = getIndexNames(db, ["conversations", "flights", "activity_items", "invocations"]);

      expect(indexNames).toContain("idx_conversations_created_at");
      expect(indexNames).toContain("idx_flights_invocation_id");
      expect(indexNames).toContain("idx_activity_items_ts");
      expect(indexNames).toContain("idx_invocations_requester_created_at");
    } finally {
      db.close();
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
      const columns = db.query("SELECT name FROM pragma_table_info('invocations')").all() as Array<{ name: string }>;
      const indexNames = getIndexNames(db, ["conversations", "flights", "activity_items", "invocations"]);

      expect(columns.some((column) => column.name === "collaboration_record_id")).toBe(true);
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
});
