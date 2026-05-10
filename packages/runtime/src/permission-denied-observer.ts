// Passive observer that derives a typed permission-denied stream from the
// TailEvent firehose. Subscribes to tail, classifies Claude tool-result events
// carrying the canonical denial sentence, and re-emits enriched events on a
// separate channel. Pure read-side: no Claude config is touched.

import { subscribeTail } from "./tail/service.js";
import type { TailEvent } from "./tail/types.js";

const CLAUDE_SOURCE = "claude";
const DENIAL_PREFIX = "The user doesn't want to proceed with this tool use";
const TOOL_INPUT_SUMMARY_MAX = 120;
const TOOL_CACHE_MAX_PER_SESSION = 64;

export type PermissionDeniedEvent = {
  id: string;
  ts: number;
  source: string;
  sessionId: string;
  project: string;
  cwd: string;
  toolUseId: string;
  toolName: string | null;
  toolInputSummary: string | null;
  permissionMode: string | null;
};

type Handler = (event: PermissionDeniedEvent) => void;

type CachedToolUse = {
  name: string;
  inputSummary: string;
  ts: number;
};

const subscribers = new Set<Handler>();
const toolCache = new Map<string, Map<string, CachedToolUse>>();
let unsubFromTail: (() => void) | null = null;

function summarizeToolInput(input: unknown): string {
  if (input == null) return "";
  try {
    const json = JSON.stringify(input);
    if (!json) return "";
    return json.length > TOOL_INPUT_SUMMARY_MAX
      ? json.slice(0, TOOL_INPUT_SUMMARY_MAX - 1) + "…"
      : json;
  } catch {
    return "";
  }
}

function rememberToolUses(event: TailEvent): void {
  const raw = event.raw as Record<string, unknown> | undefined;
  const message = raw?.message as Record<string, unknown> | undefined;
  const blocks = (message?.content ?? raw?.content) as unknown;
  if (!Array.isArray(blocks)) return;

  let sessionMap = toolCache.get(event.sessionId);
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_use") continue;
    const id = typeof b.id === "string" ? b.id : null;
    if (!id) continue;
    if (!sessionMap) {
      sessionMap = new Map();
      toolCache.set(event.sessionId, sessionMap);
    }
    sessionMap.set(id, {
      name: typeof b.name === "string" ? b.name : "tool",
      inputSummary: summarizeToolInput(b.input),
      ts: event.ts,
    });
    while (sessionMap.size > TOOL_CACHE_MAX_PER_SESSION) {
      const oldest = sessionMap.keys().next().value;
      if (!oldest) break;
      sessionMap.delete(oldest);
    }
  }
}

function classifyDenial(event: TailEvent): PermissionDeniedEvent | null {
  const raw = event.raw as Record<string, unknown> | undefined;
  const message = raw?.message as Record<string, unknown> | undefined;
  const blocks = (message?.content ?? raw?.content) as unknown;
  if (!Array.isArray(blocks)) return null;

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_result") continue;
    if (b.is_error !== true) continue;
    const content = typeof b.content === "string" ? b.content : "";
    if (!content.startsWith(DENIAL_PREFIX)) continue;

    const toolUseId = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
    const cached = toolUseId
      ? toolCache.get(event.sessionId)?.get(toolUseId)
      : undefined;
    const permissionMode = typeof raw?.permissionMode === "string"
      ? (raw.permissionMode as string)
      : null;

    return {
      id: `${event.sessionId}:${toolUseId || event.id}`,
      ts: event.ts,
      source: event.source,
      sessionId: event.sessionId,
      project: event.project,
      cwd: event.cwd,
      toolUseId,
      toolName: cached?.name ?? null,
      toolInputSummary: cached?.inputSummary ?? null,
      permissionMode,
    };
  }
  return null;
}

function handleTailEvent(event: TailEvent): void {
  if (event.source !== CLAUDE_SOURCE) return;

  if (event.kind === "tool") {
    rememberToolUses(event);
    return;
  }
  if (event.kind !== "tool-result") return;

  const denial = classifyDenial(event);
  if (!denial) return;
  for (const sub of [...subscribers]) {
    try {
      sub(denial);
    } catch {
      /* swallow subscriber errors, mirroring tail/service.ts */
    }
  }
}

export function subscribePermissionDenials(handler: Handler): () => void {
  subscribers.add(handler);
  if (!unsubFromTail) {
    unsubFromTail = subscribeTail(handleTailEvent);
  }
  return () => {
    subscribers.delete(handler);
    if (subscribers.size === 0 && unsubFromTail) {
      unsubFromTail();
      unsubFromTail = null;
      toolCache.clear();
    }
  };
}

export const __testing = {
  classifyDenial,
  rememberToolUses,
  resetToolCache: () => toolCache.clear(),
};
