# Derived-state retention

Status: implemented but not installed · 2026-07-30

## Decision

There are two independent defects and two independent controls:

1. **Git copies are not retired after merge.** Keep clones/worktrees fully
   capable. Register ownership and lifetime when an agent creates one; request
   retirement in the merge flow; let a janitor remove only expired or
   retire-requested copies whose Git state makes deletion arithmetic.
2. **OpenScout Studio persists an unbounded-for-our-purposes dev cache.** Keep
   lazy `next dev`, but disable Next 16's cross-restart Turbopack filesystem
   cache. A separate guarded script handles the already-existing cache.

This supersedes the proposed "canonical tree runs, copies only assemble"
role split. Duplication is useful isolation; failed retirement is the defect.

## What was measured

Measurements were read-only. Sizes below are `du` rankings, **not physical
reclaim estimates**; bun/APFS clonefile sharing makes `node_modules` especially
misleading. Only `df /System/Volumes/Data` before and after an approved removal
can measure reclaim.

### Copies and derived state

The current canonical Git store reports **26 worktrees**, not about 17. With
one matching independent clone, the roster finds **27 Git copies** total. Ten
are under `~/dev`, not 13. Three other similarly named `~/dev` directories
(`ext/openscout`, `openscout-185`, `openscout-worktrees`) are not Git working
trees and therefore are not clones.

The reproducible read-only inventory command is:

```bash
bun run derived:inventory
```

Observed totals across distinct derived directories:

| Class | Directories | `du` total | Interpretation |
| --- | ---: | ---: | --- |
| `node_modules` | 161 | 16.81 GiB | Strongly clone-shared; not a reclaim number |
| Swift `.build` | 5 | 6.95 GiB | Independently generated |
| `.next` | 4 | 6.03 GiB | Independently generated |
| Xcode derived dirs | 1 | 5.55 GiB | Independently generated |

The original cost claim cannot be proven physically under the no-delete
constraint: APFS exposes no useful per-path exclusive-block number here. The
inventory does show 12.98 GiB `du` in independent `.next` + `.build` versus
16.81 GiB in clonefile-heavy `node_modules`; the latter is expected to reclaim
far less than its headline size, but this run did not pretend that expectation
was a measurement. The revised post-merge design does not depend on which side
wins that comparison.

The safety cases named in the incident were reproduced:

- `~/.codex/worktrees/063e`: clean detached HEAD, one commit absent from every
  remote/ref; `keep:orphan`.
- `~/.codex/worktrees/4d2a`: clean detached HEAD, five such commits;
  `keep:orphan`.
- `~/.codex/worktrees/c50e`: dirty, detached, unmerged, one unpushed commit;
  `keep:dirty` before any other predicate can matter.

The roster also found additional dirty copies. Conversely, two clean, merged,
remote-reachable worktrees currently classify `review:unregistered`; they are
safe in Git terms but the janitor will not infer ownership/lifetime retroactively.

### Studio

Current source and cache measurements:

| Item | Observed |
| --- | ---: |
| `app` + `views` + `components` | 6,304 KiB (6.16 MiB) |
| `.next` | 4.73 GiB |
| `.next/dev/cache/turbopack` | 3.42 GiB |
| persistent-cache files | 2,562 |
| oldest cache file / cache birth | 2026-07-27 12:39 local |
| routes (`app/**/page.tsx`) | 37 |

The cache/source ratio is about **568×**, agreeing with the incident framing.
It accumulated in roughly three days, not weeks, so a long TTL would still
permit multi-GiB growth.

No new benchmark was launched: another agent's `next dev` was active, the tree
was dirty, and free space fell during the investigation. Existing local Next
traces preserve the required comparison without changing cache state:

- `.next/trace`: webpack `next-build`, 2026-07-29 15:38, **25.525 s**.
- `.next/dev/trace`: first request in the first cache session, whose start time
  matches cache creation, **3.464 s** for one study route after a **0.522 s**
  server setup span.

That is about **7.4× less request latency** than compiling all routes, before
counting the review value of Fast Refresh. This is historical local evidence,
not a controlled same-revision rerun, but it is decisive enough to retain lazy
dev mode rather than force a production build for each agent review.

Installed Next is 16.2.6. Both its local schema/defaults and the official
[`turbopackFileSystemCache` documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache)
confirm that `experimental.turbopackFileSystemCacheForDev` exists and defaults
on. The documented interface is Boolean; no operator-configurable byte cap or
TTL was found. `next.config.mjs` now sets it to `false`.

Cost: a new dev process recompiles the first requested route (historically
about 3.5 s) instead of restoring it across restarts. In-process incremental
compilation and Fast Refresh remain. The existing 3.42 GiB cache is not removed
by the config change; `studio-cache.py` handles that once the active server exits.

## Git-copy mechanism

### Registration convention

Metadata lives outside working trees at:

```text
~/.local/state/openscout/derived-state/worktrees/<path-hash>.json
```

This avoids dirtying the copy being tracked. Schema version 1 records absolute
path, normalized origin, owner, task id, created/updated timestamps, expected
lifetime, expiry, and lifecycle state. Agents register immediately after copy
creation:

```bash
python3 scripts/derived-state/register.py register \
  --path /path/to/copy \
  --owner 'scout-agent-or-session-handle' \
  --task-id 'pr:525' \
  --lifetime-hours 72
```

`AGENTS.md` makes this a repo practice. The actual Claude `/commit` definition
on this machine is `~/.claude/commands/commit.md` (not a skill under
`~/.claude/skills/`); it now requests retirement after a confirmed merge and
attempts a policy-checked reap. An active agent usually prevents immediate
removal, so the request remains queued for the janitor.

One framing correction matters: before this change, that `/commit` command did
not itself create or merge PRs; it committed/pushed and offered PR creation.
The new retirement step is conditional on the same flow actually receiving and
confirming a merge. It never mistakes a push or open PR for the decision point.

### Eligibility

Automated removal requires **all** of the following at action time:

1. path is a discovered OpenScout copy under an allowlisted root and is not the
   canonical checkout;
2. registration is expired or explicitly `retire-requested`;
3. no tracked or untracked changes;
4. no ignored non-derived content such as local configuration/secrets;
5. no live process has a cwd inside the copy or names it in its command;
6. HEAD is an ancestor of the locally observed origin default branch;
7. a remote ref contains HEAD and `HEAD --not --remotes` is empty;
8. the path is not symlinked and origin still matches.

Safety beats age. Dirty, unmerged, unpushed, active, and orphan-risk copies are
kept indefinitely. A squash/rebase merge whose original commit is not reachable
does not pass merely because its patch appears upstream. Unregistered safe
copies go to `attention.txt` for a human instead of being guessed at.

Linked worktrees are removed with `git worktree remove --force` only after the
independent ignored-file check; a surviving worktree manages the common Git
dir and `git worktree prune` follows. Independent clones require the stricter
remote-reachability test before directory removal. Applied runs record the
before/after Data-volume free bytes in retired metadata.

### Commands

```bash
# Full human roster: path, kind, branch, dirty, merged, unpushed, orphan risk,
# du-ranked size, approximate last-touch, owner/expiry, policy decision.
bun run derived:roster

# Machine-readable roster.
python3 scripts/derived-state/roster.py --format json

# Dry-run janitor (default).
bun run derived:janitor

# Explicit action. Only registered eligible copies can be removed.
python3 scripts/derived-state/reap.py --fetch --apply

# Studio legacy cache inspection / explicit removal.
bun run --cwd design/studio cache:status
python3 scripts/derived-state/studio-cache.py --apply
```

`install-launch-agent.sh` is also dry-run by default. With `--apply` it installs
a six-hour launchd job, but deliberately does not kick off a cleanup at install
time. Each run overwrites a bounded `janitor-last.log`; only `review:*` cases
are copied to `attention.txt`. **This task did not install it.**

## Why the alternatives lose

- **Execution guard / canonical-only role split:** solves the wrong problem and
  prevents legitimate isolated builds/tests before merge.
- **Shared `.next` or Swift scratch roots:** cross-branch invalidation and
  concurrency make them less inspectable and less safe than retirement.
  `node_modules` already receives APFS clonefile sharing.
- **Git hook alone:** local hooks observe checkout/commit, not the GitHub merge
  that makes reachability decidable, and harness-created worktrees can bypass a
  wrapper. The merge flow plus an expiry janitor covers both paths.
- **Blanket launchd cache/worktree deletion:** reacts after growth and cannot
  decide pre-merge intent. The launchd job is only an executor for registered
  policy and exact studio derived state.
- **Built Studio as the default:** measured full-build latency is much larger
  than the one-route review path and recompiles 37 routes needlessly.
- **Studio TTL:** a 3.42 GiB cache formed in three days. Disabling the specific
  persistence feature is simpler and bounds it at zero across restarts; no TTL
  state or periodic race is needed.

## Deliberate non-goals and operational state

- No repo copy, cache, branch, worktree, process, or existing user file was
  removed during this implementation.
- No branch/ref was switched, reset, staged, committed, or fetched.
- The launchd job is delivered but not installed; the operator controls that
  decision.
- The tools manage OpenScout copies matching the canonical origin. Similar-name
  non-Git directories and other repositories remain survey/operator concerns.
- Last-touch is an approximation from per-worktree Git/index/reflog, changed
  files, and known derived-root mtimes; it is displayed for judgment but is not
  an automated deletion predicate.
- Physical class-by-class reclaim remains unmeasured because deletion was
  forbidden. Applied tools measure `df`, never claim `du` as reclaim.

The Data volume was 15 GiB free / 93% used at the first check and 8.8 GiB free /
96% used at the final measurement while other Studio/macOS processes were
active. No benchmark or deletion was run. Treat the machine as critical until
the operator chooses an approved action.
