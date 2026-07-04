# Lane message cards — "nicer treatment" pass (Agent reply · thinking · User request)

Follow-up to [`lane-user-message-presentation.md`](./lane-user-message-presentation.md).
That doc set the **structure** (two registers, amber = human, indent the work
register, Concise/Details trace density) and most of it shipped in `c4285021`. This pass is
about the thing that's still off: the speech cards read **flat, grey, and a
little broken**. It's a *material + content-hygiene* pass, not a re-architecture.

Surfaces: `packages/web/client/screens/sessions/SessionObserve.tsx` +
`session-observe.css`, lane mode (`.s-observe--lane`). Class names / line
numbers are against the working tree at the time of writing.

> ⚠️ `SessionObserve.tsx` and `session-observe.css` are **currently uncommitted,
> modified on `codex/local-agents-embed-slice-01`** (the Codex checkout). Apply
> these deltas as part of that in-flight work — don't land them as a parallel edit
> that collides with it. Line numbers will drift; anchor on class names.

---

## Why it reads bland — five precise causes (from the screenshots)

1. **Raw markdown leaks in the default (collapsed) state.** The lane snippet is
   the *plain* string — `**Those 3 uncommitted lane files…**`, `` `AgentLaneChrome.tsx` ``
   render with literal `*` and backticks. `LaneExpandableText` only routes text
   through `renderExpanded` (→ `MessageMarkup`) **when expanded**; the collapsed
   `snippet` path (SessionObserve.tsx `LaneExpandableText`, `body = expanded ? … : snippet`)
   is unstyled text. Since rows sit collapsed by default, **the ugly state is the
   one everyone sees.** This is the single highest-impact fix.

2. **`[thinking]` is a raw runtime marker leaking into the UI.** The lone
   `[thinking]` body in an "Agent reply" card is not a think event — it's a
   *message* whose text is the literal marker emitted at
   `packages/runtime/src/tail/claude-source.ts:244`
   (`parts.push('[thinking] ' + blockObj.thinking)`). When the thought is still
   empty it renders as bare `[thinking]`. It should never appear verbatim.

3. **The card has no material.** `.s-observe-message--lane` is
   `surface 38% on transparent` + `1px ink 6%` — a near-invisible grey rectangle
   with no top-light, no hover, no depth. Next to the amber ask it looks unfinished.

4. **The eyebrow is a type-name, not identity.** `"Agent reply"` / `"User request"`
   (`messageDisplayLabel` SessionObserve.tsx:1024; `ask.label`) tell the operator
   nothing they don't already know from the lane header. They cost a line and give
   back no scanning value, and there's **no directional signal** (agent→you vs
   agent→agent look identical — yet agent→you is the one that matters).

5. **The ask card looks broken.** The second "User request" card's **title is the
   whole Scout routing blob** (`⌖ Claude (@claude) → openscout-pauli-2 … ask:wej9zx › # Codex task —…`)
   **and the body repeats it verbatim.** `buildLaneAskDisplay` isn't stripping the
   routing preamble for Scout-routed asks, so title-extraction falls back to the raw
   header and the dedupe (`previewText = ask.preview === ask.title ? "" : …`,
   SessionObserve.tsx:993) doesn't fire because they're *near*-equal, not equal.

Fixes 1, 2, 5 are content hygiene and remove ~80% of the "bland/ugly" read on
their own. 3 and 4 are the material polish on top.

---

## The treatment

Three speaking roles, one restrained system. **No left bars on rounded cards**:
focus and direction come from material, eyebrow dots, and type weight, not a
left edge. Differentiate by **material + eyebrow dot + type weight**, not by a
picket fence of colored spines.

```
┌─────────────────────────────────────────────────────┐   ← User request (amber, the signal)
│  ● you  ask · 1m                                     │     no rail; material carries emphasis
│  Review OPEN PRs for merge-readiness                 │     title: clamped 2 lines, routing stripped
│  You are doing an adversarial pass over the diff…    │     body: markdown-rendered, dim ink
│                                               ⌄ more │
└─────────────────────────────────────────────────────┘

  ◆ → you · 49s                                            ← Agent reply → operator (accent dot = addressed to you)
  Using github:github for the PR-orientation workflow;      body reads as PROSE (no ** or `raw`)
  I'll keep the checkout read-only…                ⌄ more    warmer surface, inset top-light, hover-lift

  ∿ thinking ···                                           ← thinking placeholder (never literal "[thinking]")
                                                             serif italic, dim, pulsing dots while empty

  · → @pauli-2 · 26s                                       ← Agent reply → another agent (dim dot = chatter)
  Rebased onto main, pushing the fixup now.                 quietest register
```

### 1. Body always renders as prose — fix the collapsed snippet (do this first)

The collapsed snippet must go through the same inline renderer as the expanded
body. `renderWithMentions` (`lib/mentions.tsx`) already turns `**bold**` →
`<strong>`, `` `code` `` → `<code class="s-inline-code">`, links + `@mentions` —
it's exactly what `MessageMarkup` uses per paragraph. Route the snippet through it.

In `LaneExpandableText` (SessionObserve.tsx ~414), add an optional
`renderCollapsed` and use it for the snippet; default it to `renderExpanded` when
the caller wants identical inline treatment:

```tsx
const body = expanded
  ? (renderExpanded ? renderExpanded(normalized) : normalized)
  : (renderCollapsed ? renderCollapsed(snippet) : snippet);
```

- **MessageLine** (SessionObserve.tsx:1031): pass
  `renderCollapsed={(s) => renderWithMentions(s)}` so `**` / backticks are gone in
  the default view. Keep `renderExpanded={<MessageMarkup/>}` for the full body.
- **AskLine** (SessionObserve.tsx:991): its lane `renderExpanded` currently returns
  the **plain** value (`laneMode ? value : <MessageMarkup>`, line ~1004) — so asks
  never render markdown even expanded. Give asks the same treatment as messages:
  `renderWithMentions` collapsed, `MessageMarkup` expanded.

> Ultra-safe fallback if inline nodes wrap awkwardly in the 1–2 line snippet: a
> `stripInlineMarkdown(s)` that drops `**`/`__`/backticks and leading `#`,`>`,`-`
> markers for the *collapsed* preview only, full `MessageMarkup` on expand. Prefer
> `renderWithMentions` for visual consistency; fall back to strip only if needed.

### 2. Thinking placeholder — a real affordance, never the marker

In `MessageLine`, detect a thinking-only message and render a dedicated block
instead of the raw text. Heuristic (matches how `claude-source.ts` joins blocks
with `" · "`):

```tsx
const THINK_PREFIX = /^\s*\[thinking\]\s?/;
// strip every leading "[thinking] …" segment up to the first " · " boundary
function splitThinking(text: string): { thinking: string; rest: string } { … }
const { thinking, rest } = splitThinking(event.text ?? "");
const thinkingOnly = THINK_PREFIX.test(event.text ?? "") && !rest.trim();
```

- **thinking-only** → render a borderless dim row: `∿` glyph + serif italic thought
  (reuse `.s-observe-think-text` type). If `thinking` is empty → animated
  `thinking ···` (pulsing dots). No card, no eyebrow, no `[thinking]` text.
- **mixed** (`[thinking] pondering · Here's the reply`) → drop the thinking
  segment(s), render `rest` as the normal agent reply. Optionally surface the
  stripped thought as a hover title on a small `∿` marker.

CSS:

```css
.s-observe--lane .s-observe-msg-thinking {
  display: inline-flex; align-items: baseline; gap: var(--space-2xs);
  font-family: var(--font-serif); font-style: italic;
  font-size: var(--text-sm); line-height: 1.4;
  color: color-mix(in srgb, var(--dim) 82%, var(--muted));
}
.s-observe--lane .s-observe-msg-thinking-glyph { color: var(--dim); font-style: normal; }
.s-observe-msg-thinking-dots::after {
  content: "···"; letter-spacing: 1px;
  animation: s-observe-think-pulse 1.4s ease-in-out infinite;
}
@keyframes s-observe-think-pulse { 0%,100% { opacity: .35 } 50% { opacity: .9 } }
@media (prefers-reduced-motion: reduce) {
  .s-observe-msg-thinking-dots::after { animation: none; opacity: .6 }
}
```

> Cleaner long-term fix is at the source: emit thinking-only assistant turns as a
> `think` event (kind `"think"`) rather than a `message` in `claude-source.ts`.
> That's a runtime/tail change with broader blast radius — do the client
> detection now, file the source fix as follow-up.

### 3. Agent-reply card material — warmth, top-light, hover

Give the reply an actual (still quiet) material so it stops reading as a flat
grey box, and make it feel alive on scan. **No left bar** (rounded card).

```css
.s-observe--lane .s-observe-message--lane {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--ink) 4%, transparent), transparent 42%),
    color-mix(in srgb, var(--surface) 52%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--ink) 9%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--ink) 5%, transparent);
  transition: background .14s ease, border-color .14s ease;
}
.s-observe--lane .s-observe-message--lane:hover {
  background: color-mix(in srgb, var(--surface) 66%, var(--bg));
  border-color: color-mix(in srgb, var(--ink) 13%, transparent);
}
```

Body stays `font-sans / text-sm / line-height 1.55` (already correct at
`.s-observe-message-text`). Keep it a shade dimmer than the ask body so a routine
reply never out-shouts a human request — the existing
`color-mix(ink 80%, muted)` is right.

### 4. Eyebrow → directional identity (one accent dot, no new colors)

Replace the generic `"Agent reply"` label with a **direction + dot** built from
`event.to` (already present — no data plumbing needed; the lane header already
carries *who* the agent is, so the row only needs to say *to whom*):

- `to === "human"` → **filled accent dot** + `→ you` — the single-accent signal
  that this reply is addressed to the operator (the case worth catching).
- `to` = another agent → **hollow/dim dot** + `→ @handle`.
- no `to` → **drop the eyebrow entirely** (it added nothing); let the body lead.

```css
.s-observe--lane .s-observe-message--lane .s-observe-message-label {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: var(--text-2xs); letter-spacing: .02em; color: var(--dim);
}
.s-observe-msg-dir-dot { width: 5px; height: 5px; border-radius: 50%; }
.s-observe-msg-dir-dot--you { background: var(--accent); }
.s-observe-msg-dir-dot--agent {
  background: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dim) 70%, transparent);
}
.s-observe-message--lane.is-to-you .s-observe-message-label { color: var(--muted); }
```

This keeps single-accent discipline (accent only earns the "→ you" dot) and obeys
"minimal dots" — exactly one dot per speech row, and only agent→you is tinted.

### 5. User-request card — refine the shipped amber, fix the title

The amber material (`.s-observe-ask--lane`, :807) is good; keep the tint and
shadow, but do not use a left rail. Three refinements:

- **Eyebrow = attribution, not "User request."** Render `● you  ask · <time>`
  (or the routed sender `@claude` for a Scout-routed ask) as the pill. The word
  "Ask"/"User request" is noise; *who + when* is signal.
- **Title: clamp + strip.** Clamp `.s-observe-ask--lane .s-observe-ask-title` to
  2 lines (`-webkit-line-clamp: 2`), and **fix the routing-blob leak in
  `buildLaneAskDisplay`** (`lib/lane-ask-display.ts`): strip the Scout routing
  preamble (`⌖ <name> (@handle) → <target> (@session) · ask:<id> ›`) before
  title/first-line extraction — add a `ROUTING_HEADER` pattern alongside the
  existing `ROUTING_PREFIX`/`ROUTED_TASK_LABEL` handling so the title becomes the
  actual task ("Review OPEN PRs for merge-readiness") and the body no longer
  duplicates the header.
- **Body renders markdown** (per §1) so `<INSTRUCTIONS>` / `#` headings read as
  structure, not raw text — the existing `stripLeadingInstructionBlocks` /
  `stripFilesMentionedSections` already remove most cruft; markdown rendering
  finishes the job.

```css
.s-observe--lane .s-observe-ask--lane .s-observe-ask-title {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
```

### 6. Rhythm

Between speech rows use `var(--space-md)`; the current uniform `--space-3xl`
row padding is part of why the lane feels sparse-but-flat. Tighten reply→reply,
keep a little more air *before* a human ask so the amber card gets a beat of its
own. (Turn-grouping from the prior doc §"Turn grouping" is the fuller version;
this is the cheap approximation until then.)

---

## Implementation order (fastest signal first)

1. **Collapsed snippet → `renderWithMentions`** (messages + asks). Kills the raw
   `**`/backtick read everywhere. One change in `LaneExpandableText` + two call
   sites. *Biggest visible win.*
2. **`[thinking]` detection → thinking affordance.** Removes the ugliest single
   artifact; adds a live pulsing state.
3. **Ask routing-blob strip + title clamp** in `buildLaneAskDisplay`. Ask card
   stops looking broken.
4. **Agent-reply card material** (surface + inset light + hover).
5. **Directional eyebrow dot** (`event.to` → `→ you` / `→ @handle` / drop).
6. **Ask eyebrow attribution + row rhythm.**

Steps 1–3 are content hygiene (small, high-value, low-risk). 4–6 are the polish.

## Guardrails

- **No left bars on rounded cards** — direction via material, eyebrow dot, and
  type, not spines or rails.
- **Single accent** — the accent hue is spent only on the `→ you` dot; amber only
  on the human ask; `--red` only for genuine errors. No categorical color soup.
- **Works at SM/MD/LG lane widths** — title clamp and eyebrow must survive narrow
  columns; the snippet already clamps via `laneSnippetText`.
- **Concise/Details parity** — these are visual-layer changes to the speech
  register; Details shows the work, Concise summarizes routine technical rows.
- **Reduced motion** — the thinking pulse honors `prefers-reduced-motion`.
