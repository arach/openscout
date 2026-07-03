import { describe, expect, test } from "bun:test";

import {
  aggregateGuidedKnowledgeHits,
  buildGuidedKnowledgeQueries,
  guidedKnowledgeLimit,
  summarizeGuidedKnowledgeSessions,
  type GuidedKnowledgeSearch,
  type KnowledgeHit,
} from "./knowledge-search.ts";

function hit(input: {
  chunkId: string;
  collectionId?: string;
  title?: string;
  project?: string;
  harness?: string;
  recordRange?: [number, number];
}): KnowledgeHit {
  const collectionId = input.collectionId ?? `collection-${input.chunkId}`;
  return {
    id: `hit:${input.chunkId}`,
    collectionId,
    documentId: `document-${input.chunkId}`,
    chunkId: input.chunkId,
    title: input.title ?? `Session ${input.chunkId}`,
    snippet: `Snippet ${input.chunkId}`,
    score: 0,
    scoreSource: "fts",
    origin: "mechanical",
    ownership: "derived",
    freshness: "unknown",
    sourceRefs: [{
      kind: "harness_transcript",
      harness: input.harness ?? "codex",
      path: { root: "HOME", relPath: `.codex/${input.chunkId}.jsonl` },
      sessionId: collectionId,
      recordRange: input.recordRange,
    }],
    facets: {
      project: input.project ?? "openscout",
      harness: input.harness ?? "codex",
    },
  };
}

describe("guided knowledge search helpers", () => {
  test("expands a theme and objective into bounded related queries", () => {
    const queries = buildGuidedKnowledgeQueries(
      "navigation agent project hierarchy",
      "Find /projects view, routing, and project hierarchy decisions.",
    );

    expect(queries[0]).toBe("navigation agent project hierarchy");
    expect(queries).toContain("navigation agent");
    expect(queries).toContain("/projects view");
    expect(queries.length).toBeLessThanOrEqual(10);
    expect(guidedKnowledgeLimit(21)).toBe(1000);
  });

  test("aggregates duplicate chunks and summarizes sessions", () => {
    const searches: GuidedKnowledgeSearch[] = [
      { q: "projects view", hits: [hit({ chunkId: "a", collectionId: "s1", recordRange: [0, 49] })] },
      { q: "project hierarchy", hits: [
        hit({ chunkId: "a", collectionId: "s1", recordRange: [0, 49] }),
        hit({ chunkId: "b", collectionId: "s2", project: "scope", harness: "claude", recordRange: [50, 99] }),
      ] },
    ];

    expect(aggregateGuidedKnowledgeHits(searches).map((entry) => entry.chunkId)).toEqual(["a", "b"]);
    expect(summarizeGuidedKnowledgeSessions(searches)).toEqual([
      expect.objectContaining({
        collectionId: "s1",
        hitCount: 2,
        matchedQueries: ["projects view", "project hierarchy"],
      }),
      expect.objectContaining({
        collectionId: "s2",
        project: "scope",
        harness: "claude",
      }),
    ]);
  });
});
