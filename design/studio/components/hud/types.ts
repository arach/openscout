/**
 * Shared HUD types. Used by both the interactive playground at
 * `/studies/hud` and the per-size locked reference pages
 * (`/studies/hud-compact`, `/studies/hud-medium`, `/studies/hud-large`).
 *
 * Three named sizes — `compact` (420), `medium` (680), `large` (900).
 * Four tabs — `fleet`, `observe`, `tail`, `sessions`.
 *
 * Tab semantics:
 *   fleet    — who's working
 *   observe  — structured activity, time-bucketed, byline + dispatch
 *   tail     — firehose; dense mono log-line rows; raw event stream
 *   sessions — terminal rooms / panes
 */

import type { AgentState } from "@/components/AgentPresenceDot";

export type HudSize = "compact" | "medium" | "large";

export type HudTab = "fleet" | "observe" | "tail" | "sessions";

/** Entity kinds linked from the trailing scout-link chip. */
export type ScoutLinkKind = "agent" | "event" | "firehose" | "session";

// ─── Fleet ───────────────────────────────────────────────────────────

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
   *  in the three-pane Fleet treatment at `large` in column C. */
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

// ─── Observe (previously called "tail") ─────────────────────────────
//
// Structured activity view: time-bucketed, byline + dispatch line, spine
// + tick. The pattern formerly named "tail" in the studio.

export type ObserveKind = "turn" | "wire" | "ask" | "start" | "fail";

export interface ObserveEvent {
  id: string;
  ago: string;
  at: string;
  agent: string;
  handle: string;
  kind: ObserveKind;
  line: string;
  meta: string;
  emphasized?: boolean;
  /** Mocked related flight id surfaced in the engaged detail panel. */
  flightId?: string;
  /** Full summary text revealed when engaged. */
  summary?: string;
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

// ─── Sessions ────────────────────────────────────────────────────────

export type SessionKind = "tmux" | "iterm" | "terminal";

export interface ScoutSession {
  id: string;
  name: string;
  kind: SessionKind;
  windows: number;
  attached: boolean;
  ago: string;
  cwd: string;
  /** One-line snippet shown at `compact`. */
  snippet: string;
  /** Multi-line pane preview shown at `medium`/`large`. */
  pane: string[];
  /** Optional last command surfaced in the engaged detail panel. */
  lastCommand?: string;
  /** Optional attached client label surfaced in the engaged detail panel. */
  client?: string;
}

// ─── Engage ──────────────────────────────────────────────────────────

/**
 * Engage state lives at each tab component (one engaged row id per
 * tab, scoped to that tab's rows). The id corresponds to the row's
 * stable id (agent.id / event.id / session.id).
 */
export type EngageState = string | null;
