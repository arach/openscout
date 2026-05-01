import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

import { discoverClaudeProcesses } from "./discover.js";
import type {
  DiscoveredProcess,
  DiscoveredTranscript,
  TailContext,
  TailDiscoveryScope,
  TailEvent,
  TailEventKind,
  TranscriptSource,
} from "./types.js";

const SOURCE_NAME = "claude";
const MAX_SUMMARY_LEN = 200;
const DEFAULT_HOT_DISCOVERY_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_SHALLOW_DISCOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEEP_DISCOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOT_DISCOVERY_LIMIT = 64;
const DEFAULT_SHALLOW_DISCOVERY_LIMIT = 160;
const DEFAULT_DEEP_DISCOVERY_LIMIT = 160;
const HEAD_READ_BYTES = 256 * 1024;

function encodeProjectDir(cwd: string): string {
  // Claude encodes the cwd by replacing "/" with "-" and prefixing the result.
  // Example: /Users/arach/dev/openscout → -Users-arach-dev-openscout
  return cwd.replace(/\//g, "-");
}

function projectsRoot(): string {
  return process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT
    ?? join(homedir(), ".claude", "projects");
}

function listJsonlFiles(dir: string): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.endsWith(".jsonl"));
}

function pickMostRecentJsonl(dir: string): string | null {
  const files = listJsonlFiles(dir);
  if (files.length === 0) return null;
  let best: { name: string; mtime: number } | null = null;
  for (const file of files) {
    try {
      const mtime = statSync(join(dir, file)).mtimeMs;
      if (!best || mtime > best.mtime) best = { name: file, mtime };
    } catch {
      continue;
    }
  }
  return best ? join(dir, best.name) : null;
}

function readPositiveIntEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = Number.parseInt(process.env[name] ?? "", 10);
    if (Number.isFinite(raw) && raw > 0) return raw;
  }
  return fallback;
}

function discoveryWindowMs(scope: TailDiscoveryScope): number {
  const fallback = scope === "hot"
    ? DEFAULT_HOT_DISCOVERY_WINDOW_MS
    : scope === "deep"
      ? DEFAULT_DEEP_DISCOVERY_WINDOW_MS
      : DEFAULT_SHALLOW_DISCOVERY_WINDOW_MS;
  const scopedName = `OPENSCOUT_TAIL_${scope.toUpperCase()}_DISCOVERY_WINDOW_MS`;
  return readPositiveIntEnv([scopedName, "OPENSCOUT_TAIL_DISCOVERY_WINDOW_MS"], fallback);
}

function discoveryLimit(scope: TailDiscoveryScope): number {
  const fallback = scope === "hot"
    ? DEFAULT_HOT_DISCOVERY_LIMIT
    : scope === "deep"
      ? DEFAULT_DEEP_DISCOVERY_LIMIT
      : DEFAULT_SHALLOW_DISCOVERY_LIMIT;
  const scopedName = `OPENSCOUT_TAIL_${scope.toUpperCase()}_DISCOVERY_LIMIT`;
  return readPositiveIntEnv([scopedName, "OPENSCOUT_TAIL_DISCOVERY_LIMIT"], fallback);
}

function readFileHead(filePath: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const buffer = new Uint8Array(HEAD_READ_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return Buffer.from(buffer.subarray(0, bytesRead)).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd != null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readClaudeMetadata(filePath: string): { cwd: string | null; sessionId: string | null } {
  const head = readFileHead(filePath);
  let cwd: string | null = null;
  let sessionId: string | null = null;
  for (const line of head.split(/\r?\n/)) {
    const record = parseJsonRecord(line.trim());
    if (!record) continue;
    cwd ??= typeof record.cwd === "string" && record.cwd.trim()
      ? record.cwd
      : null;
    sessionId ??=
      typeof record.sessionId === "string" && record.sessionId.trim()
        ? record.sessionId
        : typeof record.session_id === "string" && record.session_id.trim()
          ? record.session_id
          : null;
    if (cwd && sessionId) {
      return { cwd, sessionId };
    }
  }
  return { cwd, sessionId };
}

function decodeProjectDir(dirName: string): string | null {
  if (!dirName.startsWith("-")) return null;
  return `/${dirName.slice(1).replace(/-/g, "/")}`;
}

function projectDirNameForPath(filePath: string): string | null {
  const rel = relative(projectsRoot(), filePath);
  if (!rel || rel.startsWith("..")) return null;
  return rel.split(/[\\/]/)[0] ?? null;
}

function fallbackCwdForPath(filePath: string): string | null {
  const dirName = projectDirNameForPath(filePath);
  return dirName ? decodeProjectDir(dirName) : null;
}

function walkRecentJsonlFiles(
  root: string,
  scope: TailDiscoveryScope,
): Array<{ path: string; mtimeMs: number; size: number }> {
  const cutoff = Date.now() - discoveryWindowMs(scope);
  const found: Array<{ path: string; mtimeMs: number; size: number }> = [];
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
      found.push({ path, mtimeMs: stats.mtimeMs, size: stats.size });
    }
  }
  return found
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, discoveryLimit(scope));
}

export function resolveClaudeTranscriptPath(p: DiscoveredProcess): string | null {
  if (!p.cwd) return null;
  const dir = join(projectsRoot(), encodeProjectDir(p.cwd));
  if (!existsSync(dir)) return null;
  return pickMostRecentJsonl(dir);
}

function clip(text: string, max = MAX_SUMMARY_LEN): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

function summarizeBlocks(content: unknown): string {
  if (typeof content === "string") return clip(content);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const blockObj = block as Record<string, unknown>;
    const blockType = blockObj.type;
    if (blockType === "text" && typeof blockObj.text === "string") {
      parts.push(blockObj.text);
    } else if (blockType === "thinking" && typeof blockObj.thinking === "string") {
      parts.push(`[thinking] ${blockObj.thinking}`);
    } else if (blockType === "tool_use") {
      const name = typeof blockObj.name === "string" ? blockObj.name : "tool";
      const input = blockObj.input as Record<string, unknown> | undefined;
      const arg = input
        ? clip(JSON.stringify(input), 80)
        : "";
      parts.push(`${name}(${arg})`);
    } else if (blockType === "tool_result") {
      const result = typeof blockObj.content === "string"
        ? blockObj.content
        : Array.isArray(blockObj.content)
          ? summarizeBlocks(blockObj.content)
          : "";
      parts.push(`→ ${result}`);
    } else if (blockType === "image") {
      parts.push("[image]");
    }
  }
  return clip(parts.join(" · "));
}

function pickTimestamp(obj: Record<string, unknown>): number {
  const candidates = [
    obj.timestamp,
    (obj.message as Record<string, unknown> | undefined)?.timestamp,
    (obj.snapshot as Record<string, unknown> | undefined)?.timestamp,
    obj.t,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) return parsed;
    } else if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate < 1e12 ? candidate * 1000 : candidate;
    }
  }
  return Date.now();
}

function classifyKind(rawType: string, blocks: unknown): TailEventKind {
  if (rawType === "user") {
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block && typeof block === "object") {
          const t = (block as Record<string, unknown>).type;
          if (t === "tool_result") return "tool-result";
        }
      }
    }
    return "user";
  }
  if (rawType === "assistant") {
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block && typeof block === "object") {
          const t = (block as Record<string, unknown>).type;
          if (t === "tool_use") return "tool";
        }
      }
    }
    return "assistant";
  }
  if (rawType === "tool_use") return "tool";
  if (rawType === "tool_result") return "tool-result";
  if (rawType === "system" || rawType === "permission-mode" || rawType === "file-history-snapshot") {
    return "system";
  }
  return "other";
}

function summaryForType(rawType: string, obj: Record<string, unknown>, blocks: unknown): string {
  if (rawType === "user" || rawType === "assistant") {
    return summarizeBlocks(blocks);
  }
  if (rawType === "permission-mode") {
    return `permission-mode → ${String(obj.permissionMode ?? "")}`;
  }
  if (rawType === "file-history-snapshot") {
    const snap = obj.snapshot as Record<string, unknown> | undefined;
    const tracked = snap && typeof snap === "object" ? snap.trackedFileBackups : undefined;
    const count = tracked && typeof tracked === "object" ? Object.keys(tracked as object).length : 0;
    return `file-history-snapshot · ${count} file(s)`;
  }
  if (rawType === "last-prompt") {
    const last = typeof obj.lastPrompt === "string" ? obj.lastPrompt : "";
    return clip(`last-prompt: ${last}`);
  }
  if (rawType === "system" && typeof obj.text === "string") {
    return clip(obj.text);
  }
  if (typeof obj.text === "string") return clip(obj.text);
  if (typeof obj.content === "string") return clip(obj.content);
  return clip(`[${rawType}]`);
}

function hashId(sessionId: string, offset: number): string {
  // Cheap stable id; full crypto isn't needed in-memory.
  return `${sessionId}:${offset}`;
}

function parseClaudeLine(line: string, ctx: TailContext): TailEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rawType = typeof obj.type === "string" ? obj.type : "other";
  const message = obj.message as Record<string, unknown> | undefined;
  const blocks = message?.content ?? obj.content;
  const explicitSessionId = typeof obj.sessionId === "string"
    ? obj.sessionId
    : typeof obj.session_id === "string"
      ? obj.session_id
      : "";

  const ts = pickTimestamp(obj);
  const kind = classifyKind(rawType, blocks);
  const summary = summaryForType(rawType, obj, blocks)
    || `[${rawType}]`;

  const finalSessionId = explicitSessionId
    || ctx.transcript.sessionId
    || (typeof message?.id === "string" ? (message.id as string) : "")
    || basename(ctx.transcriptPath).replace(/\.jsonl$/, "");
  const cwd = ctx.transcript.cwd ?? ctx.process.cwd ?? "";
  const project = cwd ? basename(cwd) : ctx.transcript.project;

  return {
    id: hashId(finalSessionId, ctx.lineOffset),
    ts,
    source: SOURCE_NAME,
    sessionId: finalSessionId,
    pid: ctx.process.pid,
    parentPid: ctx.process.ppid,
    project,
    cwd,
    harness: ctx.process.harness,
    kind,
    summary,
    raw: obj,
  };
}

export const ClaudeSource: TranscriptSource = {
  name: SOURCE_NAME,
  discoverProcesses(): Promise<DiscoveredProcess[]> {
    return discoverClaudeProcesses();
  },
  discoverTranscripts(_processes: DiscoveredProcess[], scope: TailDiscoveryScope = "shallow"): DiscoveredTranscript[] {
    const root = projectsRoot();
    if (!existsSync(root)) return [];
    return walkRecentJsonlFiles(root, scope).map((file) => {
      const meta = readClaudeMetadata(file.path);
      const cwd = meta.cwd ?? fallbackCwdForPath(file.path);
      const sessionId = meta.sessionId ?? basename(file.path).replace(/\.jsonl$/, "");
      return {
        source: SOURCE_NAME,
        transcriptPath: file.path,
        sessionId,
        cwd,
        project: cwd ? basename(cwd) : projectDirNameForPath(file.path) ?? "(unknown)",
        harness: "unattributed",
        mtimeMs: file.mtimeMs,
        size: file.size,
      };
    });
  },
  parseLine(line: string, ctx: TailContext): TailEvent | null {
    return parseClaudeLine(line, ctx);
  },
};
