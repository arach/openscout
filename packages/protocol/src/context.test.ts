import { describe, expect, test } from "bun:test";

import {
  assertValidContextBlock,
  assertValidContextPack,
  contextScopeKey,
  type ContextBlock,
  type ContextPack,
} from "./context.js";

const now = 1_700_000_000_000;

function memoryBlock(overrides: Partial<ContextBlock> = {}): ContextBlock {
  return {
    schemaVersion: "openscout.context-block.v1",
    id: "ctx-1",
    kind: "memory",
    memoryKind: "decision",
    title: "Broker owns context",
    body: "Context writes go through the broker.",
    scope: { kind: "workspace", id: "/repo" },
    projectionMode: "summary",
    mutability: "broker_writable",
    state: "proposed",
    createdById: "operator",
    sourceRefs: [{ kind: "session_observation", ref: "session:claude:abc" }],
    confidence: 0.9,
    version: 1,
    contentHash: "sha256:abc",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("context block contract", () => {
  test("accepts provenance-aware proposed memory", () => {
    expect(() => assertValidContextBlock(memoryBlock())).not.toThrow();
    expect(contextScopeKey({ kind: "workspace", id: "/repo" })).toBe("workspace:/repo");
    expect(contextScopeKey({ kind: "global" })).toBe("global");
  });

  test("rejects memory without provenance or memory kind", () => {
    expect(() => assertValidContextBlock(memoryBlock({ sourceRefs: [] })))
      .toThrow("provenance");
    expect(() => assertValidContextBlock(memoryBlock({ memoryKind: undefined })))
      .toThrow("memoryKind");
  });

  test("rejects confidence outside the normalized range", () => {
    expect(() => assertValidContextBlock(memoryBlock({ confidence: 1.2 })))
      .toThrow("between 0 and 1");
  });
});

describe("context pack contract", () => {
  test("requires the budget estimate to match its sections", () => {
    const pack: ContextPack = {
      schemaVersion: "openscout.context-pack.v1",
      id: "pack-1",
      title: "Routing handoff",
      purpose: "Continue the routing work",
      target: { projectPath: "/repo", harness: "codex", sessionPolicy: "fork" },
      sections: [{
        id: "task",
        kind: "task_frame",
        title: "Task",
        body: "Finish the routing work.",
        estimatedTokens: 8,
      }],
      contextBlockIds: [],
      sourceRefs: [{ kind: "operator", ref: "operator" }],
      budget: { maxTokens: 100, estimatedTokens: 8, truncated: false },
      limitations: [],
      contentHash: "sha256:def",
      createdById: "operator",
      createdAt: now,
    };

    expect(() => assertValidContextPack(pack)).not.toThrow();
    expect(() => assertValidContextPack({
      ...pack,
      budget: { ...pack.budget, estimatedTokens: 9 },
    })).toThrow("sum of section estimates");
  });
});
