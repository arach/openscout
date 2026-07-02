import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAgentWorkspace,
  teardownAgentWorkspace,
  SCOUT_WORKSPACES_DIRNAME,
} from "./agent-workspace.js";

const tempRoots: string[] = [];

function makeRepo(withNodeModules = false): string {
  const root = mkdtempSync(join(tmpdir(), "scout-ws-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Tester"], { cwd: root });
  writeFileSync(join(root, "README.md"), "hi\n");
  if (withNodeModules) {
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports=1\n");
  }
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

function makeNonGitDir(): string {
  const root = mkdtempSync(join(tmpdir(), "scout-plain-"));
  tempRoots.push(root);
  writeFileSync(join(root, "file.txt"), "hi\n");
  return root;
}

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("createAgentWorkspace", () => {
  test("materializes a runnable workspace under .scout-worktrees with .git", async () => {
    const root = makeRepo(true);

    const result = await createAgentWorkspace(root, "explorer");
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.path).toBe(join(root, SCOUT_WORKSPACES_DIRNAME, "explorer"));
    expect(result.branch).toBe("scout/explorer");
    expect(existsSync(result.path)).toBe(true);
    // The workspace is a real git repo (whichever strategy ran).
    expect(existsSync(join(result.path, ".git"))).toBe(true);
    // Source-tracked content is present.
    expect(existsSync(join(result.path, "README.md"))).toBe(true);

    // Whatever strategy ran, the workspace must be on the requested branch.
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: result.path,
    }).toString().trim();
    expect(branch).toBe("scout/explorer");

    if (result.kind === "cow-clone") {
      // A COW clone carries node_modules verbatim (the headline win); a worktree
      // fallback would not, so only assert this for the clone path.
      expect(existsSync(join(result.path, "node_modules", "dep", "index.js"))).toBe(true);
      // The clone must not recurse into its own workspaces dir.
      const nested = join(result.path, SCOUT_WORKSPACES_DIRNAME, "explorer");
      expect(existsSync(nested)).toBe(false);
    }
  });

  test("honors a requested branch name", async () => {
    const root = makeRepo();
    const result = await createAgentWorkspace(root, "explorer", "feature/x");
    expect(result?.branch).toBe("feature/x");
  });

  test("reuses an existing workspace rather than recreating it", async () => {
    const root = makeRepo();
    const first = await createAgentWorkspace(root, "explorer");
    expect(first).not.toBeNull();
    writeFileSync(join(first!.path, "marker.txt"), "keep\n");

    const second = await createAgentWorkspace(root, "explorer");
    expect(second?.path).toBe(first?.path);
    // Reuse means the marker survives (no recreate).
    expect(existsSync(join(second!.path, "marker.txt"))).toBe(true);
  });

  test("returns null for a non-git directory", async () => {
    const root = makeNonGitDir();
    const result = await createAgentWorkspace(root, "explorer");
    expect(result).toBeNull();
  });
});

describe("teardownAgentWorkspace", () => {
  test("removes a workspace it created", async () => {
    const root = makeRepo(true);
    const result = await createAgentWorkspace(root, "explorer");
    expect(result).not.toBeNull();
    if (!result) return;

    const removed = await teardownAgentWorkspace({
      workspacePath: result.path,
      projectRoot: root,
    });
    expect(removed).toBe(true);
    expect(existsSync(result.path)).toBe(false);

    // A worktree fallback also prunes the git registry — no dangling entry.
    if (result.kind === "git-worktree") {
      const list = execFileSync("git", ["worktree", "list"], { cwd: root }).toString();
      expect(list.includes(result.path)).toBe(false);
    }
  });

  test("no-ops when the workspace is already gone", async () => {
    const root = makeRepo();
    const removed = await teardownAgentWorkspace({
      workspacePath: join(root, SCOUT_WORKSPACES_DIRNAME, "ghost"),
      projectRoot: root,
    });
    expect(removed).toBe(false);
  });

  test("refuses to remove a path outside .scout-worktrees", async () => {
    const root = makeRepo();
    // The project root itself must never be torn down.
    const removed = await teardownAgentWorkspace({ workspacePath: root, projectRoot: root });
    expect(removed).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  test("refuses to remove a .scout-worktrees path under a different project root", async () => {
    const rootA = makeRepo();
    const rootB = makeRepo();
    const workspaceUnderA = join(rootA, SCOUT_WORKSPACES_DIRNAME, "explorer");
    mkdirSync(workspaceUnderA, { recursive: true });
    writeFileSync(join(workspaceUnderA, "keep.txt"), "x\n");

    // Claiming rootB owns a workspace that actually lives under rootA must fail.
    const removed = await teardownAgentWorkspace({
      workspacePath: workspaceUnderA,
      projectRoot: rootB,
    });
    expect(removed).toBe(false);
    expect(existsSync(workspaceUnderA)).toBe(true);
  });
});
