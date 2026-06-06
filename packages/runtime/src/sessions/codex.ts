import {
  asNumber,
  asRecord,
  asString,
  parseJsonRecord,
  parseTimestamp,
  readTailLines,
} from "./tail-reader.js";
import { SESSION_MAX_TURNS, type SessionEnrichment, type SessionTurn } from "./types.js";
import type { TailEventKind } from "../tail/types.js";

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

function textFromContent(content: unknown): string {
  if (typeof content === "string") return clip(content);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const entry of content) {
    if (typeof entry === "string") {
      parts.push(entry);
      continue;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const text = asString(record.text)
      ?? asString(record.summary)
      ?? asString(record.input_text);
    if (text) parts.push(text);
  }
  return clip(parts.join("\n"));
}

function classifyKind(entryType: string, payloadType: string): TailEventKind | null {
  if (entryType === "response_item") {
    if (payloadType === "message") return "assistant";
    if (payloadType === "function_call" || payloadType === "custom_tool_call" || payloadType === "web_search_call") {
      return "tool";
    }
    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      return "tool-result";
    }
    if (payloadType === "reasoning") return "system";
  }
  if (entryType === "event_msg") {
    if (payloadType.endsWith("_end")) return "tool-result";
    if (payloadType.endsWith("_start")) return "tool";
    return "system";
  }
  return null;
}

function summarize(entryType: string, payloadType: string, payload: Record<string, unknown>): string {
  if (entryType === "response_item" && payloadType === "message") {
    return textFromContent(payload.content) || "(message)";
  }
  if (entryType === "response_item" && payloadType === "reasoning") {
    return textFromContent(payload.summary) || textFromContent(payload.content) || "(reasoning)";
  }
  if (entryType === "event_msg") {
    return clip(payloadType || "event");
  }
  return clip(`[${payloadType || entryType}]`);
}

export async function enrichCodexTranscript(path: string): Promise<SessionEnrichment> {
  const lines = await readTailLines(path);
  if (lines.length === 0) return EMPTY;

  const out: SessionEnrichment = { ...EMPTY, recentTurns: [] };
  const turnsNewestFirst: SessionTurn[] = [];
  for (const line of lines) {
    const record = parseJsonRecord(line);
    if (!record) continue;
    const entryType = asString(record.type) ?? "";
    const payload = asRecord(record.payload) ?? {};
    const payloadType = asString(payload.type) ?? "";
    const ts = parseTimestamp(record.timestamp) ?? parseTimestamp(payload.timestamp);

    // turn_context emits the model id for the current turn.
    if (entryType === "turn_context" && out.model == null) {
      out.model = asString(payload.model);
    }

    // token_count carries per-turn + cumulative usage plus the declared window.
    if (entryType === "event_msg" && payloadType === "token_count") {
      const info = asRecord(payload.info);
      if (info) {
        if (out.contextWindowTokens == null) {
          out.contextWindowTokens = asNumber(info.model_context_window);
        }
        const lastUsage = asRecord(info.last_token_usage);
        const lastInput = lastUsage ? asNumber(lastUsage.input_tokens) : null;
        if (lastInput != null && lastInput > 0 && out.contextUsedTokens == null) {
          out.contextUsedTokens = lastInput;
        }
      }
    }

    // task_started also carries model_context_window for the new turn.
    if (entryType === "event_msg" && payloadType === "task_started" && out.contextWindowTokens == null) {
      out.contextWindowTokens = asNumber(payload.model_context_window);
    }

    // Record the most recent meaningful event for summary/timestamp.
    const kind = classifyKind(entryType, payloadType);
    if (kind && out.lastEventTs == null && ts != null) {
      out.lastEventTs = ts;
      out.lastKind = kind;
      out.lastSummary = summarize(entryType, payloadType, payload);
    }

    // Capture the most recent user / assistant message + function call name.
    if (entryType === "response_item") {
      if (payloadType === "message") {
        const role = asString(payload.role);
        const text = textFromContent(payload.content);
        if (text) {
          if (role === "user") {
            if (out.lastUserText == null) out.lastUserText = text;
            if (turnsNewestFirst.length < SESSION_MAX_TURNS) {
              turnsNewestFirst.push({ role: "user", text, toolName: null, ts });
            }
          } else if (role === "assistant") {
            if (out.lastAssistantText == null) out.lastAssistantText = text;
            if (turnsNewestFirst.length < SESSION_MAX_TURNS) {
              turnsNewestFirst.push({ role: "assistant", text, toolName: null, ts });
            }
          }
        }
      }
      if (payloadType === "function_call" || payloadType === "custom_tool_call") {
        const name = asString(payload.name);
        if (name) {
          if (out.lastToolName == null) out.lastToolName = name;
          if (turnsNewestFirst.length < SESSION_MAX_TURNS) {
            turnsNewestFirst.push({ role: "tool", text: "", toolName: name, ts });
          }
        }
      }
    }

    if (
      turnsNewestFirst.length >= SESSION_MAX_TURNS
      && out.model
      && out.contextUsedTokens != null
      && out.contextWindowTokens != null
      && out.lastEventTs != null
    ) {
      break;
    }
  }
  out.recentTurns = turnsNewestFirst.reverse();
  return out;
}
