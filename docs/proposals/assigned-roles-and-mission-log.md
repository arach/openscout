# Assigned Roles + Mission Log — Proposal (draft)

> Status: **implemented (Slice 0–1 + mission log storage)**.
> Opus review: approve-with-nits (applied). First role: **orchestrator**.
> Soft hooks + MCP tools still follow-up.

## Problem

Long-running multi-agent work is hard to follow when operators must hop DMs,
channels, and verbose harness transcripts. We want:

1. **One origin vector** (a mission / campaign root) and the family tree under it.
2. A **cheap situation layer** that does not require re-reading verbose messages.
3. **No global spam** — only deliberately assigned agents write mission logs.

Post-hoc model summarization is too expensive and guessy. Agents already know the
checkpoint, message, and intent **in turn**. Capture a short side log then.

## Non-goals (v0)

- Full campaign UI / tree explorer
- Inferring roles from chatty behavior
- Replacing messages, work items, or flights
- Making every agent emit mission logs
- DurableAction crash-recovery checkpoints (different noun; keep separate)

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Assigned role** | Explicit duty on an agent and/or mission. Not rank, harness, or `agentClass`. |
| **Role definition** | Catalog entry: id, summary, hooks, allowed actions. |
| **Role assignment** | Concrete grant that activates a definition for a scope. |
| **Hook** | Named moment when an assigned role may fire bound actions. |
| **Mission** | Long-running campaign root (prefer a work item / collaboration root). |
| **Mission log** | Cheap append-only situation stream for a mission. Not chat. |
| **Orchestrator** | First role: owns mission spine + mission log at hook moments. |

**Rule:** no assignment → no role hooks → no mission log.

## Design

### Generic shell

Roles share one shell. Only the catalog row differs.

```text
Assignment
  who:   agentId
  what:  roleId          (orchestrator | qa | sre | … later)
  scope: mission | agent | project
  hooks: from role definition
  actions: functions the role may call at hooks
```

Prefer **mission scope** so duty and log stay campaign-bound. Agent-level standing
orchestrator is allowed when an operator wants a durable orchestrator persona;
still no log without an active assignment.

### Anti-spam

1. Assignment required (never inferred from busy/verbose).
2. Prefer mission scope over agent-wide.
3. Default: **one active orchestrator per mission**.
4. Hooks are sparse mission moments, not every tool call.
5. Other roles do not write mission logs unless their definition lists that action.

### Hook moments (shared ids)

| Hook id | Fires when |
| --- | --- |
| `mission.started` | Mission/campaign opens or orchestrator assigned |
| `turn.ended` | Assigned agent finishes a turn in scope |
| `delegation.created` | Child work/ask/handoff created under the mission |
| `child.updated` | Child work/flight state changes materially |
| `waiting.entered` | Mission or branch becomes waiting/blocked |
| `mission.heartbeat` | Cadence while mission active and quiet too long |
| `mission.finished` | Mission reaches terminal state |

### First role: `orchestrator`

| Field | Value |
| --- | --- |
| id | `orchestrator` |
| label | Orchestrator |
| summary | Owns a long-running mission spine and keeps a cheap mission log current. |
| hooks | all shared hooks above |
| actions | `mission_log.append`, link child work/asks, set next-move when blocked |

**Who writes mission logs?** Only agents with an active `orchestrator` assignment
for that mission (or a standing agent-scope orchestrator assignment the operator
explicitly set).

Workers stay normal: verbose evidence in threads; no mission log duty.

### Mission log entry (cheap, structured)

Not a conversation message. Side channel for reconstruction.

| Field | Notes |
| --- | --- |
| `kind` | `heartbeat` · `progress` · `delegation` · `waiting` · `decision` · `risk` · `integration` · `done` · `failed` |
| `intent` | short, stable goal (≤ `SCOUT_MISSION_LOG_LIMITS.intentMaxWords`) |
| `status` | short current action (≤ `statusMaxWords`) — **not** a timestamp |
| `checkpoint?` | optional slightly richer line |
| `blockers?` | label + optional owner |
| `refs?` | messageId / flightId / workId / sessionId for drill-down |
| `seq?` | per-mission monotonic order (avoids same-ms UI collisions) |

Hard limits live in `SCOUT_MISSION_LOG_LIMITS` in protocol (single source for
tools/prompts/docs). Thinking may inform the entry; it must not become the entry.

### Mission identity (v0 decision)

**`missionId` is a work-item id** (campaign root). Do not treat flight or
conversation ids as polymorphic mission ids in v0. If we need other roots later,
introduce an explicit `missionRef: { kind; id }` rather than overloading the string.

### v0 storage strategy

Do **not** invent a large parallel store on day one if we can reuse bones — but
be honest that reuse is **lossy**:

| Concern | v0 mapping | Fidelity |
| --- | --- | --- |
| Campaign root | work item (`parentId` / `childWork` already exist) | full |
| Latest situation | `work.progress` (`checkpoint` / `summary` / steps) | partial |
| Timeline beats | `collaboration_events` (`progressed`, `handoff`, `waiting`) | partial — fewer kinds; no full `blockers[]` / `refs` |
| Explicit log stream | Slice 2+ append-only entries if UI needs full `ScoutMissionLogEntry` | full |

Protocol types for mission log entries exist so UI/API can converge. Slice 2
should land real log storage (or document exactly which fields drop) before a
campaign UI depends on lossless reconstruction.

### Soft vs hard hooks

| Mode | Behavior |
| --- | --- |
| **Soft (v0)** | Active assignment injects role prompt + available actions/tools. Agent is expected to call them at moments. |
| **Hard (later)** | Runtime emits hook events; assignment lookup; remind/require action tools. |

Same model; enforcement tightens later.

## Future roles (same shell)

| Role | Example hooks | Example actions |
| --- | --- | --- |
| `orchestrator` | mission/turn/delegation/waiting | mission log, child links, next-move |
| `qa` | mission.finished, review.requested | checklist, open issues, verdict |
| `sre` | failure, stuck heartbeat | incident note, attention, recovery ask |
| `reviewer` | review.requested | accept/reopen on work item |

## Placement

| Piece | Where |
| --- | --- |
| Catalog + assignment + log types | `@openscout/protocol` (`assigned-roles.ts`) |
| Assignment + mission log persistence | broker-owned SQLite (`role_assignments`, `mission_log_entries`); HTTP `/v1/roles*`, `/v1/missions/:id/log` |
| Web | proxies to broker only (no DDL, no direct control-plane writes) |
| Lifecycle dispatch | `role-lifecycle.ts` on terminal flights (`post_ask_summary`) |
| UI campaign tree | later |

Do **not** overload `agentClass`, harness, or host-integration roles. This is
**assignment**, not identity.

## Operator mental model

```text
Start long mission
  → assign orchestrator to agent A for this mission
  → A gets orchestrator hooks/actions only in that scope
  → mission log updates on those moments
  → workers stay normal

Later: assign qa on same mission for finish/review hooks
```

One-liners:

- **Assigned role:** small explicit duty with hooks and allowed actions.
- **Orchestrator:** assigned role that runs a mission and writes its mission log. Not assigned → no mission log.

## Implementation slices

### Slice 0 — done

- Proposal doc + protocol types (`assigned-roles.ts`, `orchestrator-prompt.ts`)
- Unified scope helpers + single-orchestrator holder helper

### Slice 1 — done

- Control-plane tables: `role_assignments`, `mission_log_entries` (schema v15 + migration 0004)
- Store: `packages/runtime/src/assigned-roles-store.ts`
- Web API: `/api/roles/*`, `/api/missions/:id/log`
- CLI: `scout role catalog|list|assign|revoke|log|log-append`
- Default: one active mission-scoped orchestrator (override with `--allow-multiple` / `enforceSingleOrchestrator: false`)

### Slice 2 — partial

- Mission log append + permission gate: **done**
- **Scout lifecycle (done):** on terminal flight, if target or requester holds a
  role with `lifecycle` bindings (`post_ask_summary`), broker auto-appends a
  mission log entry (`role-lifecycle.ts` ← `BrokerFlightLifecycleService.onTerminalFlight`)
- Hook emission for soft agent nudges / silent heartbeat: **todo**
- MCP tools (`role_assign`, `mission_log_append`): **todo**
- Soft prompt injection at harness start when assignment active: helper exists, wiring **todo**

### Slice 3 — next

- Web campaign / mission log UI under one origin vector

## Open questions

1. ~~Mission id polymorphism~~ → **decided:** work-item id only in v0.
2. Standing agent-scope orchestrator: auto-create mission root on first long ask?
3. Multiple orchestrators on one mission: forbid vs allow with explicit flag?
   (Slice 1: uniqueness is a DB index decision — use `activeRoleHoldersForMission`.)
4. Soft v0 enforcement: prompt-only vs tool-visible reminder after quiet turns?
   (Opus: prefer deterministic `heartbeat` on silent `turn.ended` in Slice 2.)

## Related

- `docs/agents-and-collaboration.md` — work items, delegation, next-move
- `docs/specs/scout-meta-harness-architect-a.md` — conductor/meta-harness (adjacent; execution semantics)
- `packages/protocol/src/collaboration.ts` — progress + events
- `packages/protocol/src/assigned-roles.ts` — types for this proposal
