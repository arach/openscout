# Scout meta-harness / execution-semantics layer — Architect A proposal

**Author:** `claude.main.arts-mac-mini-local` (Architect A), Claude Opus 4.8, high effort.
**Date:** 2026-06-16. **Stance:** minimalism — keep Core unbloated; add behavior, not records.
**Refs** are to `/Users/art/dev/openscout`. Design only; no files edited.

## Thesis
The meta-harness should be **one new long-lived component (a per-session "Conductor") plus a thin
mapping**, riding on substrate Core already has (flight lifecycle, `runtime_sessions`,
`UnblockRequest`, `work_item.progress`, and the emerging `DurableAction` lease/checkpoint/signal).
It adds *execution semantics* — resume, plan gates, steering, recovery, supervision — **without new
top-level Core records**. Core gains at most a couple enum values; everything else is projection,
checkpoint, signal, or child-flight. Resisting new records is the whole game.

---

## 1) Boundary diagram (text)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ SCOUT CORE (broker control plane) — unchanged ownership                      │
│   messages · conversations · asks(InvocationRequest) · flights(FlightRecord) │
│   work items · unblock requests · routing/deliveries · mesh/nodes            │
│   protocol: packages/protocol/src/{invocations,collaboration,unblock-...}.ts │
└───────────▲───────────────────────────────────────────────┬─────────────────┘
   state UP │ flight.state, work_item.progress, UnblockRequest │ intents DOWN
            │ (no new tables; reuse existing records)          │ invoke · approve · signal
┌───────────┴───────────────────────────────────────────────▼─────────────────┐
│ META-HARNESS (execution semantics)  =  "Conductor" (one per running session)  │
│   • session persist/resume   over runtime_sessions.external_session_id        │
│   • PlanGate + approval chain = DurableCheckpoint("plan") blocked on           │
│                                  UnblockRequest(kind:approval)                  │
│   • live task/step tracking  → projection into work_item.progress              │
│   • crash recovery           = DurableAction lease + heartbeat + replay        │
│   • interrupt / steer        = DurableSignal("interrupt"|"steer")              │
│   • supervisor / subagents   = parent flight spawns child InvocationRequests   │
│   • heterogeneous agents     = each child picks execution.harness              │
│   substrate: packages/protocol/src/durable-actions.ts (lease/checkpoint/signal)│
└───────────▲───────────────────────────────────────────────┬─────────────────┘
   events UP │ turn · tool-call · plan-proposed · exit · crash │ drive DOWN
            │                                                   │ start · resume · cancel · inject
┌───────────┴───────────────────────────────────────────────▼─────────────────┐
│ NATIVE HARNESSES (unchanged) — owned by their projects                        │
│   codex-app-server.ts · claude-stream-json.ts · pi-rpc.ts · local-agents.ts   │
│   (own their own transcript JSONL; Core indexes metadata only)                │
└──────────────────────────────────────────────────────────────────────────────┘
```
The seam is exactly where the Explore map found a gap: **between `broker.invokeAgent()` →
`FlightRecord` and the harness spawn adapters** (`packages/runtime/src/{codex-app-server,
claude-stream-json,pi-rpc,local-agents}.ts`). The Conductor occupies that gap.

---

## 2) Core abstractions (minimal set — 1 component, the rest are reused)

1. **Conductor** *(the only genuinely new thing)* — a per-session supervisor process that owns one
   native harness session's execution semantics. It is the **single writer** of execution state for
   that session: it translates harness events → Core (`flight.state`, `work_item.progress`,
   `UnblockRequest`) and Core intents → harness control (start/resume/cancel/inject). One Conductor
   per running flight; it holds the `DurableAction` lease for that flight.
2. **Session** — *reuse* `runtime_sessions` (`packages/runtime/src/schema.ts:5-25`,
   `external_session_id`, `state`, `expires_at`). The Conductor adds *resume policy*; no new record.
3. **PlanGate** — *reuse* `DurableCheckpoint("plan")` + `UnblockRequest(kind:approval)`. The harness
   proposes a plan → Conductor writes a checkpoint and opens an approval unblock-request → blocks
   until resolved. No "plan" table.
4. **Step / LiveTask** — *reuse* `WorkItemRecord.progress` (`completedSteps/totalSteps/checkpoint/
   percent`, `packages/protocol/src/collaboration.ts`). Harness turns/tool-calls map to a progress
   projection — **ephemeral, live only in the focused view** (per the "calm data architecture"
   principle), not high-churn durable rows.
5. **Steer / Interrupt** — *reuse* `DurableSignal("interrupt"|"steer", payload)`. Core emits a
   signal; the Conductor applies it to the harness at the next safe boundary.
6. **ApprovalChain** — *reuse* an ordered set of `UnblockRequest(kind:approval)` recorded as metadata
   on the gating checkpoint. The Conductor releases the gate only when all resolve. No chain table.
7. **Supervisor / Subagent** — *reuse* parent→child `InvocationRequest`/`FlightRecord` linkage
   (`parentId`/`collaborationRecordId` already on the records). The parent's Conductor owns fan-out/
   fan-in; **heterogeneous agents** fall out for free because each child sets its own
   `execution.harness` (already a field on `InvocationRequest`).

> Net new persistence: **none** beyond what `durable-actions.ts` already introduces. New enum values
> at most: a `DurableSignal` name (`steer`), a `DurableCheckpoint` kind (`plan`), maybe a
> `DurableAction.kind` (`session`). That is the entire Core footprint.

---

## 3) Feature coverage — current vs target

| Capability | Core today (verified) | Meta-harness target | New record? |
|---|---|---|---|
| Flight lifecycle | ✓ `FlightRecord` states queued→…→completed (`protocol/src/invocations.ts`) | Conductor drives transitions from harness events | no |
| Session persistence | ~ `runtime_sessions.external_session_id` exists, no orchestration (`schema.ts:5-25`) | Conductor owns persist/resume policy | no |
| Plan approval | ✗ none | PlanGate = checkpoint("plan") + approval unblock | no |
| Approval chain | ~ permission profiles only, no chain (`protocol/src/permission-policy.ts`) | ordered approval gate (metadata on checkpoint) | no |
| Live tasks/workflows | ~ `work_item` states+progress, no sub-step tracking | step projection → `work_item.progress` | no |
| Crash recovery | ✗ none | `DurableAction` lease + heartbeat + checkpoint replay | no |
| Interrupt / steer | ✗ cancel-only | `DurableSignal("interrupt"|"steer")` | no |
| Supervisor / subagents | ✗ none | parent/child flights via Conductor | no |
| Heterogeneous agents | ~ `execution.harness` per invocation | child flights pick harness | no |

(✓ present · ~ partial · ✗ absent — baseline from the Core map.)

---

## 4) MVP sequence (each step proves the seam before widening)

1. **Conductor skeleton on ONE harness** — wrap `codex-app-server.ts` (cleanest process lifecycle).
   Translate its events → `flight.state` + `work_item.progress`. No new records. *Proves the seam.*
2. **Crash recovery** — Conductor takes a `DurableAction` lease + heartbeat; on restart, fence the
   old generation, resume from `runtime_sessions.external_session_id`, replay last checkpoint.
3. **Interrupt/steer** — Core emits `DurableSignal`; Conductor applies at the next turn boundary.
4. **PlanGate (single approver)** — checkpoint("plan") + one `UnblockRequest(kind:approval)`.
5. **Approval chain + supervisor/subagents** — ordered approvers; parent Conductor fans out child
   flights (heterogeneous harness per child).
6. **Generalize** the Conductor across `claude-stream-json` and `pi-rpc` behind a small capability
   interface (see risks: steer/resume differ per harness).

---

## 5) Top risks & edge cases

- **Two sources of truth.** Harness owns the transcript; Core owns coordination state. The Conductor
  must be the **only** writer of execution state for its session — enforce with the existing
  `DurableAction` idempotency key + `leaseGeneration` to prevent double-drive.
- **Recovery fencing.** A resumed Conductor must fence the prior one (lease generation bump) or two
  Conductors drive one harness session. This is the single highest-severity correctness risk.
- **Heterogeneous steer/resume capability.** Mid-turn injection works differently across
  codex-app-server vs claude-stream-json vs tmux/local-agents. Define a **capability matrix**; for
  harnesses that can't steer mid-turn, degrade to "queue steer until next turn boundary," don't fake it.
- **Plan-gate deadlock vs session expiry.** An approval chain can block a checkpoint past
  `runtime_sessions.expires_at`. Need a gate-timeout → either auto-deny, or persist+resume the
  session so approval can outlive the live process.
- **Subagent fan-out cost/availability.** Child flights inherit Core's `queued/waking` for offline
  endpoints; cap fan-out and surface cost. Don't invent a scheduler — reuse flight queueing.
- **Core-bloat temptation (the meta-risk).** Every feature here *wants* to become a new table
  (`plan`, `step`, `supervisor`, `approval`). Resist: they are checkpoints, projections, signals, and
  child-flights. A PR that adds a top-level record is the failure mode to guard against in review.
- **Live-data churn.** Step tracking must stay an ephemeral projection in the focused view, not a
  high-write durable stream (matches the calm-data principle).

---

## 6) Nomenclature candidates & borrowed lessons

Reference scan — used to **sharpen Scout's nouns, not to clone**:

| Source | Borrow (term/lesson) | Avoid |
|---|---|---|
| **LangGraph** | strongest fit: `checkpointer` ≈ `DurableCheckpoint`; `interrupt` / human-in-the-loop ≈ our PlanGate+signal; `thread` ≈ session. Adopt its **durable-execution + HIL semantics**. | graph/node DSL — Scout isn't a graph engine |
| **Mastra** | `suspend`/`resume` verbs for session persistence; `step` as the live-task unit | heavy workflow object model |
| **Pydantic AI** | `run` already ≈ Scout's `flight`/`run:flight:`; `RunContext` ≈ Conductor's per-session context | result-typing focus (n/a) |
| **CrewAI** | "hierarchical process" framing for supervisor/subagent | the monolithic `Crew` object = the Core-bloat we must avoid |
| **AutoGen** | `Manager` framing for the supervisor | GroupChat — Scout already has conversations |
| **Deep Agents** | `sub-agent` naming; explicit "planning" step before execution | virtual-filesystem scope creep |

**Proposed Scout nouns** (keep the existing flight/mission voice):
- Layer/component: **Conductor** (per-session supervisor) — primary. On-theme alt: **Flight Director**
  (mission-control term; conducts `flights`). Avoid generic "meta-harness" in user-facing copy.
- **PlanGate** (plan proposed → approval-gated checkpoint). **Steer** (verb) for live redirection;
  **Interrupt** for hard stop. **Step** for a live task unit (projection into `work_item.progress`).
  **Subagent** for child flights; **Supervisor** = the parent Conductor. **Resume/Suspend** for
  session persistence (borrowed from Mastra/LangGraph).
- Reuse existing checkpoint/signal/lease vocabulary from `durable-actions.ts` verbatim — don't coin
  synonyms for things Core already names.

---

## Bottom line
This is buildable as **one Conductor component + the existing `DurableAction` substrate**, surfacing
through `flight.state`, `work_item.progress`, and `UnblockRequest`. It delivers all eight execution-
semantics features the brief lists while keeping Core's record set essentially fixed. The discipline
to enforce in review: **no new top-level Core records** — and **lease fencing** on recovery is the
one place to spend real correctness effort. **Next owner:** whoever synthesizes Architect A/B — if a
single decision is needed first, it's "Conductor owns execution state as sole writer, over
DurableAction" vs "extend the broker directly"; this proposal argues strongly for the former to keep
Core unbloated.
