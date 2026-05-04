# Operator Attention And Unblock

OpenScout should treat "needs the human" as a first-class product state, not as a side effect of whichever harness happened to print the prompt.

This doc records the current posture and the next implementation steps for approvals, questions, waiting states, permission prompts, and notifications.

## Principle

Scout can only own data that enters Scout. Session events, broker messages, collaboration records, and Scout-created invocation state are first-party data. Native harness prompts that happen above Scout, such as an MCP client asking whether to allow a tool call, are not visible until the host forwards them or exposes a hook.

The operator-attention model should make that boundary explicit:

- Project attention from first-party session state when Scout already sees the event.
- Ingest host-level permission prompts through a host integration, not by pretending the MCP server can see a request that the host intercepted before the server was called.
- Record durable broker unblock requests for anything that can outlive a single session frame.
- Route notifications from the broker/session attention model, with dedupe and clear ownership.

## Alertable Events

Session attention already covers:

- `approval`: an action block is awaiting approval and can be approved or denied.
- `question`: an agent question is awaiting an answer.
- `failed_action`: a recent action failed.
- `failed_turn`: a recent turn failed.
- `session_error`: the session itself is in error.
- `native_attention`: adapter/provider metadata says the native harness needs input.

Broker and collaboration attention should cover:

- `question.open`: an answer is owed.
- `question.answered`: the asker needs to close or reopen.
- `work_item.waiting`: a named dependency or actor owns the next move.
- `work_item.review`: a reviewer owes accept/reopen feedback.
- `flight.failed` / `flight.cancelled`: an ask did not complete.
- `flight.completed`: notify only when the caller requested callback semantics.

Host-level unblock attention still needs explicit ingress:

- Codex approval prompts raised by the Codex host.
- Claude permission hook requests.
- MCP client pre-tool permission prompts.
- Local system permissions needed by Scout itself, such as notifications or APNs setup.

## Current Coverage

Implemented now:

- Runtime session attention projection exists in `packages/runtime/src/session-attention.ts`.
- Mobile bridge inbox now uses session attention instead of approvals only.
- Bridge websocket now emits `operator:notify` for any projected session attention item.
- APNs alert routing now sends inbox alerts for any projected item.
- iOS Inbox can decode and display approvals, questions, failures, session errors, and native attention.
- Approval actions remain approve/deny.
- Non-approval attention items provide `Open Session` and local `Dismiss`, following the no-dead-end UI rule in `docs/eng/no-dead-end-ui.md`.
- The iOS tRPC route map includes `question/answer`, so timeline question blocks can use the existing answer-question bridge path.
- Scout MCP `invocations_ask` supports `replyMode: "notify"` and emits `notifications/scout/reply`.

Not done yet:

- Answering `question` items from the iOS Inbox.
- A broker-owned durable `unblock_request` record.
- Host-level capture for Codex/Claude/MCP permission prompts.
- Desktop/web notification sinks for operator attention.
- Cross-device read/dismiss/decision synchronization beyond the current inbox item refresh. Current non-approval dismiss is intentionally local-only.

## Proposed Model

Add a broker-owned unblock record for anything that needs a human action and may outlive a single websocket frame.

Fields:

- `id`
- `source`: `session`, `broker`, `host`, or `system`
- `kind`: `approval`, `question`, `permission`, `waiting`, `review`, `failure`, or `setup`
- `status`: `open`, `notified`, `resolved`, `denied`, `expired`, or `dismissed`
- `ownerId`: usually `operator`
- `sourceRef`: session/turn/block, flight, work item, or host request ids
- `title`, `summary`, `detail`
- `risk`
- `actions`: typed action affordances such as approve, deny, answer, open, retry, or dismiss
- `createdAt`, `updatedAt`, `resolvedAt`

The session inbox can continue projecting lightweight items, but durable host and broker waits should be represented by this record so a reconnect, another device, or a later agent can reason about what is still open.

## Implementation Path

1. Keep session attention as the fast path for first-party pairing events.
2. Add a broker attention/unblock projection from collaboration records and flights.
3. Add host ingress for permission prompts:
   - Codex: surface host approval requests into Scout as unblock records.
   - Claude: ingest permission hook files/events into the broker instead of leaving them as a side-channel.
   - MCP: document that server-side tools cannot see client-side approval prompts unless the host forwards them.
4. Route all unblock records through a notification router:
   - `interrupt`: approval, question, host permission, failure.
   - `badge`: requested completion callbacks, review-needed, waiting states.
   - `silent`: ordinary progress/status.
5. Add action handling:
   - approvals call existing `actionDecide`.
   - questions call existing answer-question plumbing, with Inbox needing structured options before it can answer in-place.
   - host permissions call host-specific grant/deny callbacks.
   - work/review items call collaboration update APIs.
6. Add stale sweeps for `waiting`, `review`, and unresolved host permissions.
