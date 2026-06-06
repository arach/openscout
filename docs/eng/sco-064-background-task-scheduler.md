# SCO-064: Background Task Scheduler

## Status

Proposed.

## Proposal ID

`sco-064`

## Intent

Define a Scout-native background task scheduler for recurring, delayed,
nudgeable, and failure-aware local runtime work.

The immediate pressure is repo scanning. The repo surface should be able to
show useful cached state immediately while Scout refreshes expensive repository
state behind the scenes. The broader need is a generic primitive for work that
must run periodically or eventually without being tied to a foreground request.

This proposal is about borrowing scheduler design patterns from mature systems,
not adopting Temporal, Airflow, Prometheus, Datadog Agent, Cloudflare Durable
Objects, Celery, or any other scheduler framework.

## Context

OpenScout already has several timer-like loops spread across the runtime and
desktop app:

- tail discovery and refresh timers
- peer delivery retry timers
- pairing and relay reconnect backoff
- stale cache refresh behavior
- future repo-watch refresh work

These loops solve local problems, but they do not share a common contract for:

- observable state
- run overlap
- retries and backoff
- jitter
- stale cache freshness
- shutdown cancellation
- activity-aware cadence
- manual nudges

The repo watch experience makes the missing primitive visible. A foreground
repo API call should not need to pay the full cost of scanning every repository
and worktree. Scout should keep repository state warm enough in the background
that returning users see a mostly fresh table immediately.

## Problem

Scout needs background work with dynamic cadence:

- scan frequently while the user is active
- scan less frequently when Scout is idle
- avoid starting duplicate scans
- refresh stale state after a foreground read
- abort genuinely stuck runs
- back off after failures
- report what happened and when the next run is due

Ad hoc `setInterval` loops are too weak for this shape. They hide important
policy decisions inside each caller:

- what happens if a previous run is still active?
- should missed runs catch up?
- should a user action trigger an immediate run?
- how stale is too stale?
- how should failures affect the next run?
- can the task be cancelled on shutdown?
- where can the UI inspect status?

Without a shared scheduler, each background subsystem will invent slightly
different answers.

## Decision

OpenScout SHOULD introduce a local background task scheduler owned by the
runtime process.

The scheduler SHOULD provide:

- keyed task registration
- recurring schedules with dynamic cadence
- delayed one-shot runs
- manual nudges
- single-flight execution by default
- overlap policy
- catchup policy
- timeout and cancellation
- retry backoff with jitter
- task state snapshots
- optional persistent state for tasks that need restart continuity

The first implementation SHOULD be in-process and local-first. It SHOULD NOT
introduce a distributed scheduler, workflow engine, queue service, or external
dependency.

Repo watch SHOULD be the first consumer.

## Design Pattern Survey

### Temporal Schedule

Temporal's useful scheduler shape is:

```text
action + spec + policies + state
```

The design ideas worth borrowing are:

- schedules are more than intervals
- overlap is an explicit policy
- catchup is an explicit policy
- manual trigger and backfill are separate operations
- pause-on-failure is a first-class state transition
- schedule state is inspectable

Scout should borrow this policy vocabulary, not Temporal's durable workflow
runtime.

Relevant references:

- [Temporal schedule docs](https://docs.temporal.io/schedule)
- [Temporal API docs](https://api-docs.temporal.io/)

### Airflow DAG Runs

Airflow treats scheduled work as runs over data intervals. It makes catchup and
backfill central because each missed interval may represent missing analytical
output.

The useful idea for Scout is the distinction between:

- the time a run was scheduled
- the interval or source window it covers
- whether missed intervals should be replayed

Repo scanning should not replay every missed interval. It wants latest state,
not historical artifacts. Airflow's model becomes useful later for tasks such
as hourly summaries, activity rollups, or bounded sync jobs that process a
cursor range.

Relevant reference:

- [Airflow DAG run docs](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html)

### Prometheus And Datadog Agent Scrapes

Observability agents model recurring work as interval-based collection over
dynamic targets:

- discover targets
- scrape each target on an interval
- enforce per-scrape timeout
- record last success, duration, and error
- expose freshness and health as data

This is the closest shape for repo watch. Repositories and worktrees are
targets. A scan is a scrape. The UI cares about last observed state, freshness,
duration, and error more than it cares about a perfect run history.

Relevant references:

- [Grafana Alloy `prometheus.scrape`](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.scrape/)
- [Datadog Agent collector scheduler package](https://pkg.go.dev/github.com/DataDog/datadog-agent/pkg/collector/scheduler)

### Cloudflare Durable Object Alarms

Durable Object alarms provide a simple actor-shaped scheduler:

- one object owns local state
- one alarm wakes the object
- the object processes due work
- the object schedules the next wakeup
- failed alarms retry with backoff

The useful idea for Scout is a single scheduler actor that owns timers, rather
than scattered intervals in every subsystem.

Relevant reference:

- [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Product Thesis

Background work should be explainable product state, not invisible process
behavior.

Scout should be able to answer:

- what background tasks exist?
- which task is running now?
- why did it run?
- when did it last succeed?
- how fresh is the result?
- when will it run again?
- is it backing off?
- what failed?
- what work is waiting for a retry or nudge?

This helps both operators and agents. A user can understand why a repo table is
stale. An agent can decide whether to trust cached state, nudge a refresh, or
wait for completion.

## Goals

- support recurring local runtime work without ad hoc timers
- make background task state inspectable
- keep foreground API calls fast by returning cached state
- let foreground activity nudge background refresh
- adapt cadence based on user and app activity
- prevent duplicate overlapping runs by default
- provide explicit failure backoff
- cancel long-running work on shutdown or timeout
- make repo watch a first-class scheduled task
- leave room for durable state where needed

## Non-Goals

- adopting Temporal, Airflow, Celery, Prometheus, Datadog Agent, or Cloudflare
  Durable Objects
- building a distributed workflow engine
- guaranteeing exactly-once execution
- making background tasks globally coordinated across machines
- replacing broker invocations, flights, or delivery retries
- replaying every missed interval for freshness-oriented tasks
- turning the broker into a general-purpose process supervisor

## Design Principles

1. Background work should be keyed, observable, and cancellable.
2. Recurrence should be policy-driven, not just `setInterval`.
3. Foreground reads should prefer cached state plus refresh nudges.
4. Overlap behavior must be explicit.
5. Missed-run catchup must be explicit.
6. Failures should back off with jitter.
7. Activity should affect cadence.
8. The first implementation should be small and in-process.
9. Durable state should be opt-in per task.
10. Runtime-owned tasks should remain separate from broker-owned coordination
    records unless they create product state.

## Proposed Model

### Background Task

A background task describes what can run.

Suggested fields:

- `id`
- `group`
- `description`
- `run`
- `schedule`
- `policies`
- `freshness`
- `target_discovery`
- `metadata`

Example:

```ts
type BackgroundTaskSpec = {
  id: string;
  group?: string;
  description?: string;
  run: (context: BackgroundTaskRunContext) => Promise<BackgroundTaskResult>;
  schedule: BackgroundTaskSchedule;
  policies?: BackgroundTaskPolicies;
  freshness?: BackgroundTaskFreshnessPolicy;
  metadata?: Record<string, unknown>;
};
```

### Schedule

A schedule answers when the task wants to run.

Suggested fields:

- `kind`: `interval`, `cron`, `manual`, `delayed`
- `active_interval_ms`
- `idle_interval_ms`
- `cold_interval_ms`
- `jitter_ms`
- `start_immediately`
- `disabled`

The first implementation SHOULD support interval schedules. Cron syntax can be
added later if a real consumer needs wall-clock semantics.

### Policies

Policies answer what happens when timing gets weird.

Suggested fields:

- `overlap`: `skip`, `buffer_one`, `allow`, `cancel_previous`
- `catchup`: `none`, `one_if_stale`, `all_due`
- `timeout_ms`
- `backoff_initial_ms`
- `backoff_max_ms`
- `backoff_multiplier`
- `pause_after_failures`
- `max_runtime_ms`

Recommended defaults:

```ts
const defaultPolicies = {
  overlap: "buffer_one",
  catchup: "one_if_stale",
  timeoutMs: 30_000,
  backoffInitialMs: 30_000,
  backoffMaxMs: 30 * 60_000,
  backoffMultiplier: 2,
};
```

### Task State

Task state answers what is happening now.

Suggested fields:

- `id`
- `status`: `idle`, `queued`, `running`, `backing_off`, `paused`
- `last_started_at`
- `last_finished_at`
- `last_success_at`
- `last_failure_at`
- `next_run_at`
- `failure_count`
- `last_error`
- `last_duration_ms`
- `last_reason`
- `running_since`
- `pending_run`
- `freshness`

This state SHOULD be exposed through an internal runtime API and eventually
through an operator/debug surface.

### Run Context

Each task run receives a context:

- `signal`
- `reason`
- `scheduled_at`
- `started_at`
- `deadline_at`
- `activity`
- `logger`
- `emit_status`

The `signal` MUST be honored by task implementations.

### Result

A task result summarizes what happened:

- `status`: `success`, `partial`, `skipped`, `failed`
- `summary`
- `next_run_after_ms`
- `freshness_at`
- `metadata`

Tasks MAY request an adjusted next run after completion. The scheduler remains
the authority for applying policy, jitter, and backoff.

## Activity-Aware Cadence

The scheduler SHOULD derive activity posture from local runtime signals:

- UI has requested a surface recently
- web or desktop clients are connected
- an agent is actively running
- recent broker traffic exists
- recent repo view activity exists
- machine/app has been idle for a long window

Recommended initial postures:

| Posture | Meaning |
|---|---|
| `active` | User or agent is actively using Scout |
| `idle` | Scout is alive but not actively viewed |
| `cold` | No meaningful activity for a long window |

Tasks choose cadence by posture.

For repo watch:

| Posture | Suggested interval |
|---|---|
| `active` | 5 minutes |
| `idle` | 45 minutes |
| `cold` | 6 hours or disabled until nudge |

## Repo Watch Consumer

Repo watch SHOULD become a scheduled scrape-like task.

### Behavior

1. Runtime startup registers `repo-watch.scan`.
2. The task keeps a cached snapshot of repos and worktrees.
3. Foreground repo API calls return cached state immediately.
4. If the cache is stale, the API nudges `repo-watch.scan`.
5. The scheduler starts a scan if no scan is already running.
6. If a scan is already running, the scheduler records one pending run.
7. The scan honors timeout and abort signals.
8. The result updates the cache and task state.
9. Failures back off with jitter and remain visible.

### Suggested Spec

```ts
const repoWatchScanTask: BackgroundTaskSpec = {
  id: "repo-watch.scan",
  group: "repo-watch",
  description: "Refresh local repository and worktree state",
  schedule: {
    kind: "interval",
    activeIntervalMs: 5 * 60_000,
    idleIntervalMs: 45 * 60_000,
    coldIntervalMs: 6 * 60 * 60_000,
    jitterMs: 30_000,
    startImmediately: true,
  },
  policies: {
    overlap: "buffer_one",
    catchup: "one_if_stale",
    timeoutMs: 30_000,
    backoffInitialMs: 30_000,
    backoffMaxMs: 30 * 60_000,
    backoffMultiplier: 2,
    pauseAfterFailures: 10,
  },
  freshness: {
    targetFreshnessMs: 5 * 60_000,
    staleAfterMs: 15 * 60_000,
    maxStaleMs: 60 * 60_000,
  },
  run: scanRepos,
};
```

### UI State

Repo surfaces SHOULD be able to display:

- last scan time
- scan in progress
- stale cache
- last scan error
- next scheduled scan
- whether the visible data came from cache

The UI should not block on a full scan unless the user explicitly requests a
fresh scan and waits for it.

## Scheduler API

Suggested internal API:

```ts
interface BackgroundTaskScheduler {
  register(spec: BackgroundTaskSpec): void;
  unregister(id: string): void;
  start(): void;
  stop(): Promise<void>;
  nudge(id: string, options?: NudgeOptions): void;
  runNow(id: string, options?: RunNowOptions): Promise<BackgroundTaskResult>;
  pause(id: string, reason: string): void;
  resume(id: string): void;
  getState(id: string): BackgroundTaskState | undefined;
  listStates(): BackgroundTaskState[];
}
```

`nudge` asks the scheduler to run soon according to policy. `runNow` is the
explicit foreground operation that waits for a result.

## Storage

The first implementation MAY keep scheduler state in memory.

Persistent task state SHOULD be added only where restart continuity matters.
When persistence is added, it should record:

- task id
- paused state
- last success
- last failure
- next run
- failure count
- compact metadata

The scheduler SHOULD NOT persist task results unless the task's owning subsystem
needs that product state. Repo snapshots belong to repo watch, not to the
scheduler.

## Relationship To Broker Records

The scheduler is runtime infrastructure.

Broker-owned coordination records remain broker-owned:

- messages
- invocations
- flights
- deliveries
- questions
- work items

If a scheduled task creates broker-owned product state, it must do so through
the normal broker service boundary. The scheduler itself should not become a
second coordination database.

## Failure Policy

Failures should affect schedule state, not disappear into logs.

Recommended behavior:

1. A failed run increments `failure_count`.
2. The next run is delayed by exponential backoff plus jitter.
3. A manual nudge may bypass part of the delay, but not while a run is active.
4. Repeated failures can pause the task.
5. The state snapshot carries the last error and next retry time.

Timeouts are real failures. They should abort the task's internal work through
the run signal.

## Overlap Policy

The scheduler MUST define overlap behavior per task.

| Policy | Meaning |
|---|---|
| `skip` | If already running, drop the new due run |
| `buffer_one` | If already running, remember one pending run |
| `allow` | Permit concurrent runs |
| `cancel_previous` | Abort the active run and start the new one |

Default SHOULD be `buffer_one`.

Repo watch SHOULD use `buffer_one`.

## Catchup Policy

The scheduler MUST define catchup behavior per task.

| Policy | Meaning |
|---|---|
| `none` | Missed runs are ignored |
| `one_if_stale` | Run once if the task result is stale |
| `all_due` | Run once per missed interval |

Default SHOULD be `one_if_stale`.

Repo watch SHOULD use `one_if_stale`.

## Implementation Plan

### Phase 1: In-Memory Scheduler

- add `packages/runtime/src/background-tasks`
- define task, schedule, policy, state, and result types
- implement one timer loop that wakes at the next due task
- implement register, start, stop, nudge, runNow, and listStates
- support interval schedules only
- support `buffer_one`, `skip`, and `one_if_stale`
- support timeout, abort signal, backoff, and jitter
- add unit tests for due calculation, overlap, nudge, backoff, and shutdown

### Phase 2: Repo Watch Adoption

- register `repo-watch.scan`
- return cached repo state from foreground APIs
- nudge scans when repo state is stale or repo surfaces are viewed
- expose repo freshness fields
- remove ad hoc repo-watch refresh timers
- add tests for stale-cache foreground reads and background refresh

### Phase 3: Runtime Visibility

- expose task states through a runtime/debug endpoint
- add a compact UI/debug surface for background tasks
- include last success, last error, next run, running state, and freshness

### Phase 4: Optional Persistence

- persist task state only for tasks that need restart continuity
- preserve paused state, last success, failure count, and next run
- keep task-owned result data in each owning subsystem

## Open Questions

1. Should the scheduler live purely in `packages/runtime`, or should its types
   also be exported through `packages/protocol` for UI inspection?
2. Should activity posture be computed centrally, or should each task provide
   its own activity signal?
3. Should task state be operator-visible from day one?
4. Should repo watch scan per repo/worktree target independently, or start with
   one grouped scan task?
5. Should `runNow` bypass backoff for manual operator actions?

## Recommendation

Start with a small in-memory scheduler and one repo-watch consumer.

The shape should borrow:

- Temporal's explicit timing policies
- Durable Object's single scheduler actor
- Prometheus and Datadog's scrape-style freshness model
- Airflow's catchup vocabulary only where historical replay matters

This gives Scout a reusable background task primitive without importing a
workflow system or turning local repo freshness into a distributed scheduling
problem.
