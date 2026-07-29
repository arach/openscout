# Buzz channels, reactions, and read state

## Status

Research complete · 2026-07-29. Source review against `block/buzz` main at
`324bd6b464de5751e12abbd155376046ce3d2afc`, followed by an independent Scout
review. This is comparative architecture guidance, not an implementation spec.

## Intent

Explain how Buzz actually models channels and the state around them, separate
the reusable ideas from the Nostr transport, and record what OpenScout should
borrow without weakening explicit routing or typed execution lifecycles.

## Executive conclusion

Buzz and OpenScout start from different primary objects:

- **Buzz** starts with a shared workspace and signed event log. A channel is
  the place where human conversation, agent participation, workflow activity,
  and project evidence accumulate.
- **OpenScout** starts with a broker-owned coordination graph. A conversation
  carries communication, while invocations, flights, deliveries, sessions,
  work items, and bindings remain independently typed records.

OpenScout's model is the stronger base for agent coordination. Buzz's most
transferable ideas are not its channel routing or Nostr envelope. They are its
careful handling of state adjacent to a message: target-derived reactions,
hierarchical read frontiers, query projections, and explicitly ephemeral
presence.

The useful lesson is a state-layering discipline:

1. durable facts;
2. rebuildable serving projections;
3. query-time synthesized views;
4. ephemeral live state;
5. client-local intent.

## Channel model

### Identity

Buzz channels use opaque UUIDs. The channel name is a human-facing label, not
the record identity, and duplicate names are legal. DMs are the principled
exception: a hash of their participant set acts as a natural key because the
participants define the conversation.

OpenScout should retain opaque canonical conversation IDs and explicit natural
keys. A typed name such as `huddle-v1` is a selector for a durable identity; it
must never become a second storage identity such as `channel.huddle-v1`.

### Types and access

Buzz defines four functional channel types:

| Type | Meaning |
|---|---|
| `stream` | Linear chat with nested replies |
| `forum` | Root posts with forum-style comments |
| `dm` | Direct conversation |
| `workflow` | Internal workflow execution channel |

Visibility is either `open` or `private`. The relay's base access check admits
non-members to open channels; private channels require membership. Membership
roles are owner, admin, member, guest, and bot. Bot is deliberately outside the
human role hierarchy and receives no inherited authority.

This is understandable for a team workspace. It is too coarse to replace
OpenScout's explicit routing and execution records. Being present in a room
must not itself mean that an agent owns work, should wake, or may execute a
particular tool flow.

### Threads and channel windows

Stream messages carry the channel UUID plus explicit root and parent event
references. Buzz materializes thread ancestry and counts in Postgres, then
offers a channel-window query that returns:

- top-level messages;
- relevant reactions;
- edits and deletions;
- thread summaries;
- an explicit pagination bound.

That is a good product-facing query shape. A client should be able to request a
complete timeline slice without making one auxiliary query per message.
OpenScout should borrow the complete response shape, but express it as typed API
data rather than relay-signed synthetic event kinds.

## Reactions

A Buzz reaction is a signed NIP-25 `kind:7` event targeting a message event.
The relay derives the channel from the target message and ignores any
client-supplied channel claim. An unknown target fails closed.

The serving projection enforces one active reaction per:

```text
(community, target message, actor, emoji)
```

Removing a reaction publishes a deletion targeting the reaction event. The
projection soft-deletes the row. A duplicate active add is an idempotent no-op;
a previously removed reaction can be reactivated.

This is worth borrowing almost directly as a typed Scout record:

```ts
interface MessageReaction {
  conversationId: ScoutId;
  messageId: ScoutId;
  actorId: ScoutId;
  key: string;
  createdAt: number;
  removedAt?: number;
}
```

Required semantics:

- derive `conversationId` from `messageId` at the broker boundary;
- reject an inconsistent caller claim;
- make add/remove idempotent;
- keep reactions out of message bodies;
- do not create an invocation or delivery lifecycle for a reaction;
- do not treat emoji meaning as a protocol command.

## Read state

Buzz's NIP-RS is explicitly **not a read-receipt protocol**. It does not expose
what another user has read and provides no `seen by` list.

Each client installation publishes an encrypted, self-addressed blob:

```json
{
  "v": 1,
  "client_id": "<device>",
  "contexts": {
    "<channel-id>": 100,
    "thread:<root-event-id>": 120,
    "msg:<event-id>": 130
  }
}
```

The relay stores ciphertext but cannot interpret the user's positions. Clients
merge every device slot by taking the maximum timestamp for each context. This
is a grow-only max-register CRDT.

### Hierarchical frontier

The effective frontier is inherited from the parent channel:

```text
effective(thread) = max(thread cursor, channel cursor)
effective(message) = max(message cursor, channel cursor[, thread cursor])
```

The write discipline is the important part:

- reading a thread advances only the thread context;
- reading a message advances only that message context;
- reading the channel advances through top-level messages, not newer thread
  replies;
- therefore opening one thread cannot silently mark the rest of the channel
  read.

### Mark unread

The monotonic merge rule cannot move a cursor backward. Buzz therefore keeps a
manually forced-unread channel flag in device-local storage. Message-level
forced unread is even more transient. This preserves convergence, but the user
intent is not fully synchronized.

OpenScout should keep two meanings separate:

1. **Read cursor** — monotonic broker-owned progress, based on broker sequence.
2. **Attention flag** — reversible, durable user intent: "put this back in my
   queue."

OpenScout already has `ConversationReadCursor.lastReadSeq`. That sequence should
become the semantic read boundary end-to-end; timestamps remain presentation
metadata and compatibility fallback, not the authority.

## Presence and typing

Buzz correctly treats presence and typing as ephemeral:

- presence heartbeats every 30 seconds with a 90-second Redis TTL;
- typing uses a five-second active window and a 60-second key TTL;
- neither enters durable event history, search, or audit.

Typing uses Redis pub/sub across relay nodes. Presence fan-out is currently
node-local, so it can be incomplete in a multi-node deployment.

OpenScout should borrow the state tier and expiry semantics, not the exact
implementation. A stale or disconnected actor must naturally disappear without
a durable cleanup write.

## Canonical versus derived state in Buzz

| Layer | Examples |
|---|---|
| Durable signed facts | messages, reactions, deletions, edits, encrypted read-state blobs |
| Serving projections | channels, memberships, reaction groups, thread metadata, search rows |
| Query-time views | thread summaries and channel-window bounds |
| Ephemeral state | presence and typing |
| Client-local intent | manually forced unread |

Buzz is not meaningfully a peer-to-peer consensus system. Its relay is the
canonical server and Postgres is the durable store. Nostr provides a signed
event envelope and an interoperability vocabulary; it does not remove the
broker or its authoritative projections.

## OpenScout decisions

### Worth borrowing

1. Derive adjunct-record scope from the target and fail closed when the target
   cannot be resolved.
2. Use idempotent per-actor/per-target reaction records.
3. Adopt hierarchical channel/thread/message read frontiers.
4. Use broker sequence, not author timestamps, for read progress.
5. Keep read state private by default; do not add social read receipts without
   an explicit product decision.
6. Model "needs attention" separately from historical read progress.
7. Return complete timeline windows with typed adjunct state.
8. Keep presence and typing ephemeral and TTL-governed.

### Reject

1. Nostr/NIP-29 as OpenScout's internal record substrate.
2. A generic event kind in place of typed lifecycle records.
3. Channel membership as invocation or tool authority.
4. Author timestamps as the durable read boundary.
5. Device-local mark-unread as the final cross-device model.
6. Human channel names as storage identifiers.
7. Relay-signed synthetic events where a typed query response is sufficient.

## Canonical channel repair and existing data

The July 29 routing defect created two records for the same named channel:

```text
CLI legacy record   channel.huddle-v1
canonical record    chn-ea824d37d55871349e2e527fd0da9ccf
```

The repair has two obligations.

### New writes

Every named-channel writer resolves the same natural key and mints the same
stable opaque ID. New CLI messages for `huddle-v1` therefore land in
`chn-ea824d37d55871349e2e527fd0da9ccf`.

### Existing records

Historical rows are not destructively rewritten. Read paths infer the natural
key of structural legacy IDs, group every equivalent record, and present the
canonical stable ID. A request for the canonical URL must aggregate:

- messages from both IDs;
- participants from both records;
- linked invocations and flights;
- unread counts and read-cursor state.

The URL remains:

```text
/messages/chn-ea824d37d55871349e2e527fd0da9ccf
```

But it must render the combined history, not the single message physically
stored under that ID. The legacy record remains a read-only compatibility
alias. This avoids a risky in-place data migration while restoring one logical
conversation immediately.

Physical compaction can be considered later as an offline maintenance tool,
after references from messages, invocations, flights, deliveries, read cursors,
and bindings can be rewritten atomically. It is not required for correctness of
the current repair.

## Sources

- [Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md)
- [Channel types, visibility, and roles](https://github.com/block/buzz/blob/main/crates/buzz-core/src/channel.rs)
- [Channel and membership persistence](https://github.com/block/buzz/blob/main/crates/buzz-db/src/channel.rs)
- [Reaction event builders](https://github.com/block/buzz/blob/main/desktop/src-tauri/src/events.rs)
- [Reaction projection](https://github.com/block/buzz/blob/main/crates/buzz-db/src/reaction.rs)
- [NIP-RS cross-device read state](https://github.com/block/buzz/blob/main/docs/nips/NIP-RS.md)
- [NIP-CW channel windows](https://github.com/block/buzz/blob/main/docs/nips/NIP-CW.md)
- [Buzz security model](https://github.com/block/buzz/blob/main/SECURITY.md)

## Review provenance

The independent Scout review ran under ref `ref:6-mfagw4`. It confirmed the
source model and sharpened three conclusions used here:

- Buzz is also broker-owned; Nostr does not argue against explicit routing.
- Scope derived from the target is the highest-value portable invariant.
- Retrograde "unread" is operator attention, not read history, and deserves a
  separate durable record in an agent-coordination product.
