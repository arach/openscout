import {
  asNumber,
  asRecord,
  asString,
  parseJsonRecord,
  parseTimestamp,
  readHeadLines,
  readTailLines,
} from "./tail-reader.js";
import { SESSION_MAX_TURNS, type SessionEnrichment, type SessionTurn } from "./types.js";

const EMPTY: SessionEnrichment = {
  model: null,
  contextUsedTokens: null,
  contextWindowTokens: null,
  lastEventTs: null,
  lastSummary: null,
  lastKind: null,
  lastUserText: null,
  lastAssistantText: null,
  lastToolName: null,
  recentTurns: [],
};

function clip(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function textFromBlocks(blocks: unknown): string {
  if (typeof blocks === "string") return clip(blocks);
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    const record = asRecord(block);
    if (!record) continue;
    const text = asString(record.text);
    if (text) parts.push(text);
  }
  return clip(parts.join("\n"));
}

/** Extract assistant text blocks (skip tool_use blocks) and any tool name we encounter. */
function inspectAssistantContent(blocks: unknown): { text: string; tool: string | null } {
  if (!Array.isArray(blocks)) return { text: "", tool: null };
  const textParts: string[] = [];
  let tool: string | null = null;
  for (const block of blocks) {
    const record = asRecord(block);
    if (!record) continue;
    const type = asString(record.type);
    if (type === "text") {
      const text = asString(record.text);
      if (text) textParts.push(text);
    } else if (type === "tool_use" && tool == null) {
      tool = asString(record.name);
    }
  }
  return { text: clip(textParts.join("\n")), tool };
}

/** True user text only — skip records whose content is a tool_result re-injection. */
function userTextFromContent(blocks: unknown): string {
  if (!Array.isArray(blocks)) return typeof blocks === "string" ? clip(blocks) : "";
  let containsToolResult = false;
  const textParts: string[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      textParts.push(block);
      continue;
    }
    const record = asRecord(block);
    if (!record) continue;
    const type = asString(record.type);
    if (type === "tool_result") {
      containsToolResult = true;
      continue;
    }
    if (type === "text" || type == null) {
      const text = asString(record.text);
      if (text) textParts.push(text);
    }
  }
  // Records that are only tool_result aren't a true user prompt.
  if (containsToolResult && textParts.length === 0) return "";
  return clip(textParts.join("\n"));
}

function scanForModel(lines: string[]): string | null {
  for (const line of lines) {
    const record = parseJsonRecord(line);
    if (!record) continue;
    const message = asRecord(record.message);
    const model = asString(message?.model);
    if (model) return model;
  }
  return null;
}

export async function enrichClaudeTranscript(path: string): Promise<SessionEnrichment> {
  const lines = await readTailLines(path);
  if (lines.length === 0) return EMPTY;

  const out: SessionEnrichment = { ...EMPTY, recentTurns: [] };
  const turnsNewestFirst: SessionTurn[] = [];
  for (const line of lines) {
    const record = parseJsonRecord(line);
    if (!record) continue;
    const rawType = asString(record.type);
    const message = asRecord(record.message);
    const ts = parseTimestamp(record.timestamp)
      ?? parseTimestamp(message?.timestamp)
      ?? null;

    if (out.lastEventTs == null && ts != null && (rawType === "assistant" || rawType === "user" || rawType === "tool_use" || rawType === "tool_result")) {
      out.lastEventTs = ts;
      out.lastKind = rawType === "tool_use"
        ? "tool"
        : rawType === "tool_result"
          ? "tool-result"
          : rawType === "user"
            ? "user"
            : "assistant";
      const summary = textFromBlocks(message?.content ?? record.content);
      if (summary) out.lastSummary = summary;
    }

    if (rawType === "assistant" && message) {
      if (out.model == null) out.model = asString(message.model);
      const usage = asRecord(message.usage);
      if (usage && out.contextUsedTokens == null) {
        const input = asNumber(usage.input_tokens) ?? 0;
        const cacheRead = asNumber(usage.cache_read_input_tokens) ?? 0;
        const cacheCreate = asNumber(usage.cache_creation_input_tokens) ?? 0;
        const used = input + cacheRead + cacheCreate;
        if (used > 0) out.contextUsedTokens = used;
      }
      const inspected = inspectAssistantContent(message.content);
      if (out.lastAssistantText == null && inspected.text) {
        out.lastAssistantText = inspected.text;
      }
      if (out.lastToolName == null && inspected.tool) {
        out.lastToolName = inspected.tool;
      }
      if (turnsNewestFirst.length < SESSION_MAX_TURNS && (inspected.text || inspected.tool)) {
        turnsNewestFirst.push({
          role: "assistant",
          text: inspected.text,
          toolName: inspected.tool,
          ts,
        });
      }
    }

    if (rawType === "user") {
      const text = userTextFromContent(message?.content ?? record.content);
      if (text) {
        if (out.lastUserText == null) out.lastUserText = text;
        if (turnsNewestFirst.length < SESSION_MAX_TURNS) {
          turnsNewestFirst.push({ role: "user", text, toolName: null, ts });
        }
      }
    }

    if (
      turnsNewestFirst.length >= SESSION_MAX_TURNS
      && out.model
      && out.contextUsedTokens != null
      && out.lastEventTs != null
    ) {
      break;
    }
  }
  out.recentTurns = turnsNewestFirst.reverse();

  // The model stays constant for a Claude session. If the tail didn't include
  // an assistant turn (long pending user message, in-progress tool use, etc.),
  // peek at the head to recover it.
  if (out.model == null) {
    const headLines = await readHeadLines(path);
    out.model = scanForModel(headLines);
  }

  return out;
}
