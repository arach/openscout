import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getRepoWatchSnapshot,
  parseGitStatusPorcelainV2,
  parseGitWorktreeList,
  repoWatchHintsFromBrokerSnapshot,
  repoWatchHintsFromTailDiscovery,
} from "./repo-watch/index.ts";

let tempRoot = "";
const originalRepoWatchRoots = process.env.OPENSCOUT_REPO_WATCH_ROOTS;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "openscout-repo-watch-"));
  delete process.env.OPENSCOUT_REPO_WATCH_ROOTS;
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
  if (originalRepoWatchRoots === undefined) delete process.env.OPENSCOUT_REPO_WATCH_ROOTS;
  else process.env.OPENSCOUT_REPO_WATCH_ROOTS = originalRepoWatchRoots;
});

describe("repo-watch", () => {
  test("parses Git worktree porcelain output", () => {
    const parsed = parseGitWorktreeList([
      "worktree /Users/me/dev/openscout",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /Users/me/dev/openscout-feature",
      "HEAD def456",
      "detached",
      "",
    ].join("\n"));

    expect(parsed).toEqual([
      {
        path: "/Users/me/dev/openscout",
        head: "abc123",
        branch: "main",
        detached: false,
        bare: false,
      },
      {
        path: "/Users/me/dev/openscout-feature",
        head: "def456",
        branch: null,
        detached: true,
        bare: false,
      },
    ]);
  });

  test("parses Git status porcelain v2 branch and dirty counts", () => {
    const parsed = parseGitStatusPorcelainV2([
      "# branch.oid abc123",
      "# branch.head feature/repo-watch",
      "# branch.upstream origin/feature/repo-watch",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 abc abc src/index.ts",
      "1 A. N... 000000 100644 100644 000 def src/new.ts",
      "? scratch.md",
      "u UU N... 100644 100644 100644 100644 a b c d conflicted.txt",
      "",
    ].join("\n"));

    expect(parsed.branch).toMatchObject({
      name: "feature/repo-watch",
      upstream: "origin/feature/repo-watch",
      ahead: 2,
      behind: 1,
      diverged: true,
    });
    expect(parsed.status.clean).toBe(false);
    expect(parsed.status.staged).toBe(1);
    expect(parsed.status.unstaged).toBe(1);
    expect(parsed.status.untracked).toBe(1);
    expect(parsed.status.conflicts).toBe(1);
  });

  test("builds a snapshot from a real Git repository", async () => {
    const repo = join(tempRoot, "demo");
    mkdirSync(repo, { recursive: true });
    git(repo, ["init", "-b", "main"]);
    writeFileSync(join(repo, "README.md"), "hello\n", "utf8");
    git(repo, ["add", "README.md"]);
    git(repo, ["-c", "user.email=scout@example.test", "-c", "user.name=Scout", "commit", "-m", "initial"]);
    writeFileSync(join(repo, "README.md"), "hello\nworld\n", "utf8");
    writeFileSync(join(repo, "scratch.md"), "scratch\n", "utf8");

    const snapshot = await getRepoWatchSnapshot({
      force: true,
      cacheTtlMs: 0,
      hints: [
        {
          path: repo,
          source: "endpoint",
          agentId: "agent.codex",
          agentName: "Codex",
          agentState: "active",
          sessionId: "session-1",
          harness: "codex",
        },
      ],
    });

    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.totals).toMatchObject({
      projects: 1,
      worktrees: 1,
      dirtyWorktrees: 1,
      attachedAgents: 1,
      attachedSessions: 1,
    });
    const worktree = snapshot.projects[0]!.worktrees[0]!;
    expect(worktree.branch.name).toBe("main");
    expect(worktree.attention).toBe("attention");
    expect(worktree.attentionReasons).toContain("Dirty main");
    expect(worktree.status.unstaged).toBe(1);
    expect(worktree.status.untracked).toBe(1);
    expect(worktree.agents[0]?.id).toBe("agent.codex");
    expect(worktree.sessions[0]?.id).toBe("session-1");
  });

  test("deduplicates Git root probes for repeated path hints", async () => {
    const repo = join(tempRoot, "dedupe");
    mkdirSync(repo, { recursive: true });
    const calls: string[] = [];

    const snapshot = await getRepoWatchSnapshot({
      force: true,
      cacheTtlMs: 0,
      hints: [
        { path: repo, source: "endpoint", agentId: "agent.one" },
        { path: repo, source: "tail-transcript", sessionId: "session.one" },
      ],
      git: async (_cwd, args) => {
        calls.push(args.join(" "));
        if (args.join(" ") === "rev-parse --show-toplevel") return `${repo}\n`;
        if (args.join(" ") === "rev-parse --git-common-dir") return ".git\n";
        if (args.join(" ") === "worktree list --porcelain") {
          return [
            `worktree ${repo}`,
            "HEAD abc123",
            "branch refs/heads/feature",
            "",
          ].join("\n");
        }
        if (args.join(" ") === "status --porcelain=v2 --branch -unormal") {
          return [
            "# branch.oid abc123",
            "# branch.head feature",
            "",
          ].join("\n");
        }
        return "";
      },
    });

    expect(calls.filter((call) => call === "rev-parse --show-toplevel")).toHaveLength(1);
    expect(calls).not.toContain("diff --shortstat");
    expect(calls).not.toContain("log -1 --format=%ct");
    expect(snapshot.totals.attachedAgents).toBe(1);
    expect(snapshot.totals.attachedSessions).toBe(1);
  });

  test("optionally enriches worktrees with diff and commit summaries", async () => {
    const repo = join(tempRoot, "enrichment");
    mkdirSync(repo, { recursive: true });

    const snapshot = await getRepoWatchSnapshot({
      force: true,
      cacheTtlMs: 0,
      includeDiff: true,
      includeLastCommit: true,
      hints: [{ path: repo, source: "environment" }],
      git: async (_cwd, args) => {
        if (args.join(" ") === "rev-parse --show-toplevel") return `${repo}\n`;
        if (args.join(" ") === "rev-parse --git-common-dir") return ".git\n";
        if (args.join(" ") === "worktree list --porcelain") {
          return [
            `worktree ${repo}`,
            "HEAD abc123",
            "branch refs/heads/feature",
            "",
          ].join("\n");
        }
        if (args.join(" ") === "status --porcelain=v2 --branch -unormal") {
          return [
            "# branch.oid abc123",
            "# branch.head feature",
            "",
          ].join("\n");
        }
        if (args.join(" ") === "diff --shortstat") return " 1 file changed, 2 insertions(+)\n";
        if (args.join(" ") === "diff --cached --shortstat") return "";
        if (args.join(" ") === "log -1 --format=%ct") return "1780460000\n";
        return "";
      },
    });

    const worktree = snapshot.projects[0]!.worktrees[0]!;
    expect(worktree.diff.unstagedShortstat).toBe("1 file changed, 2 insertions(+)");
    expect(worktree.diff.stagedShortstat).toBeNull();
    expect(worktree.lastCommitAt).toBe(1_780_460_000_000);
  });

  test("creates hints from broker and tail snapshots", () => {
    const brokerHints = repoWatchHintsFromBrokerSnapshot({
      agents: {
        "agent.one": {
          displayName: "One",
          metadata: { projectRoot: "/Users/example/project-one" },
        },
        "agent.loose": {
          displayName: "Loose",
          metadata: { projectRoot: "/Users/example/loose-project" },
        },
      },
      endpoints: {
        "endpoint.one": {
          id: "endpoint.one",
          agentId: "agent.one",
          projectRoot: "/Users/example/project-one",
          state: "active",
          sessionId: "session-one",
          harness: "codex",
        },
        "endpoint.offline": {
          id: "endpoint.offline",
          agentId: "agent.offline",
          projectRoot: "/Users/example/offline-project",
          state: "offline",
          sessionId: "session-offline",
          harness: "codex",
        },
      },
    });
    const tailHints = repoWatchHintsFromTailDiscovery({
      generatedAt: 1,
      processes: [{
        pid: 42,
        ppid: 1,
        command: "codex",
        etime: "00:01",
        cwd: "/tmp/project-two",
        harness: "unattributed",
        parentChain: [],
        source: "codex",
      }],
      transcripts: [{
        source: "claude",
        transcriptPath: "/tmp/transcript.jsonl",
        sessionId: "session-two",
        cwd: "/tmp/project-three",
        project: "project-three",
        harness: "scout-managed",
        mtimeMs: 1,
        size: 10,
      }],
      totals: {
        total: 1,
        scoutManaged: 1,
        hudsonManaged: 0,
        unattributed: 0,
        transcripts: 1,
      },
    });

    expect(brokerHints.map((hint) => hint.source)).toEqual(["endpoint", "agent"]);
    expect(brokerHints.map((hint) => hint.path)).not.toContain("/Users/example/offline-project");
    expect(tailHints.map((hint) => hint.source)).toEqual(["tail-process", "tail-transcript"]);
  });
});
