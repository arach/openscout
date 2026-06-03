# SCO-061: Repo Watch Worktree State

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Local repository/worktree awareness for the native Mac app
- **Intent:** Give Scout a compact machine-local view of active Git work so the operator can understand what branches, worktrees, and diffs are alive.

## 2. Summary

Scout already has surfaces for communication, agents, and transcript activity. The missing local-operator view is repository state: which projects are active, which branches are moving, which worktrees are dirty, and which agents or sessions appear attached to that work.

Repo Watch is the backend primitive for that view. It is a peer to Tail in posture: Tail observes harness transcripts; Repo Watch observes Git worktrees. It should be safe to poll, cheap enough for local use, and shaped for a native UI that groups state by project.

This is not a repository management system. The first version should discover useful roots from existing Scout context and present state. Pinning, hiding, renaming, and deeper project curation can remain later agentic workflows or lightweight settings.

## 3. Product Shape

The Mac app should be able to render a **Repos** or **Worktrees** screen from one snapshot:

- project groups such as `openscout` and `hudson`
- worktree rows with branch, path, upstream, ahead/behind, dirty state, changed-file preview, and attention reasons
- optional diff shortstats for staged and unstaged work when the client asks for enrichment
- agent/session presence inferred from Scout agents, endpoints, and Tail discovery
- quick actions such as open editor, open terminal, observe session, or message attached agent

The screen answers: "What physical work is changing on this machine?"

## 4. Discovery

The initial backend discovers candidate paths from:

1. Scout broker agents and endpoint `projectRoot` / `cwd`
2. Optional Tail-discovered process `cwd` when `includeTail=1`
3. Optional Tail-discovered transcript `cwd` when `includeTail=1`
4. Optional environment roots such as `OPENSCOUT_REPO_WATCH_ROOTS`

Broker-derived paths are filtered for local operator usefulness. The fast path skips broad roots such as the home directory and common dev parent directory, skips temporary package directories, prioritizes active endpoint paths, and lets explicit environment roots override discovery. Defaults are intentionally bounded and biased toward breadth across projects before depth inside one large worktree set: `OPENSCOUT_REPO_WATCH_MAX_ROOTS`, `OPENSCOUT_REPO_WATCH_MAX_WORKTREES`, `OPENSCOUT_REPO_WATCH_MAX_FILES_PER_WORKTREE`, and `OPENSCOUT_REPO_WATCH_SCAN_BUDGET_MS` can tune the cap.

Each candidate path is normalized through Git:

```bash
git -C <path> rev-parse --show-toplevel
git -C <worktree> rev-parse --git-common-dir
git -C <worktree> worktree list --porcelain
git -C <worktree> status --porcelain=v2 --branch -unormal
```

Repo Watch should not scan arbitrary home directories by default.

The default endpoint is a fast path. It skips optional diff and commit enrichment unless the client requests it:

```bash
git -C <worktree> diff --shortstat
git -C <worktree> diff --cached --shortstat
git -C <worktree> log -1 --format=%ct
```

## 5. Endpoint Contract

First endpoint:

```http
GET /v1/repo-watch/snapshot
GET /v1/repo-watch/snapshot?force=1
GET /v1/repo-watch/snapshot?includeTail=1
GET /v1/repo-watch/snapshot?includeDiff=1
GET /v1/repo-watch/snapshot?includeLastCommit=1
```

Response:

```ts
type RepoWatchSnapshot = {
  generatedAt: number;
  projects: RepoWatchProject[];
  totals: {
    projects: number;
    worktrees: number;
    dirtyWorktrees: number;
    conflictedWorktrees: number;
    attentionWorktrees: number;
    attachedAgents: number;
    attachedSessions: number;
  };
  warnings: string[];
};

type RepoWatchProject = {
  id: string;
  name: string;
  root: string;
  commonGitDir: string;
  attention: RepoWatchAttentionLevel;
  attentionReasons: string[];
  worktrees: RepoWatchWorktree[];
  stats: RepoWatchProjectStats;
  hints: RepoWatchHintSummary[];
};

type RepoWatchWorktree = {
  id: string;
  path: string;
  name: string;
  isBare: boolean;
  branch: {
    name: string | null;
    upstream: string | null;
    head: string | null;
    detached: boolean;
    ahead: number;
    behind: number;
    isMain: boolean;
    diverged: boolean;
  };
  status: {
    clean: boolean;
    staged: number;
    unstaged: number;
    untracked: number;
    conflicts: number;
    changedFiles: number;
    files: { path: string; status: string }[];
  };
  diff: {
    unstagedShortstat: string | null;
    stagedShortstat: string | null;
  };
  attention: RepoWatchAttentionLevel;
  attentionReasons: string[];
  agents: RepoWatchAgentRef[];
  sessions: RepoWatchSessionRef[];
  lastCommitAt: number | null; // null unless includeLastCommit=1
  scannedAt: number;
  error: string | null;
};

type RepoWatchAttentionLevel = "critical" | "attention" | "active" | "quiet" | "unknown";
```

## 6. Attention Rules

The first attention model is intentionally mechanical:

- `critical`: merge conflicts or unmerged status
- `attention`: dirty `main` / `master`, diverged branch, or missing status because Git errored
- `active`: dirty worktree, ahead branch, behind branch, or attached live agent/session
- `quiet`: clean and no attached live hints
- `unknown`: repository was discovered but could not be scanned enough to classify

The UI can sort by this rank without inventing product semantics.

## 7. Native UI Assumptions

The frontend can assume:

- the snapshot is complete enough to render without follow-up calls
- paths are absolute local filesystem paths
- project/worktree ids are stable for the same local repository paths
- `files` is a small preview list, not a full diff browser
- `diff.*Shortstat` and `lastCommitAt` are nullable fast-path fields
- the backend may add fields without breaking existing clients
- deeper diffs, watch subscriptions, and repo actions are later additions

## 8. Non-Goals

- No automatic commits, merges, rebases, branch creation, or destructive cleanup.
- No repo registry UI in this slice.
- No claim that Scout owns the repository state. Git remains the source of truth.
- No import of harness transcripts into Scout-owned messages.
- No global filesystem crawler.

## 9. Open Decisions

- Should Repo Watch eventually emit live events, or is a fast snapshot enough for the Mac app?
- Should branch protection labels be configurable beyond `main` and `master`?
- Which file preview limit gives useful signal without turning the response into a diff payload?
- Should hidden worktrees be configured through settings, a repo-local file, or an agentic command?
