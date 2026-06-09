# SCO-064: Native Repo Service

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Native local repository observation for Repo Watch
- **Intent:** Move the filesystem-heavy and Git-subprocess-heavy part of Repo
  Watch into a Rust observer while keeping Scout semantics in the TypeScript
  broker.

## 2. Summary

Repo Watch now has a useful web surface, but its current scanner is implemented
inside the TypeScript runtime. That is acceptable for the first product slice,
but the scanner is exactly the kind of local sensing work Rust should own:
bounded subprocesses, path normalization, Git porcelain parsing, scan budgets,
and eventual filesystem observation.

SCO-064 introduces `openscout-repo-service`, a native repo scanner prototype.
Its first command is intentionally one-shot:

```bash
openscout-repo-service scan < request.json
```

The TypeScript broker continues to:

- build path hints from agents, endpoints, tail discovery, and env roots,
- decide when to scan,
- cache/coalesce results,
- join raw Git state with Scout agents/sessions/work items,
- classify product attention,
- serve the UI-facing `RepoWatchSnapshot`.

The Rust service observes the machine. TypeScript interprets Scout.

## 3. Boundary

The repo service may know:

- hinted local paths,
- Git roots and common Git directories,
- worktree paths,
- branch/head/upstream/ahead/behind facts,
- dirty/conflict/untracked/staged counts,
- bounded changed-file previews,
- optional diff shortstats and last commit times,
- scan limits, coverage, and diagnostics.

The repo service must not know:

- Scout agent identity rules,
- session ownership,
- work item semantics,
- conversation or invocation semantics,
- operator attention policy,
- UI shape beyond a raw scanner contract.

## 4. First Slice

Add `crates/openscout-repo-service` with:

1. `scan` command reading JSON from stdin.
2. Request fields:
   - `hints[]: { path, source?, hintId? }`
   - `limits.maxRoots`
   - `limits.maxWorktrees`
   - `limits.maxFilesPerWorktree`
   - `limits.scanBudgetMs`
   - `limits.includeDiff`
   - `limits.includeLastCommit`
3. Response fields:
   - `schema: "openscout.repo.scan/v1"`
   - `generatedAt`
   - `projects[]`
   - `projects[].worktrees[]`
   - `coverage`
   - `diagnostics[]`
4. Bounded `git` subprocess calls with per-command timeout.
5. Parsers for `git worktree list --porcelain` and
   `git status --porcelain=v2 --branch -unormal`.
6. Unit tests for parsers and a real temporary Git repository scan.

This first slice does not fully replace the TypeScript scanner yet. It creates
the native contract and a TypeScript wrapper path that can call Rust in
rust-or-bust validation mode.

## 5. Server Adapter

`packages/runtime/src/repo-watch/index.ts` can launch the Rust scanner and keep
the existing UI-facing `RepoWatchSnapshot` contract:

- `OPENSCOUT_REPO_WATCH_NATIVE=1` enables the native scanner by default.
- `/v1/repo-watch/snapshot?native=1` enables it for one broker request.
- `OPENSCOUT_REPO_SERVICE_BIN=/path/to/openscout-repo-service` points at a
  prebuilt binary.
- In a repo checkout, the wrapper can run the crate with `cargo run
  --manifest-path crates/openscout-repo-service/Cargo.toml -- scan`.
- If native launch or parsing fails while native mode is enabled, the request
  fails. The TypeScript fallback path is intentionally commented out while Rust
  parity is being validated.

Rust returns raw scan facts. TypeScript still attaches Scout hints, agents, and
sessions; classifies attention; builds stats/totals; and owns cache behavior.

## 6. Replacement Contract

The TypeScript wrapper should eventually do:

```text
broker snapshot
  -> RepoWatchPathHint[]
  -> openscout-repo-service scan
  -> raw repo scan
  -> join hints/agents/sessions/work with raw worktrees
  -> RepoWatchSnapshot
```

The TS scanner remains available only when native mode is not requested.

## 7. Acceptance Criteria

- `npm run repo-service:test` passes.
- `npm run repo-service:check` passes.
- A real temporary Git repo scan reports the expected dirty/untracked status.
- The Rust scanner emits scan coverage and diagnostics without Scout business
  semantics.
- The scanner can include or omit diff/last-commit enrichment by request.
- The crate can be built independently of the supervisor crate.
- Existing TypeScript Repo Watch API remains unchanged whether the wrapper is
  disabled, enabled by env, or enabled per request.

## 8. Follow-Ups

- Add fixture parity tests comparing Rust raw scans to current TS parser output.
- Add a long-running `observe` mode that watches hinted roots and streams raw
  repo change events.
- Decide whether `openscout-repo-service` ships as a separate binary or a
  subcommand of a broader `openscout-native-observer` package.
