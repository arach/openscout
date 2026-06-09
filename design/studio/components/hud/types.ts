/**
 * Shared HUD types. Used by both the interactive playground at
 * `/studies/hud` and the per-size locked reference pages
 * (`/studies/hud-compact`, `/studies/hud-medium`, `/studies/hud-large`).
 *
 * Three named sizes — `compact` (420), `medium` (680), `large` (900).
 * Four tabs — `agents`, `activity`, `tail`, `sessions`.
 *
 * Tab semantics:
 *   agents   — who's working (fleet of broker agents)
 *   activity — structured event ledger, time-bucketed, category eyebrow
 *              + title + summary + byline. Mirrors the webapp's
 *              ActivityScreen.
 *   tail     — firehose; dense mono single-line rows; raw event stream.
 *              ssh-tail-into-a-server feel.
 *   sessions — agent run sessions (started, ended, status, harness,
 *              message counts) — not local terminal sessions. Mirrors
 *              OpsScreen's session ledger.
 */

import type { AgentState } from "@/components/AgentPresenceDot";

export type HudSize = "compact" | "medium" | "large";

export type HudTab =
  | "agents"
  | "activity"
  | "tail"
  | "sessions"
  // Assistant — slot 5. DM-style desktop surface for the same Scout
  // that lives on iOS. UI labels stay neutral ("assistant") per
  // feedback_meta_agent_naming_neutral; the brand work is done by the
  // robot-head glyph beside the tab.
  | "assistant";

/** Entity kinds linked from the trailing scout-link chip. */
export type ScoutLinkKind = "agent" | "event" | "firehose" | "session";

// ─── Agents (formerly "fleet") ──────────────────────────────────────

export interface FleetAgent {
  id: string;
  name: string;
  handle: string;
  state: AgentState;
  stateLabel: string;
  /** 8-step recent activity (0..8). 0 → flat dash. */
  pulse: number[];
  work: string;
  lastAction: string | null;
  lastActionAgo: string | null;
  ago: string;
  selected?: boolean;
  isWorking?: boolean;
  /** Drains the row a bit — used for offline. */
  dim?: boolean;
  /** Optional capability tags surfaced in the engaged detail panel. */
  capabilities?: string[];
  /** Optional recent action list surfaced in the engaged detail panel. */
  recentActions?: string[];
  /** Optional per-recent-action relative time (zip with `recentActions`). */
  recentActionAgos?: string[];
  /** Full text of the agent's most recent turn (2–4 sentences). Surfaced
   *  in the three-pane Agents treatment at `large` in column C. */
  lastTurnText?: string;
  /** Turn-buffer position — used to render `N/5` indicator + dots. */
  turnBufferPosition?: number;
  /** Total dots in the turn-buffer pagination strip. */
  turnBufferTotal?: number;
  /** Branch the agent is currently working against. */
  branch?: string;
  /** Working directory the agent is rooted at. */
  cwd?: string;
  /** Model id the agent is running on. */
  model?: string;
}

// ─── Activity (structured ledger) ───────────────────────────────────
//
// Structured, time-bucketed event ledger. Each event carries a category
// (presence / work / delivery / coordination / system), a kind, a title,
// a one-sentence summary, and a byline.

export type ActivityKind = "turn" | "wire" | "ask" | "start" | "fail";

export type ActivityCategory =
  | "presence"
  | "work"
  | "delivery"
  | "coordination"
  | "system";

export interface ActivityEvent {
  id: string;
  ago: string;
  at: string;
  agent: string;
  handle: string;
  kind: ActivityKind;
  category: ActivityCategory;
  /** Short title — the headline of the event. */
  title: string;
  /** One-sentence summary that follows the title. */
  summary: string;
  emphasized?: boolean;
  /** Mocked related flight id surfaced in the engaged detail panel. */
  flightId?: string;
  /** Long-form text revealed when engaged. */
  detail?: string;
}

export interface ActivityBucket {
  eyebrow: string;
  headline: string;
  events: ActivityEvent[];
}

// Legacy observe surface shape. HudObserve is still typechecked by Next even
// though the current HUD barrel exports HudActivity instead.
export type ObserveKind = ActivityKind;

export interface ObserveEvent {
  id: string;
  ago: string;
  at: string;
  agent: string;
  handle: string;
  kind: ObserveKind;
  line: string;
  meta: string;
  summary?: string;
  emphasized?: boolean;
  flightId?: string;
}

export interface ObserveBucket {
  eyebrow: string;
  headline: string;
  events: ObserveEvent[];
}

// ─── Tail (firehose) ─────────────────────────────────────────────────
//
// Low-level granular log stream. Each row = one line. No buckets, no
// spine, no time stacking. Mirrors the oxtail surface in the web app.

export type FirehoseKind =
  | "TUR" // turn
  | "MSG" // message send
  | "TOL" // tool call
  | "EDT" // file edit
  | "ERR" // error
  | "LIF" // lifecycle (start/stop/wake)
  | "PMT" // prompt
  | "BRK" // broker ping
  | "ASK"; // ask / question

export interface FirehoseEvent {
  id: string;
  /** HH:MM:SS clock time. */
  at: string;
  kind: FirehoseKind;
  /** Source agent handle without the `@`. */
  source: string;
  /** Single dispatch line. */
  line: string;
  /** Lifts the row to ink + lime kind marker. */
  emphasized?: boolean;
}

// ─── Sessions (agent run sessions) ──────────────────────────────────
//
// The working sessions of broker agents — what the webapp's OpsScreen
// session ledger shows. NOT local terminal sessions. Each row carries
// an agent identity, a harness, a state, message counts, and lifecycle
// timestamps.

export type SessionStatus = "running" | "idle" | "ended";

/** Harness — claude-code, codex, cursor, scout, etc. */
export type SessionHarness =
  | "claude-code"
  | "codex"
  | "cursor"
  | "scout"
  | "raw";

export interface AgentSession {
  id: string;
  /** Short session ref id (8-char). */
  refId: string;
  /** Agent name running this session. */
  agentName: string;
  /** Agent handle (with @). */
  agentHandle: string;
  /** Harness driving the session. */
  harness: SessionHarness;
  /** Run status. */
  status: SessionStatus;
  /** Status label for display. */
  statusLabel: string;
  /** Project name (leaf of cwd). */
  project: string;
  /** Branch the session is running against. */
  branch: string;
  /** Model the session is running on. */
  model: string;
  /** Messages exchanged in this session. */
  messages: number;
  /** Started — relative ago label. */
  startedAgo: string;
  /** Started absolute clock label. */
  startedAt: string;
  /** Ended — relative ago label, or null if still running. */
  endedAgo: string | null;
  /** Duration label (e.g. "1h 04m"). */
  duration: string;
  /** Last turn excerpt — what the agent last said. */
  lastTurn: string;
  /** Last activity ago — drives the visible timestamp on the row. */
  ago: string;
}

// ─── Engage ──────────────────────────────────────────────────────────

/**
 * Engage state lives at each tab component (one engaged row id per
 * tab, scoped to that tab's rows). The id corresponds to the row's
 * stable id (agent.id / event.id / session.id).
 */
export type EngageState = string | null;

// ─── Assistant thread (slot 5) ───────────────────────────────────────
//
// Conversation thread between the operator and the universal assistant.
// One source talks at a time; messages are timeline-ordered. The body
// can be plain prose or carry inline command chips (rendered specially
// in HudAssistant). At v0 the structure intentionally mirrors a
// shell-readable transcript: source + at + body, no buckets.

export type ScoutThreadSource = "scout" | "operator";

/** One inline span that's not plain prose — renders specially. */
export type ScoutThreadSpan =
  | { kind: "text"; text: string }
  /** Slash command like `/help` or `/find hudson` — rendered as chip. */
  | { kind: "cmd"; text: string }
  /** Agent handle `@hudson` — rendered in agent hue. */
  | { kind: "mention"; text: string }
  /** File path `Sources/Foo.swift` — rendered in path hue. */
  | { kind: "path"; text: string }
  /** Backticked code span — slightly lifted ink + medium weight. */
  | { kind: "code"; text: string };

export interface ScoutThreadMessage {
  id: string;
  source: ScoutThreadSource;
  /** HH:MM clock — short timestamp on the right of the source line. */
  at: string;
  /** Pre-tokenized body for inline rendering. The leaf is just spans. */
  body: ScoutThreadSpan[];
}
