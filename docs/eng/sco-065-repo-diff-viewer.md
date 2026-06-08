# SCO-065: Repo Diff Viewer

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Repo Watch adjacent diff inspection for local Git worktrees
- **Intent:** Let the operator inspect the branch/worktree drift that Repo Watch
  already surfaces, one level deeper, with a native Rust diff producer and a
  local web renderer built on Pierre Diffs and Shiki.

## 2. Summary

Repo Watch answers "what repositories and worktrees need attention?" The next
question is "what changed?" SCO-065 adds a diff viewer that is adjacent to Repo
Watch rather than part of the Repo Watch summary snapshot.

The system should keep the same ownership split as
[SCO-064](./sco-064-native-repo-service.md):

- Rust observes local Git state and produces bounded raw diff facts.
- TypeScript joins those facts with Scout context and serves UI/API contracts.
- The web UI renders the review surface using local, cached `@pierre/diffs`
  and Shiki assets.

The durable interchange format is Git-compatible patch text: the output of
`git diff -p` with stable options. Rust also returns normalized summaries for
navigation, filtering, caching, and agent-readable context. The browser may
parse the patch for rendering, but Rust remains authoritative for path, layer,
mode, rename, binary, and status facts.

## 3. Relationship To Existing Work

- [SCO-061](./sco-061-repo-watch-worktree-state.md) defines the compact worktree
  state snapshot.
- [SCO-064](./sco-064-native-repo-service.md) introduces
  `openscout-repo-service scan`.
- SCO-065 extends the same Rust crate with a deeper diff command and adds a
  web surface that can open from Repo Watch rows, worktree context panes, or
  future agent work previews.

This is not a replacement for Repo Watch. Repo Watch remains the fast overview.
The diff viewer is an on-demand detail view.

## 4. External Anchors

Primary format anchors:

- Git patch format: <https://git-scm.com/docs/diff-format>
- Git diff command behavior: <https://git-scm.com/docs/git-diff>
- GNU unified diff format: <https://www.gnu.org/software/diffutils/manual/diffutils.html>

Renderer anchors:

- Pierre Diffs docs: <https://diffs.com/docs>
- Pierre Diffs package: <https://www.npmjs.com/package/@pierre/diffs>
- Pierre source: <https://github.com/pierrecomputer/pierre/tree/main/packages/diffs>

Future metadata reference:

- DiffX: <https://diffx.org/spec/intro.html>

DiffX is useful prior art for structured metadata, but it is not the first
implementation target. The first target is ordinary Git patch text plus a
Scout-owned JSON envelope.

## 5. Product Shape

The viewer should answer these questions:

- What changed in this worktree?
- Which changes are staged, unstaged, or branch-level drift?
- Which files are risky, large, binary, renamed, deleted, or conflicted?
- Which attached agent/session likely produced or is working near the change?
- Can the operator jump to a file, line, hunk, or agent context quickly?

First surface:

- Opens from a Repo Watch worktree row or project context.
- Shows a file list, staged/unstaged/branch layer tabs, diff stats, and one
  virtualized diff review surface.
- Renders split and stacked layouts.
- Supports local selection, line highlighting, hunk anchors, and annotations.
- Defers accept/reject or patch application until a later explicit workflow.

The first version is read-only.

Repo Watch should prefetch diff snapshots best-effort while the operator is on
the Repos page. Prefetch priority should favor the selected worktree, dirty
worktrees, and worktrees with live agents. Opening the viewer should use a
cached snapshot immediately when available, then perform a quick background
refetch so the operator can see whether the diff is current or slightly stale.
If no cached snapshot exists, the viewer fetches normally.

## 6. Ownership Boundary

The Rust repo service may know:

- local worktree paths,
- Git refs, oids, modes, statuses, renames, copies, and binary markers,
- staged, unstaged, and branch diff layers,
- raw Git patch text,
- bounded parsed file/hunk/line summaries,
- scan/diff budgets, truncation, and diagnostics.

The Rust repo service must not know:

- Scout agent identity rules,
- conversation, invocation, work item, or session ownership semantics,
- operator attention policy,
- UI component details beyond raw render inputs,
- cloud or account identity.

TypeScript owns:

- mapping Repo Watch worktrees to diff requests,
- joining agents/sessions/work items/hints,
- cache key composition and cache policy,
- HTTP endpoint shape,
- UI-facing labels and filters,
- local render preloading and server-side handoff objects.

Pierre Diffs owns:

- web diff rendering,
- Shiki highlighting and theming,
- browser/worker render cache,
- virtualization and large review surface behavior.

## 7. Native Command

Add a command to `crates/openscout-repo-service`:

```bash
openscout-repo-service diff < request.json
```

Input:

```ts
type RepoDiffRequest = {
  schema?: "openscout.repo.diff.request/v1";
  worktreePath: string;
  layers?: RepoDiffLayerKind[];
  baseRef?: string | null;
  compareRef?: string | null;
  paths?: string[];
  limits?: {
    maxPatchBytes?: number;
    maxFiles?: number;
    maxHunksPerFile?: number;
    maxLinesPerHunk?: number;
    timeoutMs?: number;
    includeRawPatch?: boolean;
    includeParsedHunks?: boolean;
    includeBinaryPatch?: boolean;
  };
};

type RepoDiffLayerKind = "unstaged" | "staged" | "branch";
```

Layer meanings:

- `unstaged`: index to working tree, from `git diff`.
- `staged`: `HEAD` to index, from `git diff --cached`.
- `branch`: base ref to compare ref, defaulting to upstream or merge-base when
  TypeScript supplies those refs explicitly.

Rust should not infer Scout product intent from branch names. TypeScript decides
which branch layer to request.

## 8. Git Invocation

Use Git as the compatibility source of truth in the first slice. Generate patch
text with stable options:

```bash
git -C <worktree> diff --no-color --no-ext-diff --default-prefix --full-index --binary -U3
git -C <worktree> diff --cached --no-color --no-ext-diff --default-prefix --full-index --binary -U3
git -C <worktree> diff <baseRef> <compareRef> --no-color --no-ext-diff --default-prefix --full-index --binary -U3
```

Use machine-oriented side queries for summaries and file identity:

```bash
git -C <worktree> diff --raw -z
git -C <worktree> diff --numstat -z
git -C <worktree> diff --summary
```

Equivalent `--cached` or `<baseRef> <compareRef>` arguments apply per layer.

Rationale:

- `--default-prefix` keeps `a/` and `b/` stable even if user Git config changes.
- `--no-color` avoids terminal escape sequences in patch text.
- `--no-ext-diff` prevents local external diff tools from changing output.
- `--full-index` and `--binary` preserve enough metadata for future apply or
  deeper review features.
- `--raw -z` and `--numstat -z` avoid quoted-path parsing traps.

The read-only web viewer may request `includeBinaryPatch: false` so large binary
payloads do not make Git patch generation dominate first paint. Binary files
still appear from `--raw -z` / `--numstat -z` summaries with explicit binary
markers.

## 9. Native Response

Rust returns raw Git facts, not Scout presentation objects:

```ts
type RepoDiffResponse = {
  schema: "openscout.repo.diff/v1";
  generatedAt: number;
  worktreePath: string;
  layers: RepoDiffLayer[];
  coverage: RepoDiffCoverage;
  diagnostics: RepoDiffDiagnostic[];
};

type RepoDiffLayer = {
  kind: RepoDiffLayerKind;
  baseLabel: string | null;
  compareLabel: string | null;
  command: string[];
  patchOid: string;
  rawPatch: string | null;
  rawPatchBytes: number;
  truncated: boolean;
  files: RepoDiffFile[];
  shortstat: string | null;
};

type RepoDiffFile = {
  oldPath: string | null;
  newPath: string | null;
  status: RepoDiffFileStatus;
  oldOid: string | null;
  newOid: string | null;
  oldMode: string | null;
  newMode: string | null;
  similarity: number | null;
  binary: boolean;
  additions: number | null;
  deletions: number | null;
  hunks: RepoDiffHunk[];
  truncated: boolean;
};

type RepoDiffFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "conflict"
  | "unknown";

type RepoDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section: string | null;
  additions: number;
  deletions: number;
  truncated: boolean;
};

type RepoDiffCoverage = {
  requestedLayers: number;
  emittedLayers: number;
  files: number;
  patchBytes: number;
  truncatedLayers: number;
  scanBudgetReached: boolean;
};

type RepoDiffDiagnostic = {
  level: "info" | "warning";
  kind: string;
  message: string;
  path: string | null;
};
```

`patchOid` is a stable content hash over the layer command identity and raw
patch bytes. It is not a Git object id unless explicitly named otherwise.

## 10. Web API

A diff is a local read — run `git diff` on a worktree and render it — so the
local web server owns the endpoint and runs the native producer in-process. The
broker (fleet coordination) is intentionally NOT in this path: it does not need
to mediate a local file read, and coupling here would force a broker restart to
ship diff changes and would not work when the broker is busy or remote.

```http
GET /api/repo-diff/worktree?path=<absolute-path>
GET /api/repo-diff/worktree?path=<absolute-path>&layer=unstaged
GET /api/repo-diff/worktree?path=<absolute-path>&layer=staged
GET /api/repo-diff/worktree?path=<absolute-path>&layer=branch&baseRef=<ref>&compareRef=<ref>
```

The response wraps native facts with render hints (and, optionally, Scout
context):

```ts
type ScoutRepoDiffSnapshot = RepoDiffResponse & {
  scout: {
    worktreeId: string | null;
    projectId: string | null;
    agents: RepoWatchAgentRef[];
    sessions: RepoWatchSessionRef[];
    hints: RepoWatchHintSummary[];
  };
  render: {
    renderKey: string;
    cachePolicy: "local-disposable";
    preferredTheme: "pierre-dark" | "pierre-light" | string;
    preferredLayout: "split" | "stacked";
  };
};
```

`render` is computed locally (path + patch content identity). The `scout` block
is the only broker-derived part — agent/session annotations near the worktree
(SCO-065 §15). In the first slice it is empty; when annotations are wanted the
web server can best-effort read the broker snapshot to fill it, but the diff
itself never depends on the broker being reachable.

The API should reject paths that do not resolve to a local Git worktree (the
native producer emits a `not_a_git_worktree` diagnostic; the endpoint rejects a
missing `path` outright). Do not create a broad filesystem diff endpoint.

## 11. Pierre Diffs Integration

Add `@pierre/diffs` as a dev-only dependency for its TypeScript types. Load the
library (and Shiki) at runtime from a version-pinned remote rather than bundling
or vendoring it — see §12. Diff *data* always comes from the local broker; only
the renderer *library* is remote.

Use the React entry point for the first web surface:

```ts
import { CodeView, WorkerPoolContextProvider } from "@pierre/diffs/react";
import { parsePatchFiles, preloadHighlighter } from "@pierre/diffs";
```

Recommended mapping:

- Use `CodeView` for the full worktree review surface.
- Use `PatchDiff` only for small, single-file panels.
- Use `FileDiff` when TypeScript already has `FileDiffMetadata`.
- Keep `UnresolvedFile` for a later merge-conflict slice because Pierre marks
  that area experimental.

The web surface should feed Pierre Git-compatible patch text. It may use
`parsePatchFiles(rawPatch, cacheKeyPrefix, true)` to build `FileDiffMetadata`
for `CodeView` items. Parsing errors should surface as diagnostics and fall
back to raw patch text where possible.

## 12. Pierre/Shiki Loading And Cache

The viewer should feel local and instant after the first load. The single goal:
once a diff has been opened, Pierre, Shiki, and all their dependencies stay
cached effectively forever — never re-fetched — until we intentionally upgrade.

### Pinned version is the cache key

Load `@pierre/diffs` (and transitively Shiki, `@pierre/theme`, etc.) at runtime
from a version-pinned remote. Do not vendor or bundle them into the build. One
constant pins the version:

```ts
const PIERRE_VERSION = "1.2.7";
// https://esm.sh/@pierre/diffs@1.2.7/react , .../worker/worker.js , ...
```

esm.sh serves the library and every transitive dependency at immutable,
versioned URLs (`Cache-Control: immutable`). Therefore:

- The browser HTTP cache (web) and the persistent `WKWebsiteDataStore` (the
  macOS WebKit host) keep all of it after the first fetch — no revalidation, no
  re-download across reloads or app launches.
- Bumping `PIERRE_VERSION` is the *only* thing that invalidates: a new version
  is a new set of immutable URLs.

This is deliberately the entire caching strategy. We do not bundle assets, do
not run a server-side asset cache, and do not maintain a TTL/size-bounded local
cache — version-pinned immutable URLs already give "fetch once, cached forever."
Lazy-load the viewer so the default app shell pays no Pierre/Shiki cost until a
diff is actually opened (an infrequent, on-demand surface).

### Highlighter warmup

On opening the viewer, preload the default theme(s) and a common language set
before first render, via `preloadHighlighter` from `@pierre/diffs`:

```ts
const PREBAKED_DIFF_LANGUAGES = [
  "typescript", "tsx", "javascript", "jsx", "json", "markdown",
  "rust", "swift", "shellscript", "yaml", "css", "html",
];
```

### Worker pool

Use `WorkerPoolContextProvider` from `@pierre/diffs/react`, with the worker
sourced from the same pinned remote:

```ts
const workerFactory = () =>
  new Worker(new URL(`https://esm.sh/@pierre/diffs@${PIERRE_VERSION}/worker/worker.js`), {
    type: "module",
  });
```

Create the pool once and flow theme/layout changes through its render-option
update path rather than remounting every diff item.

### Render keys

Each diff render item gets a stable cache key so re-opening the same diff reuses
Pierre's in-memory cache:

```text
openscout-diff:v1:
  worktreePath: layer: patchOid: theme: layout: renderOptionsVersion
```

The broker supplies the path+content portion as `render.renderKey` (a hash that
does not expose absolute paths); the client appends theme/layout. This render
cache key is independent of `PIERRE_VERSION` — one is the diff identity, the
other the library identity.

Optional, only if first-paint latency is ever visible: a server-side
`@pierre/diffs/ssr` preload (`preloadPatchFile` / `preloadPatchDiff`) whose
opaque handoff the client spreads into the matching component. Keep any such
cache local and disposable; it must never hold diff content remotely or in
Scout's SQLite coordination database.

## 13. Privacy And Safety

Diffs may contain secrets, credentials, private code, or unreleased work. The
diff *data* path is local-first:

- Patch text, paths, filenames, and symbols come only from the local broker;
  they are never sent to a remote render service, telemetry, or cloud cache.
- No raw patch persistence in Scout-owned message or transcript records.
- No broad filesystem crawling.
- No destructive Git operations in the first slice.

The one allowed remote is the Pierre/Shiki *library* (loaded from the pinned
public CDN per §12). It carries renderer code, themes, and grammars only — no
diff content — so it does not weaken the guarantee above.

If a local render cache is ever kept for debugging, the tool/CLI output must
report its path and that it may contain source text.

## 14. Large Diff Behavior

Large diffs must degrade deliberately:

- Rust enforces `maxPatchBytes`, `maxFiles`, `maxHunksPerFile`, and command
  timeout limits.
- Truncated layers still return file summaries and diagnostics.
- The UI shows truncated file/layer states instead of silently hiding content.
- Syntax highlighting is progressive: plain text first, highlighted content
  later from worker or SSR cache.
- Very long lines use Pierre tokenization limits to prevent main-thread stalls.

The first implementation should prefer a useful partial diff over a frozen UI.

## 15. Rendering Annotations

The initial annotation model is read-only:

- attached agents/sessions near the worktree,
- file-level Scout hints,
- future AI review comments,
- future work-item or invocation links.

Annotations should be supplied from TypeScript as UI metadata, not embedded into
the Git patch. This keeps raw patches reusable by ordinary Git tooling.

The next interactive slice should make the diff a first-class review workspace:

- full-page diff route in addition to the slide-out and macOS embed,
- file-level and line/hunk-level comments,
- comment draft state that is local until explicitly sent,
- a "send to agent" action that packages the selected file/hunk/comment context
  into a Scout ask or message without mutating Git state,
- visible provenance showing which cached diff revision a comment refers to.

## 16. First Implementation Slice

1. Add `openscout-repo-service diff` with staged and unstaged layers.
2. Return `openscout.repo.diff/v1` with raw patch text and file summaries.
3. Add a broker endpoint that launches the native command and wraps Scout hints.
4. Add a web proxy endpoint.
5. Add `@pierre/diffs` to `packages/web`.
6. Add a repo diff route opened from Repo Watch.
7. Prefetch high-priority worktree diffs from the Repo Watch page.
8. Show cached diff freshness and quick-refetch in the viewer.
9. Preload Shiki themes/languages locally.
10. Use Pierre `CodeView` with worker pool and stable cache keys.
11. Add local SSR/render cache only if first-paint latency is visible.

Branch diff can follow after staged/unstaged are reliable.

## 17. Acceptance Criteria

- `npm run repo-service:test` passes.
- `npm run repo-service:check` passes.
- `npm --prefix packages/runtime run check` passes for API changes.
- `bun run --cwd packages/web build:server` passes for proxy/server changes.
- A temporary Git repository with staged and unstaged edits returns two layers
  with correct file status, additions, deletions, modes, and patch text.
- A renamed file and a deleted file are represented correctly in summaries.
- A binary file produces a binary marker and does not crash parsing/rendering.
- The web viewer renders a local patch with diff data fetched only from the
  local broker (no diff content leaves the machine). The Pierre/Shiki library
  loads once from its pinned remote and is served from cache on every later
  open (no re-fetch until the pinned version changes).
- Reopening the same diff reuses stable Pierre cache keys.
- Large or truncated diffs show explicit diagnostics.
- The default app shell does not load the diff viewer bundle until the route is
  opened.

## 18. Non-Goals

- No apply, accept, reject, stage, unstage, commit, merge, or rebase in the
  first slice.
- No remote GitHub PR review in the first slice.
- No semantic or AST diff in the first slice.
- No DiffX export in the first slice.
- No persistent source-code cache in SQLite.
- No claim that Scout owns repository state. Git remains the source of truth.

## 19. Open Decisions

- Should the first UI live as a full Repos subview or a slide-in detail panel?
- Should branch diff default to upstream, merge-base with upstream, or an
  explicit base selected by the operator?
- Should SSR preloading be implemented immediately or only after measuring the
  worker-only path?
- Which file extensions should be in the prebaked language set at launch?
- How should native macOS reuse this viewer: embedded web view, Swift wrapper,
  or separate native renderer later?
- Should local diff render cache be operator-visible in settings from day one?
