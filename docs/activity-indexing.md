# Activity Indexing

## Goal

Keep `control-plane.sqlite` as the single source of truth while adding a fast,
broker-native activity projection for Relay, pairing, Spectator, and agent
detail views.

The problem today is not storage capacity. The problem is that several desktop
views reconstruct operational state ad hoc from snapshots, thread cards, and
runtime tails. Tmux and logs are current runtime inspection surfaces, but the
product should not ask them to substitute for canonical broker records.

## Decision

- Canonical facts stay in `control-plane.sqlite`.
- Derived activity and search indexes start in the same SQLite database.
- Runtime tails, large logs, and bulky artifacts stay file-backed.
- If search or projection churn grows materially, rebuildable index tables can
  move to a separate SQLite file later without changing the canonical store.

## Why SQLite

SQLite is still the right default for OpenScout:

- local-first
- low ops
- single durable writer path through the broker
- already configured with `WAL`, `NORMAL` sync, and `busy_timeout`
- good enough scaling envelope for current and near-term usage

The real scaling risk is not SQLite itself. It is:

- rebuilding views from snapshots repeatedly at read time
- overusing tmux/log tails as canonical operational state
- mixing large raw runtime artifacts into canonical relational state

## Worldview

OpenScout needs one event spine and multiple first-class projections:

- Relay / agent detail: actor-to-actor activity, asks, handoffs, blockers
- Pairing host: turns, missions, waiting state, follow-up
- Spectator: runtime health, logs, and infra behavior

These should all read different projections over the same canonical facts.

## Phase 1

Add an `activity_items` projection table to the control-plane database.

Each row is one normalized operational event, for example:

- `message_posted`
- `ask_opened`
- `ask_working`
- `ask_replied`
- `ask_failed`
- `handoff_sent`
- `bridge_inbound`
- `bridge_outbound`
- `waiting_on_actor`
- `runtime_notice`

Recommended columns:

- `id`
- `kind`
- `ts`
- `conversation_id`
- `message_id`
- `invocation_id`
- `flight_id`
- `record_id`
- `actor_id`
- `counterpart_id`
- `agent_id`
- `workspace_root`
- `session_id`
- `title`
- `summary`
- `payload_json`

Recommended indexes:

- `(agent_id, ts DESC)`
- `(actor_id, ts DESC)`
- `(conversation_id, ts DESC)`
- `(workspace_root, ts DESC)`
- `(kind, ts DESC)`
- `(session_id, ts DESC)`

## Read Model

The live operational view should use `activity_items` as the canonical summary
of what an agent is doing, with tmux available as a current runtime inspection
and control surface.

That live view should include:

- asks opened for the agent
- acknowledgements / working signals
- replies and completions
- bridge ingress and egress
- outbound handoffs sent by the agent
- waiting / stale / blocked findings

tmux and logs remain useful, but as runtime inspection surfaces rather than the
main product narrative.

## Search

Start with SQLite FTS5 on top of canonical and projected text:

- message body
- task title
- status summary
- reply preview
- conversation title
- workspace / worktree metadata

If search outgrows SQLite FTS5 later, move only the rebuildable search index to
an embedded sidecar engine or separate SQLite file.

## Storage Rules

- Canonical facts are written once through the broker.
- Projection tables are disposable and rebuildable.
- Large raw logs stay file-backed and are referenced by path or metadata.
- Do not introduce a second canonical database.

## Performance And Retention Policy

Treat the live working set and durable retention as separate concerns:

- Live UI queries must be bounded by an explicit row limit and, where the
  product means “recent,” a time window. A 48-hour window is a good default for
  activity feeds, not a deletion deadline.
- Do not delete canonical messages, invocations, flights, deliveries, or
  collaboration records merely to make a page faster. Fix unbounded reads,
  N+1 queries, missing indexes, repeated runtime probes, and client refetches
  first.
- Archive only rebuildable projections or bulky file-backed artifacts. An
  archive job must have a documented restore/rebuild path and must not break
  foreign-key history or broker-journal recovery.
- Introduce physical tiering only after measurements show a storage problem:
  database bytes, row counts, p95 query latency, startup replay time, and WAL
  checkpoint time. The current local-pilot scale does not justify a second
  canonical archive database.

In short: keep two days *hot in default views* when that matches the product,
but keep canonical history durable until a separately designed lifecycle policy
can preserve recovery and audit semantics.

## First Execution Slice

1. Add `activity_items` to the runtime schema.
2. Project message / invocation / flight writes into that table.
3. Add read helpers for recent activity by agent or conversation.
4. Make the agent live view use activity first, runtime tail second.

## Answer To "Will the live view contain all the works?"

Yes, operationally.

The live view should become the main view of all active and recent work touching
an agent:

- incoming asks
- outgoing asks
- handoffs
- replies
- waiting state
- failures
- bridge traffic

It should not try to be the raw source for every byte of runtime output. Logs
and tmux remain current drill-down and control surfaces.
