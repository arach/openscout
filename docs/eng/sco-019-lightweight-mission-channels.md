# SCO-019: Lightweight Mission Channels

## Status

Proposed.

## Proposal ID

`sco-019`

## Intent

Define a lightweight protocol layer for agent-to-agent coordination in channels.

The goal is to make group coordination predictable without turning every channel
into a heavyweight project-management board.

A mission channel should answer four questions at all times:

- who is in the room?
- who is leading?
- who has the next move?
- what counts as a good resting point?

This proposal composes existing Scout primitives:

- `conversation` remains the room and transcript
- `message` remains a durable turn
- `delivery` remains the fan-out and acknowledgement layer
- `invocation` and `flight` remain executable asks
- `work_item` remains the durable ownership and completion record

It does not introduce a new workflow noun for v1. A mission is represented as a
small convention over a `work_item` linked to a channel.

## Problem

Scout channels currently behave too much like passive rooms. Creating a channel
or posting in a channel does not necessarily mean that intended agents were
invited, woken, notified, acknowledged, or assigned responsibility.

That creates a failure mode in agent-to-agent coordination:

1. A human or agent creates a channel with an implicit mission.
2. One agent posts updates.
3. Other expected agents are not participants or are not notified.
4. The transcript looks active, but no protocol state says who owns the next
   step.
5. The thread stalls without a crisp reason.

The recent `channel.vox-hudson-lattices` thread showed this shape clearly:

- the channel existed
- the actual participant list only included `operator` and `vox.main.mini`
- channel messages had no `mentions`, no `audience.notify`, and no deliveries
- Hudson work happened separately in a DM-backed work item
- Lattices was never brought into the channel-level loop

The root issue is not UI. The root issue is that group channels do not yet have
operational semantics.

## Decision

OpenScout SHOULD adopt **mission channels** as the default protocol shape for
agent-to-agent coordination outside DMs.

A mission channel is:

- a `conversation` with `kind: "channel"`
- one linked `work_item` that carries the mission control state
- explicit participants
- explicit delivery expectations for important turns
- one `leadActorId`
- one `nextMoveOwnerId`
- a small closure policy

The channel transcript may contain arbitrary human and agent chatter. Mission
state changes happen only through explicit protocol events or structured
updates. This is the key resilience rule: chatty operators can add context,
opinions, corrections, or side remarks without accidentally changing ownership
or closing the mission.

## V1 Representation

V1 SHOULD avoid a new top-level protocol type. Instead, use an ordinary
`work_item` linked to the channel.

```ts
{
  kind: "work_item",
  title: "Make Vox/Hudson/Lattices native app coordination work",
  conversationId: "channel.vox-hudson-lattices",
  ownerId: "hudson.main.mini",
  nextMoveOwnerId: "hudson.main.mini",
  state: "open",
  acceptanceState: "pending",
  requestedById: "operator",
  labels: ["mission-channel"],
  metadata: {
    missionChannel: true,
    leadActorId: "hudson.main.mini",
    participantIds: [
      "operator",
      "vox.main.mini",
      "hudson.main.mini",
      "lattices.codex-companion-cockpit-trackpad.mini"
    ],
    closePolicy: "originator",
    ackPolicy: "lead-and-next-move",
    goal: "Make Vox foreground app + menu-bar utility behavior a first-class Hudson pattern informed by Lattices."
  }
}
```

The metadata fields are intentionally small:

| Field | Meaning |
|---|---|
| `missionChannel` | Marks this work item as the active mission for a channel. |
| `leadActorId` | The actor responsible for steering the conversation. |
| `participantIds` | The intended participant set for mission-critical routing. |
| `closePolicy` | Who can call the mission done. |
| `ackPolicy` | Which participants must acknowledge key transitions. |
| `goal` | Short operator-readable mission goal. |

`ownerId` and `nextMoveOwnerId` keep their existing collaboration meaning. The
lead steers the room; the next move owner has the ball.

Those are allowed to differ.

Example:

- `leadActorId = "vox.main.mini"`
- `nextMoveOwnerId = "hudson.main.mini"`

This means Vox is running the room, but Hudson currently owes the next concrete
step.

## Mission States

V1 SHOULD reuse `WorkItemState`:

| State | Channel meaning |
|---|---|
| `open` | The mission exists, but active work may not have started. |
| `working` | Someone is actively moving the mission forward. |
| `waiting` | The mission is blocked on `nextMoveOwnerId` or `waitingOn`. |
| `review` | A resting point or completion has been proposed. |
| `done` | The mission is closed enough; new work should fork or reopen. |
| `cancelled` | The mission is intentionally abandoned. |

No extra state should be added until these prove insufficient.

## Closure Policy

V1 SHOULD support four close policies:

| Policy | Meaning | Default use |
|---|---|---|
| `originator` | The requester decides done. | Human-started coordination. |
| `lead` | The lead decides done. | Agent-run coordination. |
| `lead_or_originator` | Either may close. | Low-risk collaborative work. |
| `consensus` | Required participants must acknowledge review. | Higher-stakes decisions. |

The default SHOULD be `originator` for operator-started missions and `lead` for
agent-started missions.

`consensus` should be opt-in. Most coordination should not need it.

## Acknowledgement Policy

V1 SHOULD keep acknowledgement requirements narrow:

| Policy | Required acknowledgements |
|---|---|
| `none` | No explicit ack required. |
| `lead` | Lead must acknowledge kickoff and review. |
| `lead-and-next-move` | Lead and current `nextMoveOwnerId` must acknowledge. |
| `all-participants` | Every intended participant must acknowledge kickoff and review. |

The default SHOULD be `lead-and-next-move`.

This avoids the common failure where every participant is expected to respond to
everything. It also avoids the opposite failure where nobody knows whether the
responsible party saw the request.

Acknowledgements should be delivery-backed when possible:

- delivery `accepted` or `sent` means Scout attempted to route
- delivery `running` means the target claimed execution
- a message or collaboration event from the target can count as semantic ack
- missing ack should be visible as a mission health issue

## Message Semantics

Mission channels need a small vocabulary for important turns. Ordinary chat is
still allowed and should not mutate mission state.

V1 SHOULD recognize these turn intents:

| Intent | Effect |
|---|---|
| `note` | Adds context only. No ownership change. |
| `kickoff` | Creates or refreshes mission context and notifies required participants. |
| `ask` | Creates a question or invocation for one target. |
| `handoff` | Moves `nextMoveOwnerId` and records why. |
| `checkpoint` | Updates progress without changing owner. |
| `waiting` | Moves mission to `waiting` and names `waitingOn`. |
| `review` | Proposes a resting point or completion. |
| `close` | Applies the close policy and marks done when allowed. |
| `reopen` | Reopens a done/review mission with a new next move owner. |

Human free text defaults to `note` unless sent through a mission action UI or
explicit command. This is what keeps chatty humans from accidentally changing
state.

Agents should be encouraged to emit structured mission events for state changes
instead of relying on prose such as "I think this is done."

## Participant Semantics

Mission participants are not the same as every actor who has ever posted in the
channel.

`conversation.participantIds` is the durable room membership known to the
broker. `metadata.participantIds` on the mission work item is the expected
mission participant set.

For V1, when a mission is created, Scout SHOULD:

1. resolve intended participant labels deterministically
2. add resolved participants to the channel conversation
3. reject or ask about unresolved/ambiguous participants before kickoff
4. notify participants required by `ackPolicy`
5. include a receipt that lists who was included and who was not

Late joiners MAY post ordinary notes without becoming required participants.
They become required participants only through an explicit mission update.

## Lead Semantics

The lead is responsible for keeping the channel coherent, not necessarily doing
all work.

The lead SHOULD:

- summarize when the thread gets noisy
- choose or confirm the next move owner
- move the mission to `review` when there is a good resting point
- reopen if the thread drifts before closure
- keep the participant set honest

The lead MUST NOT silently close a mission when the close policy does not allow
it.

If the lead is unavailable, Scout SHOULD surface that as a mission health issue
and MAY ask the originator to appoint a new lead.

## Next Move Semantics

Every non-terminal mission MUST have a `nextMoveOwnerId`.

This field answers "who has the ball?"

Rules:

- only one actor owns the next move at a time
- handoff requires a short reason
- waiting requires `waitingOn`
- review sets `nextMoveOwnerId` to the actor allowed to accept or close
- done and cancelled clear the expectation of a next move

When the next move owner is an agent, Scout SHOULD prefer an invocation or
delivery mode that produces a durable receipt. A passive visible-only message is
not enough for mission-critical next moves.

## Human Chatter Resilience

Mission channels must tolerate high-volume human messages.

The rules are:

1. Ordinary messages are `note` turns.
2. Notes never mutate mission state.
3. State-changing turns must be explicit.
4. Prose can suggest state, but the broker should not treat it as state.
5. The lead may summarize noisy discussion into a checkpoint.
6. The current `nextMoveOwnerId` remains unchanged until an explicit handoff,
   waiting, review, close, or reopen event.

This preserves a normal conversational feel while keeping the control state
deterministic.

## Minimal Product Contract

Every mission channel should be able to render this compact status:

```txt
Mission: Make Vox foreground + menu bar behavior first-class in Hudson
Lead: Hudson
Next move: Hudson
State: working
Close policy: originator
Participants: Vox, Hudson, Lattices
Missing ack: Lattices kickoff
```

That status is enough for the operator and agents to know whether the channel is
healthy.

## Broker Responsibilities

The broker SHOULD own the canonical mission state.

For V1, broker-facing services SHOULD:

- create the mission work item when a mission channel is initiated
- upsert channel membership from resolved mission participants
- plan deliveries for kickoff, handoff, review, and close turns
- record ack state from deliveries, replies, or collaboration events
- expose mission health in snapshots or thread events
- reject state changes that violate close policy or ownership invariants

Surfaces may make this nicer, but they must not be the source of truth.

## Non-Goals

V1 does not attempt to solve:

- multi-lead governance
- arbitrary voting systems
- full meeting minutes
- automatic semantic parsing of every human message
- heavyweight project planning
- replacing DMs for one-to-one work
- forcing all channel posts to notify all participants

The point is predictable ownership, not ceremony.

## Implementation Sketch

1. Add mission metadata helpers around `CollaborationRecord`.
2. Add a broker helper to create a mission channel:
   - resolve participant labels
   - upsert channel conversation
   - create mission `work_item`
   - post kickoff message
   - plan required deliveries
3. Add mission state transition helpers:
   - `handoff`
   - `checkpoint`
   - `waiting`
   - `review`
   - `close`
   - `reopen`
4. Project mission health into thread snapshots.
5. Teach agents to prefer mission actions over prose for state changes.

The first useful slice can be entirely metadata-backed and should not require a
schema migration unless stricter querying becomes necessary.

## Invariants

1. A non-terminal mission has exactly one `leadActorId`.
2. A non-terminal mission has exactly one `nextMoveOwnerId`.
3. A state-changing turn must be explicit.
4. Ordinary chat does not mutate mission state.
5. Required participants are explicit, not inferred from channel history.
6. A mission cannot close unless its `closePolicy` is satisfied.
7. A mission-critical handoff must produce a durable delivery or invocation
   receipt.

## Open Questions

- Should the active mission be stored on `conversation.metadata.activeMissionId`
  or discovered by querying open `work_item` records for `conversationId`?
- Should mission ack state live in delivery metadata, collaboration event
  metadata, or a small projection table?
- Should a channel allow more than one active mission, or should follow-up work
  fork into child missions?
- Should `closePolicy: consensus` require all participants or only required
  participants named in a separate `requiredCloserIds` field?
- Should `leadActorId` eventually graduate from metadata into the core
  collaboration schema?

## Acceptance Criteria

This proposal is successful when:

1. Creating a mission channel with `@vox`, `@hudson`, and `@lattices` results
   in all three resolved agents being explicit mission participants.
2. Kickoff delivery creates receipts for participants required by `ackPolicy`.
3. The channel status can always answer lead, next move owner, state, close
   policy, and missing acknowledgements.
4. Ordinary human messages do not change mission state.
5. A handoff changes `nextMoveOwnerId` only through an explicit state-changing
   turn.
6. A review/close flow enforces `closePolicy`.
7. Missing or offline agents are surfaced as mission health issues rather than
   silently ignored.
