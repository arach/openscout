/**
 * Heat — the studio's sense of its own recency.
 *
 * The studio sits on the real working tree: plans are `plans/*.md`, eng docs
 * are `docs/eng/*.md`, studies are `app/studies/<slug>/page.tsx`. All three
 * already carry an on-disk mtime, and until now that mtime was used only to
 * silently reorder the sidebar. Heat makes it visible.
 *
 * The model is deliberately coarse. Four tiers, not a gradient: the eye reads
 * "today / this week / this month / older" instantly, and a continuous ramp
 * across 250+ entries would just be noise. Cold is the resting state, so a
 * page full of old work looks calm rather than alarmed.
 *
 * Pure and server-safe — no DOM, no client state. `now` is injected so a
 * server render can stamp one consistent instant across the whole page.
 */

export type Heat = "live" | "warm" | "cooling" | "cold";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

/** Tier for an mtime in ms. Missing/invalid timestamps read cold. */
export function heatOf(mtimeMs: number | undefined | null, now: number): Heat {
  if (!mtimeMs || !Number.isFinite(mtimeMs)) return "cold";
  const age = now - mtimeMs;
  if (age < DAY) return "live";
  if (age < WEEK) return "warm";
  if (age < MONTH) return "cooling";
  return "cold";
}

/** Whether this tier is recent enough to be worth stating in words. */
export function isRecent(heat: Heat): boolean {
  return heat === "live" || heat === "warm";
}

/**
 * Compact relative time, in the studio's clipped register: "12m", "4h",
 * "3d", "2w", "5mo". No "ago" — the label that precedes it supplies that,
 * and these sit in dense mono rows where every character costs width.
 */
export function shortAge(mtimeMs: number | undefined | null, now: number): string {
  if (!mtimeMs || !Number.isFinite(mtimeMs)) return "—";
  const age = Math.max(0, now - mtimeMs);
  if (age < HOUR) {
    const m = Math.max(1, Math.floor(age / (60 * 1000)));
    return `${m}m`;
  }
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d`;
  if (age < MONTH) return `${Math.floor(age / WEEK)}w`;
  const months = Math.floor(age / MONTH);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

/** Spelled-out age for tooltips and assistive text. */
export function longAge(mtimeMs: number | undefined | null, now: number): string {
  if (!mtimeMs || !Number.isFinite(mtimeMs)) return "never edited here";
  const age = Math.max(0, now - mtimeMs);
  if (age < HOUR) {
    const m = Math.max(1, Math.floor(age / (60 * 1000)));
    return `edited ${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (age < DAY) {
    const h = Math.floor(age / HOUR);
    return `edited ${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (age < MONTH) {
    const d = Math.floor(age / DAY);
    return `edited ${d} day${d === 1 ? "" : "s"} ago`;
  }
  const months = Math.floor(age / MONTH);
  if (months < 12) return `edited ${months} month${months === 1 ? "" : "s"} ago`;
  const y = Math.floor(months / 12);
  return `edited ${y} year${y === 1 ? "" : "s"} ago`;
}

/** ISO string → ms, tolerant of undefined and unparseable values. */
export function msFromIso(iso: string | undefined | null): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/** One entry on the bench, normalized across plans / eng docs / studies. */
export interface BenchEntry {
  href: string;
  label: string;
  /** Which register it came from — "plan", "eng", "study". */
  kind: string;
  mtimeMs: number;
  blurb?: string;
}

/**
 * The n most recently touched entries across every register, newest first.
 * Entries without a usable mtime are dropped rather than sorted last: the
 * bench is a claim about what you actually touched, and an unknown timestamp
 * is not evidence of anything.
 */
export function bench(entries: BenchEntry[], limit = 5): BenchEntry[] {
  return entries
    .filter((e) => Number.isFinite(e.mtimeMs) && e.mtimeMs > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}
