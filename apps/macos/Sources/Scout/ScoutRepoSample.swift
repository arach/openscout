import Foundation

/// Preview-only sample snapshot for the Repos section.
///
/// Activated by setting `OPENSCOUT_REPOS_SAMPLE=1` in the environment — when set,
/// `ScoutRepoStore` decodes this fixture instead of polling the broker, so the
/// section can be exercised (density, sorting, the clean-idle fold, drift flags,
/// agents) without a broker that serves `/v1/repo-watch/snapshot`. It is inert
/// unless the env var is present, so it never affects normal runs.
///
/// The JSON is the real wire shape, decoded through the same `RepoWatchSnapshot`
/// path as live data. `generatedAt` and `lastCommitAt` are fixed epoch-ms so the
/// relative "ago" labels are deterministic.
enum ScoutRepoSample {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.environment["OPENSCOUT_REPOS_SAMPLE"] != nil
    }

    static func snapshot() -> RepoWatchSnapshot? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(RepoWatchSnapshot.self, from: data)
    }

    // generatedAt anchor: 2026-06-05T16:00:00Z = 1780156800000 ms.
    private static let json = """
    {
      "generatedAt": 1780156800000,
      "totals": {
        "projects": 3,
        "worktrees": 7,
        "dirtyWorktrees": 4,
        "conflictedWorktrees": 1,
        "attentionWorktrees": 2,
        "attachedAgents": 3,
        "attachedSessions": 1
      },
      "warnings": ["sample data — OPENSCOUT_REPOS_SAMPLE is set; this is not live broker data"],
      "projects": [
        {
          "id": "repo:hudson",
          "name": "hudson",
          "root": "/Users/art/dev/hudson",
          "commonGitDir": "/Users/art/dev/hudson/.git",
          "attention": "critical",
          "attentionReasons": ["merge conflicts in main", "vantage worktree scan failed"],
          "stats": {
            "worktrees": 2, "dirtyWorktrees": 1, "conflictedWorktrees": 1,
            "attachedAgents": 1, "attachedSessions": 0,
            "staged": 0, "unstaged": 0, "untracked": 0, "conflicts": 2
          },
          "hints": [],
          "worktrees": [
            {
              "id": "wt:hudson-main",
              "path": "/Users/art/dev/hudson",
              "name": "hudson",
              "isBare": false,
              "branch": { "name": "main", "upstream": "origin/main", "head": "9f3c1a2b7e", "detached": false, "ahead": 0, "behind": 3, "isMain": true, "diverged": false },
              "status": {
                "clean": false, "staged": 0, "unstaged": 0, "untracked": 0, "conflicts": 2, "changedFiles": 2,
                "files": [
                  { "path": "packages/native/apple/HudsonKit/Sources/HudsonUI/Tokens/HudPalette.swift", "status": "conflict" },
                  { "path": "packages/native/apple/HudsonKit/Sources/HudsonUI/Primitives/HudBadge.swift", "status": "conflict" }
                ]
              },
              "diff": { "unstagedShortstat": null, "stagedShortstat": null },
              "attention": "critical",
              "attentionReasons": ["2 merge conflicts", "behind origin/main by 3"],
              "agents": [{ "id": "agent:codex:hudson", "name": "codex", "state": "active", "harness": "codex" }],
              "sessions": [],
              "hints": [],
              "lastCommitAt": 1780146000000,
              "scannedAt": 1780156800000,
              "error": null
            },
            {
              "id": "wt:hudson-vantage",
              "path": "/Users/art/dev/hudson/apps/vantage",
              "name": "vantage",
              "isBare": false,
              "branch": { "name": null, "upstream": null, "head": "deadbeef12", "detached": true, "ahead": 0, "behind": 0, "isMain": false, "diverged": false },
              "status": { "clean": true, "staged": 0, "unstaged": 0, "untracked": 0, "conflicts": 0, "changedFiles": 0, "files": [] },
              "diff": { "unstagedShortstat": null, "stagedShortstat": null },
              "attention": "unknown",
              "attentionReasons": ["scan failed"],
              "agents": [],
              "sessions": [],
              "hints": [],
              "lastCommitAt": null,
              "scannedAt": 1780156800000,
              "error": "fatal: not a git repository (or any parent up to mount point /)"
            }
          ]
        },
        {
          "id": "repo:openscout",
          "name": "openscout",
          "root": "/Users/art/dev/openscout",
          "commonGitDir": "/Users/art/dev/openscout/.git",
          "attention": "attention",
          "attentionReasons": ["3 dirty worktrees", "feat/macos-repos diverged from upstream"],
          "stats": {
            "worktrees": 4, "dirtyWorktrees": 3, "conflictedWorktrees": 0,
            "attachedAgents": 2, "attachedSessions": 1,
            "staged": 3, "unstaged": 4, "untracked": 1, "conflicts": 0
          },
          "hints": [],
          "worktrees": [
            {
              "id": "wt:os-main",
              "path": "/Users/art/dev/openscout",
              "name": "openscout",
              "isBare": false,
              "branch": { "name": "main", "upstream": "origin/main", "head": "abc1234def", "detached": false, "ahead": 2, "behind": 0, "isMain": true, "diverged": false },
              "status": {
                "clean": false, "staged": 0, "unstaged": 3, "untracked": 1, "conflicts": 0, "changedFiles": 4,
                "files": [
                  { "path": "packages/web/client/scout/repo-watch/ui.ts", "status": "unstaged" },
                  { "path": "packages/runtime/src/broker-daemon.ts", "status": "unstaged" },
                  { "path": "docs/agent/README.agent.md", "status": "unstaged" },
                  { "path": "notes/scratch.md", "status": "untracked" }
                ]
              },
              "diff": { "unstagedShortstat": "4 files changed, 128 insertions(+), 12 deletions(-)", "stagedShortstat": null },
              "attention": "active",
              "attentionReasons": ["dirty", "ahead of origin/main by 2"],
              "agents": [{ "id": "agent:hudson-logo:os", "name": "Hudson Logo", "state": "active", "harness": "claude" }],
              "sessions": [{ "id": "sess-aaa111bbb", "source": "claude", "harness": "claude" }],
              "hints": [],
              "lastCommitAt": 1780156440000,
              "scannedAt": 1780156800000,
              "error": null
            },
            {
              "id": "wt:os-web-design",
              "path": "/Users/art/dev/openscout-web",
              "name": "openscout-web",
              "isBare": false,
              "branch": { "name": "feat/web-design-system", "upstream": "origin/feat/web-design-system", "head": "77aa11cc99", "detached": false, "ahead": 1, "behind": 0, "isMain": false, "diverged": false },
              "status": {
                "clean": false, "staged": 2, "unstaged": 1, "untracked": 0, "conflicts": 0, "changedFiles": 3,
                "files": [
                  { "path": "packages/web/client/scout/slots/Inspector.tsx", "status": "staged" },
                  { "path": "packages/web/client/screens/PlanView.tsx", "status": "staged+unstaged" },
                  { "path": "packages/web/client/lib/router.ts", "status": "unstaged" }
                ]
              },
              "diff": { "unstagedShortstat": "1 file changed, 9 insertions(+), 2 deletions(-)", "stagedShortstat": "2 files changed, 64 insertions(+), 8 deletions(-)" },
              "attention": "active",
              "attentionReasons": ["dirty", "ahead of upstream by 1"],
              "agents": [{ "id": "agent:claude:web", "name": "claude", "state": "active", "harness": "claude" }],
              "sessions": [],
              "hints": [],
              "lastCommitAt": 1780155300000,
              "scannedAt": 1780156800000,
              "error": null
            },
            {
              "id": "wt:os-macos-repos",
              "path": "/Users/art/dev/openscout-rw",
              "name": "openscout-rw",
              "isBare": false,
              "branch": { "name": "feat/macos-repos", "upstream": "origin/feat/macos-repos", "head": "9d9142e4e3", "detached": false, "ahead": 1, "behind": 1, "isMain": false, "diverged": true },
              "status": {
                "clean": false, "staged": 1, "unstaged": 0, "untracked": 0, "conflicts": 0, "changedFiles": 1,
                "files": [
                  { "path": "apps/macos/Sources/Scout/ScoutReposView.swift", "status": "staged" }
                ]
              },
              "diff": { "unstagedShortstat": null, "stagedShortstat": "1 file changed, 980 insertions(+)" },
              "attention": "attention",
              "attentionReasons": ["diverged from origin/feat/macos-repos (ahead 1, behind 1)"],
              "agents": [],
              "sessions": [],
              "hints": [],
              "lastCommitAt": 1780156200000,
              "scannedAt": 1780156800000,
              "error": null
            },
            {
              "id": "wt:os-release",
              "path": "/Users/art/dev/openscout-release",
              "name": "openscout-release",
              "isBare": false,
              "branch": { "name": "release/2026.05", "upstream": "origin/release/2026.05", "head": "55ee44dd33", "detached": false, "ahead": 0, "behind": 0, "isMain": false, "diverged": false },
              "status": { "clean": true, "staged": 0, "unstaged": 0, "untracked": 0, "conflicts": 0, "changedFiles": 0, "files": [] },
              "diff": { "unstagedShortstat": null, "stagedShortstat": null },
              "attention": "quiet",
              "attentionReasons": [],
              "agents": [],
              "sessions": [],
              "hints": [],
              "lastCommitAt": 1780070400000,
              "scannedAt": 1780156800000,
              "error": null
            }
          ]
        },
        {
          "id": "repo:vox",
          "name": "vox",
          "root": "/Users/art/dev/vox",
          "commonGitDir": "/Users/art/dev/vox/.git",
          "attention": "quiet",
          "attentionReasons": [],
          "stats": {
            "worktrees": 1, "dirtyWorktrees": 0, "conflictedWorktrees": 0,
            "attachedAgents": 0, "attachedSessions": 0,
            "staged": 0, "unstaged": 0, "untracked": 0, "conflicts": 0
          },
          "hints": [],
          "worktrees": [
            {
              "id": "wt:vox-main",
              "path": "/Users/art/dev/vox",
              "name": "vox",
              "isBare": false,
              "branch": { "name": "main", "upstream": "origin/main", "head": "11bb22cc44", "detached": false, "ahead": 0, "behind": 0, "isMain": true, "diverged": false },
              "status": { "clean": true, "staged": 0, "unstaged": 0, "untracked": 0, "conflicts": 0, "changedFiles": 0, "files": [] },
              "diff": { "unstagedShortstat": null, "stagedShortstat": null },
              "attention": "quiet",
              "attentionReasons": [],
              "agents": [],
              "sessions": [],
              "hints": [],
              "lastCommitAt": 1779984000000,
              "scannedAt": 1780156800000,
              "error": null
            }
          ]
        }
      ]
    }
    """
}
