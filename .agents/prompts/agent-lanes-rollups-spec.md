# Assignment

Implement Agent Lanes roll-ups per this spec on the current OpenScout working tree. Priority: **Phase 1** (LaneFacts, observeCache wiring, metadata/usage enrichment) and remaining **Phase 2** trace roll-ups. Run the listed `bun test` commands before reporting back with files changed, behavior summary, and remaining gaps.

---

# Agent Lanes — Roll-ups & Progressive Disclosure Spec

**Author:** Grok (via OpenScout web/agent-lanes design session)
**Date:** 2026-06-19
**Repo:** `/Users/art/dev/openscout`
**Audience:** Codex implementer — implement in `packages/web` first; extract shared logic for macOS later.

---

## Problem

Agent Lanes is a horizontal monitoring wall: one column per actively working harness session (Claude, Codex, Grok, Cursor, OpenCode, scout-managed workers). Operators want **situational awareness at a glance** — thinking, tools, files, cadence — without reading full chain-of-thought or full markdown. They must be able to **expand on demand** when something catches their eye.

Today lanes are **tail-first** (`useTailFeed` + `buildAgentLanes`). Synthetic observe from tail is thinner than polled observe. Harness-specific activity understanding (especially Codex) was incomplete; partial fixes landed in this branch but the **roll-up model** needs to be completed and unified.

---

## Design principles

1. **Scan by default, dive on demand** — collapsed snippets in the column; `More` / detail sheet for full content.
2. **One firehose, two layers** — tail drives roster + trace; a parallel **LaneFacts** layer holds metadata (model, branch, usage, files) without polluting the trace.
3. **Work-mode trace** — filter streaming noise (Grok phases, Codex token counts, chunk tool-results); keep substantive actions and reasoning snippets.
4. **Harness-aware mapping** — same UI, different tail→observe policies per `source` (`codex`, `grok`, `claude`, …).
5. **Stable columns** — first-seen order (`sortLanesWithStableOrder`); don't reshuffle on poll.
6. **Progressive richness** — Codex > Claude > Grok for thinking visibility until Grok emits discrete reasoning summaries.

---

## Architecture (target)

```
useTailFeed + scout agents [+ useObservePolling → observeCache]
        ↓
buildAgentLanes()                    ← pure domain (packages/web/.../agent-lanes-model.ts)
        ↓
AgentLane { agent, source, observe, lastActiveAt, current }
        ↓
AgentLaneSummaryCard               ← headline + LaneFacts chips + stats + recent files
AgentLaneColumn → SessionObserve   ← variant="lane", traceLimit=22
AgentLaneDetailSheet               ← full facts, plans, docs, touched files, open session
```

### Extract later (macOS / shared)

Move to `packages/lanes` or export from runtime client:

- `agent-lanes-model.ts`
- `tail-display.ts` (observe mapping + noise policy)
- `lane-observe.ts` (snippets, file inference)
- `observe-display.ts` (collapse/merge rules)
- `agent-lane-preview.ts`, `agent-lane-detail.ts`

---

## LaneFacts (new struct)

Attach to `AgentLane` or embed in `observe.metadata`:

```typescript
type LaneFacts = {
  model?: string;
  effort?: string;           // codex turn_context
  branch?: string;
  originator?: string;       // "Codex Desktop", CLI, scout-managed
  attribution?: TailHarness; // scout-managed | hudson-managed | unattributed
  turn?: { phase: "idle" | "started" | "complete"; index?: number };
  usage?: ObserveUsageMeta;  // aggregated from token_count events
  currentTask?: string;      // latest user ask or thread title snippet
  touchedFiles: ObserveFile[];
};
```

**Population sources:**

| Field | Source |
|-------|--------|
| model, effort, originator | Codex `session_meta` / `turn_context` from transcript head; Claude observe metadata |
| branch | observe metadata or git from transcript |
| attribution | `resolveTranscriptAttribution(transcript, processes)` |
| turn | `task started` / `task complete` note events |
| usage | Aggregate filtered `tokens · N` codex events; full observe for scout lanes |
| touchedFiles | `filesFromObserveEvents()` + full observe files when available |
| currentTask | Latest `ask` or first user message in active turn |

Implement `buildLaneFacts(transcript, events, agent, processes, observe?)` in `agent-lanes-model.ts` or `lane-observe.ts`.

---

## Timeline roll-ups (SessionObserve `variant="lane"`)

### Event display modes

| Kind | Collapsed (default) | Expanded (`More`) |
|------|---------------------|---------------------|
| `think` | 3 lines / ~180 chars italic snippet | Full reasoning text, scrollable |
| `tool` | `Shell · git status` (truncated arg) | Full command, diff preview, stream |
| `message` | Plain snippet | Full `MessageMarkup` markdown |
| `ask` | Plain snippet | Full ask + answer if present |
| `note` | `Turn started` / `Turn complete` | — (no expand) |

**Implemented (partial):** `LaneExpandableText`, tool `More`, think collapse in `observe-display.ts`. **Finish:** diff stats in collapsed tool header (`+12 −4`), Read/Edit glyph emphasis.

### Merge / collapse rules (`collapseObserveDisplayRows`)

| Pattern | Behavior |
|---------|----------|
| Grok tool started → completed | Merge to one row with outcome |
| Permission requested → resolved | Merge to one row |
| Consecutive identical signature | `×N` repeat count |
| Consecutive `think` events | Keep latest text + `(N reasoning updates)` |
| Consecutive identical `Shell · rg …` | Collapse to `×N` (optional, harness-specific) |

### Cadence (keep)

- Elapsed time per row (`fmtLaneRowTime`)
- `+Ns` gap markers when gap > 15s
- Enter/nudge animations when following live
- Accent spine + tick marks (lane CSS)

### Trace limits

- Synthesize last **48** events in `observeDataFromTail`; display last **22** in column
- Detail sheet may show more or link to full session observe

---

## Summary card (`AgentLaneSummaryCard`)

### Header (existing + add)

- Primary: project (`lanePrimaryLabel`)
- Sub: harness · session id fragment · `timeAgo`
- Badge: harness name; **Live** pill when `isAgentLaneLive`

### Spec row (add)

Single line under header:

`gpt-5.5 · xhigh · codex · scout-managed · main`

From `LaneFacts` + agent record.

### Focus panel (enhance)

**Headline selection (`previewFocusEvent`):**

1. If live + turn started: prefer latest `think`
2. Else if live + tool in last 30s: prefer latest substantive `tool`
3. Else latest `message` / `ask` / `note`

**Detail:** 220-char snippet of focus event.

### Foot stats (existing)

tools · edits · reads · thinks · files

### Recent files chips (enhance)

Show up to 5 from `LaneFacts.touchedFiles` with state badge (`read` / `mod` / `new`). Click → detail sheet file section or repo-diff if path resolvable.

---

## Detail sheet (`AgentLaneDetailSheet`)

Keep **stats / plans / docs / touched files** — no trace replay.

**Add:**

- **LaneFacts** block: model, effort, originator, attribution, turn, session id, cwd, branch
- **Usage** cards when `LaneFacts.usage` populated
- **Latest reasoning** — expandable full text from last `think` event (not in column)
- **Open in tail** — `navigate({ view: "ops", mode: "tail", tailQuery: sessionId })` for native lanes

---

## Harness policies (`tail-display.ts`)

### Codex

**Noise (filter, don't display):** `user_message`, `agent_message`, `[reasoning]` empty, `turn context`, `tokens ·`, `session …`, chunk `tool-result`, `*_end` lifecycle duplicates.

**Substantive (lane inclusion):** tool, assistant, user, `task started/complete`, reasoning with content → `think`.

**Tool mapping:** `exec_command` → `Shell · <cmd>`; `apply_patch` / `patch_apply` → `Edit · patch`; parse truncated JSON `cmd` field.

### Grok

**Noise:** `phase · streaming_*`, `loop *`, `first token`, `tool_execution` streaming.

**Substantive:** tool started/completed, permission events, `turn *` (non-streaming).

**Thinking (future):** On turn end, synthesize one `think` snippet from accumulated reasoning if runtime retains it; do not un-filter streaming phases into trace.

### Claude

Map extended thinking to `think` when tail/observe exposes it. Tool names as-is (Read, Edit, Bash).

---

## Data wiring gaps (must fix)

### 1. `observeCache` not passed in `AgentLanesView`

`buildAgentLanes` supports broker-only scout agents without tail transcript. Wire `useObservePolling` (or batched `GET /api/agents/{id}/observe` for active lane ids only).

### 2. Scout-managed Codex without scout agent card

**Fixed:** show native lane when scout-managed but no `harnessSessionId` match. Verify in production.

### 3. `observeDataFromTail` metadata enrichment

Parse transcript head for codex `session_meta` / `turn_context`; aggregate usage from tail token events into `metadata.usage`.

### 4. File inference

**Partial:** `filesFromObserveEvents` in `lane-observe.ts`. Extend: `apply_patch` path extraction, `Read({path})` JSON, `git diff -- path`.

---

## UI components

| Component | Path | Notes |
|-----------|------|-------|
| `lane-observe.ts` | `packages/web/client/lib/` | Snippets, file inference, `laneToolArgSnippet` |
| `LaneExpandableText` | `SessionObserve.tsx` | Reusable More/Less |
| `agent-lane-preview.ts` | `previewFocusEvent`, live think preference |
| `agent-lanes-model.ts` | `buildLaneFacts`, `observeDataFromTail` enrichment |
| `session-observe.css` | `.s-observe--lane` expandable styles |

---

## Implementation phases

### Phase 1 — Facts layer (P0)

- [ ] `buildLaneFacts()` + wire into `buildAgentLanes`
- [ ] Enrich `observeDataFromTail` metadata from transcript head
- [ ] Aggregate codex `tokens ·` into `metadata.usage`
- [ ] Summary spec row + usage in detail sheet when present
- [ ] Wire `observeCache` in `AgentLanesView`

### Phase 2 — Trace roll-ups (P0, partial done)

- [x] Think snippet + expand
- [x] Message/ask snippet + expand (markdown on expand)
- [x] Tool snippet + expand
- [x] Think run collapse
- [ ] Tool diff stats in collapsed header
- [ ] Identical shell command `×N` collapse

### Phase 3 — Engagement (P1)

- [ ] File chip click → highlight in detail / open diff
- [ ] Detail sheet "Latest reasoning" section
- [ ] Open in tail / open session parity for all harnesses
- [ ] `currentTask` from latest user message in summary

### Phase 4 — Grok + Claude parity (P2)

- [ ] Grok reasoning synthesis at turn boundary
- [ ] Claude extended thinking → `think` mapping
- [ ] Topology/subagents in detail sheet (`metadata.topology`)

### Phase 5 — macOS (P3)

- [ ] Extract lane package
- [ ] `ScoutLanesStore` + native columns or `/embed/lanes`

---

## Tests

| File | Coverage |
|------|----------|
| `lane-observe.test.ts` | snippets, file inference |
| `observe-display.test.ts` | think merge, tool pairs, permissions |
| `agent-lanes-model.test.ts` | scout-managed native, session refs, horizons |
| `tail-display.test.ts` | codex noise, tool mapping |
| **New:** `agent-lane-preview.test.ts` | `previewFocusEvent` priority |

Run: `bun test packages/web/client/lib/lane-observe.test.ts packages/web/client/lib/observe-display.test.ts packages/web/client/screens/ops/agent-lanes-model.test.ts`

---

## Acceptance criteria

1. **Codex lane** shows: model/effort in summary spec row; shell commands as `Shell · …`; reasoning snippet with More; file chips from sed/Read/rg; turn milestones; live think in summary during active turn.
2. **Grok lane** shows: tools without streaming noise; permission merges; no empty columns from phase churn.
3. **Claude lane** shows: same expand pattern; scout lane uses observeCache when no tail match.
4. **Expand** never required to understand "what are they doing"; **More** reveals full markdown/command/diff.
5. **Detail sheet** has usage when codex session has token events; plans/docs still heuristic-scored.
6. All existing agent-lanes-model tests pass; new tests for LaneFacts and preview focus.

---

## Key file paths

```
packages/web/client/screens/ops/AgentLanesView.tsx
packages/web/client/screens/ops/AgentLaneSummaryCard.tsx
packages/web/client/screens/ops/AgentLaneDetailSheet.tsx
packages/web/client/screens/ops/agent-lanes-model.ts
packages/web/client/screens/ops/agent-lane-preview.ts
packages/web/client/screens/ops/agent-lane-detail.ts
packages/web/client/lib/tail-display.ts
packages/web/client/lib/lane-observe.ts
packages/web/client/lib/observe-display.ts
packages/web/client/screens/sessions/SessionObserve.tsx
packages/web/client/screens/sessions/session-observe.css
packages/runtime/src/tail/codex-source.ts
```

---

## Codex task

Implement **Phase 1** and remaining **Phase 2** items on branch `codex/preserve-in-flight-work` (or current working branch). Preserve uncommitted intentional work per `Agents.md`. Run tests listed above before finishing.

When done, report:

1. What changed (files + behavior)
2. Screenshots or describe summary/trace for a live Codex session
3. Remaining gaps for Phase 3–5

Do not rewrite Mission Control or full SessionObserve default mode — lane variant only unless shared helpers belong in `tail-display.ts` / `lane-observe.ts`.
