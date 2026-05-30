import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir, tmpdir } from "node:os";
import type { Command } from "@/lib/studio/command";
import {
  parseSessionCommand,
  type NormalizedRecord,
  type ParseSessionResult,
} from "@/lib/studio/commands/parse-session";
import { callMinimax, type MinimaxUsage } from "@/lib/llm/minimax";

export interface ExtractQmdInput {
  /** Absolute path to the source JSONL session. */
  path: string;
  /** Stable session id used for the output directory name. */
  sessionId: string;
  /** Cap on records parsed/extracted. Avoids loading huge sessions. */
  recordLimit?: number;
  /** Whether to run the LLM pass for overview.md / decisions.md. */
  withLlm?: boolean;
}

export interface ExtractedFile {
  name: string;
  path: string;
  bytes: number;
  kind: "mechanical" | "llm";
}

export interface ExtractQmdResult {
  outDir: string;
  files: ExtractedFile[];
  recordsScanned: number;
  mechanicalMs: number;
  llmMs: number;
  llm?: {
    model: string;
    usage: MinimaxUsage;
    finishReason: string;
    reasoning: string;
  };
  parseResult: ParseSessionResult;
  error?: string;
}

const ROOT = path.join(tmpdir(), "scout-study", "qmd");
const WINDOW = 350;
const DEFAULT_LIMIT = 1500;

export const extractQmdCommand: Command<ExtractQmdInput, ExtractQmdResult> = {
  id: "extract-qmd",
  label: "Extract QMD",
  shell: ({ path: p, sessionId, withLlm }) =>
    [
      `scout qmd extract`,
      `--source ${shellQuote(shrinkPath(p))}`,
      `--out ${shellQuote(shrinkPath(path.join(ROOT, sessionId)))}`,
      withLlm === false ? "--no-llm" : "",
    ]
      .filter(Boolean)
      .join(" "),
  run: async ({ path: filePath, sessionId, recordLimit, withLlm = true }) => {
    const limit = recordLimit ?? DEFAULT_LIMIT;

    // Reuse the existing parser command at a higher limit. It has its own
    // 60s cache, so this is cheap on re-renders against the same input.
    const parseRun = await parseSessionCommand.run({ path: filePath, limit });

    if (parseRun.error) {
      return emptyResult({ outDir: outDirFor(sessionId), parseRun, error: parseRun.error });
    }

    const outDir = outDirFor(sessionId);
    await fs.mkdir(outDir, { recursive: true });

    const mechStart = Date.now();
    const mechanical = await writeMechanical(outDir, parseRun, filePath);
    const mechanicalMs = Date.now() - mechStart;

    let llmFiles: ExtractedFile[] = [];
    let llmInfo: ExtractQmdResult["llm"] | undefined;
    let llmMs = 0;
    if (withLlm) {
      const t = Date.now();
      try {
        const out = await writeLlm(outDir, parseRun);
        llmFiles = out.files;
        llmInfo = out.info;
      } catch (err) {
        // Don't abort the whole extraction on LLM failure — keep mechanical
        // and report the LLM error inline.
        llmInfo = undefined;
        const errMsg = err instanceof Error ? err.message : String(err);
        await fs.writeFile(path.join(outDir, "_llm-error.txt"), errMsg);
      }
      llmMs = Date.now() - t;
    }

    return {
      outDir,
      files: [...mechanical, ...llmFiles].sort((a, b) => a.name.localeCompare(b.name)),
      recordsScanned: parseRun.records.length,
      mechanicalMs,
      llmMs,
      llm: llmInfo,
      parseResult: parseRun,
    };
  },
  cacheKey: ({ path: p, sessionId, recordLimit, withLlm }) =>
    `${sessionId}::${p}::${recordLimit ?? DEFAULT_LIMIT}::${withLlm === false ? "0" : "1"}`,
  // Cache for an hour. LLM calls are expensive and the inputs don't change
  // between page reloads.
  cacheTtlMs: 60 * 60 * 1000,
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
  files.push(await writeFile(outDir, "manifest.json", buildManifest(parseRun, sourcePath), "mechanical"));
  files.push(await writeFile(outDir, "files.md", buildFilesMd(parseRun), "mechanical"));
  files.push(await writeFile(outDir, "tool-calls.md", buildToolCallsMd(parseRun), "mechanical"));
  const windows = buildEventWindows(parseRun.records);
  for (let i = 0; i < windows.length; i++) {
    const idx = String(i + 1).padStart(3, "0");
    files.push(await writeFile(outDir, `events-${idx}.md`, windows[i]!, "mechanical"));
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

// ── LLM pass ──────────────────────────────────────────────────────────────

async function writeLlm(
  outDir: string,
  parseRun: ParseSessionResult,
): Promise<{ files: ExtractedFile[]; info: NonNullable<ExtractQmdResult["llm"]> }> {
  const condensed = condenseForLlm(parseRun.records);
  const system = [
    "You are a careful technical analyst reading a transcript of a coding-agent session.",
    "Your job is to produce two short markdown documents about the session.",
    "Be specific and concrete; cite paths, commands, or file types when relevant.",
    "Never invent details that aren't in the transcript.",
  ].join(" ");
  const user = [
    "Below is a condensed transcript of a coding-agent session. Each line is one",
    "normalized event, prefixed with [NNNN] kind (tag) — detail.",
    "",
    "Produce exactly two top-level markdown sections, in this order:",
    "",
    "# Overview",
    "",
    "Two short paragraphs describing what this session was about: the user's goal,",
    "the area of the codebase touched, and what the agent ended up doing.",
    "",
    "# Decisions",
    "",
    "A bulleted list of concrete decisions made or unresolved questions. Each bullet",
    "should reference a specific event or file when possible. Include a final",
    '"## Follow-ups" subsection if there are loose threads.',
    "",
    "Transcript:",
    "```",
    condensed,
    "```",
  ].join("\n");

  const result = await callMinimax({ system, user, maxTokens: 4000, temperature: 0.2 });
  const content = result.content || "";
  const { overview, decisions } = splitOverviewDecisions(content);

  const files: ExtractedFile[] = [];
  files.push(await writeFile(outDir, "overview.md", overview, "llm"));
  files.push(await writeFile(outDir, "decisions.md", decisions, "llm"));
  files.push(
    await writeFile(
      outDir,
      "_llm-call.json",
      JSON.stringify(
        {
          model: result.model,
          usage: result.usage,
          finishReason: result.finishReason,
          latencyMs: result.latencyMs,
          promptChars: user.length,
        },
        null,
        2,
      ),
      "llm",
    ),
  );

  return {
    files,
    info: {
      model: result.model,
      usage: result.usage,
      finishReason: result.finishReason,
      reasoning: result.reasoning,
    },
  };
}

/**
 * Pick a smaller representative slice of the normalized stream to feed the LLM.
 * Strategy: keep all user turns, the first assistant turn after each user turn,
 * tool names + short args, and short observations. Aggressive trim per line.
 */
function condenseForLlm(records: NormalizedRecord[]): string {
  const lines: string[] = [];
  for (const r of records) {
    const idx = String(r.i).padStart(4, "0");
    if (r.kind === "user_turn") {
      lines.push(`[${idx}] user — ${trim(r.text ?? "", 240)}`);
    } else if (r.kind === "assistant_turn") {
      lines.push(`[${idx}] assistant (${r.tag ?? ""}) — ${trim(r.text ?? "", 200)}`);
    } else if (r.kind === "command_or_tool" && r.tool) {
      lines.push(`[${idx}] tool ${r.tool.name} ${oneLineInput(r.tool.input)}`);
    } else if (r.kind === "observation" && r.result) {
      const out =
        typeof r.result.output === "string" ? r.result.output : JSON.stringify(r.result.output ?? "");
      lines.push(`[${idx}] result — ${trim(out, 140)}`);
    } else if (r.kind === "session_meta") {
      const model = r.meta?.model_provider ?? r.meta?.model ?? "?";
      const cwd = r.meta?.cwd ?? "?";
      lines.push(`[${idx}] meta model=${model} cwd=${trim(String(cwd), 80)}`);
    }
    // Skip system_record / unknown — usually noise.
  }
  // Cap total length to keep token budget reasonable.
  const joined = lines.join("\n");
  const cap = 24_000; // ~6k tokens at 4 chars/token
  return joined.length > cap ? joined.slice(0, cap) + "\n… (transcript truncated)" : joined;
}

function splitOverviewDecisions(content: string): {
  overview: string;
  decisions: string;
} {
  const decisionsIdx = content.indexOf("# Decisions");
  if (decisionsIdx === -1) {
    return { overview: content.trim(), decisions: "# Decisions\n\n_not produced_\n" };
  }
  const overview = content.slice(0, decisionsIdx).trim();
  const decisions = content.slice(decisionsIdx).trim();
  return { overview, decisions };
}

// ── File writer ───────────────────────────────────────────────────────────

async function writeFile(
  outDir: string,
  name: string,
  content: string,
  kind: ExtractedFile["kind"],
): Promise<ExtractedFile> {
  const fullPath = path.join(outDir, name);
  await fs.writeFile(fullPath, content);
  const stat = await fs.stat(fullPath);
  return { name, path: fullPath, bytes: stat.size, kind };
}

// ── Display helpers ───────────────────────────────────────────────────────

function shrinkPath(file: string): string {
  const home = homedir();
  return file.startsWith(home) ? "~" + file.slice(home.length) : file;
}

function shellQuote(s: string): string {
  return /[^A-Za-z0-9_./~-]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s;
}
