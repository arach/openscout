# SCO-047: Agent Identity And Fleet Counting

## Status

Proposed.

## Proposal ID

`sco-047`

## Intent

Define what counts as an agent in Scout, and separate that product definition
from sessions, endpoints, projects, nodes, harnesses, and raw historical
records.

The operator-facing fleet count should answer "how many durable agent
identities can I address or manage?" It should not report every stored agent
row, stale local registration, node mirror, or runtime session as a separate
agent.

## Context

Scout has become more sophisticated than the original registry model. The
runtime can observe harness sessions, create broker-managed records, advertise
endpoints, mirror agents across machines, and keep historical registrations for
diagnostics. Those are useful records, but flattening them all into one
"agents" number produces a misleading fleet.

A local inspection on 2026-05-22 showed the shape of the problem:

- broker health reported 597 agent records
- the SQLite projection also had 597 rows in `agents`
- the compatibility registry had 87 configured entries
- those entries covered 55 distinct project roots
- only about 9 agents were active or idle in the live operational view
- 434 rows were marked `metadata.staleLocalRegistration=true`
- 190 rows were node-qualified mirror rows, not distinct top-level agents

The exact numbers will move over time. The important point is that Scout is
currently mixing several layers:

- durable agent definitions
- project/workspace grouping context
- agent cards and Scout-managed identities
- sessions and harness processes
- endpoints and delivery attachments
- node mirrors and routing qualifiers
- stale and historical storage rows

Those layers must remain visible to engineers and diagnostics, but the product
needs a sharper top-level noun.

## Decision

Scout SHOULD define:

> **Agent** = a stable, addressable identity admitted into Scout by
> configuration, an agent card, or explicit Scout-managed registration.

The supporting nouns are:

| Noun | Definition |
| --- | --- |
| **Project** | Grouping context for workspaces, code, and default agent definitions. It is not the addressee. |
| **Agent** | Durable named/addressable identity the operator can route to, inspect, configure, or manage. |
| **Agent card** | The explicit identity, settings, and capability document for one addressable agent. Persistent cards may admit top-level agents; one-time cards are disposable reply/session helpers unless explicitly promoted. |
| **Session** | One running instantiation of an agent in a harness conversation, process, or thread. |
| **Endpoint** | A routable attachment between an agent identity and a concrete session, transport, or node. |
| **Harness** | The execution backend for a session, such as Codex, Claude, or Pi. |
| **Node** | The machine or broker authority where an agent, endpoint, or route lives. |

This is a hybrid of two useful models:

- The ontology is identity-first: an agent is a durable addressable identity.
- Admission is explicit: a record becomes a top-level fleet agent only through
  configuration, an agent card, or an intentional Scout-managed registration.

Projects remain the baseline grouping for discovery. They are not themselves
agents unless Scout admits a durable identity for them.

Sessions instantiate agents. Sessions do not become new top-level agents by
default.

Endpoints route to sessions. Endpoints do not become new top-level agents by
default.

Agent cards are durable settings, not cached sessions. A card may become
**invalid** when its setting is no longer true, for example the project path is
gone, the configured harness or model is unavailable, or the permission/profile
configuration cannot run. A stale or superseded session/endpoint does not make
the card stale. It only means the broker must choose, start, attach, resume, or
diagnose a runtime context for that still-valid identity.

Node, harness, model, workspace, and profile qualifiers disambiguate and route
an agent. They only create separate top-level agents when the configuration or
card explicitly says those qualified identities are distinct managed agents.

## 2026-06-04 Amendment: Cards, Sessions, Endpoints, And Messaging Intent

Do not expose "stale card" as a normal product concept.

The product model is:

- **Agent card** = durable setting and addressable identity.
- **Session** = disposable or resumable runtime context.
- **Endpoint** = internal route from an identity to one concrete session.
- **Send** = message/update into a conversation, channel, or agent DM.
- **Ask** = owned work that creates invocation and flight lifecycle.
- **Attach/continue** = explicit prior-session intent.

Runtime reuse is an optimization, not identity. When an operator or agent sends
to an agent card, Scout may reuse a compatible live session for latency,
context, or cost, but it may also start a fresh session when that is cheaper or
clearer. A dead, replaced, or superseded endpoint should not block ordinary
card-targeted messaging when the card settings are still valid and a compatible
session can be created.

When the caller wants one exact prior context, the request must name the
session, for example with `targetSessionId` or a `session:<id>` route. That path
should be described as attaching to, continuing, resuming, or forking from a
session. If the exact session cannot be reached, the error should be phrased in
session terms and offer a next step such as starting fresh or forking from a
saved state.

`metadata.staleLocalRegistration=true` is therefore diagnostic runtime
metadata. It means a stored local registration or endpoint has been superseded
by the current setup; it does not mean the durable card setting is stale. Normal
views should hide or group those records. Diagnostic views may label them as
"superseded endpoint" or "historical registration" and show
`replacedByAgentId` when available.

Use card validity language only for durable configuration failures:

- **Invalid configuration** when the path, harness, model, profile, or required
  local dependency cannot satisfy the card.
- **Unavailable** when a valid card cannot currently be run because a required
  provider or machine is not reachable.
- **Session reference not attachable** when an exact prior session was requested
  but Scout cannot load, parse, or resolve the session reference needed to attach.
- **Session not currently reachable** when the reference is usable, but Scout
  cannot confirm a live provider, harness process, or transport for it.
- **Session terminal** only when a harness or provider reports an explicit
  stopped, closed, cancelled, or completed terminal state.
- **Superseded endpoint** for internal or diagnostic runtime rows replaced by a
  newer registration.

## Counting Model

Scout SHOULD expose separate counts for separate questions:

| Count | Answers | Includes | Excludes |
| --- | --- | --- | --- |
| **Projects indexed** | "How much of my workspace has Scout found?" | Distinct indexed project roots. | Harness sessions, endpoints, stale rows. |
| **Configured agents** | "How many durable agents have I admitted?" | Registry entries, persistent cards, explicit Scout-managed registrations. | One-time cards, stale registrations, node mirrors, runtime-only sessions. |
| **Active now** | "Who can act or is acting right now?" | Agents with fresh live endpoints or active/waiting work. | Offline historical rows. |
| **Current registrations** | "What does the broker currently know how to route or wake?" | Non-stale agent rows and endpoint-backed records useful for routing. | Retired and stale records. |
| **Raw records** | "What is stored for audit/debug?" | Every persisted row. | Nothing; this is a diagnostic count only. |

The default product headline SHOULD be **configured agents across indexed
projects**, with **active now** nearby when the user is doing operational work.

For the 2026-05-22 local snapshot, that would read closer to:

```text
87 configured agents across 55 projects
9 active or idle now
```

The raw 597-row storage count belongs in diagnostics, database health, or an
advanced details view. It should not be the primary fleet count.

## Visibility Rules

Normal user-facing agent lists SHOULD hide or group:

- `metadata.staleLocalRegistration=true`
- `metadata.retiredFromFleet=true`
- historical endpoint-only records
- node mirror rows that only represent another machine's copy of an identity
- session-derived rows without explicit admission as durable agents
- one-time card rows unless explicitly promoted to persistent identity

Diagnostic and engineering surfaces SHOULD still expose those records with
clear labels:

- **raw agent records**
- **stale registrations**
- **current routable registrations**
- **node mirrors**
- **endpoint attachments**
- **session instances**

No records need to be deleted to fix the product model. The root fix is to stop
using raw storage cardinality as the human-facing definition of the fleet.

## Product Surface Guidance

Use the word **Agents** for durable identities.

Use **Sessions** for running harness instances. A detail page may show one or
more sessions under an agent.

Use **Endpoints** for route/debug surfaces and delivery internals. Avoid making
endpoint count a primary product metric.

Use **Projects** as a grouping/filtering axis, especially for users who think
of Scout as "one or more agents per repository." A project with no admitted
agent should appear as an indexed project, not as an unregistered agent unless
the surface is explicitly about discovery gaps.

Use **Machines** or **Nodes** as routing/authority qualifiers. The same agent
running on two machines may have two sessions and two endpoints, but it is not
two top-level agents unless the operator configured separate identities.

Recommended headline labels:

- **Configured Agents**
- **Active Now**
- **Indexed Projects**
- **Current Registrations** for diagnostics
- **Raw Records** for diagnostics

Avoid labels such as "597 agents" when that number includes stale registrations
or storage rows that the operator cannot naturally address.

## Implementation Plan

### 1. Add Shared Fleet Classification

Create a shared classifier for agent rows instead of repeating ad hoc metadata
filters in each reader.

The classifier should keep separate axes separate. Do not compress admission,
provenance, lifecycle, topology, and actionability into one enum.

It should derive at least:

- `fleetVisibility`: `top_level` | `grouped` | `diagnostic`
- `admissionSource`: `registry` | `agent_card` | `scout_managed` | `observed` | `historical`
- `registrationSource`: `manual` | `manifest` | `generated` | `unknown`
- `recordKind`: `agent_identity` | `session_instance` | `endpoint_attachment` | `node_mirror` | `stale_registration`
- `cardLifecycle`: `persistent` | `one_time` | `none`
- `cardValidity`: `valid` | `invalid_configuration` | `unavailable` | `unknown`
- `nodeRole`: `local_authority` | `remote_authority` | `mirrored` | `unknown`
- `actionability`: `active` | `idle` | `waiting` | `wakeable` | `offline` | `unknown`
- `isTopLevelFleetAgent`
- `isCurrentRegistration`
- `isDiagnosticOnly`

The exact field names can change during implementation, but the distinction
between product visibility and storage existence should be explicit.

### 2. Fix Existing Active-Agent Predicates

`activeAgentMetadataPredicate` currently filters `retiredFromFleet` but does
not filter `staleLocalRegistration`.

Update DB-backed agent readers so stale local registrations are excluded from
normal agent lists unless the caller explicitly requests diagnostic records.

### 3. Split Broker Health Counts

Broker health currently reports raw snapshot agent cardinality. Keep that raw
diagnostic value, but add separate fields for:

- configured agents
- indexed projects
- current registrations
- active or idle agents
- stale registrations
- raw agent records
- one-time cards

Any existing API field named `agents` should either remain clearly documented
as raw storage/debug data or be replaced by a structured `agentCounts` object
before more UI depends on it.

### 4. Update Web, CLI, And Companion Labels

Audit surfaces that show agent counts or fleet summaries. Candidate areas:

- `packages/web/client/screens/AgentsScreen.tsx`
- `packages/web/client/components/AgentHoverCard.tsx`
- `packages/web/client/screens/AgentInfoScreen.tsx`
- `packages/web/server/db/agents.ts`
- `packages/web/server/db/internal/sql-helpers.ts`
- CLI commands that call `who`, `agents`, or health endpoints
- mobile or mesh summaries that display fleet counts

The default count should come from the shared classifier, not from
`COUNT(*) FROM agents`.

### 5. Add A Fleet Classification Report

Before any compaction pass, add a report that makes the current setup
understandable. It should show:

- configured persistent identities
- indexed project roots
- active or idle agents
- waiting or wakeable registrations
- remote-authority identities
- stale and replaced registrations
- raw stored records
- registry entries compared to SQLite rows
- stale rows that still have messages, invocations, flights, or endpoints

This report is the safety rail. It lets Scout clean presentation first, then
consider compaction without guessing which rows still anchor history.

### 6. Preserve Diagnostics

Add a deliberate diagnostic affordance for raw rows and stale registrations.
This keeps the engineering data visible without forcing every operator-facing
view to explain historical storage rows.

Diagnostics should use runtime language for runtime rows. Prefer labels such as
"superseded endpoint", "historical registration", "session reference not
attachable", or "session not currently reachable". Use terminal session language
only when a harness or provider reports an explicit stopped, closed, cancelled,
or completed state. Do not label a durable card as stale unless the card
settings themselves are invalid, and in that case prefer "invalid
configuration".

### 7. Backfill Or Retire Stale Rows Deliberately

Do not bulk-delete stale local registrations as the first fix.

After readers are corrected, add a lifecycle pass that can safely mark old
`staleLocalRegistration` rows as `retiredFromFleet` when a newer durable
identity supersedes them. This should be a compaction/cleanup improvement, not
the only thing preventing bad counts.

### 8. Keep Send, Ask, And Session Continuation Distinct

Audit routing and UI paths that send to an agent card or label. Ordinary
`send` and `ask` calls should target the durable identity and let the broker
reuse, start, or attach a compatible runtime session. They should not fail
because the most recent endpoint registration was superseded when the card
configuration is still valid.

Only exact session requests, such as `targetSessionId` or `session:<id>`, should
be blocked by inability to load the session reference or reach that exact prior
context. Those failures should offer session-shaped remedies: start fresh,
attach a live session, or fork from a saved state.

## Acceptance Criteria

- The primary web fleet/agents surface no longer reports raw stored agent rows
  as the fleet size.
- A local setup with many stale registrations presents a headline closer to
  configured agents plus indexed projects.
- Stale local registrations are hidden from normal agent lists by default.
- Current registrations and raw records remain available in diagnostics.
- One-time cards are visible as reply/session helpers, not counted as
  configured top-level agents unless promoted.
- A session, endpoint, node mirror, harness qualifier, or model qualifier does
  not create a top-level agent without explicit admission.
- Main views and ordinary messaging flows do not present "stale card" as a
  user-facing state. They use invalid configuration, unavailable, session
  reference not attachable, session not currently reachable, terminal session,
  or superseded endpoint according to the layer that failed and the evidence
  available.
- Sending or asking by durable agent card can create or choose a compatible
  session when no exact session was requested and the card settings are valid.
- Exact session continuation uses explicit session ids and fails in session
  language when the reference cannot be loaded or the requested context cannot
  be reached.
- Tests cover at least one fixture with configured agents, stale registrations,
  endpoint-backed sessions, one-time cards, persistent cards, remote-authority
  rows, and node mirror rows.
- The glossary and identity docs use the same agent/session/endpoint/project
  definitions.

## Non-Goals

- Deleting historical records.
- Replacing the existing routing grammar.
- Changing broker ownership of messages, deliveries, invocations, flights, or
  work items.
- Claiming enterprise identity, RBAC, compliance, or multi-tenant isolation.
- Treating mesh routing, global consensus, or transcript replication as part of
  the agent definition.

## Open Questions

- Should a project with no explicit agent card appear as "unregistered project"
  or "default project agent" in setup flows?
- When the same configured identity appears on two machines, should the default
  product view collapse by agent and show machine-specific sessions underneath,
  or show one row per machine-qualified identity with grouping?
- Which count name should replace `agents` in health output without breaking
  existing callers too abruptly?
- Should the registry be migrated from compatibility language toward explicit
  agent card admission as part of this work, or should that wait for a separate
  SCO?

## Related Docs

- [`docs/glossary.md`](../glossary.md)
- [`docs/agent-identity.md`](../agent-identity.md)
- [`docs/runtime-sessions.md`](../runtime-sessions.md)
- [`sco-004-addressable-identities-and-session-bindings-proposal.md`](./sco-004-addressable-identities-and-session-bindings-proposal.md)
- [`sco-036-agent-state-vocabulary.md`](./sco-036-agent-state-vocabulary.md)
- [`sco-046-cross-machine-agent-ui-spec.md`](./sco-046-cross-machine-agent-ui-spec.md)
- [`sco-049-session-forking-and-excellent-session-states.md`](./sco-049-session-forking-and-excellent-session-states.md)
- [`sco-060-comms-channel-primitive-and-adapter-destinations.md`](./sco-060-comms-channel-primitive-and-adapter-destinations.md)
