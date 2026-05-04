# SCO-023: Agent Operations and Run Registry

## Status

Proposed.

## Proposal ID

`sco-023`

## Intent

Define OpenScout's agent operations layer: a durable, local-first run registry
for structured agent execution, operational inspection, human review, eval
capture, and agent revision promotion.

The core loop is:

```text
agent definition -> immutable revision -> run -> trace/artifacts/review -> eval/promotion
```

OpenScout should become the place where an operator can answer:

1. Which agent ran?
2. Which exact prompt, model, tools, permissions, sandbox posture, and runtime
   profile did it use?
3. What work did it produce?
4. What did it cost?
5. Which approvals, reviews, retries, or handoffs happened?
6. Should this agent revision be promoted, rolled back, canaried, or retired?

This proposal defines the general operations and run-registry layer. SCO-024 is
one concrete consumer of this layer for autonomous issue workspace execution.

## Motivation

OpenScout already has many of the ingredients: broker-owned identities,
messages, invocations, flights, work records, live traces, and managed local
agents. What is missing is a single product concept that makes agent execution
feel operationally reliable instead of chat-shaped.

Recent agent, prompt, and workflow platforms converge on the same operating
pattern:

- Durable workflow systems make execution history, retries, waiting states,
  human tasks, and recovery first-class.
- PromptRepo-style prompt platforms, LangSmith, PromptLayer, Braintrust,
  Vellum, Langfuse, and Portkey treat prompts or agents as versioned deployable
  artifacts with release labels, traces, evals, comparisons, and rollback.
- Operational analytics tools demonstrate the value of saved queries,
  dashboards, metrics, permissions, and shareable views.

OpenScout should borrow the operating discipline, not the hosted SaaS shape.
The broker should remain the durable source of truth, with local operation as
the base case.

## Problem

Current execution records are useful, but the operator model is still spread
across several planes:

1. **Agent configuration is mutable and launch-shaped.**
   Managed agents can store launch args, model, reasoning effort, and
   permission profile, but a flight does not yet point at an immutable agent
   definition revision.
2. **Runs are implicit.**
   `InvocationRequest` and `FlightRecord` are close to a run model, but the
   product does not yet treat a run as the durable unit for cost, review,
   artifact, trace, and eval.
3. **Review is event-specific.**
   Session approvals and operator attention exist, but there is no general
   review queue for agent outputs, prompt promotions, expensive runs, failed
   executions, or eval labeling.
4. **Learning from history is manual.**
   Good and bad flights are not easily converted into eval examples,
   regression tests, candidate comparisons, or canary signals.
5. **Operational visibility is not queryable enough.**
   We need saved views such as "stale runs", "waiting for review", "high token
   cost", "failed by harness", "permission denied", and "ready for promotion".

## Decision

OpenScout SHOULD introduce a broker-owned agent operations model with these
first-class resources:

| Resource | Meaning |
|---|---|
| `AgentRevision` | Immutable execution contract for an agent: prompt, harness, model, tools, MCP, permissions, workspace policy, launch settings, and provenance |
| `AgentAlias` | Stable routeable name such as `@ranger` or a release label that resolves to one or more revisions |
| `Run` | Durable execution instance produced by an invocation, schedule, recipe, manual dispatch, external work item, or future runner |
| `RunStep` | Sparse structured milestone such as dispatch, turn, tool call summary, approval, spawned agent, retry, handoff, review, or checkpoint |
| `RunArtifact` | Durable output attached to a run: patch, PR, file, report, screenshot, dataset row, log bundle, or summary |
| `ReviewTask` | Human review or approval item with assignment, status, decision, comments, and audit trail |
| `EvalExample` | Input, expected behavior, artifacts, and judgment captured from a run for later evaluation |
| `EvalRun` | Evaluation execution comparing examples against one or more candidate revisions |
| `Promotion` | Audited change that moves an alias, release label, default revision, or traffic split |
| `SavedRunView` | Named operational query over runs, reviews, costs, revisions, and artifacts |

The existing `InvocationRequest` and `FlightRecord` SHOULD be preserved. The
first implementation SHOULD project them into the run registry before adding
new write paths or replacing protocol objects.

## Product Rule

- A **conversation** is what humans and agents said.
- A **work item** is what somebody owns.
- An **invocation** is the request to dispatch work.
- A **flight** is the delivery and response lifecycle for that request.
- A **run** is what executed over time.
- A **trace** is how the runtime behaved while it executed.
- A **review task** is what requires human judgment.
- An **agent revision** is the exact reusable capability that ran.

The UI may combine these, but the broker should keep the boundaries clear.

## Relationship To Existing Execution Records

SCO-007 defines the durable execution plane: recipes, runs, and run graphs.
This SCO specializes that run concept for agent operations and registry use.
The two should converge on one `Run` primitive rather than creating parallel
execution nouns.

The compatibility rules are:

1. A `FlightRecord` remains the dispatch-plane record for one invocation
   lifecycle.
2. A `Run` MAY start as a projection over one `InvocationRequest` and one
   `FlightRecord`.
3. A richer run MAY later contain multiple flights, retries, spawned agents, or
   recipe steps.
4. A work item MAY have zero, one, or many runs.
5. A trace MAY annotate a run and its steps, but trace is not the canonical run
   state.
6. Older clients MAY continue to navigate by `flightId`; run surfaces SHOULD
   carry `invocationId` and `flightId` until migration pressure is clear.

## Goals

- record the exact agent revision and runtime posture for every run
- make runs queryable by state, agent, revision, model, harness, cost,
  duration, review state, permission profile, sandbox posture, workspace,
  source, requester, and parent work item
- attach durable artifacts to runs without scraping raw trace as product state
- create human review tasks from approvals, failures, low confidence, high
  cost, promotion requests, risky artifacts, or user flags
- let operators save successful prompts and flows as reusable agent revisions
- support offline evals from broker history
- support candidate comparisons, canaries, and rollback for agent aliases
- support dashboards and saved views over operational data

## Non-Goals

- replacing `InvocationRequest` or `FlightRecord` in the first implementation
- replacing live traces with a workflow engine
- building a full BI platform
- forcing every ad hoc chat into a deployable agent definition
- requiring hosted SaaS infrastructure
- requiring one particular eval framework
- making model quality judgments fully automatic
- defining the autonomous issue workspace runner from SCO-024

## Design Principles

1. The broker owns durable operations state.
2. The runtime and harnesses provide execution evidence, not product authority.
3. Agent revisions are immutable and reproducible enough for audit.
4. Alias movement is explicit, reviewable, and reversible.
5. Run steps are sparse operational milestones, not a copy of every trace block.
6. Review tasks are idempotent and auditable.
7. Evals begin as captured examples and comparisons before becoming automation.
8. Saved views are operational read models, not a second orchestration system.
9. Migration starts with projection over existing records.

## Agent Revision Model

An agent revision captures the execution contract, not just the prompt. It is
closer to a versioned deployable artifact from a prompt platform than to a live
session card.

`ScoutAgentCard` can remain the discovery and routing card for addressable
agents. `AgentRevision` should capture the immutable capability that a run used.

Possible shape:

```ts
export interface AgentRevision {
  id: ScoutId;
  agentId: ScoutId;
  definitionId?: ScoutId;
  revision: number;
  digest: string;
  state: "draft" | "active" | "retired";
  createdAt: number;
  createdById: ScoutId;
  displayName: string;
  description?: string;
  prompt: {
    system?: string;
    template?: string;
    variablesSchema?: MetadataMap;
    renderedPreviewHash?: string;
  };
  runtime: {
    harness: AgentHarness;
    transport?: string;
    model?: string;
    reasoningEffort?: string;
    session?: "new" | "existing" | "any";
    launchArgs?: string[];
  };
  tools: {
    mcpServers?: string[];
    skills?: string[];
    dynamicTools?: string[];
  };
  permissions: {
    permissionProfile?: string;
    sandbox?: string;
    approvalPolicy?: string;
    enforcementLevel?: string;
    secretRefs?: string[];
  };
  workspace?: {
    projectRoot?: string;
    cwd?: string;
    mode?: "shared" | "isolated" | "external_sandbox";
    hooks?: string[];
  };
  provenance: {
    source: "managed_agent" | "ad_hoc" | "imported" | "promotion";
    sourceRef?: string;
    parentRevisionId?: ScoutId;
  };
  metadata?: MetadataMap;
}
```

Rules:

- Every run SHOULD record an `agentRevisionId`.
- If a run uses ad hoc configuration, the broker SHOULD snapshot it as an
  anonymous or draft revision so the execution still has an audit anchor.
- Revision records MUST NOT store secret values. They may store secret names or
  broker-managed secret references.
- A revision digest SHOULD cover fields that affect execution behavior.
- Revisions are immutable after creation except for metadata that is explicitly
  annotation-only.

## Agent Alias And Promotion Model

Aliases are stable routing and release handles. They let the product say
`@ranger` while the registry records exactly which revision handled a run.

Possible shape:

```ts
export interface AgentAlias {
  id: ScoutId;
  handle: string;
  displayName?: string;
  currentRevisionId: ScoutId;
  previousRevisionId?: ScoutId;
  traffic?: Array<{
    revisionId: ScoutId;
    weight: number;
    label?: "stable" | "canary" | "rollback" | "experiment";
  }>;
  updatedAt: number;
  updatedById: ScoutId;
  metadata?: MetadataMap;
}
```

Alias movement SHOULD create a `Promotion` record:

```ts
export interface Promotion {
  id: ScoutId;
  aliasId: ScoutId;
  fromRevisionId?: ScoutId;
  toRevisionId: ScoutId;
  kind: "promote" | "rollback" | "canary" | "retire";
  requestedById: ScoutId;
  reviewTaskId?: ScoutId;
  evalRunIds?: ScoutId[];
  decision?: "approved" | "rejected" | "auto_passed";
  createdAt: number;
  completedAt?: number;
  metadata?: MetadataMap;
}
```

PromptRepo-style semantics to preserve:

- Revisions are diffable.
- Release labels move; revision content does not.
- Promotions should cite eval results, review decisions, or an explicit
  operator override.
- Rollback is another promotion event, not mutation of history.
- Canary routing is alias policy, not a separate agent identity.

## Run Model

A run is the durable operator-facing execution record. In v1, it can be a
projection over existing invocation and flight records. Later, it can become
the canonical execution row while flights remain dispatch receipts.

Possible shape:

```ts
export interface AgentRun {
  id: ScoutId;
  source:
    | "ask"
    | "message"
    | "schedule"
    | "recipe"
    | "external_issue"
    | "manual"
    | "eval";
  requesterId: ScoutId;
  agentId: ScoutId;
  agentRevisionId?: ScoutId;
  aliasId?: ScoutId;
  workId?: ScoutId;
  conversationId?: ScoutId;
  messageId?: ScoutId;
  invocationId?: ScoutId;
  flightIds?: ScoutId[];
  parentRunId?: ScoutId;
  rootRunId?: ScoutId;
  recipeId?: ScoutId;
  attempt?: number;
  idempotencyKey?: string;
  state:
    | "queued"
    | "waking"
    | "running"
    | "waiting"
    | "review"
    | "completed"
    | "failed"
    | "cancelled";
  reviewState?: "none" | "needed" | "blocked" | "approved" | "rejected";
  terminalReason?: string;
  input: MetadataMap;
  output?: MetadataMap;
  artifactIds?: ScoutId[];
  reviewTaskIds?: ScoutId[];
  traceSessionIds?: ScoutId[];
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  completedAt?: number;
  metrics?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedUsd?: number;
    wallClockMs?: number;
    toolCallCount?: number;
    retryCount?: number;
  };
  metadata?: MetadataMap;
}
```

State projection from existing records can start conservatively:

| Current source | Run state |
|---|---|
| `FlightRecord.state = queued` | `queued` |
| `FlightRecord.state = waking` | `waking` |
| `FlightRecord.state = running` | `running` |
| `FlightRecord.state = waiting` | `waiting` |
| pending review task blocks completion | `review` |
| `FlightRecord.state = completed` | `completed` unless review is required |
| `FlightRecord.state = failed` | `failed` |
| `FlightRecord.state = cancelled` | `cancelled` |

The run record should not pretend to know more than the sources provide. When
cost, model, sandbox, or artifacts are unavailable, the read model should expose
unknown values rather than manufacturing certainty.

## Run Steps

Run steps are sparse operational milestones. They are not a durable copy of
every trace turn, block, stdout line, or adapter-specific event.

Useful step kinds:

- `dispatch`
- `wake`
- `turn`
- `tool_summary`
- `approval`
- `review`
- `retry`
- `spawn`
- `handoff`
- `artifact`
- `eval`
- `checkpoint`

Possible shape:

```ts
export interface RunStep {
  id: ScoutId;
  runId: ScoutId;
  parentStepId?: ScoutId;
  sequence: number;
  kind:
    | "dispatch"
    | "wake"
    | "turn"
    | "tool_summary"
    | "approval"
    | "review"
    | "retry"
    | "spawn"
    | "handoff"
    | "artifact"
    | "eval"
    | "checkpoint";
  state: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  actorId?: ScoutId;
  sourceRef?: {
    kind: "flight" | "trace" | "review_task" | "artifact" | "work_item";
    id: ScoutId;
    version?: number;
  };
  title?: string;
  summary?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: MetadataMap;
}
```

V1 can create steps from flight lifecycle changes and normalized approval
requests. Later, recipe-driven execution from SCO-007 can write richer graph
steps without changing the operator vocabulary.

## Run Artifacts

Artifacts should be durable resources with provenance, not scraped blobs hidden
inside summaries.

Possible shape:

```ts
export interface RunArtifact {
  id: ScoutId;
  runId: ScoutId;
  stepId?: ScoutId;
  kind:
    | "patch"
    | "branch"
    | "commit"
    | "pull_request"
    | "file"
    | "report"
    | "screenshot"
    | "dataset_row"
    | "log_bundle"
    | "summary";
  title: string;
  uri?: string;
  resourceId?: ScoutId;
  contentHash?: string;
  reviewTaskId?: ScoutId;
  createdAt: number;
  createdById?: ScoutId;
  metadata?: MetadataMap;
}
```

Artifacts should attach to both the run and the relevant work item when one
exists. A PR produced by SCO-024 is still just a run artifact from this SCO's
point of view.

## Review Queue

Review tasks generalize permission approval without replacing native session
approval semantics.

Examples:

- approve a command or file change
- review a produced PR before handoff
- decide whether to retry a failed run
- approve promotion of an agent revision to an alias
- inspect an expensive or low-confidence run
- label a run as a good or bad eval example
- resolve a handoff before a work item is marked done

Possible shape:

```ts
export interface ReviewTask {
  id: ScoutId;
  kind:
    | "permission"
    | "output_review"
    | "promotion"
    | "retry_decision"
    | "eval_label"
    | "handoff";
  subject: {
    runId?: ScoutId;
    workId?: ScoutId;
    stepId?: ScoutId;
    artifactId?: ScoutId;
    agentRevisionId?: ScoutId;
    promotionId?: ScoutId;
    traceRef?: {
      sessionId: ScoutId;
      turnId?: ScoutId;
      blockId?: ScoutId;
      version?: number;
    };
  };
  assigneeId?: ScoutId;
  groupId?: ScoutId;
  state:
    | "open"
    | "claimed"
    | "approved"
    | "rejected"
    | "dismissed"
    | "expired";
  risk?: "low" | "medium" | "high";
  form?: MetadataMap;
  decision?: MetadataMap;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  metadata?: MetadataMap;
}
```

Review task rules:

- Permission review tasks that mirror live approvals MUST carry enough trace
  reference and approval version information to avoid stale decisions.
- Review tasks SHOULD be idempotent by `(kind, subject, version)` so reconnects
  and projections do not create duplicates.
- A review task can move a run into `review`, but it should not by itself
  mutate work ownership. Work item updates remain collaboration events.
- Promotion reviews SHOULD be required by default for stable aliases unless a
  project policy explicitly allows automatic promotion.

## Evals And Promotion

OpenScout SHOULD let operators convert broker history into evaluation assets.

First-class eval flows:

1. "Save this run as an eval example."
2. "Label this run as good, bad, risky, flaky, or incomplete."
3. "Replay these examples against a candidate agent revision."
4. "Compare two revisions side by side."
5. "Promote this revision to an alias if checks pass."
6. "Canary this revision for a percentage of requests to an alias."
7. "Rollback alias to previous revision."

Possible shape:

```ts
export interface EvalExample {
  id: ScoutId;
  sourceRunId: ScoutId;
  agentRevisionId?: ScoutId;
  datasetId?: ScoutId;
  input: MetadataMap;
  expected?: MetadataMap;
  labels?: string[];
  judgment?: {
    rating?: "pass" | "fail" | "mixed" | "unknown";
    rationale?: string;
    reviewerId?: ScoutId;
    reviewTaskId?: ScoutId;
  };
  artifactIds?: ScoutId[];
  createdAt: number;
  metadata?: MetadataMap;
}

export interface EvalRun {
  id: ScoutId;
  candidateRevisionId: ScoutId;
  baselineRevisionId?: ScoutId;
  datasetId?: ScoutId;
  exampleIds: ScoutId[];
  evaluator: {
    kind: "manual" | "script" | "external";
    name?: string;
    version?: string;
  };
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  summary?: MetadataMap;
  createdAt: number;
  completedAt?: number;
  metadata?: MetadataMap;
}
```

OpenScout does not need to build a full eval engine immediately. It can start
with dataset capture, reviewer labels, deterministic replay where possible,
and hooks for external evaluators such as Promptfoo-style scripts.

Replay should be honest about determinism:

- `fixture` replay uses saved inputs and mocked tool outputs.
- `live` replay uses current tools, models, and environment.
- `hybrid` replay fixes some dependencies and allows others to vary.

The eval result must record which mode was used.

## Observability And Analytics

OpenScout SHOULD add saved operational views over runs: make agent operations
queryable, filtered, shareable, and eventually chartable without making
dashboards the product core.

Useful built-in views:

- active runs
- waiting for human review
- stale or stalled runs
- failed by harness
- high token cost
- permission denied
- sandbox profile distribution
- runs by agent revision
- runs by source and requester
- promotion candidates
- eval regressions
- artifacts awaiting review

Suggested saved view shape:

```ts
export interface SavedRunView {
  id: ScoutId;
  title: string;
  ownerId: ScoutId;
  visibility: "private" | "workspace" | "shared";
  filters: MetadataMap;
  columns: string[];
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  chart?: {
    kind: "table" | "count" | "timeseries" | "bar";
    metric?: string;
    groupBy?: string[];
  };
  createdAt: number;
  updatedAt: number;
}
```

V1 can expose saved filters before charts. The important product move is making
the operational questions stable and shareable.

## Broker Architecture

The broker should own durable operations state and expose read APIs for runs,
reviews, revisions, evals, promotions, and saved views.

Near-term storage can be a projection over current tables:

- `invocations`
- `flights`
- collaboration records and events
- agent records and managed local agent config
- trace session references where available
- approval inbox or operator attention projections

Longer-term storage can add normalized tables:

- `agent_revisions`
- `agent_aliases`
- `runs`
- `run_steps`
- `run_artifacts`
- `review_tasks`
- `eval_examples`
- `eval_runs`
- `promotions`
- `saved_run_views`

The migration should be additive. Nothing in the first slice should require
mesh forwarding, MCP tools, mobile clients, or existing desktop routes to stop
using `flightId`.

## Migration From InvocationRequest And FlightRecord

The safe migration path is read-model first:

1. **Define run projection IDs.**
   For existing data, derive a stable run ID from `flight.id` or
   `invocation.id`. New writes may later mint a separate run ID and link both
   source records.
2. **Project current fields.**
   Map `InvocationRequest.requesterId`, `targetAgentId`, `action`, `task`,
   `collaborationRecordId`, `conversationId`, `messageId`, `context`,
   `execution`, and `metadata` into `AgentRun.input` and references. Map
   `FlightRecord.state`, `summary`, `output`, `error`, timestamps, and metadata
   into run state, output, and terminal reason.
3. **Snapshot revision metadata.**
   If a managed agent revision does not exist yet, attach an
   `agentRevisionSnapshot` metadata object to the projected run. Do not block
   run listing on perfect historical revision reconstruction.
4. **Add explicit revision writes.**
   When managed agent config changes or an ad hoc run is dispatched, create an
   immutable `AgentRevision` and stamp its ID into invocation metadata.
5. **Promote run ID as a navigation peer.**
   Add run-aware APIs and UI routes while preserving flight routes. Receipts
   can include both `runId` and `flightId`.
6. **Write native runs for richer orchestration.**
   Recipes, retries, spawned agents, and SCO-024 issue attempts can create
   native run records while still creating flights for dispatch.
7. **Only then consider protocol cleanup.**
   `FlightRecord` should remain until dispatch, mesh forwarding, MCP reply
   delivery, mobile inboxes, and existing activity surfaces no longer depend on
   it as the primary execution handle.

This path avoids a flag day and avoids duplicating broker state before the
registry shape has earned its keep.

## First Implementation Slice

1. Add a broker read model that lists projected runs from
   `InvocationRequest` + `FlightRecord`.
2. Add stable run filters for state, agent, harness, model, permission profile,
   date, work item, requester, and source.
3. Snapshot managed local agent config into an `agentRevisionSnapshot` metadata
   object on projected runs.
4. Add a minimal `AgentRevision` table or metadata-backed registry for new
   managed agent changes.
5. Add a review-task projection over current approval and operator attention
   items, keyed idempotently by subject/version.
6. Add `RunArtifact` records for explicit outputs that already have durable
   references, such as PRs, patches, reports, screenshots, or summaries.
7. Add "save run as eval example" as a metadata operation, even before full
   replay exists.
8. Add one operator view for "runs waiting for review" and one for "failed or
   stalled runs" to prove the registry is useful.

## Later Implementation Phases

### Phase 2: Native Revision And Alias Registry

- Create immutable revisions when managed agent definitions change.
- Diff revisions in the operator UI.
- Resolve aliases through revision IDs.
- Add promotion records for alias movement.
- Require review for stable alias promotion by default.

### Phase 3: Review Queue

- Normalize live approvals into review tasks without breaking trace approval
  round-trips.
- Add output review and retry decision tasks.
- Surface review tasks across desktop, web, and mobile inboxes.
- Attach review decisions to runs, artifacts, and promotions.

### Phase 4: Evals

- Capture eval examples from runs.
- Create small datasets from labels and saved views.
- Run candidate revisions against selected examples.
- Record evaluator version, replay mode, costs, and comparison summary.

### Phase 5: Operational Views And Automation

- Add saved run views with permissions and share links.
- Add basic charts for cost, failure rate, review latency, and revision
  comparison.
- Allow project policies to create review tasks or eval examples from view
  matches, such as high-cost or failed runs.

## Invariants

- Every new run SHOULD have either `agentRevisionId` or an immutable revision
  snapshot.
- Run records SHOULD be append-friendly: terminal execution facts should not be
  rewritten except by explicit correction events.
- Review tasks MUST be auditable and idempotent.
- Native approval decisions MUST validate the current trace approval version.
- Agent revisions MUST NOT store secret values.
- Alias movement MUST be represented by a promotion record.
- Work item ownership remains in collaboration records, not in the run
  registry.
- Trace fidelity may vary by harness; the run registry must expose unknown or
  partial evidence honestly.
- Saved views must not become hidden automation unless a separate policy
  explicitly binds a view to an action.

## Relationship To Existing SCOs

- SCO-002 defines work projection and trace layering.
- SCO-005 defines trace-first session observability.
- SCO-007 defines run graphs and recipes.
- SCO-009 defines activation and wake triggers.
- SCO-014 defines broker-owned routing and context.
- SCO-022 defines sandboxing and cross-harness permissions.
- SCO-024 defines one autonomous issue workspace runner that should create and
  consume records from this registry.

This SCO names the operational object model that ties those together.

## Risks

- **Terminology drift.**
  SCO-007 and this SCO must converge on one run primitive. If they diverge,
  operators will see two execution models.
- **Metadata bloat.**
  Repeating full revision snapshots on every run could grow quickly. Prefer
  normalized revision rows plus digest references once the shape stabilizes.
- **False reproducibility.**
  A saved model name and prompt do not guarantee deterministic replay. Evals
  must record replay mode and environment assumptions.
- **Review fatigue.**
  A broad review queue can become noisy. V1 should start with high-signal
  approval, failure, promotion, and explicit user-flagged tasks.
- **Incomplete trace evidence.**
  Some harnesses may not expose full tool, token, or approval data. The registry
  should mark unknown fields rather than inventing evidence.
- **Query performance.**
  Saved views over flights, work items, traces, and artifacts may need
  purpose-built projections and indexes before they can power fleet surfaces.
- **Privacy and retention.**
  Eval examples and artifacts may capture sensitive prompts, files, or outputs.
  Dataset capture needs explicit operator intent and retention policy.

## Open Questions

- Should the protocol name be `AgentRevision`, `AgentCardRevision`, or
  `ScoutAgentRevision` to avoid confusion with A2A-style cards?
- Should `Run` become the canonical protocol object from SCO-007, with
  operations fields as extensions, or should v1 keep an operations-specific
  `AgentRun` read model?
- Which promotion actions should require explicit human approval by default?
- How should traffic-split alias routing interact with broker-owned label
  resolution from SCO-014?
- Which cost and token metrics can be trusted across Codex, Claude, and future
  harnesses in the first release?
- What is the minimum retention policy for eval examples captured from private
  workspaces?
