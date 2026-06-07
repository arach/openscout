# openscout-repo-service

Native Repo Watch scanner prototype.

This crate is the first slice of the "Rust observes, TypeScript interprets"
boundary for Repo Watch. It accepts path hints and scan limits, runs bounded Git
commands, and returns raw repository/worktree state plus scan coverage
diagnostics. It does not know Scout agents, sessions, work items, or attention
rules.

```bash
cargo run --manifest-path crates/openscout-repo-service/Cargo.toml -- scan < request.json
```

Input:

```json
{
  "hints": [{ "path": "/Users/art/dev/openscout", "source": "endpoint" }],
  "limits": {
    "includeDiff": true,
    "includeLastCommit": true,
    "maxRoots": 8,
    "maxWorktrees": 4,
    "maxFilesPerWorktree": 12,
    "scanBudgetMs": 4000
  }
}
```
