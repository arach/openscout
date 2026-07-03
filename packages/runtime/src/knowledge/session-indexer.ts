import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";

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

export interface IndexRecentSessionKnowledgeInput {
  days?: number;
  limit?: number;
  force?: boolean;
}

export interface IndexedSessionKnowledgeSummary {
  collectionId: string;
  title: string;
  harness: string;
  project: string;
  transcriptPath: string;
  qmdPath: string;
  records: number;
  documents: number;
  chunks: number;
  bytes: number;
  mtimeMs: number;
  skipped?: boolean;
  error?: string;
}

export interface IndexRecentSessionKnowledgeResult {
  job: KnowledgeIndexJob;
  days: number;
  discovered: number;
  indexed: number;
  failed: number;
  sessions: IndexedSessionKnowledgeSummary[];
}

type Harness = "codex" | "claude";

type SessionFile = {
  harness: Harness;
  path: string;
  mtimeMs: number;
  size: number;
};

type NormalizedKind =
  | "session_meta"
  | "user_turn"
  | "assistant_turn"
  | "command_or_tool"
  | "observation"
  | "system_record"
  | "unknown";

type NormalizedRecord = {
  i: number;
  ts?: string;
  kind: NormalizedKind;
  tag?: string;
  text?: string;
  tool?: { name: string; input: unknown };
  result?: { ok?: boolean; output: unknown };
  meta?: Record<string, unknown>;
  refs?: { id?: string; parentId?: string; sessionId?: string };
  sourceType: string;
  sourceOffset: number;
};

type ParseResult = {
  harness: Harness;
  records: NormalizedRecord[];
  scannedLines: number;
  bytesRead: number;
  contentHash: string;
  cwd: string | null;
  sessionId: string | null;
};

type ExtractedDocument = {
  path: string;
  kind: string;
  content: string;
  sourceRef: KnowledgeSourceRef;
  facets?: KnowledgeFacets;
};

const EXTRACTOR_VERSION = "session-qmd-v2";
const CHUNK_POLICY_VERSION = "session-qmd-record-window-v1";
const EVENT_WINDOW_RECORDS = 350;
const EVENT_CHUNK_RECORDS = 50;
const DEFAULT_DAYS = 3;
const DEFAULT_LIMIT = 220;

function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.floor(value));
}

function sessionRoots(): Array<{ harness: Harness; root: string }> {
  const home = homedir();
  const roots: Array<{ harness: Harness; root: string }> = [
    { harness: "codex", root: process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT ?? join(home, ".codex", "sessions") },
    { harness: "codex", root: join(home, ".openai-codex", "sessions") },
    { harness: "claude", root: process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT ?? join(home, ".claude", "projects") },
  ];
  return roots.filter((entry, index, entries) =>
    existsSync(entry.root)
    && entries.findIndex((candidate) => candidate.harness === entry.harness && candidate.root === entry.root) === index
  );
}

function discoverRecentSessionFiles(days: number, limit: number): SessionFile[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files: SessionFile[] = [];
  for (const { harness, root } of sessionRoots()) {
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = join(dir, entry);
        let stats;
        try {
          stats = statSync(path);
        } catch {
          continue;
        }
        if (stats.isDirectory()) {
          stack.push(path);
          continue;
        }
        if (!entry.endsWith(".jsonl") || stats.mtimeMs < cutoff) continue;
        files.push({ harness, path, mtimeMs: stats.mtimeMs, size: stats.size });
      }
    }
  }
  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit);
}

async function parseJsonl(file: SessionFile): Promise<ParseResult> {
  const records: NormalizedRecord[] = [];
  const hash = createHash("sha256");
  let carry = "";
  let offset = 0;
  let index = 0;
  let cwd: string | null = null;
  let sessionId: string | null = null;

  const handleLine = (rawLine: string) => {
    const lineOffset = offset;
    offset += Buffer.byteLength(rawLine, "utf8") + 1;
    if (!rawLine.trim()) return;
    try {
      const value = JSON.parse(rawLine) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        records.push({
          i: index++,
          kind: "unknown",
          sourceType: "non_object",
          sourceOffset: lineOffset,
        });
        return;
      }
      const record = normalizeRecord(value as Record<string, unknown>, index, lineOffset, file.harness);
      records.push(record);
      cwd ??= inferCwd(record);
      sessionId ??= inferSessionId(record, file);
      index++;
    } catch {
      records.push({
        i: index++,
        kind: "unknown",
        sourceType: "unparseable",
        sourceOffset: lineOffset,
      });
    }
  };

  for await (const chunk of createReadStream(file.path, { encoding: "utf8" })) {
    hash.update(chunk);
    carry += chunk;
    const lines = carry.split(/\r?\n/u);
    carry = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (carry.length > 0) handleLine(carry);

  return {
    harness: file.harness,
    records,
    scannedLines: records.length,
    bytesRead: offset,
    contentHash: `sha256:${hash.digest("hex")}`,
    cwd,
    sessionId,
  };
}

function normalizeRecord(
  obj: Record<string, unknown>,
  i: number,
  sourceOffset: number,
  harness: Harness,
): NormalizedRecord {
  return harness === "codex"
    ? normalizeCodex(obj, i, sourceOffset)
    : normalizeClaude(obj, i, sourceOffset);
}

function normalizeCodex(
  obj: Record<string, unknown>,
  i: number,
  sourceOffset: number,
): NormalizedRecord {
  const type = String(obj.type ?? "");
  const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
  const payload = recordValue(obj.payload) ?? {};
  const base = { i, ts, sourceType: type, sourceOffset };

  if (type === "session_meta") {
    return {
      ...base,
      kind: "session_meta",
      tag: "meta",
      meta: payload,
      refs: { sessionId: stringValue(payload.id) },
    };
  }
  if (type === "turn_context") {
    return { ...base, kind: "system_record", tag: "turn_context", meta: payload };
  }
  if (type === "response_item") return normalizeCodexInner(payload, base);
  if (type === "event_msg") return normalizeCodexEvent(payload, base);
  if (type === "message") return normalizeCodexMessage(payload, base);
  if (type === "function_call" || type === "local_shell_call") return normalizeCodexTool(payload, base);
  if (type === "function_call_output" || type === "local_shell_call_output") return normalizeCodexResult(payload, base);
  if (type === "reasoning") return normalizeCodexReasoning(payload, base);
  return { ...base, kind: "system_record", tag: type || "record", text: compactJson(payload) };
}

type CodexBase = { i: number; ts?: string; sourceType: string; sourceOffset: number };

function normalizeCodexInner(payload: Record<string, unknown>, base: CodexBase): NormalizedRecord {
  const type = String(payload.type ?? "");
  if (type === "message") return normalizeCodexMessage(payload, base);
  if (type === "reasoning") return normalizeCodexReasoning(payload, base);
  if (type === "function_call" || type === "local_shell_call") return normalizeCodexTool(payload, base);
  if (type === "function_call_output" || type === "local_shell_call_output") return normalizeCodexResult(payload, base);
  return { ...base, kind: "system_record", tag: type || "response_item", meta: payload };
}

function normalizeCodexEvent(payload: Record<string, unknown>, base: CodexBase): NormalizedRecord {
  const type = String(payload.type ?? "");
  if (type === "user_message") {
    return { ...base, kind: "user_turn", tag: "user", text: String(payload.message ?? payload.text ?? "") };
  }
  if (type === "agent_message") {
    return { ...base, kind: "assistant_turn", tag: "assistant", text: String(payload.message ?? payload.text ?? "") };
  }
  return { ...base, kind: "system_record", tag: type || "event_msg", meta: payload };
}

function normalizeCodexMessage(payload: Record<string, unknown>, base: CodexBase): NormalizedRecord {
  const role = String(payload.role ?? "");
  const text = extractText(payload.content);
  if (role === "user") return { ...base, kind: "user_turn", tag: "user", text };
  if (role === "assistant") return { ...base, kind: "assistant_turn", tag: "assistant", text };
  return { ...base, kind: "system_record", tag: role || "message", text };
}

function normalizeCodexTool(payload: Record<string, unknown>, base: CodexBase): NormalizedRecord {
  const name = String(payload.name ?? payload.command ?? "tool");
  const input = payload.arguments ?? payload.args ?? payload.input ?? {};
  return { ...base, kind: "command_or_tool", tag: name, tool: { name, input } };
}

function normalizeCodexResult(payload: Record<string, unknown>, base: CodexBase): NormalizedRecord {
  return { ...base, kind: "observation", tag: "result", result: { output: payload.output ?? payload.content ?? "" } };
}

function normalizeCodexReasoning(payload: Record<string, unknown>, base: CodexBase): NormalizedRecord {
  let text = "";
  if (Array.isArray(payload.summary)) {
    text = payload.summary
      .map((entry) => recordValue(entry)?.text)
      .filter((entry): entry is string => typeof entry === "string")
      .join(" ");
  }
  return { ...base, kind: "assistant_turn", tag: "reasoning", text: text || stringValue(payload.content) || "" };
}

function normalizeClaude(
  obj: Record<string, unknown>,
  i: number,
  sourceOffset: number,
): NormalizedRecord {
  const type = String(obj.type ?? "");
  const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
  const refs = {
    id: stringValue(obj.uuid),
    parentId: stringValue(obj.parentUuid),
    sessionId: stringValue(obj.sessionId) ?? stringValue(obj.session_id),
  };
  const base = { i, ts, sourceType: type, sourceOffset, refs };

  if (type === "user") {
    const message = recordValue(obj.message);
    return { ...base, kind: "user_turn", tag: "user", text: extractText(message?.content ?? obj.content) };
  }
  if (type === "assistant") {
    const message = recordValue(obj.message);
    const content = message?.content ?? obj.content;
    const tool = Array.isArray(content)
      ? content.map(recordValue).find((entry) => entry?.type === "tool_use")
      : null;
    if (tool) {
      const name = String(tool.name ?? "tool");
      return {
        ...base,
        kind: "command_or_tool",
        tag: name,
        sourceType: "tool_use",
        tool: { name, input: tool.input ?? {} },
      };
    }
    return { ...base, kind: "assistant_turn", tag: "assistant", text: extractText(content) };
  }
  if (type === "tool_use") {
    const name = String(obj.name ?? "tool");
    return { ...base, kind: "command_or_tool", tag: name, tool: { name, input: obj.input ?? {} } };
  }
  if (type === "tool_result") {
    return { ...base, kind: "observation", tag: "result", result: { output: obj.content ?? "" } };
  }
  if (type === "system") {
    return { ...base, kind: "system_record", tag: "system", text: extractText(obj.content) };
  }
  return { ...base, kind: "system_record", tag: type || "record", meta: obj };
}

function inferCwd(record: NormalizedRecord): string | null {
  const meta = record.meta;
  const cwd = stringValue(meta?.cwd);
  return cwd && cwd.trim() ? cwd : null;
}

function inferSessionId(record: NormalizedRecord, file: SessionFile): string | null {
  return record.refs?.sessionId
    ?? stringValue(record.meta?.id)
    ?? stringValue(record.meta?.sessionId)
    ?? basename(file.path).replace(/\.jsonl$/u, "");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const block = recordValue(entry);
      if (!block) return "";
      if (typeof block.text === "string") return block.text;
      if (typeof block.content === "string") return block.content;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function trimOneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 3))}...`;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableId(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function portablePath(filePath: string): KnowledgePortablePath {
  const home = homedir();
  const paths = resolveOpenScoutKnowledgePaths();
  const roots: Array<{ root: KnowledgePortablePath["root"]; path: string }> = [
    { root: "OPENSCOUT_CONTROL_HOME", path: paths.knowledgeRoot.replace(new RegExp(`${sep}knowledge$`), "") },
    { root: "HOME", path: home },
  ];
  for (const root of roots) {
    const rel = relative(root.path, filePath);
    if (rel && !rel.startsWith("..") && !rel.startsWith(sep)) {
      return { root: root.root, relPath: rel };
    }
  }
  return { root: "ABSOLUTE", relPath: filePath };
}

function sourceRefFor(file: SessionFile, parse: ParseResult, range?: [number, number]): KnowledgeSourceRef {
  return {
    kind: "harness_transcript",
    harness: file.harness,
    path: portablePath(file.path),
    sessionId: parse.sessionId ?? undefined,
    recordRange: range,
    anchor: {
      sizeBytes: file.size,
      mtimeMs: file.mtimeMs,
      contentHash: parse.contentHash,
    },
  };
}

function sourceRefWithRecordRange(ref: KnowledgeSourceRef, range: [number, number]): KnowledgeSourceRef {
  return ref.kind === "harness_transcript" ? { ...ref, recordRange: range } : ref;
}

function projectName(cwd: string | null, filePath: string): string {
  if (cwd) return basename(cwd);
  const claudeProjectMatch = /\/\.claude\/projects\/([^/]+)/u.exec(filePath);
  if (claudeProjectMatch?.[1]) return claudeProjectMatch[1].replace(/^-/, "").replace(/-/g, "/").split("/").pop() || "claude";
  return basename(filePath).replace(/\.jsonl$/u, "");
}

function titleFor(file: SessionFile, parse: ParseResult, project: string): string {
  const firstUser = parse.records.find((record) => record.kind === "user_turn" && record.text?.trim());
  const date = new Date(file.mtimeMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const goal = firstUser?.text ? ` - ${trimOneLine(firstUser.text, 82)}` : "";
  return `${capitalize(file.harness)} ${project} ${date}${goal}`;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function extractPaths(input: unknown): string[] {
  if (input == null) return [];
  if (typeof input === "string") {
    try {
      return extractPaths(JSON.parse(input));
    } catch {
      const matches = input.match(/(?:\.\/|\.\.\/|~\/|\/)[\w./~_\-+]+\.[\w]+/gu);
      return matches ?? [];
    }
  }
  if (typeof input !== "object" || Array.isArray(input)) return [];
  const obj = input as Record<string, unknown>;
  const paths = new Set<string>();
  for (const key of ["path", "file_path", "filePath", "filename", "filenames"]) {
    const value = obj[key];
    if (typeof value === "string") paths.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === "string") paths.add(entry);
    }
  }
  const command = obj.command ?? obj.cmd;
  if (typeof command === "string") {
    const matches = command.match(/(?:\.\/|\.\.\/|~\/|\/)[\w./~_\-+]+\.[\w]+/gu);
    if (matches) for (const match of matches) paths.add(match);
  }
  return [...paths];
}

function oneLineInput(input: unknown): string {
  const text = typeof input === "string" ? input : compactJson(input ?? {});
  return trimOneLine(text, 120);
}

function uniqueFacetValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result.slice(0, 100);
}

function touchedPaths(records: NormalizedRecord[]): string[] {
  return uniqueFacetValues(records.flatMap((record) =>
    record.tool ? extractPaths(record.tool.input) : []
  ));
}

function recordFacets(records: NormalizedRecord[]): KnowledgeFacets {
  const facets: KnowledgeFacets = {};
  const kinds = uniqueFacetValues(records.map((record) => record.kind));
  const tags = uniqueFacetValues(records.map((record) => record.tag));
  const tools = uniqueFacetValues(records.map((record) => record.tool?.name));
  const paths = touchedPaths(records);

  if (kinds.length > 0) facets.recordKind = kinds;
  if (tags.length > 0) facets.recordTag = tags;
  if (tools.length > 0) facets.toolName = tools;
  if (paths.length > 0) facets.touchedPath = paths;
  return facets;
}

function documentFacets(kind: string, records: NormalizedRecord[]): KnowledgeFacets {
  return {
    documentKind: kind,
    ...recordFacets(records),
  };
}

function summarizeRecord(record: NormalizedRecord): string {
  if (record.text) return trimOneLine(record.text, 180);
  if (record.tool) return `name=${record.tool.name} input=${oneLineInput(record.tool.input)}`;
  if (record.result) {
    const output = typeof record.result.output === "string"
      ? record.result.output
      : compactJson(record.result.output ?? "");
    return trimOneLine(output, 180);
  }
  if (record.meta) return trimOneLine(compactJson(record.meta), 180);
  return "";
}

function buildOverview(parse: ParseResult, file: SessionFile, project: string, title: string): string {
  const userTurns = parse.records.filter((record) => record.kind === "user_turn" && record.text?.trim());
  const assistantTurns = parse.records.filter((record) => record.kind === "assistant_turn" && record.text?.trim());
  const tools = parse.records.filter((record) => record.kind === "command_or_tool");
  const firstUser = userTurns[0]?.text ? trimOneLine(userTurns[0].text, 700) : "No user turn text detected.";
  const latestAssistant = assistantTurns.at(-1)?.text ? trimOneLine(assistantTurns.at(-1)!.text!, 700) : "No assistant text detected.";
  const modified = new Date(file.mtimeMs).toISOString();
  return [
    `# ${title}`,
    "",
    `Source: ${file.harness} transcript ${file.path}`,
    `Project: ${project}`,
    `Modified: ${modified}`,
    "",
    "## Session Frame",
    "",
    firstUser,
    "",
    "## Latest Assistant Context",
    "",
    latestAssistant,
    "",
    "## Mechanical Summary",
    "",
    `- Records: ${parse.records.length}`,
    `- User turns: ${userTurns.length}`,
    `- Assistant turns: ${assistantTurns.length}`,
    `- Tool calls: ${tools.length}`,
    `- Raw size: ${file.size} bytes`,
    "",
  ].join("\n");
}

function buildFiles(parse: ParseResult): string {
  const counts = new Map<string, number>();
  const tools = new Map<string, Set<string>>();
  for (const record of parse.records) {
    if (record.kind !== "command_or_tool" || !record.tool) continue;
    for (const path of extractPaths(record.tool.input)) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
      const names = tools.get(path) ?? new Set<string>();
      names.add(record.tool.name);
      tools.set(path, names);
    }
  }
  const rows = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const lines = [
    "# Files touched",
    "",
    `Distinct paths: ${rows.length}.`,
    "",
    "| path | hits | tools |",
    "| --- | ---: | --- |",
  ];
  for (const [path, hits] of rows) {
    lines.push(`| \`${path}\` | ${hits} | ${[...(tools.get(path) ?? [])].sort().join(", ")} |`);
  }
  if (rows.length === 0) lines.push("| _no paths detected_ | 0 |  |");
  return `${lines.join("\n")}\n`;
}

function buildToolCalls(parse: ParseResult): string {
  const calls = parse.records.filter((record) => record.kind === "command_or_tool" && record.tool);
  const byName = new Map<string, number>();
  for (const call of calls) byName.set(call.tool!.name, (byName.get(call.tool!.name) ?? 0) + 1);
  const lines = [
    "# Tool calls",
    "",
    `Total calls: ${calls.length}.`,
    "",
    "## By tool",
    "",
    "| tool | calls |",
    "| --- | ---: |",
  ];
  for (const [name, count] of [...byName.entries()].sort((left, right) => right[1] - left[1])) {
    lines.push(`| \`${name}\` | ${count} |`);
  }
  lines.push("", "## Sample", "");
  for (const call of calls.slice(0, 80)) {
    lines.push(`- [${String(call.i).padStart(4, "0")}] \`${call.tool!.name}\` ${oneLineInput(call.tool!.input)}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildEventDocuments(parse: ParseResult, file: SessionFile): ExtractedDocument[] {
  const docs: ExtractedDocument[] = [];
  for (let start = 0; start < parse.records.length; start += EVENT_WINDOW_RECORDS) {
    const slice = parse.records.slice(start, start + EVENT_WINDOW_RECORDS);
    const index = String(Math.floor(start / EVENT_WINDOW_RECORDS) + 1).padStart(3, "0");
    const first = slice[0]?.i ?? start;
    const last = slice.at(-1)?.i ?? first;
    const sourceRef = sourceRefFor(file, parse, [first, last]);
    const lines = [
      `# Events window ${index}`,
      "",
      `Source: ${file.path}`,
      `Records: ${first}..${last}`,
      "",
    ];
    for (const record of slice) {
      lines.push(`- [${String(record.i).padStart(4, "0")}] \`${record.kind}\` (${record.tag ?? record.sourceType}) - ${summarizeRecord(record)}`);
    }
    docs.push({
      path: `events-${index}.md`,
      kind: "events",
      content: `${lines.join("\n")}\n`,
      sourceRef,
      facets: documentFacets("events", slice),
    });
  }
  return docs;
}

function buildDocuments(parse: ParseResult, file: SessionFile, project: string, title: string): ExtractedDocument[] {
  const allSourceRef = sourceRefFor(file, parse, parse.records.length > 0 ? [0, parse.records.at(-1)!.i] : undefined);
  const toolRecords = parse.records.filter((record) => record.kind === "command_or_tool");
  return [
    {
      path: "overview.md",
      kind: "overview",
      content: buildOverview(parse, file, project, title),
      sourceRef: allSourceRef,
      facets: documentFacets("overview", parse.records),
    },
    {
      path: "files.md",
      kind: "files",
      content: buildFiles(parse),
      sourceRef: allSourceRef,
      facets: {
        documentKind: "files",
        ...(touchedPaths(parse.records).length > 0 ? { touchedPath: touchedPaths(parse.records) } : {}),
      },
    },
    {
      path: "tool-calls.md",
      kind: "tool-calls",
      content: buildToolCalls(parse),
      sourceRef: allSourceRef,
      facets: documentFacets("tool-calls", toolRecords),
    },
    ...buildEventDocuments(parse, file),
  ];
}

function chunkDocument(document: ExtractedDocument): Array<{ text: string; sourceRef: KnowledgeSourceRef }> {
  if (document.kind !== "events") {
    return splitMarkdownSections(document.content).map((text) => ({ text, sourceRef: document.sourceRef }));
  }
  const lines = document.content.split("\n");
  const chunks: Array<{ text: string; sourceRef: KnowledgeSourceRef }> = [];
  let header: string[] = [];
  let current: { first: number; last: number; records: number; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (text) {
      chunks.push({
        text,
        sourceRef: sourceRefWithRecordRange(document.sourceRef, [current.first, current.last]),
      });
    }
    current = null;
  };
  for (const line of lines) {
    const match = /^- \[(\d+)\]/u.exec(line);
    if (!match) {
      if (current) current.lines.push(line);
      else if (line.trim()) header.push(line);
      continue;
    }
    const record = Number(match[1]);
    if (!current || current.records >= EVENT_CHUNK_RECORDS) {
      flush();
      current = {
        first: record,
        last: record,
        records: 1,
        lines: header.length > 0 ? [...header, "", line] : [line],
      };
      header = [];
    } else {
      current.last = record;
      current.records++;
      current.lines.push(line);
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [{ text: document.content, sourceRef: document.sourceRef }];
}

function splitMarkdownSections(content: string): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const text = current.join("\n").trim();
    if (text) chunks.push(text);
    current = [];
  };
  for (const line of lines) {
    if (line.startsWith("## ") && current.length > 0) flush();
    current.push(line);
  }
  flush();
  return chunks;
}

function writeQmdCollection(
  collection: KnowledgeCollection,
  documents: ExtractedDocument[],
  parse: ParseResult,
  file: SessionFile,
): void {
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
      kind: "harness_transcript",
      harness: file.harness,
      ref: portablePath(file.path),
      sessionId: parse.sessionId,
      sizeBytes: file.size,
      mtimeMs: file.mtimeMs,
      contentHash: parse.contentHash,
      recordsScanned: parse.records.length,
    },
    chunking: {
      events: {
        strategy: "record-window",
        window: EVENT_WINDOW_RECORDS,
        chunkRecords: EVENT_CHUNK_RECORDS,
        version: CHUNK_POLICY_VERSION,
      },
    },
    documents: documents.map((document) => ({
      path: document.path,
      kind: document.kind,
      origin: "mechanical",
      bytes: Buffer.byteLength(document.content, "utf8"),
      contentHash: hashText(document.content),
    })),
    facets: collection.facets,
    ownership: "derived",
    contentHash: collection.contentHash,
    status: collection.status,
  };

  writeFileSync(join(tmpDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const document of documents) {
    writeFileSync(join(tmpDir, document.path), document.content, "utf8");
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, ".."), { recursive: true });
  renameSync(tmpDir, outDir);
}

function collectionContentHash(file: SessionFile, parse: ParseResult): string {
  return hashText([
    EXTRACTOR_VERSION,
    CHUNK_POLICY_VERSION,
    file.harness,
    file.path,
    file.mtimeMs,
    file.size,
    parse.contentHash,
  ].join("\0"));
}

function collectionIdFor(file: SessionFile, parse: ParseResult): string {
  const sessionPart = parse.sessionId
    ? parse.sessionId.replace(/[^A-Za-z0-9_.-]+/gu, "-").slice(0, 80)
    : stableId(file.path);
  return `sessions/${file.harness}/${sessionPart}-${stableId(file.path, 10)}`;
}

function documentId(collectionId: string, path: string): string {
  return hashText(`${collectionId}\0${path}`);
}

function storeSessionCollection(
  store: SQLiteKnowledgeStore,
  file: SessionFile,
  parse: ParseResult,
  force: boolean,
): IndexedSessionKnowledgeSummary {
  const project = projectName(parse.cwd, file.path);
  const id = collectionIdFor(file, parse);
  const qmdPath = knowledgeCollectionQmdPath(id);
  const title = titleFor(file, parse, project);
  const sourceRef = sourceRefFor(file, parse, parse.records.length > 0 ? [0, parse.records.at(-1)!.i] : undefined);
  const facets: KnowledgeFacets = {
    harness: file.harness,
    project,
    source: "sessions",
    transcriptPath: file.path,
    sessionId: parse.sessionId ?? "",
  };
  const now = Date.now();
  const collection: KnowledgeCollection = {
    id,
    kind: "sessions",
    title,
    sourceRefs: [sourceRef],
    qmdPath,
    status: "ready",
    contentHash: collectionContentHash(file, parse),
    extractorVersion: EXTRACTOR_VERSION,
    chunkPolicyVersion: CHUNK_POLICY_VERSION,
    createdAt: now,
    updatedAt: now,
    facets,
  };
  const existing = store.getCollection(id);
  if (!force && existing?.contentHash === collection.contentHash) {
    return {
      collectionId: id,
      title,
      harness: file.harness,
      project,
      transcriptPath: file.path,
      qmdPath,
      records: parse.records.length,
      documents: 0,
      chunks: 0,
      bytes: file.size,
      mtimeMs: file.mtimeMs,
      skipped: true,
    };
  }

  const documents = buildDocuments(parse, file, project, title);
  writeQmdCollection(collection, documents, parse, file);

  store.deleteCollection(id);
  store.upsertCollection(collection);

  let chunks = 0;
  for (const extracted of documents) {
    const doc: KnowledgeDocument = {
      id: documentId(id, extracted.path),
      collectionId: id,
      path: extracted.path,
      kind: extracted.kind,
      origin: "mechanical",
      contentHash: hashText(extracted.content),
    };
    store.upsertDocument(doc);
    chunkDocument(extracted).forEach((chunk, ordinal) => {
      const chunkFacets: KnowledgeFacets = {
        ...facets,
        ...(extracted.facets ?? { documentKind: extracted.kind }),
      };
      const knowledgeChunk: KnowledgeChunk = {
        id: deterministicKnowledgeChunkId({
          collectionId: id,
          documentPath: extracted.path,
          ordinal,
          chunkPolicyVersion: CHUNK_POLICY_VERSION,
          text: chunk.text,
        }),
        collectionId: id,
        documentId: doc.id,
        documentPath: extracted.path,
        ordinal,
        text: chunk.text,
        textHash: hashText(chunk.text),
        origin: "mechanical",
        ownership: "derived",
        sourceRefs: [chunk.sourceRef],
        facets: chunkFacets,
      };
      store.upsertChunk(knowledgeChunk, `${title} / ${extracted.path}`);
      chunks++;
    });
  }

  return {
    collectionId: id,
    title,
    harness: file.harness,
    project,
    transcriptPath: file.path,
    qmdPath,
    records: parse.records.length,
    documents: documents.length,
    chunks,
    bytes: file.size,
    mtimeMs: file.mtimeMs,
  };
}

export async function indexRecentSessionKnowledge(
  input: IndexRecentSessionKnowledgeInput = {},
): Promise<IndexRecentSessionKnowledgeResult> {
  const days = clampPositiveInt(input.days, DEFAULT_DAYS, 30);
  const limit = clampPositiveInt(input.limit, DEFAULT_LIMIT, 1000);
  const store = new SQLiteKnowledgeStore();
  const job = store.createIndexJob({ source: "sessions", days, force: input.force, mode: "foreground" });
  const leaseGeneration = job.leaseGeneration + 1;
  const files = discoverRecentSessionFiles(days, limit);
  const sessions: IndexedSessionKnowledgeSummary[] = [];
  let indexed = 0;
  let failed = 0;

  try {
    store.updateIndexJob({
      id: job.id,
      state: "running",
      leaseOwner: "session-indexer",
      leaseGeneration,
      progress: { discovered: files.length, extracted: 0, indexed: 0, failed: 0 },
    });
    for (const file of files) {
      try {
        const parse = await parseJsonl(file);
        const summary = storeSessionCollection(store, file, parse, input.force === true);
        sessions.push(summary);
        indexed++;
      } catch (error) {
        failed++;
        sessions.push({
          collectionId: `failed/${file.harness}/${stableId(file.path)}`,
          title: basename(file.path),
          harness: file.harness,
          project: projectName(null, file.path),
          transcriptPath: file.path,
          qmdPath: "",
          records: 0,
          documents: 0,
          chunks: 0,
          bytes: file.size,
          mtimeMs: file.mtimeMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      store.updateIndexJob({
        id: job.id,
        state: "running",
        leaseOwner: "session-indexer",
        leaseGeneration,
        progress: { discovered: files.length, extracted: indexed + failed, indexed, failed },
      });
    }
    const completed = store.updateIndexJob({
      id: job.id,
      state: "completed",
      completedAt: Date.now(),
      progress: { discovered: files.length, extracted: indexed + failed, indexed, failed },
    }) ?? job;
    return { job: completed, days, discovered: files.length, indexed, failed, sessions };
  } catch (error) {
    const failedJob = store.updateIndexJob({
      id: job.id,
      state: "failed",
      completedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
      progress: { discovered: files.length, extracted: indexed + failed, indexed, failed },
    }) ?? job;
    return { job: failedJob, days, discovered: files.length, indexed, failed: failed + 1, sessions };
  } finally {
    store.close();
  }
}
