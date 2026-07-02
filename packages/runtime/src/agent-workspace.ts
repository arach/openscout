// Agent workspace isolation.
//
// A dispatched agent runs in an *isolated* copy of the project so its edits
// don't clobber the operator's working tree. This module owns two lifecycle
// halves that used to live inline (and duplicated) in the mobile services:
//
//   1. createAgentWorkspace() — materialize the workspace on spawn.
//   2. teardownAgentWorkspace() — remove it when the flight settles.
//
// Materialization has two strategies, resolved conservatively per host:
//
//   - COW clone (macOS + APFS): `cp -c -R` is clonefile(2)-backed, so the
//     whole project — including a runnable `node_modules` and the `.git` dir —
//     is reflinked in near-constant time at ~zero extra disk. The clone lands
//     *inside* the project (`.scout-worktrees/<agent>`) so it is always on the
//     same APFS volume, which the reflink requires. This is the omp model
//     (see docs/eng/isolation-cow-vs-worktrees.md).
//
//   - git worktree (fallback): today's behavior. Used whenever the COW path
//     is unavailable — non-macOS, non-git, cross-volume, or a `cp -c` error.
//     A worktree only gives tracked files at HEAD (empty node_modules), but it
//     always works where git does, so it is the guaranteed final candidate.
//
// Both strategies return the same `{ path, branch }` shape and land under the
// same `.scout-worktrees/<agent>` directory, so callers and teardown treat them
// identically. Teardown distinguishes the two only to pick `git worktree
// remove` vs a plain `rm -rf`.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Directory (under the project root) that holds every Scout-created workspace. */
export const SCOUT_WORKSPACES_DIRNAME = ".scout-worktrees";

export type AgentWorkspaceKind = "cow-clone" | "git-worktree";

export interface CreateAgentWorkspaceResult {
  /** Absolute path the agent should run in (its cwdOverride). */
  path: string;
  /** Branch the workspace tracks (`scout/<agent>` unless one was requested). */
  branch: string;
  /** Which strategy materialized the workspace. */
  kind: AgentWorkspaceKind;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isGitRepo(projectRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Conservatively decide whether an APFS clonefile-backed copy is viable for
 * `projectRoot`. We only ever COW on macOS, and we *probe* the actual volume
 * rather than trust `uname` — a repo can live on an exFAT/network mount that
 * happens to be attached to a Mac, and reflink would `EXDEV`/`ENOTSUP` there.
 *
 * The probe reflinks a tiny throwaway file created *inside* the workspace
 * directory (same volume as the eventual clone target) with `cp -c`. If that
 * succeeds the real clone will too; if it errors we fall back. Everything is
 * cleaned up before returning.
 */
async function cowCloneSupported(workspaceDir: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  let probeDir: string | null = null;
  try {
    await mkdir(workspaceDir, { recursive: true });
    // mkdtemp inside the workspace dir keeps the probe on the target volume.
    probeDir = await mkdtemp(join(workspaceDir, ".cow-probe-"));
    const src = join(probeDir, "src");
    const dst = join(probeDir, "dst");
    await writeFile(src, "x");
    // `cp -c` = copyfile(3) with COPYFILE_CLONE. Errors (ENOTSUP/EXDEV) throw.
    await execFileAsync("cp", ["-c", src, dst]);
    return existsSync(dst);
  } catch {
    return false;
  } finally {
    if (probeDir) {
      await rm(probeDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Materialize an isolated workspace for `agentName` under
 * `<projectRoot>/.scout-worktrees/<agentName>`.
 *
 * Returns the workspace descriptor, or `null` when no strategy applies (the
 * project isn't a git repo *and* COW is unavailable) — callers then run the
 * agent in the project root, exactly as before.
 *
 * An already-materialized workspace at the target path is reused as-is (its
 * kind is re-detected from the presence of a worktree gitfile) — matching the
 * prior behavior where a stale worktree was reused rather than recreated.
 */
export async function createAgentWorkspace(
  projectRoot: string,
  agentName: string,
  requestedBranch?: string,
): Promise<CreateAgentWorkspaceResult | null> {
  const normalizedRequestedBranch = requestedBranch?.trim();
  const branch = normalizedRequestedBranch || `scout/${agentName}`;
  const workspaceDir = join(projectRoot, SCOUT_WORKSPACES_DIRNAME);
  const workspacePath = join(workspaceDir, agentName);

  // Reuse an existing workspace rather than recreate it. A `.git` *file*
  // (gitlink) marks a worktree; a `.git` *directory* marks a clone.
  if (existsSync(workspacePath)) {
    const kind: AgentWorkspaceKind = (await isDirectory(join(workspacePath, ".git")))
      ? "cow-clone"
      : "git-worktree";
    return { path: workspacePath, branch, kind };
  }

  const gitRepo = await isGitRepo(projectRoot);

  // Preferred path: APFS clonefile clone. Requires a git repo so the clone
  // carries `.git` (branch capture / status work inside it) and a runnable tree.
  if (gitRepo && (await cowCloneSupported(workspaceDir))) {
    const cloned = await tryCowClone(projectRoot, workspacePath, branch);
    if (cloned) return cloned;
    // A clone failure (mid-copy error) must not leave a partial tree behind.
    await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
  }

  // Fallback: git worktree (today's behavior). Only possible for a git repo.
  if (!gitRepo) return null;
  return tryGitWorktree(projectRoot, workspaceDir, workspacePath, branch);
}

/**
 * Clone the project tree into `workspacePath` via `cp -c -R` (clonefile-backed)
 * and point it at a fresh `scout/<agent>` branch. macOS `cp` detects that the
 * destination sits inside the source and skips re-descending into
 * `.scout-worktrees`, so the clone never recurses into sibling workspaces.
 */
async function tryCowClone(
  projectRoot: string,
  workspacePath: string,
  branch: string,
): Promise<CreateAgentWorkspaceResult | null> {
  try {
    // `cp -c -R <src> <dst>` (dst absent) clones the whole tree — node_modules
    // and .git included — sharing extents until written.
    await execFileAsync("cp", ["-c", "-R", projectRoot, workspacePath]);
  } catch {
    return null;
  }

  // Put the clone on its own branch so its history/diff is attributable to the
  // agent, and so it doesn't share a checked-out branch with the parent. Best
  // effort: if branching fails the clone is still a usable copy on the source's
  // current branch, so we keep it rather than discard the (successful) clone.
  try {
    await execFileAsync("git", ["checkout", "-b", branch], { cwd: workspacePath });
  } catch {
    // Branch may already exist (reused name) — switch to it instead.
    await execFileAsync("git", ["checkout", branch], { cwd: workspacePath }).catch(() => {});
  }

  return { path: workspacePath, branch, kind: "cow-clone" };
}

/**
 * Fallback: `git worktree add` — verbatim of the prior implementation.
 * Creates the `scout/<agent>` branch, retrying without `-b` if it already
 * exists, and returns `null` if both attempts fail.
 */
async function tryGitWorktree(
  projectRoot: string,
  workspaceDir: string,
  workspacePath: string,
  branch: string,
): Promise<CreateAgentWorkspaceResult | null> {
  await mkdir(workspaceDir, { recursive: true });
  try {
    await execFileAsync("git", ["worktree", "add", "-b", branch, workspacePath], { cwd: projectRoot });
    return { path: workspacePath, branch, kind: "git-worktree" };
  } catch {
    // Branch might already exist — try without -b.
    try {
      await execFileAsync("git", ["worktree", "add", workspacePath, branch], { cwd: projectRoot });
      return { path: workspacePath, branch, kind: "git-worktree" };
    } catch {
      return null;
    }
  }
}

export interface TeardownAgentWorkspaceInput {
  /** Absolute path to the agent's workspace (its persisted cwd). */
  workspacePath: string;
  /**
   * Project root the workspace was created under. When provided it is used to
   * (a) confirm the workspace really lives under this project's
   * `.scout-worktrees/` and (b) run `git worktree remove` from the parent repo.
   */
  projectRoot?: string;
}

/**
 * Remove a Scout-created workspace. Safe to call when it's already gone.
 *
 * Guardrails — we only ever delete a path that:
 *   - has a `.scout-worktrees/` segment in it (a Scout-created workspace), and
 *   - when `projectRoot` is given, sits under *that* project's
 *     `.scout-worktrees/`.
 *
 * This prevents an unexpected cwd (e.g. an agent that ran in the project root,
 * or a hand-set directory) from being `rm -rf`'d. Returns whether anything was
 * removed.
 */
export async function teardownAgentWorkspace(
  input: TeardownAgentWorkspaceInput,
): Promise<boolean> {
  const workspacePath = input.workspacePath?.trim();
  if (!workspacePath) return false;

  const workspacesSegment = `${SCOUT_WORKSPACES_DIRNAME}/`;
  const looksScoutManaged = workspacePath.includes(`/${workspacesSegment}`)
    || workspacePath.startsWith(workspacesSegment);
  if (!looksScoutManaged) return false;

  if (input.projectRoot) {
    const expectedPrefix = join(input.projectRoot, SCOUT_WORKSPACES_DIRNAME);
    if (!workspacePath.startsWith(`${expectedPrefix}/`)) return false;
  }

  if (!existsSync(workspacePath)) return false;

  // Prefer a clean `git worktree remove` so git's worktree registry is pruned;
  // fall through to `rm -rf` for clones (no registry) or if the remove fails.
  const isWorktree = !(await isDirectory(join(workspacePath, ".git")));
  if (isWorktree && input.projectRoot) {
    try {
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", workspacePath],
        { cwd: input.projectRoot },
      );
      // `git worktree remove` deletes the dir; prune any dangling registry rows.
      await execFileAsync("git", ["worktree", "prune"], { cwd: input.projectRoot }).catch(() => {});
      if (!existsSync(workspacePath)) return true;
    } catch {
      // fall through to rm
    }
  }

  await rm(workspacePath, { recursive: true, force: true });
  // A removed worktree can leave a stale registry entry — prune it.
  if (isWorktree && input.projectRoot) {
    await execFileAsync("git", ["worktree", "prune"], { cwd: input.projectRoot }).catch(() => {});
  }
  return true;
}
