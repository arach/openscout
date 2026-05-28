# SCO-051: Scoutbot Thread Model — Explicit Threads, Default Auto-Created

## Status

Proposed. Sibling to [`sco-050`](./sco-050-scoutbot-as-fleet-agent.md) —
ships in the same build but argued separately because the surface is
distinct.

## Proposal ID

`sco-051`

## Implementation

- [`sco-050-implementation-plan.md`](./sco-050-implementation-plan.md) — Stage 1 of SCO-050 covers SCO-051 stage 1 (default thread auto-creation + thread-map persistence + per-thread routing). The switcher UI and multi-thread affordances ship with SCO-050 stage 2.

## Intent

Define what a *thread* is for scoutbot, how the operator picks which
thread to talk to, and how a thread maps to an underlying Codex session.
The earlier SCO-050 assumed a single DM thread per scoutbot, with one
Codex session behind it. That assumption breaks the moment the operator
wants to ask scoutbot about a different project, resume an old
investigation, or run two parallel threads without context pollution.

This proposal lands the model: **explicit threads, with a default thread
auto-created on first use, surfaced in the HUD's assistant view via a
switcher, and reachable identically from any surface (HUD, web, iOS)**.

## Context

Scoutbot today has one conversation: `dm.operator.scoutbot`. One DM, one
Codex session, monotonic context. That works for casual chat. It does
not work for any of the following operator tasks:

- *"What's the state of the lattices project?"* asked from inside the
  openscout repo. The conversation pulls openscout context but the
  question is about a different project.
- *"Pick up the migration thread from yesterday."* Yesterday's investigation
  is in the same DM as everything else; scoutbot has to scroll through
  intervening chat to find context.
- *"While you investigate that, can you also start a separate thread on
  the HUD redesign?"* Two parallel investigations want to share neither
  Codex session nor visible history.
- *"Forget what we just discussed; start fresh."* The operator wants a
  clean slate without losing the old conversation entirely.

There are at least five axes of session-ness the operator might want to
switch on:

| Axis            | Example                                                          |
|-----------------|------------------------------------------------------------------|
| Project context | Scoutbot for openscout vs lattices vs arach.dev                  |
| Topic / thread  | "the migration" vs "the HUD redesign" within the same project    |
| Time            | "yesterday's investigation" vs "starting fresh"                  |
| Sub-agent path  | A dispatched worker's side-session                               |
| Surface         | HUD compose, web channel, iOS — same identity, different entry   |

A model that handles all five with a single conversation is wrong. A model
that requires explicit operator action on every axis is exhausting. The
right shape is somewhere in the middle.

## Relationship to the transport's session model (load-bearing)

The substrate already has the session primitive. For v1 the substrate is
Codex via `codex_app_server`: a Codex session is a unique session ID +
persistent reasoning context + tools/cwd/MCP scope + a resume affordance.
The broker is already session-aware across transports — `mcp__scout__ask`
takes `targetSessionId` and `replyToSessionId`, and the runtime uses
`CODEX_THREAD_ID` to address an existing Codex thread. A future Pi or
Anthropic-API transport would expose an equivalent session ID through the
same broker surface.

**A scoutbot thread is the operator-facing label over a transport-native
session ID. Nothing more.** The session ID is the canonical identifier;
the thread name is sugar so humans can find and switch between sessions
without typing session IDs. Which transport produces the session ID is a
property of the endpoint, not of the thread model.

This is the single most important constraint on this proposal: do not
build a parallel session abstraction. The mapping is:

```
thread name (operator-facing)
  → broker conversationId (addressing surface)
    → transport-native session ID (substrate; Codex thread id today)
```

The arrows are clean lookups, not translations. If the substrate loses a
session, the thread loses its substrate — we do not try to reconstruct
context outside the substrate. If the broker's conversation goes away,
the thread goes with it. We do not maintain a third store with
reconciliation problems.

Concretely this means:

- The runner keeps a `threadName → (transportSessionId, conversationId)`
  map. The transport tag is captured per row so a future mixed-substrate
  setup is unambiguous, but for v1 every row's transport is
  `codex_app_server`. That's the entire data structure.
- On a turn, scoutbot's runner looks up the session ID from the active
  thread name and passes it as `targetSessionId` on the ask. The broker
  routes to the right transport via the endpoint row.
- Thread durability = substrate session durability + broker conversation
  durability. We never persist our own copy of the conversation.
- If we later want, say, a "fork this thread" operation, that has to be
  expressible as a substrate session operation (Codex session clone, or
  the equivalent on a future transport) — not a thing scoutbot fakes by
  maintaining its own context buffer.

Anything in this proposal that smells like it requires reinventing or
diverging from the substrate's session model — or that hardwires
Codex-specific assumptions above the adapter seam — is wrong and should
be cut. The substrate is pluggable; the thread model is not.

Relevant prior work:

- [`sco-050`](./sco-050-scoutbot-as-fleet-agent.md) — Scoutbot as fleet
  agent (blocking sibling; assumes the model this proposal defines)
- [`sco-046`](./sco-046-cross-machine-agent-ui-spec.md) — Cross-machine
  agent UI (informs cross-surface coherence)
- [`sco-048`](./sco-048-native-hud-and-desktop-ranger.md) — Native HUD
  cockpit (the primary consumer of the thread switcher)
- `apps/macos/Sources/HUD/HUDAssistantView.swift` — HUD assistant view
  (gets the switcher affordance)
- `apps/macos/Sources/Services/HudComposeService.swift` — compose
  pipeline (must learn about active thread)
- Memory `project_thread_residency` — cross-node threads live on the
  recipient's node (the same locality principle applies per-thread here)

## Options considered

Three models, in increasing operator load:

| Model     | What the operator does                                          | Trade-off                                                                |
|-----------|------------------------------------------------------------------|--------------------------------------------------------------------------|
| Implicit  | Nothing. Scoutbot infers from current context (active project, last surface, etc.) | Magical when right; infuriating when scoutbot switches threads without warning. |
| Explicit  | Picks a thread from a switcher in the Assistant view. Each thread = its own Codex session. | Familiar (Slack threads, ChatGPT history). Requires UI + lifecycle. |
| Multiple  | Mentions a qualified handle: `@scoutbot.openscout`, `@scoutbot.migration`. Distinct fleet agents per thread. | Most honest — they really are separate agents. Heaviest cognitive load; clutters the agents list. |

**Recommendation: Explicit threads with a default thread auto-created.**

Implicit is rejected because session-switching without the operator
noticing is the worst possible failure mode — it leaks context between
unrelated work and silently breaks continuity. Operator agency over thread
choice is non-negotiable.

Multiple-qualified is rejected because it pushes a switching decision into
the @-mention vocabulary, which is the wrong axis. The operator should
not have to remember "this conversation is with `@scoutbot.openscout`,
that one is `@scoutbot.migration`" — that's a switcher problem, not a
naming problem. Multiple-qualified also balloons the fleet roster: every
scoutbot thread becomes a row in `/agents`, drowning the actually-
interesting project agents.

Explicit threads with a default split the difference. The default thread
is what the operator gets on first launch — no setup required. New threads
spawn on demand. The switcher lives in the assistant view and is one
keystroke away.

## Proposal

### 1. A thread is a label over a Codex session ID

Restating the principle from the load-bearing section above, because
this is the data model:

A scoutbot thread is **a row in the runner's thread map**, with:

- A **name** — operator-facing label (e.g. "default", "migration", "hud
  redesign"). Editable. Not a primary key.
- A **Codex session ID** — the substrate. This is the primary key.
  Created on first turn by Codex (or on thread creation if we want a
  warm session waiting).
- A **broker conversation ID** — the addressing surface. Already a
  broker primitive; one per thread, so `message.posted` events scope
  cleanly. Conventionally named
  `dm.operator.scoutbot.<thread-id>`.
- Optional **pins** — project root (sets effective cwd for dispatched
  sub-agents), topic label, originating event id. Metadata for the
  operator; doesn't change scoutbot's behavior. Lives alongside the
  thread row.

That's it. There is no thread-content store, no thread-context buffer,
no thread-state machine outside Codex + the broker. The runner's thread
map is a small file (probably `~/Library/Application Support/OpenScout/
threads.json` or equivalent) that holds the three IDs + the name + pins.
Lose the file and you lose the human-readable names; the underlying
sessions and conversations are still there.

Durability composes: the thread persists as long as both its Codex
session and its broker conversation persist. If Codex drops the session,
the thread is dead — we don't try to keep it alive without the
substrate. If the broker drops the conversation, same.

### 2. Default thread on first use

When the operator first opens the HUD assistant view, scoutbot creates a
**default thread** named "default" with no project pin. Talking to
scoutbot without explicit thread selection lands in the default thread.
No setup required.

The default thread is also the target for any cross-surface entry point
where the operator hasn't picked a thread explicitly (e.g. the web channel
view, the iOS assistant tab).

### 3. Thread switcher in the HUD assistant view

The HUD assistant view (slot 5) gets a thread-strip affordance: a row of
named threads at the top of the panel, the active one underlined,
clickable to switch. A small `+` adds a new thread. A right-click (or
long-press on iOS) gives rename / pin to project / archive.

Keyboard: `cmd+t` opens a thread picker (fuzzy match by name, recently-
active first). `cmd+shift+t` reopens the last archived thread.

The thread name appears as a small chip in the compose dock target row so
the operator always knows which thread they're typing into.

### 4. New threads from the agent fleet

A thread can be created from anywhere in the UI that surfaces an agent or
a piece of recent activity. Right-click a tail event → "Start scoutbot
thread on this." Right-click a session in the timeline → same. The
context (event id, session id, project root) becomes the thread's
originating-event pin. This is how the operator picks up an investigation
from a real signal, not from a blank prompt.

### 5. Cross-surface coherence

The same thread is reachable from any surface scoutbot is accessible
from. HUD compose dock, web `/channels/<thread>`, iOS assistant tab —
all of them resolve a thread by id and render the same conversation. The
underlying Codex session is one — only one process keeps state for a
given thread, regardless of how many surfaces are looking at it.

The HUD's compose dock and the iOS app talk to scoutbot via the same
DM/broker pipeline. The only addition is a thread-id parameter on the
ask/send. The compose dock's existing target-chip UI already supports
this shape.

### 6. Sub-agent dispatch stays inside the parent thread

When scoutbot dispatches a sub-agent (per SCO-050), the spawned worker
runs in its own broker session but its result posts back into the parent
scoutbot thread. The thread does not fork on dispatch.

The dispatched sub-agent is visible in the fleet (per SCO-050's "exposed"
model) and can be clicked through to its own row, but the conversational
home for the work is the parent thread. This prevents dispatch from
fragmenting the operator's mental map of which thread holds which
investigation.

### 7. Archive, not delete

Threads can be archived but not deleted. Archive removes them from the
default switcher view; reopen via `cmd+shift+t` or the archived-threads
list. This matches operator expectations from Slack-style threading and
preserves audit history.

Delete is a separate, intentional action (the broker generally supports
durable history; threads are no exception).

## What this affects

- **HUD assistant view** — gains the thread strip, the `+` affordance,
  the switcher.
- **HUD compose dock** — gains a thread chip in the target row.
- **HudComposeService** — must know the active thread id, include it in
  the ask, and route incoming `message.posted` events to the matching
  thread's view.
- **Broker conversation model** — already supports multiple conversations
  per (operator, agent) pair via distinct `conversationId`s. No new
  schema; new naming convention:
  `dm.operator.scoutbot.<thread-id>`.
- **Codex session map** — scoutbot's runner code keeps a `threadId →
  codexSessionId` map; ask the broker for the right `targetSessionId` on
  each turn.
- **Web app** — the channels list grows scoutbot threads as first-class
  entries. The channel view renders each thread the same way the HUD
  does, just in a browser.
- **iOS app** — the assistant tab gets a thread switcher (a sheet, since
  screen real estate is tight). Same backing data; just a different
  affordance.

## What this does not affect

- The agent-side proposal in SCO-050. SCO-050 specifies *what scoutbot
  is*; this proposal specifies *which conversation scoutbot is in*. They
  ship together but argue separately.
- The relay sub-agent model from `project_relay_subagent_delegation`.
  Sub-agents don't get their own scoutbot threads — they post back into
  the parent's thread.
- Other agents in the fleet. Threading is a scoutbot affordance because
  scoutbot is the conversational entry point; project agents work
  ticket-by-ticket and don't need this model.

## Decisions

Some of these were settled during operator review; recorded so the calls
are visible.

- **Implicit vs explicit:** explicit, with a default. Implicit context
  switching is the worst failure mode; rejecting it is non-negotiable.
- **One scoutbot or many?** One, with multiple threads. Multiple
  qualified scoutbots in the fleet roster is the wrong axis.
- **Default thread name:** "default" — boring, predictable, easily
  renamed. Auto-generating a name from the first message is cute but
  causes early-conversation churn.
- **Switcher surface:** in the assistant view, not a separate window. The
  thread strip is part of the view.
- **Sub-agent dispatch result destination:** the parent thread, not a
  forked child thread.

## Open questions

- **Thread context budget.** A persistent Codex session per thread will
  eventually hit the model's context window. When? What's the summarize-
  and-drop strategy? Recommend deferring concrete strategy to v1.1 and
  measuring real thread length first.
- **Cross-thread referencing.** When scoutbot dispatches in thread A to
  look at thread B's history (rare but plausible — "what did I ask you
  yesterday about hudson?"), how does the sub-agent get read access to
  thread B's transcript without polluting thread A's context? Recommend
  read-only tool: `get_thread_history(threadId)`.
- **Thread discovery.** When the operator has 10+ threads, how do they
  find the right one? `cmd+t` fuzzy picker covers a lot; pinned threads
  surface above unpinned in the switcher. Beyond ~30 threads, this needs
  a real list view. Defer to when it matters.
- **Per-thread agents context.** Should a project-pinned thread expose
  the project's agent fleet preferentially when scoutbot needs to
  dispatch? Probably yes — but a clean implementation requires the
  project-pin metadata to carry a fleet scope. Defer to v1.1.

## Migration plan

Ships in the same build as SCO-050. The default thread covers the
existing single-conversation behavior; the switcher and `+` affordance
land in the HUD assistant view as part of the same change.

Concretely:

1. **Default thread auto-creation.** On HUD assistant view first launch,
   scoutbot creates a "default" thread if none exists. Existing
   conversation history (if any) is grandfathered into it.
2. **Thread chip in compose dock.** Visible from day one; before
   additional threads exist, the chip just says "default".
3. **Switcher affordance.** Thread strip at the top of the assistant
   view. Lands in the same change so the model is visible from day one.
4. **`+` and `cmd+t` to create.** Same change. The switcher is
   functional immediately even if the operator never creates a second
   thread.

There's no separate cutover for this. Either threading exists in the
build or it doesn't — there's no useful intermediate state where
"scoutbot is a Codex agent but has only one thread" makes long-term sense.

## Risks

- **Switcher complexity creep.** A thread strip is the foot in the door
  to a full conversation-management UI (folders, labels, search,
  archived list, …). Mitigation: ship the boring v1 (strip, `+`,
  rename, archive) and resist features until the operator hits a real
  ceiling.
- **Thread proliferation.** Operator creates a thread per intent and
  never cleans up. The fleet view stays clean (threads aren't fleet
  agents) but the switcher gets cluttered. Mitigation: archive is
  cheap; rely on it.
- **Cross-surface drift.** If HUD and web render the same thread
  differently, the operator has to context-switch mentally on top of
  switching apps. Mitigation: both surfaces resolve to the same
  conversation id and render the same data; styling differences are
  fine, behavioral differences aren't.

## Acceptance criteria

- HUD assistant view first launch creates a "default" scoutbot thread
  with no manual action required.
- Operator can create a new thread via `+` or `cmd+t`. The new thread
  has its own Codex session — context does not leak from the previous
  thread.
- Switching threads in the HUD updates the assistant view + the compose
  dock's target chip to reflect the new thread name. Sending in the new
  thread routes to that thread's conversation; the reply lands there,
  not in the previous one.
- The web channel view for a scoutbot thread renders the same
  conversation as the HUD's view of that thread. Sending from either
  surface advances the same thread.
- A dispatched sub-agent's result lands in the parent thread, not a
  forked one. The sub-agent is visible in the fleet view as its own
  row.
- Archive removes a thread from the default switcher and reopens via
  `cmd+shift+t`.

## Non-goals

- **A parallel session abstraction.** The thread is a name over a
  Codex session ID; it is not its own session model. Anything that
  would require maintaining context state outside Codex is out of
  scope. If a feature can't be expressed as a lookup over the existing
  session ID + broker conversation ID, it doesn't ship.
- Threading for other agents. Project agents stay ticket-shaped; only
  scoutbot gets this model.
- Full conversation search / labels / folders. v1 ships strip + `+` +
  rename + archive. More UI is a separate proposal.
- Multi-operator threads. This proposal is single-operator; mesh
  introduces the multi-operator question separately.
- Inter-thread merge / move. Threads stay distinct; if you create one
  by mistake, archive it and move on. A future "fork this thread"
  operation must come from Codex (session clone), not from scoutbot
  copying state.
