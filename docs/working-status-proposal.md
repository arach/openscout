# Proposal: Remove Durable "Working" Messages From Conversation History

## Problem

Relay currently turns in-flight execution state into a real conversation
message.

When an invocation starts running, the runtime creates a flight summary like:

- `Arc is working.`

That summary is then posted as a durable `MessageRecord` in the conversation.
From there, desktop and mobile conversation builders ingest it like any other
message unless they add special-case filtering later.

The result is the wrong data model:

- transient execution state becomes durable chat history
- conversation UIs need ad hoc suppression logic
- some surfaces still show the status as a solid turn item
- "working" leaks into the product narrative instead of staying as metadata

## Root Cause

The root cause is not just rendering. It is storage and message modeling.

Today the runtime does all of the following:

1. Persists a running `FlightRecord`
2. Generates a summary like `AgentName is working.`
3. Posts that summary into the conversation as a durable status message

That means the system mixes two different planes:

- conversation plane: durable user/agent communication
- execution plane: transient invocation and flight state

## Proposal

### Decision

`working` should live only on the execution plane.

It should not be emitted as a durable conversation message.

## New Model

### Conversation Plane

Keep only durable communicative content:

- operator messages
- agent replies
- durable system notices when they are actually user-relevant
- terminal failure notices when no agent reply will arrive

### Execution Plane

Keep transient operational state here:

- invocation opened
- flight running
- agent awake / queued / waking
- streaming / active task summary
- receipt state derived from flight progress

## Runtime Change

In the runtime broker:

- keep `persistFlight(runningFlight)`
- stop posting a conversation status message for the running state

In practice, this means the running-flight case should no longer create a
durable `MessageRecord` with a body like `AgentName is working.`

Terminal states may still produce user-visible durable notices when needed:

- failed
- timed out
- unrunnable

Successful execution should resolve to the actual agent reply, not an
intermediate durable status message.

## UI Change

UI surfaces should derive "working" from flights and activity, not from status
messages in the conversation.

### Desktop

Use flight state for:

- direct-thread receipts
- active task indicators
- waiting/reconciliation views
- relay thread "seen / working" affordances

The desktop shell already has most of the needed ingredients:

- `FlightRecord`
- target agent identity
- active endpoint state
- reply-to linkage

### Mobile

Mobile is already closer to the right model:

- message history is message-backed
- active working state can be projected separately from `activeFlight`

That pattern should become the standard instead of relying on broker-emitted
working messages.

## Activity Indexing

We should keep `working` visible in activity projections, but as activity, not
conversation.

That means:

- `ask_working` remains valid in `activity_items`
- `flight_updated` remains valid
- the activity feed can still show transient work state
- conversation history stays clean

This preserves operational observability without polluting the turn transcript.

## Why This Is Better

- fixes the root cause instead of adding more UI filters
- keeps chat history durable and legible
- makes turn rendering simpler and more predictable
- avoids cross-surface drift where some clients hide the noise and others do not
- preserves receipts and activity through the proper data model

## Migration / Rollout

1. Stop emitting running-state durable status messages from the broker.
2. Update desktop receipt and working-state logic to derive from flights.
3. Leave failure status messages durable where appropriate.
4. Keep existing client-side noise filters temporarily as defensive cleanup.
5. Optionally backfill or ignore historical `is working` records rather than
   trying to rewrite stored history.

## Non-Goals

- rewriting old stored messages
- removing all status messages from the system
- changing successful agent reply semantics

## Summary

The clean fix is to stop modeling `working` as a message.

`working` is execution state, not conversation content.

Once we keep it on the flight/activity plane, the conversation timeline becomes
clean by construction rather than depending on scattered suppression rules.
