# A2A And ACP Readiness

Status date: 2026-06-15.

OpenScout now has first-class A2A primitives for local high-trust pilots. It can
consume external A2A-style agent cards, present those agents as normal
OpenScout agents, invoke JSON-RPC A2A endpoints, and expose OpenScout-registered
agents through A2A discovery and task operations.

OpenScout should still not claim full A2A or ACP compliance. The remaining gaps
are named below so production messaging can be precise.

## Source Standards

- A2A current docs: <https://a2a-protocol.org/latest/specification/>
- A2A discovery: <https://a2a-protocol.org/latest/topics/agent-discovery/>
- Agent Client Protocol v1: <https://agentclientprotocol.com/protocol/v1/overview>
- BeeAI Agent Communication Protocol: <https://agentcommunicationprotocol.dev/introduction/welcome>

## A2A Readiness

| Area | Status | Notes |
| --- | --- | --- |
| Agent card consumption | Implemented for pilot use | External cards can register broker identities/endpoints and appear in app agent views. |
| Agent card serving | Implemented for pilot use | Broker serves `/.well-known/agent-card.json`, `/v1/a2a/agent-card.json`, and per-agent cards at `/v1/a2a/agents/:id/agent-card.json`. |
| JSON-RPC method names | Implemented with compatibility | Current v1 names such as `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`, and `GetExtendedAgentCard` are supported. Legacy slash names such as `message/send` are also accepted/emitted for frameworks that still use them. |
| Send message | Implemented for text tasks | A2A `SendMessage` maps to a normal Scout invocation and returns an A2A task backed by the Scout flight. Blocking mode waits for terminal or input-required state. |
| Get/list task | Implemented | `GetTask` and `ListTasks` project Scout flights into A2A tasks with status, history, metadata, and text artifacts. |
| Cancel task | Partial | Non-running tasks can be marked cancelled. Running harness work returns a not-cancellable error until runtime cancellation tokens exist end to end. |
| Text artifacts | Implemented | Scout flight output maps to A2A text artifacts. Rich file/data parts are typed but not fully persisted or rendered as first-class A2A artifacts yet. |
| Streaming | Gap | `SendStreamingMessage` and `SubscribeToTask` are recognized but return unsupported. Need SSE stream responses for task/status/artifact updates. |
| Push notifications | Gap | Push notification config methods are recognized but return unsupported. Need config storage, webhook delivery, retries, and auth handling. |
| Extended agent card | Basic | `GetExtendedAgentCard` returns the same card. Authenticated extended-card policy is not implemented yet. |
| Discovery cache/signature controls | Partial | Cards are served with no-cache. ETag/signature/canonicalization support is not implemented yet. |
| Security | Pilot-only | No A2A-specific authz/authn policy layer. Local HTTP is high-trust; production A2A deployments need HTTPS, auth, scope checks, and request auditing. |
| Conformance suite | Gap | Focused tests exist for card serving, send/get/list task, outbound v1/legacy method behavior, and mapping helpers. There is no formal A2A conformance suite yet. |

## ACP Readiness

"ACP" refers to two different things in current ecosystem usage.

Agent Client Protocol is the JSON-RPC client protocol used by coding-agent
hosts. OpenScout has a client adapter in
`packages/agent-sessions/src/adapters/acp.ts` that initializes, creates/loads
sessions, sends prompts, receives `session/update`, handles permission
requests, and exposes controlled file read/write hooks. That makes OpenScout an
ACP client adapter, not an ACP agent server.

BeeAI Agent Communication Protocol is a REST-based agent communication protocol
that is now described as part of the broader A2A direction. OpenScout does not
currently implement the BeeAI ACP REST server/client surface. Given the A2A
convergence, new interoperability work should prefer the A2A primitives unless a
specific partner requires BeeAI ACP.

## Honest PROD Claim

Use:

> OpenScout has A2A-ready primitives for high-trust local pilots: agent-card
> discovery, app visibility, JSON-RPC send/get/list/cancel task operations, and
> external A2A endpoint invocation. It also includes an Agent Client Protocol
> adapter for subprocess coding agents. Full A2A or ACP conformance is not yet
> claimed.

Do not use:

> OpenScout is fully A2A/ACP compliant.

## Path To A Compliance Claim

1. Implement A2A streaming over SSE for `SendStreamingMessage` and
   `SubscribeToTask`.
2. Add runtime cancellation tokens so active `CancelTask` requests can stop
   local and external work where the harness supports it.
3. Implement A2A push notification config CRUD plus webhook delivery, retry, and
   authentication.
4. Add authenticated extended-card policy, card cache validators, and optional
   signatures.
5. Add an A2A conformance test harness that runs against the broker HTTP
   surface and against external sample agents.
6. Decide whether OpenScout needs BeeAI ACP REST support or whether A2A is the
   only external agent communication protocol target.
7. Decide whether OpenScout should expose an Agent Client Protocol server in
   addition to its current ACP client adapter.
