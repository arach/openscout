# Broker-owned message attribution

Status: product/architecture proposal · 2026-07-28

## Trigger

Agent-to-agent messages are too often attributed by asking the caller to pass
`--as <agent>` or `senderId`. That is both cumbersome and semantically weak: the
caller is being asked to assert the fact the broker should already know.

The current session demonstrates the ambiguity:

- Scout presents the worker as `openscout-pasteur`.
- The managed environment and `scout whoami` resolve the sender to the opaque
  actor `session-ms5bruhf-y7dsxa`.
- The broker reply context says the ask came from `Arach` and was delivered to
  that session.
- A new outbound message can therefore appear to come from the session id,
  from an inferred project agent, or from whatever the caller supplied through
  `--as` / `senderId`.

All of those values describe something real, but they describe different
things. One `actorId` plus a caller-controlled sender override cannot carry the
whole story.

## Decision

**Attribution is a broker-owned envelope, not a message parameter.**

Normal send, reply, and ask APIs should accept destination, payload, and
delivery intent. They should not ask an agent to name itself. The broker derives
the author from the invocation/reply context or the attached runtime session and
records how that conclusion was reached.

Keep four concepts separate:

1. **Author** — the stable actor the message speaks as: operator, agent/card,
   cardless session, or Scout system actor.
2. **Execution** — the concrete session/endpoint/harness that produced the
   message.
3. **Cause** — the ask, message, invocation, or human action that caused this
   message.
4. **Resolution** — the evidence Scout used to bind the execution to the
   author.

The friendly handle is presentation, not authority. `openscout-pasteur` may be
the current situated handle for a session, but a mutable alias must not replace
the durable author or session ids in the record.

## Protocol shape

Preserve `MessageRecord.actorId` as the canonical author for compatibility and
add a structured, immutable attribution envelope:

```ts
type MessageAuthorKind = "operator" | "agent" | "session" | "system";

type MessageAttributionMethod =
  | "broker_reply_context"
  | "managed_session_binding"
  | "attached_endpoint"
  | "operator_context"
  | "legacy_project_inference"
  | "explicit_override";

type MessageAttributionAssurance =
  | "broker_bound"
  | "locally_bound"
  | "inferred"
  | "caller_asserted";

interface MessageAttribution {
  author: {
    actorId: ScoutId;
    kind: MessageAuthorKind;
    agentId?: ScoutId;
    displayLabelAtSend?: string;
  };
  execution?: {
    sessionId: ScoutId;
    sessionActorId?: ScoutId;
    endpointId?: ScoutId;
    harness?: AgentHarness;
    model?: string;
    nodeId?: ScoutId;
  };
  cause?: {
    actorId?: ScoutId;
    messageId?: ScoutId;
    invocationId?: ScoutId;
    flightId?: ScoutId;
    workId?: ScoutId;
  };
  resolution: {
    method: MessageAttributionMethod;
    assurance: MessageAttributionAssurance;
    requestedActorId?: ScoutId;
  };
}
```

`displayLabelAtSend` is a historical presentation snapshot only. It is never
used for routing or authorization.

### Author selection

- A session attached to a durable agent/card authors as that agent. The
  concrete session remains visible under `execution`.
- A genuinely cardless worker authors as the session actor. Its situated target
  handle can be rendered as the friendly label.
- A human-started shell authors as the operator even when its CWD is inside a
  project. Project is context, not evidence that the human is speaking as the
  project agent.
- Broker-generated lifecycle/status messages author as the Scout system actor,
  with the triggering invocation/message in `cause`.

This makes the common display stable without erasing execution-level
traceability.

## Resolution ladder

The broker resolves attribution at its command boundary in this order:

1. **Broker reply context.** A broker-minted reply context binds the current
   runtime to the recipient of the original ask and supplies the causal ids.
2. **Managed session binding.** Resolve the current session id to the broker's
   session, endpoint, and agent records. Do not trust a raw agent-name string
   when the binding is available.
3. **Attached endpoint.** Use the endpoint/session attached to the client
   connection.
4. **Operator context.** A non-agent local client is the configured operator.
5. **Legacy inference.** During migration only, retain current directory/project
   inference and mark it `inferred`.
6. **Explicit override.** A compatibility/admin escape hatch is recorded as
   `caller_asserted`, including both the resolved and requested actors.

Resolution should return a structured object, not only a string:

```ts
resolveScoutAttribution(context): Promise<ResolvedMessageAttribution>
```

`resolveScoutSenderId()` can temporarily become a compatibility projection of
that result.

## API and CLI behavior

### MCP

- Remove `senderId` from the model-facing schemas for `ask`, `messages_send`,
  `messages_reply`, collaboration mutations, and operator signals.
- The MCP server supplies its host/session context out of band.
- Reply-context tools always use the broker-bound recipient identity; a model
  cannot accidentally answer as the original requester.
- Keep a privileged `onBehalfOf` operation only if a real orchestration use case
  requires it. It must require a reason and emit `explicit_override`
  provenance; it is not a convenience field on every tool.

### CLI

- Normal examples become `scout send --to …` and `scout ask --to …`, with no
  `--as` coaching.
- Deprecate `--as` as a normal collaboration option. During migration, accept it
  as an explicitly marked compatibility override and print the attribution
  method in JSON receipts.
- Agent-spawned shells receive an opaque broker context/session handle, not just
  `OPENSCOUT_AGENT=<caller-controlled string>`.
- `scout whoami --json` returns `author`, `execution`, `resolution`, and
  `projectContext`, so attribution can be inspected without guessing.

The opaque handle need not imply an enterprise authentication system. In the
current high-trust local-pilot posture it is enough that Scout derives identity
from its own session/endpoint records and reports the assurance honestly.

## Persistence and mesh

- Add `attribution` to `MessageRecord` and persist it atomically with the
  message. A one-to-one `message_attributions` table is preferable to burying
  queryable identity in generic metadata.
- Keep `messages.actor_id` and its existing index as the canonical-author fast
  path.
- Store session, agent, invocation, and source-message ids as nullable indexed
  columns in the attribution table where query volume justifies it.
- The conversation authority writes the canonical envelope. Mesh forwarding
  preserves it; receiving peers do not recompute or relabel it.
- Legacy messages remain readable with a synthesized
  `legacy_project_inference` / `caller_asserted` envelope and visibly lower
  assurance. Do not rewrite history as if Scout had stronger evidence.

## UI contract

Render the useful identity first and the provenance on demand:

```text
openscout-pasteur
via Codex · session ms5bruhf · replying to Arach
```

For a durable agent-backed session:

```text
Premotion
via Codex · session 019fab…
```

For an override:

```text
Premotion
caller-attributed · requested by operator
```

Rules:

- Never make an opaque session id the only visible speaker label when a
  situated or durable label exists.
- Never hide that a message was caller-attributed/inferred.
- Show the causal chain in message details and work/flight views, not as noisy
  chrome on every row.
- Use the same attribution formatter in web, macOS, and iOS.

## Implementation slices

### 1. Structured resolution, no behavior change

- Add protocol types and `resolveScoutAttribution()`.
- Project the legacy `actorId` from the result.
- Add table-driven tests for reply context, managed session, plain human shell,
  project fallback, and explicit override.
- Extend `whoami` and send/ask receipts with resolution details.

### 2. Broker-owned write boundary

- Thread client/session context into the broker delivery command.
- Have the broker create the canonical attribution envelope.
- Reject a conflicting caller-supplied actor when a broker-bound identity is
  available; do not silently let `--as` replace it.
- Populate `cause` from reply context and ask/invocation creation.

### 3. Remove sender selection from the happy path

- Remove `senderId` from model-facing MCP schemas.
- Stop documenting `--as` for ordinary sends/asks.
- Make human shells resolve to operator rather than project agent unless an
  actual session binding exists.
- Add a deliberately named/admin-only override path if still required.

### 4. Persist and present provenance

- Add the attribution table/migration and legacy synthesis.
- Ship the shared renderer and message-details disclosure.
- Verify mesh forwarding preserves the authority-written envelope byte for
  byte.

## Acceptance cases

1. Arach asks a cardless `openscout-pasteur` session a question. The reply is
   displayed as `openscout-pasteur`, records the exact session as author and
   execution, and links back to Arach's message/invocation. No `--as` appears.
2. A session attached to `Premotion` sends Hudson a DM. The message authors as
   Premotion and records the producing session separately.
3. A human runs `scout send` from inside the OpenScout repo. The author is the
   operator; the project is context only.
4. A caller passes the legacy `--as Premotion` from an unbound shell. The
   receipt and UI mark it caller-attributed rather than silently treating it as
   broker-bound truth.
5. A caller tries to override a broker-bound session as another agent. Scout
   rejects it with both identities in the diagnostic.
6. A message crosses the mesh. Every peer shows the same author, execution,
   cause, and assurance written by the conversation authority.

## Non-goals

- Full multi-tenant authentication, cryptographic non-repudiation, or enterprise
  audit compliance.
- Importing external Claude/Codex transcript turns as first-party Scout
  messages.
- Making aliases authoritative identities.
- Inferring authorship from message body mentions.

