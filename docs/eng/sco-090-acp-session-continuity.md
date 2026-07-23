# SCO-090: ACP Session Continuity and Process Ownership

## Status

- **Status:** Implemented and verified
- **Owner:** OpenScout
- **Date:** 2026-07-22
- **Scope:** Broker-routed Grok ACP and Kimi Code ACP sessions
- **Depends on:** [SCO-079 agent session / harness state machine](./sco-079-session-harness-state-machine.md)

## Decision

The broker owns one live ACP client process per resolved local endpoint. Repeated
invocations for that endpoint are serialized through the same client and ACP
session. If the process is detached or the broker restarts, the next invocation
starts a new binary and resumes or loads the exact provider-native ACP session.

The stable broker runtime session id and the provider-native ACP session id are
different identifiers and must never be substituted for one another.

## Problem

The ACP adapter already supported the correct cold-attachment behavior:

1. initialize and authenticate a new ACP process;
2. call `session/resume` when the agent advertises resume support;
3. otherwise call `session/load` when the agent advertises load support;
4. fail explicitly when neither operation can satisfy an exact-session request.

Broker-routed Grok and Kimi invocations bypassed that behavior. Each invocation
created a new `SessionRegistry`, placed the broker's runtime session id only on
the registry entry, called `session/new`, ran one prompt, and closed the process.
The provider-native session id returned by ACP was recorded in adapter metadata
but was not the id used for a later attach. A requester wait timeout also left a
one-off background process running until a fixed hard ceiling, which produced
the repeated 30-minute failures visible in Dispatch.

This was an ownership bug, not a missing ACP capability.

## Required invariants

1. A resolved endpoint owns at most one live ACP client process.
2. An attached ACP session accepts exactly one active turn; later turns queue.
3. A requester wait timeout does not cancel or close harness execution.
4. The provider id returned by `session/new` is persisted as
   `endpoint.metadata.externalSessionId`.
5. A cold attachment passes that provider id to `session/resume` or
   `session/load`.
6. The broker runtime session id remains the local registry/process identity.
7. If exact resume/load is unsupported or fails, the invocation fails
   explicitly. It must not call `session/new` and claim continuity.
8. Detaching/stopping an endpoint closes its live ACP client. An unexpected turn
   failure evicts the client so the next invocation performs a cold attachment.

## Runtime shape

```text
resolved endpoint id
        │
        ▼
ACP client pool ── one retained LocalAgentClient
        │                     │
        │ hot                 ├─ turn 1
        │                     ├─ turn 2 (queued)
        │                     └─ turn 3 (queued)
        │
        └─ cold attach
             new binary → initialize/authenticate
                        → session/resume | session/load(provider session id)
                        → next turn
```

`LocalAgentClient` remains the harness-level lifecycle primitive. The runtime
pool contributes broker ownership and requester-wait semantics; it does not
reimplement ACP framing or session capability negotiation.

## Identifier model

| Identifier | Owner | Purpose |
| --- | --- | --- |
| endpoint id | Broker | Keys the live ACP client owner after routing resolution |
| runtime session id | OpenScout runtime | Stable local `SessionRegistry` entry and process identity |
| provider ACP session id | Grok/Kimi ACP agent | Exact context used by `session/resume`, `session/load`, and prompts |

The local client API therefore accepts `sessionId` separately from `reuseKey`.
For ACP, `reuseKey` is only the provider-native id. A fresh endpoint omits it and
uses `session/new`; a detached existing endpoint supplies the persisted value.

## Timeout and failure semantics

The invocation's `timeoutMs` is a requester wait budget. Expiry returns
`RequesterWaitTimeoutError` while the queued/running ACP turn remains owned by
the retained client. The ACP execution itself keeps the existing 30-minute hard
ceiling.

Any eventual turn failure closes and evicts that client. The provider id already
persisted on the endpoint is retained. A later invocation may start a new binary
and attempt exact cold attachment. The failed prompt is not automatically
retried because ACP prompt execution has no broker-visible idempotency guarantee.

## Change surface

- `packages/agent-sessions/src/local/index.ts`
  - separates the local registry `sessionId` from the provider `reuseKey`;
- `packages/runtime/src/acp-agent-invocation.ts`
  - owns retained ACP clients, serialized execution, requester waits, eviction,
    and shutdown;
- `packages/runtime/src/local-agents.ts`
  - keys ACP clients by resolved endpoint, reads the persisted provider id for
    cold attachment, and closes the client when the endpoint is stopped;
- Grok and Kimi ACP invocation tests
  - cover hot reuse, timeout survival, unexpected process exit, Grok resume,
    and Kimi load.

No routing identity named `@kimi` is introduced. `kimi` remains a harness
constraint used to resolve or create a project-scoped sibling.

## Acceptance criteria

- [x] Two sequential invocations for one Grok endpoint emit one `initialize`,
  one `session/new`, and two `session/prompt` calls.
- [x] A requester timeout leaves the ACP client attached after the turn ends.
- [x] After explicit detachment, Grok starts a new process and emits
  `session/resume` with the provider id.
- [x] After explicit detachment, Kimi starts a new process and emits
  `session/load` with the provider id.
- [x] After an idle ACP subprocess exits unexpectedly, the next invocation
  starts a new process and performs an exact cold attachment.
- [x] Provider ids are returned through the existing endpoint persistence path.
- [x] Runtime and agent-session TypeScript checks pass.
- [x] The refreshed canonical local broker completes a live harness turn and an
  exact follow-up without creating an `@kimi` identity.

Live verification routed by project plus the `kimi` harness to the same
broker-owned session endpoint. The first invocation returned `ACP_HOT_ONE`; an
exact `session:<id>` follow-up returned `ACP_HOT_TWO` from that same endpoint.

## Rollout and observability

This is a local runtime behavior change with no wire-schema migration. Restarting
the broker clears only live process attachments; durable endpoint metadata keeps
the provider id needed for cold attachment. Dispatch should show one continuing
flight per request rather than detached one-off ACP processes reaching the hard
ceiling.

If a provider version does not advertise resume/load for an existing session,
the failure should remain visible and actionable. That is safer than silently
starting a context-free session.
