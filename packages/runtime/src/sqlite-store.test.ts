import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});
