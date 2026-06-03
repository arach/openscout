/**
 * Repo Watch — shared presentation helpers.
 *
 * Maps the backend's mechanical attention model onto the studio's token
 * vocabulary, and derives the display-only bits the wire format doesn't send
 * (a handle + "live" flag from an agent's state, a short badge from a file's
 * status label). Treatments import from here so four layouts read as one system
 * and so the same code works against the live `/v1/repo-watch/snapshot`.
 *
 * Tokens resolve to CSS vars in `app/globals.css`:
 *   --status-{ok,warn,error,info,neutral}-{fg,bg}, --scout-accent, --studio-*.
 */

import type {
  RepoWatchAgentRef,
  RepoWatchAttentionLevel,
} from "./types";

export type StatusTone = "ok" | "warn" | "error" | "info" | "neutral" | "accent";

export interface AttentionVisual {
  label: string;
  tone: StatusTone;
  fg: string;
  bg: string;
  rank: number;
  glyph: string;
  gloss: string;
}

export const ATTENTION: Record<RepoWatchAttentionLevel, AttentionVisual> = {
  critical: {
    label: "CRITICAL",
    tone: "error",
    fg: "var(--status-error-fg)",
    bg: "var(--status-error-bg)",
    rank: 0,
    glyph: "●",
    gloss: "Merge conflicts or unmerged status — work is stuck.",
  },
  attention: {
    label: "ATTENTION",
    tone: "warn",
    fg: "var(--status-warn-fg)",
    bg: "var(--status-warn-bg)",
    rank: 1,
    glyph: "▲",
    gloss: "Dirty main, diverged branch, or status couldn't be read.",
  },
  active: {
    label: "ACTIVE",
    tone: "accent",
    fg: "var(--scout-accent)",
    bg: "var(--scout-accent-soft)",
    rank: 2,
    glyph: "◆",
    gloss: "Live work — dirty, ahead/behind, or an agent is attached.",
  },
  quiet: {
    label: "QUIET",
    tone: "neutral",
    fg: "var(--studio-ink-faint)",
    bg: "var(--status-neutral-bg)",
    rank: 3,
    glyph: "·",
    gloss: "Clean and idle — nothing pulling for attention.",
  },
  unknown: {
    label: "UNKNOWN",
    tone: "neutral",
    fg: "var(--studio-ink-faint)",
    bg: "var(--status-neutral-bg)",
    rank: 4,
    glyph: "?",
    gloss: "Discovered but couldn't be scanned enough to classify.",
  },
};

/** Severity order for sorting/grouping — critical first, unknown last. */
export const ATTENTION_ORDER: RepoWatchAttentionLevel[] = [
  "critical",
  "attention",
  "active",
  "quiet",
  "unknown",
];

export function attentionRank(level: RepoWatchAttentionLevel): number {
  return ATTENTION[level].rank;
}

/* ── Agent presence — derived, since the wire format sends neither ──────── */

/** Live = the broker reports the agent as actively working. Other states
 *  (idle / waiting / offline / null) render unlifted. */
export function agentLive(agent: RepoWatchAgentRef): boolean {
  return (agent.state ?? "").toLowerCase() === "active";
}

/** A display handle — the wire format has no handle, so build one from the
 *  agent's name (falling back to its id). */
export function agentHandle(agent: RepoWatchAgentRef): string {
  if (agent.name && agent.name.trim()) {
    return "@" + agent.name.trim().toLowerCase().replace(/\s+/g, "-");
  }
  return agent.id;
}

export function agentLabel(agent: RepoWatchAgentRef): string {
  return agent.name?.trim() || agent.id;
}

/* ── Branch / path formatting ──────────────────────────────────────────── */

/** Compact ahead/behind cue, e.g. "↑2 ↓1", or "" when in sync. */
export function aheadBehind(ahead: number, behind: number): string {
  const parts: string[] = [];
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  return parts.join(" ");
}

/** Leaf of an absolute path — the worktree's short name. */
export function pathLeaf(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/** Abbreviated path for display (…/dev/openscout/foo). */
export function shortPath(p: string, segments = 3): string {
  const parts = p.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= segments) return p;
  return "…/" + parts.slice(-segments).join("/");
}

/** Relative "ago" from an epoch-**milliseconds** timestamp, against a fixed now
 *  (also ms). Deterministic — pass the snapshot's generatedAt so studies don't
 *  depend on wall-clock and screenshots stay byte-stable. */
export function agoFromMillis(epochMs: number | null, nowMs: number): string {
  if (epochMs == null) return "—";
  const deltaSec = Math.max(0, Math.round((nowMs - epochMs) / 1000));
  if (deltaSec < 60) return `${deltaSec}s`;
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.round(hr / 24);
  return `${d}d`;
}

/* ── File status — the backend sends human labels, not raw porcelain ─────
 * Values seen: "untracked" · "conflict" · "staged" · "unstaged" ·
 * "staged+unstaged" · "changed". Map to a tone + a one-glyph badge. */

export function fileStatusTone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (s.includes("conflict")) return "error";
  if (s === "untracked") return "info";
  if (s === "staged") return "ok";
  if (s.includes("unstaged") || s === "changed" || s === "modified") return "warn";
  return "warn";
}

/** One-character badge for a status label (used in dense file cells). */
export function fileStatusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("conflict")) return "U";
  if (s === "untracked") return "?";
  if (s === "staged+unstaged") return "±";
  if (s === "staged") return "S";
  if (s === "unstaged") return "M";
  if (s === "changed" || s === "modified") return "~";
  return "•";
}

export function isConflict(status: string): boolean {
  return status.toLowerCase().includes("conflict");
}

export function toneFg(tone: StatusTone): string {
  return tone === "accent" ? "var(--scout-accent)" : `var(--status-${tone}-fg)`;
}

export function toneBg(tone: StatusTone): string {
  return tone === "accent" ? "var(--scout-accent-soft)" : `var(--status-${tone}-bg)`;
}
