import { mkdirSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

import { resolveOpenScoutKnowledgePaths, type OpenScoutKnowledgePaths } from "./paths.js";
import type {
  KnowledgeChunk,
  KnowledgeCollection,
  KnowledgeDocument,
  KnowledgeDrilldown,
  KnowledgeFacets,
  KnowledgeFacetValue,
  KnowledgeIndexJob,
  KnowledgeIndexJobState,
  KnowledgeIndexRequest,
  KnowledgeSearchHit,
  KnowledgeSearchQuery,
  KnowledgeSourceRef,
  KnowledgeStatus,
} from "./types.js";

type SQLiteBinding = string | number | bigint | boolean | null | Uint8Array;

type SQLiteTransactionalDatabase = Database & {
  transaction<TArgs extends unknown[], TResult>(
    callback: (...args: TArgs) => TResult
  ): (...args: TArgs) => TResult;
};

type CollectionRow = {
  id: string;
  kind: KnowledgeCollection["kind"];
  title: string;
  source_refs_json: string;
  qmd_path: string;
  status: KnowledgeCollection["status"];
  content_hash: string;
  extractor_version: string;
  chunk_policy_version: string;
  created_at: number;
  updated_at: number;
  facets_json: string;
};

type ChunkRow = {
  id: string;
  collection_id: string;
  document_id: string;
  document_path: string;
  ordinal: number;
  text: string;
  text_hash: string;
  origin: KnowledgeChunk["origin"];
  ownership: KnowledgeChunk["ownership"];
  source_refs_json: string;
  facets_json: string;
  title?: string;
  rank?: number;
};

type JobRow = {
  id: string;
  source: KnowledgeIndexJob["source"];
  state: KnowledgeIndexJobState;
  lease_owner: string | null;
  lease_generation: number;
  progress_json: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  error: string | null;
};

const KNOWLEDGE_SQLITE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  qmd_path TEXT NOT NULL,
  status TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  chunk_policy_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  facets_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata_json TEXT,
  UNIQUE(collection_id, path)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_path TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  origin TEXT NOT NULL,
  ownership TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  facets_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(collection_id, document_path, ordinal)
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  collection_id UNINDEXED,
  document_id UNINDEXED,
  title,
  body,
  tokenize = "unicode61 tokenchars '-_./'"
);

CREATE TABLE IF NOT EXISTS facets (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facets_key_value ON facets(key, value);
CREATE INDEX IF NOT EXISTS idx_facets_collection_key ON facets(collection_id, key);

CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_refs_kind ON source_refs(kind);
CREATE INDEX IF NOT EXISTS idx_source_refs_collection ON source_refs(collection_id);

CREATE TABLE IF NOT EXISTS index_jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  state TEXT NOT NULL,
  lease_owner TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0,
  progress_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_index_jobs_state_updated ON index_jobs(state, updated_at DESC);
`;

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nowMs(): number {
  return Date.now();
}

function normalizedLimit(value: number | undefined, fallback = 20, max = 100): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(value));
}

function normalizeFtsQuery(value: string): string {
  const terms = value
    .split(/[^A-Za-z0-9_./-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 12);
  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" ");
}

function textHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function deterministicKnowledgeChunkId(input: {
  collectionId: string;
  documentPath: string;
  ordinal: number;
  chunkPolicyVersion: string;
  text: string;
}): string {
  return textHash([
    input.collectionId,
    input.documentPath,
    String(input.ordinal),
    input.chunkPolicyVersion,
    textHash(input.text),
  ].join("\0"));
}

function collectionFromRow(row: CollectionRow): KnowledgeCollection {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    sourceRefs: parseJson<KnowledgeSourceRef[]>(row.source_refs_json, []),
    qmdPath: row.qmd_path,
    status: row.status,
    contentHash: row.content_hash,
    extractorVersion: row.extractor_version,
    chunkPolicyVersion: row.chunk_policy_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    facets: parseJson<KnowledgeFacets>(row.facets_json, {}),
  };
}

function chunkFromRow(row: ChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    collectionId: row.collection_id,
    documentId: row.document_id,
    documentPath: row.document_path,
    ordinal: row.ordinal,
    text: row.text,
    textHash: row.text_hash,
    origin: row.origin,
    ownership: row.ownership,
    sourceRefs: parseJson<KnowledgeSourceRef[]>(row.source_refs_json, []),
    facets: parseJson<KnowledgeFacets>(row.facets_json, {}),
  };
}

function jobFromRow(row: JobRow): KnowledgeIndexJob {
  return {
    id: row.id,
    source: row.source,
    state: row.state,
    leaseOwner: row.lease_owner ?? undefined,
    leaseGeneration: row.lease_generation,
    progress: parseJson<KnowledgeIndexJob["progress"]>(row.progress_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  };
}

function drilldownsForChunk(chunk: KnowledgeChunk): KnowledgeDrilldown[] {
  const drilldowns: KnowledgeDrilldown[] = [
    {
      kind: "qmd",
      collectionId: chunk.collectionId,
      documentPath: chunk.documentPath,
      chunkId: chunk.id,
    },
  ];
  for (const sourceRef of chunk.sourceRefs) {
    if (sourceRef.kind === "harness_transcript") {
      drilldowns.push({ kind: "harness_transcript", sourceRef });
    } else if (sourceRef.kind === "file" || sourceRef.kind === "skill" || sourceRef.kind === "context_pack") {
      drilldowns.push({ kind: "file", sourceRef });
    } else if (sourceRef.kind === "scout_record") {
      drilldowns.push({ kind: "scout_record", sourceRef });
    } else if (sourceRef.kind === "mcp_tool") {
      drilldowns.push({ kind: "mcp_tool", sourceRef });
    }
  }
  return drilldowns;
}

function snippet(text: string, query: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 220) return compact;
  const needle = query.toLowerCase().split(/\s+/).find((part) => part.length > 2);
  const index = needle ? compact.toLowerCase().indexOf(needle) : -1;
  const start = Math.max(0, index >= 0 ? index - 70 : 0);
  const end = Math.min(compact.length, start + 220);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
}

function searchHitFromRow(row: ChunkRow, query: string): KnowledgeSearchHit {
  const chunk = chunkFromRow(row);
  return {
    id: `hit:${chunk.id}`,
    collectionId: chunk.collectionId,
    documentId: chunk.documentId,
    chunkId: chunk.id,
    title: row.title ?? chunk.documentPath,
    snippet: snippet(chunk.text, query),
    score: typeof row.rank === "number" ? row.rank : 0,
    scoreSource: "fts",
    origin: chunk.origin,
    ownership: chunk.ownership,
    freshness: "unknown",
    sourceRefs: chunk.sourceRefs,
    drilldown: drilldownsForChunk(chunk),
    facets: chunk.facets,
  };
}

function insertFacetRows(db: Database, collectionId: string, chunkId: string | null, facets: KnowledgeFacets): void {
  const statement = db.query(
    `INSERT INTO facets (collection_id, chunk_id, key, value) VALUES (?1, ?2, ?3, ?4)`,
  );
  for (const [key, rawValue] of Object.entries(facets)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      statement.run(collectionId, chunkId, key, value);
    }
  }
}

function insertSourceRefs(db: Database, collectionId: string, chunkId: string | null, refs: KnowledgeSourceRef[]): void {
  const statement = db.query(
    `INSERT INTO source_refs (id, collection_id, chunk_id, kind, ref_json)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  );
  refs.forEach((ref, index) => {
    statement.run(
      textHash(`${collectionId}\0${chunkId ?? "collection"}\0${index}\0${stringify(ref)}`),
      collectionId,
      chunkId,
      ref.kind,
      stringify(ref),
    );
  });
}

export class SQLiteKnowledgeStore {
  private readonly db: Database;
  private readonly paths: OpenScoutKnowledgePaths;

  constructor(dbPath?: string, paths?: OpenScoutKnowledgePaths) {
    const resolvedPaths = paths ?? resolveOpenScoutKnowledgePaths();
    const sqlitePath = dbPath ?? resolvedPaths.sqlitePath;
    this.paths = { ...resolvedPaths, sqlitePath };
    mkdirSync(dirname(sqlitePath), { recursive: true });
    mkdirSync(this.paths.qmdRoot, { recursive: true });
    this.db = new Database(sqlitePath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(KNOWLEDGE_SQLITE_SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  upsertCollection(collection: KnowledgeCollection): void {
    this.db.query(
      `INSERT INTO collections (
        id, kind, title, source_refs_json, qmd_path, status, content_hash,
        extractor_version, chunk_policy_version, created_at, updated_at, facets_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        source_refs_json = excluded.source_refs_json,
        qmd_path = excluded.qmd_path,
        status = excluded.status,
        content_hash = excluded.content_hash,
        extractor_version = excluded.extractor_version,
        chunk_policy_version = excluded.chunk_policy_version,
        updated_at = excluded.updated_at,
        facets_json = excluded.facets_json`,
    ).run(
      collection.id,
      collection.kind,
      collection.title,
      stringify(collection.sourceRefs),
      collection.qmdPath,
      collection.status,
      collection.contentHash,
      collection.extractorVersion,
      collection.chunkPolicyVersion,
      collection.createdAt,
      collection.updatedAt,
      stringify(collection.facets),
    );

    this.db.query("DELETE FROM facets WHERE collection_id = ?1 AND chunk_id IS NULL").run(collection.id);
    this.db.query("DELETE FROM source_refs WHERE collection_id = ?1 AND chunk_id IS NULL").run(collection.id);
    insertFacetRows(this.db, collection.id, null, collection.facets);
    insertSourceRefs(this.db, collection.id, null, collection.sourceRefs);
  }

  getCollection(id: string): KnowledgeCollection | null {
    const row = this.db.query("SELECT * FROM collections WHERE id = ?1").get(id) as CollectionRow | null;
    return row ? collectionFromRow(row) : null;
  }

  deleteCollection(id: string): void {
    (this.db as SQLiteTransactionalDatabase).transaction(() => {
      const chunkRows = this.db.query(
        "SELECT id FROM chunks WHERE collection_id = ?1",
      ).all(id) as Array<{ id: string }>;
      const deleteFts = this.db.query("DELETE FROM chunks_fts WHERE chunk_id = ?1");
      for (const row of chunkRows) {
        deleteFts.run(row.id);
      }
      this.db.query("DELETE FROM collections WHERE id = ?1").run(id);
    })();
  }

  upsertDocument(document: KnowledgeDocument): void {
    this.db.query(
      `INSERT INTO documents (id, collection_id, path, kind, origin, content_hash, metadata_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
        collection_id = excluded.collection_id,
        path = excluded.path,
        kind = excluded.kind,
        origin = excluded.origin,
        content_hash = excluded.content_hash,
        metadata_json = excluded.metadata_json`,
    ).run(
      document.id,
      document.collectionId,
      document.path,
      document.kind,
      document.origin,
      document.contentHash,
      stringify(document.metadata ?? null),
    );
  }

  upsertChunk(chunk: KnowledgeChunk, title = chunk.documentPath): void {
    const now = nowMs();
    (this.db as SQLiteTransactionalDatabase).transaction(() => {
      this.db.query(
        `INSERT INTO chunks (
          id, collection_id, document_id, document_path, ordinal, text, text_hash,
          origin, ownership, source_refs_json, facets_json, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(id) DO UPDATE SET
          collection_id = excluded.collection_id,
          document_id = excluded.document_id,
          document_path = excluded.document_path,
          ordinal = excluded.ordinal,
          text = excluded.text,
          text_hash = excluded.text_hash,
          origin = excluded.origin,
          ownership = excluded.ownership,
          source_refs_json = excluded.source_refs_json,
          facets_json = excluded.facets_json,
          updated_at = excluded.updated_at`,
      ).run(
        chunk.id,
        chunk.collectionId,
        chunk.documentId,
        chunk.documentPath,
        chunk.ordinal,
        chunk.text,
        chunk.textHash,
        chunk.origin,
        chunk.ownership,
        stringify(chunk.sourceRefs),
        stringify(chunk.facets),
        now,
        now,
      );

      this.db.query("DELETE FROM chunks_fts WHERE chunk_id = ?1").run(chunk.id);
      this.db.query(
        `INSERT INTO chunks_fts (chunk_id, collection_id, document_id, title, body)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).run(chunk.id, chunk.collectionId, chunk.documentId, title, chunk.text);

      this.db.query("DELETE FROM facets WHERE chunk_id = ?1").run(chunk.id);
      this.db.query("DELETE FROM source_refs WHERE chunk_id = ?1").run(chunk.id);
      insertFacetRows(this.db, chunk.collectionId, chunk.id, chunk.facets);
      insertSourceRefs(this.db, chunk.collectionId, chunk.id, chunk.sourceRefs);
    })();
  }

  searchLexical(query: KnowledgeSearchQuery): KnowledgeSearchHit[] {
    const q = query.q.trim();
    if (!q) return [];
    const ftsQuery = normalizeFtsQuery(q);
    if (!ftsQuery) return [];
    const params: SQLiteBinding[] = [ftsQuery];
    const clauses = ["chunks_fts MATCH ?1"];

    if (query.collections?.length) {
      const placeholders = query.collections.map((collectionId) => {
        params.push(collectionId);
        return `?${params.length}`;
      }).join(", ");
      clauses.push(`c.collection_id IN (${placeholders})`);
    }

    if (query.sourceKinds?.length) {
      const placeholders = query.sourceKinds.map((kind) => {
        params.push(kind);
        return `?${params.length}`;
      }).join(", ");
      clauses.push(`col.kind IN (${placeholders})`);
    }

    if (query.facets) {
      for (const [key, rawValue] of Object.entries(query.facets)) {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        const filtered = values
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        if (filtered.length === 0) continue;
        const placeholders = filtered.map((value) => {
          params.push(value);
          return `?${params.length}`;
        }).join(", ");
        params.push(key);
        clauses.push(`EXISTS (
          SELECT 1 FROM facets f
          WHERE f.collection_id = c.collection_id
            AND (f.chunk_id = c.id OR f.chunk_id IS NULL)
            AND f.key = ?${params.length}
            AND f.value IN (${placeholders})
        )`);
      }
    }

    if (typeof query.sourceUpdatedAfterMs === "number" && Number.isFinite(query.sourceUpdatedAfterMs)) {
      params.push(query.sourceUpdatedAfterMs);
      clauses.push(`EXISTS (
        SELECT 1 FROM source_refs sr
        WHERE sr.chunk_id = c.id
          AND CAST(json_extract(sr.ref_json, '$.anchor.mtimeMs') AS REAL) >= ?${params.length}
      )`);
    }

    if (typeof query.sourceUpdatedBeforeMs === "number" && Number.isFinite(query.sourceUpdatedBeforeMs)) {
      params.push(query.sourceUpdatedBeforeMs);
      clauses.push(`EXISTS (
        SELECT 1 FROM source_refs sr
        WHERE sr.chunk_id = c.id
          AND CAST(json_extract(sr.ref_json, '$.anchor.mtimeMs') AS REAL) <= ?${params.length}
      )`);
    }

    const sql = `
      SELECT
        c.*,
        col.title AS title,
        bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.chunk_id
      JOIN collections col ON col.id = c.collection_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY rank ASC
      LIMIT ?${params.length + 1}`;
    params.push(normalizedLimit(query.limit));

    try {
      const rows = this.db.query(sql).all(...params) as ChunkRow[];
      return rows.map((row) => searchHitFromRow(row, q));
    } catch {
      return [];
    }
  }

  listFacetValues(keys?: string[], limit?: number): KnowledgeFacetValue[] {
    const params: SQLiteBinding[] = [];
    const clauses: string[] = [];
    const requestedKeys = keys
      ?.map((key) => key.trim())
      .filter((key) => key.length > 0);

    if (requestedKeys?.length) {
      const placeholders = requestedKeys.map((key) => {
        params.push(key);
        return `?${params.length}`;
      }).join(", ");
      clauses.push(`key IN (${placeholders})`);
    }

    const sql = `
      SELECT key, value, COUNT(DISTINCT COALESCE(chunk_id, collection_id)) AS count
      FROM facets
      ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      GROUP BY key, value
      ORDER BY key ASC, count DESC, value ASC
      LIMIT ?${params.length + 1}`;
    params.push(normalizedLimit(limit, 200, 1000));

    return this.db.query(sql).all(...params) as KnowledgeFacetValue[];
  }

  createIndexJob(request: KnowledgeIndexRequest, id = `knowledge-job-${randomUUID()}`): KnowledgeIndexJob {
    const now = nowMs();
    const job: KnowledgeIndexJob = {
      id,
      source: request.source,
      state: "queued",
      leaseGeneration: 0,
      progress: {},
      createdAt: now,
      updatedAt: now,
    };
    this.db.query(
      `INSERT INTO index_jobs (id, source, state, lease_generation, progress_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).run(job.id, job.source, job.state, job.leaseGeneration, stringify(job.progress), job.createdAt, job.updatedAt);
    return job;
  }

  updateIndexJob(input: {
    id: string;
    state?: KnowledgeIndexJobState;
    leaseOwner?: string | null;
    leaseGeneration?: number;
    progress?: KnowledgeIndexJob["progress"];
    error?: string | null;
    completedAt?: number | null;
  }): KnowledgeIndexJob | null {
    const existing = this.getIndexJob(input.id);
    if (!existing) return null;
    const next: KnowledgeIndexJob = {
      ...existing,
      state: input.state ?? existing.state,
      leaseOwner: input.leaseOwner === null ? undefined : input.leaseOwner ?? existing.leaseOwner,
      leaseGeneration: input.leaseGeneration ?? existing.leaseGeneration,
      progress: input.progress ?? existing.progress,
      updatedAt: nowMs(),
      completedAt: input.completedAt === null ? undefined : input.completedAt ?? existing.completedAt,
      error: input.error === null ? undefined : input.error ?? existing.error,
    };
    this.db.query(
      `UPDATE index_jobs
       SET state = ?2,
           lease_owner = ?3,
           lease_generation = ?4,
           progress_json = ?5,
           updated_at = ?6,
           completed_at = ?7,
           error = ?8
       WHERE id = ?1`,
    ).run(
      next.id,
      next.state,
      next.leaseOwner ?? null,
      next.leaseGeneration,
      stringify(next.progress),
      next.updatedAt,
      next.completedAt ?? null,
      next.error ?? null,
    );
    return next;
  }

  getIndexJob(id: string): KnowledgeIndexJob | null {
    const row = this.db.query("SELECT * FROM index_jobs WHERE id = ?1").get(id) as JobRow | null;
    return row ? jobFromRow(row) : null;
  }

  listActiveJobs(): KnowledgeIndexJob[] {
    const rows = this.db.query(
      `SELECT * FROM index_jobs
       WHERE state IN ('queued', 'running', 'waiting')
       ORDER BY updated_at DESC
       LIMIT 50`,
    ).all() as JobRow[];
    return rows.map(jobFromRow);
  }

  status(): KnowledgeStatus {
    const collectionCounts = this.db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready
       FROM collections`,
    ).get() as { total: number; ready: number | null } | null;
    const chunkCounts = this.db.query("SELECT COUNT(*) AS total FROM chunks").get() as { total: number } | null;
    let sqliteBytes = 0;
    try {
      sqliteBytes = statSync(this.paths.sqlitePath).size;
    } catch {
      sqliteBytes = 0;
    }
    return {
      generatedAt: nowMs(),
      paths: {
        knowledgeRoot: this.paths.knowledgeRoot,
        qmdRoot: this.paths.qmdRoot,
        sqlitePath: this.paths.sqlitePath,
      },
      collections: collectionCounts?.total ?? 0,
      readyCollections: collectionCounts?.ready ?? 0,
      chunks: chunkCounts?.total ?? 0,
      activeJobs: this.listActiveJobs(),
      sqliteBytes,
    };
  }
}
