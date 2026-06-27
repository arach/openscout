# SCO-072: Chat Fork Points

## Status

Proposed.

## Proposal ID

`sco-072`

## Date

2026-06-27

## Intent

Make any durable point in a Chat timeline usable as a fork source.

The operator should be able to point at a moment in a Chat - "right here, before
the conversation went sideways" or "right after this answer" - and start a new
execution session from the state available at that moment. The source moment
should be precise, durable, and provenance-tracked. It should not continue the
source session, mutate the source Chat, or inherit later messages.

This spec bridges:

- [`chat-model.md`](../chat-model.md): Chat is communication continuity.
- [`runtime-sessions.md`](../runtime-sessions.md): session policy separates
  `new`, `reuse`, `existing`, and `fork`.
- [`sco-049-session-forking-and-excellent-session-states.md`](./sco-049-session-forking-and-excellent-session-states.md):
  forks start new execution sessions from excellent state, not from raw
  transcript replay.

## Product Thesis

Forking should feel like placing a pin in a conversation timeline.

Users do not usually think "make a state snapshot from a bounded prefix of this
conversation, infer the target, and launch a fresh execution session." They
think "fork from here." The system can honor that simple gesture by treating
the chosen Chat moment as a source cursor and materializing it into a forkable
state.

The important semantic distinction remains:

- The **fork point** answers: what prior context should seed the new session?
- The **work target** answers: which project, agent, or capability should run?

Those two may be inferred together in a direct agent DM, but they are not the
same field and must not collapse.

## Scope

In scope:

- Message-boundary fork points for any Chat.
- Selected text or selected message as a focus hint for the fork.
- Materializing a Chat moment into a reusable `forkFromStateId`.
- Preserving fork provenance: Chat, anchor message, boundary, source digest,
  and target hints.
- UI affordances for "Fork before here" and "Fork after here."
- V1 synthesized fork handoff assembled from Scout-owned messages and bounded
  observed harness material.

Out of scope:

- Provider-native thread cloning.
- Token-level fork inside a streaming response.
- Perfect replay of external harness context.
- Forking from messages that do not exist in broker-owned Chat history.
- Merging forked work back into the source session.
- Cross-Chat branch comparison UI.

## Terms

| Term | Meaning |
| --- | --- |
| Chat fork point | A durable location in one Chat timeline selected as fork source. |
| Anchor message | The durable message that defines the boundary. |
| Boundary | Whether the fork includes messages before the anchor or through the anchor. |
| Focus | Optional message, range, or selection that explains what the user cares about. |
| Source moment | The resolved Chat prefix and metadata available at the fork point. |
| Materialized state | A bounded `session state` snapshot derived from the source moment. |
| Fork target | The project, agent, or capability that should execute the new session. |
| Rehydration bundle | The compact context package given to the fresh LLM session. |
| Workspace provenance | Optional repository/worktree metadata attached to the source moment. |

## Core Model

The canonical forkable Chat location is a message boundary:

```ts
type ChatForkPoint = {
  conversationId: ScoutId;
  anchorMessageId: ScoutId;
  boundary: "before" | "after";
  focus?: ChatForkFocus;
};

type ChatForkFocus =
  | {
      kind: "message";
      messageId: ScoutId;
    }
  | {
      kind: "selection";
      messageId: ScoutId;
      startOffset: number;
      endOffset: number;
      quoteHash?: string;
    };
```

Rules:

- `boundary: "before"` includes messages with sequence lower than the anchor.
- `boundary: "after"` includes the anchor and prior messages.
- The source moment excludes every message after the boundary.
- Selection never changes the boundary by itself. It is focus metadata attached
  to the surrounding message moment.
- If a message does not have a durable sequence, the materializer must derive a
  stable ordering from broker storage before accepting the fork point. Do not
  use wall-clock timestamps as the only ordering authority.
- A fork point is not a read cursor or sync cursor. It is a source-state cursor
  with provenance requirements.

## Materialized State

The fork point should become a state id before execution:

```ts
type ChatMomentForkState = {
  id: ScoutId;
  kind: "chat_moment";
  source: {
    conversationId: ScoutId;
    anchorMessageId: ScoutId;
    boundary: "before" | "after";
    focus?: ChatForkFocus;
    sourceDigest: string;
    materializedAt: number;
  };
  targetHints: {
    agentId?: ScoutId;
    projectPath?: string;
    harness?: AgentHarness;
    model?: string;
    workspaceRoot?: string;
    branch?: string;
  };
  rehydration: {
    strategy: "raw_window" | "tail_plus_summary" | "state_snapshot";
    maxTokens: number;
    estimatedTokens: number;
    includedMessages: number;
    excludedAfterAnchor: true;
    focusPinned: boolean;
    sections: Array<{
      kind:
        | "source"
        | "task_frame"
        | "summary"
        | "recent_messages"
        | "decisions"
        | "constraints"
        | "evidence"
        | "next_move"
        | "excluded_future_boundary";
      estimatedTokens: number;
    }>;
    truncated: boolean;
    limitations?: string[];
  };
  workspaceProvenance?: {
    projectPath?: string;
    worktreePath?: string;
    branch?: string;
    headSha?: string;
    dirty?: boolean;
    capturedAt?: number;
    limitations?: string[];
  };
  budget: {
    maxMessages: number;
    maxBytes: number;
    maxTokens: number;
    includedMessages: number;
    truncated: boolean;
  };
  handoff: {
    title: string;
    summary: string;
    decisions: string[];
    constraints: string[];
    evidence: Array<{
      kind: "message" | "attachment" | "flight" | "observed_harness_material";
      refId: string;
      label: string;
    }>;
    nextMove?: string;
  };
};
```

The execution request then uses the normal fork shape:

```ts
execution: {
  session: "fork",
  forkFromStateId: "state-chat-moment-...",
  forkContext: {
    includeBrokerRecords: true,
    includeObservedHarnessMaterial: true
  }
}
```

V1 may accept `forkFromSessionId` for raw session forks, but Chat fork points
should prefer `forkFromStateId` once materialized. The Chat moment is source
context, not the execution target.

## Source Assembly

The materializer builds a bounded source state from:

1. The Chat definition and participants.
2. Messages in the Chat up to the boundary.
3. Message metadata such as actor, class, reply links, attachments, and source.
4. Related invocations/flights/work items whose originating message is included.
5. Active endpoint/session/project metadata available at or near the source
   moment.
6. Optional workspace/git provenance available at or near the source moment.
7. Optional observed harness material, labeled as observed material, within the
   selected budget.

It must not:

- Import observed harness transcript turns as first-party Scout messages.
- Include messages after the source boundary.
- Follow external thread ids and silently pull in provider history beyond the
  boundary.
- Duplicate large attachment blobs; include references and bounded summaries
  instead.
- Treat selected text as the whole source unless the caller explicitly asks for
  a selection-only fork mode in a future version.

## Context Rehydration

A fork is only useful if the fresh LLM can be rehydrated into the right mental
state. The Chat fork point is the address. The rehydration bundle is the actual
payload that makes the new context window useful.

Rehydration should be explicit because "fork from here" is not the same as
"paste the whole transcript." The materializer should produce a bounded bundle
that explains:

- where the fork came from
- which messages are included
- which future messages are intentionally excluded
- what the user was trying to do
- important decisions, constraints, and evidence
- recent raw turns when they fit
- the next useful move for the new session

The bundle is a promptable artifact, not a hidden memory clone. A forked
session should be able to inspect or display the rehydration preview before it
starts work.

### Rehydration Strategies

| Strategy | Meaning | Use when |
| --- | --- | --- |
| `raw_window` | Include raw Chat turns up to the boundary. | The included prefix fits comfortably in the model window. |
| `tail_plus_summary` | Summarize older context, then include the recent raw tail. | Default V1 for ordinary long Chats. |
| `state_snapshot` | Use an excellent/promoted state plus a short source note. | A curated state exists or the source moment has already been promoted. |

V1 should default to `tail_plus_summary`:

1. Pin the source marker: Chat id, anchor message id, boundary, timestamp.
2. Pin focus if present: selected message or text range.
3. Summarize older included messages into task frame, decisions, constraints,
   evidence, and open questions.
4. Include a raw recent tail within token budget.
5. Add an explicit "excluded future" boundary so the new session knows later
   messages were intentionally unavailable.
6. Add target/workspace hints only as provenance, not as hidden instructions.

### Rehydration Contract

The rehydration bundle must guarantee:

- No messages after the boundary are included, summarized, or implied.
- Token budget is explicit and visible.
- Truncation is explicit and visible.
- Raw turns and generated summaries are labeled differently.
- Observed harness material is labeled as observed material.
- The focus selection is not lost during summarization.
- The new session receives a useful next move instead of a passive archive.

### Context Window Budget

The materializer should budget the fresh context window rather than merely cap
message count. A practical first pass:

| Section | Budget posture |
| --- | --- |
| Source marker and no-future boundary | Always included. |
| User focus | Always included if present. |
| Task frame and next move | Always included. |
| Decisions and constraints | Prefer summary over raw turns. |
| Evidence refs | Include labels and ids; summarize large attachments. |
| Recent tail | Include raw turns after summaries, bounded by remaining tokens. |
| Older raw messages | Include only if the full prefix is small. |

The preview should answer the user's actual question: "What will the new LLM
remember when it starts?"

## Workspace/Git Provenance

Git is secondary to rehydration. It matters only because code-agent context may
refer to a repository state. A Chat fork point should record lightweight
workspace provenance when available:

- project path
- worktree path
- branch
- HEAD sha
- dirty/clean flag if known
- limitations when Scout cannot reconstruct the exact filesystem state

Opening a fork composer should not create a branch, checkout a ref, apply a
patch, or mutate the source worktree. Any future git effect should be explicit
at launch time and separate from rehydrating the LLM context.

## Target Inference

Target inference is a convenience layer, not protocol authority.

| Source Chat | Default target behavior |
| --- | --- |
| Direct Chat with one agent | Infer that agent and its project/harness/model as target hints. |
| Direct Chat with one session actor | Infer the session's project and harness as target hints, but create a new session. |
| Group direct | Suggest participants; require explicit target unless exactly one callable non-human participant is active. |
| Channel | Require explicit target, or use a selected target from the composer. |
| System Chat | Require explicit target. |
| Scoutbot Chat | Infer Scoutbot only for Scoutbot-owned work; otherwise require target. |

The UI can preselect a target, but the request should still carry structured
target metadata. Body mentions are not routing.

## API Shape

Prefer a two-step API internally:

```text
POST /api/chats/:chatId/fork-points/materialize
POST /api/sessions
```

Materialize request:

```json
{
  "anchorMessageId": "msg_...",
  "boundary": "after",
  "focus": {
    "kind": "message",
    "messageId": "msg_..."
  },
  "budget": {
    "maxMessages": 80,
    "maxBytes": 32000,
    "maxTokens": 12000
  }
}
```

Materialize response:

```json
{
  "forkFromStateId": "state-chat-moment-...",
  "preview": {
    "title": "Fork after Hudson's routing diagnosis",
    "summary": "Context through message msg_..., excluding later turns.",
    "truncated": false
  },
  "targetHints": {
    "agentId": "agent_...",
    "projectPath": "/Users/art/dev/openscout",
    "harness": "codex"
  },
  "rehydration": {
    "strategy": "tail_plus_summary",
    "estimatedTokens": 8400,
    "includedMessages": 52,
    "excludedAfterAnchor": true,
    "truncated": true,
    "sections": [
      "source",
      "task_frame",
      "summary",
      "decisions",
      "constraints",
      "recent_messages",
      "next_move",
      "excluded_future_boundary"
    ]
  },
  "workspaceProvenance": {
    "projectPath": "/Users/art/dev/openscout",
    "branch": "main",
    "headSha": "abc123..."
  }
}
```

Session start request:

```json
{
  "target": {
    "agentId": "agent_..."
  },
  "execution": {
    "session": "fork",
    "forkFromStateId": "state-chat-moment-..."
  },
  "seed": {
    "instructions": "Take a fresh pass from this point."
  }
}
```

A one-shot product endpoint can wrap those two calls:

```text
POST /api/chats/:chatId/forks
```

but the broker/runtime primitive should still be "materialize source state,
then start forked execution."

## Current Implementation Touchpoints

The repo already has several pieces close to this shape:

- `InvocationExecutionPreference` can represent `session: "fork"`,
  `forkFromStateId`, and `forkFromSessionId`.
- The web session-initiation endpoint accepts `seed.branchFrom`, but it is
  currently documented as inert. That field can become the transitional input
  for Chat fork points while the stable materialization API settles.
- The web execution session parser currently accepts only `new`, `existing`,
  and `any`; it must accept `fork` and eventually `reuse`.
- The web ask wrapper currently forwards only harness, model, session, and
  target session. It must forward fork source fields.
- Broker delivery currently normalizes invocation execution to either `new` or
  `existing` based on `targetSessionId`; it must preserve explicit `fork`.
- There is no dedicated rehydration assembler yet. Today a fork source can be
  represented, but the system still needs a deterministic way to turn a Chat
  moment into a bounded LLM context bundle.
- Existing repo/worktree state is observed in several surfaces. For Chat fork
  points this should remain provenance until a separate workspace launch policy
  exists.

## UI Behavior

Chat message menu:

- `Fork before this message`
- `Fork after this message`

Selection menu:

- `Fork from selection`

Selection behavior:

- The boundary defaults to `after` the selected message.
- The selected range becomes `focus`.
- The preview should explain that later messages are excluded.

Composer behavior:

- If target inference is confident, open a fork composer with target prefilled.
- If target inference is ambiguous, open target selection first.
- The new Chat/session should show fork provenance near the first turn:
  source Chat, anchor message, boundary, rehydration strategy, token estimate,
  and whether context was truncated.

Message visibility:

- The source Chat should not receive a new operator message just because the
  user opened a fork composer.
- Once the fork is launched, the source Chat may receive a lightweight status
  event only if product policy wants visible provenance. That status event must
  not be required for correctness.

## Data Ownership And Privacy

The materialized fork state follows the existing Scout ownership boundary:

- Scout-owned messages and invocations can be summarized as first-party
  coordination records.
- External harness transcripts are observed source material and must remain
  labeled as observed material.
- Attachments and blobs should be referenced by id and summarized only inside
  explicit byte budgets.
- The state record should store a source digest so the UI can detect if the
  referenced source moment was later pruned or rewritten.
- The rehydration bundle should preserve labels for raw message excerpts,
  generated summaries, and observed harness material.
- Workspace/git metadata should be recorded as provenance, not as proof that
  Scout can reconstruct uncaptured dirty files.

This does not add enterprise audit or compliance guarantees. OpenScout remains
for high-trust local developer pilots.

## Edge Cases

### Active streaming turn

Forking from a live streaming turn should anchor to the last durable message.
If the UI offers "include current draft/partial output," that partial content is
focus metadata, not authoritative Chat history.

### Deleted or hidden messages

If the anchor message is missing, deleted, or no longer visible to the caller,
materialization fails with a clear error. If some earlier messages are hidden by
visibility policy, the materializer should exclude them unless the caller has
permission to read them.

### Attachments

Attachments are included by reference. Text extraction, image descriptions, or
document summaries are optional derived evidence and must obey the fork budget.

### Message edits

If edited messages become supported, the fork point must bind to a message
revision or source digest. Until then, materialization should record the digest
of included message ids and bodies.

### Cross-machine Chats

Cross-machine fork points require the source broker to materialize the state or
provide an authorized source bundle. Do not ask a remote broker to bulk ship an
unbounded transcript.

### Rehydration drift

If the source Chat changes after materialization, the state id should remain
bound to the original source digest. The UI can offer to rematerialize, but a
launched fork should not silently pick up later messages.

### Context overflow

If the selected prefix cannot fit, the materializer should summarize older
messages and preserve recent raw turns plus the focus. If even the summary does
not fit, materialization should fail with a budget diagnostic instead of
quietly dropping the focus or no-future boundary.

### Workspace drift

If workspace/git provenance is shown, it should be labeled as provenance. Scout
should not imply that the filesystem state matches the Chat moment unless it has
a captured patch, commit, or artifact reference.

## Phasing

### Phase 1 - Protocol and web API

- Add `ChatForkPoint` / materialization request and response types.
- Add a web endpoint for materializing a Chat fork point.
- Add a rehydration preview with strategy, token estimate, truncation, and
  section list to the materialized response.
- Extend `/api/sessions` execution parsing to accept `fork` and fork source ids.
- Extend the web broker wrapper to forward fork source fields.

Acceptance criteria:

- Materializing `after msg_a` returns a `forkFromStateId`.
- Materializing with a missing anchor returns a 404.
- Materializing a channel Chat returns target hints only when unambiguous.
- `/api/sessions` can accept `execution.session: "fork"` plus
  `forkFromStateId`.
- Opening a fork composer shows what the new LLM context will contain.

### Phase 2 - Broker preservation and synthesized handoff

- Preserve explicit fork execution through broker delivery.
- Record fork source metadata on invocation and flight metadata.
- Build a bounded rehydration bundle from the materialized state.
- Ensure the new execution session is not the source session.

Acceptance criteria:

- `forkFromStateId` creates a new execution session.
- `forkFromSessionId` or source-state metadata is not copied into
  `targetSessionId`.
- Messages after the anchor are absent from the handoff.
- Flight metadata records source Chat, anchor message, boundary, and state id.
- Flight metadata records rehydration strategy, estimated tokens, and
  truncation status.

### Phase 3 - Chat UI

- Add message menu actions for fork before/after.
- Add selection action for fork from selection.
- Add target confirmation when inference is ambiguous.
- Add a rehydration preview before launch.
- Show provenance in the created session/Chat.

Acceptance criteria:

- The operator can fork after any visible durable message in a DM.
- The operator can fork from a selected message range.
- Channel fork requires or confirms a target.
- Opening a fork composer does not write to the source Chat.
- Opening a fork composer does not create a branch or worktree.
- The preview answers: "What will the new LLM remember?"

### Phase 4 - Excellent-state integration

- Let users promote Chat fork states into named excellent states.
- Show curated states before raw Chat moments when launching recurring work.
- Allow state supersession/archive.

Acceptance criteria:

- A materialized Chat moment can become a durable named fork base.
- Later forks can use the named state without rereading the source Chat.
- State records preserve source provenance.

## Risks

- Fork points could look like exact provider thread clones. UI copy should say
  "new session from this point" and show whether the fork is synthesized.
- Channels can make target inference feel magical. Require confirmation unless
  the target is obvious.
- Long Chats can exceed budget. The preview must show truncation before launch.
- Message ordering bugs would corrupt the "no future knowledge" guarantee.
  Tests should assert ordering by durable sequence.
- Poor rehydration can give the new LLM a confident but wrong memory. Generated
  summaries must be labeled, bounded, and previewable.
- If focus text is dropped during summarization, the fork becomes surprising.
  Focus must be pinned or materialization should fail.
- Git drift is a secondary risk for code work. Keep it visible as provenance,
  but do not let it obscure the primary LLM context-window problem.

## Open Questions

1. Should the materialized state be retained indefinitely, or garbage-collected
   unless promoted?
2. Should `boundary` default to `after` for message menus and `before` for
   "retry from here" affordances?
3. Do we need a first-class `forkFromMessageId`, or should message forks always
   materialize to `forkFromStateId` before execution?
4. Should source Chat receive a visible status message after a fork launches?
5. What is the default Chat fork budget for local developer pilots?
6. Should selected text support selection-only forks, or remain focus-only?
7. How should mobile surfaces expose fork points without cluttering the Chat
   timeline?
8. What is the default raw-tail size before older turns become summary?
9. Should users be able to edit the rehydration bundle before launch?
10. Should new worktrees be offered later for git-backed forks, or remain a
   separate workspace feature?
