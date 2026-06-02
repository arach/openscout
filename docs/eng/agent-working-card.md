# Agent Working Card — Design Spec

Status: proposal · Surface: web (Home / Fleet / Inspector) · Sizes: `sm`, `md`, `lg`

## Intent

A single card primitive that answers four operator questions without scrolling:

1. **What** is the agent doing? (current task title)
2. **Is it actively doing things right now?** (live execution signal)
3. **What is the latest meaningful thing it did?** (last checkpoint)
4. **Has an answer / deliverable arrived?** (reply state)

The card is a **work-in-progress instrument panel**, not a status sentence. It is dense, legible, and quiet — readable in a list of 30 with no glow, no marketing copy, no exclamation.

Grounded in the existing `NowCard` pattern (`packages/web/client/screens/HomeScreen.tsx:1323`), the `FleetAsk` shape (`packages/web/client/lib/types.ts:312`), and the execution-plane framing in `docs/working-status-proposal.md`.

## Two orthogonal concepts (do not collapse)

The card always represents these as two distinct fields, never merged into one verb:

| Concept | Source | Decays? |
| --- | --- | --- |
| **Actively working** — execution-plane liveness (process is producing events) | runtime flight | yes, on quiet ticks |
| **Open task** — there is a pending ask the agent owes a reply to | FleetAsk lifecycle | no, only on terminal reply |

An agent can be *working but no open task* (autonomous tick), *open task and working* (the common case), or *open task and idle* (between turns, thinking, waiting on a tool). Each of these reads differently. There is no fourth state the card needs to render — a closed task with no execution is just a completed card.

> The card never uses "stale", "inactive", "timed out", "lost". A requester / UI synchronous timeout is a UI-side non-event and **must not** surface here.

## Signals the card consumes

Required from the framework (named on the data contract below). Anything not present renders as absent, never as `—` placeholder noise.

- Identity: `agentName`, `agentHandle`, `harness`, `model`, `branch`, `cwd`
- Task: `taskTitle`, `taskSummary`, `openedAt`
- Liveness: `executionState` (`working` | `idle` | `awaiting_tool` | `awaiting_input`), `lastEventAt`
- Last checkpoint: `lastCheckpoint` (one line, model-authored, see Summaries)
- Material: `diffStat { additions, deletions, filesChanged }`, `filesTouched[]`
- Effort: `tokens { input, output, cacheRead }`, `toolSteps`, `reasoningSteps`
- Reply: `replyState` (`none` | `partial` | `delivered`), `deliveredAt`
- Control: `canCancel`, `cancelHref` (only if framework actually supports it)

## Visual language

- **Type**: same family as existing `s-now-card`. Numbers are tabular-figure. Identifiers (handle, branch, harness) are monospace at one step down.
- **Colour**: ink + one accent dot. Active = the existing live-dot. No coloured fills.
- **Live signal**: small dot + last-event tick under the avatar. The dot is steady (not pulsing) when an event has landed in the last ~6s; otherwise it dims one step. No spinners.
- **Counts**: leading glyph + tabular number (`Δ +212 / −38`, `⌬ 4 files`, `↻ 12 steps`, `◇ 38k tok`). Glyphs are hand-drawn in code, single weight (per `feedback_custom_glyphs`).
- **Dividers**: solid lift in the same hue. No white-with-alpha rules (per `feedback_no_white_alpha_dividers`).
- **Density**: `sm` 28px row height, `md` ~140–160px, `lg` ~280–340px. All sizes share the same atoms — only the metric rail and the body grow.

---

## `sm` — Compact row

Use in: Fleet list, sidebar Now strip, Ops tail header, search results.

### Layout

```
[•] @handle/branch · harness    task title, truncated mid             ⌬3  Δ+91/−12   ◇24k   1m12s
```

A single row. 28–32px tall. Three column blocks separated by a `·`:

1. **Identity block** (fixed width, left-aligned): live dot + `@handle` (monospace). Branch as a chip when ≠ default. Harness as a chip when ≠ project default.
2. **Task block** (flexes): one line, truncated *middle-out* so both the verb and the object survive. No second line — even for long tasks.
3. **Metric rail** (right-aligned, tabular): up to four metrics. Priority order:
   1. files changed (if non-zero)
   2. diff stat (if non-zero)
   3. tokens (if available)
   4. elapsed since `openedAt`

### Hierarchy

Identity is the visual anchor on the left, elapsed time is the anchor on the right. The task title carries weight only via being the only sentence-case text on the row.

### Interactions

- Whole row is the click target → opens `md`/`lg` inspector.
- Hover reveals the cancel affordance inside the metric rail, replacing the rightmost metric, only when `canCancel` is true. The cancel is a glyph, not the word "Cancel".
- Keyboard focus: row-level focus ring, identical to existing list rows.

### States

- **Loading row** (first data not yet flowed): identity block shown, task block shows a slim shimmer at typographic baseline only, no metric rail.
- **Empty / no signals yet** (process just started, no events): show identity + task + the single phrase `starting` in the rail position. Never a spinner.
- **Reply delivered** (terminal): the live dot becomes the delivered glyph, the rail collapses to `delivered · <age>`, the row remains in the list until the operator clears it.

### Do not show on `sm`

- Last checkpoint (truncating it murders it — see `lg`).
- Reasoning step count (low signal in a single row).
- Model name (lives in the inspector — repeats are noise across the list).
- Any narrative verb ("is currently working on…") — sm is fields, not prose.

---

## `md` — Home / Fleet primary card

Use in: Home `NowCard` slot, Fleet primary grid.

### Layout

Three stacked bands at fixed proportions, ~140–160px total:

```
┌──────────────────────────────────────────────────────────────┐
│ [avatar] Agent Name                                live ·  3s│  ← head band
│         @handle · harness · model                            │
├──────────────────────────────────────────────────────────────┤
│ Task title in sentence case, two lines max                   │  ← task band
│ ↳ last checkpoint, one line, model-authored                  │
├──────────────────────────────────────────────────────────────┤
│ ⌬ 4 files · Δ +212 / −38 · ↻ 12 steps · ◇ 38k · 1m12s  │ branch│  ← rail band
└──────────────────────────────────────────────────────────────┘
```

### Exact fields

**Head band**
- Avatar (existing `s-avatar` 28px, colour from `actorColor`)
- `agentName` (ink, semibold)
- `@handle · harness · model` on the meta line (monospace one step down, ink, no dim per `feedback_no_dim_text_in_menu`)
- Right slot: `live` chip with steady dot + age of last event (`3s`, `42s`, `2m`). When `executionState === "awaiting_tool"`, the chip reads `awaiting tool` with the same dot; when `awaiting_input`, it reads `awaiting input`. When `replyState === "delivered"`, the chip swaps to a delivered glyph + `delivered`.

**Task band**
- Line 1: `taskTitle` (sentence case, two lines max, ellipsis on the second).
- Line 2 (prefixed with `↳`): `lastCheckpoint`. One line, hard truncated. Absent if `lastCheckpoint` is null — do not show the `↳` glyph alone.

**Rail band**
- Left rail: metrics in fixed order, `·` separated. Show only non-zero, non-null. Cap at five chips so the rail never wraps.
  - `⌬ {filesChanged} files`
  - `Δ +{additions} / −{deletions}`
  - `↻ {toolSteps} steps`
  - `◇ {tokens.output}` (formatted `24k`, `1.2M`)
  - `elapsed` (since `openedAt`, e.g. `1m12s`, `14m`, `2h`)
- Right: `branch` as a small chip. No project name (the surrounding shell carries that).

### Interactions

- Card body click → `lg` inspector (or `WorkDetail` route).
- Hover reveals a single right-aligned action zone inside the rail band: `Cancel` glyph (only when `canCancel`), followed by `Open` glyph. The action zone is the rightmost ~64px and never overlaps metrics — metrics slide left.
- Live chip is clickable when there is a follow surface (opens the Observe tab on the agent).

### States

- **Loading** (card mounted, first event pending): head band populated, task band shows a single-line skeleton at title baseline, rail band shows `starting · {elapsed}`.
- **Open task, no execution yet** (queued): live chip reads `queued`, dot is hollow. Task band shows the task and no checkpoint. Rail shows `queued · {age since openedAt}`.
- **Reply delivered**: head band live chip swaps to `delivered`, task band keeps the title and replaces checkpoint with `↳ reply ready · {age}`. Rail compresses to final material counts only (no `elapsed since open` — that becomes `took {duration}` in the inspector).
- **Cancelled by operator**: live chip reads `stopped`, dot is hollow. Rail shows `stopped · {age}`. The card persists in the list until the operator clears.

### Do not show on `md`

- Stale / inactive / waiting-timeout language.
- A summary of the *agent's reasoning* — that belongs in `lg`.
- Avatar count badges, online-presence dots — that is Fleet topology, not work state.
- Model marketing phrases (`opus-4-7-claude…` — keep the canonical id, never a friendly nickname).
- A second action button row. Only the hover zone.

---

## `lg` — Expanded inspector

Use in: WorkDetail screen, Fleet detail pane, channel hover preview, Scoutbot referenced-work expansion.

The `lg` card is the `md` card plus three appended sections. The head/task/rail bands above stay byte-identical so the `md → lg` expansion never reflows the operator's reading anchor.

### Appended sections (in order)

**1. Last meaningful activity** (always)
- A 3–5 line model-authored paragraph summarising the most recent ~30s of execution.
- Each line is one structural beat: what the agent decided, what it did, what surfaced.
- Title above is `Last activity · {age}`.

**2. Material** (when present)
- `filesTouched[]` as a compact list, max 6, each row `{path}  Δ +{a} / −{d}`. Overflow as `+N more →` linking to the diff viewer.
- Path tokens use the existing `path-token` atom so hover preview works.

**3. Run instrumentation** (always)
- A two-column key/value list, monospace, tabular:
  - `started` → wall clock `14:32:08` + `(1m12s ago)`
  - `harness` → harness id
  - `model` → canonical model id
  - `tokens` → `in 12.4k · out 25.8k · cache 91k`
  - `tool steps` → `12 (4 read, 6 edit, 2 bash)` if the breakdown is available; otherwise just the integer
  - `reasoning steps` → integer, only when available; omit row otherwise
  - `last event` → `3s ago` + small event-kind chip

### Interactions

- **Cancel / stop** lives here as a real button on the rail band, labelled `Stop`, only present when `canCancel`. Confirmation is inline (button morphs to `Stop · confirm`), not modal.
- **Open conversation** opens the conversation tab anchored on the ask.
- **Diff peek**: clicking a row in Material opens the existing `FilePreviewOverlay`.
- **Pin** (optional, low priority): pin this card to the Home Now strip even after delivery, until cleared.

### States

- **Loading** (inspector opened, framework data not yet hydrated): head/task/rail bands stay live, the three appended sections show typed skeletons (line counts match expected payload).
- **Delivered**: instrumentation row `started` adds `· took {duration}`. Last-activity title becomes `Final activity`. Stop button removed.
- **Cancelled**: instrumentation row `last event` records the stop. Last-activity section is preserved as the final state.

### Do not show on `lg`

- Raw event log (that is the Observe tab — link to it).
- A timeline visualisation — instrumentation is a list, not a sparkline. (Sparkline is a Fleet/Ops concern, not the card.)
- Cost in dollars. Tokens only, since pricing varies and the card is not a billing surface.
- A retry button — re-asking is a conversation action, not a card action.

---

## Data contract proposal

A single shape, hydrated by the runtime, consumed unchanged by all three sizes. Sizes pick their own subset; the runtime never sends a size-specific payload.

```ts
export type AgentWorkingCardProps = {
  // identity
  agentId: string;
  agentName: string;
  agentHandle: string | null;       // without leading "@"
  harness: string | null;           // canonical id, e.g. "claude-code"
  model: string | null;             // canonical id, e.g. "claude-opus-4-7"
  branch: string | null;
  cwd: string | null;

  // task (open-task plane)
  task: {
    invocationId: string;
    flightId: string | null;
    title: string;
    summary: string | null;
    openedAt: number;               // ms epoch
    status: "queued" | "working" | "needs_attention" | "completed" | "failed";
  };

  // liveness (execution plane)
  execution: {
    state: "working" | "idle" | "awaiting_tool" | "awaiting_input";
    lastEventAt: number | null;     // ms epoch — drives the live chip age
    startedAt: number | null;       // first execution event for this turn
  };

  // last meaningful checkpoint (model-authored, single line for md; paragraph for lg)
  checkpoint: {
    line: string | null;            // <= ~90ch, hard truncated by author
    paragraph: string | null;       // 3–5 lines, lg only
    at: number;                     // ms epoch
  } | null;

  // material
  material: {
    diffStat: { additions: number; deletions: number; filesChanged: number } | null;
    filesTouched: Array<{ path: string; additions: number; deletions: number }>;
  };

  // effort
  effort: {
    tokens: { input: number; output: number; cacheRead: number } | null;
    toolSteps: number | null;
    toolStepsByKind: Record<string, number> | null;  // optional breakdown
    reasoningSteps: number | null;
  };

  // reply / deliverable
  reply: {
    state: "none" | "partial" | "delivered";
    deliveredAt: number | null;
    deliverableHref: string | null; // route to the rendered reply, when delivered
  };

  // control
  control: {
    canCancel: boolean;
    cancelHref: string | null;      // POST target; omitted entirely when not supported
  };

  // routing
  routes: {
    open: Route;                    // primary click → inspector
    observe: Route | null;          // live chip click
    conversation: Route | null;     // header click
  };
};
```

Notes on the contract:

- All numeric counters are integers. `effort.tokens` is null when the harness does not report; the card omits the chip rather than rendering `0`.
- `execution.lastEventAt` is the **only** input to the live-chip age. Never derive it from `task.updatedAt` — that conflates the two planes.
- `control.cancelHref` is omitted (not nulled with `canCancel: false`) when the harness simply does not support cancellation, so the UI can treat absence as "this dimension does not exist for this agent".
- There is no `isStale`, `inactiveSince`, or `timeoutAt`. The runtime does not send these and the card does not derive them.

---

## Deterministic UI vs model-authored summary

Split sharply so the card stays predictable and the operator builds an accurate mental model of what they're reading.

### Deterministic UI (rendered from structured fields, never via a model)

- Live chip text and dot state — derived from `execution.state` + `lastEventAt`.
- All metric rail chips (files, diff, tokens, steps, elapsed).
- Identity line (handle, harness, model, branch).
- All states (queued, working, awaiting tool, delivered, stopped).
- Run instrumentation key/values in `lg`.

These are pure projections of structured data. They must be byte-stable across renders so the operator can scan a list of 30 cards without re-reading.

### Model-authored (a model produced this string at this checkpoint)

- `checkpoint.line` — the one-line "last meaningful thing" on `md`.
- `checkpoint.paragraph` — the 3–5 line `Last activity` block on `lg`.

These are written by the agent itself (or a cheap summariser attached to its event stream) and are explicitly labelled in the schema as model-authored so a reader knows the difference between an instrument reading and an interpretation. They are allowed to be opinionated and concrete ("settled on Drizzle for the runtime store; backing out of the bun:sqlite migration path"). They are not allowed to be marketing-toned, anthropomorphic, or to describe the act of working ("I am currently working on…" is banned — that is what the live chip is for).

### Task title (`task.title`)

This sits in between. It is operator-authored when the ask came from a human, and model-authored when an agent generated a sub-ask. Either way it is **not** re-summarised by the card. The card renders it verbatim. If it is long, the card truncates structurally (middle-out on `sm`, two-line clip on `md`).

---

## Open questions for the runtime owner

1. Where does `checkpoint.line` come from today? If no source exists, the framework needs a cheap per-turn summariser (a sub-agent or a hook on the event stream). Without it, `md` regresses to `taskTitle` only and loses its primary signal.
2. Is `toolStepsByKind` cheap to project, or do we keep the breakdown deferred to `lg` only on demand?
3. Cancellation surface: `cancelHref` implies the harness exposes a stop endpoint. For harnesses that don't, the card simply hides the affordance — confirm there's no half-supported middle ground we need to model.

These are deliberate gaps in the contract, not handwaves. Each one is a small piece of work the framework owner can pick up independently of card implementation.
