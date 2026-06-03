import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import type { Command } from "@/lib/studio/command";

export interface IndexCorpusInput {
  /** Specific session ids to (re)index. Empty/undefined = every qmd dir on disk. */
  sessionIds?: string[];
}

export interface IndexedSessionSummary {
  sessionId: string;
  documents: number;
  chunks: number;
}

export interface IndexCorpusResult {
  dbPath: string;
  dbBytes: number;
  sessions: number;
  documents: number;
  chunks: number;
  ftsRows: number;
  indexedSessions: IndexedSessionSummary[];
  schemaWasFresh: boolean;
}

const ROOT = path.join(tmpdir(), "scout-study");
const QMD_ROOT = path.join(ROOT, "qmd");
const DB_PATH = path.join(ROOT, "index.db");

/**
 * Read QMD sidecar files for one or more sessions and index them into a real
 * sqlite db at $TMPDIR/scout-study/index.db. Schema:
 *
 *   sessions   (id, harness, indexed_at)
 *   documents  (id, session_id, kind, path, bytes)
 *   chunks     (id, document_id, ordinal, source_ref, text)
 *   chunks_fts (virtual FTS5 over chunks.text)
 *
 * Event transcripts are split into bounded record ranges so large sessions
 * produce useful search units. Other markdown files are split by H2 section;
 * the "preamble" before the first H2 is its own chunk.
 */
export const indexCorpusCommand: Command<IndexCorpusInput, IndexCorpusResult> = {
  id: "index-corpus",
  label: "Index corpus",
  shell: ({ sessionIds }) => {
    const target = sessionIds && sessionIds.length > 0 ? sessionIds.join(",") : "all";
    return `scout index --db ${shrinkPath(DB_PATH)} --sessions ${target}`;
  },
  run: async ({ sessionIds }) => {
    await fs.mkdir(ROOT, { recursive: true });

    const wasFresh = !(await pathExists(DB_PATH));
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        harness TEXT,
        indexed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        kind TEXT,
        path TEXT,
        bytes INTEGER
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
        ordinal INTEGER,
        source_ref TEXT,
        text TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        content='chunks',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `);

    const targets = sessionIds && sessionIds.length > 0
      ? sessionIds
      : await listQmdSessions();

    const insertSession = db.prepare(
      "INSERT OR REPLACE INTO sessions (id, harness, indexed_at) VALUES (?, ?, ?)",
    );
    const deleteDocsForSession = db.prepare(
      "DELETE FROM documents WHERE session_id = ?",
    );
    const insertDoc = db.prepare(
      "INSERT INTO documents (id, session_id, kind, path, bytes) VALUES (?, ?, ?, ?, ?)",
    );
    const insertChunk = db.prepare(
      "INSERT INTO chunks (document_id, ordinal, source_ref, text) VALUES (?, ?, ?, ?)",
    );

    const indexed: IndexedSessionSummary[] = [];

    const tx = db.transaction((sessionId: string) => {
      const harness = inferHarness(sessionId);
      insertSession.run(sessionId, harness, Date.now());
      deleteDocsForSession.run(sessionId);
    });

    for (const sessionId of targets) {
      const sessionDir = path.join(QMD_ROOT, sessionId);
      const dirExists = await pathExists(sessionDir);
      if (!dirExists) continue;

      tx(sessionId);

      let docs = 0;
      let chunks = 0;
      const fileNames = await fs.readdir(sessionDir);
      for (const fileName of fileNames) {
        if (fileName.startsWith("_")) continue; // skip _llm-call.json etc.
        const filePath = path.join(sessionDir, fileName);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        const kind = inferKind(fileName);
        const docId = `${sessionId}/${fileName}`;
        insertDoc.run(docId, sessionId, kind, filePath, stat.size);
        docs++;

        const content = await fs.readFile(filePath, "utf8");
        const sectionChunks = chunkDocument(fileName, content);

        sectionChunks.forEach((c, i) => {
          insertChunk.run(docId, i, c.sourceRef ?? null, c.text);
          chunks++;
        });
      }

      indexed.push({ sessionId, documents: docs, chunks });
    }

    const sessionsCount = (db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number }).c;
    const documentsCount = (db.prepare("SELECT COUNT(*) AS c FROM documents").get() as { c: number }).c;
    const chunksCount = (db.prepare("SELECT COUNT(*) AS c FROM chunks").get() as { c: number }).c;
    const ftsRows = (db.prepare("SELECT COUNT(*) AS c FROM chunks_fts").get() as { c: number }).c;

    db.close();

    const dbStat = await fs.stat(DB_PATH);

    return {
      dbPath: DB_PATH,
      dbBytes: dbStat.size,
      sessions: sessionsCount,
      documents: documentsCount,
      chunks: chunksCount,
      ftsRows,
      indexedSessions: indexed,
      schemaWasFresh: wasFresh,
    };
  },
  cacheKey: ({ sessionIds }) =>
    sessionIds && sessionIds.length > 0
      ? sessionIds.slice().sort().join(",")
      : "all",
  cacheTtlMs: 5 * 60 * 1000,
};

async function listQmdSessions(): Promise<string[]> {
  try {
    const entries = await fs.readdir(QMD_ROOT, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function inferHarness(sessionId: string): string {
  const prefix = sessionId.split("-")[0];
  return prefix ?? "unknown";
}

function inferKind(fileName: string): string {
  if (fileName === "overview.md") return "overview";
  if (fileName === "decisions.md") return "decisions";
  if (fileName === "files.md") return "files";
  if (fileName === "tool-calls.md") return "tool-calls";
  if (fileName.startsWith("events-")) return "events";
  if (fileName === "manifest.json") return "manifest";
  return "other";
}

interface SectionChunk {
  text: string;
  sourceRef?: string;
}

const EVENT_RECORDS_PER_CHUNK = 50;

function chunkDocument(fileName: string, content: string): SectionChunk[] {
  if (fileName === "manifest.json") {
    return [{ text: content.trim(), sourceRef: "root" }].filter((c) => c.text.length > 0);
  }
  if (fileName.startsWith("events-") && fileName.endsWith(".md")) {
    return chunkEventWindow(content);
  }
  return chunkByH2(content);
}

function chunkEventWindow(content: string): SectionChunk[] {
  const lines = content.split("\n");
  const chunks: SectionChunk[] = [];
  let headerLines: string[] = [];
  let current:
    | { firstRecord: string; lastRecord: string; recordCount: number; lines: string[] }
    | undefined;

  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (text.length > 0) {
      chunks.push({
        text,
        sourceRef: `records ${current.firstRecord}..${current.lastRecord}`,
      });
    }
    current = undefined;
  };

  for (const line of lines) {
    const record = /^- \[(\d+)\]/.exec(line);
    if (!record) {
      if (current) {
        current.lines.push(line);
      } else if (line.trim().length > 0) {
        headerLines.push(line);
      }
      continue;
    }

    const recordId = record[1]!;
    if (!current) {
      current = {
        firstRecord: recordId,
        lastRecord: recordId,
        recordCount: 1,
        lines: headerLines.length > 0 ? [...headerLines, "", line] : [line],
      };
      headerLines = [];
      continue;
    }

    if (current.recordCount >= EVENT_RECORDS_PER_CHUNK) {
      flush();
      current = {
        firstRecord: recordId,
        lastRecord: recordId,
        recordCount: 1,
        lines: [line],
      };
    } else {
      current.lastRecord = recordId;
      current.recordCount++;
      current.lines.push(line);
    }
  }

  flush();

  if (chunks.length > 0) return chunks;

  const fallback = content.trim();
  return fallback.length > 0 ? [{ text: fallback, sourceRef: "events" }] : [];
}

function chunkByH2(content: string): SectionChunk[] {
  const lines = content.split("\n");
  const chunks: SectionChunk[] = [];
  let preambleLines: string[] = [];
  let current: { heading: string; lines: string[] } | undefined;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) {
        const text = current.lines.join("\n").trim();
        if (text.length > 0) chunks.push({ text, sourceRef: current.heading });
      } else if (preambleLines.length > 0) {
        const text = preambleLines.join("\n").trim();
        if (text.length > 0) chunks.push({ text, sourceRef: "preamble" });
      }
      current = { heading: line.slice(3).trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  if (current) {
    const text = current.lines.join("\n").trim();
    if (text.length > 0) chunks.push({ text, sourceRef: current.heading });
  } else if (preambleLines.length > 0) {
    const text = preambleLines.join("\n").trim();
    if (text.length > 0) chunks.push({ text, sourceRef: "preamble" });
  }

  return chunks;
}

function shrinkPath(p: string): string {
  const home = process.env.HOME ?? "";
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}
