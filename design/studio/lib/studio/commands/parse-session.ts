import { promises as fs } from "node:fs";
import path from "node:path";
import type { Command } from "@/lib/studio/command";

export interface ParseSessionInput {
  /** Absolute path to a Codex or Claude JSONL session file. */
  path: string;
  /** Number of records to read from the head. */
  limit: number;
}

export type NormalizedKind =
  | "session_meta"
  | "user_turn"
  | "assistant_turn"
  | "command_or_tool"
  | "observation"
  | "system_record"
  | "unknown";

export interface NormalizedRecord {
  /** Index in source order (0-based). */
  i: number;
  /** ISO timestamp from source if present. */
  ts?: string;
  /** Coarse kind. Drives renderer tone + downstream routing. */
  kind: NormalizedKind;
  /** Human label: role, tool name, snapshot, etc. */
  tag?: string;
  /** Full text content, untrimmed. Empty for tool calls/results that are structured. */
  text?: string;
  /** Structured tool invocation, present when kind === "command_or_tool". */
  tool?: { name: string; input: unknown };
  /** Structured observation, present when kind === "observation". */
  result?: { ok?: boolean; output: unknown };
  /** Session-level metadata, present when kind === "session_meta". */
  meta?: Record<string, unknown>;
  /** Identifiers for threading (Claude has parentUuid; Codex has session_id). */
  refs?: { id?: string; parentId?: string; sessionId?: string };
  /** Raw record type from the source schema, for debugging + drilldown. */
  sourceType: string;
  /** Byte offset of this record's line within the source file. */
  sourceOffset: number;
}

export interface ParseSessionResult {
  harness: "codex" | "claude" | "unknown";
  records: NormalizedRecord[];
  /** Raw source line for each record, parallel-indexed. Kept for inspect views. */
  rawLines: string[];
  scannedLines: number;
  bytesRead: number;
  error?: string;
}

export const parseSessionCommand: Command<ParseSessionInput, ParseSessionResult> = {
  id: "parse-session",
  label: "Parse session",
  shell: ({ path: p, limit }) =>
    `head -n ${limit} ${shellQuote(shrinkPath(p))} | jq -c '.'`,
  run: async ({ path: filePath, limit }) => {
    try {
      const text = await readHeadLines(filePath, limit);
      const harness = detectHarness(filePath);
      const records: NormalizedRecord[] = [];
      const rawLines: string[] = [];
      let offset = 0;
      let i = 0;
      for (const line of text.split("\n")) {
        if (i >= limit) break;
        if (line.length === 0) {
          offset += 1; // empty line + its \n
          continue;
        }
        const lineOffset = offset;
        offset += Buffer.byteLength(line, "utf8") + 1; // line + \n
        try {
          const obj = JSON.parse(line);
          records.push(normalize(obj, i, lineOffset, harness));
          rawLines.push(line);
        } catch {
          records.push({
            i,
            kind: "unknown",
            sourceType: "unparseable",
            sourceOffset: lineOffset,
          });
          rawLines.push(line);
        }
        i++;
      }
      return {
        harness,
        records,
        rawLines,
        scannedLines: records.length,
        bytesRead: Buffer.byteLength(text, "utf8"),
      };
    } catch (err) {
      return {
        harness: "unknown",
        records: [],
        rawLines: [],
        scannedLines: 0,
        bytesRead: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
  cacheKey: ({ path: p, limit }) => `${p}::${limit}`,
  cacheTtlMs: 60_000,
};

function detectHarness(filePath: string): "codex" | "claude" | "unknown" {
  if (filePath.includes("/.codex/")) return "codex";
  if (filePath.includes("/.claude/")) return "claude";
  return "unknown";
}

async function readHeadLines(filePath: string, limit: number): Promise<string> {
  // Stream from the head until we have `limit` newlines (or hit EOF). Keeps
  // memory bounded while letting normalize see a real workload, not just the
  // first 128 KB.
  const fh = await fs.open(filePath, "r");
  try {
    const chunk = Buffer.alloc(64 * 1024);
    const collected: Buffer[] = [];
    let lines = 0;
    let pos = 0;
    let lastCutTotal = 0;
    let runningTotal = 0;
    while (lines <= limit) {
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
      if (bytesRead === 0) break;
      pos += bytesRead;
      const slice = Buffer.from(chunk.subarray(0, bytesRead));
      collected.push(slice);
      for (let i = 0; i < bytesRead; i++) {
        if (slice[i] === 0x0a) {
          lines++;
          if (lines > limit) {
            lastCutTotal = runningTotal + i + 1;
            break;
          }
        }
      }
      runningTotal += bytesRead;
    }
    const text = Buffer.concat(collected).toString("utf8");
    return lastCutTotal > 0 ? text.slice(0, lastCutTotal) : text;
  } finally {
    await fh.close();
  }
}

function normalize(
  obj: Record<string, unknown>,
  i: number,
  sourceOffset: number,
  harness: "codex" | "claude" | "unknown",
): NormalizedRecord {
  if (harness === "codex") return normalizeCodex(obj, i, sourceOffset);
  if (harness === "claude") return normalizeClaude(obj, i, sourceOffset);
  return {
    i,
    kind: "unknown",
    sourceType: String(obj.type ?? "?"),
    sourceOffset,
  };
}

function normalizeCodex(
  obj: Record<string, unknown>,
  i: number,
  sourceOffset: number,
): NormalizedRecord {
  const type = String(obj.type ?? "");
  const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
  const payload = (obj.payload as Record<string, unknown> | undefined) ?? {};
  const base = { i, ts, sourceType: type, sourceOffset };

  if (type === "session_meta") {
    return {
      ...base,
      kind: "session_meta",
      tag: "meta",
      meta: payload,
      refs: { sessionId: payload.id as string | undefined },
    };
  }
  // Codex wraps most events inside response_item or event_msg. Unwrap and
  // dispatch on the inner payload.type so the stream reads as real turns,
  // not opaque system_records.
  if (type === "response_item") {
    return normalizeCodexResponseItem(payload, base);
  }
  if (type === "event_msg") {
    return normalizeCodexEventMsg(payload, base);
  }
  if (type === "turn_context") {
    return { ...base, kind: "system_record", tag: "turn_context", meta: payload };
  }
  // Legacy / un-wrapped events (older sessions).
  if (type === "message") return normalizeCodexMessage(payload, base);
  if (type === "function_call" || type === "local_shell_call") {
    return normalizeCodexFunctionCall(payload, base);
  }
  if (type === "function_call_output" || type === "local_shell_call_output") {
    return normalizeCodexFunctionCallOutput(payload, base);
  }
  if (type === "reasoning") return normalizeCodexReasoning(payload, base);
  return { ...base, kind: "system_record", text: JSON.stringify(payload) };
}

type CodexBase = {
  i: number;
  ts?: string;
  sourceType: string;
  sourceOffset: number;
};

function normalizeCodexResponseItem(
  payload: Record<string, unknown>,
  base: CodexBase,
): NormalizedRecord {
  const inner = String(payload.type ?? "");
  if (inner === "message") return normalizeCodexMessage(payload, base);
  if (inner === "reasoning") return normalizeCodexReasoning(payload, base);
  if (inner === "function_call" || inner === "local_shell_call") {
    return normalizeCodexFunctionCall(payload, base);
  }
  if (inner === "function_call_output" || inner === "local_shell_call_output") {
    return normalizeCodexFunctionCallOutput(payload, base);
  }
  return {
    ...base,
    kind: "system_record",
    tag: inner || "response_item",
    meta: payload,
  };
}

function normalizeCodexEventMsg(
  payload: Record<string, unknown>,
  base: CodexBase,
): NormalizedRecord {
  const inner = String(payload.type ?? "");
  if (inner === "user_message") {
    return {
      ...base,
      kind: "user_turn",
      tag: "user",
      text: String(payload.message ?? payload.text ?? ""),
    };
  }
  if (inner === "agent_message") {
    return {
      ...base,
      kind: "assistant_turn",
      tag: "assistant",
      text: String(payload.message ?? payload.text ?? ""),
    };
  }
  return {
    ...base,
    kind: "system_record",
    tag: inner || "event_msg",
    meta: payload,
  };
}

function normalizeCodexMessage(
  payload: Record<string, unknown>,
  base: CodexBase,
): NormalizedRecord {
  const role = String(payload.role ?? "");
  const text = extractCodexText(payload.content);
  if (role === "user") return { ...base, kind: "user_turn", tag: "user", text };
  if (role === "assistant") return { ...base, kind: "assistant_turn", tag: "assistant", text };
  if (role === "developer") return { ...base, kind: "system_record", tag: "developer", text };
  return { ...base, kind: "system_record", tag: role || "message", text };
}

function normalizeCodexFunctionCall(
  payload: Record<string, unknown>,
  base: CodexBase,
): NormalizedRecord {
  const name = String(payload.name ?? payload.command ?? "tool");
  const input = payload.arguments ?? payload.args ?? payload.input ?? {};
  return { ...base, kind: "command_or_tool", tag: name, tool: { name, input } };
}

function normalizeCodexFunctionCallOutput(
  payload: Record<string, unknown>,
  base: CodexBase,
): NormalizedRecord {
  const output = payload.output ?? payload.content ?? "";
  return { ...base, kind: "observation", tag: "result", result: { output } };
}

function normalizeCodexReasoning(
  payload: Record<string, unknown>,
  base: CodexBase,
): NormalizedRecord {
  // Reasoning often carries a `summary` array of {type:"summary_text", text}
  // and/or an `encrypted_content`. Surface the summary text when available.
  let text = "";
  if (Array.isArray(payload.summary)) {
    text = payload.summary
      .map((s) => {
        const block = s as { text?: string };
        return block?.text ?? "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (!text && payload.content) text = String(payload.content);
  return { ...base, kind: "assistant_turn", tag: "reasoning", text };
}

function normalizeClaude(
  obj: Record<string, unknown>,
  i: number,
  sourceOffset: number,
): NormalizedRecord {
  const type = String(obj.type ?? "");
  const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
  const refs = {
    id: typeof obj.uuid === "string" ? obj.uuid : undefined,
    parentId: typeof obj.parentUuid === "string" ? obj.parentUuid : undefined,
  };
  const base = { i, ts, sourceType: type, sourceOffset, refs };

  if (type === "user") {
    const msg = obj.message as Record<string, unknown> | undefined;
    const text = extractClaudeText(msg?.content);
    return { ...base, kind: "user_turn", tag: "user", text };
  }
  if (type === "assistant") {
    const msg = obj.message as Record<string, unknown> | undefined;
    const content = msg?.content;
    if (Array.isArray(content)) {
      const toolUse = content.find((c) => (c as { type?: string })?.type === "tool_use") as
        | { name?: string; input?: unknown }
        | undefined;
      if (toolUse) {
        const name = String(toolUse.name ?? "tool");
        return {
          ...base,
          kind: "command_or_tool",
          tag: name,
          tool: { name, input: toolUse.input ?? {} },
          sourceType: "tool_use",
        };
      }
    }
    return {
      ...base,
      kind: "assistant_turn",
      tag: "assistant",
      text: extractClaudeText(content),
    };
  }
  if (type === "tool_use") {
    const name = String(obj.name ?? "tool");
    return {
      ...base,
      kind: "command_or_tool",
      tag: name,
      tool: { name, input: (obj as { input?: unknown }).input ?? {} },
    };
  }
  if (type === "tool_result") {
    const output = (obj as { content?: unknown }).content ?? "";
    return { ...base, kind: "observation", tag: "result", result: { output } };
  }
  if (type === "system") {
    return {
      ...base,
      kind: "system_record",
      tag: "system",
      text: extractClaudeText((obj as { content?: unknown }).content),
    };
  }
  if (type === "summary" || type === "file-history-snapshot") {
    return {
      ...base,
      kind: "system_record",
      tag: type,
      meta: obj,
    };
  }
  return { ...base, kind: "system_record", text: JSON.stringify(obj) };
}

function extractCodexText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        const block = c as { type?: string; text?: string; content?: string };
        if (block?.text) return block.text;
        if (block?.content) return block.content;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function extractClaudeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        const block = c as { type?: string; text?: string; content?: unknown };
        if (block?.text) return block.text;
        if (typeof block?.content === "string") return block.content;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function trim(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + "…" : oneLine;
}

function shrinkPath(file: string): string {
  const home = process.env.HOME ?? "";
  return home && file.startsWith(home) ? "~" + file.slice(home.length) : file;
}

function shellQuote(s: string): string {
  return /[^A-Za-z0-9_./~-]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s;
}
