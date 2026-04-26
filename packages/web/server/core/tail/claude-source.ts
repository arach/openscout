import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { discoverClaudeProcesses } from "./discover.ts";
import type {
  DiscoveredProcess,
  TailContext,
  TailEvent,
  TailEventKind,
  TranscriptSource,
} from "./types.ts";

const SOURCE_NAME = "claude";
const MAX_SUMMARY_LEN = 200;

function encodeProjectDir(cwd: string): string {
  // Claude encodes the cwd by replacing "/" with "-" and prefixing the result.
  // Example: /Users/arach/dev/openscout → -Users-arach-dev-openscout
  return cwd.replace(/\//g, "-");
}

function projectsRoot(): string {
  return join(homedir(), ".claude", "projects");
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
  const sessionId = typeof obj.sessionId === "string"
    ? obj.sessionId
    : typeof message?.id === "string"
      ? (message.id as string)
      : "";

  const ts = pickTimestamp(obj);
  const kind = classifyKind(rawType, blocks);
  const summary = summaryForType(rawType, obj, blocks)
    || `[${rawType}]`;

  const project = ctx.process.cwd ? basename(ctx.process.cwd) : "(unknown)";
  const finalSessionId = sessionId
    || basename(ctx.transcriptPath).replace(/\.jsonl$/, "");

  return {
    id: hashId(finalSessionId, ctx.lineOffset),
    ts,
    source: SOURCE_NAME,
    sessionId: finalSessionId,
    pid: ctx.process.pid,
    parentPid: ctx.process.ppid,
    project,
    cwd: ctx.process.cwd ?? "",
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
  resolveTranscriptPath(p: DiscoveredProcess): string | null {
    return resolveClaudeTranscriptPath(p);
  },
  parseLine(line: string, ctx: TailContext): TailEvent | null {
    return parseClaudeLine(line, ctx);
  },
};
