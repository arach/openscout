/**
 * Repo Watch — mock snapshot.
 *
 * A realistic `RepoWatchSnapshot` shaped EXACTLY like the live
 * `/v1/repo-watch/snapshot` response (`@openscout/runtime`): agents carry a
 * broker `state` (live derives from "active"), sessions carry `source`+`harness`,
 * file `status` is the backend's human label ("untracked" | "conflict" |
 * "staged" | "unstaged" | "staged+unstaged"), project stats include change
 * sums, and `lastCommitAt` is epoch **milliseconds**.
 *
 * Tuned to resemble arach's ACTUAL machine (observed live): ~8 repos, MOSTLY
 * single-worktree and calm, a couple of multi-worktree projects (openscout,
 * hudson) where dev actually fans out, a few repos with small changes, one merge
 * conflict for design coverage, and idle/live agents attached. This is the case
 * the design has to look beautiful for — the quiet, one-branch-per-repo reality —
 * not an artificially busy fixture.
 *
 * Timestamps are fixed (no wall-clock) so screenshots are byte-stable. Derive
 * "ago" via `agoFromMillis(t, snapshot.generatedAt)`.
 */

import type { RepoWatchAgentRef, RepoWatchSnapshot } from "./types";

/** Fixed generation instant (epoch ms) — ~2026-06-03. */
export const GENERATED_AT = 1_780_250_400_000;
const mins = (m: number) => GENERATED_AT - m * 60_000;
const hrs = (h: number) => GENERATED_AT - h * 3_600_000;
const days = (d: number) => GENERATED_AT - d * 86_400_000;

/** A live (actively working) agent — renders with the accent dot. */
const live = (name: string, harness = "claude-code"): RepoWatchAgentRef => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  state: "active",
  harness,
});
/** An idle/attached-but-not-working agent — handle only, no accent. */
const idle = (name: string, harness = "claude-code"): RepoWatchAgentRef => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  state: "idle",
  harness,
});
/** Filler idle agents so a long-lived worktree shows a realistic "+N" tail. */
const tail = (prefix: string, n: number): RepoWatchAgentRef[] =>
  Array.from({ length: n }, (_, i) => idle(`${prefix} ${i + 1}`));

export const MOCK_SNAPSHOT: RepoWatchSnapshot = {
  generatedAt: GENERATED_AT,
  warnings: [
    "Skipped missing repo-watch path: /Users/arach/dev/talkie-empty-state.",
    "Repo Watch limited discovery to 8 repositories.",
    "Repo Watch limited /Users/arach/dev/openscout to 4 worktrees.",
  ],
  totals: {
    projects: 8,
    worktrees: 12,
    dirtyWorktrees: 4,
    conflictedWorktrees: 1,
    attentionWorktrees: 2,
    attachedAgents: 9,
    attachedSessions: 5,
  },
  projects: [
    // ── action — single worktree, dirty main (attention) ──────────────
    {
      id: "repo:action",
      name: "action",
      root: "/Users/arach/dev/action",
      commonGitDir: "/Users/arach/dev/action/.git",
      attention: "attention",
      attentionReasons: ["Dirty main"],
      stats: {
        worktrees: 1, dirtyWorktrees: 1, conflictedWorktrees: 0,
        attachedAgents: 1, attachedSessions: 0,
        staged: 2, unstaged: 9, untracked: 0, conflicts: 0,
      },
      hints: [],
      worktrees: [
        {
          id: "worktree:action-main",
          path: "/Users/arach/dev/action",
          name: "action",
          isBare: false,
          branch: {
            name: "main", upstream: "origin/main", head: "5c0ffee1",
            detached: false, ahead: 1, behind: 0, isMain: true, diverged: false,
          },
          status: {
            clean: false, staged: 2, unstaged: 9, untracked: 0, conflicts: 0,
            changedFiles: 11,
            files: [
              { path: "src/runner/dispatch.ts", status: "unstaged" },
              { path: "src/runner/queue.ts", status: "unstaged" },
              { path: "src/runner/queue.test.ts", status: "staged" },
              { path: "src/cli/run.ts", status: "unstaged" },
              { path: "src/cli/args.ts", status: "staged" },
              { path: "README.md", status: "unstaged" },
            ],
          },
          diff: {
            unstagedShortstat: "9 files changed, 612 insertions(+), 1102 deletions(-)",
            stagedShortstat: "2 files changed, 93 insertions(+)",
          },
          attention: "attention",
          attentionReasons: ["Dirty main"],
          agents: [idle("Action")],
          sessions: [],
          hints: [],
          lastCommitAt: days(72),
          scannedAt: GENERATED_AT,
          error: null,
        },
      ],
    },

    // ── hudson — two worktrees, one active w/ a long agent tail ───────
    {
      id: "repo:hudson",
      name: "hudson",
      root: "/Users/arach/dev/hudson",
      commonGitDir: "/Users/arach/dev/hudson/.git",
      attention: "active",
      attentionReasons: ["Scout activity attached"],
      stats: {
        worktrees: 2, dirtyWorktrees: 0, conflictedWorktrees: 0,
        attachedAgents: 6, attachedSessions: 2,
        staged: 0, unstaged: 0, untracked: 0, conflicts: 0,
      },
      hints: [],
      worktrees: [
        {
          id: "worktree:hudson-ios",
          path: "/Users/arach/dev/hudson/.worktrees/ios-terminal-menu",
          name: "ios-terminal-menu",
          isBare: false,
          branch: {
            name: "codex/ios-terminal-menu", upstream: "origin/codex/ios-terminal-menu",
            head: "907dd74c", detached: false, ahead: 2, behind: 0, isMain: false, diverged: false,
          },
          status: {
            clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0,
            changedFiles: 0, files: [],
          },
          diff: { unstagedShortstat: null, stagedShortstat: null },
          attention: "active",
          attentionReasons: ["Scout activity attached", "2 ahead"],
          agents: [live("Hudson Logo"), live("Hudson"), ...tail("Hudson Run", 8)],
          sessions: [
            { id: "s-hudson-1", source: "claude-code", harness: "claude-code" },
            { id: "s-hudson-2", source: "codex", harness: "codex" },
          ],
          hints: [],
          lastCommitAt: hrs(23),
          scannedAt: GENERATED_AT,
          error: null,
        },
        {
          id: "worktree:hudson-main",
          path: "/Users/arach/dev/hudson",
          name: "hudson",
          isBare: false,
          branch: {
            name: "main", upstream: "origin/main", head: "1f9a7b03",
            detached: false, ahead: 0, behind: 0, isMain: true, diverged: false,
          },
          status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0, files: [] },
          diff: { unstagedShortstat: null, stagedShortstat: null },
          attention: "quiet",
          attentionReasons: [],
          agents: [],
          sessions: [],
          hints: [],
          lastCommitAt: days(3),
          scannedAt: GENERATED_AT,
          error: null,
        },
      ],
    },

    // ── openscout — four worktrees, one actively being worked ─────────
    {
      id: "repo:openscout",
      name: "openscout",
      root: "/Users/arach/dev/openscout",
      commonGitDir: "/Users/arach/dev/openscout/.git",
      attention: "active",
      attentionReasons: ["9 changed files", "Scout activity attached"],
      stats: {
        worktrees: 4, dirtyWorktrees: 1, conflictedWorktrees: 0,
        attachedAgents: 12, attachedSessions: 2,
        staged: 4, unstaged: 3, untracked: 2, conflicts: 0,
      },
      hints: [],
      worktrees: [
        {
          id: "worktree:openscout-repo-watch",
          path: "/Users/arach/dev/openscout/.worktrees/repo-watch-snapshot",
          name: "repo-watch-snapshot",
          isBare: false,
          branch: {
            name: "codex/repo-watch-snapshot", upstream: "origin/codex/repo-watch-snapshot",
            head: "fb2c0236", detached: false, ahead: 8, behind: 0, isMain: false, diverged: false,
          },
          status: {
            clean: false, staged: 4, unstaged: 3, untracked: 2, conflicts: 0,
            changedFiles: 9,
            files: [
              { path: "packages/web/client/scout/repo-watch/RepoWatchLedger.tsx", status: "staged" },
              { path: "packages/web/client/screens/ReposScreen.tsx", status: "unstaged" },
              { path: "design/studio/lib/repo-watch/mock.ts", status: "unstaged" },
              { path: "design/studio/components/RepoWatchLedger.tsx", status: "staged" },
              { path: ".scratch/notes.md", status: "untracked" },
            ],
          },
          diff: {
            unstagedShortstat: "3 files changed, 188 insertions(+), 22 deletions(-)",
            stagedShortstat: "4 files changed, 1048 insertions(+), 1400 deletions(-)",
          },
          attention: "active",
          attentionReasons: ["9 changed files", "8 ahead", "Scout activity attached"],
          agents: [live("Openscout"), live("Ranger"), ...tail("Codex", 10)],
          sessions: [
            { id: "s-os-1", source: "codex", harness: "codex" },
            { id: "s-os-2", source: "claude-code", harness: "claude-code" },
          ],
          hints: [],
          lastCommitAt: hrs(8),
          scannedAt: GENERATED_AT,
          error: null,
        },
        {
          id: "worktree:openscout-main",
          path: "/Users/arach/dev/openscout",
          name: "openscout",
          isBare: false,
          branch: {
            name: "main", upstream: "origin/main", head: "dcb1d843",
            detached: false, ahead: 0, behind: 0, isMain: true, diverged: false,
          },
          status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0, files: [] },
          diff: { unstagedShortstat: null, stagedShortstat: null },
          attention: "quiet", attentionReasons: [], agents: [], sessions: [], hints: [],
          lastCommitAt: days(1), scannedAt: GENERATED_AT, error: null,
        },
        {
          id: "worktree:openscout-settings",
          path: "/Users/arach/dev/openscout/.worktrees/settings-drawer",
          name: "settings-drawer",
          isBare: false,
          branch: {
            name: "feat/settings-drawer", upstream: "origin/feat/settings-drawer", head: "a2f0aa62",
            detached: false, ahead: 0, behind: 0, isMain: false, diverged: false,
          },
          status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0, files: [] },
          diff: { unstagedShortstat: null, stagedShortstat: null },
          attention: "quiet", attentionReasons: [], agents: [], sessions: [], hints: [],
          lastCommitAt: days(6), scannedAt: GENERATED_AT, error: null,
        },
        {
          id: "worktree:openscout-relay",
          path: "/Users/arach/dev/openscout/.worktrees/terminal-relay",
          name: "terminal-relay",
          isBare: false,
          branch: {
            name: "fix/terminal-relay-session", upstream: "origin/fix/terminal-relay-session", head: "5cad587d",
            detached: false, ahead: 0, behind: 0, isMain: false, diverged: false,
          },
          status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0, files: [] },
          diff: { unstagedShortstat: null, stagedShortstat: null },
          attention: "quiet", attentionReasons: [], agents: [], sessions: [], hints: [],
          lastCommitAt: days(9), scannedAt: GENERATED_AT, error: null,
        },
      ],
    },

    // ── TermBridgeKit — single worktree, a merge conflict (critical) ──
    {
      id: "repo:termbridgekit",
      name: "TermBridgeKit",
      root: "/Users/arach/dev/TermBridgeKit",
      commonGitDir: "/Users/arach/dev/TermBridgeKit/.git",
      attention: "critical",
      attentionReasons: ["1 conflicted file", "Dirty master"],
      stats: {
        worktrees: 1, dirtyWorktrees: 1, conflictedWorktrees: 1,
        attachedAgents: 1, attachedSessions: 1,
        staged: 0, unstaged: 2, untracked: 0, conflicts: 1,
      },
      hints: [],
      worktrees: [
        {
          id: "worktree:termbridgekit-master",
          path: "/Users/arach/dev/TermBridgeKit",
          name: "TermBridgeKit",
          isBare: false,
          branch: {
            name: "master", upstream: "origin/master", head: "b1d9c4a7",
            detached: false, ahead: 0, behind: 2, isMain: true, diverged: false,
          },
          status: {
            clean: false, staged: 0, unstaged: 2, untracked: 0, conflicts: 1,
            changedFiles: 3,
            files: [
              { path: "Sources/TermBridge/PTYBridge.swift", status: "conflict" },
              { path: "Sources/TermBridge/Session.swift", status: "unstaged" },
              { path: "Tests/TermBridgeTests/SessionTests.swift", status: "unstaged" },
            ],
          },
          diff: {
            unstagedShortstat: "2 files changed, 31 insertions(+), 12 deletions(-)",
            stagedShortstat: null,
          },
          attention: "critical",
          attentionReasons: ["1 conflicted file", "Dirty master", "2 behind origin/master"],
          agents: [idle("TermBridgeKit")],
          sessions: [{ id: "s-tbk-1", source: "claude-code", harness: "claude-code" }],
          hints: [],
          lastCommitAt: days(30),
          scannedAt: GENERATED_AT,
          error: null,
        },
      ],
    },

    // ── lattices — single worktree, clean, a live agent attached ──────
    {
      id: "repo:lattices",
      name: "lattices",
      root: "/Users/arach/dev/lattices",
      commonGitDir: "/Users/arach/dev/lattices/.git",
      attention: "active",
      attentionReasons: ["Scout activity attached"],
      stats: {
        worktrees: 1, dirtyWorktrees: 0, conflictedWorktrees: 0,
        attachedAgents: 1, attachedSessions: 1,
        staged: 0, unstaged: 0, untracked: 0, conflicts: 0,
      },
      hints: [],
      worktrees: [
        {
          id: "worktree:lattices-main",
          path: "/Users/arach/dev/lattices",
          name: "lattices",
          isBare: false,
          branch: {
            name: "main", upstream: "origin/main", head: "44c1e0d2",
            detached: false, ahead: 0, behind: 0, isMain: true, diverged: false,
          },
          status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0, files: [] },
          diff: { unstagedShortstat: null, stagedShortstat: null },
          attention: "active",
          attentionReasons: ["Scout activity attached"],
          agents: [live("Lattices")],
          sessions: [{ id: "s-lat-1", source: "claude-code", harness: "claude-code" }],
          hints: [],
          lastCommitAt: days(4),
          scannedAt: GENERATED_AT,
          error: null,
        },
      ],
    },

    // ── talkie — single worktree, clean, two agents (one live) ────────
    {
      id: "repo:talkie",
      name: "talkie",
      root: "/Users/arach/dev/talkie",
      commonGitDir: "/Users/arach/dev/talkie/.git",
      attention: "active",
      attentionReasons: ["Scout activity attached"],
      stats: {
        worktrees: 1, dirtyWorktrees: 0, conflictedWorktrees: 0,
        attachedAgents: 3, attachedSessions: 1,
        staged: 0, unstaged: 0, untracked: 0, conflicts: 0,
      },
      hints: [],
      worktrees: [
        {
          id: "worktree:talkie-master",
          path: "/Users/arach/dev/talkie",
          name: "talkie",
          isBare: false,
          branch: {
            name: "master", upstream: "origin/master", head: "e4d2b8a1",
            detached: false, ahead: 0, behind: 0, isMain: true, diverged: false,
          },
          status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0, files: [] },
          diff: { unstagedShortstat: null, stagedShortstat: null },
          attention: "active",
          attentionReasons: ["Scout activity attached"],
          agents: [live("Talkie UI Polish"), idle("Talkie UI Polish Fast"), ...tail("Talkie", 3)],
          sessions: [{ id: "s-talkie-1", source: "claude-code", harness: "claude-code" }],
          hints: [],
          lastCommitAt: hrs(6),
          scannedAt: GENERATED_AT,
          error: null,
        },
      ],
    },

    // ── Termini — single worktree, local branch, a tiny change ────────
    {
      id: "repo:termini",
      name: "Termini",
      root: "/Users/arach/dev/Termini",
      commonGitDir: "/Users/arach/dev/Termini/.git",
      attention: "active",
      attentionReasons: ["1 changed file", "Scout activity attached"],
      stats: {
        worktrees: 1, dirtyWorktrees: 1, conflictedWorktrees: 0,
        attachedAgents: 2, attachedSessions: 1,
        staged: 0, unstaged: 1, untracked: 0, conflicts: 0,
      },
      hints: [],
      worktrees: [
        {
          id: "worktree:termini-render",
          path: "/Users/arach/dev/Termini",
          name: "Termini",
          isBare: false,
          branch: {
            name: "codex/termini-render-loop-perf-v0", upstream: null, head: "771ac0de",
            detached: false, ahead: 0, behind: 0, isMain: false, diverged: false,
          },
          status: {
            clean: false, staged: 0, unstaged: 1, untracked: 0, conflicts: 0,
            changedFiles: 1,
            files: [{ path: "Sources/Termini/RenderLoop.swift", status: "unstaged" }],
          },
          diff: {
            unstagedShortstat: "1 file changed, 18 insertions(+), 4 deletions(-)",
            stagedShortstat: null,
          },
          attention: "active",
          attentionReasons: ["1 changed file", "Scout activity attached"],
          agents: [idle("TermBridgeKit"), live("Termini")],
          sessions: [{ id: "s-termini-1", source: "codex", harness: "codex" }],
          hints: [],
          lastCommitAt: days(28),
          scannedAt: GENERATED_AT,
          error: null,
        },
      ],
    },

    // ── vox — single worktree, clean but behind upstream ──────────────
    {
      id: "repo:vox",
      name: "vox",
      root: "/Users/arach/dev/vox",
      commonGitDir: "/Users/arach/dev/vox/.git",
      attention: "active",
      attentionReasons: ["6 behind origin/main"],
      stats: {
        worktrees: 1, dirtyWorktrees: 0, conflictedWorktrees: 0,
        attachedAgents: 1, attachedSessions: 0,
        staged: 0, unstaged: 0, untracked: 0, conflicts: 0,
      },
      hints: [],
      worktrees: [
        {
          id: "worktree:vox-main",
          path: "/Users/arach/dev/vox",
          name: "vox",
          isBare: false,
          branch: {
            name: "main", upstream: "origin/main", head: "0a77e9b4",
            detached: false, ahead: 0, behind: 6, isMain: true, diverged: false,
          },
          status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0, files: [] },
          diff: { unstagedShortstat: null, stagedShortstat: null },
          attention: "active",
          attentionReasons: ["6 behind origin/main"],
          agents: [idle("Vox")],
          sessions: [],
          hints: [],
          lastCommitAt: days(22),
          scannedAt: GENERATED_AT,
          error: null,
        },
      ],
    },
  ],
};
