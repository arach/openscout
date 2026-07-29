# New task — composer-first

Review of `design/studio/views/new-task-launch-log.tsx` (compose phase) against the
direction: *opening the modal is for writing the message.*

Study: http://127.0.0.1:43140/studies/new-task-launch-log

---

## 1. Hierarchy critique

**The modal is titled "New task" and the task is the last, smallest thing in it.**
Reading order today is Project → three chips → "Run with" card → message. The
textarea is `rows={2}` (`new-task-launch-log.tsx:534`) sitting under roughly 200px of
configuration. Config-to-message area is about 4:1. The dominant surface is settings
that are already correct most of the time.

**"Run with" is a card that argues for itself.** Heading, explanatory subtitle, a
Ready pill, three labelled selects, and a readiness sentence — five pieces of chrome
for three values (`:506–527`). `RuntimePicker` already collapses exactly these three
into one chip (`◈ Opus · MEDIUM ⌄`) and its own docstring makes this argument
verbatim (`design/studio/components/RuntimePicker.tsx:14–24`). The study is
re-litigating a decision the component library already settled.

**Project is over-built for a value that should usually be inherited.** Search icon +
clear X + three chips = four elements restating one selection (`:492–504`). The route
chip `/Openscout Native New Chat Return Submit` and the path chip
`~/dev/openscout-native-new-chat-return-submit` are the same fact in two notations.
`new worker` is a consequence, not a choice.

**Five section labels for one sentence.** Project · Run with · Harness · Model ·
Effort. The sentence is "run this task, in this project, on this runtime." Only one
of those five needs a label, and it's none of them.

**Accent is spent on readiness.** The emerald dot reports "Ready" (`:510–516`), which
is a readiness roster in miniature — agents are framed by activity, not availability.
The ledger's accent discipline (one pulse, on the line doing work) is right; the
compose phase undercuts it.

**The answer is already in the file, on the other side of send.** `LaunchBody`
(`:589–607`) has the correct hierarchy: one faint mono context line, the task text as
the largest element, detail below. Compose should be that layout's sibling, not its
inverse.

**Validation blocks writing before it should.** Production disables send with no
project (`packages/web/client/screens/agents/NewChatComposer.tsx:805,807`). That
gates the writing on a routing decision. The direction to allow writing and validate
on submit is correct and is a real behavioural change, not a restyle.

---

## 2. First iteration

Modal stays 500px wide.

```
┌ New task                                          ✕ │  title row
│                                                      │
│  ~/dev/openscout · main                           ⌄  │  project readout — 24px, mono 11px, faint
├──────────────────────────────────────────────────────┤  hairline, full bleed
│  ┌────────────────────────────────────────────────┐  │
│  │ Describe the task…                             │  │  textarea — min 120px, 15px sans
│  │                                                │  │  autofocus, grows to 260px then scrolls
│  │                                                │  │
│  │ /                        ◈ Opus · MED ⌄     ↑  │  │  tool row, 36px
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Project readout

- One 24px line. Mono 11px (`text-2xs`), `studio-ink-faint`: `path · branch`. No
  kicker, no search icon, no X, no chips. The path is its own label.
- Borderless at rest; trailing caret only (reuse `Caret` from `RuntimePicker.tsx:103`).
  Whole line is the trigger. Hover lifts to `ink-muted`.
- Default = highest-`recentRank` project with a resolvable path
  (`design/studio/views/project-picker.tsx:23,48`). A defaulted value and a chosen one
  render identically — the readout is honest either way, so no "(recent)" annotation.
- Branch stays in the line because it is the worktree disambiguator; the picker
  already distinguishes `kind: project | worktree`.
- `new worker` moves to the ledger, where it already exists as
  `session.registered · cardless`.

### Expansion on intent

- Click the line, or `⌘P` → the row expands **in place** into the project-picker list,
  pushing the composer down. Never covers it, never a second modal, no portal.
- Modal grows to a 560px cap; the picker scrolls internally past ~220px. The textarea
  stays mounted and keeps its draft and caret.
- `Esc` collapses to the previous value. `Enter` on a row collapses and returns focus
  to the textarea at the caret it left.

### Message as the dominant surface

- `min-height: 120px` (≈5 rows), autogrow to 260px, then internal scroll. At rest the
  message occupies ~60% of the body instead of ~20%.
- Autofocus on open. The modal exists to write.
- 15px/1.45 sans — one step above the surrounding 11–12px mono. It is the only prose
  in the modal.
- The composer is the **only** bordered plate in the body. The project readout is
  borderless. That inversion alone carries most of the hierarchy.

### Tool row

- Left: `/` commands only — a mono glyph, not an icon button.
- Right: `RuntimePicker` (`variant="rail"`, `placement="up"` — it already portals for
  exactly this clipped-shell case, `RuntimePicker.tsx:441–451`), then send.
- Deleted: the "Run with" card, three `FauxSelect`s, the readiness sentence, the Ready
  dot, attach, mic. Attach has no backend on the new-task path and mic duplicates the
  harness-side affordance.
- `↵ send · ⇧↵ line` moves to focus-only, or goes. It permanently costs ~120px of row
  width to teach something once.

### Validation

- Send is enabled whenever the draft is non-empty — **regardless of project**. This is
  the change from `NewChatComposer.tsx:805`.
- Submit with no project: no toast, no shake. The project row expands (same motion as
  intent-click), search focused, label becomes `Pick a project` in full ink — not red.
  One accent hairline under the expanded row is the entire signal. Draft untouched.
- Picking a project fires the interrupted submit immediately. The user pressed send
  once; they should not press it twice.
- Empty draft: send disabled at 25% opacity, as today.
- Default project path no longer resolves: treat as empty and run the same flow. Never
  launch into a stale path silently.

### The ledger, preserved

Unchanged — and it gets better. The launch phase's context line
(`~/dev/… · claude · opus · medium`, `:592–598`) is now literally the compose phase's
project readout plus the runtime chip's value, flattened into one row. Same facts,
same order, same type scale. The transition reads as a settle rather than a swap: the
project line can hold position while the composer collapses into the task placard.

---

## 3. Interaction caveats

1. **Expand-in-place vs fixed modal height.** Growing the modal is jumpy; shrinking the
   composer reflows text under the caret. Recommendation: grow the modal, cap at
   560px, scroll the picker internally.
2. **`/` is overloaded.** `/` at caret 0 for project vs `/` for commands. Pick one —
   `/` is commands, project is `⌘P`.
3. **Harness follows project today.** `selectedProject?.defaultHarness`
   (`NewChatComposer.tsx:455`) means changing project can silently change the chip.
   Rule: project change updates the chip only while the user hasn't touched it; once
   touched it is sticky.
4. **`runtimeBlocked` needs a home.** The readiness sentence is being deleted, but the
   real blocked state exists (`NewChatComposer.tsx:647`). It should render as one
   ink-faint line under the tool row, only when blocked — never a standing "Ready".
5. **The borderless trigger needs a focus ring.** Explicit `button` role,
   `aria-expanded`, and a visible ring, since it has no resting border to modify.
6. **DOM order stays visual** (project line before composer) so Tab from the readout
   lands in the textarea. Autofocus means most users never tab at all.
