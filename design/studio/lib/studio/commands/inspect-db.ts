import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import type { Command } from "@/lib/studio/command";

const ROOT = path.join(tmpdir(), "scout-study");

// ── List databases ─────────────────────────────────────────────────────

export interface DbFile {
  name: string;
  path: string;
  bytes: number;
  mtimeMs: number;
}

export interface ListDatabasesResult {
  root: string;
  databases: DbFile[];
}

export const listDatabasesCommand: Command<Record<string, never>, ListDatabasesResult> = {
  id: "list-databases",
  label: "List databases",
  shell: () => `ls -lh ${shrinkPath(ROOT)}/*.db`,
  run: async () => {
    try {
      const entries = await fs.readdir(ROOT);
      const dbs: DbFile[] = [];
      for (const name of entries) {
        if (!name.endsWith(".db")) continue;
        const full = path.join(ROOT, name);
        const stat = await fs.stat(full);
        if (!stat.isFile()) continue;
        dbs.push({ name, path: full, bytes: stat.size, mtimeMs: stat.mtimeMs });
      }
      dbs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return { root: ROOT, databases: dbs };
    } catch {
      return { root: ROOT, databases: [] };
    }
  },
  cacheKey: () => "v1",
  cacheTtlMs: 5_000,
};

// ── Schema ─────────────────────────────────────────────────────────────

export interface TableColumn {
  name: string;
  type: string;
  notNull: boolean;
  isPk: boolean;
}

export type TableKind = "table" | "view" | "virtual" | "fts5" | "shadow";

export interface TableInfo {
  name: string;
  kind: TableKind;
  columns: TableColumn[];
  rowCount: number;
  sql: string;
}

export interface DbSchemaResult {
  dbPath: string;
  tables: TableInfo[];
}

export const dbSchemaCommand: Command<{ dbPath: string }, DbSchemaResult> = {
  id: "db-schema",
  label: "Schema",
  shell: ({ dbPath }) => `sqlite3 ${shrinkPath(dbPath)} '.schema'`,
  run: async ({ dbPath }) => {
    const db = openReadonly(dbPath);
    try {
      const masterRows = db
        .prepare(
          `SELECT name, type, sql FROM sqlite_master
           WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all() as { name: string; type: string; sql: string | null }[];

      const ftsNames = new Set<string>();
      for (const r of masterRows) {
        if (r.sql && /\bUSING\s+fts5\b/i.test(r.sql)) ftsNames.add(r.name);
      }

      const shadowSuffixes = ["_data", "_idx", "_content", "_docsize", "_config"];
      const isShadow = (name: string): string | null => {
        for (const fts of ftsNames) {
          for (const suffix of shadowSuffixes) {
            if (name === `${fts}${suffix}`) return fts;
          }
        }
        return null;
      };

      const tables: TableInfo[] = [];
      for (const row of masterRows) {
        const sql = row.sql ?? "";
        const isVirtual = /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql);
        const isFts5 = isVirtual && /\bUSING\s+fts5\b/i.test(sql);
        const shadowParent = isShadow(row.name);
        const kind: TableKind = shadowParent
          ? "shadow"
          : isFts5
            ? "fts5"
            : isVirtual
              ? "virtual"
              : row.type === "view"
                ? "view"
                : "table";

        let columns: TableColumn[] = [];
        try {
          const info = db
            .prepare(`PRAGMA table_info(${quoteIdent(row.name)})`)
            .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
          columns = info.map((c) => ({
            name: c.name,
            type: c.type,
            notNull: !!c.notnull,
            isPk: !!c.pk,
          }));
        } catch {
          /* fts5 shadow tables can refuse pragma */
        }

        let rowCount = 0;
        try {
          const r = db
            .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(row.name)}`)
            .get() as { c: number };
          rowCount = r.c;
        } catch {
          /* skip */
        }

        tables.push({ name: row.name, kind, columns, rowCount, sql });
      }
      return { dbPath, tables };
    } finally {
      db.close();
    }
  },
  cacheKey: ({ dbPath }) => dbPath,
  cacheTtlMs: 10_000,
};

// ── Canned queries ─────────────────────────────────────────────────────

export interface QueryRow {
  [k: string]: unknown;
}

export interface QueryResult {
  sql: string;
  columns: string[];
  rows: QueryRow[];
  rowsTotal: number;
  rejectedReason?: string;
}

const CANNED_SQL: Record<string, string> = {
  "chunks-per-session": `
    SELECT s.id AS session_id, s.harness, COUNT(c.id) AS chunks
    FROM sessions s
    LEFT JOIN documents d ON d.session_id = s.id
    LEFT JOIN chunks c ON c.document_id = d.id
    GROUP BY s.id, s.harness
    ORDER BY chunks DESC
  `,
  "top-files-by-chunks": `
    SELECT d.path, d.kind, COUNT(c.id) AS chunks, d.bytes
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    GROUP BY d.id
    ORDER BY chunks DESC
    LIMIT 20
  `,
  "document-mix-by-kind": `
    SELECT d.kind, COUNT(*) AS docs, SUM(d.bytes) AS total_bytes
    FROM documents d
    GROUP BY d.kind
    ORDER BY docs DESC
  `,
};

export const CANNED_QUERIES: { id: string; label: string }[] = [
  { id: "chunks-per-session", label: "Chunks per session" },
  { id: "top-files-by-chunks", label: "Top files by chunks" },
  { id: "document-mix-by-kind", label: "Document mix by kind" },
];

export const dbCannedQueryCommand: Command<
  { dbPath: string; queryId: string },
  QueryResult
> = {
  id: "db-canned",
  label: "Canned query",
  shell: ({ dbPath, queryId }) => {
    const sql = (CANNED_SQL[queryId] ?? "-- unknown").trim().replace(/\s+/g, " ");
    return `sqlite3 -readonly ${shrinkPath(dbPath)} ${shellQuote(sql)}`;
  },
  run: async ({ dbPath, queryId }) => {
    const sql = CANNED_SQL[queryId];
    if (!sql) {
      return {
        sql: queryId,
        columns: [],
        rows: [],
        rowsTotal: 0,
        rejectedReason: `unknown canned query: ${queryId}`,
      };
    }
    return runSelect(dbPath, sql);
  },
  cacheKey: ({ dbPath, queryId }) => `${dbPath}::${queryId}`,
  cacheTtlMs: 30_000,
};

// ── FTS5 MATCH ─────────────────────────────────────────────────────────

export interface MatchHit {
  rowid: number;
  session_id: string | null;
  document_kind: string | null;
  source_ref: string | null;
  snippet: string;
  rank: number;
}

export interface MatchResult {
  sql: string;
  term: string;
  hits: MatchHit[];
  rejectedReason?: string;
}

export const dbMatchCommand: Command<
  { dbPath: string; term: string },
  MatchResult
> = {
  id: "db-match",
  label: "FTS5 MATCH",
  shell: ({ dbPath, term }) =>
    `sqlite3 -readonly ${shrinkPath(dbPath)} ${shellQuote(
      `SELECT snippet(chunks_fts, 0, '«', '»', '…', 12) FROM chunks_fts WHERE chunks_fts MATCH ${quoteSql(term)} ORDER BY rank LIMIT 20`,
    )}`,
  run: async ({ dbPath, term }) => {
    const trimmed = term.trim();
    const sql = `
      SELECT c.id AS rowid, d.session_id, d.kind AS document_kind, c.source_ref,
             snippet(chunks_fts, 0, '«', '»', '…', 12) AS snippet,
             chunks_fts.rank AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.rowid
      JOIN documents d ON d.id = c.document_id
      WHERE chunks_fts MATCH ?
      ORDER BY chunks_fts.rank
      LIMIT 20
    `;
    if (!trimmed) {
      return { sql, term: "", hits: [], rejectedReason: "Enter a MATCH term to run a search." };
    }
    const db = openReadonly(dbPath);
    try {
      const hits = db.prepare(sql).all(trimmed) as MatchHit[];
      return { sql, term: trimmed, hits };
    } catch (err) {
      return {
        sql,
        term: trimmed,
        hits: [],
        rejectedReason: err instanceof Error ? err.message : String(err),
      };
    } finally {
      db.close();
    }
  },
  cacheKey: ({ dbPath, term }) => `${dbPath}::${term.trim()}`,
  cacheTtlMs: 30_000,
};

// ── Free-form SELECT ───────────────────────────────────────────────────

export const dbSelectCommand: Command<
  { dbPath: string; sql: string },
  QueryResult
> = {
  id: "db-select",
  label: "SELECT",
  shell: ({ dbPath, sql }) => {
    const oneLine = sql.trim().replace(/\s+/g, " ");
    const clip = oneLine.length > 140 ? oneLine.slice(0, 137) + "…" : oneLine;
    return `sqlite3 -readonly ${shrinkPath(dbPath)} ${shellQuote(clip || "SELECT 1")}`;
  },
  run: async ({ dbPath, sql }) => {
    const cleaned = sql.trim().replace(/;+\s*$/, "");
    if (!cleaned) {
      return {
        sql: "",
        columns: [],
        rows: [],
        rowsTotal: 0,
        rejectedReason: "Enter a SELECT or WITH query to run.",
      };
    }
    if (!/^select\b/i.test(cleaned) && !/^with\b/i.test(cleaned)) {
      return {
        sql: cleaned,
        columns: [],
        rows: [],
        rowsTotal: 0,
        rejectedReason: "Only SELECT and WITH queries are allowed.",
      };
    }
    if (/;/.test(cleaned)) {
      return {
        sql: cleaned,
        columns: [],
        rows: [],
        rowsTotal: 0,
        rejectedReason: "Multiple statements are not allowed.",
      };
    }
    const withLimit = /\blimit\s+\d+/i.test(cleaned) ? cleaned : `${cleaned} LIMIT 100`;
    try {
      return runSelect(dbPath, withLimit);
    } catch (err) {
      return {
        sql: withLimit,
        columns: [],
        rows: [],
        rowsTotal: 0,
        rejectedReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  cacheKey: ({ dbPath, sql }) => `${dbPath}::${sql.trim()}`,
  cacheTtlMs: 10_000,
};

// ── Ask (NL → FTS5, fully local) ───────────────────────────────────────

export interface AskHit {
  rowid: number;
  session_id: string | null;
  document_kind: string | null;
  source_ref: string | null;
  snippet: string;
  rank: number;
}

export interface AskResult {
  question: string;
  /** Tokens kept after stopword + cleanup. Fed straight into FTS5 MATCH. */
  extractedTerms: string[];
  /** Tokens dropped by the stopword/length filter — surfaced so the UI is honest. */
  droppedTerms: string[];
  matchQuery: string;
  hits: AskHit[];
  /** Pure local tokenisation latency (always sub-ms). */
  tokenizeLatencyMs: number;
  matchLatencyMs: number;
  rejectedReason?: string;
}

const ASK_SQL = `
  SELECT c.id AS rowid, d.session_id, d.kind AS document_kind, c.source_ref,
         snippet(chunks_fts, 0, '«', '»', '…', 12) AS snippet,
         chunks_fts.rank AS rank
  FROM chunks_fts
  JOIN chunks c ON c.id = chunks_fts.rowid
  JOIN documents d ON d.id = c.document_id
  WHERE chunks_fts MATCH ?
  ORDER BY chunks_fts.rank
  LIMIT 10
`;

export const dbAskCommand: Command<
  { dbPath: string; question: string },
  AskResult
> = {
  id: "db-ask",
  label: "Ask the data",
  shell: ({ dbPath, question }) => {
    const q = oneLine(question, 60) || "<question>";
    return [
      `# ask: "${q}"`,
      `#   step 1 — strip stopwords locally, keep content tokens`,
      `#   step 2 — sqlite3 -readonly ${shrinkPath(dbPath)} \\`,
      `#              "SELECT … FROM chunks_fts WHERE chunks_fts MATCH '<terms>' ORDER BY rank LIMIT 10"`,
    ].join("\n");
  },
  run: async ({ dbPath, question }) => {
    const trimmed = question.trim();
    const empty = (reason?: string): AskResult => ({
      question: trimmed,
      extractedTerms: [],
      droppedTerms: [],
      matchQuery: "",
      hits: [],
      tokenizeLatencyMs: 0,
      matchLatencyMs: 0,
      rejectedReason: reason,
    });

    if (!trimmed) {
      return empty("Enter a question above.");
    }

    const tokStart = Date.now();
    const { kept, dropped } = tokenizeQuestion(trimmed);
    const tokenizeLatencyMs = Date.now() - tokStart;

    if (kept.length === 0) {
      return {
        ...empty(
          `No content words left after stopword removal. Dropped: ${dropped.join(", ") || "(nothing)"}.`,
        ),
        droppedTerms: dropped,
        tokenizeLatencyMs,
      };
    }

    const matchQuery = kept.map((t) => `"${t}"`).join(" OR ");
    const matchStart = Date.now();
    const db = openReadonly(dbPath);
    try {
      const hits = db.prepare(ASK_SQL).all(matchQuery) as AskHit[];
      return {
        question: trimmed,
        extractedTerms: kept,
        droppedTerms: dropped,
        matchQuery,
        hits,
        tokenizeLatencyMs,
        matchLatencyMs: Date.now() - matchStart,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...empty(`FTS5 query failed: ${msg}`),
        extractedTerms: kept,
        droppedTerms: dropped,
        matchQuery,
        tokenizeLatencyMs,
        matchLatencyMs: Date.now() - matchStart,
      };
    } finally {
      db.close();
    }
  },
  cacheKey: ({ dbPath, question }) => `${dbPath}::${question.trim()}`,
  cacheTtlMs: 5 * 60 * 1000,
};

/**
 * Question → content tokens. Lowercase, strip punctuation, split on whitespace,
 * drop stopwords, dedupe, cap. Returns kept + dropped so callers can show what
 * we filtered out (so the search is interpretable).
 */
function tokenizeQuestion(question: string): {
  kept: string[];
  dropped: string[];
} {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s']/g, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokens) {
    if (tok.length < 2 || tok.length > 40) {
      dropped.push(tok);
      continue;
    }
    if (ASK_STOPWORDS.has(tok)) {
      dropped.push(tok);
      continue;
    }
    if (seen.has(tok)) continue;
    seen.add(tok);
    kept.push(tok);
  }
  return { kept: kept.slice(0, 8), dropped };
}

const ASK_STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "if", "of", "in", "on", "at",
  "to", "for", "from", "by", "with", "as", "is", "are", "was", "were",
  "be", "been", "being", "do", "does", "did", "doing", "have", "has",
  "had", "having", "i", "you", "he", "she", "it", "we", "they", "them",
  "their", "this", "that", "these", "those", "what", "which", "who",
  "whom", "whose", "where", "when", "why", "how", "all", "any", "some",
  "no", "not", "nor", "so", "than", "too", "very", "can", "could",
  "should", "would", "may", "might", "must", "will", "shall", "about",
  "into", "over", "under", "after", "before", "during", "between",
  "such", "there", "here", "out", "up", "down", "off", "again", "more",
  "most", "other", "each", "every", "both", "few", "many", "much",
  "tell", "show", "give", "find", "get", "make", "let", "us", "me",
]);

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// ── Helpers ────────────────────────────────────────────────────────────

function runSelect(dbPath: string, sql: string): QueryResult {
  const db = openReadonly(dbPath);
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all() as QueryRow[];
    const columns =
      rows.length > 0
        ? Object.keys(rows[0]!)
        : stmt
            .columns()
            .map((c) => c.name)
            .filter((n): n is string => typeof n === "string");
    return { sql: sql.trim(), columns, rows, rowsTotal: rows.length };
  } finally {
    db.close();
  }
}

function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteSql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function shrinkPath(p: string): string {
  const home = process.env.HOME ?? "";
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}
