# SCO-072: Harness-Native Session Addressing

## Status

Proposed.

## Proposal ID

`sco-072`

## Date

2026-06-23

## Intent

Let agents address one exact peer session by either a Scout-owned session alias
or the native session id minted by the target harness, such as a Codex session
id, Claude thread id, or future harness conversation id.

The broker remains the routing authority, but it does not have to be the id
issuer. A session id is routable when the broker can resolve it to one reachable
session endpoint with enough scope to make the route exact.

## Problem

Scout already separates "start fresh work for this project" from "continue this
exact session." Current docs and protocol support `targetSessionId` /
`session:<id>` for exact continuation, and project or agent routing for fresh
work.

The gap is address provenance. In real agent-to-agent work, the most obvious
handle may be the native session id that the harness already returned:

- Codex may expose a session id.
- Claude may expose a thread or conversation id.
- Another harness may expose its own provider-native id.

Forcing every sender to first translate that handle into a broker-minted id
adds unnecessary ceremony and makes handoffs more brittle. At the same time,
raw native ids cannot be treated as global identity: they may only be unique
inside one harness, machine, project, account, or adapter.

## Decision

Scout should treat session addressing as **broker-known**, not necessarily
**broker-issued**.

A session route target may be backed by:

- a broker endpoint id
- a broker session id
- a harness-native session id
- a harness-native thread or conversation id
- an alias registered by session intake or an adapter

Internally, exact-session routing should normalize these into a structured
selector:

```ts
type SessionRouteSelector = {
  kind: "session";
  handle?: string;
  scoutSessionId?: string;
  endpointId?: string;
  harness?: AgentHarness;
  nativeSessionId?: string;
  nativeThreadId?: string;
  projectPath?: string;
  nodeId?: string;
  ownerAgentId?: string;
};
```

User-facing shorthand can stay compact:

- `session:<id>` - exact session handle, resolved through all known session
  aliases
- `session:codex:<native-id>` - exact Codex-native session id when the harness
  qualifier is needed
- `sid:<id>` - existing composer alias for `session:<id>`

Structured APIs should prefer explicit fields when available:

```ts
ask({
  projectPath: "/Users/arach/dev/openscout",
  execution: {
    session: "existing",
    targetSessionId: "session-or-native-id",
    harness: "codex",
  },
  body: "Continue the implementation in that exact context.",
});
```

If a native id contains delimiters or needs additional scope, callers should use
structured fields instead of relying on the shorthand string grammar.

## Routing Rules

1. `session:<id>` and `targetSessionId` mean exact continuation. They must not
   silently downgrade to project or agent routing.
2. The broker resolves the selector through a session alias index built from
   endpoint ids, broker session ids, `sessionId`, `externalSessionId`, native
   thread ids, and adapter-provided aliases.
3. A selector that matches exactly one reachable endpoint routes to that
   endpoint.
4. A selector that matches multiple endpoints fails with an ambiguity diagnostic
   that names the missing qualifiers, such as `harness`, `nodeId`,
   `projectPath`, or owner.
5. A selector that matches only stale or unreachable endpoints fails with a
   reachability diagnostic. It should suggest fresh project routing only as a
   separate action, not as an implicit fallback.
6. A selector that has no known match fails with an unknown-session diagnostic.
   The sender can then retry with a project route, a harness qualifier, or a
   newer handle.
7. Message body text remains payload. Body mentions of ids do not route unless a
   composer or client has converted them into structured routing metadata before
   the broker call.

## Work Target Vs Return Target

An ask still has two independent session routes:

- **Work target:** where the requested work should run. Use
  `execution.targetSessionId` or the structured session selector.
- **Return target:** where the answer should land. Use `replyToSessionId` or the
  requester return-address metadata.

Both routes may use broker-issued or harness-native ids, but they resolve
independently. A Codex-native id can be the work target while the reply returns
to the sender's own current session.

## Relationship To Existing Docs

This proposal refines, rather than replaces, the existing session model:

- [`docs/runtime-sessions.md`](../runtime-sessions.md) already defines
  `targetSessionId` as exact continuation.
- [`docs/agent-identity.md`](../agent-identity.md) already says session details
  are instance constraints layered onto a base agent identity.
- [`SCO-049`](./sco-049-session-forking-and-excellent-session-states.md)
  defines `existing` as exact continuation and keeps `fork` separate.
- [`SCO-070`](./sco-070-scout-initiated-cardless-sessions.md) treats endpoint
  ids and harness session ids as aliases. This proposal makes that alias model
  explicit for agent-to-agent addressing.

The key wording change is: the broker owns resolution and diagnostics, not
necessarily id minting.

## Non-Goals

- Do not make a harness-native session id a durable agent identity.
- Do not bulk-import harness transcripts into Scout-owned messages.
- Do not infer routes from message body text.
- Do not guarantee that raw native ids are globally unique without scope.
- Do not use native ids as a fallback candidate pool for normal project or card
  routing.
- Do not define cross-harness replay or fork semantics here.

## Implementation Plan

1. Add a protocol-level structured session route selector while preserving the
   existing `targetSessionId` string path.
2. Build or formalize a session alias index in the broker endpoint resolver.
   Alias values should include endpoint id, broker session id, adapter
   `sessionId`, `externalSessionId`, native thread id, and adapter-provided
   metadata aliases.
3. Teach CLI, MCP, and composer surfaces to accept harness-qualified native
   session selectors without putting routing data in the message body.
4. Add ambiguity and reachability diagnostics that report the exact missing
   qualifiers and whether any matching endpoints are stale.
5. Keep project and card routing fresh-session by default. Exact session
   diagnostics should be consulted only when the caller names a session.
6. Document examples for agent-to-agent handoff:
   - continue `session:<id>`
   - continue `session:codex:<native-id>`
   - reply to the caller's current native session id

## Acceptance Criteria

- A Codex-native session id observed by the broker can be used as an exact work
  target without first translating it to a broker-minted id.
- `session:<id>` and structured `targetSessionId` routes fail closed when the
  target is unknown, stale, unreachable, or ambiguous.
- Ambiguity diagnostics name the additional qualifiers needed to make the route
  exact.
- Project-routed asks continue to create or choose compatible workers without
  being forced through historical session candidates.
- Tests cover broker-issued ids, harness-native ids, harness-qualified native
  ids, ambiguous native ids, stale matches, and unknown ids.
