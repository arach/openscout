import { describe, expect, test } from "bun:test";

import {
  validateCollaborationRecord,
  validateCollaborationEvent,
  assertValidCollaborationRecord,
  assertValidCollaborationEvent,
  isWorkItemTerminalState,
  collaborationRequiresOwner,
  collaborationRequiresNextMoveOwner,
  collaborationRequiresWaitingOn,
  collaborationRequiresAcceptance,
  type CollaborationRecord,
  type CollaborationEvent,
  type WorkItemRecord,
} from "./collaboration.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkItem(overrides: Partial<WorkItemRecord> = {}): WorkItemRecord {
  return {
    id: "wi-1",
    kind: "work_item",
    title: "Test work item",
    createdById: "actor-1",
    ownerId: "actor-1",
    nextMoveOwnerId: "actor-1",
    state: "open",
    acceptanceState: "none",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeCollabEvent(overrides: Partial<CollaborationEvent> = {}): CollaborationEvent {
  return {
    id: "cev-1",
    recordId: "wi-1",
    recordKind: "work_item",
    kind: "created",
    actorId: "actor-1",
    at: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isWorkItemTerminalState
// ---------------------------------------------------------------------------

describe("isWorkItemTerminalState", () => {
  test("returns true for done", () => {
    expect(isWorkItemTerminalState("done")).toBe(true);
  });

  test("returns true for cancelled", () => {
    expect(isWorkItemTerminalState("cancelled")).toBe(true);
  });

  test("returns false for non-terminal states", () => {
    expect(isWorkItemTerminalState("open")).toBe(false);
    expect(isWorkItemTerminalState("working")).toBe(false);
    expect(isWorkItemTerminalState("waiting")).toBe(false);
    expect(isWorkItemTerminalState("review")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collaborationRequires* helpers
// ---------------------------------------------------------------------------

describe("collaborationRequiresOwner", () => {
  test("requires owner for non-terminal work_item", () => {
    expect(collaborationRequiresOwner(makeWorkItem({ state: "open" }))).toBe(true);
    expect(collaborationRequiresOwner(makeWorkItem({ state: "working" }))).toBe(true);
  });

  test("does not require owner for terminal work_item", () => {
    expect(collaborationRequiresOwner(makeWorkItem({ state: "done" }))).toBe(false);
    expect(collaborationRequiresOwner(makeWorkItem({ state: "cancelled" }))).toBe(false);
  });
});

describe("collaborationRequiresNextMoveOwner", () => {
  test("requires nextMoveOwnerId for non-terminal", () => {
    expect(collaborationRequiresNextMoveOwner(makeWorkItem({ state: "review" }))).toBe(true);
  });

  test("does not require nextMoveOwnerId for terminal", () => {
    expect(collaborationRequiresNextMoveOwner(makeWorkItem({ state: "done" }))).toBe(false);
  });
});

describe("collaborationRequiresWaitingOn", () => {
  test("returns true only when state is waiting", () => {
    expect(collaborationRequiresWaitingOn(makeWorkItem({ state: "waiting" }))).toBe(true);
    expect(collaborationRequiresWaitingOn(makeWorkItem({ state: "open" }))).toBe(false);
  });
});

describe("collaborationRequiresAcceptance", () => {
  test("returns false when acceptanceState is none", () => {
    expect(collaborationRequiresAcceptance(makeWorkItem({ acceptanceState: "none" }))).toBe(false);
  });

  test("returns true when acceptanceState is pending and requestedById is set", () => {
    expect(
      collaborationRequiresAcceptance(
        makeWorkItem({ acceptanceState: "pending", requestedById: "actor-2" }),
      ),
    ).toBe(true);
  });

  test("returns false when acceptanceState is pending but no requestedById", () => {
    expect(
      collaborationRequiresAcceptance(
        makeWorkItem({ acceptanceState: "pending", requestedById: undefined }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateCollaborationRecord
// ---------------------------------------------------------------------------

describe("validateCollaborationRecord — valid record", () => {
  test("passes with a minimal valid work item", () => {
    const errors = validateCollaborationRecord(makeWorkItem());
    expect(errors).toEqual([]);
  });

  test("passes for terminal state without ownerId or nextMoveOwnerId", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({
        state: "done",
        ownerId: undefined,
        nextMoveOwnerId: undefined,
      }),
    );
    expect(errors).toEqual([]);
  });
});

describe("validateCollaborationRecord — blank id", () => {
  test("returns error when id is blank", () => {
    const errors = validateCollaborationRecord(makeWorkItem({ id: "   " }));
    expect(errors).toContain("collaboration record id is required");
  });
});

describe("validateCollaborationRecord — blank title", () => {
  test("returns error when title is blank", () => {
    const errors = validateCollaborationRecord(makeWorkItem({ title: "" }));
    expect(errors).toContain("collaboration title is required");
  });
});

describe("validateCollaborationRecord — blank createdById", () => {
  test("returns error when createdById is blank", () => {
    const errors = validateCollaborationRecord(makeWorkItem({ createdById: " " }));
    expect(errors).toContain("createdById is required");
  });
});

describe("validateCollaborationRecord — parent self-reference", () => {
  test("returns error when parentId === id", () => {
    const errors = validateCollaborationRecord(makeWorkItem({ id: "wi-1", parentId: "wi-1" }));
    expect(errors).toContain("parentId cannot reference the record itself");
  });

  test("passes when parentId is a different id", () => {
    const errors = validateCollaborationRecord(makeWorkItem({ id: "wi-1", parentId: "wi-other" }));
    expect(errors).not.toContain("parentId cannot reference the record itself");
  });
});

describe("validateCollaborationRecord — createdAt > updatedAt", () => {
  test("returns error when createdAt is after updatedAt", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({ createdAt: 1_700_000_002_000, updatedAt: 1_700_000_001_000 }),
    );
    expect(errors).toContain("updatedAt must be greater than or equal to createdAt");
  });

  test("passes when createdAt === updatedAt", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({ createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 }),
    );
    expect(errors).not.toContain("updatedAt must be greater than or equal to createdAt");
  });
});

describe("validateCollaborationRecord — missing ownerId for non-terminal", () => {
  test("returns error when non-terminal work item lacks ownerId", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({ state: "open", ownerId: undefined }),
    );
    expect(errors).toContain("non-terminal work items require ownerId");
  });

  test("passes for done state without ownerId", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({ state: "done", ownerId: undefined, nextMoveOwnerId: undefined }),
    );
    expect(errors).not.toContain("non-terminal work items require ownerId");
  });
});

describe("validateCollaborationRecord — missing nextMoveOwnerId for non-terminal", () => {
  test("returns error when non-terminal record lacks nextMoveOwnerId", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({ state: "working", nextMoveOwnerId: undefined }),
    );
    expect(errors).toContain("non-terminal collaboration records require nextMoveOwnerId");
  });
});

describe("validateCollaborationRecord — waiting without waitingOn", () => {
  test("returns error when waiting work item lacks waitingOn", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({ state: "waiting", waitingOn: undefined }),
    );
    expect(errors).toContain("waiting work items require waitingOn");
  });

  test("passes when waiting work item has waitingOn", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({
        state: "waiting",
        waitingOn: { kind: "actor", label: "reviewer", targetId: "actor-2" },
      }),
    );
    expect(errors).not.toContain("waiting work items require waitingOn");
  });
});

describe("validateCollaborationRecord — waitingOn self-reference", () => {
  test("returns error when waitingOn.targetId === record id", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({
        id: "wi-1",
        state: "waiting",
        waitingOn: { kind: "work_item", label: "itself", targetId: "wi-1" },
      }),
    );
    expect(errors).toContain("waitingOn.targetId cannot reference the work item itself");
  });

  test("passes when waitingOn.targetId is a different id", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({
        id: "wi-1",
        state: "waiting",
        waitingOn: { kind: "work_item", label: "other", targetId: "wi-other" },
      }),
    );
    expect(errors).not.toContain("waitingOn.targetId cannot reference the work item itself");
  });
});

describe("validateCollaborationRecord — acceptance coherence", () => {
  test("returns error when acceptanceState is non-none without requestedById", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({ acceptanceState: "pending", requestedById: undefined }),
    );
    expect(errors).toContain(
      "acceptanceState requires the corresponding requester and reviewer identities",
    );
  });

  test("passes when acceptanceState is pending and requestedById is set", () => {
    const errors = validateCollaborationRecord(
      makeWorkItem({ acceptanceState: "pending", requestedById: "actor-2" }),
    );
    expect(errors).not.toContain(
      "acceptanceState requires the corresponding requester and reviewer identities",
    );
  });
});

describe("assertValidCollaborationRecord", () => {
  test("throws for invalid record", () => {
    expect(() => assertValidCollaborationRecord(makeWorkItem({ id: "" }))).toThrow();
  });

  test("does not throw for valid record", () => {
    expect(() => assertValidCollaborationRecord(makeWorkItem())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateCollaborationEvent
// ---------------------------------------------------------------------------

describe("validateCollaborationEvent — valid event", () => {
  test("passes with a valid created event", () => {
    const errors = validateCollaborationEvent(makeCollabEvent());
    expect(errors).toEqual([]);
  });

  test("passes with matching record provided", () => {
    const record = makeWorkItem();
    const errors = validateCollaborationEvent(makeCollabEvent(), record);
    expect(errors).toEqual([]);
  });
});

describe("validateCollaborationEvent — blank id", () => {
  test("returns error when event id is blank", () => {
    const errors = validateCollaborationEvent(makeCollabEvent({ id: "  " }));
    expect(errors).toContain("collaboration event id is required");
  });
});

describe("validateCollaborationEvent — blank recordId", () => {
  test("returns error when event recordId is blank", () => {
    const errors = validateCollaborationEvent(makeCollabEvent({ recordId: "" }));
    expect(errors).toContain("collaboration event recordId is required");
  });
});

describe("validateCollaborationEvent — blank actorId", () => {
  test("returns error when event actorId is blank", () => {
    const errors = validateCollaborationEvent(makeCollabEvent({ actorId: " " }));
    expect(errors).toContain("collaboration event actorId is required");
  });
});

describe("validateCollaborationEvent — recordId mismatch with record", () => {
  test("returns error when event recordId does not match provided record id", () => {
    const record = makeWorkItem({ id: "wi-99" });
    const errors = validateCollaborationEvent(makeCollabEvent({ recordId: "wi-1" }), record);
    expect(errors).toContain("collaboration event recordId does not match the target record");
  });
});

describe("validateCollaborationEvent — recordKind mismatch with record", () => {
  test("returns error when event recordKind does not match provided record kind", () => {
    const record = makeWorkItem({ id: "wi-1" });
    // Force a wrong recordKind via cast
    const event = makeCollabEvent({ recordId: "wi-1", recordKind: "work_item" });
    (event as any).recordKind = "unknown_kind";
    const errors = validateCollaborationEvent(event, record);
    expect(errors).toContain("collaboration event recordKind does not match the target record");
  });
});

describe("validateCollaborationEvent — work_item-only event kinds", () => {
  const workItemOnlyKinds = [
    "waiting",
    "progressed",
    "review_requested",
    "done",
    "cancelled",
  ] as const;

  for (const kind of workItemOnlyKinds) {
    test(`returns error when '${kind}' event has non-work_item recordKind`, () => {
      const event = makeCollabEvent({ kind });
      (event as any).recordKind = "not_work_item";
      const errors = validateCollaborationEvent(event);
      expect(errors).toContain(`${kind} events only apply to work items`);
    });

    test(`passes when '${kind}' event has work_item recordKind`, () => {
      const errors = validateCollaborationEvent(makeCollabEvent({ kind }));
      expect(errors).not.toContain(`${kind} events only apply to work items`);
    });
  }
});

describe("assertValidCollaborationEvent", () => {
  test("throws for invalid event", () => {
    expect(() => assertValidCollaborationEvent(makeCollabEvent({ id: "" }))).toThrow();
  });

  test("does not throw for valid event", () => {
    expect(() => assertValidCollaborationEvent(makeCollabEvent())).not.toThrow();
  });
});
