import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export type InventoryHarness = "codex" | "claude" | "claude-subagent";

export interface InventoryRow {
  harness: InventoryHarness;
  path: string;
  displayPath: string;
  sessionId: string;
  sizeBytes: number;
  mtimeMs: number;
  modified: string;
  events?: number;
  project?: string;
}

export interface InventorySummary {
  harness: string;
  files: number;
  bytes: number;
}

export interface InventoryResult {
  rows: InventoryRow[];
  totalFiles: number;
  totalBytes: number;
  byHarness: InventorySummary[];
  displayLimit: number;
  windowDays: number;
  durationMs: number;
  scannedAt: number;
  cached: boolean;
  error?: string;
}

const SCAN_WINDOW_DAYS = 7;
const DISPLAY_LIMIT = 10;
const CACHE_TTL_MS = 60_000;

const HOME = homedir();
const CODEX_DIR = path.join(HOME, ".codex", "sessions");
const CLAUDE_PROJECTS_DIR = path.join(HOME, ".claude", "projects");

let cache: { at: number; result: InventoryResult } | undefined;

export async function runInventory(): Promise<InventoryResult> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.result, cached: true };
  }

  const start = Date.now();
  const cutoff = start - SCAN_WINDOW_DAYS * 86_400_000;

  try {
    const [codexFiles, claudeFiles] = await Promise.all([
      walkJsonl(CODEX_DIR),
      walkJsonl(CLAUDE_PROJECTS_DIR),
    ]);

    const rows: InventoryRow[] = [];
    let totalBytes = 0;

    for (const file of codexFiles) {
      const stat = await safeStat(file);
      if (!stat || stat.mtimeMs < cutoff) continue;
      totalBytes += stat.size;
      rows.push({
        harness: "codex",
        path: file,
        displayPath: shrinkPath(file),
        sessionId: shortSessionId(file),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        modified: formatMtime(stat.mtimeMs),
      });
    }

    for (const file of claudeFiles) {
      const stat = await safeStat(file);
      if (!stat || stat.mtimeMs < cutoff) continue;
      totalBytes += stat.size;
      const project = path.basename(path.dirname(file));
      const isSubagent = file.includes("agent-") || project.includes("subagent");
      rows.push({
        harness: isSubagent ? "claude-subagent" : "claude",
        path: file,
        displayPath: shrinkPath(file),
        sessionId: shortSessionId(file),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        modified: formatMtime(stat.mtimeMs),
        project,
      });
    }

    rows.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const displayed = rows.slice(0, DISPLAY_LIMIT);
    await Promise.all(
      displayed.map(async (row) => {
        row.events = await countLines(row.path);
      }),
    );

    const codexRows = rows.filter((r) => r.harness === "codex");
    const claudeMainRows = rows.filter((r) => r.harness === "claude");
    const claudeSubRows = rows.filter((r) => r.harness === "claude-subagent");

    const byHarness: InventorySummary[] = [
      {
        harness: "codex",
        files: codexRows.length,
        bytes: codexRows.reduce((a, r) => a + r.sizeBytes, 0),
      },
      {
        harness: "claude",
        files: claudeMainRows.length,
        bytes: claudeMainRows.reduce((a, r) => a + r.sizeBytes, 0),
      },
      {
        harness: "claude-subagent",
        files: claudeSubRows.length,
        bytes: claudeSubRows.reduce((a, r) => a + r.sizeBytes, 0),
      },
    ];

    const result: InventoryResult = {
      rows: displayed,
      totalFiles: rows.length,
      totalBytes,
      byHarness,
      displayLimit: DISPLAY_LIMIT,
      windowDays: SCAN_WINDOW_DAYS,
      durationMs: Date.now() - start,
      scannedAt: start,
      cached: false,
    };

    cache = { at: now, result };
    return result;
  } catch (err) {
    return {
      rows: [],
      totalFiles: 0,
      totalBytes: 0,
      byHarness: [],
      displayLimit: DISPLAY_LIMIT,
      windowDays: SCAN_WINDOW_DAYS,
      durationMs: Date.now() - start,
      scannedAt: start,
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function walkJsonl(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await recurse(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  }
  await recurse(root);
  return out;
}

async function safeStat(file: string) {
  try {
    return await fs.stat(file);
  } catch {
    return undefined;
  }
}

async function countLines(file: string): Promise<number> {
  let fh;
  try {
    fh = await fs.open(file, "r");
    const buf = Buffer.alloc(64 * 1024);
    let lines = 0;
    let last = -1;
    while (true) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0x0a) lines++;
        last = buf[i]!;
      }
    }
    if (last !== -1 && last !== 0x0a) lines++;
    return lines;
  } catch {
    return 0;
  } finally {
    await fh?.close();
  }
}

function shrinkPath(file: string): string {
  return file.startsWith(HOME) ? "~" + file.slice(HOME.length) : file;
}

function shortSessionId(file: string): string {
  const base = path.basename(file, ".jsonl");
  // Codex rollouts look like "rollout-2026-05-29T19-06-57-019e75fd-..."; trim
  // the rollout prefix + timestamp so the id reads as just the uuid-ish tail.
  const stripped = base.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
  return stripped.length > 28 ? stripped.slice(0, 8) + "…" + stripped.slice(-6) : stripped;
}

function formatMtime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
