import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deterministicKnowledgeChunkId,
  indexWorktreeKnowledge,
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

describe("indexWorktreeKnowledge", () => {
  test("indexes staged, unstaged, and untracked git diffs into searchable chunks", async () => {
    const paths = useTempSupportPaths();
    const repo = tempRoot("openscout-knowledge-git-");
    execFileSync("git", ["init"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });

    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "usage.ts"), "export const oldValue = 'old';\n", "utf8");
    execFileSync("git", ["add", "src/usage.ts"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repo });

    writeFileSync(join(repo, "src", "usage.ts"), "export const note = 'contextline usage home page bridge';\n", "utf8");
    writeFileSync(join(repo, "src", "budget.ts"), "export const table = 'budget_usage_events';\n", "utf8");
    execFileSync("git", ["add", "src/budget.ts"], { cwd: repo });
    writeFileSync(join(repo, "src", "notes.ts"), "export const cache = 'cache_read_input_tokens';\n", "utf8");

    const result = await indexWorktreeKnowledge({ root: repo, force: true });
    expect(result.files).toBe(3);
    expect(result.clean).toBe(false);
    expect(result.indexedFiles.map((file) => `${file.state}:${file.path}`).sort()).toEqual([
      "staged:src/budget.ts",
      "unstaged:src/usage.ts",
      "untracked:src/notes.ts",
    ]);

    const store = new SQLiteKnowledgeStore(undefined, paths);
    try {
      const contextHits = store.searchLexical({
        q: "contextline usage home",
        sourceKinds: ["git_worktree"],
        limit: 10,
      });
      expect(contextHits.length).toBeGreaterThan(0);
      expect(contextHits[0]?.facets.source).toBe("git_worktree");
      expect(contextHits[0]?.sourceRefs.some((ref) => ref.kind === "file")).toBe(true);

      const budgetHits = store.searchLexical({
        q: "budget_usage_events",
        sourceKinds: ["git_worktree"],
        limit: 10,
      });
      expect(budgetHits.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});
