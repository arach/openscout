# Copy-on-write workspaces vs. git worktrees for agent isolation

> **Status:** design / learning doc. This is "how omp does it, and how Scout
> *might* adopt something similar" — not a committed spec. All `crates/…` and
> `packages/coding-agent/…` citations point into the omp (oh-my-pi) reference
> clone at `/Users/art/dev/ext/oh-my-pi`. Scout citations point into this repo.

## TL;DR

omp isolates each subagent in a **copy-on-write (COW) clone of the repo
directory** rather than a git worktree. On macOS that clone is a single
`clonefile(2)` syscall: near-instant, and the clone shares on-disk blocks with
the original until something is written. A cross-platform **PAL** (platform
abstraction layer) called `pi-iso` wraps one COW mechanism per filesystem
(`apfs`, `btrfs`, `zfs`, `reflink`, `overlayfs`, `projfs`, `block-clone`) and
falls back to `rcopy` (git worktree, or plain recursive copy) when no COW path
is available. Changes come back as a **git diff / patch** or a **cherry-picked
branch** (`omp/task/<id>`). Scout today isolates dispatched agents with a real
`git worktree add` and never merges back or tears down; adopting the COW model —
starting with macOS APFS — would make spawn faster, give every clone a populated
`node_modules`/`.git` for free, and let us add the merge-back that Scout
currently lacks.

---

## Part 1 — Per-backend mechanism

The PAL contract is one trait, `IsolationBackend`, with three lifecycle methods
plus a change-capture method
(`crates/pi-iso/src/lib.rs:224-246`):

```rust
fn start(&self, lower: &Path, merged: &Path) -> IsoResult<()>;  // materialize
fn stop(&self, merged: &Path) -> IsoResult<()>;                 // tear down
async fn diff(&self, lower: &Path, merged: &Path) -> IsoResult<Diff>; // capture
```

`lower` is the read-only source tree (the repo); `merged` is where the writable
view is materialized (the isolated workspace). Each backend is a zero-state unit
struct handed out as a `&'static dyn` (`lib.rs:253-277`). The napi shim
(`crates/pi-natives/src/iso.rs`) exposes `iso_resolve` / `iso_start` /
`iso_stop` / `iso_diff` to the TypeScript side, wrapping the blocking syscalls
in `spawn_blocking` so JS gets a normal Promise (`iso.rs:131-151`).

### macOS APFS — `clonefile(2)`

The whole tree is cloned in **one syscall** (`crates/pi-iso/src/apfs.rs:98`):

```rust
let rc = unsafe { libc::clonefile(src_c.as_ptr(), dst_c.as_ptr(), 0) };
```

`clonefile(2)` recursively reflinks an entire directory tree. Both paths share
the same on-disk extents; APFS does per-block copy-on-write the moment either
side writes. From the caller's perspective `merged` is a fully independent
directory — there's no mount to undo, so `stop` is just `remove_dir_all`
(`apfs.rs:115-124`). Before cloning, any stale `merged` is removed because
`clonefile` refuses to overwrite (`apfs.rs:84-89`). If the volume can't reflink
(`ENOTSUP`/`EOPNOTSUPP`) or the clone would cross devices (`EXDEV`), it returns
`IsoError::Unavailable` so the resolver falls back (`apfs.rs:103-111`).

> The macOS `cp` equivalent is `cp -c` (which calls `copyfile(3)` with
> `COPYFILE_CLONE`). omp calls `clonefile` directly rather than shelling `cp`.

### Linux reflink — `FICLONE` ioctl (btrfs, XFS+reflink, bcachefs, OCFS2)

Linux has no recursive `clonefile`, so this backend **walks the tree** and
reflinks each regular file with the `FICLONE` ioctl
(`crates/pi-iso/src/linux_reflink.rs:83`, `:214`):

```rust
const FICLONE: libc::c_ulong = 0x4004_9409;
let rc = unsafe { libc::ioctl(dst_file.as_raw_fd(), FICLONE, src_file.as_raw_fd()) };
```

Directories and symlinks are recreated; regular files are extent-shared until
written (`recursive_reflink`, `linux_reflink.rs:155-188`). Permissions and
mtimes are preserved (`:241-270`) — the mtime preservation matters because the
plain-mode diff uses `(size, mtime)` as a fast-path (see Part 2). Cross-device
or unsupported filesystems (`EXDEV`, `EOPNOTSUPP`, `ENOTTY`, `EINVAL`,
`ENOSYS`) map to `Unavailable` (`:226-239`).

### Linux btrfs — `btrfs subvolume snapshot`

When `lower` is a btrfs subvolume, a **single O(1) writable snapshot** is created
by shelling the `btrfs` CLI (`crates/pi-iso/src/btrfs.rs:98-101`):

```
btrfs subvolume snapshot <lower> <merged>
```

`stop` runs `btrfs subvolume delete`, falling back to `rm -rf` if the target
turned out not to be a subvolume (`btrfs.rs:172-201`). `probe` checks the CLI is
on PATH (`:74-92`); "not a btrfs filesystem"/"not a subvolume" errors map to
`Unavailable` (`:235-251`).

### ZFS — dataset snapshot + clone

Only accepts a `lower` path that is *exactly* a mounted ZFS dataset mountpoint
(`crates/pi-iso/src/zfs.rs:89-94`). It snapshots the dataset and clones it to a
sibling dataset mounted at `merged` (`zfs.rs:111-114`):

```
zfs snapshot   <dataset>@pi-iso-<hash>
zfs clone -o mountpoint=<merged> <dataset>@pi-iso-<hash> <sibling>
```

Teardown is careful: it refuses to destroy a dataset it didn't create by
checking the snapshot/clone name prefix and the clone's `origin` property
(`zfs.rs:123-150`, `is_own_clone` at `:327`). This is the only backend that
mutates global filesystem state (datasets), hence the ownership guard.

### Linux overlayfs — `lowerdir`/`upperdir`/`workdir` mount

Stacks a kernel `overlay` filesystem so `merged` is a union of the read-only
`lower` and a writable `upper`, with a required scratch `work` dir
(`crates/pi-iso/src/overlayfs.rs:132-137`):

```rust
let opts = format!("lowerdir={lower},upperdir={upper},workdir={work}");
libc::mount("overlay", merged, "overlay", 0, opts);   // overlayfs.rs:194
```

`upper`/`work` are siblings of `merged` so one `rm -rf` of the base dir cleans
everything (`:114-130`). If the kernel mount is denied — typically `EPERM`
outside a user namespace, or `ENODEV` when the module is absent — it falls back
to **`fuse-overlayfs(1)`** (`:146-152`, `fuse_mount` at `:239`). The chosen
flavor is remembered per-mount so `stop` dispatches `umount2` vs
`fusermount3 -u` correctly (`ACTIVE_MOUNTS`, `:95`, `stop` at `:157-185`).
This is the one backend where `merged` is *not* a physical copy — writes land in
`upper`, which makes change-capture cheaper in principle (scan `upper`) though
omp's default diff still uses the git path.

### Windows ProjFS — Projected File System

`merged` is a **virtualized** directory: files don't physically exist until
touched. omp marks the projection root as a placeholder
(`PrjMarkDirectoryAsPlaceholder`) and starts virtualization
(`PrjStartVirtualizing`) with callbacks that lazily enumerate directories and
stream file data from `lower` on demand (`crates/pi-iso/src/projfs.rs:362-399`;
`get_file_data_callback` at `:642`). The whole ProjFS API is `LoadLibrary`'d at
runtime from `ProjectedFSLib.dll` (`ProjfsApi::load`, `:237`). It's disabled
under x64-on-ARM64 emulation because the callbacks crash there (`:36-40`).
`stop` calls `PrjStopVirtualizing` (`:445-467`).

### Windows block-clone — `FSCTL_DUPLICATE_EXTENTS_TO_FILE` (ReFS/NTFS)

The Windows analogue of reflink: walk the tree, and for each file ask the
filesystem to share extents copy-on-write via a `DeviceIoControl` FSCTL
(`crates/pi-iso/src/windows_block_clone.rs:280-291`):

```rust
DeviceIoControl(dst, FSCTL_DUPLICATE_EXTENTS_TO_FILE, &data, …)
```

The destination must be pre-sized with `set_len` before the FSCTL
(`:247-253`). Unsupported filesystems / cross-volume (`ERROR_NOT_SUPPORTED`,
`ERROR_NOT_SAME_DEVICE`, …) map to `Unavailable` (`:312-325`). `stop` is a
recursive remove that clears the readonly attribute first (`:104-108`,
`clear_readonly` at `:159`).

### rcopy — the universal fallback (git worktree OR recursive copy)

Always available (`probe` returns available unconditionally,
`crates/pi-iso/src/rcopy.rs:28-34`). Two sub-modes:

- **`lower` is a git tree** → `git worktree add --detach <merged> HEAD`
  (`rcopy.rs:120-148`). Because `worktree add` lands on a *clean* HEAD checkout,
  it then **re-seeds the dirty working state** to mirror `lower`'s live tree:
  staged diff applied `--cached` and to the tree, unstaged diff applied to the
  tree, and untracked files copied in (`seed_dirty_state`, `:187-216`). This is
  the mechanism most similar to Scout's current approach — but note omp uses it
  only as a *fallback*, and it still reproduces the live dirty state, which
  Scout's plain `worktree add -b` does not.
- **non-git tree** → plain `recursive_copy` preserving modes/mtimes
  (`:318-350`). Full filesystem-copy cost up front; `rm -rf` on teardown.

### `auto` resolution and the fallback candidate list

`BackendKind::native()` is the per-OS default: APFS on macOS, overlayfs on
Linux, ProjFS on Windows, rcopy elsewhere (`lib.rs:106-123`). But `auto`
resolution walks a *broader* preference order that tries filesystem-native
snapshot/reflink first and keeps rcopy last (`lib.rs:126-140`):

- macOS: `[apfs, zfs, rcopy]`
- Linux: `[btrfs, zfs, linux-reflink, overlayfs, rcopy]`
- Windows: `[windows-block-clone, projfs, rcopy]`

`resolve(preferred)` (`lib.rs:338-373`) is a **host-level probe only**:

1. If `preferred` is given and its `probe()` is available, use it.
2. Otherwise walk `auto_order()`, skipping `preferred`, keeping every available
   candidate.
3. rcopy is the guaranteed final candidate.

It returns a `Resolution { kind, candidates, fell_back, reason }` — the whole
ordered candidate list, not just one choice. That matters because probe is only
a *host* check; a backend can still reject a specific `lower`/`merged` pair at
`start` time (cross-device reflink, non-subvolume btrfs path). The TS caller
therefore **retries the remaining candidates** whenever `start` throws an
`ISO_UNAVAILABLE:`-prefixed error (`ensureIsolation`,
`packages/coding-agent/src/task/worktree.ts:426-447`):

```ts
for (const candidate of candidates) {
  await fs.rm(baseDir, { recursive: true, force: true });
  try {
    await natives.isoStart(candidate, repoRoot, mergedDir);
    return { mergedDir, backend: candidate, fellBack: …, fallbackReason };
  } catch (err) {
    if (!natives.isoIsUnavailableError(errorMessage(err))) throw err;  // hard error → rethrow
    fallbackReason ??= errorMessage(err);                              // unavailable → next candidate
  }
}
```

The `parseIsolationMode` map turns the user-facing `task.isolation.mode` setting
(`none | auto | apfs | btrfs | zfs | reflink | overlayfs | projfs | block-clone
| rcopy`, plus legacy `worktree`/`fuse-overlay`/`fuse-projfs`) into a backend
hint; `none` → skip isolation, `auto` → no hint (let the resolver pick)
(`worktree.ts:359-384`).

---

## Part 2 — Lifecycle: create → run → capture → merge → teardown

The reusable orchestration lives in
`packages/coding-agent/src/task/isolation-runner.ts`. Three phases
(`isolation-runner.ts:11-20`):

1. **`prepareIsolationContext(cwd)`** — resolve the git root and capture a
   **baseline** of the repo's current state (`:56-60`). The baseline
   (`WorktreeBaseline`) records, per repo, `HEAD` sha, staged diff, unstaged
   diff, untracked file list, and an untracked-files patch — for the root repo
   *and every nested git repo* found by walking the tree
   (`captureBaseline` / `discoverNestedRepos`, `worktree.ts:57-149`). This runs
   **once** per top-level call; the baseline is `structuredClone`d per spawn.

2. **`runIsolatedSubprocess(opts)`** (`isolation-runner.ts:133-191`):
   - `ensureIsolation(repoRoot, agentId, preferredBackend)` materializes the
     workspace (Part 1) and returns the `mergedDir`.
   - The subagent runs with `worktree: isolationDir` as its cwd
     (`:139-144`). Everything it writes lands in the COW clone.
   - On success, changes are captured by **merge mode**:
     - **branch mode** → `commitToBranch(...)` (below), returning a
       `branchName` (`omp/task/<id>`) + `nestedPatches` (`:145-159`).
     - **patch mode** → `captureDeltaPatch(...)`, written to
       `<artifactsDir>/<id>.patch` (`:168-182`).
   - The handle is **always** torn down in `finally` via `cleanupIsolation`
     (`:186-190`), which calls `iso_stop` then `rm -rf`s the base dir
     (`worktree.ts:450-466`).

3. **`mergeIsolatedChanges(opts)`** (`isolation-runner.ts:222-342`) — applies
   the captured changes back to the *parent* repo. The caller decides whether to
   run it at all (eval `agent(apply=false)` skips it and just surfaces the
   artifact).

### How changes get back — patch mode

`captureDeltaPatch` (`worktree.ts:226-242`) diffs the isolation workspace's
current state against the captured baseline, for the root repo and each nested
repo. The clever bit (`captureRepoDeltaPatch`, `:151-181`) is that it builds two
**synthetic git trees** off the baseline `HEAD` using a throwaway index
(`writeSyntheticTree`, `:119-138`): one tree = baseline WIP (staged+unstaged+
untracked patches applied), one tree = current WIP (+ any commits the agent
made). The delta between those two trees is *exactly the agent's contribution*,
with the user's pre-existing dirty state subtracted out. `mergeIsolatedChanges`
then applies it with an idempotence guard — it only applies when the forward
patch cleanly applies and the reverse doesn't (`isolation-runner.ts:302-320`).

### How changes get back — branch mode (`omp/task/<id>` cherry-pick)

`commitToBranch` (`worktree.ts:607-692`) has three sub-cases:

- **Agent committed, clean baseline** → `git fetch` the raw commit range from
  the isolation `.git` into the parent object DB and point
  `refs/heads/omp/task/<id>` at the agent's HEAD, preserving every commit
  message and author (`:642-646`). (The isolation `.git` is about to be deleted
  by teardown, so its objects must be transferred first.)
- **Agent committed, dirty baseline** → `replayFilteredAgentCommits` rewrites
  each agent commit against the captured baseline so the user's in-flight WIP is
  *not* replayed into history (`:534-585`).
- **Agent didn't commit** → collapse the whole delta into one branch commit with
  an AI-generated (or fallback) message (`:672-685`).

`mergeTaskBranches` (`worktree.ts:711-779`) then cherry-picks
`baseSha..branchName` onto the parent HEAD under a repo lock, stashing the
parent's dirty tree first and popping it after. A stash-pop conflict does *not*
unmerge — the cherry-picks already landed on HEAD; the conflict is reported
separately as `stashConflict` (`:756-774`).

### Nested repos, `.git`, and node_modules

- **Nested git repos** are handled independently: diffed against their own
  baseline inside the workspace, and applied *directly to their working
  directories* after the parent merge, because the parent git can't track files
  inside a gitlink (`applyNestedPatches`, `worktree.ts:262-324`). Pre-existing
  dirty state in a nested repo is stashed and popped around the apply.
- **`.git`** comes along in the clone for free (it's just files under the repo
  dir). For APFS/reflink/block-clone the whole `.git` is reflinked — near-zero
  cost. Change-capture keys off `merged/.git` existing: `default_diff` shells
  `git diff HEAD` + `git ls-files --others` when it does, and only walks the two
  trees with the `(size, mtime)` fast-path when it doesn't
  (`crates/pi-iso/src/diff.rs:79-85`, git path `:95-138`, walk path `:259-292`).
- **node_modules / deps** get **cloned along with everything else**. This is a
  headline win of the COW model over `git worktree add`: a reflinked
  `node_modules` costs no extra disk (blocks are shared) and no `npm install` —
  the workspace is immediately runnable. A git worktree, by contrast, starts
  with an *empty* `node_modules` and needs a copy or reinstall.

---

## Part 3 — Why it beats git worktrees

**Wins:**

- **Speed.** APFS `clonefile` is one syscall regardless of tree size
  (`apfs.rs:98`); btrfs/zfs snapshots are O(1) metadata ops. `git worktree add`
  has to write out a full checkout and build an index.
- **Disk via block-sharing.** The clone shares extents with the original until
  written. A 2 GB repo with a 1.5 GB `node_modules` clones for ~kilobytes of new
  metadata; ten parallel agents don't cost 10×.
- **node_modules / build artifacts for free.** The clone is immediately
  runnable — no reinstall, no symlink dance. This is arguably the biggest
  practical difference for a JS monorepo.
- **No git index/worktree bookkeeping.** No `.git/worktrees/<name>` registry
  entries to leak, no "worktree already exists" reuse hacks, no prune. Teardown
  is `rm -rf`.
- **Nested repos and untracked files come along verbatim.** A worktree only
  gives you tracked files at a commit; the clone is a byte copy of the live tree.

**Costs / risks:**

- **Filesystem-dependent.** COW only works on APFS / btrfs / XFS-reflink / ZFS /
  ReFS. On ext4, exFAT, a network mount, or a non-reflink volume you *must* fall
  back — hence the whole PAL + candidate-list machinery.
- **Needs a robust fallback.** `resolve()` is only a host probe; real failures
  surface at `start` (cross-device, non-subvolume) and the caller must retry the
  candidate list (`worktree.ts:426-447`). Getting this wrong means hard failures
  where a worktree would have worked.
- **Merge-back complexity.** A worktree *is* a git branch — merging is native.
  A COW clone is just a directory, so omp has to reconstruct the git story:
  synthetic-tree diffs, baseline subtraction, commit-range fetch, filtered
  replay, cherry-pick with stash. That's ~600 lines of `worktree.ts`. The COW
  clone made *creation* trivial and pushed the complexity into *capture*.
- **Cross-device gotcha.** The clone must live on the *same volume* as the
  source, or the reflink `EXDEV`s. You can't clone into `/tmp` if `/tmp` is a
  different filesystem.
- **overlayfs/ProjFS caveats.** overlayfs kernel mounts need privileges (fall
  back to fuse); ProjFS is virtualized (lazy, and buggy under emulation).

---

## Part 4 — How Scout could adopt it

### Where Scout is today

Scout isolates a dispatched agent with a **real git worktree** and nothing more.
There is exactly one place that shells `git worktree`:

- `createGitWorktree(projectRoot, agentName, requestedBranch)` —
  `packages/web/server/core/mobile/service.ts:1062`, running
  `git worktree add -b scout/<agentName> <projectRoot>/.scout-worktrees/<agentName>`
  at `:1092` (fallback without `-b` at `:1097`). Duplicated in the desktop app
  at `apps/desktop/src/core/mobile/service.ts:1204`.
- Called only from `createScoutSession(...)`
  (`packages/web/server/core/mobile/service.ts:869`, gated on `input.worktree`
  at `:904-913`), which passes the worktree path as `cwdOverride` to
  `upScoutAgent(...)` (`:917-926`) → `startLocalAgent`
  (`packages/runtime/src/local-agents.ts:3889`), where it's persisted as the
  agent's launch `runtime.cwd` in the relay-agents override file
  (`local-agents.ts:4009` / `:4017`).

Critically, Scout's flow has **no merge-back, no teardown, and no
node_modules handling**:

- The broker's dispatch and flight lifecycle
  (`packages/runtime/src/broker-invocation-dispatch-service.ts`,
  `packages/runtime/src/broker-flight-lifecycle-service.ts`) route messages and
  track flight state but never touch the filesystem. `recordFlight`
  (`broker-flight-lifecycle-service.ts:174`) is where a flight reaches a
  terminal state and promotes to work — the natural merge-back hook — but no
  such logic exists.
- Worktrees are created on `scout/<agentName>` and **left there**; there is no
  `git worktree remove`/prune anywhere, and `.scout-worktrees/` is not
  gitignored.
- New worktrees get an **empty `node_modules`** — no symlink or copy step.

There is already a richer, forward-looking abstraction that anticipates this:
`packages/runtime/src/issue-runner.ts:44` defines
`export type IssueWorkspaceMode = "worktree" | "copy" | "container" |
"external_sandbox";` — the `"copy"` mode is a natural home for a COW clone as a
first-class option, and its `workspace.cleanupTerminal` flag (`issue-runner.ts`
workspace block) is where teardown would slot in.

### The proposed COW-workspace-per-dispatched-agent shape

Mirror omp's three phases, but bind them to Scout's spawn/flight lifecycle:

1. **On spawn — workspace creation.** Replace the *body* of `createGitWorktree`
   (keep the signature and its callers) with a resolver:
   - On macOS, clone the repo dir with APFS `clonefile` — either via a small
     native binding (the omp approach) or, to start, by shelling
     `cp -c -R <projectRoot> <clonePath>` (`cp -c` = `copyfile` with
     `COPYFILE_CLONE`). The clone path must live on the **same APFS volume** as
     the repo (e.g. `<projectRoot>/.scout-workspaces/<agentName>`), or the
     reflink fails.
   - If the volume isn't APFS (or `cp -c` errors), **fall back to the existing
     `git worktree add`** — which is exactly today's behavior, so the fallback
     is already written.
   - Set `agentCwd` / `cwdOverride` to the clone path just like the worktree
     path is set today (`service.ts:904-926`). No other spawn code changes,
     because everything downstream keys off `cwdOverride`.

2. **On flight completion — merge-back.** Add the currently-missing hook at
   `BrokerFlightLifecycleService.recordFlight`
   (`broker-flight-lifecycle-service.ts:174`) or in the issue-runner's terminal
   path. For each completed dispatched agent whose workspace was a clone:
   - Capture a diff of `clonePath` against the repo. Simplest v1:
     `git -C <clonePath> add -A && git -C <clonePath> diff --cached
     <baselineSha>` — the clone carries its own `.git`, so ordinary git works.
   - Either apply that patch to a `scout/<agentName>` branch in the main repo
     (branch mode, closest to today) or leave the `.patch` as a review artifact
     surfaced in the existing repo-diff UI (`packages/web/client/scout/repo-diff/*`).
   - Then **tear the clone down** (`rm -rf <clonePath>`) — solving the current
     worktree-leak problem for free.

3. **Baseline.** Record the repo `HEAD` sha (and, if we care about live dirty
   state, staged/unstaged/untracked like
   `captureBaseline`/`worktree.ts:110-149`) at spawn so merge-back can subtract
   the user's pre-existing WIP. v1 can skip WIP subtraction if agents always run
   off a clean checkout.

### Interaction with the existing worktree flow

Because the swap is inside `createGitWorktree` and merge-back is a *new* hook,
the two coexist cleanly: `worktree` mode and `copy` (COW) mode are two branches
of the same resolver, exactly as omp's `parseIsolationMode` picks a backend hint
and falls back. The `IssueWorkspaceMode` enum already has the `"copy"` value to
select between them (`issue-runner.ts:44`).

### node_modules and `.git` concerns

- **node_modules** is the standout win: a reflinked clone gets a fully-populated,
  immediately-runnable `node_modules` at zero disk cost — the exact gap Scout has
  today. No symlink hazards (symlinked `node_modules` breaks tooling that
  resolves realpaths); the clone has real files that COW-diverge on write.
- **`.git`** is cloned too, so each workspace is a normal git repo — `git diff`,
  `git status`, and branch capture all just work inside it. Watch the clone size
  claim: reflinked `.git` is cheap, but if you ever fall back to plain `cp -R`
  (non-COW volume) you pay full copy cost for `.git` + `node_modules`, which can
  be large. That's an argument for keeping `git worktree add` (not `cp -R`) as
  the non-COW fallback.

### Cross-platform fallback

Scout ships macOS (native app + desktop) and a web/server that could run on
Linux. A pragmatic ladder:

- **macOS** → APFS `clonefile` / `cp -c`.
- **Linux** → `git worktree add` fallback initially; later `FICLONE` reflink or
  `btrfs subvolume snapshot` if we find users on those filesystems.
- **Any non-COW volume / error** → `git worktree add` (today's path).

We do *not* need omp's full seven-backend PAL to start — one COW path (APFS) plus
the worktree fallback captures most of the value.

### Rough incremental adoption path

1. **APFS clone behind a flag.** Add `IssueWorkspaceMode: "copy"` handling: a
   `cloneRepoCow(projectRoot, dest)` that tries `cp -c -R` and returns `null` on
   failure so `createScoutSession` falls back to the existing worktree. Point
   `cwdOverride` at the clone. Verify agents run in it. No merge-back yet — clones
   are review-only, torn down manually. This alone gives fast spawn +
   free node_modules.
2. **Teardown on completion.** Wire `recordFlight`
   (`broker-flight-lifecycle-service.ts:174`) to `rm -rf` the clone when the
   flight settles. Fixes the leak that already exists for worktrees.
3. **Patch capture + review artifact.** Capture `git diff` from the clone at
   completion, surface it in the existing diff UI. Still no auto-merge.
4. **Branch merge-back.** Apply the captured diff to a `scout/<agentName>`
   branch (or cherry-pick agent commits) — porting the tractable half of omp's
   `commitToBranch`/`mergeTaskBranches` (`worktree.ts:607`, `:711`). Add baseline
   WIP-subtraction if live-dirty repos are in scope.
5. **Broaden backends** (Linux reflink/btrfs) only if real usage demands it.

### What's honestly hard

- **Merge-back is where the real work is.** Creation gets *trivially* faster; the
  cost moves to reconstructing git history from a directory. omp spends ~600
  lines on this (`worktree.ts`). A v1 that only produces a review patch avoids
  most of it, but true auto-merge (clean vs. dirty baseline, agent-committed vs.
  not, nested repos, cherry-pick conflicts, stash-pop conflicts) is genuinely
  fiddly — and Scout has *none* of it today, so it's net-new either way.
- **Same-volume constraint.** `.scout-workspaces/` must sit on the same APFS
  volume as the repo; a repo on an external/network volume, or a clone target
  redirected to `/tmp`, breaks the reflink and must fall back.
- **Dirty-state parity.** omp's rcopy backend goes to real lengths to reproduce
  `lower`'s *live* working tree in the clone (`seed_dirty_state`,
  `rcopy.rs:187`). A raw `clonefile` already copies the live tree byte-for-byte
  (better than a worktree here), but if Scout ever clones from a bare/clean
  reference the parity issue returns.
- **Concurrency + shared tree.** Multiple agents cloning/tearing down the same
  repo dir need a lock discipline (omp uses `git.withRepoLock`,
  `worktree.ts:718`) so parallel merge-backs don't corrupt the parent working
  tree — relevant given Scout's known "concurrent agents share one working tree"
  hazard.
- **Cleanup on crash.** A killed process leaves an orphaned clone. Reconcile on
  startup by sweeping `.scout-workspaces/` (cheaper and safer than reconciling
  leaked git worktrees).

---

## Appendix — key files

**omp (reference, `/Users/art/dev/ext/oh-my-pi`):**

- PAL trait + resolver: `crates/pi-iso/src/lib.rs`
- Backends: `crates/pi-iso/src/{apfs,linux_reflink,btrfs,zfs,overlayfs,projfs,windows_block_clone,rcopy}.rs`
- Change capture: `crates/pi-iso/src/diff.rs`
- napi shim: `crates/pi-natives/src/iso.rs`
- TS lifecycle: `packages/coding-agent/src/task/worktree.ts`,
  `packages/coding-agent/src/task/isolation-runner.ts`
- Executor wiring: `packages/coding-agent/src/task/executor.ts` (`worktree` at
  `:1807`, `:2064`)
- Contract: `docs/tools/task.md`

**Scout (this repo, `/Users/art/dev/openscout`):**

- Worktree creation: `packages/web/server/core/mobile/service.ts:1062`
  (`createGitWorktree`), `apps/desktop/src/core/mobile/service.ts:1204`
- Spawn wiring: `createScoutSession` (`service.ts:869`, `:904-926`) →
  `startLocalAgent` (`packages/runtime/src/local-agents.ts:3889`, `:4009`)
- Merge-back hook (currently unused): `recordFlight`
  (`packages/runtime/src/broker-flight-lifecycle-service.ts:174`)
- Workspace-mode enum: `packages/runtime/src/issue-runner.ts:44`

---

## Part 5 — Merge-back implementation plan (NOT YET IMPLEMENTED)

> **Status:** proposal for review. The *safe half* of adoption — COW workspace
> creation with a worktree fallback, plus teardown on flight completion — has
> shipped (see "What shipped" below). Merge-back (getting the agent's changes
> back to the parent repo) is deliberately **not** implemented: it is the hard,
> destructive-if-wrong part and needs review before it lands. This section is
> the concrete plan for that work.

### What shipped (context for the plan)

The two safe halves are live:

- **`createAgentWorkspace(projectRoot, agentName, requestedBranch)`**
  (`packages/runtime/src/agent-workspace.ts`) materializes the workspace under
  `<projectRoot>/.scout-worktrees/<agentName>`. On macOS + a git repo + a
  reflink-capable volume it does a `cp -c -R` (clonefile) clone that carries a
  runnable `node_modules` and a real `.git`; otherwise it falls back to
  `git worktree add` (today's behavior). It returns
  `{ path, branch, kind: "cow-clone" | "git-worktree" }`. Both mobile
  `createGitWorktree` shims now delegate here.
- **`teardownAgentWorkspace({ workspacePath, projectRoot })`** (same module),
  invoked from `BrokerFlightLifecycleService.recordFlight` via
  `teardownLocalAgentWorkspace(agentId)` (`local-agents.ts`) when a flight
  reaches a terminal state. It removes the clone (`rm -rf`) or the worktree
  (`git worktree remove --force` + `prune`), guarded so it only ever deletes a
  path under the project's `.scout-worktrees/`.

The `kind` discriminator is the key seam for merge-back: a **worktree** *is*
already a git branch in the parent's object DB (native merge), whereas a
**clone** is a standalone repo whose objects must be transferred first.

### Where merge-back hooks

Merge-back must run **before** teardown and **after** the flight settles — the
workspace has to still exist to capture from. Two viable seams:

1. **Inside `recordFlight`, ahead of the teardown call**
   (`broker-flight-lifecycle-service.ts`). Add a
   `captureAgentWorkspaceChanges(agentId, flight)` option that runs on
   `isTerminalFlightState`, *then* let the existing `teardownAgentWorkspace`
   run. This keeps capture and teardown atomic per flight and reuses the
   agentId→workspace resolution already written in
   `teardownLocalAgentWorkspace`. **Preferred.**
2. **In the issue-runner terminal path** (`issue-runner.ts`, the
   `workspace.cleanupTerminal` block) for the issue-runner flow specifically.
   Narrower; only covers issue-runner-spawned agents, not mobile
   `createScoutSession` dispatch. Use only if the two spawn paths diverge.

Concretely, extend the runtime helper with a `captureAgentWorkspaceChanges`
sibling to `teardownAgentWorkspace`, resolve the workspace the same way
(override `runtime.cwd` under `.scout-worktrees/`), and thread a new
`captureAgentWorkspaceChanges` option through
`BrokerFlightLifecycleServiceOptions` → `broker-daemon.ts`, mirroring exactly
how `teardownAgentWorkspace` was wired.

### Baseline capture (prerequisite, at spawn)

Merge-back must subtract the operator's *pre-existing* dirty state so the agent
gets credit only for its own edits. At spawn (`createAgentWorkspace`), record a
baseline for the source repo and persist it on the agent override (a new
`workspace` block on `RelayAgentOverride`, alongside `runtime.cwd`):

- `baseSha` = `git rev-parse HEAD` of the source at clone time.
- (v1-optional) `stagedDiff`, `unstagedDiff`, and an untracked-file patch, à la
  omp's `captureBaseline` (`worktree.ts:110-149`). A raw `clonefile` copies the
  live dirty tree byte-for-byte, so the clone *starts* dirty exactly like the
  source — meaning the naive `diff baseSha..now` would re-attribute the
  operator's WIP to the agent unless we subtract it.

**v1 simplification:** if dispatched agents always clone from a **clean**
checkout, WIP subtraction can be skipped and `baseSha` alone suffices. Gate the
richer baseline behind "source repo was dirty at spawn" and only pay for it
then.

### Two capture modes

#### (a) Patch mode — review artifact (recommended first)

Non-destructive; nothing touches the parent working tree.

1. In the workspace: `git -C <ws> add -A` then
   `git -C <ws> diff --cached <baseSha>` → a unified patch.
2. If a baseline WIP patch exists, build two synthetic trees off `baseSha` (à la
   omp's `writeSyntheticTree`, `worktree.ts:119-138`): `baselineWip`
   (baseSha + operator WIP) and `currentWip` (baseSha + everything now in the
   workspace). The delta `baselineWip..currentWip` is *exactly the agent's
   contribution*. Skip this step in the clean-baseline v1 (the plain
   `diff --cached <baseSha>` is already the agent's contribution).
3. Write the patch to a review artifact and surface it in the existing repo-diff
   UI (`packages/web/client/scout/repo-diff/*`). No auto-apply.

This is the safe v1: it produces a reviewable diff and never mutates the parent,
so a bad capture costs nothing.

#### (b) Branch mode — reconstruct `scout/<agent>` in the parent

Gets the agent's history into the parent repo. Split by `kind`:

- **`git-worktree` workspaces** — the branch (`scout/<agent>`) already lives in
  the parent's object DB (a worktree shares `.git`). If the agent committed,
  the branch is done; if it only left dirty files, collapse them into one commit
  on the branch (`git -C <ws> add -A && git -C <ws> commit`), then the branch is
  ready. No object transfer needed. This is the tractable case and should ship
  first.

- **`cow-clone` workspaces** — the clone has its **own** `.git`, about to be
  deleted by teardown, so objects must be transferred before teardown:
  1. **Agent committed, clean baseline** → `git -C <parent> fetch <ws>
     <agentHead>` to pull the commit range into the parent object DB, then point
     `refs/heads/scout/<agent>` at it — preserving every commit message/author
     (omp `commitToBranch`, `worktree.ts:642-646`).
  2. **Agent committed, dirty baseline** → rewrite each agent commit against the
     baseline so the operator's WIP is not replayed into history (omp
     `replayFilteredAgentCommits`, `worktree.ts:534-585`).
  3. **Agent didn't commit** → collapse the whole delta into a single branch
     commit with a generated message (omp `worktree.ts:672-685`).

Applying the branch onto the parent HEAD (`mergeTaskBranches`,
`worktree.ts:711-779`) — cherry-pick `baseSha..scout/<agent>` under a repo lock,
stashing/popping the parent's dirty tree — is a **separate, opt-in** step. v1
should **create the branch and stop**, leaving the operator to review and merge.
Auto-cherry-pick onto a live working tree is where the real danger is.

### How git history is reconstructed (summary)

- Worktree path: history already exists on `scout/<agent>` in the parent; at
  most collapse dirty files into one commit. Native.
- Clone path: `git fetch <ws> <range>` transfers objects into the parent, then a
  ref is created; dirty baselines require filtered replay so operator WIP stays
  out of the agent's commits. This is the ~600-line half omp spends in
  `worktree.ts`.
- In both cases the *delta* is defined relative to `baseSha` (and, when dirty,
  relative to synthetic `baselineWip`/`currentWip` trees), never relative to the
  parent's *current* HEAD — otherwise concurrent parent commits corrupt the
  attribution.

### Risks

- **Destructive on the parent.** Any auto-apply (cherry-pick / stash-pop) can
  conflict or lose work on the operator's live tree. Mitigation: v1 is
  capture-only (patch artifact or branch, no apply); apply is a later, gated,
  reviewed step under a repo lock.
- **Ordering vs. teardown.** Capture *must* precede teardown, and for clones the
  object fetch must complete before `rm -rf`. A crash between capture and
  teardown leaves an orphaned clone — reconcile by sweeping `.scout-worktrees/`
  on startup (cheaper than reconciling leaked worktrees).
- **Concurrency.** Multiple agents merging back into one parent need
  `git.withRepoLock`-style discipline (omp `worktree.ts:718`) — directly
  relevant to Scout's known "concurrent agents share one working tree" hazard.
  Parallel branch-creates are safe (distinct refs); parallel *applies* are not.
- **Dirty-baseline correctness.** The synthetic-tree subtraction is subtle;
  getting it wrong silently re-attributes operator WIP to the agent (or drops
  agent edits). Guard every apply with omp's idempotence check — only apply when
  the forward patch applies cleanly *and* the reverse does not
  (`isolation-runner.ts:302-320`).
- **Nested repos / gitlinks.** The parent git can't track files inside a nested
  `.git`; those must be diffed against their own baseline and applied directly
  to their working dirs (omp `applyNestedPatches`, `worktree.ts:262-324`).
  Out of scope for v1; document as a known gap.
- **Large `.git`/`node_modules` in the diff.** `git add -A` in the workspace
  must not stage `node_modules` — ensure the repo's `.gitignore` covers it (it
  will for any sane JS repo, since the clone carries the same `.gitignore`), or
  the "agent's changes" balloon.

### Recommended landing order

1. **Baseline capture at spawn** (`baseSha` only; clean-baseline assumption).
2. **Patch-mode capture → review artifact.** Non-destructive; ship + dogfood.
3. **Branch mode for `git-worktree` workspaces** (native, no object transfer).
4. **Branch mode for `cow-clone` workspaces** (object fetch + optional filtered
   replay for dirty baselines).
5. **Opt-in auto-apply** (cherry-pick under repo lock) — last, and gated behind
   explicit operator action, never automatic on flight completion.
