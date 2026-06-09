/**
 * Repo Watch snapshot cache — keeps a scan "always on the ready".
 *
 * Stale-while-revalidate for the Repos view: the last good snapshot lives in a
 * module-level cache (instant within an SPA session) and is mirrored to
 * `localStorage` (survives a full page reload), so navigating to / reloading
 * Repos renders the previous scan immediately instead of a blocking
 * "Scanning…" state. The view then refreshes in the background and writes the
 * fresh result back here.
 *
 * Mirrors the shape of scout/repo-diff/cache.ts (module cache + in-flight
 * dedupe), scoped to the single standard-depth repo-watch snapshot.
 */

import { api } from "../../lib/api.ts";
import type { RepoWatchSnapshot } from "./types.ts";

export type RepoWatchCacheRecord = {
  snapshot: RepoWatchSnapshot;
  fetchedAt: number;
};

const STORAGE_KEY = "openscout.repoWatch.snapshot.v1";
// Must match ReposScreen's standard-depth URL so the prewarm primes the same
// thing the view fetches (params are insertion-ordered by URLSearchParams).
const STANDARD_URL = "/api/repo-watch?includeDiff=1&includeLastCommit=1&native=1";
// Don't seed the UI from a disk snapshot older than this — better to show the
// loading state than a scan that predates a long-closed laptop.
const MAX_PERSIST_AGE_MS = 60 * 60_000;

let memory: RepoWatchCacheRecord | null = null;
let hydrated = false;
let inFlight: Promise<RepoWatchCacheRecord | null> | null = null;

function hydrateFromStorage(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as RepoWatchCacheRecord;
    if (!parsed?.snapshot?.projects || typeof parsed.fetchedAt !== "number") return;
    if (Date.now() - parsed.fetchedAt > MAX_PERSIST_AGE_MS) return;
    memory = parsed;
  } catch {
    // Corrupt / unreadable cache — fall back to a cold load.
  }
}

export function readRepoWatchCache(): RepoWatchCacheRecord | null {
  if (!memory) hydrateFromStorage();
  return memory;
}

export function writeRepoWatchCache(snapshot: RepoWatchSnapshot, fetchedAt: number): void {
  // Never let a transient empty scan (the broker's scan races a budget and
  // intermittently returns nothing) clobber a good cached snapshot.
  if (snapshot.projects.length === 0 && memory && memory.snapshot.projects.length > 0) {
    return;
  }
  memory = { snapshot, fetchedAt };
  hydrated = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Quota / disabled storage — the in-memory cache still serves this session.
  }
}

/**
 * A cheap content fingerprint of the fields the table actually renders, so the
 * UI can tell a real change from a no-op poll (and only glimmer on the former).
 */
export function repoWatchSignature(snapshot: RepoWatchSnapshot | null): string {
  if (!snapshot) return "";
  const parts: string[] = [];
  for (const project of snapshot.projects) {
    for (const wt of project.worktrees) {
      const live = wt.agents.filter(
        (a) => (a.state ?? "").toLowerCase() === "active",
      ).length;
      const s = wt.status;
      parts.push(
        `${wt.id}:${wt.attention}:${s.changedFiles}:${s.staged}:${s.unstaged}:${s.untracked}:${s.conflicts}:${live}`,
      );
    }
  }
  return parts.join("|");
}

/**
 * Fire-and-forget warm-up so the first visit to Repos already has a scan to
 * show. Deduped by an in-flight promise; never rejects (resolves null on
 * failure) so callers can `void prewarmRepoWatch()` freely.
 */
export function prewarmRepoWatch(): Promise<RepoWatchCacheRecord | null> {
  if (!memory) hydrateFromStorage();
  if (inFlight) return inFlight;
  const request = api<RepoWatchSnapshot>(STANDARD_URL)
    .then((snapshot) => {
      const record: RepoWatchCacheRecord = { snapshot, fetchedAt: Date.now() };
      writeRepoWatchCache(snapshot, record.fetchedAt);
      return record;
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  inFlight = request;
  return request;
}
