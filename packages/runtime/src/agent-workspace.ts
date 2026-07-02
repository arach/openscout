// Agent workspace isolation.
//
// A dispatched agent runs in an isolated git worktree so its edits don't
// clobber the operator's working tree. This module owns the single shared
// implementation that used to be duplicated byte-for-byte inline in the desktop
// and web mobile services.
//
// The only strategy today is `git worktree add` — branch `scout/<agent>` under
// `<projectRoot>/.scout-worktrees/<agent>` — which is exactly the prior behavior
// (this is a pure de-duplication). A copy-on-write (APFS clonefile) strategy,
// workspace teardown, and merge-back were prototyped but deferred; see
// docs/eng/isolation-cow-vs-worktrees.md for the design and the review blockers
// that gate them.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Directory (under the project root) that holds every Scout-created workspace. */
export const SCOUT_WORKSPACES_DIRNAME = ".scout-worktrees";

export interface CreateAgentWorkspaceResult {
  /** Absolute path the agent should run in (its cwdOverride). */
  path: string;
  /** Branch the worktree tracks (`scout/<agent>` unless one was requested). */
  branch: string;
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
 * Materialize an isolated git worktree for `agentName` under
 * `<projectRoot>/.scout-worktrees/<agentName>`, on branch `scout/<agentName>`
 * (or `requestedBranch` when given). An existing worktree at that path is
 * reused as-is.
 *
 * Returns the workspace descriptor, or `null` when the project isn't a git repo
 * (or both `git worktree add` attempts fail) — callers then run the agent in the
 * project root, exactly as before.
 */
export async function createAgentWorkspace(
  projectRoot: string,
  agentName: string,
  requestedBranch?: string,
): Promise<CreateAgentWorkspaceResult | null> {
  if (!(await isGitRepo(projectRoot))) {
    return null;
  }

  const branch = requestedBranch?.trim() || `scout/${agentName}`;
  const workspaceDir = join(projectRoot, SCOUT_WORKSPACES_DIRNAME);
  const workspacePath = join(workspaceDir, agentName);

  // Reuse an existing worktree rather than recreate it.
  if (existsSync(workspacePath)) {
    return { path: workspacePath, branch };
  }

  await mkdir(workspaceDir, { recursive: true });

  try {
    // Create the worktree on a new branch based on current HEAD.
    await execFileAsync("git", ["worktree", "add", "-b", branch, workspacePath], { cwd: projectRoot });
    return { path: workspacePath, branch };
  } catch {
    // Branch might already exist — retry attaching to it without -b.
    try {
      await execFileAsync("git", ["worktree", "add", workspacePath, branch], { cwd: projectRoot });
      return { path: workspacePath, branch };
    } catch {
      // If both fail, fall back to no worktree.
      return null;
    }
  }
}
