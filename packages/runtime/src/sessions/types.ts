import type { TailAttribution, TailEventKind } from "../tail/types.js";

export type SessionInventoryScope = "shallow" | "deep";

/** Upper bound on how many recent turns the enricher captures per session. */
export const SESSION_MAX_TURNS = 5;

export type SessionTurnRole = "user" | "assistant" | "tool";

export type SessionTurn = {
  role: SessionTurnRole;
  /** Trimmed text (already clipped). Empty when the turn carried no displayable text. */
  text: string;
  /** Tool name if this turn ended with / was a tool call. */
  toolName: string | null;
  /** Event timestamp in ms, if known. */
  ts: number | null;
};

export type SessionEnrichment = {
  /** Most recent model id observed in the transcript tail. */
  model: string | null;
  /** Latest in-context token total (Claude input+cache_read+cache_creation, Codex last_token_usage.input_tokens). */
  contextUsedTokens: number | null;
  /** Declared context window (codex `info.model_context_window`); null when not declared. */
  contextWindowTokens: number | null;
  /** Timestamp (ms) of the event the enrichment came from, if available. */
  lastEventTs: number | null;
  /** Short human summary of the last meaningful event. */
  lastSummary: string | null;
  /** Kind of the last event. */
  lastKind: TailEventKind | null;
  /** Most recent user prompt text (excludes tool_result re-injections). */
  lastUserText: string | null;
  /** Most recent assistant message text. */
  lastAssistantText: string | null;
  /** Most recent tool/function call name, if a tool turn is in flight or just ended. */
  lastToolName: string | null;
  /**
   * Recent turns in chronological order (oldest → newest), capped at {@link SESSION_MAX_TURNS}.
   * The endpoint may slice this to a smaller count via `?turns=N`.
   */
  recentTurns: SessionTurn[];
};

export type SessionRecord = {
  source: string;
  /** Stable id for routing/copy — sessionId when known, transcript leaf otherwise. */
  refId: string;
  sessionId: string | null;
  transcriptPath: string;
  cwd: string | null;
  project: string;
  harness: TailAttribution;
  mtimeMs: number;
  size: number;
  /** A live process is attached, OR the transcript was touched recently. */
  active: boolean;
  /** Tail-read enrichment; may be a stub when the file is unreadable. */
  enrichment: SessionEnrichment;
};

export type SessionInventory = {
  generatedAt: number;
  sessions: SessionRecord[];
  totals: {
    total: number;
    active: number;
    bySource: Record<string, number>;
  };
};
