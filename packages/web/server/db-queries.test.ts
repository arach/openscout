import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDb, queryFlights, queryWorkItemById, queryWorkItems } from "./db-queries.ts";
import { SQLiteControlPlaneStore } from "../../runtime/src/sqlite-store.ts";

const tempRoots = new Set<string>();
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;

afterEach(() => {
  closeDb();
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }

  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function createSeededStore(): SQLiteControlPlaneStore {
  const root = mkdtempSync(join(tmpdir(), "openscout-web-db-queries-"));
  tempRoots.add(root);
  process.env.OPENSCOUT_CONTROL_HOME = root;
  const store = new SQLiteControlPlaneStore(join(root, "control-plane.sqlite"));

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
  store.recordCollaborationRecord({
    id: "work-1",
    kind: "work_item",
    title: "Observed work",
    createdById: "operator",
    ownerId: "agent-1",
    nextMoveOwnerId: "agent-1",
    conversationId: "conv-1",
    state: "working",
    acceptanceState: "none",
    requestedById: "operator",
    createdAt: 90,
    updatedAt: 90,
  });
  store.recordCollaborationRecord({
    id: "work-1-child",
    kind: "work_item",
    title: "Child work",
    createdById: "operator",
    ownerId: "agent-1",
    nextMoveOwnerId: "agent-1",
    parentId: "work-1",
    conversationId: "conv-1",
    state: "open",
    acceptanceState: "none",
    requestedById: "agent-1",
    createdAt: 95,
    updatedAt: 95,
  });
  store.recordCollaborationEvent({
    id: "event-1",
    recordId: "work-1",
    recordKind: "work_item",
    kind: "claimed",
    actorId: "agent-1",
    summary: "Claimed for implementation",
    at: 110,
  });
  store.recordInvocation({
    id: "inv-1",
    requesterId: "operator",
    requesterNodeId: "node-1",
    targetAgentId: "agent-1",
    action: "consult",
    task: "Do the work",
    collaborationRecordId: "work-1",
    conversationId: "conv-1",
    ensureAwake: true,
    stream: false,
    createdAt: 100,
  });
  store.recordFlight({
    id: "flight-1",
    invocationId: "inv-1",
    requesterId: "operator",
    targetAgentId: "agent-1",
    state: "running",
    summary: "In progress",
    startedAt: 101,
  });

  return store;
}

describe("web db query flights", () => {
  test("surfaces durable collaboration joins from invocations", () => {
    const store = createSeededStore();

    try {
      const flights = queryFlights({ conversationId: "conv-1", collaborationRecordId: "work-1" });

      expect(flights).toEqual([
        {
          id: "flight-1",
          invocationId: "inv-1",
          agentId: "agent-1",
          agentName: "Agent One",
          conversationId: "conv-1",
          collaborationRecordId: "work-1",
          state: "running",
          summary: "In progress",
          startedAt: 101,
          completedAt: null,
        },
      ]);
    } finally {
      store.close();
    }
  });
});

describe("web db query work item by id", () => {
  test("returns detail with ordered timeline, child work, and active flights", () => {
    const store = createSeededStore();

    try {
      store.recordCollaborationEvent({
        id: "event-2",
        recordId: "work-1",
        recordKind: "work_item",
        kind: "progressed",
        actorId: "agent-1",
        summary: "Implemented first pass",
        at: 150,
      });
      const detail = queryWorkItemById("work-1");
      expect(detail).not.toBeNull();
      if (!detail) throw new Error("missing detail");

      expect(detail.id).toBe("work-1");
      expect(detail.title).toBe("Observed work");
      expect(detail.createdAt).toBe(90);
      expect(detail.updatedAt).toBe(90);
      expect(detail.parentId).toBeNull();
      expect(detail.childWork.map((c) => c.id)).toEqual(["work-1-child"]);
      expect(detail.activeFlights.map((f) => f.id)).toEqual(["flight-1"]);

      const descendingTimestamps = detail.timeline.map((item) => item.at);
      const sorted = [...descendingTimestamps].sort((a, b) => b - a);
      expect(descendingTimestamps).toEqual(sorted);

      const kinds = detail.timeline.map((item) => `${item.kind}:${item.id}`);
      expect(kinds).toContain("collaboration_event:event:event-1");
      expect(kinds).toContain("collaboration_event:event:event-2");
      expect(kinds).toContain("flight_started:flight:flight-1:started");
      expect(kinds.some((k) => k.startsWith("message:"))).toBe(false);
    } finally {
      store.close();
    }
  });

  test("returns null for unknown id", () => {
    const store = createSeededStore();
    try {
      expect(queryWorkItemById("does-not-exist")).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("web db query work items", () => {
  test("projects active work rows from collaboration and execution state", () => {
    const store = createSeededStore();

    try {
      const work = queryWorkItems({ agentId: "agent-1" });

      expect(work).toEqual([
        {
          id: "work-1",
          title: "Observed work",
          summary: null,
          ownerId: "agent-1",
          ownerName: "Agent One",
          nextMoveOwnerId: "agent-1",
          nextMoveOwnerName: "Agent One",
          conversationId: "conv-1",
          state: "working",
          acceptanceState: "none",
          priority: null,
          currentPhase: "Working",
          attention: "silent",
          activeChildWorkCount: 1,
          activeFlightCount: 1,
          lastMeaningfulAt: 110,
          lastMeaningfulSummary: "Claimed for implementation",
        },
        {
          id: "work-1-child",
          title: "Child work",
          summary: null,
          ownerId: "agent-1",
          ownerName: "Agent One",
          nextMoveOwnerId: "agent-1",
          nextMoveOwnerName: "Agent One",
          conversationId: "conv-1",
          state: "open",
          acceptanceState: "none",
          priority: null,
          currentPhase: "Open",
          attention: "silent",
          activeChildWorkCount: 0,
          activeFlightCount: 0,
          lastMeaningfulAt: 95,
          lastMeaningfulSummary: "Child work",
        },
      ]);
    } finally {
      store.close();
    }
  });
});
