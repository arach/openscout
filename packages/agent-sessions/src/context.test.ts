import { describe, expect, test } from "bun:test";

import type { ContextBlock } from "@openscout/protocol";

import {
  assembleContextPack,
  createSessionEvidence,
  distillMemoryCandidates,
  materializeMemoryCandidate,
  renderContextPackPrompt,
} from "./context.js";
import type { SessionState } from "./state.js";

const now = 1_700_000_000_000;

function snapshot(): SessionState {
  return {
    session: {
      id: "native-1",
      name: "Claude routing pass",
      adapterType: "claude-code",
      status: "idle",
      cwd: "/repo",
    },
    turns: [{
      id: "turn-1",
      status: "completed",
      startedAt: now - 10,
      endedAt: now,
      blocks: [
        {
          status: "completed",
          block: {
            id: "text-1",
            turnId: "turn-1",
            type: "text",
            status: "completed",
            index: 0,
            text: [
              "Decision: keep observed transcripts outside Scout messages",
              "Constraint: context must fit a bounded prompt",
              "Next move: wire the fork payload",
            ].join("\n"),
          },
        },
        {
          status: "completed",
          block: {
            id: "file-1",
            turnId: "turn-1",
            type: "action",
            status: "completed",
            index: 1,
            action: {
              kind: "file_change",
              status: "completed",
              output: "",
              path: "packages/protocol/src/context.ts",
              diff: "+export type ContextPack = ...",
            },
          },
        },
      ],
    }],
  };
}

function activeMemory(overrides: Partial<ContextBlock> = {}): ContextBlock {
  return {
    schemaVersion: "openscout.context-block.v1",
    id: "mem-1",
    kind: "memory",
    memoryKind: "decision",
    title: "Ownership boundary",
    body: "Observed transcripts remain harness-owned evidence.",
    scope: { kind: "workspace", id: "/repo" },
    projectionMode: "summary",
    mutability: "broker_writable",
    state: "active",
    createdById: "operator",
    sourceRefs: [{ kind: "session_observation", ref: "session:claude-code:native-1" }],
    confidence: 0.95,
    version: 1,
    contentHash: "fnv1a64:1234",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("constructive memory distillation", () => {
  test("proposes decisions, constraints, open loops, artifacts, and working state", () => {
    const evidence = createSessionEvidence(snapshot(), { capturedAt: now });
    const candidates = distillMemoryCandidates(evidence);

    expect(candidates.map((candidate) => candidate.memoryKind)).toEqual([
      "decision",
      "constraint",
      "open_loop",
      "artifact",
      "working_state",
    ]);
    expect(candidates.every((candidate) => candidate.sourceRefs[0]?.kind === "session_observation"))
      .toBe(true);
    expect(candidates.find((candidate) => candidate.memoryKind === "artifact")?.body)
      .toContain("packages/protocol/src/context.ts");

    expect(materializeMemoryCandidate(candidates[0]!, {
      createdById: "operator",
      now,
    })).toEqual(expect.objectContaining({
      kind: "memory",
      state: "proposed",
      createdById: "operator",
      version: 1,
    }));
  });
});

describe("context assembly", () => {
  test("combines active memory with bounded observed evidence", () => {
    const evidence = createSessionEvidence(snapshot(), { capturedAt: now });
    const pack = assembleContextPack({
      purpose: "Continue context implementation",
      task: "Implement the next broker slice.",
      target: { projectPath: "/repo", harness: "codex", sessionPolicy: "fork" },
      memories: [
        activeMemory(),
        activeMemory({ id: "expired", freshness: { expiresAt: now - 1 } }),
        activeMemory({ id: "other-repo", scope: { kind: "workspace", id: "/other" } }),
        activeMemory({ id: "other-work", scope: { kind: "work_item", id: "work-2" } }),
      ],
      evidence,
      createdById: "operator",
      maxTokens: 500,
      now,
    });

    expect(pack.contextBlockIds).toEqual(["mem-1"]);
    expect(pack.sections.map((section) => section.kind)).toEqual([
      "task_frame",
      "memory",
      "recent_evidence",
    ]);
    expect(pack.budget.estimatedTokens).toBeLessThanOrEqual(500);
    expect(renderContextPackPrompt(pack)).toContain("bounded constructive context");
  });

  test("marks the pack truncated when applicable memory does not fit", () => {
    const pack = assembleContextPack({
      purpose: "Small pack",
      task: "Do the next step.",
      target: { projectPath: "/repo", sessionPolicy: "fork" },
      memories: [activeMemory({ body: "x".repeat(2_000) })],
      createdById: "operator",
      maxTokens: 30,
      now,
    });

    expect(pack.budget.truncated).toBe(true);
    expect(pack.contextBlockIds).toEqual([]);
    expect(pack.limitations).toContain("Context was truncated to fit the configured token budget.");
  });
});
