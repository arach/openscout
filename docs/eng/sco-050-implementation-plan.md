# SCO-050: Implementation Plan — Stage 1 Cutover

## Status

Plan for stage 1 of [`sco-050`](./sco-050-scoutbot-as-fleet-agent.md). Stage 1
is the hard cutover: delete the runner, register scoutbot as a
`codex_app_server` endpoint, ship the deterministic prefilter, default-
thread behavior end-to-end. Stage 2 (thread switcher UI, sub-agent
dispatch + visibility, iOS + web surfaces) is a separate plan.

## Proposal ID

`sco-050` (this is the implementation plan companion).

## Stage 1 scope

In:

- Delete `packages/web/server/scoutbot-runner.ts`,
  `ScoutbotBrain` interface, `createRangerScoutbotBrain`, and the
  OpenAI-direct call path used only by scoutbot.
- Register scoutbot as a `codex_app_server` endpoint via the broker's
  existing adapter layer. No codex-specific code above the adapter seam.
- Implement the deterministic prefilter as a transport-agnostic module:
  slash commands, exact status regexes, read-only broker tool registry.
- Narrow scoutbot's tool grants to read-only over broker snapshots +
  structured `send_message` / `ask_agent` / `dispatch_subagent` /
  `cancel_flight`. No shell, no codebase writes.
- Provenance metadata on every broker write scoutbot emits.
- Persistent thread-map JSON; auto-created "default" thread; HUD passes
  `targetSessionId` per turn for the default thread; SSE filter matches
  by `conversationId` + `actorId == scoutbot`.

Out (deferred to stage 2):

- Thread switcher UI in HUD assistant view.
- `+` / `cmd+t` thread creation affordances.
- Multi-thread routing in HUDComposeService (stage 1 is single default
  thread only; stage 2 introduces the switcher).
- Sub-agent dispatch tool, sub-agent visibility in fleet view + tail
  firehose.
- iOS assistant tab thread switcher.
- Web channel view scoutbot threads.

## Split of work

**Codex (backend):**

- All TypeScript changes under `packages/web/server/` and
  `packages/runtime/` for scoutbot.
- Endpoint registration via the broker's existing adapter seam.
- Prefilter module + role config (system prompt + tool grants).
- Thread-map persistence + the runner shim.
- Provenance conventions in scoutbot's broker writes.
- Backend smoke tests (HTTP-level: send → broker → scoutbot reply).

**Claude (frontend + orchestration):**

- All Swift changes under `apps/macos/Sources/HUD/` and
  `apps/macos/Sources/Services/` for scoutbot.
- `HudComposeService` threading hooks (active thread + per-thread SSE
  routing).
- Default thread name visible in the assistant view header.
- Static "default" thread chip in the compose dock target row.
- This implementation plan, the dispatch to Codex, the integrate-and-
  verify step at the cutover, and the cutover smoke test.

## Backend ↔ frontend contract

The contract is intentionally small: two HTTP endpoints + one event
shape. Everything else lives entirely within one side.

### `GET /api/scoutbot/threads`

Returns the list of scoutbot threads visible to the operator.

```jsonc
{
  "threads": [
    {
      "threadId": "thr-default",
      "name": "default",
      "conversationId": "dm.operator.scoutbot.default",
      "transportSessionId": "codex-session-<id>",
      "transport": "codex_app_server",
      "pins": null,
      "lastActiveAt": 1779900000000
    }
  ],
  "defaultThreadId": "thr-default"
}
```

Stage 1 always returns one row (the default). Stage 2 may return many.
The frontend treats the list as authoritative — it does not assume the
default thread exists; it asks. The backend creates the default on first
fetch if it isn't there.

### `POST /api/send` — extended

Existing endpoint. Adds an optional `threadId` field. Omitted → the
backend uses `defaultThreadId`.

```jsonc
{ "body": "hi scout", "threadId": "thr-default" }
```

The backend resolves `threadId → transportSessionId` and passes it as
`targetSessionId` on the broker ask. Provenance metadata is added by
the backend; the frontend does not need to know about it.

### `message.posted` event shape (already exists)

Same SSE event currently fired by the broker. The frontend uses the
existing `actorId == "scoutbot"` filter and adds a second filter on
`conversationId == activeThread.conversationId` to scope events to the
active thread's view.

The backend ensures scoutbot's posted messages carry the correct
`conversationId` for the thread they belong to. No new event kind.

## Backend slice (Codex) — file-by-file

### Files to delete

- `packages/web/server/scoutbot-runner.ts` — entirely.
- Any `ScoutbotBrain` interface definition file (was in
  `scoutbot-runner.ts` or a sibling).
- `createRangerScoutbotBrain` function — wherever it lives.
- The OpenAI-direct call path that's only used by scoutbot (the Ranger
  module's other consumers remain; scope this carefully).

### Files to add

- `packages/web/server/scoutbot/role.ts` — transport-agnostic role
  definition: system prompt (markdown), tool grants (read-only broker
  snapshots + the four structured write tools), default behavior
  config. Read by whatever transport adapter spawns scoutbot's session.
- `packages/web/server/scoutbot/prefilter.ts` — exports
  `prefilterHandle(prompt, brokerSnapshot) → Reply | null`. Pure
  function over current broker state. Returns `null` to fall through to
  the agent turn. Bundled rules:
  - Slash commands: `/help`, `/agents`, `/status`, `/recent @agent`,
    `/doing @agent`, `/flight <id>`.
  - Exact status regexes: "what is @x doing", "is @x blocked", "recent
    from @x", "what did @x say last", "who is online".
  - Read-only broker tools: `list_agents`, `list_endpoints`,
    `list_flights`, `latest_messages`, `current_turn`.
  - Each reply includes `{ matched_rule: "...", snapshot_at: <ms> }`.
- `packages/web/server/scoutbot/thread-map.ts` — JSON persistence at
  `~/Library/Application Support/OpenScout/scoutbot-threads.json` (or
  the platform equivalent via `resolveOpenScoutSupportPaths`). API:
  `getThreads()`, `getThread(threadId)`, `ensureDefaultThread()`,
  `createThread(name, opts)`, `archiveThread(threadId)`. Row shape per
  the contract above.
- `packages/web/server/scoutbot/runner.ts` — the thin runner shim. On
  boot:
  1. Ensures scoutbot is registered as an agent in the broker
     (defaultSelector `@scoutbot`, labels `["assistant","scout","scoutbot"]`).
  2. Ensures a `codex_app_server` endpoint row exists for scoutbot with
     cwd pinned to the openscout repo, role config injected.
  3. Ensures the default thread is created in the thread map.
  4. Subscribes to broker control events. For each addressed
     `message.posted` for scoutbot's conversation:
     - Runs the prefilter; if it matches, posts the prefilter reply
       directly (with provenance) and returns.
     - Otherwise lets the broker's existing adapter pipeline handle the
       turn through the registered codex_app_server endpoint.
  Does not call into Codex-specific APIs directly.

### Files to modify

- `packages/web/server/index.ts` — replace the
  `createRangerScoutbotBrain` startup with `startScoutbotRunner` from
  the new `scoutbot/runner.ts`.
- `packages/web/server/create-openscout-web-server.ts` — drop the
  `brain: createRangerScoutbotBrain(rangerAssistant)` argument. Add the
  two new HTTP endpoints (`GET /api/scoutbot/threads`, extended
  `POST /api/send`).
- `packages/runtime/src/codex-app-server.ts` (if needed) — verify
  scoutbot's role config can be passed in via the same path talkie uses;
  add the minimal hook if the existing path doesn't already accept
  arbitrary system-prompt + tool-grants overrides.

### Provenance convention

Every broker write scoutbot emits carries metadata:

```jsonc
{
  "metadata": {
    "source": "scoutbot",
    "requestedBy": "operator",
    "sourceMessageId": "<the operator message that triggered this>",
    "parentScoutbotTurnId": "<scoutbot's reply message id, if write is from a tool call within a turn>",
    "generatedBy": "scoutbot"
  }
}
```

The runner shim sets `source` and `generatedBy`; tool implementations
add `requestedBy`, `sourceMessageId`, and `parentScoutbotTurnId` from
the turn context.

## Frontend slice (Claude) — file-by-file

### Files to modify

- `apps/macos/Sources/Services/HudComposeService.swift`:
  - Add `activeThread: ScoutbotThread?` state, loaded at init via
    `GET /api/scoutbot/threads`.
  - Change `postToBroker(_:)` to include the active thread's
    `threadId` in the `POST /api/send` body.
  - Update `handleMessagePostedBlock(_:)` to filter by both
    `actorId == assistantHandle` AND `conversationId ==
    activeThread.conversationId`.
  - Refresh the active thread (or backoff + retry) if the GET fails on
    boot.
- `apps/macos/Sources/HUD/HUDDockState.swift`:
  - No-op for stage 1; the active thread lives in HudComposeService.
    Stage 2 will introduce a switcher and that state moves here.
- `apps/macos/Sources/HUD/HUDAssistantView.swift`:
  - Render the active thread name in `ThreadHeader` so the operator can
    see which thread they're in. Static "default" for stage 1.
- `apps/macos/Sources/HUD/HudMessageDock.swift`:
  - Add a small thread chip in the target row showing the active thread
    name (e.g. "· default") next to the `@scout` target chip. Static
    for stage 1.

### Files to add

None for stage 1. (Stage 2 will add a `ThreadSwitcher.swift`.)

## Cutover sequence

Single commit deletes the runner and lights up the Codex path. No
feature flag, no shadow runner — both halves must land together.

1. Codex's backend slice merges first. Verify with HTTP smoke tests
   (below); the HUD will be broken during this window because the
   contract has moved (new threadId field + new endpoint).
2. Claude's frontend slice merges immediately after. Verify with the
   end-to-end smoke test (below).
3. Both halves can be developed in parallel; only the merge order
   matters. The window between (1) and (2) should be minutes, not
   days.

If we want zero downtime for an existing in-progress scoutbot
conversation, we accept that the existing single conversation
gets grandfathered into `thr-default` on first GET — the runner
shim populates the default thread row with the existing
`dm.operator.scoutbot` conversation id rather than creating a new
conversation.

## Verification

### Backend-only smoke tests (Codex runs these)

1. `curl http://127.0.0.1:43120/api/scoutbot/threads` returns one thread
   (the default) with a populated `transportSessionId` and
   `conversationId`.
2. `curl -X POST http://127.0.0.1:43120/api/send -d '{"body":"hi"}'`
   triggers a scoutbot reply within ~10s. The reply's `message.posted`
   event has `actorId: "scoutbot"`, the matching `conversationId`, and
   provenance metadata.
3. `curl -X POST http://127.0.0.1:43120/api/send -d '{"body":"/agents"}'`
   gets a prefilter reply (no Codex call). Reply body includes the
   matched rule id and snapshot timestamp.
4. `grep -r "scoutbot-runner\|ScoutbotBrain\|createRangerScoutbotBrain"
   packages/` returns nothing.

### End-to-end smoke test (both halves)

1. Boot the HUD. The assistant view header shows "default".
2. Send "hi" via the compose dock. Echo appears immediately.
   Scoutbot reply lands in the assistant view within ~10s. Both
   messages are scoped to the default thread's conversationId (verify
   via broker `/v1/messages`).
3. Send "/agents" via the compose dock. Reply lands within ~500ms (no
   Codex call). Body includes the matched rule id.
4. Restart the HUD. The conversation history persists (the underlying
   broker conversation is durable; the thread map carries the same
   thread id).
5. Restart the broker. After it comes back, the HUD's next send
   succeeds against the same default thread.

## Rollback

`git revert` the cutover commit(s). The runner code, brain interface,
and OpenAI-direct call path return; the HUD reverts to its pre-cutover
state; the new thread-map JSON file becomes orphan data on disk (safe
to leave or delete manually).

If the rollback happens after the operator has been talking to
scoutbot via Codex for a while, the Codex-side conversation history
remains in Codex; reverting drops scoutbot's UI view of those turns
but does not lose them.

## Out of scope for stage 1

- Stage 2 work (see scope section above).
- Memory summarization for long-running Codex sessions. (Designed-hook
  per SCO-050; concrete strategy deferred.)
- Cancellation tool for in-flight Codex turns. (Design-hook.)
- Observability metrics: prefilter hit rate, time-to-first-token, etc.
  (Design-hook; backend should emit telemetry from day one but the
  consumer side is stage 2.)
- Cross-thread referencing (`get_thread_history`). Per SCO-051 open
  question; not needed until stage 2.
- iOS and web surfaces.

## After this lands

A clean cut. One brain, one identity, one provider path. Stage 2 picks
up with the thread switcher UI and sub-agent dispatch + visibility, and
can ship independently. SCO-051 stage 1 (default thread plumbing) is
satisfied by this plan; SCO-051 stage 2 (switcher + multi-thread
routing) lands with SCO-050 stage 2 in the same build.
