# SCO-091 Ephemeral Topic Rendezvous

Status: implemented
Owner: OpenScout
Created: 2026-07-23

## Summary

Add a broker-owned rendezvous primitive that lets two live Scout participants
find each other by independently entering the same human-friendly phrase:

```bash
scout match "review the parser"
```

The CLI resolves the caller's current project and Scout sender identity, submits
both as structured fields, and waits briefly. When another participant submits
the same normalized topic in the same project scope, the broker returns one
ephemeral match to both callers. Neither caller needs to know an agent alias,
session id, channel, room name, or the other caller's identity.

This is a short-lived routing handshake, not a conversation. It does not import
or persist harness transcripts and it does not create a durable room lifecycle.

## Product Decisions

### Default scope

- The default scope is the nearest Scout project root resolved by the CLI.
- The broker matches only requests with the same canonical project root and
  normalized topic.
- A caller outside a project must pass `--project <path>` explicitly. There is
  no machine-global implicit scope.
- The initial implementation is local-broker only. Mesh-wide matching is a
  later extension that requires an explicit authority and trust design.

### Topic semantics

- A topic is a rendezvous phrase, not an address or durable room name.
- Topics are Unicode NFKC-normalized, trimmed, whitespace-collapsed, and
  case-folded for matching.
- The original display spelling is returned to participants.
- Topics must be 1–120 Unicode code points after trimming.
- Topic text is held only in broker memory and must not be written to the broker
  journal, SQLite projections, logs, analytics, or mesh bundles.

### Pair-only collision policy

The first version deliberately supports exactly two participants per match.

- The first distinct participant waits.
- The second distinct participant creates the match and releases both waiters.
- Repeating the command from the same participant is idempotent and refreshes
  that participant's presence or existing match.
- A third distinct participant receives `topic_busy`, the exact number of
  participants already matched, and guidance to choose a more specific topic.
- The broker never silently pairs the third participant with either member of
  the existing pair.

A future `--group` mode may opt into a bounded small-group match, but group
behavior must never be inferred from arrival timing.

## User Experience

Plain output:

```text
Waiting for another Scout participant on "review the parser" in openscout…
```

When the second participant arrives, both overlapping commands return:

```text
Matched with codex.parser in openscout.
Temporary handoff: match_…
```

If the first command's bounded wait ends before a peer arrives:

```text
Still waiting on "review the parser" in openscout. Presence expires in 15s; run the same command again to keep waiting.
```

If a pair already owns the topic:

```text
That topic already has a two-participant match in openscout. Use a more specific topic.
```

`--json` returns exact participant ids and timestamps for automation. Plain
output renders concise names but does not make those names routing authority.

## Lifecycle And Expiry

There are two ephemeral broker records:

1. `RendezvousPresence`: one participant waiting on a scoped topic.
2. `RendezvousMatch`: the resolved pair and opaque match id.

Default lifecycle:

| Record | Default TTL | Refresh |
| --- | ---: | --- |
| waiting presence | 45 seconds | same participant repeats `match` |
| completed match | 2 minutes | either matched participant repeats `match` |

- Expiry is inactivity-based and evaluated both by a broker timer and lazily on
  every rendezvous request.
- A broker restart clears all presences and matches. This is intentional:
  rendezvous state is ephemeral and no recovery promise is made.
- Waiters are bounded to 30 seconds per request. Request timeout does not
  immediately remove presence; the caller may rerun the same command during the
  remaining presence window.
- Expiry resolves any in-process waiters with `waiting` before discarding the
  presence.
- There is no close, leave, delete, or room-owner workflow.

## Data Model

Protocol request:

```ts
type ScoutRendezvousRequest = {
  topic: string;
  projectRoot: string;
  participantId: string;
  waitMs?: number;
};
```

Broker-owned in-memory records:

```ts
type ScoutRendezvousPresence = {
  participantId: string;
  joinedAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

type ScoutRendezvousMatch = {
  id: string;
  projectRoot: string;
  topic: string;
  normalizedTopic: string;
  participantIds: [string, string];
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};
```

Response is a discriminated union:

- `waiting`: presence accepted, with `expiresAt`
- `matched`: opaque `matchId`, exact `participantIds`, `peerParticipantIds`,
  `createdAt`, and `expiresAt`
- `topic_busy`: active participant count, active-match expiry, and a
  machine-readable suggestion to choose another topic

The internal lookup key is derived from the canonical project root and
normalized topic. It is not treated as a user-visible or durable identifier.
The opaque match id uses random entropy and cannot be used to join a match.

No SQLite migration is required for the first version. If persistence is added
later, it must use a separate TTL-governed store and must not turn the topic
into a durable conversation record.

## API

Add a broker endpoint:

```text
POST /v1/rendezvous/match
```

The body is `ScoutRendezvousRequest`; the response is
`ScoutRendezvousResponse`.

HTTP behavior:

- `200` for `waiting` and `matched`
- `409` for `topic_busy`
- `400` for malformed topic, participant, project, or wait bounds

The broker is the canonical writer. CLI, MCP, web, and native surfaces must call
this endpoint (or the same in-process broker service) rather than maintaining
parallel presence maps.

An MCP surface is intentionally deferred until the CLI contract is exercised.
When added, it should expose the same request/response semantics and should not
invent an MCP-only durable record.

## CLI

Add:

```text
scout match [--as <agent>] [--project <path>] [--wait <seconds>] <topic>
```

Behavior:

1. Resolve the current directory and nearest project root unless `--project`
   is provided.
2. Resolve the exact Scout sender id using the existing `--as`,
   `OPENSCOUT_AGENT`, and project identity rules.
3. Canonicalize the project path before submission.
4. POST structured intent to the broker.
5. Render `waiting`, `matched`, or `topic_busy`.

The command accepts one topic argument assembled from remaining positional
tokens, so quoting is recommended but not required. `--wait 0` performs a
non-blocking poll. The maximum wait is 30 seconds.

The match response preserves exact participant ids. Follow-on routing may use
those ids internally or display an exact `scout send --to <id>` handoff, but the
topic itself never becomes a durable route.

## Security And Scope

- Current posture remains high-trust local developer pilots; this feature does
  not claim hardened multi-tenant authorization.
- Project scope prevents accidental cross-project matches on common phrases.
- The broker rejects blank, oversized, control-character, and NUL-containing
  topics.
- Participant ids and project roots are explicit fields; body text is never
  parsed for routing.
- Topics are not logged or durably stored. Errors should report validation
  categories without echoing the full topic.
- Exact participant ids are returned only to members of the match. A third
  caller receives the participant count, not their identities.
- The local HTTP/unix-socket trust boundary is unchanged. A future remotely
  reachable/mesh endpoint must authenticate the participant and derive project
  scope from trusted broker metadata rather than accept both claims verbatim.
- Symlink and spelling variants are collapsed by CLI path canonicalization.
  Broker-side path normalization remains defense in depth.
- Rate limiting is not required for the local pilot, but the service caps one
  presence per participant per scoped topic and bounds topics, waiters, and
  timers. Remote exposure requires per-identity and per-project rate limits.

## Observability

The service may expose aggregate counts in broker health in a later patch.
Initial observability is intentionally minimal:

- no topic strings in logs
- validation errors name only the invalid field
- `--json` includes status and expiry timestamps
- unit tests use an injected clock and deterministic id factory

## Acceptance Criteria

1. Two distinct participants submitting the same normalized topic and canonical
   project root receive the same opaque match id and exact two-member set.
2. The first caller can remain in a bounded wait and is released when the second
   caller arrives.
3. Same topic in different project roots never matches.
4. Case, Unicode compatibility form, and repeated whitespace differences match.
5. Repeating a command from the same participant is idempotent and refreshes
   expiry without creating a self-match.
6. A third participant receives an explicit `topic_busy` result and no member
   identities.
7. Presence expires after inactivity; a later caller does not match stale
   presence.
8. Completed matches expire automatically and the topic becomes reusable.
9. Broker restart clears all rendezvous state without migration or recovery.
10. Invalid topics and out-of-range waits fail with actionable errors.
11. `scout match --json` exposes exact ids and timestamps; plain output stays
    concise.
12. No topic or match record is written to the durable journal, SQLite, external
    harness transcripts, or mesh forwarding.

## Verification Plan

Protocol:

- typecheck `packages/protocol`
- test normalization and request/response fixtures where runtime validation is
  introduced

Runtime:

- unit-test first waiter, second participant release, idempotent refresh,
  project isolation, normalization, third-participant collision, presence
  expiry, match expiry, bounded wait, and disposal
- HTTP-router tests for 200/409/400 behavior
- typecheck `packages/runtime`

CLI:

- parser tests for topic, `--as`, `--project`, `--wait`, and help
- command tests with a fake broker endpoint for all response variants
- help snapshot/content test includes `match`
- `bun run --cwd apps/desktop check`

Manual smoke test:

```bash
OPENSCOUT_AGENT=agent.one scout match "review parser"
OPENSCOUT_AGENT=agent.two scout match "review parser"
```

Run the commands concurrently from the same project. Confirm both report the
same match id, then run a third distinct identity and confirm it is rejected
without exposing the matched identities.

## Non-Goals

- Durable chat rooms or channels
- Transcript persistence or import
- Exactly-once or globally consistent mesh matching
- Automatic task assignment
- Arbitrary anonymous internet rendezvous
- Silent pair selection from three or more participants
- Formal close/leave ownership

## Rollout

Land the typed protocol, in-memory broker service, HTTP route, CLI command, and
tests together. Keep the endpoint local-only under current broker deployment
posture. Add web/native/MCP affordances only after the CLI behavior is validated
with real agent pairs.

## Implementation

Implemented in this checkout:

- protocol types, topic normalization, and broker route:
  `packages/protocol/src/rendezvous.ts`
- broker-owned in-memory lifecycle:
  `packages/runtime/src/broker-rendezvous-service.ts`
- HTTP boundary:
  `POST /v1/rendezvous/match`
- CLI:
  `scout match [--as <agent>] [--project <path>] [--wait <seconds>] <topic>`
- focused protocol, runtime, HTTP-router, route-inventory, CLI, and help tests

No migration, durable journal record, mesh forward, MCP tool, or external
message was added.
