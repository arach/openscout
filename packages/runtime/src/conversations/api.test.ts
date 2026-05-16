import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConversationDefinition } from "@openscout/protocol";

import { SQLiteControlPlaneStore } from "../sqlite-store.ts";
import { conversationIdForAgent } from "./legacy-ids.ts";

const dbRoots = new Set<string>();

afterEach(() => {
  for (const root of dbRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  dbRoots.clear();
});

function createStore(): SQLiteControlPlaneStore {
  const root = mkdtempSync(join(tmpdir(), "openscout-conversations-repo-"));
  dbRoots.add(root);
  return new SQLiteControlPlaneStore(join(root, "control-plane.sqlite"));
}

function seedActorsAndNode(store: SQLiteControlPlaneStore, actorIds: string[]): void {
  store.upsertNode({
    id: "node-1",
    meshId: "mesh-1",
    name: "Test node",
    advertiseScope: "local",
    registeredAt: Date.now(),
  });
  for (const actorId of actorIds) {
    const isOperator = actorId === "operator";
    store.upsertActor({
      id: actorId,
      kind: isOperator ? "person" : "agent",
      displayName: isOperator ? "Operator" : actorId,
    });
    if (!isOperator) {
      store.upsertAgent({
        id: actorId,
        kind: "agent",
        definitionId: actorId,
        displayName: actorId,
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
    }
  }
}

function makeConversation(overrides: Partial<ConversationDefinition> = {}): ConversationDefinition {
  return {
    id: "conv-1",
    kind: "direct",
    title: "Direct",
    visibility: "private",
    shareMode: "local",
    authorityNodeId: "node-1",
    participantIds: ["operator", "agent-1"],
    ...overrides,
  };
}

describe("Conversations", () => {
  test("exposes a singleton via store.conversations", () => {
    const store = createStore();
    try {
      const first = store.conversations;
      const second = store.conversations;
      expect(first).toBe(second);
    } finally {
      store.close();
    }
  });

  test("findById returns the canonical ConversationDefinition", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "agent-1"]);
      const conversation = makeConversation();
      store.conversations.upsert(conversation);

      const loaded = store.conversations.findById("conv-1");
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe("conv-1");
      expect(loaded?.kind).toBe("direct");
      expect(loaded?.participantIds.sort()).toEqual(["agent-1", "operator"]);
    } finally {
      store.close();
    }
  });

  test("findById returns null for an unknown id", () => {
    const store = createStore();
    try {
      expect(store.conversations.findById("missing")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("findByNaturalKey returns null in SCO-031 (column lands in SCO-030)", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "agent-1"]);
      store.conversations.upsert(makeConversation());
      expect(store.conversations.findByNaturalKey("dm.operator.agent-1")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("findByAgent resolves the operator↔agent direct id", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "agent-1"]);
      const id = conversationIdForAgent("agent-1");
      store.conversations.upsert(makeConversation({ id, participantIds: ["operator", "agent-1"] }));

      const found = store.conversations.findByAgent("agent-1");
      expect(found?.id).toBe(id);
      expect(found?.kind).toBe("direct");
    } finally {
      store.close();
    }
  });

  test("findByAgent returns null when no canonical conversation exists", () => {
    const store = createStore();
    try {
      expect(store.conversations.findByAgent("nobody")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("findByParent returns child conversations", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "agent-1"]);
      store.conversations.upsert(makeConversation({ id: "parent-1", kind: "channel" }));
      store.conversations.upsert(makeConversation({ id: "parent-other", kind: "channel" }));
      store.conversations.upsert(makeConversation({
        id: "thread-1",
        kind: "thread",
        parentConversationId: "parent-1",
      }));
      store.conversations.upsert(makeConversation({
        id: "thread-2",
        kind: "thread",
        parentConversationId: "parent-1",
      }));
      store.conversations.upsert(makeConversation({
        id: "thread-other",
        kind: "thread",
        parentConversationId: "parent-other",
      }));

      const children = store.conversations.findByParent("parent-1");
      const childIds = children.map((c) => c.id).sort();
      expect(childIds).toEqual(["thread-1", "thread-2"]);
    } finally {
      store.close();
    }
  });

  test("findByParticipants matches exact-membership conversations", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "agent-1", "agent-2"]);

      store.conversations.upsert(makeConversation({
        id: "dm-op-agent1",
        participantIds: ["operator", "agent-1"],
      }));
      store.conversations.upsert(makeConversation({
        id: "dm-op-agent2",
        participantIds: ["operator", "agent-2"],
      }));
      store.conversations.upsert(makeConversation({
        id: "group",
        kind: "group_direct",
        participantIds: ["operator", "agent-1", "agent-2"],
      }));

      const dm = store.conversations.findByParticipants(["operator", "agent-1"]);
      expect(dm?.id).toBe("dm-op-agent1");

      const group = store.conversations.findByParticipants(["operator", "agent-1", "agent-2"]);
      expect(group?.id).toBe("group");

      const missing = store.conversations.findByParticipants(["operator", "ghost"]);
      expect(missing).toBeNull();
    } finally {
      store.close();
    }
  });

  test("upsert + delete round-trip", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "agent-1"]);
      store.conversations.upsert(makeConversation());
      expect(store.conversations.findById("conv-1")).not.toBeNull();

      store.conversations.delete("conv-1");
      expect(store.conversations.findById("conv-1")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("delete is a no-op for an unknown id", () => {
    const store = createStore();
    try {
      expect(() => store.conversations.delete("missing")).not.toThrow();
    } finally {
      store.close();
    }
  });

  test("ensureByNaturalKey uses the naturalKey as the row id (SCO-031 transitional)", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "agent-1"]);
      const created = store.conversations.ensureByNaturalKey({
        naturalKey: "dm.operator.agent-1",
        kind: "direct",
        title: "Direct",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["operator", "agent-1"],
      });
      expect(created.id).toBe("dm.operator.agent-1");

      const reloaded = store.conversations.findById("dm.operator.agent-1");
      expect(reloaded?.kind).toBe("direct");
      expect(reloaded?.participantIds.sort()).toEqual(["agent-1", "operator"]);
    } finally {
      store.close();
    }
  });

  test("resolveLegacyId resolves dm.<operator>.<agent> structural ids", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "agent-1"]);
      const id = conversationIdForAgent("agent-1");
      store.conversations.upsert(makeConversation({ id }));

      const resolved = store.conversations.resolveLegacyId(id);
      expect(resolved?.id).toBe(id);
    } finally {
      store.close();
    }
  });

  test("resolveLegacyId returns null when no candidate row exists", () => {
    const store = createStore();
    try {
      expect(store.conversations.resolveLegacyId("dm.operator.nobody")).toBeNull();
      expect(store.conversations.resolveLegacyId("garbage")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("resolveLegacyId resolves dm.<agent>.scout.main.mini local-session variant", () => {
    const store = createStore();
    try {
      seedActorsAndNode(store, ["operator", "local-session-agent-abc"]);
      const canonicalId = conversationIdForAgent("local-session-agent-abc");
      store.conversations.upsert(makeConversation({
        id: canonicalId,
        participantIds: ["operator", "local-session-agent-abc"],
      }));

      // legacy `dm.<agent>.scout.main.mini` should still resolve to the canonical row.
      const legacyId = `dm.${["local-session-agent-abc", "scout.main.mini"].sort().join(".")}`;
      const resolved = store.conversations.resolveLegacyId(legacyId);
      expect(resolved?.id).toBe(canonicalId);
    } finally {
      store.close();
    }
  });
});
