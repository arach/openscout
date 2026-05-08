# SCO-028: Work Materials Inventory

## Status

Proposed.

## Proposal ID

`sco-028`

## Intent

Define a compact work-scoped inventory for the files, plans, specs, docs, and
code that an agent effort touches or produces.

The product goal is to frame these as **interesting materials in the network**,
not as something the operator must clear or answer.

## Problem

The work page can already show work state, ownership, timeline, flights, and
conversation links. Session observation can also show tool traces and touched
files. What is missing is a single work-scoped manifest that answers:

1. Which agents and sessions were involved?
2. Which files or documents changed or were created?
3. Which materials are plans, specs, docs, tests, config, or code?
4. Which source says that: git, trace logs, broker metadata, or inference?
5. How confident is the attribution?

OpenScout cannot assume every agent has an isolated worktree. Many agents may
run in a shared git repo, and some sessions may run outside git entirely.

## Decision

OpenScout SHOULD introduce a derived `WorkMaterialsInventory` projection.

It SHOULD compose evidence from three layers:

| Layer | Use |
|---|---|
| Broker records | Work item, conversation, invocation, flight, run, and explicit artifact links |
| Git state | Changed, added, deleted, renamed, staged, unstaged, and untracked files when the session cwd is inside a git repo |
| Trace evidence | Read, write, edit, command, attachment, and mentioned file paths from observe/session logs |

Git is the preferred material detector when available. Trace evidence is always
useful for provenance and is the fallback when git is unavailable.

## Inventory Modes

| Mode | Meaning | Confidence |
|---|---|---|
| `isolated-git-worktree` | Agent cwd is in a git worktree likely dedicated to the effort | high |
| `shared-git-repo` | Agent cwd is in git, but changes may include unrelated local work | medium |
| `trace-only` | No usable git state; paths come from trace/log evidence | low to medium |
| `explicit-artifacts` | Broker records link durable artifacts directly to the work item | high |

For shared repos, UI should separate "repo-local changes" from files also seen
in the session trace. Trace-overlapping files are better candidates for this
work item than untouched files found only in the raw repo diff.

## Suggested Shape

```ts
export interface WorkMaterialsInventory {
  workId: string;
  generatedAt: number;
  mode: "isolated-git-worktree" | "shared-git-repo" | "trace-only" | "explicit-artifacts";
  source: "broker" | "git" | "trace" | "mixed";
  confidence: "high" | "medium" | "low";
  agents: WorkInventoryAgentRef[];
  sessions: WorkInventorySessionRef[];
  materials: WorkMaterial[];
}

export interface WorkMaterial {
  id: string;
  kind: "plan" | "spec" | "doc" | "code" | "test" | "config" | "asset" | "other";
  path: string;
  status?: "added" | "modified" | "deleted" | "renamed" | "untracked" | "observed";
  agentId?: string;
  sessionId?: string;
  worktreeRoot?: string;
  baseRef?: string;
  headRef?: string;
  diffStat?: { additions: number; deletions: number };
  evidence: Array<"broker" | "git-status" | "git-diff" | "trace-read" | "trace-write" | "trace-edit" | "trace-command" | "inferred-path">;
  confidence: "high" | "medium" | "low";
}
```

## Product Rules

- The work page should show the manifest before raw diffs.
- Plans, specs, and docs should sort before code by default.
- Full diffs belong one level deeper in a code/diff viewer.
- The projection must not persist raw external harness transcripts as Scout
  messages.
- The projection must distinguish Scout-owned artifacts from observed or
  inferred files.
- Low-confidence attribution should be visible instead of hidden.

## Non-Goals

- forcing every agent into a dedicated worktree
- storing every raw diff as broker-owned state
- making trace logs authoritative work records
- replacing explicit artifact records when the broker already has them
- solving merge, patch application, or review workflow in this proposal

## Open Questions

1. Should inventories be computed on demand, cached, or stored as broker-owned
   snapshots when a run completes?
2. How should Scout detect that a git worktree is isolated enough for high
   confidence?
3. Should untracked files be included by default, or only when also seen in
   trace evidence?
4. Which path classifiers should be hard-coded first versus learned from repo
   conventions?
