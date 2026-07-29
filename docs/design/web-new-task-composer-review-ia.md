# Review — Web · New task composer (IA + interaction lens)

Reviewer: `session-ms669cvk-vpkhaz` · lens: information architecture and interaction
Reviewing: [`web-new-task-composer.md`](./web-new-task-composer.md)
Code read: `packages/web/client/screens/agents/NewChatComposer.tsx`,
`packages/web/client/screens/agents/agents-rail.css`,
`packages/web/client/components/MessageComposer/{MessageComposer.tsx,RuntimePicker.tsx,runtime-picker.css,message-composer.css}`,
`packages/web/client/lib/{keyboard-nav.ts,session-start.ts}`,
`packages/web/server/create-openscout-web-server.ts:4420-4600,5435`

Direction (**task leads**) is not relitigated here. This pressure-tests execution.

---

## 0. The thing the brief misses: `RuntimePicker` already exists and already ships

`packages/web/client/components/MessageComposer/RuntimePicker.tsx` is *exactly* the
"runtime folds into the composer tool row" idea, already built, already styled to
`.s-msg-compose-tool` geometry, already portalled past the composer's `overflow:hidden`,
already in use at `screens/home/content.tsx:1291`. It answers open question 1 by
precedent: **harness is in the chip, collapsed to a `HarnessMark` glyph rather than a
word.** `.s-rt-chip` = `[mark] model │ EFFORT ▾`.

So the work is not "design a chip". It is "adopt `RuntimePicker` in `NewChatComposer`
and close the four gaps that adoption opens". Those gaps are concrete and they are
below. Building a second, parallel chip would be the real error here.

---

## 1. Does the tool row survive 560px? Yes — with 66px spare. The overflow vector is elsewhere.

### Measured budget at 560px

| Step | px |
|---|---|
| `.s-newchat-panel` width | 560 |
| − panel border 1+1 | 558 |
| − `.s-newchat-body` padding `--space-lg` 12+12 | 534 |
| − `.s-msg-compose-shell` border 1+1 | 532 |
| − `.s-msg-compose-toolbar` padding `--space-sm` 8+8 | 516 |
| − 2 × `column-gap: --space-sm` (grid `auto minmax(0,1fr) auto`) | 500 |
| − start column (`.s-msg-compose-icon-btn` 32px) | 468 |
| **`.s-msg-compose-toolbar-end` budget** | **468** |

Contents of the end cluster with the chip added:

`.s-rt-chip` (≤240, `max-width: min(240px, 46vw)`) + 6 + hint ≈80 + 6 + mic 32 + 6 + send 32 = **402px**.

**66px spare, hint retained.** It fits.

### The chip's own intrinsic width

Chrome is fixed: padding 9+7, mark 13, 4 × gap 6, divider 1, chevron 9 = **63px**.
Effort at `--text-2xs` 9px mono + `0.12em` ≈ 6.5px/char → `MEDIUM` ≈ 39, `MINIMAL` ≈ 45.
Model at `--text-sm` 11px mono ≈ 6.6px/char.

### The brief's example is not a real string

Live `GET /api/runner/options` on this machine returns 15 models. Longest `label`:

```
 6  default   Opus 5            13  default   GPT-5.6 Terra
10  default   Sonnet 4.6        15  observed   claude-opus-4-8
```

`source: "default"` labels max out at **13 chars** — the catalog also ships `family` and
`version` fields, so labels are pre-shortened by construction. "Claude Sonnet 4.5 (1m
context)" is not a string this endpoint can emit. Worst real chip = 63 + 45 + 99 = **207px**,
inside the 240 cap. No truncation today.

### The real overflow vector: `source: "observed"`

`hudRunnerModels()` (`create-openscout-web-server.ts:4434-4439`) appends every distinct
model string seen on a live agent with `label: model` — the **raw id**, no `family`, no
`version`, unbounded length. One agent launched against a Bedrock id
(`us.anthropic.claude-sonnet-4-5-20250929-v1:0`, 44 chars ≈ 290px) or a dated Anthropic id
(`claude-opus-4-1-20250805`) puts an arbitrary string in the chip. This is a **data**
problem and wants a **data** fix, not a wider box.

### Concrete fallback — three parts, in order

1. **Shorten at the source.** Render `family + " " + version` when both are present.
   For `source: "observed"`, normalize the id before display: strip provider prefixes
   (`us.anthropic.`, `anthropic/`, `openai/`, `xai/`), strip a trailing `-\d{8}` datestamp
   and a trailing `-v\d+:\d+`, then cap at 18 chars with a **middle** ellipsis
   (`us.anthropic.…-4-5-v1:0`). Tail-ellipsis is wrong for model ids — the discriminating
   token is the version, and it lives at the tail. CSS `text-overflow: ellipsis` on
   `.s-rt-chip-model` cannot do this; it must be a display function.
2. **Container queries, not the panel breakpoint.** Put `container-type: inline-size` on
   `.s-msg-compose-toolbar` and define an explicit degradation ladder. The composer also
   renders in the rail and the thread, where `@media (max-width: 620px)` is the wrong
   signal — a 560px modal on a 1400px display never trips it.

   | container `inline-size` | drop |
   |---|---|
   | `< 420px` | `.s-msg-compose-tools-hint` (already dropped at ≤620px viewport — move that rule here) |
   | `< 330px` | `.s-rt-chip-effort` + `.s-rt-chip-divider` — effort survives inside the panel |
   | `< 250px` | `.s-rt-chip-model` — mark + chevron only |

   The `HarnessMark` never drops. It is the one glyph that says where the work goes.
3. **Recoverability.** `title` on `.s-rt-chip` carrying the full untruncated
   `harnessLabel · model · effort`. `aria-label` already carries it
   (`RuntimePicker.tsx:204`); sighted users currently have no equivalent.

### Where it actually breaks (for the record)

`@media (max-width: 620px)` → panel `calc(100vw - 24px)`, body padding `--space-md`,
hint hidden. End budget = `100vw − 24 − 2 − 20 − 2 − 16 − 16 − 32 − 76`.

| viewport | chip cap `min(240,46vw)` | model text budget | legible chars |
|---|---|---|---|
| 390px | 179 | 179 − 63 − 39 = 77 | ~11 |
| 320px | 147 | 147 − 63 − 39 = 45 | ~6 |

At 320px the chip reads `◇ GPT-5.…│MEDIUM ▾` — the effort survives and the model, the
thing you'd actually change, does not. That inversion is what the ladder above fixes:
effort drops before model, because effort is recoverable from the panel and model is the
identity of the run.

---

## 2. Keyboard contract for in-place curated rows

### The defect the change makes worse before it makes it better

Today's rows are `<button>` elements (`NewChatComposer.tsx:852`) inside the overlay —
each is a tab stop, and `filteredProjects` is `.slice(0, 40)`. Tab from the project field
currently walks up to **41 buttons** before reaching the textarea. That is survivable only
because the overlay is transient. **Make the rows permanent and it becomes permanent.**
This is the single most important keyboard consequence of the reorder and the brief
does not mention it.

### Exact contract

Focus **never leaves the input.** Rows are `tabIndex={-1}` and are moved over by
`aria-activedescendant`, exactly as today.

| Element | Attributes |
|---|---|
| `#s-newchat-project-search` | `role="combobox"`, `aria-autocomplete="list"`, `aria-controls="s-newchat-project-results"`, `aria-expanded="true"` (constant — the list is always rendered), `aria-activedescendant="s-newchat-project-option-{activeProjectIndex}"` (drop the `projectPickerOpen &&` guard at `:823`) |
| `#s-newchat-project-results` | `role="listbox"`, static in flow — delete `position:absolute`, `z-index`, `box-shadow`, `top: calc(100% + …)` from `.s-newchat-project-results` |
| `.s-newchat-project-option` | `role="option"`, `aria-selected`, **`tabIndex={-1}`** (new), `data-active` unchanged |
| foot (`All {n} projects ›`) | `tabIndex={0}`, a real tab stop, placed **after** the listbox in DOM order, **outside** `role="listbox"` — it is an action, not an option |
| live region | visually-hidden `role="status" aria-live="polite"`, debounced 200ms, `"{n} projects match"` — in-place replacement gives a screen reader user no event to notice; the overlay's appearance used to be that event |

| Key | Behavior |
|---|---|
| `ArrowDown` / `ArrowUp` | ±1 with modulo wrap over `projectOptionCount`, `preventDefault` — **unchanged from `:618-627`**; parity is the requirement, do not "improve" it |
| `Home` / `End` | first / last row (new; cheap, and expected once rows are persistent) |
| `Enter` | commit active row → `selectProject` / `selectDirectPath`, then `textRef.current.focus()` — unchanged from `:628-636` |
| `Esc` | **needs a decision the brief doesn't make** — see below |
| `Tab` | leaves the field → composer textarea. Skips all rows (`tabIndex={-1}`). Then the foot. |
| typing | filters in place, `setActiveProjectIndex(0)`; clamp to `projectOptionCount − 1` if the set shrank |
| mouse | `onMouseDown` `preventDefault` + `onClick` — unchanged, keeps focus on the input |

### `Esc` — the regression nobody has scoped

`projectPickerOpen` is set `true` on **focus** (`:831-835`), and the `Esc` branch at
`:637-642` calls `stopPropagation()`. Net effect today: **while the project field has
focus, `Esc` can never close the modal.** Remove the popup and that stops being
accidental and starts being arbitrary.

Specify it: `Esc` in the project field consumes the event **only when
`projectQuery !== selectedProject?.title`** — i.e. there is a typed query to undo. It
restores the selected title and stops there. Otherwise it bubbles and the modal closes.
"Esc closes the dialog" stays the top-level contract, with exactly one cheap undo in front
of it.

### Also: stop making the field double as the readout

`onFocus` does `setProjectQuery("")` (`:833`). With rows in place, focusing the field
blanks the visible project name and re-renders every row — the destination disappears at
the exact moment you're choosing a destination. Split them:

- **Readout** — non-interactive line, always shows resolved `/{title}` + `shortProjectPath(root)`.
  This is iOS idea #4 and it is what deletes the `.s-newchat-target` chip strip
  (`:894-900`), including the `new worker` chip. Redundancy #4 in the brief goes away by
  *separating* the two roles, not by removing one of them.
- **Search** — empty by default, placeholder `Search projects or enter a path…`, never
  carries the selected title.

---

## 3. Where harness readiness lives with the card gone

Three classes of signal, three different homes, **no band, no new element.**

### (a) Per-harness readiness → the decision point, in the panel

Live catalog: 8 harnesses, `flue` and `pi` currently `ready: false`. Today
`harnessSelectOptions` (`:328-337`) sets `disabled: candidate.ready === false` on the
`<option>`. `RuntimePicker` takes `harnessOptions: readonly string[]` — **flat ids**. Adopt
it as-is and you get a panel showing `grok-acp` instead of `Grok ACP`, with `flue`
selectable, followed by a `start()` that fails. That is a new unbacked affordance created
by the refactor.

Fix in `RuntimePicker`, backward compatible with `home/content.tsx:1291`:

```ts
type RuntimeOption = string | { value: string; label: string; disabled?: boolean; detail?: string }
harnessOptions: readonly RuntimeOption[]
modelOptions:   readonly RuntimeOption[]
```

`.s-rt-opt[aria-disabled="true"]` → `opacity: .45`, `pointer-events: none`, `title={detail}`
(`"Flue is not installed yet."`). The readiness constraint sits on the option it constrains.

### (b) Selected-harness readiness → the chip mark

`.s-rt-chip[data-ready="false"] .s-rt-chip-mark { color: var(--red) }`, and append
`", unavailable"` to the existing `aria-label`. Readiness is a property of the harness, so
it rides the glyph that *is* the harness. Zero new elements.

### (c) Catalog-load error and loading → the hint slot that already exists

This is the answer to "without reintroducing a status band". `.s-msg-compose-tools-hint`
already occupies a slot on the toolbar row, already renders conditionally, and sits 6px
from the send button whose state it explains. Swap its content:

| condition | `tools` slot renders |
|---|---|
| default | `↵ send · ⇧↵ line` (unchanged) |
| `runnerLoading` | `role="status"` · `Loading models…` · `var(--muted)` |
| `runnerLoadError` | `role="status"` · `Model catalog unavailable — harness defaults only` · `var(--amber)` |
| `selectedHarness.ready === false` | `role="alert"` · `{label} unavailable` · `var(--red)` |

Same row, same slot, announced, adjacent to the control it disables.

**This closes a live invisible-block bug.** `runtimeBlocked = usesNewWorker &&
(runnerLoading || selectedHarness?.ready === false)` (`:379`) gates `canSend` (`:1049`).
The textarea autofocuses on mount (`:426-428`). A fast typist hits Enter during the
`/api/runner/options` round-trip and **nothing happens, with no explanation** — the only
explanation was the readiness pill in the card being deleted. Today it is masked by the
card. After the reorder it would be silent.

Note `sendTitle` is not a fix here: disabled buttons don't receive pointer events in
Chrome or Safari, so a `title` tooltip on `.s-msg-compose-send:disabled` never renders.

### Drop, don't relocate

`selectedHarness.detail` at rest ("Claude Code is ready for workspace, collaboration.")
is the brief's ceremony copy #5. It has one legitimate job — differentiating claude /
codex / cursor / grok at the moment of choosing — so it lives as `title` on `.s-rt-opt`
inside the panel and nowhere else.

---

## 4. Curation rule for the web project list

### What is actually backed

Verified against `ProjectLaunchTarget` (`lib/session-start.ts:7-14`) and the live snapshot:

| signal | source | verdict |
|---|---|---|
| route project | `routeAgent.projectRoot ?? cwd` → `preferredProjectRoot` (`:265`) | ✅ backed, already used by `chooseInitialProjectLaunchTarget` |
| server cwd | `configuration.context.currentDirectory` | ✅ backed |
| recency | `agents[].updatedAt`, already sorted at `:259-262` | ✅ backed — project recency = `max(updatedAt)` over agents whose `projectRoot ?? cwd` matches |
| `registrationKind` | live values `current` / `configured` / `discovered`, `null` for agent-derived | ✅ backed, **but not what iOS needs** |
| worktree / scratch / folder | — | ❌ **no such field** |

### The foot copy does not port

`"All 57 projects · 6 worktrees · 5 scratch · 3 folders ›"` has nothing behind it on web.
The studio fixture that sells it (`design/studio/views/project-picker.tsx:31`) invents a
`kind: "worktree"` field; the real `AgentConfigurationProject` (`lib/types.ts:225-233`) has
no equivalent. Shipping that foot violates the brief's own "No unbacked affordances"
constraint — and it is the *one* line in the iOS study whose whole point is honesty about
what's held back. Shipping it unbacked inverts its meaning.

**Ship:** `All {projectTargets.length} projects ›` — total only.
**Or back it first** (server-side, follow-up, not this pass): Scout already creates
worktrees at `<projectRoot>/.scout-worktrees/<agentName>`
(`server/core/mobile/service.ts:1271`) and this machine uses `~/dev/<repo>-worktrees/<name>`.
Either convention, or `git rev-parse --git-common-dir` at inventory time, can populate a
real `kind` on `AgentConfigurationProject` (emitted at
`create-openscout-web-server.ts:4692` and `:5082`). Then the breakdown is a fact.
A path-shape heuristic rendered as a count is a guess wearing a number.

### The rule — 4 rows, deterministic

1. **Route project** (`preferredProjectRoot`) if present — the project you're already in.
2. **Server cwd project** (`currentDirectory`) if distinct from 1.
3. **Fill to 4** by `max(agent.updatedAt)` desc, excluding 1–2.
4. Foot: `All {n} projects ›` → expands the same list in place (does not open an overlay —
   that would reintroduce the clipping this change exists to remove).

Zero query shows these 4. Typing replaces them in place with
`searchProjectLaunchTargets(...)` — which is already scored and already sorted
(`session-start.ts:83-95`), no change needed. Cap the typed set at 8 visible with the
foot switching to `{n} more matches ›`; `.slice(0, 40)` was sized for a scrolling overlay
and is wrong for rows in flow.

Route context does *not* make the list redundant — it fixes row 1 and thereby earns the
right to show only 3 others.

---

## 5. Attachments (`Route capture`) — does not survive the reorder cleanly

Two breaks, both from `usesNewWorker`.

**(a) A control that does nothing.** `usesNewWorker = !hasAttachments ||
!canUseExistingChat || mode === "new-session"` (`:378`). When it is false — attachments
routed to an existing chat — the whole `<section className="s-newchat-runtime">` is not
rendered (`:927`), because the destination conversation already has a runtime. Move
runtime into the composer and the chip renders unconditionally, offering a harness/model
choice that `routeCaptureToAgent()` (`:684`) never reads. Gate it:

```tsx
tools={usesNewWorker ? <RuntimePicker … /> : <StaticRuntimeReadout … />}
```

`.s-rt-chip--static`: same geometry, no chevron, `cursor: default`, not a button,
showing the target agent's `harness`/`model`. It states the destination rather than
pretending to set it.

**(b) The mode toggle is in the wrong band.** `Existing chat` / `New chat` (`:906-925`) is
a **destination** decision — it picks *which conversation*, same axis as the project. It
currently floats between the project chips and the runtime card, which is why it reads as
runtime configuration. Put it on the destination readout row, right-aligned, as a
2-segment control. Then the whole dialog is: composer (dominant) · destination (readout +
mode + search + rows) · runtime (one chip, inside the composer). Three bands, one job each.

**(c) Attachments belong inside the composer.** `.s-newchat-attachments` +
`AttachmentPreview` (`:179-218`, `:996-1006`) render as a **sibling above** the composer.
With task-leads the composer is the dominant element and its payload should ride inside
it. `MessageComposer` already has `.s-msg-compose-attachments` and the repo already ships
`ComposerAttachments` + `useComposerAttachments`, used by
`screens/chat/ConversationComposer.tsx:78` and `ConversationScreen.tsx:1274`. Adopting it
deletes ~40 lines of bespoke preview code and makes `Route capture` a composer with a
payload rather than a different dialog.

---

## 6. `RuntimePicker` — defects to fix during adoption, not after

1. **Model list is not harness-filtered** — stated in its own header comment
   (`RuntimePicker.tsx:16-18`). `NewChatComposer` filters today (`:323`). Adopt as-is and
   you either offer codex models under claude, or pass pre-filtered flat **ids** and the
   panel shows `claude-opus-5` where the card showed `Opus 5`. Needs the
   `{value,label}` prop change from §3(a).
2. **`RUNTIME_EFFORTS` is hardcoded, 8 entries** (`:33-42`). Live `/api/runner/options`
   scopes efforts per harness: claude supports 5 (`low`…`max`), codex 8 —
   `none`, `minimal`, `ultra` are **codex-only**. `NewChatComposer` already filters
   (`:324-325`) and must pass `effortOptions`, or claude users get three settings the
   harness rejects.
3. **Effort colour ramp inverts at the top.** `.s-rt-chip-effort` styles
   `low`/`medium`/`high`/`xhigh` (runtime-picker.css:107-110) — `max` and `ultra` fall
   through to inherited `var(--ink)`, so `XHIGH` renders `var(--accent)` and the two
   steps *above* it render duller. Either extend the ramp through all 8 or drop it to a
   single weight. Accent on an ordinal step is also categorical colour on an axis that
   isn't attention — `var(--accent)` should not be the top of a ladder.
4. **The portalled panel breaks the modal's focus trap.** `.s-rt-panel` is
   `createPortal(…, document.body)` (`:327`). `useFocusTrap`'s `onKeyDown`
   (`keyboard-nav.ts:37-62`) is a **React** handler on `.s-newchat-panel`, and React
   portals bubble through the React tree — so keydowns inside the panel reach it, while
   `node.contains(current)` is `false` because the panel is not in the modal's DOM subtree.
   Result:
   - `Shift+Tab` from the panel's first control → `preventDefault()` + focus the **last
     element of the modal** (`:52-55`). Focus teleports out of the open panel.
   - `Tab` forward → `current === last` is false, no `preventDefault`, native Tab from a
     node at the end of `<body>` → focus leaves the `aria-modal` dialog entirely.

   Fix: `useFocusTrap` must accept extra containment roots
   (`contains = node.contains(el) || extraRoots.some(r => r.contains(el))`), and
   `RuntimePicker` must register its panel while open. `Esc` is already correct — the
   picker's `document` listener `stopPropagation`s before the modal's `window` listener
   (`NewChatComposer.tsx:410-418`), so `Esc` closes the picker only.
5. **No roving tabindex.** `.s-rt-opt` elements carry `role="radio"` / `role="option"`
   but are all natively tabbable, and neither `radiogroup` nor `listbox` implements arrow
   navigation. With 8 harnesses + 15 models that is 23 tab stops and an ARIA pattern that
   announces a listbox it cannot drive. Roving tabindex + Arrow keys per band, `Tab` moves
   between bands.

---

## Verdict

The direction is right and it is cheaper than the brief assumes — `RuntimePicker` is
already built and already solves the clipping problem by portalling. Three things must
land with it, or the reorder trades visible clutter for invisible failure:

1. **§3(c)** — readiness/loading in the hint slot. Without it, `runtimeBlocked` becomes a
   send button that silently does nothing.
2. **§2** — `tabIndex={-1}` on rows plus a defined `Esc`. Without it, persistent rows turn
   40 accidental tab stops into a permanent fixture and `Esc` stops closing the dialog.
3. **§6.4** — focus-trap containment for the portalled panel. It is broken in both Tab
   directions today, in a dialog that claims `aria-modal="true"`.

And do not ship the iOS foot copy. `worktrees · scratch · folders` has no field behind it
on web (§4). Total only, until someone backs it.
