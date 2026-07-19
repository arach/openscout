# OpenScout session handoff/branching research

**Date:** 2026-07-09
**Scope:** Research only; no implementation. Focused on macOS session composer, `ScoutSessionDraft` / `SessionInitiationSpec`, `POST /api/sessions`, broker dispatch/session routing, tail/history observation, and the Scout-owned-vs-observed-transcript boundary.

## Executive recommendation

Scout should model “new chat from this message”, “branch from here”, and “hand off to Codex” as three related but explicitly different actions:

1. **New chat from this message** — seed-only convenience. It creates a fresh session, anchors the new Scout conversation to the selected Scout message, and copies/quotes the visible message body as the initial instruction. It should not imply prior harness context.
2. **Branch with context** — Scout fork. It creates a new execution session and seeds it with a bounded handoff brief derived from a source session/state/message. This is the correct generic model for “branch from this point”.
3. **Hand off to Codex** — a specialized branch-with-context where the work target is `projectPath + harness: "codex"` and the source is usually a Claude session or state. It must be described as a compact Scout handoff, not a transfer of Claude’s full hidden/provider context.

Recommended V1 payload for Claude → Codex handoff:

```json
{
  "target": { "projectPath": "/Users/art/dev/openscout" },
  "execution": {
    "harness": "codex",
    "session": "fork",
    "forkFromSessionId": "<source-claude-session-id>",
    "forkContext": {
      "includeBrokerRecords": true,
      "includeObservedHarnessMaterial": true,
      "maxBytes": 24000
    }
  },
  "seed": {
    "instructions": "<user's new ask>",
    "fromMessageId": "<anchor Scout message id>",
    "fromConversationId": "<anchor Scout conversation id>"
  }
}
```

Once excellent state snapshots exist, prefer `forkFromStateId` over raw `forkFromSessionId`.

## Current behavior

### macOS composer and message actions

- `ScoutSessionDraft.Mode` has only `.fresh` and `.continueContext`; there is no draft-level fork/handoff mode (`apps/macos/Sources/ScoutAppCore/ScoutSessionDraft.swift:8-11`).
- The draft can carry `fromMessageId` / `fromConversationId` and UI seed metadata (`ScoutSessionDraft.swift:23-31`), but `spec()` maps only:
  - `.continueContext` → `execution.session = .existing` plus `targetSessionId = agent.harnessSessionId`
  - anything else → `execution.session = .new`
  (`ScoutSessionDraft.swift:93-103`).
- The shared native spec already has protocol slots for `forkFromSessionId` and `forkFromStateId` (`packages/scout-native-core/Sources/ScoutCapabilities/SessionInitiation.swift:15-33`), but `ScoutSessionDraft` never populates them. Native `Seed` also lacks the server’s `seed.branchFrom` escape hatch (`SessionInitiation.swift:64-74`).
- “New chat from this message…” calls `startConversationFromMessage`, creating a project-targeted **fresh** draft titled “Branch from message” with:
  - `instructions = message.body`
  - `fromMessageId = message.id`
  - `fromConversationId = message.cId`
  - harness/model defaulted from the source agent
  (`apps/macos/Sources/Scout/ScoutRootView.swift:955-969`, context menu at `ScoutCommsView.swift:1403`, callback at `ScoutRootView.swift:1900-1902`).
- The current pending-session UI labels all non-continue starts as “Fresh session”; it does not surface a distinct branch/handoff state (`ScoutRootView.swift:5353-5358`).
- The session composer mode picker exposes only “Fresh start” and “Continue” (`apps/macos/Sources/Scout/ScoutSessionService.swift:743-748`). Its subtitle says “Continue … with full context” for exact continuation (`ScoutSessionService.swift:489-497`).
- The agent/session inspector has an action labeled “Fork”, but it currently calls `startSession(.continueContext)` (`ScoutRootView.swift:5754-5769`, rendered label at `ScoutRootView.swift:6948-6960`). That is semantically exact continuation, not fork.

Net: current macOS “from message” behavior is an anchored fresh seed. The UI word “Branch” appears in the draft title, but no fork source/context is sent. The inspector “Fork” label is actively misleading because it continues the exact session.

### `/api/sessions`

`POST /api/sessions` is already close to the right shape:

- It accepts target `agentId` or `projectPath`, execution `harness/model/reasoningEffort/session/targetSessionId/forkFromSessionId/forkFromStateId`, and seed `instructions/fromMessageId/fromConversationId/attachments/branchFrom` (`packages/web/server/create-openscout-web-server.ts:4231-4253`).
- It recognizes `new`, `existing`, `any`, and `fork`; it does **not** accept `reuse` even though protocol does (`create-openscout-web-server.ts:1159-1167`).
- `session: "existing"` fills `targetSessionId` from the selected agent if omitted, then fails if none exists (`create-openscout-web-server.ts:4285-4297`).
- `session: "fork"` requires `execution.forkFromSessionId`, `execution.forkFromStateId`, or `seed.branchFrom.sessionId` (`create-openscout-web-server.ts:4298-4307`).
- `fromMessageId` and `fromConversationId` must be provided together, and `fromConversationId` must be an opaque channel id (`create-openscout-web-server.ts:4330-4341`).
- It forwards session policy and fork source ids to `askScoutQuestion` (`create-openscout-web-server.ts:4347-4363`).
- Anchoring is metadata-only after the session has launched; anchor failure returns `anchorError` but must not turn success into a retry (`create-openscout-web-server.ts:4394-4432`).

Gaps:

- The server shape does not parse/forward `forkContext` or `lineage` even though protocol and broker schemas have those fields.
- `askScoutQuestion` accepts only `executionSession?: "new" | "existing" | "any" | "fork"` and fork source ids, then posts them to the broker; it does not expose `reuse`, `forkContext`, or `lineage` (`packages/web/server/core/broker/service.ts:2625-2647`, `2700-2716`).
- `SessionInitiationResult` in native only decodes `ok`, ids, handle, flight/message ids (`SessionInitiation.swift:90-108`), so native cannot currently surface `provenance`, `anchoredConversationId`, or `anchorError` from `/api/sessions`.

### Broker dispatch/session routing

- Broker delivery creates a cardless project session for `projectPath` consults when there is no explicit target agent/session and the session policy is `new` or `fork` (`packages/runtime/src/broker-delivery-acceptance-service.ts:591-606`). This is the right path for “hand off to Codex” if the target is project + harness rather than an existing agent card.
- The daemon auto-spawns cardless sessions for supported harnesses and does not silently substitute another harness: `codex` maps to `codex_app_server`, `claude` to `claude_stream_json`, and unsupported requested harnesses fail loudly (`packages/runtime/src/broker-daemon.ts:864-952`).
- Invocation execution preserves the requested fork policy/source unless an exact `targetSessionId` was provided, in which case exact continuation wins (`broker-delivery-acceptance-service.ts:821-836`).
- Local-agent prompting currently adds only a minimal fork note: source id plus “new execution session; do not continue the exact source session” (`packages/runtime/src/local-agents.ts:2748-2765`, used in direct/attached prompts at `3008-3040` and `3043-3060`). There is no synthesized state/handoff assembly yet.
- Codex app-server transport in this tree shows `thread/start` and `thread/resume` calls, but no implemented `thread/fork` path (`packages/agent-sessions/src/local/transports/codex-app-server.ts:1024-1058`). Treat native Codex fork as unproven until an adapter capability proves it.

Projection risk to audit: conversation/activity projections sometimes fall back from missing target session ids to `forkFromSessionId` (`packages/web/server/core/conversations/service.ts:314-331`, `packages/runtime/src/activity-projection.ts:315-334` and `452-458`). For forked work, that id is the **source**, not the execution session. The target execution session should be represented separately once spawned/replied, or forked conversations may appear attached to the source session.

### Transcript/tail observation model

- Scout’s architecture explicitly says it is a control plane, not a transcript warehouse: Scout owns conversations/messages/invocations/flights/deliveries/bindings/work items it creates or routes, and observes Claude/Codex/etc. transcript files without importing them wholesale (`docs/architecture.md:170-221`).
- Current posture repeats the local/high-trust pilot boundary and says observed harness material may be tailed, linked, summarized, or lightly indexed, but should not be bulk-imported as Scout-authored data (`docs/current-posture.md:5-9`, `27-44`, `54-71`).
- Agent integration contract: sessions are harness-specific; a Codex ask must not bind to a Claude session; forked asks should route to a new execution session seeded from source state/session, where the source is context, not work target (`docs/agent-integration-contract.md:81-101`). It also bans bulk-copying external harness transcripts as Scout messages (`docs/agent-integration-contract.md:243-251`).
- Runtime session docs define the policy split: `new`, `reuse`, `existing`, and `fork`; `fork` leaves the source session untouched and carries only excellent session state, using native clone if available or a synthesized handoff from broker records and observed material (`docs/runtime-sessions.md:292-388`).
- Tail is an observation surface, not ownership: harness transcript files remain owned by the harness; Scout emits bounded `TailEvent`s and durable coordination stays in Scout records (`docs/tail-firehose.md:8-14`). `TailEvent` carries source/session/project/kind/summary/raw as observed event data (`packages/runtime/src/tail/types.ts:18-41`).
- `@openscout/agent-sessions` similarly states it observes harness-owned material and does not turn Claude/Codex transcripts into first-party Scout messages (`packages/agent-sessions/README.md:1-5`, `170-175`).
- History observation can reconstruct a `SessionState` from Claude/Codex/Pi history files for read models (`packages/agent-sessions/src/history.ts:323-340`, `2340-2368`; web observe resolver at `packages/web/server/core/observe/service.ts:688-708`, `892-906`, `1516-1533`, `1779-1828`). This is a useful input for a handoff brief, not a license to store raw turns as Scout messages.

## What is already modeled

The later-design task should build on existing concepts instead of inventing a new route type.

| Concept | Already present | Notes |
| --- | --- | --- |
| Fresh/new session | Native draft `.fresh`; protocol `session: "new"`; `/api/sessions`; broker cardless project spawn | Current “new chat from message” uses this. |
| Exact continuation | Native draft `.continueContext`; `targetSessionId`; protocol `existing`; broker exact session resolution | Correct for “continue exact session”, not for branching. |
| Fork policy | Protocol `InvocationSessionPolicy = "fork"`; native spec fork fields; `/api/sessions` validation; broker preserves execution | Current local prompt only carries source id, not context. |
| Reuse policy | Protocol has `reuse`; docs define it; legacy `any` is alias | `/api/sessions`, native spec, and `askScoutQuestion` still expose `any` but not `reuse`. |
| Anchor from message | `fromMessageId` + `fromConversationId`; server `anchorConversationToMessage`; conversation `parentConversationId/messageId` | Anchor is UI/provenance, not model context. |
| Branch source shim | Server accepts `seed.branchFrom.sessionId` as fork source | Native `SessionInitiationSpec.Seed` cannot send this today. |
| Fork context/lineage | Protocol has `forkContext` and `lineage` (`packages/protocol/src/invocations.ts:21-65`) | Web/native initiation do not forward these yet. |
| Source/session observation | Tail/history/observe can find recent harness material and snapshots | Must remain bounded and labelled observed material. |
| Excellent state concept | `docs/runtime-sessions.md` and `docs/eng/sco-049-session-forking-and-excellent-session-states.md` | Proposed, not implemented as storage/picker yet. |

`SCO-049` is especially aligned with this task. It says fork sources should be excellent states, not transcript tails; synthesized forks are assembled from broker-owned records and observed material; and non-goals include full transcript import, cross-harness perfect replay, and exactly-once distributed fork execution (`docs/eng/sco-049-session-forking-and-excellent-session-states.md:83-131`, `245-320`, `520-546`).

## Semantic constraints

1. **Work target and source context are separate.** Target answers “who/what should run this?” Source answers “what prior state should seed it?” `targetSessionId` is exact continuation; `forkFromSessionId` is source provenance/context.
2. **Sessions are harness-specific.** A Claude session cannot be the target of a Codex execution unless a future explicit adapter capability says otherwise. Claude → Codex is therefore a synthesized handoff into a new Codex session, not a resume.
3. **A Scout message anchor is not a harness cut point.** `fromMessageId/fromConversationId` can identify what the user clicked and where to attach the new conversation, but it does not by itself prove which harness session, turn, transcript offset, or state snapshot should seed the fork.
4. **Observed transcripts remain observed.** Fork assembly may summarize/link/tail observed harness material under limits, but should not bulk-copy external turns into Scout conversation messages.
5. **No exact cross-harness context transfer claim.** UX should never promise “same context” for Claude → Codex. Say “compact handoff”, “summary”, “provenance”, “selected context”, or “branch brief”.
6. **High-trust local pilot posture.** The handoff feature can assume trusted local developer environments, but should not claim enterprise audit/compliance, hardened multi-tenant security, exact delivery, or replicated external transcript storage.
7. **Fail closed on exact continuation; be explicit for fork.** Unknown/stale exact `targetSessionId` should error. For fork, inability to resolve source context should either ask the user to choose a source or fall back only to a clearly-labelled seed-only new chat.
8. **Body text is payload, not routing.** Harness choice, source session, target project, and mode should be explicit fields/chips, not inferred from phrases like “hand off to Codex”.

## Recommended UX language

Use labels that match the data contract.

### Primary actions

- **New chat from this message…**
  Helper text: “Starts a fresh session using this visible message as the first prompt. The new Scout chat will be linked back here.”

- **Branch with context…**
  Helper text: “Starts a new session with a compact Scout handoff from the selected message/session. Source session stays untouched.”

- **Hand off to Codex…**
  Helper text: “Starts a new Codex session for this project with a compact handoff from the current Claude session/message. This does not transfer Claude’s full hidden/model context.”

- **Continue exact session**
  Helper text: “Sends the next message into this same harness session.”

### Renames/copy fixes

- Rename the current inspector “Fork” action to **Continue exact session** if it keeps calling `.continueContext`, or change its implementation to real `session: "fork"`. Do not leave the current label/behavior mismatch.
- In the composer, use a three-mode mental model when source context is available:
  - **Fresh** — no prior model context.
  - **Continue exact** — same harness session, requires `targetSessionId`.
  - **Branch** — new session seeded from compact handoff, requires source state/session/message.
- For handoff targets, show chips separately: **Source: Claude session …**, **Anchor: message …**, **Target: Codex**, **Project: …**.
- Avoid “full context” except for exact same-session continuation. For fork/handoff, use “handoff brief”, “source summary”, “selected context”, or “branch from state”.

## Possible API/data model changes

### Native/macOS

- Extend `ScoutSessionDraft.Mode` to include `.fork` or `.branch` (and possibly a UX-level `.handoff(targetHarness:)` that serializes as fork).
- Add draft fields:
  - `forkFromSessionId`
  - `forkFromStateId`
  - `forkContext` options
  - source harness/session/conversation/message display metadata
  - optional `targetHarnessOverride` for “Hand off to Codex”
- Update `spec()` so branch/handoff emits `execution.session = .fork` plus source id(s), while preserving `fromMessageId/fromConversationId` as anchors.
- Add `reuse` to `SessionInitiationSpec.SessionMode`; keep `any` decode/encode only as compatibility if needed.
- Extend native `Seed` or top-level provenance to include `branchFrom` if keeping that server shim.
- Decode `provenance`, `anchoredConversationId`, and `anchorError` in `SessionInitiationResult` so macOS can warn without retrying.
- Decode `responderSessionId` in `ScoutMessageMetadata`; the server/runtime writes responder session metadata (`packages/runtime/src/broker-local-invocation-service.ts:410-415`), but native currently does not expose it (`ScoutCommsModels.swift:357-403`). Use it, channel `sessionId`, participant `sessionId`, and agent `harnessSessionId` as ordered candidates for source resolution.

### Web/server initiation

- Accept `execution.session: "reuse"` and normalize legacy `any` to the protocol’s effective reuse policy.
- Parse and forward `execution.forkContext` and `execution.lineage` through `/api/sessions` → `askScoutQuestion` → broker deliver.
- Keep `fromMessageId/fromConversationId` validation as-is for anchoring, but do not treat those ids as sufficient fork source without source resolution.
- Add a source-resolution helper/endpoint: given `(fromConversationId, fromMessageId, optional preferred source agent/session)`, return:
  - Scout anchor validity
  - candidate source actor/agent
  - candidate source session ids and aliases
  - source harness/project/root
  - candidate history/tail refs
  - whether the source is exact enough for `forkFromSessionId`
- If source cannot be resolved for “Branch with context”, fail with a user-readable choice: “Start seed-only new chat” or “choose a source session”.

### Broker/runtime/data model

- Introduce a Scout-owned **HandoffBrief** or **SessionStateSnapshot** record. Minimal V1 fields:
  - `id`, `kind`, `sourceSessionId`, `sourceHarness`, `sourceConversationId`, `sourceMessageId`, optional source flight/work ids
  - `projectRoot`, `cwd`, branch/worktree when known
  - `goal`, `decisions`, `constraints`, `evidence`, `relevantFiles`, `knownFailures`, `nextMove`, `unansweredQuestions`
  - `sourceRefs` for observed material (history path, tail cursors, transcript ids), not copied raw transcript turns
  - `createdAt`, `createdBy`, `maxBytes`, `includeObservedHarnessMaterial`, assembly strategy/version
- Store fork lineage on the invocation and, once the new execution session is known, on the new endpoint/session actor metadata:
  - source session/state/message
  - target session id
  - source harness and target harness
  - native clone vs synthesized handoff
- Fix read-model/session projections so `forkFromSessionId` is never treated as the target execution session. Use spawned session id / responder session id / flight metadata for target; show source separately as lineage.
- Add a handoff assembler that consumes Scout-owned records directly and observed material only through bounded adapters. The resulting prompt should label observed material and include the new ask after the handoff.
- Represent harness fork support as capabilities:
  - `session.resume`
  - `session.fork` (can satisfy Scout fork, synthesized or native)
  - `session.nativeThreadClone` (true provider/runtime clone)

## Risks

- **Misleading UX:** “Fork” currently means continue in one macOS path. This can cause users to believe they are branching when they are mutating the source session.
- **Over-promising cross-harness transfer:** Claude → Codex cannot transfer hidden/provider context. The UI must frame it as a compact handoff.
- **Source ambiguity:** A clicked Scout message may be an operator prompt, agent reply, forwarded message, or system/bridge record. Source session selection must be explicit or well-diagnosed.
- **Projection confusion:** Current fallbacks may display the source session id as the forked conversation’s session id before target metadata is available.
- **Anchor failure after launch:** `/api/sessions` intentionally does not fail a launched session when anchoring fails. UI should show a warning and avoid automatic retry that duplicates sessions.
- **Prompt injection/sensitive content:** Observed harness transcripts are untrusted local material. Handoff summaries should be bounded, labelled, and preferably previewable for high-signal handoffs.
- **Stale/unavailable source:** Source history may be pruned, moved, harness-owned, or unreadable. Branch UI needs a seed-only fallback and clear diagnostics.
- **Native fork uncertainty:** Codex app-server code currently starts/resumes threads; native fork/clone should not be advertised until implemented and tested.
- **Policy vocabulary drift:** Protocol/docs use `reuse`; server/native still use `any`. New UX should not add more synonyms.

## Incremental implementation plan with tests

### Phase 0 — Copy/spec hygiene, no behavior change

- Rename current macOS inspector “Fork” to “Continue exact session” if it still calls `.continueContext`.
- Document that existing “New chat from this message” is seed-only.
- Tests: update macOS UI/string tests if present; add a small `ScoutSessionDraftTests` assertion that current `.continueContext` still maps to `.existing`.

### Phase 1 — Plumb fork fields through initiation

- Add branch/fork mode and fields to `ScoutSessionDraft`.
- Add `reuse` to native `SessionInitiationSpec.SessionMode` and `/api/sessions` normalizer.
- Add `forkContext` and `lineage` to native spec, server body parsing, `askScoutQuestion`, and broker deliver payload.
- Tests:
  - `apps/macos/Tests/ScoutAppCoreTests/ScoutSessionDraftTests.swift`: fork mode emits `session: .fork`, source id, no `targetSessionId`; existing mode still emits exact target.
  - `packages/web/server/create-openscout-web-server.test.ts`: `/api/sessions` forwards `forkContext`, `lineage`, `reuse`; still rejects `fork` without source.
  - `packages/protocol/src/invocations-session-policy.test.ts`: maintain validation for invalid combinations.

### Phase 2 — Resolve source from message/session

- Add source-resolution helper used by macOS/web before showing “Branch with context”/“Hand off to Codex”.
- Decode `responderSessionId` in native message metadata and prefer candidates in this order: explicit selected session row, message responder session, channel session id, participant session id, agent harness session id, history/tail ref lookup.
- Tests:
  - Native model decode test for `responderSessionId`.
  - Server unit tests for source-resolution candidates and ambiguity diagnostics.
  - UI logic tests that “seed-only” remains available when source is unresolved.

### Phase 3 — Correct fork routing/projections

- Ensure project + harness + `session: "fork"` creates a new target session and never delivers into the source session.
- Store/display target execution session id separately from source lineage.
- Fix conversation/activity projections that fall back to `forkFromSessionId` as session id.
- Tests:
  - `packages/runtime/src/broker-delivery-acceptance-service.test.ts`: forked project ask creates/resolves cardless target, preserves source lineage, source session untouched.
  - `packages/runtime/src/activity-projection.test.ts` / conversation service tests: fork source id appears as lineage, not target `sessionId`.
  - Regression for exact `targetSessionId` continuation unchanged.

### Phase 4 — Synthesized handoff brief

- Implement bounded handoff assembly from Scout-owned records plus optional observed material.
- Store a Scout-owned handoff/state record or attach a compact invocation context payload; do not import raw external turns as Scout messages.
- Local agent prompts should include the handoff brief, not just source id.
- Tests:
  - Fake Claude history → handoff includes goal/decisions/files/evidence/next move under byte budget.
  - Observed excerpts are labelled as observed material.
  - No external transcript turns are persisted as Scout `message` records.
  - Prompt builder includes source, target, limitation language, and the new ask.

### Phase 5 — UX: Branch and Hand off to Codex

- Add message/session actions:
  - “New chat from this message…” (seed-only)
  - “Branch with context…”
  - “Hand off to Codex…” when target project is known and Codex is available/spawnable
- Composer shows source/target chips and limitation copy.
- Tests:
  - macOS interaction/unit test for `Hand off to Codex` payload: target project, `harness: codex`, `session: fork`, source id, anchor ids.
  - Server integration: launched session response includes conversation, target session, provenance, and anchor warning if applicable.

### Phase 6 — Excellent states and curated bases

- Add automatic/promoted session state snapshots following SCO-049.
- Let operators promote a message/session/flight/work item into a named fork source.
- Prefer `forkFromStateId` in UI and API once state exists; raw `forkFromSessionId` stays V1-compatible.
- Tests:
  - Snapshot creation on completed/blocked/review boundaries.
  - Promotion stores compact state and source refs only.
  - Fork from state produces same target semantics as fork from session but with stable state id.

### Phase 7 — Optional native fork/clone

- Only after a harness adapter advertises `session.nativeThreadClone`, implement native same-harness fork.
- Cross-harness handoff remains synthesized.
- Tests:
  - Fake adapter capability path uses native clone and records `forkSourceKind: "native_thread_clone"`.
  - No capability → synthesized handoff path.
  - Claude → Codex never claims native clone unless an explicit bridge capability exists.

## Suggested V1 behavior matrix

| User action | Session policy | Target | Source | Context promise |
| --- | --- | --- | --- | --- |
| New chat | `new` | selected project/harness | none | fresh |
| New chat from this message | `new` | selected project/harness | message anchor only | visible message seed only |
| Continue exact session | `existing` | `targetSessionId` | same session | same harness session context |
| Branch with context | `fork` | project/agent/harness | source state/session/message resolved to state | compact handoff, source untouched |
| Hand off to Codex | `fork` | project + `harness: codex` | usually Claude source state/session/message | compact cross-harness handoff, not full transfer |
| Reuse warm session | `reuse` | project/agent/harness | broker choice | optimization only; no exact continuity promise |

## File references inspected

- macOS draft/spec/composer/actions:
  - `apps/macos/Sources/ScoutAppCore/ScoutSessionDraft.swift:8-126`
  - `packages/scout-native-core/Sources/ScoutCapabilities/SessionInitiation.swift:14-108`
  - `apps/macos/Sources/Scout/ScoutRootView.swift:955-985`, `1900-1902`, `5754-5769`, `6948-6960`
  - `apps/macos/Sources/Scout/ScoutSessionService.swift:489-509`, `743-748`, `1181-1192`
  - `apps/macos/Sources/Scout/ScoutCommsView.swift:1403`
  - `apps/macos/Sources/ScoutAppCore/ScoutCommsModels.swift:20-46`, `357-403`
- Server/API:
  - `packages/web/server/create-openscout-web-server.ts:1159-1167`, `2369-2398`, `4231-4432`
  - `packages/web/server/core/broker/service.ts:2625-2747`
  - tests around `packages/web/server/create-openscout-web-server.test.ts:3207`, `3315`, `3755`
- Protocol/runtime/broker:
  - `packages/protocol/src/invocations.ts:21-65`, `137-190`
  - `packages/runtime/src/broker-delivery-acceptance-service.ts:591-606`, `650-668`, `821-836`, `875-897`
  - `packages/runtime/src/broker-daemon.ts:864-952`
  - `packages/runtime/src/local-agents.ts:2748-2765`, `3008-3060`
  - `packages/agent-sessions/src/local/transports/codex-app-server.ts:1024-1058`
  - `packages/web/server/core/conversations/service.ts:314-331`
  - `packages/runtime/src/activity-projection.ts:315-334`, `452-458`
- Observation and ownership docs/code:
  - `docs/architecture.md:170-221`
  - `docs/current-posture.md:5-71`
  - `docs/runtime-sessions.md:292-388`
  - `docs/agent-integration-contract.md:81-101`, `243-251`, `297-301`
  - `docs/tail-firehose.md:8-14`
  - `packages/runtime/src/tail/types.ts:18-41`
  - `packages/agent-sessions/README.md:1-5`, `170-175`
  - `packages/agent-sessions/src/history.ts:323-340`, `2340-2368`
  - `packages/web/server/core/observe/service.ts:688-708`, `892-906`, `1516-1533`, `1779-1828`
  - `docs/eng/sco-049-session-forking-and-excellent-session-states.md`

## Unanswered questions

1. When the user clicks “from this message”, should the cut point be the selected Scout message, the most recent source harness turn before that message, the associated flight/work item, or a generated state snapshot? SCO-049 already asks whether `forkFromMessageId` / `forkFromFlightId` are needed.
2. If a clicked message has no unambiguous source session, should “Branch with context” be disabled, show a source picker, or degrade to seed-only with a warning?
3. Should “New chat from this message” remain permanently seed-only while “Branch with context” opts into observed material, or should the former grow a branch option inline?
4. What default byte/message budget is appropriate for local pilot handoffs, and should the user preview/edit the handoff brief before launch?
5. Where should `HandoffBrief`/`SessionStateSnapshot` live: broker journal only, SQLite projection, runtime session store, or a new state library with promotion/curation semantics?
6. How should source states behave across mesh peers when the source session lives on another machine? Current posture should not promise replicated transcripts or exact distributed execution.
7. Can/should Codex app-server implement a native `thread/fork`? Current code only shows start/resume; cross-harness should remain synthesized regardless.
8. `docs/eng/sco-049...` references `docs/data-ownership.md`, but that file is not present in this checkout. The current live boundary is documented in `architecture.md`, `current-posture.md`, and `agent-integration-contract.md`.
