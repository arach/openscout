# SCO-012: Concierge Routing and Delegation

## Status

Proposed.

## Proposal ID

`sco-012`

## Intent

Define the operator-facing collaboration workflow where Scout behaves like a
helpful concierge instead of a command router.

The goal is simple to say and harder to implement well:

- the operator states intent once
- Scout does the internal coordination work
- Scout picks the obvious path when the choice is low-risk
- Scout validates before consequential actions
- Scout stays responsible for follow-through instead of dropping the operator
  into broker internals

SCO-012 sits on top of the existing broker-first architecture, the
question-versus-work distinction in
[`collaboration-workflows-v1.md`](../collaboration-workflows-v1.md), and the
identity and binding work proposed in
[`sco-004-addressable-identities-and-session-bindings-proposal.md`](./sco-004-addressable-identities-and-session-bindings-proposal.md).

It does not replace those pieces. It defines how they should be composed into
one coherent agent experience.

## Problem

Today a request such as:

> "Use Scout to ask Vox about this."

looks simple to the operator but fans out into several hidden decisions:

- is the broker reachable?
- who is the sender for this session?
- what return address should replies use?
- which `@vox` does the operator mean?
- is this a question, a durable work request, or just a note?
- should Scout start a target session, reuse one, or fail?
- when the target replies or stalls, who owns the next move?

The current experience leaks too many of those questions back to the operator
or the calling agent. That creates three failures of product behavior:

1. Scout feels like a switchboard instead of a concierge.
2. Failures are reported from the wrong layer, so users cannot tell "broker is
   down" from "target is ambiguous" from "target is offline."
3. Hidden identity or routing drift makes delegation feel non-deterministic.

One concrete risk in this area is when sender defaults drift across pathways.
If `ask`, `send`, `watch`, and related commands do not share one coherent
sender model, replies and follow-ups start to feel shaky even when broker
routing itself is healthy.

The root issue is not missing commands. The root issue is missing workflow
ownership.

Scout needs one broker-owned collaboration workflow that:

- spends machine effort before user attention
- defaults to the simplest safe interpretation
- asks for help only when the remaining ambiguity would materially change the
  outcome
- preserves responsibility after the initial route

## Decision

OpenScout SHOULD adopt a **concierge routing and delegation workflow** as the
default operator experience.

The governing rule is:

- the operator expresses intent once
- Scout performs a broker-owned preflight
- Scout resolves low-risk ambiguity automatically
- Scout asks one concise clarifying question only when needed
- Scout records the collaboration item before delivery
- Scout stays on the case until the interaction is answered, handed off,
  accepted, or cancelled

The default should stay lightweight:

- most interactions should not require the operator to think about sender
  identity, session binding, branch, node, or worktree
- Scout should use session-specific routing when the interaction needs to
  resolve back to the current room or live session specifically, and avoid it
  when ordinary alias-level delivery is enough

This requires five specific product rules.

### 1. Stable sender identity per session

Every active operator session MUST have one stable sender identity and one
stable return address.

Scout MAY derive this from:

- an existing thread binding
- the current live session binding
- a previously bound session-scoped card
- an automatically created project- or worktree-scoped card
- an explicit `--as` override

It MUST NOT silently use one identity for asking and another for sending within
the same active session unless the operator explicitly requests that split.

Session-scoped follow-through does not automatically require a brand-new sender
identity. Continuity is implied by default. Scout should only add explicit
session-level routing when the sender wants replies or follow-ups to resolve to
the current room or live session specifically rather than to any equivalent
instance behind the same alias.

The right mental model is not "new identity" and not even "new top-level
room." A session bind is closer to a session-scoped topic lane inside the
existing DM room: a room within the room, or a session-level hashtag that says
"this part of the conversation belongs here."

Another way to say it: a session bind creates a session DM lane within the
larger alias-level DM. That gives an agent a narrower inbox slice such as "my
session DM with `lattices`" instead of forcing it to parse every message in the
whole `@vox` inbox.

When the sender wants a specific live session to receive the reply, Scout
SHOULD support a lightweight attention override: effectively "I am this
session; route replies or follow-ups back to me." This should bind attention or
reply routing without requiring a brand-new sender identity.

Scout SHOULD use explicit session binding or attention routing when the sender
needs specific resolution back to the current room or live session. It SHOULD
avoid them when ordinary delivery to the logical alias is enough. These are
necessity-driven tools, not ceremony to apply by default and not
exception-only features either.

### 2. Deterministic default resolution

When the operator targets a short identity such as `@vox`, Scout SHOULD resolve
it by deterministic ranking rules before asking the user.

The operator's real anchor is often not a branch or worktree. It is the active
session or room they are already using. Scout SHOULD therefore privilege native
session routing and recent interaction context before filesystem structure.

The default rank order SHOULD be:

1. existing thread or work-item binding
2. current live session binding or most recent relevant session interaction
3. current repo or worktree scope
4. local node over remote mesh peers
5. default workspace branch, usually `main` or `master`
6. target agent's configured default profile or harness
7. last successful route from this sender session to the same logical target
8. globally minimal unique live candidate

If an explicit qualifier is present, it overrides default ranking for that
dimension.

In normal operation, these rules should remain mostly invisible to the
operator. They exist so Scout can make the simple choice quietly, not so the
user has to manage routing state manually.

### 3. Confidence-based act or ask

Scout SHOULD classify routing confidence into three deterministic buckets:

- `high`: act immediately
- `medium`: act using the best default and disclose the assumption in the
  receipt
- `low`: ask one short clarifying question

This is not meant to be a fuzzy model judgment. Confidence should be derived
from broker-owned facts such as:

- whether the broker is reachable
- whether the sender identity is stable
- whether one candidate clearly outranks the rest
- whether the action is cheap and reversible
- whether the route crosses project, machine, or trust boundaries
- whether the top candidates would lead to meaningfully different work

### 4. First-class collaboration intents

Scout SHOULD surface and persist three operator intents distinctly:

- `tell`: a durable note, reply not required
- `ask`: a question, answer required, short lifecycle
- `handoff`: a durable work request with ownership and follow-through

The current question/work split already exists at the workflow level. SCO-012
requires the operator experience to expose and honor that distinction instead of
forcing durable delegation through `ask`.

### 5. Follow-through is part of the workflow

Scout's responsibility does not end when it routes the first message.

For `ask`, Scout SHOULD:

- track the question to answer or decline
- surface the answer back to the originating session
- spawn a work item if the answer reveals durable execution work

For `handoff`, Scout SHOULD:

- create a work item with `ownerId` and `nextMoveOwnerId`
- track `working`, `waiting`, `review`, and `done`
- nudge only the current `nextMoveOwnerId`
- return updates to the originating session without requiring the operator to
  reconstruct the context manually

## Reading This Doc

This is a workflow proposal, not a UI mock and not a standards document.

Where the language uses `must` or `should`, read it as guardrails for keeping
Scout in the concierge role:

- what Scout should do automatically
- what Scout should validate before acting
- what Scout should never push back onto the operator by default

## Design Principles

1. The operator states intent once.
2. Scout spends machine effort before user attention.
3. Simplicity means choosing safe defaults, not ignoring ambiguity.
4. The broker remains the canonical source of routing truth.
5. One live session gets one sender identity unless explicitly overridden.
6. Native session or room resolution outranks filesystem shape when it matters.
7. Scout should allocate the minimum state the interaction actually needs.
8. Scout asks only when the remaining ambiguity is outcome-relevant.
9. Every action should produce a receipt that explains what Scout assumed.
10. Follow-through is part of routing, not a separate product.
11. Recovery should be deterministic from durable records, not terminal memory.

## Goals

- make Scout feel like a proactive assistant instead of a CLI front-end
- reduce user-visible ambiguity in ordinary agent-to-agent collaboration
- standardize when Scout acts and when it asks for clarification
- keep sender identity and return address stable through a whole interaction
- default to the simplest safe target in common cases
- preserve explainability for routing and wake decisions
- align CLI, desktop, mobile, and skill-driven flows around one workflow

## Non-Goals

- replacing SCO-004 identity and binding work
- replacing question/work semantics with a new collaboration model
- introducing a second routing authority outside the broker
- making routing purely LLM-driven
- hiding consequential ambiguity behind silent guesses
- requiring the user to care about harness, node, or branch on every request
- solving all planning or project management UX in this proposal

## Terminology

| Term | Meaning |
|---|---|
| **Concierge workflow** | The broker-owned flow that takes one operator intent, validates it, routes it, and stays responsible for follow-through |
| **Preflight** | The validation and resolution pass before Scout creates or routes a collaboration item |
| **Sender binding** | The stable identity and return address Scout uses for the current operator session |
| **Session binding** | A lightweight or durable association that creates a session-scoped topic lane inside the existing DM room so replies or follow-ups resolve to a specific native live session without requiring a new sender identity |
| **Session DM lane** | The room-within-room view created by a session binding, letting one live session focus on its own DM lane with another session or actor instead of the full alias-level inbox |
| **Attention override** | A lightweight instruction that says "route this part back to my current topic lane / room specifically," without minting a new sender identity |
| **Resolution ladder** | The deterministic ranking rules Scout uses before asking the operator to clarify |
| **Receipt** | The compact acknowledgment that states what Scout did and what assumptions it used |
| **Consequential ambiguity** | Ambiguity that would materially change the target, trust boundary, or work outcome |

## Workflow Shape

### 1. Intake

The operator or calling agent expresses one intent in plain language.

Examples:

- "Ask `@vox` whether the live session bug is already fixed."
- "Hand this trace issue to `@vox`."
- "Tell `@hudson` I'm taking the runtime side."

Scout SHOULD parse only enough structure to determine:

- the collaboration intent: `tell`, `ask`, or `handoff`
- any explicit target qualifiers
- whether the request implies a tracked reply
- whether the sender wants this bound to the current session
- whether the sender is explicitly asking for attention back to the current
  session
- whether the request is cheap, reversible, and safe to auto-complete

If none of those room-affinity signals are present, Scout SHOULD assume the
simplest alias-level route first.

If they are present, Scout SHOULD treat them as a request to keep this
interaction inside a session-scoped lane of the existing room rather than as a
request to invent a new participant or a brand-new top-level conversation.

That means the receiving agent should be able to view and work from the
session-specific DM lane directly, instead of having to manually sift through
the entire logical alias inbox to find the messages meant for this in-progress
session.

### 2. Preflight

Before any route, Scout MUST perform a broker-owned preflight.

At minimum, preflight should validate:

- broker reachability
- sender binding
- current session binding when one exists
- any explicit attention override
- current thread or work-item bindings
- target candidate set
- action type and cost

If broker reachability fails, Scout MUST say so explicitly and stop. It MUST
NOT blur broker failure into identity or routing failure.

If sender binding is missing, Scout SHOULD create or reuse one automatically
before routing, unless the environment prevents this safely.

Scout SHOULD check only the minimum state needed for the requested interaction.
Ordinary message delivery should not trigger extra session machinery unless the
interaction actually depends on it.

Near-term bias:

- create sender bindings lazily on the first Scout action that expects
  follow-through
- prefer reusing the session's existing sender identity
- prefer preserving the current session binding over inferring identity from
  branch or worktree alone
- prefer an attention override over a fresh sender identity when the real need
  is simply "reply to this room or session specifically"
- create a dedicated topic lane or reply thread only when that is the cleanest
  way to preserve room-specific resolution
- avoid minting a fresh sender identity per coding session unless explicit
  isolation is requested
- avoid introducing session-specific state when ordinary delivery is enough

### 3. Target Resolution

Target resolution SHOULD be deterministic first and conversational second.

Suggested order:

1. honor explicit qualifiers from the operator
2. prefer an existing thread or work-item binding
3. prefer candidates already participating in the current session binding or
   recent session exchange
4. prefer candidates from the current repo or worktree
5. prefer the local node over remote peers
6. prefer the target's default branch or workspace, usually `main` or `master`
7. prefer the target's configured default harness or profile
8. prefer the last successful route from this sender binding
9. fall back to the globally minimal unique live candidate

If no candidate exists but a configured logical target exists, Scout SHOULD
offer or automatically perform "resume or start target" rather than reporting
the target as simply unknown.

If multiple candidates remain and the top candidates would lead to materially
different work, Scout MUST fail closed and ask one concise question.

### 4. Act Or Ask Threshold

Scout SHOULD use the following threshold:

#### High confidence

Act immediately.

Typical characteristics:

- one clearly best candidate
- same current session context or same recent interaction
- same node and same expected target lineage
- stable sender binding
- cheap or reversible action

#### Medium confidence

Act using the best default, then disclose the assumption in the receipt.

Typical characteristics:

- multiple candidates exist, but one outranks the others by the deterministic
  ladder
- differences are local and low-risk, such as `main` versus a feature worktree
  when no active focus points elsewhere
- action is still reversible

Example receipt:

> Asked `@vox.main.mini` from `@openscout-codex`. Assumed the local main
> instance because no branch was specified.

#### Low confidence

Ask one short clarifying question.

Typical characteristics:

- top candidates belong to different projects or machines
- the action crosses a meaningful trust or authority boundary
- the operator's wording conflicts with the strongest default
- the action is destructive, expensive, or hard to undo
- the sender binding is unclear enough that replies would land in the wrong
  place

The question should ask only for the missing distinction.

Bad:

> Which project, node, harness, and branch did you mean?

Good:

> I found local `@vox.main.mini` and remote `@vox.main.laptop`. Which one
> should take this?

### 5. Record Before Delivery

Scout SHOULD persist the collaboration item before waking the target.

That means:

- `tell` becomes a durable message
- `ask` becomes a question or invocation-backed question record
- `handoff` becomes a work item plus the necessary delivery or invocation

This keeps recovery deterministic and preserves explainable routing.

It should not be read as a requirement to allocate new routing state for every
message. Scout should allocate the minimum routing state needed for the
interaction to behave correctly.

### 6. Receipt

Every successful action SHOULD return a compact receipt.

The receipt SHOULD include:

- what Scout did
- who it acted as
- who it targeted
- any default assumption Scout applied
- the tracking handle when applicable

Examples:

- "Told `@hudson.main.mini` from `@openscout-codex`."
- "Asked `@vox.main.mini` from `@openscout-codex`."
- "Handed this to `@vox.main.mini` as work item `wrk-123`. Assumed the local
  main instance."

### 7. Follow-Through

Scout SHOULD keep responsibility after the initial route.

For `ask`:

1. wait for answer or decline
2. return the answer to the originating session
3. if durable work is uncovered, spawn a linked work item

For `handoff`:

1. owner moves to `working`
2. if blocked, owner moves to `waiting` and names the dependency
3. Scout nudges only the `nextMoveOwnerId`
4. owner moves to `review`
5. requester accepts or reopens

This should reuse the semantics already described in
[`collaboration-workflows-v1.md`](../collaboration-workflows-v1.md) rather than
inventing a second state model.

## Failure Taxonomy

The concierge workflow SHOULD classify failures explicitly.

### Broker unavailable

Meaning:

- the local source of truth cannot be reached

Behavior:

- report broker unavailability directly
- do not attempt target diagnosis until broker health is restored

### Sender unavailable or unstable

Meaning:

- Scout cannot determine a safe sender identity or return path

Behavior:

- try to create or restore a sender binding automatically
- if that fails, ask the user only for the missing binding decision

### Target unknown

Meaning:

- no configured or live candidate matches the requested logical target

Behavior:

- say that no such target is known
- do not suggest arbitrary similarly named agents unless explicitly in a
  "did you mean" flow

### Target offline

Meaning:

- a configured or previously known target exists but no suitable live endpoint
  is active

Behavior:

- offer or automatically perform resume/start when safe
- report that choice in the receipt

### Target ambiguous

Meaning:

- multiple plausible candidates remain after deterministic ranking

Behavior:

- choose the strongest default only if the ambiguity is low-risk
- otherwise ask one concise clarifying question

### Unsafe action

Meaning:

- the requested action is destructive, costly, or crosses an authority boundary

Behavior:

- require explicit confirmation or clarification

## Example Golden Paths

### Example 1: Returning after a few days

The operator is in a Claude Code or Codex session inside
`/Users/arach/dev/openscout` and says:

> "Use Scout to ask `@vox` whether the broker/session bug is already handled."

Scout should:

1. verify the broker is healthy
2. ensure this coding session has a stable sender binding
3. resolve `@vox` by preferring the current repo scope, local node, and default
   branch
4. create the question record
5. route it
6. reply with a receipt such as:

> Asked `@vox.main.mini` from `@openscout-codex`. Assumed the local main
> instance because no branch was specified.

### Example 2: Ambiguity that does not matter much

Candidates:

- `@vox.main.mini`
- `@vox.feat-live-sessions.mini`

The request is a simple question and the system default branch is `main`.

Scout should use `@vox.main.mini`, disclose the assumption, and continue.

### Example 3: Ambiguity that does matter

Candidates:

- local `@vox.main.mini`
- remote `@vox.main.laptop`

The user asks to hand off execution work with likely file changes.

Scout should ask:

> I found a local and a remote `@vox`. Which one should own this work?

It should not silently cross the machine boundary.

## Implementation Shape

SCO-012 does not require one monolithic feature landing, but it does require
one coherent center of gravity.

### 1. Centralize concierge preflight in broker-facing services

The act-or-ask logic SHOULD live in broker-facing service code, not in each
surface and not in per-harness prompts.

The CLI, desktop, mobile, and skill-driven flows should call the same
resolution and preflight logic.

### 2. Unify sender identity resolution

The system SHOULD replace split identity defaults with one sender-binding
resolution path that all collaboration verbs share.

In practice that likely means:

- one sender identity resolver
- one return-address binding model
- one explanation surface for "who am I acting as right now?"
- one clear distinction between creating a dedicated reply thread and creating
  a new sender identity

### 3. Add a first-class handoff path

The collaboration surface SHOULD support durable handoff as a named path instead
of overloading `ask` for long-running delegated work.

This can be introduced incrementally as long as durable work semantics remain
broker-owned and compatible with the existing work-item model.

### 4. Persist routing provenance

Receipts and recovery both benefit from storing why Scout chose a target.

Useful provenance includes:

- sender binding used
- ranked candidates considered
- deterministic defaults applied
- whether the action was `high`, `medium`, or `low` confidence
- whether clarification was skipped due to a safe default

### 5. Reuse sweeper semantics

Follow-through should reuse the existing `nextMoveOwnerId`-based sweeper model
instead of adding a second reminder system.

## Testing And Verification

SCO-012 needs behavior tests more than syntax tests.

Required coverage:

- broker-down preflight reports broker failure directly
- sender binding is stable across ask and send paths
- local repo candidate outranks unrelated live candidates
- `main` or `master` outranks feature branches when no branch is specified
- remote mesh targets do not silently outrank equivalent local targets
- medium-confidence routing discloses assumptions in the receipt
- low-confidence routing asks exactly one concise clarifying question
- `ask` returns an answer to the originating session
- `handoff` creates durable work with `nextMoveOwnerId`
- stale work nudges only the current responsibility holder

Useful test forms:

- pure unit tests for ranking and confidence thresholds
- broker integration tests for sender binding and receipt generation
- end-to-end tests for "intent once" flows from CLI and Ask Scout surfaces
- regression tests covering split-identity failure cases

## Risks

- If default ranking is too aggressive, Scout will feel helpful at first and
  wrong in subtle ways later.
- If default ranking is too timid, Scout will keep punting ambiguity back to the
  operator and fail the concierge promise.
- If sender identity remains split by verb or surface, follow-through will
  continue to feel unreliable.
- If surfaces reimplement confidence logic independently, behavior drift will
  quickly reappear.
- If durable handoff is kept implicit inside `ask`, ownership semantics will
  remain blurry.

## Open Questions

- Should `handoff` be a new CLI verb, or an intent classification layered over
  existing `ask` and future UI affordances?
- How much of the candidate ranking provenance should be user-visible by
  default, and how much should stay in debug surfaces?
- Should the broker learn from accepted clarifications and promote them into
  future default routing preferences?

## Practical Next Step

Unify sender binding and target preflight first.

That fixes the most destabilizing part of the current experience:

- who Scout is acting as
- how Scout decides the obvious target
- when Scout should route versus ask

Once those are centralized, the higher-level concierge UX becomes credible
across CLI, desktop, mobile, and skill-driven flows.
