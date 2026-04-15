import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

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
});
