import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deterministicKnowledgeChunkId,
  knowledgeCollectionQmdPath,
  resolveOpenScoutKnowledgePaths,
  SQLiteKnowledgeStore,
  type KnowledgeCollection,
  type KnowledgeDocument,
  type KnowledgeSourceRef,
} from "./knowledge/index.ts";

const roots = new Set<string>();
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
  if (originalControlHome === undefined) delete process.env.OPENSCOUT_CONTROL_HOME;
  else process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  if (originalSupportDirectory === undefined) delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  else process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.add(root);
  return root;
}

function useTempSupportPaths(): ReturnType<typeof resolveOpenScoutKnowledgePaths> {
  const root = tempRoot("openscout-knowledge-");
  process.env.OPENSCOUT_CONTROL_HOME = join(root, "control-plane");
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(root, "support");
  return resolveOpenScoutKnowledgePaths();
}

function sourceRef(): KnowledgeSourceRef {
  return {
    kind: "harness_transcript",
    harness: "codex",
    path: {
      root: "HOME",
      relPath: ".codex/sessions/2026/06/session.jsonl",
    },
    sessionId: "session-1",
    recordRange: [1, 12],
    anchor: {
      sizeBytes: 1234,
      mtimeMs: 1780000000000,
      contentHash: "sha256:source",
    },
  };
}

function collection(paths: ReturnType<typeof resolveOpenScoutKnowledgePaths>): KnowledgeCollection {
  return {
    id: "sessions/codex/session-1",
    kind: "sessions",
    title: "Codex session 1",
    sourceRefs: [sourceRef()],
    qmdPath: join(paths.qmdRoot, "sessions", "codex", "session-1"),
    status: "ready",
    contentHash: "sha256:collection",
    extractorVersion: "test-extractor-v1",
    chunkPolicyVersion: "test-policy-v1",
    createdAt: 1780000000000,
    updatedAt: 1780000000001,
    facets: {
      harness: "codex",
      project: "openscout",
    },
  };
}

function document(collectionId: string): KnowledgeDocument {
  return {
    id: "doc-session-1-overview",
    collectionId,
    path: "overview.md",
    kind: "overview",
    origin: "mechanical",
    contentHash: "sha256:document",
  };
}

describe("knowledge paths", () => {
  test("resolve under OPENSCOUT_CONTROL_HOME and reject escaping collection ids", () => {
    const paths = useTempSupportPaths();
    expect(paths.knowledgeRoot).toEndWith("control-plane/knowledge");
    expect(paths.qmdRoot).toEndWith("control-plane/knowledge/qmd");
    expect(paths.sqlitePath).toEndWith("control-plane/knowledge/knowledge.sqlite");

    const collectionPath = knowledgeCollectionQmdPath("sessions/codex/session-1");
    expect(collectionPath).toBe(join(paths.qmdRoot, "sessions", "codex", "session-1"));
    expect(() => knowledgeCollectionQmdPath("sessions/../escape")).toThrow("invalid collectionId segment");
  });
});

describe("SQLiteKnowledgeStore", () => {
  test("stores collections, stable chunks, lexical search hits, and job status", () => {
    const paths = useTempSupportPaths();
    const store = new SQLiteKnowledgeStore(undefined, paths);
    try {
      const storedCollection = collection(paths);
      const storedDocument = document(storedCollection.id);
      store.upsertCollection(storedCollection);
      store.upsertDocument(storedDocument);

      const text = "This session discussed QMD knowledge indexing, broker APIs, and raw transcript drilldown.";
      const chunkId = deterministicKnowledgeChunkId({
        collectionId: storedCollection.id,
        documentPath: storedDocument.path,
        ordinal: 1,
        chunkPolicyVersion: storedCollection.chunkPolicyVersion,
        text,
      });
      const chunkIdAgain = deterministicKnowledgeChunkId({
        collectionId: storedCollection.id,
        documentPath: storedDocument.path,
        ordinal: 1,
        chunkPolicyVersion: storedCollection.chunkPolicyVersion,
        text,
      });
      expect(chunkIdAgain).toBe(chunkId);

      store.upsertChunk({
        id: chunkId,
        collectionId: storedCollection.id,
        documentId: storedDocument.id,
        documentPath: storedDocument.path,
        ordinal: 1,
        text,
        textHash: "sha256:text",
        origin: "mechanical",
        ownership: "derived",
        sourceRefs: [sourceRef()],
        facets: {
          harness: "codex",
          project: "openscout",
        },
      });

      const hits = store.searchLexical({ q: "QMD", limit: 5 });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.chunkId).toBe(chunkId);
      expect(hits[0]?.origin).toBe("mechanical");
      expect(hits[0]?.ownership).toBe("derived");
      expect(hits[0]?.drilldown.map((entry) => entry.kind)).toContain("qmd");
      expect(hits[0]?.drilldown.map((entry) => entry.kind)).toContain("harness_transcript");

      const job = store.createIndexJob({ source: "sessions", days: 7 });
      const running = store.updateIndexJob({
        id: job.id,
        state: "running",
        leaseOwner: "test-worker",
        leaseGeneration: 1,
        progress: { discovered: 1, extracted: 1 },
      });
      expect(running?.state).toBe("running");
      expect(running?.leaseGeneration).toBe(1);

      const status = store.status();
      expect(status.collections).toBe(1);
      expect(status.readyCollections).toBe(1);
      expect(status.chunks).toBe(1);
      expect(status.activeJobs.map((activeJob) => activeJob.id)).toContain(job.id);
      expect(status.paths.sqlitePath).toBe(paths.sqlitePath);
    } finally {
      store.close();
    }
  });
});
