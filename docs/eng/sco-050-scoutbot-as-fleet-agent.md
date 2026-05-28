# SCO-050: Scoutbot As Fleet Agent — Codex-Backed, Tiered Execution

## Status

Proposed.

## Proposal ID

`sco-050`

## Implementation

- [`sco-050-implementation-plan.md`](./sco-050-implementation-plan.md) — Stage 1 cutover plan (delete runner, register Codex endpoint, ship prefilter, default-thread plumbing).

## Intent

Stop treating scoutbot as a custom assistant pipeline. Make it a normal agent
in the fleet, backed by a long-lived Codex session, with two execution paths
under one identity:

1. **Inline turns** — quick chat replies at low Codex effort, kept on the main
   conversation loop. The 90% case for HUD compose.
2. **Dispatched turns** — when the prompt warrants depth, scoutbot offloads
   work to a sub-agent and reports the dispatch in the thread. The async reply
   lands later as a fresh `@scoutbot` message when the sub-agent completes.

The proposal collapses the parallel OpenAI-direct path (`createRangerScoutbotBrain`
wrapping `gpt-4.1-mini` over the Responses API) into a single Codex-backed
agent that uses the same wake / mention / deliver / message-posted pipeline as
every other dev agent in the fleet.

## Context

Scoutbot today is a special case. The current shape:

- `packages/web/server/scoutbot-runner.ts` registers a `scoutbot` actor +
  agent, subscribes to broker events, and wraps a `ScoutbotBrain` interface
  whose v0 was an echo brain and whose v1 (current) is
  `createRangerScoutbotBrain(rangerAssistant)`.
- The Ranger assistant (`packages/web/server/ranger-assistant.ts`) calls
  OpenAI's `/v1/responses` directly with `gpt-4.1-mini` for analyst turns and
  `gpt-4o-mini` for the presenter pass.
- The HUD's assistant view (`apps/macos/Sources/HUD/HUDAssistantView.swift`)
  subscribes to broker events via SSE and filters on `actorId == "scoutbot"`.

This works for chat-shape replies. It does not work for anything else: scoutbot
can't read files, can't run commands, can't hand off to other agents, can't
hold meaningful context across turns. Every interesting follow-up ("can you
check what hudson did?", "look at the auth migration") hits the wall of "I'm
just an LLM call with no tools."

Three pressures are converging on the same answer:

1. **Models evolve.** The capability gap between a fast chat LLM and a full
   agent runner shrinks every quarter. The case for maintaining two parallel
   provider integrations (OpenAI Responses for chat, Codex for agent work)
   keeps weakening.
2. **OpenAI direct is uncomfortable.** Provider policy direction, key
   custody, billing surface — increasingly we'd rather not have a
   second authentication and credentialing path for a feature when the
   primary agent path is already credentialled through Codex.
3. **The dual-LLM model is a tax.** Two prompt vocabularies, two failure
   modes, two latency profiles, two ways for context to be lost. Operators
   shouldn't have to know which surface speaks to which model.

Relevant prior work:

- [`sco-012`](./sco-012-concierge-routing-and-delegation-proposal.md) —
  Concierge routing and delegation (the dispatch pattern this proposal
  inherits)
- [`sco-035`](./sco-035-ranger-chip-unification.md) — Ranger surface
  unification on the web (the brain being deprecated here)
- [`sco-037`](./sco-037-ranger-brief-pipeline.md) — Ranger brief two-stage
  pipeline (also OpenAI-direct; same migration applies)
- [`sco-048`](./sco-048-native-hud-and-desktop-ranger.md) — Native HUD
  cockpit (the consumer of this assistant)
- [`sco-051`](./sco-051-scoutbot-thread-model.md) — Scoutbot thread model
  (blocking sibling: this proposal assumes a default thread; SCO-051
  defines what a thread is)
- `packages/web/server/scoutbot-runner.ts` — the runner being collapsed
- `apps/macos/Sources/HUD/HudComposeService.swift` — HUD compose pipeline
  (unchanged by this proposal)
- Memory `project_scoutbot_unified_assistant` — the unified assistant
  decision; this proposal lands the model side of it
- Memory `project_relay_subagent_delegation` — the cheap-haiku sub-agent
  delegation pattern this proposal builds on

## Thesis

Scoutbot stops being a feature. It becomes **a row in the fleet** with a
particular role: always-available, conversation-first, persistent context,
no project root. The HUD's Assistant tab is just a specialized view onto
that one agent's DM conversation.

Everything we currently special-case for scoutbot — the brain wrapper, the
runner-as-LLM-adapter, the OpenAI direct credential path — falls away. What
stays is the agent identity, the HUD's compose dock targeting `@scoutbot` by
default, and the SSE subscription that pipes scoutbot's replies into the
assistant thread.

The execution model is two-stage inside one identity:

| Stage      | What handles it                          | Latency               | Reply shape                                       |
|------------|------------------------------------------|-----------------------|---------------------------------------------------|
| Prefilter  | Deterministic rules — no LLM call        | Tens of ms            | One direct reply, or fall through                 |
| Agent turn | Long-lived Codex session                 | Seconds (agentic ok)  | Direct reply, or scoutbot dispatches mid-turn     |

The prefilter handles obviously-cheap requests (slash commands, exact status
reads from broker snapshots) without ever calling Codex. Anything that doesn't
match falls through to a Codex turn. The turn itself decides whether to
dispatch sub-agent work when it realizes a real piece of work is required —
not a separate classifier model, not a tier preflight.

The earlier draft of this proposal had a tiny LLM "decide_tier" classifier
that ran before every turn. That's dropped. Classifiers add latency, cost,
and false confidence while knowing less than the main turn does after seeing
context. The deterministic prefilter sits in front; everything else is one
real turn that picks its own path.

## Scoutbot's role: read state and broker ops, not software building

The framing that makes everything else fall out cleanly. Scoutbot does two
things:

1. **Read the state of the fleet** — what's running, what just happened,
   what's blocked, what was said where.
2. **Do broker operations on the operator's behalf** — send messages, ask
   other agents, dispatch work, cancel, escalate.

It does not write code. It does not run shell commands on the operator's
projects. It does not open editors or build artifacts. That's what the
project agents are for (`@hudson`, `@studio`, `@quill`, the rest of the
fleet). Scoutbot's job is to be the dispatcher and the concierge.

This framing collapses a lot of would-be design surface:

- The tool scope question almost answers itself: read tools over broker
  state, structured write tools for broker operations, no codebase write or
  shell access. The Codex agent's full toolset isn't appropriate here —
  scoutbot needs a curated subset.
- The cwd question becomes uninteresting. Scoutbot doesn't operate on
  files; cwd is just where its own logs live.
- Sub-agent dispatch makes more sense as the primary verb for "do work" —
  scoutbot dispatching is its main mode of action, not an escape hatch for
  hard cases.

This is also the reason scoutbot doesn't need a lot of ongoing improvement.
Once the reading is honest and the broker operations are clean, the surface
is stable. Capability growth happens in the project agents, not in scoutbot.

## Security posture

Scoutbot runs on the operator's own machine, talking to a local broker on
localhost, addressing agents the operator owns. The threat model is *the
operator helping themselves not screw themselves over*, not a hardened
multi-tenant service. With the mesh, security boundaries live at the mesh
edge; scoutbot's local execution stays the same.

So the posture is **trust the operator, don't gate the agentic flow**. The
controls below are defaults and structural choices, not per-turn permission
prompts. Anything that interrupts the flow with "are you sure?" prompts
defeats the point of an agentic system.

What we do:

- **Provenance on every broker write.** Each `send`/`ask`/dispatch
  scoutbot makes carries `requestedBy: operator`, the source message id,
  the parent scoutbot turn, and a "generated by scoutbot" marker.
  Provenance is observability, not a gate.
- **Structured routing, not body-mention parsing.** Scoutbot resolves
  routing metadata before issuing a broker write. It does not let model
  output decide who to ping by emitting `@handle` strings in the body.
- **Read tools broad, write tools narrow.** Scoutbot's broker write tools
  are a small structured set (`send_message`, `ask_agent`,
  `dispatch_subagent`, `cancel_flight`) — not "do anything with the
  broker." This is a tool-design choice, not a permission prompt.
- **No shell, no codebase writes.** Scoutbot's role is read state and
  broker ops; tool scope just doesn't include those.

What we explicitly do not do:

- Per-turn confirmation prompts for normal broker writes.
- Rate limits or budget caps on dispatches.
- Sandboxing scoutbot's Codex session in a way that breaks the agent flow.

If the mesh phase later changes the threat model (multi-operator,
cross-machine fanout), the controls get revisited then — but for the
localhost-first phase, the right move is to ship the agentic loop without
friction.

## Proposal

### 1. Scoutbot is a normal agent

Register `scoutbot` exactly like `talkie` or `studio` — an `agent.endpoint.upserted`
record with `transport: codex_app_server` (or whatever transport we use for the
embedded Codex session manager). The broker's existing wake / mention / deliver
pipeline drives invocations. The runner-as-special-case goes away.

What this means concretely:

- The agent table gets a `scoutbot` row with `defaultSelector: "@scoutbot"` and
  `labels: ["assistant", "scout", "scoutbot"]` — same registration we already
  emit from the runner.
- The endpoint table gets a `scoutbot` row with `transport: codex_app_server`,
  `state: waiting`, and a long-lived session identifier so wakes are
  near-instant.
- The runner reduces to (a) ensuring the registration is present on boot and
  (b) starting the embedded Codex session if it isn't already running. No
  brain wrapper, no event-stream subscription, no echo fallback.

### 2. Codex as the v1 substrate, behind the existing adapter seam

Drop `RangerScoutbotBrain`. Drop the `ScoutbotBrain` interface. The "brain"
abstraction was useful when we were proving the loop with an echo backend; it
has no caller after this change.

The v1 substrate is the same `codex_app_server` transport the broker already
supports for `talkie`. Credentials follow the existing Codex path — no new
credential surface.

**This is not a hard binding to Codex.** The broker already treats agent
endpoints as transport-tagged rows (`transport: codex_app_server`,
`transport: tmux`, `transport: codex` CLI, eventually `transport: pi` or
`transport: anthropic_api` if those land). Scoutbot rides the existing
adapter seam:

- The **role** lives above the seam: scoutbot's system prompt, its tool
  grants (read-only broker snapshots + structured `send_message` /
  `ask_agent` / `dispatch_subagent` / `cancel_flight`), its provenance
  conventions, its prefilter, its behavior. None of this code knows what
  transport is underneath.
- The **transport adapter** lives below the seam. Whatever the broker
  needs to spawn a session, route a turn, and observe completion in a
  given transport is the adapter's responsibility — already implemented
  per-transport for the existing fleet.
- The **endpoint registration** is the binding point. Today scoutbot's
  endpoint row will say `transport: codex_app_server`; swapping to Pi
  later is changing that one row + ensuring the Pi adapter honors the
  same tool grants.

Concretely this means scoutbot's runner shim must not call into
codex-specific APIs directly. Tool grants are expressed as a
transport-agnostic config (the role section above the seam reads it).
System prompt is a markdown file injected per-backend in whatever shape
the backend takes prompts. Session lifecycle, turn dispatch, result
observation all go through the broker's existing per-transport adapter
code paths.

What this gets us: if we move to Pi-backed scoutbot, or hit a future
LLM/API that's easier to integrate than Codex, the change is
swap-the-transport-in-the-endpoint-row, not rewrite-scoutbot.

The Ranger assistant module (`ranger-assistant.ts`) is unaffected by this
proposal; it continues to back the web app's existing Ranger features until
a separate proposal addresses those. The deprecation is scoped to scoutbot.

### 3. Execution: prefilter + agent turn

Scoutbot's reply loop becomes:

```
on @scoutbot message:
  if prefilter.matches(prompt):
    return prefilter.handle(prompt)        # no LLM call
  reply = codex_session.turn(prompt)
  # turn may include a dispatch tool call — if so the reply is a dispatch
  # ack; the spawned sub-agent posts its result back to the same DM later
```

The prefilter is a small, intentionally-incomplete registry of deterministic
rules:

- **Slash commands.** `/help`, `/agents`, `/status`, `/recent @agent`,
  `/doing @agent`, `/flight <id>`, `/cancel <id>` (with confirmation), etc.
- **Exact status reads.** Tight regexes only — "what is @x doing", "is @x
  blocked", "recent from @x", "who is online". Matches are answered directly
  from broker snapshots.
- **Read-only broker tools.** Agents, endpoints, flights/invocations, latest
  messages, current turn/session snapshot. The prefilter pulls from
  whatever's already in memory; nothing it does requires a model call.

Everything else falls through to the Codex turn. The prefilter does not try
to be clever — ambiguity, multi-target, "why/how/should", code or project
content, requested action all fall through. Each prefilter response includes
the matched rule id + snapshot version so the path is observable.

The dispatch path uses the relay sub-agent mechanism described in
[`project_relay_subagent_delegation`]. When scoutbot's main turn calls the
dispatch tool, the sub-agent receives the task, inherits scoutbot's
conversation context as a one-shot brief, and posts its result back to the
same DM conversation as a `@scoutbot` message (the sub-agent's identity is
internal; the operator-visible author stays `@scoutbot`).

### 4. Sub-agent visibility

Three options for how visible the dispatch is to the operator:

| Option   | Operator sees                                                    | Trade-off                                                   |
|----------|------------------------------------------------------------------|-------------------------------------------------------------|
| Opaque   | One slow reply. No mention of internal tier or sub-agent spawn.  | Cleanest UX. Hardest to debug when scoutbot is stuck.       |
| Tagged   | Reply includes a small marker (`· dispatched · 2m`).              | Good middle ground. Operator can see when scoutbot offloaded. |
| Exposed  | Sub-agents appear as rows in the fleet (`scoutbot.research.1`).  | Most honest. Fits operator-cockpit model. More UI churn.    |

This proposal recommends **exposed**. Sub-agents *are* real agents — hiding
them creates an asymmetry between scoutbot's work and every other agent's
work, which makes the fleet harder to reason about. Exposing them means a
stuck sub-agent is debuggable the same way any other stuck agent is: open the
agents view, find the row, see what it's doing.

The dispatch ack message scoutbot posts in the DM thread carries a link to
the spawned sub-agent so the operator can click through if they want to
follow the deep work.

## What collapses

After the change:

- `packages/web/server/scoutbot-runner.ts`: deleted, replaced by an agent
  registration + endpoint-config helper that runs once at boot.
- `ScoutbotBrain` interface + `createEchoBrain` + `createRangerScoutbotBrain`:
  deleted. The interface had two consumers, both gone.
- The bespoke event-stream subscription in the runner: deleted. Mention
  delivery flows through the broker's standard path.
- The OpenAI direct call path for scoutbot replies: deleted. (Ranger's other
  uses of OpenAI direct are out of scope here.)

## What stays scoutbot-specific

- The `@scoutbot` handle as the HUD compose dock's default routing target.
- The HUD's SSE subscription in `HudComposeService.swift` that filters
  `actorId == "scoutbot"` and appends to `assistantThread`. The subscription
  doesn't care whether scoutbot is a brain wrapper or a Codex agent — the
  on-the-wire `message.posted` event has the same shape either way.
- The Assistant view in the HUD (slot 5) as the conversation-first window
  onto scoutbot. Other agents are visible there too via mentions, but scoutbot
  is the default citizen of that view.
- Boot: scoutbot's session should be warm by the time the menu app launches,
  not after the operator first @-mentions it.

## Decisions

These were open in earlier drafts of this proposal and have since been
resolved during operator + Codex review. Recorded here so future readers see
the calls, not the deliberation.

- **Project root / cwd:** scoutbot doesn't operate on files, so cwd is mostly
  uninteresting. Pinned to the openscout control-plane workspace by default
  for log locality. No roaming complexity.
- **Where it runs:** co-resident with the broker, as a `codex_app_server`
  subprocess under the same supervisor. Autostarted at boot, restarted on
  crash. Same lifecycle as `talkie`.
- **Dispatch visibility:** exposed. Sub-agents appear as real rows in the
  agents view and tail firehose. The dispatch ack message in the DM thread
  links to the spawned sub-agent.
- **Tier classifier model:** dropped entirely. Replaced by the deterministic
  prefilter in §3. No LLM preflight on every turn.
- **Migration shape:** hard cutover (see Migration plan below). No feature
  flag, no shadow runner, no alternate handle.
- **Security posture:** localhost-trust model. Provenance and structured
  tools as defaults; no per-turn permission gates, no rate limits. See
  Security posture section above.

What remains genuinely open is in the Open Questions section below.

## Migration plan

Hard cutover. The old runner is effectful — it subscribes to every
addressed `message.posted` and posts its own reply
(`packages/web/server/scoutbot-runner.ts:265-377`). Keeping it active
alongside a real Codex endpoint produces duplicate replies. A shadow path
would require rewriting the runner to be non-posting first, which is more
work than just deleting it. An alternate handle (`@scoutbot2`) proves
nothing because the production path is exactly `@scoutbot` reaching the HUD.

So the sequence is one cut:

1. **Land the prefilter + Codex agent endpoint together in a single
   change.** Same change deletes `scoutbot-runner.ts`, removes the
   `ScoutbotBrain` interface, removes `createRangerScoutbotBrain`, and
   registers scoutbot as a `codex_app_server` endpoint in the same boot
   path that registers `talkie`. The prefilter ships in this change too —
   it's the path that most reads exercise, and it lands without an LLM
   call so it's safe to land early.
2. **Add sub-agent dispatch + visibility.** Wire the dispatch tool, the
   sub-agent spawn, and the fleet visibility (sub-agents appear as rows in
   the agents view, surface in the tail firehose, the dispatch ack
   message links to the spawned sub-agent). This is additive; until it's
   wired, scoutbot just answers everything as a direct turn.

Stage 1 ships value on its own — one provider path, one identity model,
cleaner permissions surface. Stage 2 unlocks the actually-interesting
capability (dispatched sub-agents for multi-step work).

No feature flag for the cutover. Localhost-first system; flags add
maintenance burden for a transition that takes minutes to validate.
Rollback is `git revert` if needed.

## Open questions

Some of these are blocking for the implementation; others can defer if we
design hooks for them now.

**Blocking for SCO-050:**

- **Provenance schema for broker writes.** What goes in the metadata block
  on every `send`/`ask`/dispatch scoutbot emits — `requestedBy`, source
  message id, parent scoutbot turn, a "generated by scoutbot" marker, and
  whatever else makes the path debuggable from the broker UI.
- **Identity attribution for dispatched work.** A sub-agent does deep work
  and posts a result. The message is authored by `@scoutbot` for operator
  UX, but who shows up in audit / tail attribution — the parent or the
  worker? Recommend the worker, with a `spawnedBy: scoutbot` link, so
  every visible row in the fleet is a real agent doing real work.
- **Session model.** This is its own surface, split into
  [`sco-051`](./sco-051-scoutbot-thread-model.md). **SCO-050 can only
  proceed once SCO-051 has at least a scoped default thread with no
  implicit cross-thread context mixing.** Both proposals ship in the same
  build.

**Design hooks now, fill in later:**

- **Cancellation / interrupt.** Operator cancels a long-running dispatched
  sub-agent. Surface the cancel as a tool call scoutbot can make on the
  operator's behalf, with a confirmation pattern that doesn't break flow.
- **Lifecycle cleanup for exposed sub-agents.** When a dispatched
  sub-agent finishes, how does its row in the fleet age out? Recommend
  keeping it visible for some time window (1 hour?) then collapsing into
  the parent scoutbot's history.
- **Observability metrics.** What to measure to know the system is
  healthy — prefilter hit rate, time-to-first-token on Codex turns,
  dispatch fan-out, sub-agent completion rate. Don't gate the launch on
  these but design them in.

**Do not defer indefinitely (conservative defaults OK for v1):**

- **Concurrency / backpressure.** v1: one active scoutbot turn per thread.
  Additional messages queue, or get rejected with visible state (no
  silent drops). Operator can see exactly what scoutbot is doing.
- **Transcript privacy.** DM context does not leak into channel posts by
  default. When scoutbot is mentioned in a channel, it starts from the
  channel's context, not from the operator's DM history.
- **Conversation memory budget.** Persistent Codex sessions accumulate
  context. At some point scoutbot needs to summarize and drop old turns.
  Out of scope for v1 (per-thread Codex session handles this naturally up
  to its context window) but pin a re-visit before context limits start
  causing visible failures.

## Non-goals

- Replacing Ranger's other web-side surfaces (brief author, operator brief,
  etc.). Those continue to use OpenAI direct via `ranger-assistant.ts` until
  separately addressed.
- Replacing other dev agents in the fleet. The proposal makes scoutbot one
  of them, not a meta-agent that supersedes them.
- Building a generic "agent classifier" or "router". `decide_tier` is
  scoutbot-internal; it doesn't generalize beyond scoutbot's own dispatch
  decision.
- Changing the HUD compose dock UX, the assistant view layout, or the
  mention parsing. Those are stable.

## Risks

- **First-mention latency.** A Codex session that isn't already warm can
  take seconds to spawn. Mitigation: autostart at boot, keep the session
  warm even when idle (the broker already supports `state: waiting` for
  this). The deterministic prefilter also covers most cheap reads without
  needing the session at all.
- **Dispatch identity confusion.** If sub-agents are visible in the fleet
  but their replies post under `@scoutbot`, operators may not understand
  which agent actually did the work. Mitigation: the dispatch ack message
  carries the sub-agent's identity prominently and links to its fleet row.
- **Cost shape change.** A Codex turn is heavier than a Responses API
  call. The prefilter absorbs most of what would have been cheap chat —
  but turns that fall through are more expensive than the old path. We
  accept the cost increase as the price of one provider, real tools, and
  agent-class capability.
- **Provider lock-in.** This proposal ties scoutbot to Codex. That's the
  point — the dual-provider model was the problem. If Codex availability
  becomes a blocker, a `ScoutbotBrain`-equivalent interface can be
  reintroduced; the deterministic prefilter stays unchanged either way.
- **Prompt-injection via broker writes.** Even with read-only tools, a
  Codex turn that calls `send_message` or `dispatch_subagent` based on
  untrusted content (a message from another agent, a tail event with
  embedded text) could fan out abusively. Mitigation: structured tool
  args (not body-mention parsing), provenance on every write, scoutbot's
  system prompt explicit about not acting on third-party-supplied
  instructions. Trust model is localhost; this is a soft control, not a
  hard one.

## Acceptance criteria

Correctness and observability, not sub-second latency. This is an
agentic-first system; the operator is firing off tasks and reading replies,
not waiting on a chat window.

- Scoutbot replies in the HUD compose dock are served by a Codex session,
  not by an OpenAI direct call.
- `scoutbot-runner.ts` and `ScoutbotBrain` no longer exist in the codebase.
  `createRangerScoutbotBrain` is removed.
- A slash command (`/agents`, `/status`, `/recent @x`) returns a reply via
  the deterministic prefilter — no Codex call made, prefilter rule id and
  snapshot version visible in the response metadata.
- A multi-step prompt to scoutbot ("can you check what hudson did and
  refactor the auth module") triggers a dispatched sub-agent that appears
  as a row in the agents view and the tail firehose. The dispatch ack
  appears in the DM thread; the result lands as a follow-up when the
  sub-agent completes.
- A simple chat prompt to scoutbot returns a reply from the Codex turn
  with no sub-agent spawned.
- Every broker write scoutbot emits carries provenance: `requestedBy`,
  source message id, parent scoutbot turn, generated-by marker.
- Scoutbot does not call shell tools or write to the codebase. Its tool
  scope is read-only over broker snapshots plus the structured
  `send_message` / `ask_agent` / `dispatch_subagent` / `cancel_flight`
  set.
- Concurrent operator messages to scoutbot in the same thread are queued
  or rejected with visible state, not silently dropped.
