# SCO-080: Coding Task Workflow

## Status

In progress. The first lifecycle correction is implemented in the broker runtime:
a successful flight now moves requested work to `review` instead of silently
marking it `done`.

## Proposal ID

`sco-080`

## Intent

Ship one opinionated, end-to-end coding workflow using Scout's existing
coordination primitives. A request should be able to enter through a Scout or
externally bound conversation, run in a compatible coding harness, accept
steering, produce a reviewable change or pull request, and remain open until the
requester explicitly accepts it.

This is a workflow built on Scout. It is not a new coding harness and does not
introduce a `CodingTask`, `Run`, `Job`, or provider-specific thread record.

## Product Contract

An operator should be able to ask:

> Fix the login redirect, run the focused tests, and open a draft PR.

Scout should then make this story true and inspectable:

1. The request and its source thread are durably recorded.
2. One work item owns the requested outcome and names the next mover.
3. One invocation and flight track the current execution attempt.
4. The broker resolves or starts a compatible coding session.
5. Follow-up messages steer the active turn when supported, or queue durably for
   the next turn boundary when not supported.
6. Progress and dependencies update the same work item.
7. A produced branch, patch, or pull request is attached to the same conversation
   and referenced from the work item.
8. Successful execution moves requested work to `review`, not `done`.
9. The requester accepts the work or reopens it with feedback.
10. Failures and stale execution become explicit attention, never silent limbo.

## Existing Primitive Map

| Workflow concern | Scout primitive | Ownership |
| --- | --- | --- |
| Source thread or chat | `ConversationDefinition` + `ConversationBinding` | Broker |
| Human or agent request | `MessageRecord` | Broker |
| Desired coding outcome | `WorkItemRecord` | Broker |
| One attempt to perform work | `InvocationRequest` + projected `FlightRecord` | Broker |
| Concrete model context | runtime session | Harness, observed by Scout |
| Where execution happens | agent endpoint + permission profile + sandbox metadata | Harness/runtime |
| Mid-run correction | conversation message with steering intent | Broker, translated by adapter |
| Progress | `CollaborationProgress` + collaboration events | Broker |
| Human decision or permission | attention/unblock request | Broker or observed session state |
| Branch, patch, PR, logs | artifact-class message/attachment plus compact work metadata | Broker reference; external system owns payload |
| Completion callback | flight/work-item event delivery | Broker |

The workflow MUST NOT make an external Slack, Linear, or GitHub thread the
canonical Scout identity. Provider threads bind to Scout conversations. The
binding may survive session replacement, harness changes, retries, and handoffs.

## State Machine

The work item is the durable outcome. Flights are attempts beneath it.

```text
open
  -> working
       -> waiting  -> working
       -> review   -> working   (reopened)
                   -> done      (accepted)
       -> cancelled
```

Flight-to-work projection is deterministic:

| Terminal flight | Work requires acceptance | Work transition | Next mover |
| --- | --- | --- | --- |
| `completed` | yes | `review`, acceptance `pending` | requester/reviewer |
| `completed` | no | `done` | none required |
| `failed` | either | `waiting` with an explicit retry decision | requester when present, otherwise owner |
| `cancelled` | either | `cancelled` | none required |

A flight completing means the execution attempt ended. It does not mean the
requested outcome was accepted.

### Review

Entering `review` MUST:

- preserve the work-item owner as the party responsible for the implementation;
- hand `nextMoveOwnerId` to `requestedById`;
- set `reviewRequestedAt`;
- append a `review_requested` event;
- retain compact output/progress and stable artifact references;
- leave `completedAt` unset.

Acceptance MUST be an explicit transition that sets `acceptanceState: accepted`
and `state: done` in one broker-owned operation. Reopening MUST set
`acceptanceState: reopened`, return the work to `working`, hand the next move to
the implementation owner, and create a new invocation linked to the same work
item and conversation.

## Attempt And Continuity Rules

- A work item may have many invocations and flights.
- `lastInvocationId` and `lastFlightId` are conveniences, not the full history.
- A retry creates a new invocation; it never rewinds a terminal flight.
- Follow-up by `workId`, `flightId`, `conversationId`, binding `ref`, or exact
  session handle. Do not infer continuity from message text.
- Session policy remains explicit: `new`, `reuse`, `existing`, or `fork`.
- Workspace reuse is an execution optimization. It does not change work-item or
  conversation identity.

## Steering Contract

Every coding endpoint should advertise whether it supports native mid-turn
steering.

| Capability | Broker behavior |
| --- | --- |
| Native steer | Record the message, deliver it to the active turn, record acknowledgement |
| Turn-boundary queue | Record the message, queue it durably, inject it before the next turn |
| Neither | Record the message and return an actionable unsupported receipt |

The UI must distinguish `delivered`, `queued_for_next_turn`, and `unsupported`.
Starting a second concurrent turn is not a fallback for steering.

## Artifact Contract

The first version does not need a new artifact table. A coding result can be
represented by an artifact-class `MessageRecord` with a `MessageAttachment` or
stable URL and compact metadata such as:

```ts
{
  artifactKind: "pull_request",
  provider: "github",
  repository: "owner/name",
  number: 123,
  url: "https://github.com/owner/name/pull/123",
  branch: "codex/fix-login-redirect",
  commit: "abc123"
}
```

Secrets, full logs, raw transcripts, and repository contents remain outside the
work item. Scout stores references and compact broker-owned summaries.

## Permission And Policy Boundary

The workflow may request high-risk operations, but the workflow itself does not
grant authority. Harness and host adapters must translate permission profiles
into enforceable capabilities.

Typed operations should eventually cover:

- push a branch;
- open or update a pull request;
- modify workflow files;
- access organization observability;
- deploy or merge.

Policy should be checked at the typed host, proxy, or provider boundary. Prompt
instructions and shell-command parsing are not sufficient enforcement.

## First Vertical Slice

The first slice intentionally uses the existing `ask`/delivery path:

1. Send an ask with `workItem` metadata and default acceptance `pending`.
2. Let the broker create the conversation, message, work item, invocation, and
   flight using its existing durable write paths.
3. Project successful flight completion to work-item `review`.
4. Project flight failure to a valid `waiting` state with a named retry decision.
5. Keep acceptance/reopen as explicit work-item transitions.
6. Render the existing work/flight state before adding provider-specific ingress.

This slice proves the lifecycle locally with any supported harness. GitHub,
Slack, and Linear bindings are later ingress/egress adapters over the same
contract.

## Acceptance Tests

1. An ask with a requested work item creates one conversation, message, work
   item, invocation, and flight, all linked by stable ids.
2. A successful linked flight moves acceptance-required work to `review`, sets
   the requester as next mover, and does not set `completedAt`.
3. A successful linked flight moves `acceptanceState: none` work directly to
   `done`.
4. A failed linked flight produces a valid `waiting` item with `waitingOn` and a
   single next mover.
5. A duplicate delivery request does not create a second work item or `created`
   event.
6. Explicit acceptance atomically produces `accepted` + `done`.
7. Reopening returns the same work item to `working` and a subsequent attempt
   produces a new invocation/flight linked to it.
8. A steer never silently starts a concurrent turn.
9. A terminal or stale attempt always produces a broker-visible result and the
   requested callback/attention delivery.

## Next Slices

1. Add broker-owned accept/reopen commands instead of relying on paired raw
   record fields.
2. Finish the capability-aware steering receipt and durable next-turn queue.
3. Add the artifact message convention and show it on the work-item detail view.
4. Add an execution-workspace capability covering local worktrees and remote
   sandboxes without making either mandatory.
5. Add GitHub issue/PR conversation binding and source-channel completion.
6. Add CI/review monitoring as new attempts or progress on the same work item,
   not as a separate hidden workflow.

## Non-Goals

- replacing Codex, Claude Code, Pi, OpenCode, or another harness;
- introducing a general graph/workflow engine;
- making cloud execution mandatory;
- importing external harness transcripts as Scout messages;
- claiming exactly-once mesh delivery;
- automatically merging or deploying merely because an agent completed.
