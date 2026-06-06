import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

import {
  deterministicKnowledgeChunkId,
  SQLiteKnowledgeStore,
} from "./store.js";
import { knowledgeCollectionQmdPath, resolveOpenScoutKnowledgePaths } from "./paths.js";
import type {
  KnowledgeChunk,
  KnowledgeCollection,
  KnowledgeDocument,
  KnowledgeFacets,
  KnowledgeIndexJob,
  KnowledgePortablePath,
  KnowledgeSourceRef,
} from "./types.js";

export interface IndexWorktreeKnowledgeInput {
  root?: string;
  force?: boolean;
  includeUntracked?: boolean;
}

export interface IndexedWorktreeFileSummary {
  path: string;
  state: "staged" | "unstaged" | "untracked";
  chunks: number;
  bytes: number;
  skipped?: boolean;
  reason?: string;
}

export interface IndexWorktreeKnowledgeResult {
  job: KnowledgeIndexJob;
  repoRoot: string;
  branch: string;
  files: number;
  chunks: number;
  skipped: number;
  clean: boolean;
  collectionId: string;
  qmdPath: string;
  indexedFiles: IndexedWorktreeFileSummary[];
}

type WorktreeState = IndexedWorktreeFileSummary["state"];

type DiffEntry = {
  path: string;
  state: WorktreeState;
  patch: string;
  bytes: number;
  binary: boolean;
};

type WorktreeDocument = {
  path: string;
  kind: string;
  content: string;
  sourceRef: KnowledgeSourceRef;
};

const EXTRACTOR_VERSION = "git-worktree-v1";
const CHUNK_POLICY_VERSION = "git-worktree-file-hunk-v1";
const GIT_TIMEOUT_MS = 10_000;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES = 20 * 1024;
const MAX_UNTRACKED_FILES = 80;
const MAX_UNTRACKED_FILE_BYTES = 96 * 1024;
const MAX_UNTRACKED_LINES = 1_200;

const SKIP_DIR_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "DerivedData",
]);

const SKIP_EXACT_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const SKIP_EXTENSIONS = new Set([
  ".bmp",
  ".db",
  ".gif",
  ".heic",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".pdf",
  ".png",
  ".sqlite",
  ".webp",
  ".zip",
]);

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  }).trimEnd();
}

function resolveRepoRoot(root: string): string {
  return runGit(resolve(root), ["rev-parse", "--show-toplevel"]).trim();
}

function resolveBranch(repoRoot: string): string {
  const branch = runGit(repoRoot, ["branch", "--show-current"]).trim();
  if (branch) return branch;
  return runGit(repoRoot, ["rev-parse", "--short", "HEAD"]).trim() || "detached";
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableId(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function portablePath(filePath: string, repoRoot: string): KnowledgePortablePath {
  const absolute = resolve(filePath);
  const repoRel = relative(repoRoot, absolute);
  if (repoRel && !repoRel.startsWith("..") && !repoRel.startsWith(sep)) {
    return { root: "PROJECT_ROOT", relPath: repoRel };
  }

  const home = homedir();
  const homeRel = relative(home, absolute);
  if (homeRel && !homeRel.startsWith("..") && !homeRel.startsWith(sep)) {
    return { root: "HOME", relPath: homeRel };
  }

  const paths = resolveOpenScoutKnowledgePaths();
  const controlHome = paths.knowledgeRoot.replace(new RegExp(`${sep}knowledge$`), "");
  const controlRel = relative(controlHome, absolute);
  if (controlRel && !controlRel.startsWith("..") && !controlRel.startsWith(sep)) {
    return { root: "OPENSCOUT_CONTROL_HOME", relPath: controlRel };
  }

  return { root: "ABSOLUTE", relPath: absolute };
}

function isSkippedPath(path: string): boolean {
  const parts = path.split(/[\\/]+/u).filter(Boolean);
  if (parts.some((part) => SKIP_DIR_SEGMENTS.has(part))) return true;
  const name = parts.at(-1) ?? path;
  if (SKIP_EXACT_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return sanitized || "file";
}

function parseDiffPath(patch: string): string | null {
  const header = /^diff --git (.+)$/mu.exec(patch)?.[1];
  if (header) {
    const match = / b\/(.+)$/u.exec(header);
    if (match?.[1]) return unquoteGitPath(match[1]);
  }

  const plus = /^\+\+\+ b\/(.+)$/mu.exec(patch)?.[1];
  if (plus) return unquoteGitPath(plus);

  const minus = /^--- a\/(.+)$/mu.exec(patch)?.[1];
  if (minus) return unquoteGitPath(minus);

  return null;
}

function unquoteGitPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("\"") || !trimmed.endsWith("\"")) return trimmed;
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1);
  }
}

function splitDiff(diff: string, state: WorktreeState): DiffEntry[] {
  if (!diff.trim()) return [];
  const chunks = diff.split(/^diff --git /mu);
  const entries: DiffEntry[] = [];
  for (const [index, raw] of chunks.entries()) {
    if (!raw.trim()) continue;
    const patch = index === 0 && raw.startsWith("diff --git ")
      ? raw
      : `diff --git ${raw}`;
    const path = parseDiffPath(patch);
    if (!path) continue;
    const binary = /\nBinary files .* differ|\nGIT binary patch/u.test(patch);
    entries.push({ path, state, patch, bytes: bytes(patch), binary });
  }
  return entries;
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte >= 32 && byte <= 126) continue;
    if (byte >= 128) continue;
    suspicious++;
  }
  return suspicious < Math.max(2, sample.length * 0.01);
}

function readUntrackedEntries(repoRoot: string, includeUntracked: boolean): DiffEntry[] {
  if (!includeUntracked) return [];
  const raw = runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = raw.split("\0").map((path) => path.trim()).filter(Boolean).slice(0, MAX_UNTRACKED_FILES);
  const entries: DiffEntry[] = [];

  for (const path of paths) {
    if (isSkippedPath(path)) continue;
    const absolute = resolve(repoRoot, path);
    if (!isInsideRoot(repoRoot, absolute)) continue;

    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES) continue;

    const buffer = readFileSync(absolute);
    if (!isProbablyText(buffer)) continue;

    const content = buffer.toString("utf8")
      .split(/\r?\n/u)
      .slice(0, MAX_UNTRACKED_LINES)
      .map((line) => `+${line}`)
      .join("\n");
    const lineCount = content ? content.split("\n").length : 0;
    const patch = [
      `diff --git a/${path} b/${path}`,
      "new file mode 100644",
      "index 0000000..0000000",
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${lineCount} @@`,
      content,
    ].join("\n");
    entries.push({ path, state: "untracked", patch, bytes: bytes(patch), binary: false });
  }

  return entries;
}

function discoverDiffEntries(repoRoot: string, includeUntracked: boolean): DiffEntry[] {
  const unstaged = splitDiff(runGit(repoRoot, [
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--",
  ]), "unstaged");
  const staged = splitDiff(runGit(repoRoot, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--",
  ]), "staged");
  const untracked = readUntrackedEntries(repoRoot, includeUntracked);
  return [...staged, ...unstaged, ...untracked];
}

function sourceRefFor(entry: DiffEntry, repoRoot: string): KnowledgeSourceRef {
  return {
    kind: "file",
    path: portablePath(resolve(repoRoot, entry.path), repoRoot),
    anchor: {
      sizeBytes: entry.bytes,
      contentHash: hashText(entry.patch),
    },
  };
}

function splitPatchChunks(patch: string): string[] {
  if (bytes(patch) <= MAX_CHUNK_BYTES) return [patch];

  const lines = patch.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunk < 0) {
    return [lines.slice(0, 400).join("\n")];
  }

  const header = lines.slice(0, firstHunk);
  const hunks: string[][] = [];
  let current: string[] = [];
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith("@@ ") && current.length > 0) {
      hunks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) hunks.push(current);

  const chunks: string[] = [];
  let pending = [...header];
  for (const hunk of hunks) {
    const candidate = [...pending, ...hunk];
    if (pending.length > header.length && bytes(candidate.join("\n")) > MAX_CHUNK_BYTES) {
      chunks.push(pending.join("\n"));
      pending = [...header, ...hunk];
    } else {
      pending = candidate;
    }
  }
  if (pending.length > header.length) chunks.push(pending.join("\n"));
  return chunks.length > 0 ? chunks : [patch.slice(0, MAX_CHUNK_BYTES)];
}

function titleFor(repoRoot: string, branch: string): string {
  return `Worktree diff ${basename(repoRoot)} ${branch}`;
}

function collectionIdFor(repoRoot: string): string {
  return `git_worktree/${stableId(repoRoot, 20)}`;
}

function collectionContentHash(entries: DiffEntry[], repoRoot: string, branch: string): string {
  return hashText([
    EXTRACTOR_VERSION,
    CHUNK_POLICY_VERSION,
    repoRoot,
    branch,
    ...entries.map((entry) => `${entry.state}\0${entry.path}\0${hashText(entry.patch)}`),
  ].join("\n"));
}

function overviewDocument(input: {
  repoRoot: string;
  branch: string;
  entries: DiffEntry[];
  skipped: IndexedWorktreeFileSummary[];
  title: string;
}): WorktreeDocument {
  const lines = [
    `# ${input.title}`,
    "",
    `Repository: ${input.repoRoot}`,
    `Branch: ${input.branch}`,
    `Indexed files: ${input.entries.length}`,
    `Skipped files: ${input.skipped.length}`,
    "",
    "## Files",
    "",
    "| state | path | bytes |",
    "| --- | --- | ---: |",
  ];

  for (const entry of input.entries) {
    lines.push(`| ${entry.state} | \`${entry.path}\` | ${entry.bytes} |`);
  }
  if (input.entries.length === 0) {
    lines.push("| clean | _no staged, unstaged, or untracked text changes_ | 0 |");
  }
  if (input.skipped.length > 0) {
    lines.push("", "## Skipped", "");
    for (const skipped of input.skipped.slice(0, 120)) {
      lines.push(`- ${skipped.state} \`${skipped.path}\` - ${skipped.reason ?? "skipped"}`);
    }
  }

  return {
    path: "overview.md",
    kind: "overview",
    content: `${lines.join("\n")}\n`,
    sourceRef: {
      kind: "file",
      path: portablePath(input.repoRoot, input.repoRoot),
    },
  };
}

function documentsForEntries(
  entries: DiffEntry[],
  repoRoot: string,
): WorktreeDocument[] {
  const documents: WorktreeDocument[] = [];
  for (const entry of entries) {
    const chunks = splitPatchChunks(entry.patch);
    chunks.forEach((chunk, index) => {
      const ext = chunks.length > 1 ? `-${String(index + 1).padStart(3, "0")}` : "";
      documents.push({
        path: `${entry.state}/${sanitizeSegment(entry.path)}${ext}.diff.md`,
        kind: "diff",
        content: [
          `# ${entry.state} ${entry.path}`,
          "",
          "```diff",
          chunk,
          "```",
          "",
        ].join("\n"),
        sourceRef: sourceRefFor(entry, repoRoot),
      });
    });
  }
  return documents;
}

function documentId(collectionId: string, path: string): string {
  return hashText(`${collectionId}\0${path}`);
}

function writeQmdCollection(collection: KnowledgeCollection, documents: WorktreeDocument[], entries: DiffEntry[]): void {
  const outDir = collection.qmdPath;
  const tmpDir = `${outDir}.tmp-${process.pid}`;
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const manifest = {
    schema: "openscout.knowledge.collection/v1",
    collectionId: collection.id,
    kind: collection.kind,
    title: collection.title,
    generator: {
      extractorVersion: collection.extractorVersion,
      generatedAt: new Date(collection.updatedAt).toISOString(),
    },
    source: {
      kind: "git_worktree",
      files: entries.length,
      contentHash: collection.contentHash,
    },
    chunking: {
      strategy: "file-hunk",
      maxChunkBytes: MAX_CHUNK_BYTES,
      version: CHUNK_POLICY_VERSION,
    },
    documents: documents.map((document) => ({
      path: document.path,
      kind: document.kind,
      origin: "mechanical",
      bytes: bytes(document.content),
      contentHash: hashText(document.content),
    })),
    facets: collection.facets,
    ownership: "derived",
    contentHash: collection.contentHash,
    status: collection.status,
  };

  writeFileSync(join(tmpDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const document of documents) {
    const target = join(tmpDir, document.path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, document.content, "utf8");
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, ".."), { recursive: true });
  renameSync(tmpDir, outDir);
}

function filterEntries(entries: DiffEntry[]): {
  entries: DiffEntry[];
  skipped: IndexedWorktreeFileSummary[];
} {
  const included: DiffEntry[] = [];
  const skipped: IndexedWorktreeFileSummary[] = [];
  for (const entry of entries) {
    if (isSkippedPath(entry.path)) {
      skipped.push({ path: entry.path, state: entry.state, chunks: 0, bytes: entry.bytes, skipped: true, reason: "generated, binary, or lockfile path" });
    } else if (entry.binary) {
      skipped.push({ path: entry.path, state: entry.state, chunks: 0, bytes: entry.bytes, skipped: true, reason: "binary diff" });
    } else {
      included.push(entry);
    }
  }
  return { entries: included, skipped };
}

export async function indexWorktreeKnowledge(
  input: IndexWorktreeKnowledgeInput = {},
): Promise<IndexWorktreeKnowledgeResult> {
  const startRoot = input.root ?? process.cwd();
  const repoRoot = resolveRepoRoot(startRoot);
  const branch = resolveBranch(repoRoot);
  const collectionId = collectionIdFor(repoRoot);
  const qmdPath = knowledgeCollectionQmdPath(collectionId);
  const store = new SQLiteKnowledgeStore();
  const job = store.createIndexJob({ source: "git_worktree", force: input.force, mode: "foreground" });
  const leaseGeneration = job.leaseGeneration + 1;
  let indexedFiles: IndexedWorktreeFileSummary[] = [];
  let skipped: IndexedWorktreeFileSummary[] = [];
  let chunks = 0;

  try {
    store.updateIndexJob({
      id: job.id,
      state: "running",
      leaseOwner: "git-worktree-indexer",
      leaseGeneration,
      progress: { discovered: 0, extracted: 0, indexed: 0, failed: 0 },
    });

    const discovered = discoverDiffEntries(repoRoot, input.includeUntracked !== false);
    const filtered = filterEntries(discovered);
    const entries = filtered.entries;
    skipped = filtered.skipped;
    const title = titleFor(repoRoot, branch);
    const now = Date.now();
    const facets: KnowledgeFacets = {
      source: "git_worktree",
      repo: basename(repoRoot),
      repoRoot,
      branch,
    };
    const collection: KnowledgeCollection = {
      id: collectionId,
      kind: "git_worktree",
      title,
      sourceRefs: [{
        kind: "file",
        path: portablePath(repoRoot, repoRoot),
      }],
      qmdPath,
      status: "ready",
      contentHash: collectionContentHash(entries, repoRoot, branch),
      extractorVersion: EXTRACTOR_VERSION,
      chunkPolicyVersion: CHUNK_POLICY_VERSION,
      createdAt: now,
      updatedAt: now,
      facets,
    };

    const existing = store.getCollection(collectionId);
    if (!input.force && existing?.contentHash === collection.contentHash) {
      const completed = store.updateIndexJob({
        id: job.id,
        state: "completed",
        completedAt: Date.now(),
        progress: { discovered: discovered.length, extracted: entries.length, indexed: 0, failed: skipped.length },
      }) ?? job;
      return {
        job: completed,
        repoRoot,
        branch,
        files: entries.length,
        chunks: 0,
        skipped: skipped.length,
        clean: entries.length === 0,
        collectionId,
        qmdPath,
        indexedFiles: entries.map((entry) => ({ path: entry.path, state: entry.state, chunks: 0, bytes: entry.bytes, skipped: true, reason: "unchanged index" })),
      };
    }

    const documents = [
      overviewDocument({ repoRoot, branch, entries, skipped, title }),
      ...documentsForEntries(entries, repoRoot),
    ];
    writeQmdCollection(collection, documents, entries);

    store.deleteCollection(collectionId);
    store.upsertCollection(collection);

    for (const document of documents) {
      const doc: KnowledgeDocument = {
        id: documentId(collectionId, document.path),
        collectionId,
        path: document.path,
        kind: document.kind,
        origin: "mechanical",
        contentHash: hashText(document.content),
      };
      store.upsertDocument(doc);
      const chunkTexts = splitPatchChunks(document.content);
      chunkTexts.forEach((text, ordinal) => {
        const sourceState = document.path.split("/", 1)[0] as WorktreeState;
        const chunkFacets: KnowledgeFacets = {
          ...facets,
          ...(sourceState === "staged" || sourceState === "unstaged" || sourceState === "untracked"
            ? { state: sourceState }
            : {}),
        };
        const chunk: KnowledgeChunk = {
          id: deterministicKnowledgeChunkId({
            collectionId,
            documentPath: document.path,
            ordinal,
            chunkPolicyVersion: CHUNK_POLICY_VERSION,
            text,
          }),
          collectionId,
          documentId: doc.id,
          documentPath: document.path,
          ordinal,
          text,
          textHash: hashText(text),
          origin: "mechanical",
          ownership: "derived",
          sourceRefs: [document.sourceRef],
          facets: chunkFacets,
        };
        store.upsertChunk(chunk, `${title} / ${document.path}`);
        chunks++;
      });
    }

    indexedFiles = entries.map((entry) => ({
      path: entry.path,
      state: entry.state,
      chunks: splitPatchChunks(entry.patch).length,
      bytes: entry.bytes,
    }));

    const completed = store.updateIndexJob({
      id: job.id,
      state: "completed",
      completedAt: Date.now(),
      progress: { discovered: discovered.length, extracted: entries.length, indexed: entries.length, failed: skipped.length },
    }) ?? job;

    return {
      job: completed,
      repoRoot,
      branch,
      files: entries.length,
      chunks,
      skipped: skipped.length,
      clean: entries.length === 0,
      collectionId,
      qmdPath,
      indexedFiles: [...indexedFiles, ...skipped],
    };
  } catch (error) {
    const failedJob = store.updateIndexJob({
      id: job.id,
      state: "failed",
      completedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
      progress: { indexed: indexedFiles.length, failed: skipped.length + 1 },
    }) ?? job;
    return {
      job: failedJob,
      repoRoot,
      branch,
      files: indexedFiles.length,
      chunks,
      skipped: skipped.length,
      clean: false,
      collectionId,
      qmdPath,
      indexedFiles: [...indexedFiles, ...skipped],
    };
  } finally {
    store.close();
  }
}
