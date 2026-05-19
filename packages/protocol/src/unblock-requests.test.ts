import { describe, expect, test } from "bun:test";

import {
  assertValidUnblockRequestRecord,
  isActiveUnblockRequest,
  isUnblockRequestTerminalState,
  validateUnblockRequestEvent,
  validateUnblockRequestRecord,
  type UnblockRequestRecord,
} from "./unblock-requests.js";

function sampleRequest(
  overrides: Partial<UnblockRequestRecord> = {},
): UnblockRequestRecord {
  return {
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
    ...overrides,
  };
}

describe("unblock requests", () => {
  test("validates active records require ownership, source refs, actions, and timestamps", () => {
    expect(validateUnblockRequestRecord(sampleRequest())).toEqual([]);

    expect(validateUnblockRequestRecord(sampleRequest({
      ownerId: "",
      sourceRef: "",
      actions: [],
      createdAt: 200,
      updatedAt: 100,
    }))).toEqual([
      "unblock request sourceRef is required",
      "unblock request ownerId is required",
      "unblock request updatedAt must be greater than or equal to createdAt",
      "active unblock requests require at least one action",
    ]);
  });

  test("requires terminal records to keep resolved history", () => {
    expect(validateUnblockRequestRecord(sampleRequest({
      state: "resolved",
      actions: undefined,
    }))).toContain("terminal unblock requests require resolvedAt");

    expect(() => assertValidUnblockRequestRecord(sampleRequest({
      state: "resolved",
      actions: undefined,
      resolvedAt: 120,
    }))).not.toThrow();
  });

  test("classifies active and terminal states", () => {
    expect(isActiveUnblockRequest(sampleRequest({ state: "open" }))).toBe(true);
    expect(isActiveUnblockRequest(sampleRequest({ state: "snoozed" }))).toBe(true);
    for (const state of ["resolved", "denied", "expired", "dismissed"] as const) {
      expect(isUnblockRequestTerminalState(state)).toBe(true);
      expect(isActiveUnblockRequest(sampleRequest({
        state,
        actions: undefined,
        resolvedAt: 150,
      }))).toBe(false);
    }
  });

  test("validates events match their target request", () => {
    expect(validateUnblockRequestEvent({
      id: "evt-1",
      requestId: "other",
      kind: "resolved",
      actorId: "operator",
      at: 200,
    }, sampleRequest())).toEqual([
      "unblock request event requestId does not match the target request",
    ]);
  });
});
