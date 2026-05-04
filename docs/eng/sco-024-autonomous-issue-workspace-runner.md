# SCO-024: Autonomous Issue Workspace Runner

## Status

Proposed.

## Proposal ID

`sco-024`

## Intent

Define an OpenScout-native orchestration profile for autonomous project work
that starts from eligible issues, creates isolated workspaces, runs agents, and
hands results back for human review.

The core loop is:

```text
external issue -> Scout work item -> claim lease -> isolated workspace -> AgentRun/flight -> trace/artifacts -> review handoff
```

This proposal is intentionally narrower than SCO-023. SCO-023 defines the
general agent operations and run registry model. SCO-024 defines one concrete
profile built on top of that model: an always-on runner that advances issue
work through deterministic workspace placement, managed agent execution,
reconciliation, retry, continuation, and review.

## Motivation

Interactive coding agents have a supervision ceiling. A human can actively
manage only a handful of sessions before context switching becomes the
bottleneck. Symphony's key insight is to move the operator's attention from
"sessions I am watching" to "issues the system is advancing."

OpenScout already has better primitives for that pattern than a standalone
scheduler:

- the broker as canonical writer
- work items as durable ownership records
- invocations and flights as dispatch records
- trace surfaces as live evidence
- managed agents and agent revisions from SCO-023
- permission profiles, fabric placement, and sandbox enforcement from SCO-022

This SCO borrows the issue-control-plane shape from Symphony, the operational
discipline of durable execution, and a queryable operations model. It does not
make an external issue tracker or workflow engine the source of truth for Scout.

## References

- OpenAI Symphony: issue tracker as control plane, one isolated workspace and
  agent run per eligible issue.
- Symphony `SPEC.md`: `WORKFLOW.md`, polling, claiming, deterministic
  workspace keys, hooks, concurrency limits, retries, reconciliation, and Codex
  app-server events.
- Linear: issue lifecycle, team/project scoping, state transitions, priorities,
  labels, assignments, and webhook-driven reconciliation.
- GitHub Issues: issue lifecycle, repository scoping, labels, assignees,
  comments, branch/PR linkage, and webhook-driven reconciliation.
- Durable execution patterns: retries, human tasks, explicit worker
  boundaries, resumable waits, and recovery from process or workspace loss.
- Operational analytics patterns: saved views, queryable execution state,
  drill-down records, and dashboards over real operational objects rather than
  bespoke terminal state.

## Problem

OpenScout can route work to agents, but it does not yet have a built-in profile
for always-on autonomous project execution.

Specific gaps:

1. **External issues are not automatically work items.**
   A Linear or GitHub issue can inspire a Scout ask, but there is no canonical
   tracker-to-work-item synchronization loop.
2. **Workspace placement is manual.**
   Agents can run in a repo or worktree, but issue-specific workspace creation,
   reuse, hook execution, branch naming, cleanup, and artifact export are not
   one durable lifecycle.
3. **Dispatch lacks issue-aware gating.**
   We need active states, terminal states, blockers, priorities, per-state
   concurrency, claim leases, and stale-claim recovery.
4. **Retries are not tracker-aware.**
   A failed run should not retry if the issue was closed, blocked, manually
   cancelled, or moved to review while the runner was away.
5. **Continuation is ad hoc.**
   A long-running issue may need multiple turns in the same harness thread or
   a new run attempt in the same workspace. Today that boundary is prompt
   convention, not an operational rule.
6. **Human handoff is not first-class.**
   Success often means "a branch, patch, PR, or summary is ready for review,"
   not "the issue is done."
7. **Operations are not queryable enough.**
   Operators need saved views for stale claims, running attempts, waiting
   approvals, failed workspaces, retries, review handoffs, and permission
   posture.

## Decision

OpenScout SHOULD introduce an autonomous issue workspace runner as a
broker-owned or runtime-owned service profile.

The runner SHOULD:

1. poll or receive events from configured issue sources
2. normalize external issues into Scout work items
3. claim eligible work with a durable, expiring broker lease
4. provision deterministic per-issue workspaces under a configured fabric root
5. run bounded lifecycle hooks
6. launch a managed agent run using SCO-023 `AgentRun` semantics
7. dispatch through existing invocations and flights
8. stream runtime events into trace surfaces
9. attach artifacts such as branches, patches, PRs, summaries, logs, and test
   results
10. reconcile active claims, work items, workspaces, runs, flights, and external
    issue state
11. retry failed attempts with bounded, issue-aware backoff
12. continue active work up to profile limits
13. stop, release, or clean up when work becomes terminal
14. hand completed autonomous work to human review unless policy explicitly
    allows direct completion

OpenScout MUST remain the source of truth for runs, work state, review tasks,
permissions, traces, and artifacts. External trackers remain integration
surfaces and input signals.

## Non-Goals

- copying Symphony as a separate control plane
- replacing SCO-023's general run registry
- requiring Linear specifically
- requiring Codex only
- requiring cloud execution
- guaranteeing strong sandboxing without SCO-022 enforcement
- hard-coding business logic for how every team updates issues or PRs
- replacing manual asks, chats, ad hoc agent work, or human-led review
- building a general distributed workflow engine

## Design Principles

1. **Issue sources trigger work; Scout owns work.**
   The external issue is the control-plane signal, but the Scout work item is
   the durable ownership record.
2. **Claims are explicit leases.**
   Duplicate dispatch prevention requires a broker transaction, an owner,
   expiry, heartbeat, and fencing token.
3. **Workspaces are deterministic and fenced.**
   Every issue maps to one safe workspace key per profile unless policy
   explicitly creates a replacement.
4. **Runs are operational records.**
   Each attempt is an `AgentRun` or a projection into the SCO-023 run model,
   linked to an invocation, flight, trace session, workspace, and work item.
5. **Trace is evidence, not source of truth.**
   Runtime events enrich the run and workspace records but do not replace
   broker-owned state.
6. **Autonomy ends at a handoff by default.**
   The runner prepares work for review. Closing the issue or merging code is a
   separate policy decision.
7. **Reconciliation is normal operation.**
   Restarts, stale endpoints, lost tracker events, and half-finished workspaces
   are expected and handled by periodic reconciliation.

## Core Domain Model

| Concept | Meaning |
|---|---|
| `IssueSource` | External tracker connector such as Linear, GitHub Issues, or a local Scout work queue |
| `ExternalIssueSnapshot` | Normalized tracker record copied into Scout metadata for offline reconciliation |
| `IssueBinding` | Durable mapping between an external issue and a Scout work item |
| `IssueRunnerProfile` | Repository-owned policy for source selection, eligibility, workspace placement, hooks, agent, permissions, retry, continuation, and handoff |
| `IssueClaim` | Broker-owned lease that reserves one issue/work item for one runner generation |
| `IssueWorkspace` | Deterministic workspace bound to one issue/work item and one runner profile |
| `RunAttempt` | One SCO-023 `AgentRun` attempt to advance the work in that workspace |
| `Continuation` | Follow-up turn or follow-up attempt while the issue remains active and eligible |
| `Handoff` | Review-ready state and artifacts produced by autonomous execution |

Recommended ownership boundaries:

| Layer | Owns |
|---|---|
| Issue source | Tracker identity, tracker state names, remote URL, remote comments or labels |
| Broker | issue bindings, work items, claims, runs, review tasks, artifacts, policy decisions |
| Runtime | workspace lifecycle, fabric placement, harness process lifecycle, heartbeats |
| Harness adapter | harness-specific launch/resume/stop behavior and event mapping |
| Trace surface | live session evidence, tool events, approvals, denials, stdout/stderr summaries |

## Tracker Normalization

The runner SHOULD normalize tracker data into a stable shape before it decides
eligibility.

```ts
export interface ExternalIssueSnapshot {
  source: "linear" | "github" | "scout";
  sourceInstanceId?: string;
  externalId: string;
  identifier: string;
  title: string;
  description?: string | null;
  state: string;
  priority?: number | null;
  url?: string | null;
  labels: string[];
  assignee?: {
    id?: string | null;
    name?: string | null;
  } | null;
  branchName?: string | null;
  blockedBy?: Array<{
    externalId?: string | null;
    identifier?: string | null;
    state?: string | null;
  }>;
  createdAt?: number;
  updatedAt?: number;
  version?: string | number | null;
  lastSeenAt: number;
  metadata?: MetadataMap;
}
```

The snapshot SHOULD be copied into the corresponding Scout work item metadata
under a runner-owned key such as `metadata.issueRunner.externalIssue`. This lets
the broker reconcile active work even if the tracker is temporarily
unavailable.

The natural binding key SHOULD be:

```text
profileId + source + sourceInstanceId + externalId
```

`identifier` is for humans and workspace naming. It MUST NOT be the only
durable identity because many trackers allow issue identifiers to change across
imports, moves, or project migrations.

## Scout Work Item Projection

Each eligible external issue SHOULD have exactly one active Scout work item for
the same runner profile.

Recommended projection:

- `kind = "work_item"`
- `title = externalIssue.identifier + ": " + externalIssue.title`
- `ownerId = runner actor or configured responsible agent`
- `nextMoveOwnerId = runner actor` while queued or running
- `state = "open"` before dispatch
- `state = "working"` while a claim or attempt is active
- `state = "waiting"` when blocked, approval-gated, or missing a dependency
- `state = "review"` after autonomous handoff
- `state = "done"` only after human acceptance or explicit direct-complete policy
- `state = "cancelled"` when the external issue becomes terminal without review,
  the operator cancels it, or policy forbids further work

The work item SHOULD store:

- issue binding key
- latest `ExternalIssueSnapshot`
- profile ID and profile revision/hash
- active claim ID
- active run ID and flight ID
- workspace ID/path
- retry counters and next retry time
- handoff artifact IDs
- last reconciliation result

Manual changes to the Scout work item are stronger than tracker polling. For
example, if an operator moves the work item to `cancelled`, the runner MUST stop
dispatching even if the external issue still appears active.

## Runner Profile

The runner profile is the durable policy contract for autonomous execution.

It should be repository-owned and versioned. A first implementation SHOULD use
a structured file such as `.openscout/issue-runner.json` or
`.openscout/issue-runner.yaml`. A Symphony-style `WORKFLOW.md` MAY be supported
as a prompt/profile import format, but OpenScout should persist the effective
profile as structured data so the runner can validate it without parsing prose.

Possible shape:

```ts
export interface IssueRunnerProfile {
  id: ScoutId;
  displayName: string;
  enabled: boolean;
  projectRoot: string;
  revision?: string;
  tracker: {
    kind: "linear" | "github" | "scout";
    sourceInstanceId?: string;
    projectKey?: string;
    query?: string;
    activeStates: string[];
    terminalStates: string[];
    blockedStates?: string[];
    handoffStates?: string[];
    labelAllowlist?: string[];
    labelBlocklist?: string[];
  };
  polling: {
    intervalMs: number;
    jitterMs?: number;
    staleSourceAfterMs?: number;
  };
  claim: {
    leaseMs: number;
    heartbeatMs: number;
    staleGraceMs: number;
  };
  workspace: {
    root: string;
    mode: "worktree" | "copy" | "container" | "external_sandbox";
    branchTemplate?: string;
    baseRef?: string;
    cleanupTerminal?: boolean;
    retainReviewWorkspaces?: boolean;
    dirtyWorkspacePolicy?: "reuse" | "quarantine" | "fail";
  };
  hooks?: {
    afterCreate?: string;
    beforeRun?: string;
    afterRun?: string;
    beforeRemove?: string;
    timeoutMs?: number;
  };
  agent: {
    agentId: ScoutId;
    maxConcurrentRuns: number;
    maxConcurrentRunsByState?: Record<string, number>;
  };
  continuation: {
    maxTurnsPerAttempt: number;
    maxAttemptsPerIssue: number;
    continueInSameThread: boolean;
    stallAfterMs: number;
  };
  retry: {
    maxAttempts: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
    jitterMs?: number;
    retryableFailureKinds: string[];
  };
  permissions?: {
    permissionProfile?: ScoutPermissionProfile;
    requireReviewBeforePush?: boolean;
    requireReviewBeforeIssueDone?: boolean;
    requiredCapabilities?: string[];
  };
  handoff: {
    createReviewTask: boolean;
    reviewerId?: ScoutId;
    moveTrackerToState?: string;
    commentTemplate?: string;
    artifactPolicy: "summary" | "patch" | "branch" | "pull_request";
  };
  promptTemplate: string;
}
```

Unknown fields SHOULD be ignored for forward compatibility. Invalid required
fields SHOULD block new dispatch while keeping reconciliation active, so
existing claims can be released, cancelled, or moved to review safely.

## Eligibility And Dispatch Rules

An external issue is eligible when:

1. it has a stable `externalId` and human-readable `identifier`
2. the runner profile is enabled and valid
3. the issue state is active
4. the issue state is not terminal
5. the issue is not blocked by tracker state, labels, or dependencies
6. the corresponding Scout work item is not terminal
7. the Scout work item does not assign next move to a human or another agent
8. no non-expired claim exists for the binding key
9. no active run attempt exists for the work item
10. global and per-state concurrency slots are available
11. a workspace can be safely resolved under the configured root
12. the selected agent revision and permission profile are available
13. the requested permission posture can be enforced honestly enough for the
    profile

Recommended sorting:

1. priority ascending, with missing priority last
2. oldest created issue first
3. oldest `updatedAt` first when creation time is unavailable
4. identifier lexicographic tie-breaker

The dispatch tick SHOULD be idempotent. If two runner processes see the same
eligible issue, only the broker transaction that creates or renews the claim
lease may proceed to workspace provisioning.

## Claim Semantics

`IssueClaim` prevents duplicate dispatch and gives reconciliation something to
reason about after restarts.

```ts
export interface IssueClaim {
  id: ScoutId;
  profileId: ScoutId;
  bindingKey: string;
  workId: ScoutId;
  runnerId: ScoutId;
  generation: number;
  state:
    | "claimed"
    | "provisioning"
    | "running"
    | "waiting"
    | "review"
    | "releasing"
    | "released"
    | "expired"
    | "cancelled";
  leaseOwnerId: ScoutId;
  leaseExpiresAt: number;
  heartbeatAt?: number;
  workspaceId?: ScoutId;
  runId?: ScoutId;
  flightId?: ScoutId;
  attempt: number;
  nextRetryAt?: number;
  lastError?: {
    kind: string;
    message: string;
    retryable: boolean;
  };
  createdAt: number;
  updatedAt: number;
  metadata?: MetadataMap;
}
```

Claim rules:

- There MUST be at most one non-terminal claim per binding key.
- Claim creation and claim renewal MUST happen inside a broker-owned compare
  and set operation.
- Every dispatch side effect SHOULD carry the claim ID and generation as a
  fencing token.
- A stale completion from an older generation MUST NOT overwrite a newer claim,
  run, or work item transition.
- The runner SHOULD heartbeat claims while provisioning, running, and waiting
  on harness lifecycle.
- A claim whose lease expired MAY be reclaimed only after reconciliation checks
  the linked flight, workspace, and work item.
- A review claim SHOULD remain non-terminal until human action accepts,
  reopens, or cancels the work.

This is the worker boundary: claiming a unit of work is a durable lease with
recovery rules, not an in-memory queue pop.

## Workspace Lifecycle

Workspace paths MUST be deterministic and root-contained.

Recommended key algorithm:

1. start from `profileId + "-" + externalIssue.identifier`
2. replace characters outside `[A-Za-z0-9._-]` with `_`
3. collapse repeated `_`
4. append a short hash of the binding key if needed for uniqueness
5. compute the absolute path under `workspace.root`
6. reject paths that escape the root after realpath/symlink checks

`IssueWorkspace` SHOULD record:

- workspace ID
- profile ID
- binding key and work item ID
- mode
- absolute path or external environment ID
- source project root
- base ref and base commit when available
- branch name when applicable
- creation time and last used time
- dirty state
- cleanup policy and deadline
- requested and effective permission profile
- produced artifact directory

Lifecycle:

1. resolve deterministic workspace key
2. acquire or create the workspace record
3. create local directory, worktree, container, or external sandbox
4. run `afterCreate` only on first creation
5. run `beforeRun` before each attempt
6. start or resume the harness in that workspace
7. run `afterRun` after each attempt, even when the attempt fails when possible
8. export artifacts and update workspace dirty state
9. retain workspaces in review unless `retainReviewWorkspaces` is false and all
   review artifacts are exported
10. run `beforeRemove` before cleanup
11. remove or archive the workspace only after terminal reconciliation

Initial workspace modes:

| Mode | Meaning |
|---|---|
| `worktree` | Create a git worktree and branch for the issue |
| `copy` | Copy or sync selected project files into an isolated directory |
| `container` | Use local container fabric from SCO-022 |
| `external_sandbox` | Place work in a remote sandbox provider |

The first implementation SHOULD support `worktree` or `copy` before containers.
`container` and `external_sandbox` SHOULD use SCO-022 fabric records rather than
inventing runner-specific sandbox state.

The runner MUST NOT silently mutate the user's primary worktree unless the
profile explicitly selects a trusted shared workspace and the permission policy
allows it.

## Branch And Artifact Semantics

For `worktree` mode, branch naming SHOULD be deterministic and collision-safe.

Recommended default:

```text
codex/{identifier-slug}-{short-binding-hash}
```

If a tracker supplies a branch name, the runner MAY use it only after applying
the same path/ref safety checks. Branch names that already exist with unrelated
history SHOULD fail or quarantine rather than force-push or overwrite.

Artifacts SHOULD be attached to the `AgentRun` and work item, not only left in
the workspace. Supported artifacts include:

- summary
- patch
- branch reference
- pull request URL
- test report
- log excerpt
- screenshots or other media
- exported sandbox diff

The workspace is an execution surface. The artifact record is the durable
handoff surface.

## Execution Model

Each run attempt SHOULD:

1. refresh the external issue snapshot and work item
2. verify the claim lease and generation
3. create or reuse the workspace
4. render the prompt with strict variables
5. snapshot the agent revision and permission profile
6. create an SCO-023 `AgentRun` with `source = "external_issue"`
7. issue an invocation linked to the work item, run, claim, and workspace
8. start or resume a flight for the selected managed agent
9. stream runtime events into the trace surface
10. project meaningful checkpoints into work item progress
11. detect tool approvals, policy denials, input-needed states, stalls, and
    harness failures
12. attach artifacts
13. reconcile the result into work item, claim, run, and tracker state

Prompt rendering SHOULD expose only explicit variables:

- issue identifier, title, description, URL, labels, and state
- blocker summary
- Scout work item ID
- profile ID
- workspace path or environment label
- allowed handoff actions
- permission profile and review requirements
- previous attempt summary for continuations

The runner SHOULD NOT rebuild long prompts by scraping conversation history.
Continuation inputs should come from broker-owned run summaries, artifacts,
work item progress, and the latest issue snapshot.

## Continuation Semantics

Continuation is allowed when:

- the issue remains active and eligible
- the Scout work item remains `working`
- the claim lease is still valid or successfully renewed
- the active attempt has not exceeded `maxTurnsPerAttempt`
- the issue has not been moved to human review, waiting, done, or cancelled
- the harness thread can be safely resumed or a new attempt can be linked to
  the previous attempt summary

If `continueInSameThread` is true and the harness supports it, the runner MAY
send a short continuation prompt to the same live thread. Each continuation
turn SHOULD be represented as a run step or trace-linked child event under the
same `AgentRun`.

If the harness cannot resume safely, the runner MAY create a new `RunAttempt`
in the same workspace. The new attempt MUST include:

- parent run ID
- previous attempt summary
- current workspace dirty state
- current branch or patch state
- latest issue snapshot
- reason for starting a new attempt

Continuation is not retry. A continuation advances active work after a normal
turn. A retry recovers from a failed or interrupted attempt.

## Reconciliation

The orchestrator SHOULD run reconciliation before each dispatch tick and on a
separate sweeper interval.

Reconciliation inputs:

- latest issue snapshots
- issue bindings
- Scout work item state
- claims and lease expiry
- AgentRun state
- invocation and flight state
- trace last-activity time
- workspace records and filesystem/fabric state
- review task state

Reconciliation actions:

- create missing work items for eligible issues
- mark work items waiting when blockers appear
- release claims when issues are no longer eligible
- cancel runs whose issues become terminal or whose work items are cancelled
- renew healthy running claims
- mark stalled attempts when flights or traces stop progressing
- retry transient failures when backoff expires
- quarantine dirty or inconsistent workspaces
- preserve review workspaces and artifacts until human action
- clean up terminal workspaces when configured
- write tracker comments or state transitions only through configured handoff
  policy

State mapping:

| Observation | Scout transition |
|---|---|
| External issue becomes terminal before handoff | cancel active run, set work item `cancelled`, release claim |
| External issue becomes blocked | set work item `waiting`, name blocker in `waitingOn`, pause/release claim |
| Tracker unavailable | keep active claims within lease, stop new dispatch after `staleSourceAfterMs` |
| Flight completes with review artifact | set work item `review`, create review task, retain workspace |
| Flight fails retryably | set claim `waiting`, schedule retry, keep work item `working` or `waiting` with error summary |
| Flight fails non-retryably | set work item `waiting` for human decision or `review` with failure artifact |
| Operator cancels work item | cancel run/flight if possible, release claim, optionally comment on tracker |
| Operator reopens review work | move work item `working`, create continuation attempt if still eligible |

The reconciler MUST be idempotent. Re-running it with the same inputs should not
create duplicate work items, claims, review tasks, comments, branches, or PRs.

## Retry And Failure Handling

Retries SHOULD be issue-aware and bounded.

Failure categories:

| Kind | Retry default | Handling |
|---|---|---|
| `tracker_unavailable` | yes | pause new dispatch, continue healthy active runs until source staleness limit |
| `broker_restart` | yes | reconcile claims, flights, and workspaces from durable state |
| `endpoint_offline` | yes | wait for agent availability or wake trigger, then retry |
| `harness_crash` | yes | retry in same workspace with previous attempt summary |
| `workspace_create_failed` | maybe | retry only for transient filesystem/fabric errors; path safety failures are hard |
| `hook_failed` | maybe | retry when hook is marked retryable; otherwise wait for human |
| `permission_denied` | no | create review/approval task or fail according to policy |
| `policy_incompatible` | no | block dispatch until profile or agent capability changes |
| `tests_failed` | maybe | allow continuation if the agent can fix; otherwise hand off failure artifact |
| `agent_reported_blocked` | no automatic retry | set work item `waiting` with explicit dependency |

Retry rules:

- retry only while the issue remains eligible
- retry only while the Scout work item remains non-terminal
- use exponential backoff with jitter up to `maxBackoffMs`
- cap retries by `maxAttempts`
- preserve the workspace unless it is unsafe or explicitly disposable
- attach previous failure summaries to the next attempt
- require human review after repeated failures or non-retryable failures

A retry MUST NOT push a branch, update a tracker state, or close a work item as
a side effect of recovering from failure unless the current claim generation is
still valid.

## Handoff And Review

Autonomous execution should usually end in review, not silent completion.

Handoff examples:

- branch pushed and PR opened
- patch artifact attached
- summary and test results attached
- issue comment written
- review task assigned
- issue state moved to `Human Review` or equivalent
- workspace retained for a human or follow-up agent

Default handoff behavior:

1. set the work item state to `review`
2. set `acceptanceState = "pending"` when there is a requester or reviewer
3. set `nextMoveOwnerId` to the configured reviewer or operator
4. create an SCO-023 `ReviewTask` of kind `handoff`
5. attach artifacts to the run and work item
6. retain the workspace unless exported artifacts are sufficient and cleanup is
   explicitly allowed
7. optionally update the external tracker according to the profile

Human decisions:

| Decision | Runner behavior |
|---|---|
| Accept | mark work item `done`, release claim, clean workspace if configured, optionally move tracker terminal |
| Request changes | move work item `working`, create continuation attempt if issue remains eligible |
| Approve push/PR | grant scoped permission and resume handoff step |
| Reassign | release runner claim and set `nextMoveOwnerId` to the assignee |
| Cancel | cancel active run, release claim, preserve artifacts, optionally update tracker |

The agent may perform tracker writes through tools when policy permits it, but
the runner should still record handoff as a broker-owned event. Tracker writes
that change issue lifecycle state SHOULD be idempotent and tied to the current
claim generation.

## Permissions And Sandboxing

This proposal depends on SCO-022 for permission profiles and enforcement.

Default autonomous work SHOULD avoid `trusted_local` unless explicitly chosen.
Recommended defaults:

- `observe` for planning and issue triage
- `workspace_write` for ordinary local worktrees
- `sandboxed_write` for untrusted tasks or generated-code-heavy changes
- `external_sandbox` for third-party repositories or stronger isolation needs

The runner MUST record on every attempt:

- requested permission profile
- effective enforcement level
- workspace/fabric environment
- harness sandbox and approval posture when available
- denied actions and approval waits
- grants used by the run

The runner MUST NOT present advisory prompt-only restrictions as a real
workspace-write sandbox. If a selected harness cannot satisfy the requested
profile, dispatch should fail with `policy_incompatible` or route to a stronger
fabric target.

Sensitive actions SHOULD be capability-gated:

| Action | Example capability |
|---|---|
| create workspace/container | `fabric.create` |
| remove workspace/container | `fabric.destroy` |
| write files | `fs.write` |
| run commands | `command.run` |
| read secrets | `secrets.read` |
| create branch/commit | `git.write` |
| push/open PR | `git.remote_write` |
| update Scout records | `broker.write` |
| update external tracker | integration-specific write capability |

## Operational Views

The runner should produce queryable state rather than requiring operators to
inspect terminal scrollback.

Useful built-in views:

- eligible but unclaimed issues
- active claims
- stale claims
- running attempts
- stalled flights
- waiting on approval
- waiting on blocker
- retry scheduled
- repeated failures
- review handoffs
- dirty retained workspaces
- permission profile distribution
- tracker write failures
- workspace cleanup backlog

Useful metrics:

- issue lead time to first claim
- claim wait time
- attempt duration
- continuation count
- retry count by failure kind
- handoff acceptance rate
- reopened review rate
- workspace cleanup latency
- token and cost totals by profile, source, agent revision, and issue state

The proposal should make autonomous execution observable through durable
dimensions and filters before building elaborate dashboards.

## Event And Trace Semantics

The broker SHOULD append durable events for:

- issue snapshot received
- work item created or updated from issue
- issue claim created, renewed, expired, released, or cancelled
- workspace created, reused, quarantined, retained, or removed
- hook started, completed, failed, or timed out
- run attempt created, started, waiting, reviewed, completed, failed, or
  cancelled
- continuation started or capped
- retry scheduled or abandoned
- artifact attached
- handoff created
- human decision recorded
- tracker write requested, completed, failed, or skipped

Trace events from the harness SHOULD link back to:

- work item ID
- claim ID and generation
- run ID
- run step ID when available
- invocation ID
- flight ID
- workspace ID
- permission policy/grant IDs when applicable

This keeps live traces useful without making traces the only recovery record.

## Invariants

1. There is at most one active Scout work item per profile/source/external issue
   binding.
2. There is at most one non-terminal issue claim per binding key.
3. Every non-terminal work item has `ownerId` and `nextMoveOwnerId`.
4. Every active claim has a lease expiry, owner, generation, and heartbeat
   policy.
5. Every run attempt links to a work item, claim, workspace, agent revision or
   snapshot, invocation, and flight when dispatch succeeds.
6. Workspace paths never escape the configured root.
7. Hook execution is bounded by timeout and recorded as an event.
8. Retry never happens after the issue or Scout work item is terminal.
9. Handoff artifacts are attached before the work item enters `review`.
10. Direct issue completion is opt-in; review is the default autonomous
    terminal.
11. Stale generations cannot update newer claims, runs, work items, tracker
    states, branches, or PRs.
12. Requested and effective permission posture are recorded on every attempt.

## Relationship To Existing SCOs

- SCO-002 defines work projection and trace layering.
- SCO-005 defines trace-first observability.
- SCO-007 defines run graphs and recipes.
- SCO-009 defines activation leases and wake triggers.
- SCO-014 defines broker-owned routing and context.
- SCO-022 defines permission profiles, sandboxing, and project fabric.
- SCO-023 defines the general run registry and agent operations layer.

This SCO defines the autonomous issue runner profile built on top of those
foundations.

## First Implementation Slice

The first implementation should prove the Scout-native loop before adding
external tracker complexity.

### Phase 1: Scout-Native Source And Claims

1. Add a local `scout` issue source that reads existing `work_item` records with
   runner metadata or labels.
2. Add `IssueBinding` and `IssueClaim` storage or metadata projections in
   existing broker storage.
3. Implement eligibility filtering, deterministic sorting, claim creation,
   claim heartbeat, and stale-claim release.
4. Project one claim into one SCO-023 `AgentRun` or the current
   `InvocationRequest` + `FlightRecord` shape.

### Phase 2: Deterministic Local Workspace

1. Add workspace allocation under a configured support directory such as
   `.openscout/workspaces`.
2. Support `copy` or `worktree` mode.
3. Record workspace metadata, branch names, dirty state, and artifact paths.
4. Run bounded `afterCreate`, `beforeRun`, `afterRun`, and `beforeRemove`
   hooks.
5. Reject unsafe paths and quarantine inconsistent workspaces.

### Phase 3: Attempt, Retry, And Continuation

1. Dispatch one managed agent per eligible claim with bounded concurrency.
2. Link work item, claim, workspace, invocation, flight, trace, and run IDs.
3. Record retryable and non-retryable failure kinds.
4. Implement bounded backoff and max attempts.
5. Support same-thread continuation for harnesses that can resume safely, with
   new-attempt fallback.

### Phase 4: Review Handoff

1. Add review handoff state and artifact attachment.
2. Create `ReviewTask` records or projections for handoff decisions.
3. Preserve review workspaces by default.
4. Support accept, request-changes, reassign, and cancel decisions.
5. Keep issue completion behind explicit policy.

### Phase 5: External Issue Sources

1. Add Linear or GitHub issue source after the Scout-native loop works.
2. Store `ExternalIssueSnapshot` metadata and binding keys.
3. Implement tracker-aware active, terminal, blocked, and handoff states.
4. Add idempotent tracker comments/state writes through handoff policy.

### Phase 6: Fabric And Operations

1. Route `container` and `external_sandbox` modes through SCO-022 fabric
   records.
2. Record requested/effective enforcement posture.
3. Add saved operational views for claims, retries, handoffs, stale runs,
   workspace cleanup, and permission posture.
4. Add metrics over lead time, duration, retries, cost, acceptance, and cleanup.

## Open Questions

- Should the first runner live in the broker daemon, runtime daemon, or a
  separate project worker process with broker-owned leases?
- Should OpenScout standardize on `.openscout/issue-runner.json`, or support
  `WORKFLOW.md` as a first-class profile format for Symphony compatibility?
- Should one work item allow multiple concurrent issue-runner attempts for
  sharded tasks, or should SCO-024 guarantee one active attempt per work item?
- Which tracker writes should be broker-mediated versus agent-performed through
  tools?
- How much continuation state belongs in SCO-023 run steps versus
  runner-specific metadata in the first slice?
- What is the minimum review task implementation needed before external
  trackers can safely move issues to `Human Review`?
