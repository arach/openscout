# openscout-repo-service

Native local Git observer for OpenScout. One small Rust binary, invoked one-shot
per request with JSON over stdin/stdout. It runs bounded `git` subprocesses and
returns **raw repository facts** — nothing about Scout agents, sessions, work
items, or operator attention.

> **Boundary:** _Rust observes the machine, TypeScript interprets Scout._ This
> crate is deliberately ignorant of Scout semantics. The TypeScript broker joins
> these raw facts with agents/sessions/work, classifies attention, caches, and
> serves the UI. See [`docs/eng/sco-064-native-repo-service.md`](../../docs/eng/sco-064-native-repo-service.md)
> (scan) and [`docs/eng/sco-065-repo-diff-viewer.md`](../../docs/eng/sco-065-repo-diff-viewer.md)
> (diff).

## Commands

The binary dispatches on `argv[1]` (default `scan`), reads a JSON request from
stdin, and writes a JSON response to stdout. A non-zero exit with a stderr
message signals failure.

| Command | Backs | Schema | Source |
| --- | --- | --- | --- |
| `scan` | Repo Watch (the Repos view) | `openscout.repo.scan/v1` | `src/main.rs` |
| `diff` | Repo Diff Viewer (SCO-065) | `openscout.repo.diff/v1` | `src/diff.rs` |

There is **no `tail` command** — tail is pure TypeScript (`packages/runtime/src/tail`,
`packages/web/server/core/tail`). See [Status & known gaps](#status--known-gaps).

```bash
# In a checkout:
echo '{"hints":[{"path":"."}],"limits":{"includeDiff":true}}' \
  | cargo run -q --manifest-path crates/openscout-repo-service/Cargo.toml -- scan

echo '{"worktreePath":"."}' \
  | cargo run -q --manifest-path crates/openscout-repo-service/Cargo.toml -- diff
```

### `scan` — worktree state across repositories

Takes path **hints** (places agents/endpoints/tail have touched) and resolves
them to Git roots, then reports each worktree's branch and status.

Request:

```json
{
  "hints": [{ "path": "/Users/art/dev/openscout", "source": "endpoint", "hintId": "…" }],
  "limits": {
    "maxRoots": 24,
    "maxWorktrees": 12,
    "maxFilesPerWorktree": 40,
    "scanBudgetMs": 12000,
    "includeDiff": false,
    "includeLastCommit": false
  }
}
```

Response (`projects[].worktrees[]` carries the facts):

```jsonc
{
  "schema": "openscout.repo.scan/v1",
  "generatedAt": 1781028622961,
  "projects": [{
    "root": "/Users/art/dev/openscout",
    "commonGitDir": "/Users/art/dev/openscout/.git",
    "worktrees": [{
      "path": "…", "name": "openscout", "isBare": false,
      "branch": { "name": "main", "upstream": "origin/main", "head": "…",
                  "detached": false, "ahead": 0, "behind": 0,
                  "isMain": true, "diverged": false },
      "status": { "clean": false, "staged": 1, "unstaged": 2, "untracked": 1,
                  "conflicts": 0, "changedFiles": 4,
                  "files": [{ "path": "…", "status": "unstaged" }] },
      "diff": { "unstagedShortstat": "…", "stagedShortstat": null },
      "lastCommitAt": 1781000000000, "scannedAt": 1781028622961
    }]
  }],
  "coverage": { "hintedPaths": 1, "discoveredRoots": 1, "scannedRoots": 1,
                "scannedWorktrees": 1, "cappedRoots": false,
                "scanBudgetReached": false, "…": "…" },
  "diagnostics": []
}
```

Git commands per worktree: `worktree list --porcelain`, `status --porcelain=v2
--branch -unormal`, and (when requested) `diff --shortstat`, `diff --cached
--shortstat`, `log -1 --format=%ct`.

### `diff` — bounded raw diff for one worktree

Rust is authoritative for file identity, status, modes, rename detection, binary
flags, and hunk geometry. It emits Git-compatible patch text plus normalized
file/hunk summaries; the renderer (web Pierre / native) may re-parse the patch
for display but trusts these facts for navigation, filtering, and caching.

Request:

```json
{
  "worktreePath": "/Users/art/dev/openscout",
  "layers": ["unstaged", "staged"],
  "baseRef": null,
  "compareRef": null,
  "paths": [],
  "limits": {
    "maxPatchBytes": 16000000,
    "maxFiles": 2000,
    "maxHunksPerFile": 800,
    "maxLinesPerHunk": 20000,
    "timeoutMs": 20000,
    "includeRawPatch": true,
    "includeParsedHunks": true,
    "includeBinaryPatch": true
  }
}
```

Layers are `unstaged` (`git diff`), `staged` (`git diff --cached`), or `branch`
(`git diff <baseRef> [compareRef]`). **Rust never infers branch refs** — the
`branch` layer requires `baseRef` from TypeScript or it is skipped with a
diagnostic. Each layer carries a `patchOid` — a stable FNV-1a 128-bit hash over
the canonical command + patch bytes, used as a cache key (not a Git object id).

## Invocation & binary resolution

Both consumers go through the shared launcher in
`packages/runtime/src/repo-service/process.ts`:

- `resolveRepoServiceCommand(subcommand)` resolves how to run the binary:
  1. `OPENSCOUT_REPO_SERVICE_BIN` — explicit path to a prebuilt binary (preferred).
  2. Otherwise, in a repo checkout, `cargo run --quiet --manifest-path
     crates/openscout-repo-service/Cargo.toml -- <subcommand>`.
  3. Otherwise `null` → the caller throws `Repo service binary was not found.`
- `runRepoServiceJson(command, input, timeoutMs)` pipes the request JSON to
  stdin, reads stdout JSON, and enforces a **2 MiB** output cap and a timeout
  with SIGTERM→SIGKILL escalation.

### Where it is wired in

| Consumer | Adapter | Enable |
| --- | --- | --- |
| Repo Watch | `repo-watch/index.ts` → `defaultNativeRepoScan` | `OPENSCOUT_REPO_WATCH_NATIVE=1`, or per-request `/v1/repo-watch/snapshot?native=1` (web: `/api/repo-watch?…&native=1`) |
| Repo Diff | `repo-diff/index.ts` → `defaultNativeRepoDiff` | Always native; `getRepoDiffSnapshot` wraps it. Web route `/api/repo-diff/worktree?path=…` |

When Repo Watch native mode is on, there is **no silent TypeScript fallback** —
a launch/parse failure surfaces, by design, so parity gaps are visible.

## Bounds & safety

Defaults lean permissive — we'd rather spend a little longer and return full
context than truncate — but every path is still bounded so a pathological repo
or slow disk can't hang a request:

- **Per-`git` timeout** — 3 s (scan) or the request `timeoutMs` (diff, 20 s
  default); the child is killed on overrun.
- **`diff` fans out** — each layer runs its `--raw`/`--numstat`/`--shortstat`/
  patch reads concurrently, and the layers run concurrently, so a multi-layer
  diff costs ~one slow `git` instead of `layers × reads × timeout`. A tight
  `rev-parse` probe keeps the worst case inside the launcher's kill window.
  (`scan` is still sequential — it normally runs warm in the background.)
- **Scan budget** — `scanBudgetMs` total wall-clock, checked between roots and
  worktrees; emits a `scan_budget` diagnostic and `coverage.scanBudgetReached`.
- **Caps** — `maxRoots`, `maxWorktrees`, `maxFilesPerWorktree` (scan);
  `maxPatchBytes`, `maxFiles`, `maxHunksPerFile`, `maxLinesPerHunk` (diff). Each
  cap sets a `truncated`/`capped*` flag and a diagnostic rather than failing.
- **Coverage + diagnostics** are first-class in every response: what was
  discovered, scanned, skipped (missing path / non-git / unreadable worktree),
  capped, or truncated.
- **UTF-8-lossy** patch decode and char-boundary-safe truncation — non-UTF-8
  bytes never panic the process.

## Testing

```bash
npm run repo-service:test    # cargo test  (9 unit + real-temp-repo integration tests)
npm run repo-service:check   # cargo check
npm run repo-service:fmt     # cargo fmt --check
npm run repo-service:build   # cargo build
```

Tests cover the porcelain parsers (`worktree list`, `status v2`, `diff --raw -z`,
`--numstat -z`), hunk attachment, `patchOid` stability, and end-to-end scans/diffs
against throwaway Git repositories.

## Status & known gaps

Draft (per SCO-064 / SCO-065). The contract is stable and used by both surfaces;
the rough edges are in packaging and breadth, not correctness:

- **Packaging** — no prebuilt-binary or `PATH` resolution yet; production needs
  `OPENSCOUT_REPO_SERVICE_BIN` set, or a checkout for the `cargo run` fallback.
  Prebuilt platform binaries are a follow-up.
- **One-shot only** — no long-running `observe`/watch mode; each request spawns
  a fresh process and re-scans. To avoid a cold scan on the first page visit,
  the web server keeps the broker's Repo Watch snapshot warm: it force-refreshes
  it on an interval (`OPENSCOUT_REPO_WATCH_KEEP_WARM_MS`, default 10s) that stays
  ≤ the cache TTL (15s), and primes it once at startup via `warmupCaches`.
- **`status` path previews** use `--porcelain=v2` **without** `-z`; paths with
  spaces/unicode may be C-quoted and are not unquoted (counts are still exact —
  only the changed-file *preview path* is affected). The `diff` command uses
  `-z` and is unaffected.
- **Borderline boundary facts** — `branch.isMain` (only `main`/`master`) and
  `branch.diverged` are derived heuristics living in Rust; arguably TS
  interpretation. Harmless today, worth watching as the boundary firms up.
- **No Rust `tail`.** Tail remains TypeScript. The planned consolidation is the
  broker-hosted tail firehose (`docs/tail-firehose.md`), which is **TS in the
  broker**, not a Rust observer.

The sibling crate `crates/openscout-supervisor` (SCO-062) is a separate,
unrelated draft — process/service supervision (launchd, broker lifecycle), not
repository observation.
