import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir, tmpdir } from "node:os";
import type { Command } from "@/lib/studio/command";
import {
  parseSessionCommand,
  type NormalizedRecord,
  type ParseSessionResult,
} from "@/lib/studio/commands/parse-session";

export interface ExtractQmdInput {
  /** Absolute path to the source JSONL session. */
  path: string;
  /** Stable session id used for the output directory name. */
  sessionId: string;
  /** Cap on records parsed/extracted. Avoids loading huge sessions. */
  recordLimit?: number;
}

export interface ExtractedFile {
  name: string;
  path: string;
  bytes: number;
}

export interface ExtractQmdResult {
  outDir: string;
  files: ExtractedFile[];
  recordsScanned: number;
  mechanicalMs: number;
  parseResult: ParseSessionResult;
  error?: string;
}

const ROOT = path.join(tmpdir(), "scout-study", "qmd");
const WINDOW = 350;
const DEFAULT_LIMIT = 1500;

export const extractQmdCommand: Command<ExtractQmdInput, ExtractQmdResult> = {
  id: "extract-qmd",
  label: "Extract QMD (mechanical)",
  shell: ({ path: p, sessionId }) =>
    [
      `scout qmd extract`,
      `--source ${shellQuote(shrinkPath(p))}`,
      `--out ${shellQuote(shrinkPath(path.join(ROOT, sessionId)))}`,
      `--mechanical-only`,
    ].join(" "),
  run: async ({ path: filePath, sessionId, recordLimit }) => {
    const limit = recordLimit ?? DEFAULT_LIMIT;

    const parseRun = await parseSessionCommand.run({ path: filePath, limit });

    if (parseRun.error) {
      return emptyResult({ outDir: outDirFor(sessionId), parseRun, error: parseRun.error });
    }

    const outDir = outDirFor(sessionId);
    await fs.mkdir(outDir, { recursive: true });

    const mechStart = Date.now();
    const mechanical = await writeMechanical(outDir, parseRun, filePath);
    const mechanicalMs = Date.now() - mechStart;

    return {
      outDir,
      files: mechanical.sort((a, b) => a.name.localeCompare(b.name)),
      recordsScanned: parseRun.records.length,
      mechanicalMs,
      parseResult: parseRun,
    };
  },
  cacheKey: ({ path: p, sessionId, recordLimit }) =>
    `${sessionId}::${p}::${recordLimit ?? DEFAULT_LIMIT}`,
  // Mechanical is cheap; short cache is fine.
  cacheTtlMs: 5 * 60 * 1000,
};

function outDirFor(sessionId: string): string {
  return path.join(ROOT, sessionId);
}

function emptyResult({
  outDir,
  parseRun,
  error,
}: {
  outDir: string;
  parseRun: ParseSessionResult;
  error: string;
}): ExtractQmdResult {
  return {
    outDir,
    files: [],
    recordsScanned: 0,
    mechanicalMs: 0,
    llmMs: 0,
    parseResult: parseRun,
    error,
  };
}

// ── Mechanical pass ───────────────────────────────────────────────────────

async function writeMechanical(
  outDir: string,
  parseRun: ParseSessionResult,
  sourcePath: string,
): Promise<ExtractedFile[]> {
  const files: ExtractedFile[] = [];
  files.push(await writeFile(outDir, "manifest.json", buildManifest(parseRun, sourcePath)));
  files.push(await writeFile(outDir, "files.md", buildFilesMd(parseRun)));
  files.push(await writeFile(outDir, "tool-calls.md", buildToolCallsMd(parseRun)));
  const windows = buildEventWindows(parseRun.records);
  for (let i = 0; i < windows.length; i++) {
    const idx = String(i + 1).padStart(3, "0");
    files.push(await writeFile(outDir, `events-${idx}.md`, windows[i]!));
  }
  return files;
}

function buildManifest(parseRun: ParseSessionResult, sourcePath: string): string {
  return JSON.stringify(
    {
      source: sourcePath,
      harness: parseRun.harness,
      recordsScanned: parseRun.records.length,
      bytesRead: parseRun.bytesRead,
      window: WINDOW,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

function buildFilesMd(parseRun: ParseSessionResult): string {
  // Pull paths out of tool call arguments. Cheap heuristics over the union of
  // tool input shapes (Codex function_call.arguments is a JSON string of
  // {path, file_path, cwd, command}; Claude tool_use.input has {path,
  // file_path, command, ...}).
  const counts = new Map<string, number>();
  const tools = new Map<string, Set<string>>();
  for (const r of parseRun.records) {
    if (r.kind !== "command_or_tool" || !r.tool) continue;
    const paths = extractPaths(r.tool.input);
    for (const p of paths) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
      const set = tools.get(p) ?? new Set();
      set.add(r.tool.name);
      tools.set(p, set);
    }
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const lines: string[] = [
    "# Files touched",
    "",
    `Source records scanned: ${parseRun.records.length}.`,
    `Distinct file paths: ${rows.length}.`,
    "",
    "| path | hits | tools |",
    "| --- | ---: | --- |",
  ];
  for (const [p, hits] of rows) {
    const toolList = [...(tools.get(p) ?? [])].sort().join(", ");
    lines.push(`| \`${p}\` | ${hits} | ${toolList} |`);
  }
  if (rows.length === 0) lines.push("| _no paths detected_ | 0 | — |");
  return lines.join("\n") + "\n";
}

function buildToolCallsMd(parseRun: ParseSessionResult): string {
  const calls = parseRun.records.filter((r) => r.kind === "command_or_tool" && r.tool);
  const byName = new Map<string, number>();
  for (const c of calls) {
    const name = c.tool!.name;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  const lines: string[] = [
    "# Tool calls",
    "",
    `Total calls: ${calls.length}.`,
    "",
    "## By tool",
    "",
    "| tool | calls |",
    "| --- | ---: |",
  ];
  for (const [name, n] of [...byName.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${name}\` | ${n} |`);
  }
  lines.push("", "## Sample (first 30)", "");
  for (const c of calls.slice(0, 30)) {
    const input = oneLineInput(c.tool!.input);
    lines.push(`- [\`${String(c.i).padStart(4, "0")}\`] \`${c.tool!.name}\` ${input}`);
  }
  return lines.join("\n") + "\n";
}

function buildEventWindows(records: NormalizedRecord[]): string[] {
  const windows: string[] = [];
  for (let start = 0; start < records.length; start += WINDOW) {
    const slice = records.slice(start, start + WINDOW);
    const idx = Math.floor(start / WINDOW) + 1;
    const lines: string[] = [
      `# Events window ${idx}`,
      "",
      `Records [${slice[0]?.i ?? "?"}..${slice[slice.length - 1]?.i ?? "?"}], source-ordered.`,
      "",
    ];
    for (const r of slice) {
      const idxStr = String(r.i).padStart(4, "0");
      const detail = summarize(r);
      lines.push(`- [${idxStr}] \`${r.kind}\` (${r.tag ?? r.sourceType}) — ${detail}`);
    }
    windows.push(lines.join("\n") + "\n");
  }
  return windows;
}

function extractPaths(input: unknown): string[] {
  if (input == null) return [];
  // Codex serializes arguments as a JSON string sometimes.
  if (typeof input === "string") {
    try {
      return extractPaths(JSON.parse(input));
    } catch {
      return [];
    }
  }
  if (typeof input !== "object") return [];
  const obj = input as Record<string, unknown>;
  const paths = new Set<string>();
  for (const k of ["path", "file_path", "filePath", "filename", "filenames"]) {
    const v = obj[k];
    if (typeof v === "string") paths.add(v);
    if (Array.isArray(v)) for (const x of v) if (typeof x === "string") paths.add(x);
  }
  // Bash-ish: try to pluck likely-path tokens out of `command` / `cmd`.
  const cmd = obj.command ?? obj.cmd;
  if (typeof cmd === "string") {
    const matches = cmd.match(/(?:\.\/|\.\.\/|~\/|\/)[\w./~_\-+]+\.[\w]+/g);
    if (matches) for (const m of matches) paths.add(m);
  }
  return [...paths];
}

function oneLineInput(input: unknown): string {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? {});
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 100 ? trimmed.slice(0, 97) + "…" : trimmed;
}

function summarize(r: NormalizedRecord): string {
  if (r.text) return trim(r.text, 120);
  if (r.tool) return `name=${r.tool.name} input=${oneLineInput(r.tool.input)}`;
  if (r.result) {
    const out =
      typeof r.result.output === "string" ? r.result.output : JSON.stringify(r.result.output ?? "");
    return trim(out, 120);
  }
  if (r.meta) return trim(JSON.stringify(r.meta), 120);
  return "";
}

function trim(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + "…" : oneLine;
}

// ── File writer ───────────────────────────────────────────────────────────

async function writeFile(
  outDir: string,
  name: string,
  content: string,
): Promise<ExtractedFile> {
  const fullPath = path.join(outDir, name);
  await fs.writeFile(fullPath, content);
  const stat = await fs.stat(fullPath);
  return { name, path: fullPath, bytes: stat.size };
}

// ── Display helpers ───────────────────────────────────────────────────────

function shrinkPath(file: string): string {
  const home = homedir();
  return file.startsWith(home) ? "~" + file.slice(home.length) : file;
}

function shellQuote(s: string): string {
  return /[^A-Za-z0-9_./~-]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s;
}
