# Reusable web-UI patterns for a read-only viewer

Extracted from openscout's web client (`packages/web/client`) for a sibling project's
vanilla-JS read-only viewer with three views: **TAIL** (live event stream),
**LANES/SESSIONS** (agent transcript reader), **AGENTS** (directory).

Everything below is framework-agnostic — the React is incidental; the *behaviors*,
*CSS*, and *algorithms* are what port. Source refs are given so you can read the original.

---

## TL;DR — the tricks worth stealing

1. **Columnar CSS Grid rows, not flex.** One `grid-template-columns` template per view gives
   you perfect vertical alignment of time/kind/source columns for free. Tabular-nums on the
   time column. (tail)
2. **No virtualization — a ring buffer + DOM cap instead.** Hard cap ~5k rows, FIFO-drop the
   oldest. Simple, no library, no scroll-jank. *Caveat: this is their weakest choice — see
   "what to avoid".*
3. **Follow-with-pause + "N new" resume divider.** Auto-stick to bottom; the moment the user
   scrolls up >24px, pause follow and count pending events; show a clickable "paused · N new ·
   press G" divider to resume. This is the single best interaction in the whole UI.
4. **Single-glyph kind column with categorical hue.** `> < * = ~ ·` for user/assistant/tool/
   result/system/other, each one accent-tinted. Reads like a log, scans like a table.
5. **Content-hash dedupe** so reconnect/replay doesn't double-print events.
6. **Avatar-led turns with a spine + bead**, never chat bubbles. A vertical hairline ("spine")
   with a small colored dot ("bead") per row at a fixed left offset. Calm, dense, alignable.
7. **`useLayoutEffect`-style sync scroll** (write `scrollTop` *after* DOM mutation, *before*
   paint) to avoid the one-frame jump when appending rows.
8. **Horizon filtering, not virtual scroll, for transcripts** — only render the last N minutes
   by wall-clock; show a "partial / +N before" tag for what's hidden.
9. **Deterministic name→sprite identity** (xmur3 + mulberry32) so an agent looks the same in
   every view with zero server state.
10. **One emerald accent, signal via contrast.** No per-role rainbow. Status = tone + a 6px
    filled dot (pulse only for "actively working"), never emoji.

---

## A. Live TAIL event stream

Source: `screens/shared/TailView.tsx` (~1110 lines), `screens/ops/ops-tail.css`,
`lib/tail-events.ts`, `lib/use-tail-feed.ts`, `lib/tail-event-merge.ts`, `lib/time.ts`.

### A1. Density + columnar layout
CSS Grid, one template, baseline-aligned, monospace, ~22px rows:

```css
.s-tail-row {
  display: grid;
  grid-template-columns:
    92px                 /* time         */
    60px                 /* harness       */
    22px                 /* origin abbr   */
    minmax(150px, 240px) /* project/session/pid */
    48px                 /* kind glyph+label */
    1fr;                 /* summary       */
  align-items: baseline;
  gap: var(--space-md);
  padding: var(--space-3xs) var(--space-xl);
  min-height: 22px;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--muted);
  white-space: nowrap;
}
/* zebra rhythm without hard lines */
.s-tail-row:nth-child(even) {
  background: color-mix(in srgb, var(--ink) 2.5%, transparent);
}
.s-tail-cell-time { font-variant-numeric: tabular-nums; }
.s-tail-summary  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```
A compact "embedded" variant just swaps the template to narrower columns + `--text-xs`.
**Why it works:** the grid template is the single source of column alignment; you never
hand-pad. Zebra via 2.5% ink-mix instead of borders keeps it quiet.

### A2. Buffer / windowing (the ring buffer)
No virtual list. Initial hydrate = `GET /api/tail/recent?limit=500`; live events appended with
a hard cap and FIFO drop:

```js
const BUFFER_LIMIT = 5000;
function append(prev, ev) {
  return prev.length >= BUFFER_LIMIT
    ? [...prev.slice(prev.length - BUFFER_LIMIT + 1), ev] // drop oldest
    : [...prev, ev];
}
```
**Verdict:** dead simple, zero deps, no scroll math. **But** it renders all ~5k rows to the
DOM — see "what to avoid". For a *viewer that may face very long streams*, pair this ring
buffer with real virtualization.

### A3. Smart follow / jump-to-latest (the best pattern here)
Three pieces: sync-scroll on append, pause-on-scroll-up with a 24px threshold, and a resume
divider that counts pending events.

```js
// 1) After rows change, stick to bottom — unless paused. Run sync, pre-paint.
function onRowsChanged() {            // call from a layout effect / MutationObserver
  if (paused) { pendingCount++; renderDivider(); return; }
  body.scrollTop = body.scrollHeight;
}

// 2) Detect "am I at the bottom?" on every scroll. 24px slack.
function onScroll() {
  const distance = body.scrollHeight - body.scrollTop - body.clientHeight;
  const atBottom = distance < 24;
  if (atBottom) { paused = false; pendingCount = 0; }
  else if (!paused) { paused = true; }
  renderDivider();
}

// 3) Resume affordance (also bound to the "G" key)
function jumpToLive() { paused = false; pendingCount = 0; body.scrollTop = body.scrollHeight; }
```
Divider copy: `── paused · 12 new · click or press G to jump back to live ──`.
**Why it works:** the 24px slack means you don't fight the user over sub-pixel scroll; the
count gives them a reason to come back; one keystroke resumes. No "scroll lock" toggle needed.

### A4. Kind/role color coding — single-glyph column
```js
const KIND_GLYPH = { user:">", assistant:"<", tool:"*", "tool-result":"=", system:"~", other:"·" };
const KIND_LABEL = { user:"USR", assistant:"AST", tool:"TOL", "tool-result":"OUT", system:"SYS", other:"EVT" };
```
```css
.s-tail-glyph--user        { color: var(--info); }
.s-tail-glyph--assistant   { color: var(--accent); }
.s-tail-glyph--tool        { color: var(--cat-gold); }
.s-tail-glyph--tool-result { color: var(--cat-sky); }
.s-tail-glyph--system      { color: var(--cat-purple); }
.s-tail-glyph--other       { color: var(--dim); }
```
Severity overlay (warn/error) is a 2px inset box-shadow on the left edge, not a background
flood — keeps the row legible:
```css
.s-tail-row--issue-error { box-shadow: inset 2px 0 0 0
  color-mix(in srgb, var(--red) 55%, var(--border) 45%); }
```
Note: the tail allows categorical glyph hues, while the rest of the app holds to one accent.
For a viewer, categorical *glyphs* are fine; keep *row backgrounds* monochrome.

### A5. Time formatting
Absolute wall-clock with millis in the row; ISO in the detail panel; relative only in tooltips.
```js
// row: 24h clock, tabular, optional ms — via Intl, locale-aware
new Intl.DateTimeFormat(undefined, {
  hour:"2-digit", minute:"2-digit", second:"2-digit",
  fractionalSecondDigits: 3, hour12:false,
}).format(tsMs);                       // "14:03:21.481"
```
Relative helper (`timeAgo`) thresholds: `<1s → "now"`, then `5s`/`10m`/`2h`/`3d`, future →
`in 5m`. Use absolute in a dense stream (you're correlating with logs), relative in directories.

### A6. Empty / loading
No spinner — a calm "waiting" state with a blinking block cursor:
```css
.s-tail-empty-cursor {
  display:inline-block; width:1ch; height:1em; background:var(--dim);
  animation: s-tail-blink 1.1s step-end infinite;
}
@keyframes s-tail-blink { 50% { opacity: 0; } }
```
Copy adapts to context: "Waiting for events" / "no events match filter X" / "watching N
transcripts · no events yet". Always offer the next action ("Start a session… `scout watch
--tail`"). Fetch errors are swallowed silently — *don't copy that part*, surface them.

### A7. Keyboard nav
`/` opens filter (focus input), `Esc` closes+clears, `G` jumps to live. Rows are
`role="button" tabindex=0` with Enter/Space → open detail. Guard against firing while typing:
```js
const inEditable = el.matches("input,textarea") || el.isContentEditable;
```
(`j`/`k` row-stepping is shown in their footer but **not actually wired** — aspirational. If you
want it, see the Agents `useListArrowNav` below and reuse it.)

### A8. Provenance (three-layer attribution)
Each row surfaces: **harness** (`claude`/`codex`/`grok`) · **origin** 2-char abbr
(`sc`=scout-managed, `hu`=hudson, `na`=native) · **project / session(8-char) : pid**. Full
attribution (incl. `parentPid ← pid` chain) lives in the click-through detail sheet. Pattern:
*minimum identity inline, full provenance one click away.*

### A9. Reconnect-safe dedupe
Disk hydration and the live socket assign different ids to the same event, so identity is a
content tuple, not the id:
```js
const key = [source, sessionId, ts, kind, summary].join(" ");
```
Essential if your viewer replays recent history on (re)connect.

---

## B. LANES / SESSIONS transcript reader

Source: `screens/sessions/SessionObserve.tsx`, `screens/sessions/session-observe.css`,
`lib/lane-observe.ts`, `lib/observe-display.ts`, `screens/chat/conversation-screen.css`.

> Terminology note: in openscout a **"lane" is one agent's session trace** (a single vertical
> spine), **not** side-by-side columns. There is no multi-lane column layout. If your viewer
> wants true side-by-side lanes, you're past their design — but the single-lane spine below is
> the reusable unit you'd repeat per column.

### B1. Turn grouping — spine + bead, avatar-led, never bubbles
A fixed-width time gutter, an absolutely-positioned vertical hairline ("spine"), and a small
colored dot ("bead") per row hanging just left of the content:
```css
.s-observe--lane { --lane-time-col: 62px; --lane-spine-x: 64px; }
.s-observe-spine     { position:absolute; left:var(--lane-spine-x); top:0; bottom:0;
                       width:1px; background:var(--border); }
.s-observe-row-bead  { position:absolute; left:-14px; width:7px; height:7px;
                       border-radius:50%; background: var(--bead-color); }
.s-observe-row-time  { font-family:var(--font-mono); font-size:var(--text-2xs);
                       color:var(--dim); }            /* hangs in the gutter */
```
Turn boundaries are **note pills on a hairline rule**, flat (no box, no radius):
```css
.s-observe-note--lane { border:0; border-radius:0; background:transparent; }
```
Text like "Turn complete". In conversation mode, user turns `align-self:flex-end`, agent turns
are avatar-led rows (`flex-direction:row; gap; align-items:flex-start`); day boundaries are
full-width dividers with centered labels (`Today` / `Yesterday` / `Jun 25`).

### B2. Kind color (lane beads)
```js
const KIND_COLOR = {
  think:"var(--dim)", tool:"var(--accent)", ask:"var(--amber)",
  message:"var(--muted)", note:"var(--green)", system:"var(--dim)", boot:"var(--dim)",
};
```
Only the 7px bead is colored; text stays in the muted/ink ramp. `ask` (needs-human) is the one
amber accent that earns attention.

### B3. Density / nesting
Tool blocks use a **left gutter border, not a card** — `border-left:1px solid; background:
transparent`. Nested/reply context is a **backlink button**, never indentation. Bash gets a
dedicated terminal pill (prompt + cd "powerline" segment + command tiered as program · args ·
plumbing) and diffs collapse to `+5 −2`, expand on demand. Conversation column is centered,
`max-width: min(88%, 760px)`; system notes narrower at `min(72%, 560px)`.

### B4. Provenance — essentials header + a stats rail
Inline rows stay minimal; everything heavy lives in a right **rail**: trace stats
(Turns/Tools/Thinks/Asks/Reads/Edits/Files/Window span), a context-window meter with load %,
files-touched with state (created/modified/read), token usage, and a metadata block (model·
adapter·branch·workspace·entrypoint·CLI version·permissions·sandbox·session ids…). The
"essentials" — model · cwd · harness · branch — are always visible. *Pattern: the transcript is
clean; provenance is a parallel column, not inline clutter.*

### B5. Time
Lane rows show relative age (`2m ago`, `now`) with the full timestamp on `title` hover; gaps
≥2min between events render an inline `12m gap` marker (great for "what happened overnight").
Elapsed durations are compact (`45s`, `2m`, `1h12m`), not clock format.

### B6. Windowing — horizon, not virtual
```js
// keep only events newer than (now - horizonMs); default 30m
filterEventsForHorizon(events, horizonMs);
// then show how many were dropped, with a "partial" tag
countEventsBeforeHorizon(events, horizonMs);  // → "+148 before"
```
No virtual list; the horizon keeps the DOM small for live traces. Good enough until ~10k rows.

### B7. Follow / jump
`isFollowing = isAtTail && autoFollow`. A Follow toggle (play/pause → "Follow"/"Latest"/"Live")
and `scrollTo({ top, behavior:"smooth" })` to the end on new rows when at the live edge. New
rows animate in (`opacity + translateY` keyframe) so you notice arrivals without a flash.
Message permalinks: `location.hash = "msg-<id>"`, scroll-to + a 1.2s background flash on the
target.

### B8. Empty / loading
A single system-row placeholder ("No session trace is available for this agent yet · Waiting
for a live session or readable history file"). Chat empty state centers a big glyph (`@` DM /
`#` channel) + title + hint. Loading is implicit (array fills in); for a viewer, prefer an
explicit skeleton.

---

## C. Shared primitives (use across all three views)

Source: `lib/time.ts`, `lib/colors.ts`, `lib/agent-state.ts`, `lib/agent-identity.ts`,
`lib/keyboard-nav.ts`, `styles/tokens.css`, `styles/primitives.css`, `scout/Provider.tsx`.

### C1. Design tokens (port `tokens.css` + the theme vars verbatim)
- **Spacing** `--space-*`: 2,4,6,8,10,12,14,16,20,24,32,40,48,64 (3xs…8xl)
- **Radius** `--radius-*`: 2,4,6,8,12,16, pill=999
- **Text** `--text-*`: 9,10,11,12,13,14,16,18,20,24 (whole px only)
- **Color** (dark, oklch): bg `0.14 0.008 80`, surface `0.18`, ink `0.96`, muted `0.72`,
  dim `0.58`, **accent (emerald) `0.86 0.17 125`**, status ok `155` / warn `85` / error `25`.
- **Fonts**: sans `'Inter Tight','Inter',ui-sans-serif,system-ui`; mono `'JetBrains
  Mono',ui-monospace,Menlo`.

### C2. State → color (one switch, no rainbow)
```js
function stateColor(s) {
  switch (normalizeState(s)) {
    case "in_turn":   return "var(--green)";                                  // working
    case "in_flight": return "var(--accent)";                                 // queued/running
    case "callable":  return "color-mix(in srgb, var(--accent) 65%, var(--dim))"; // available (muted)
    case "blocked":   return "var(--dim)";                                    // offline
  }
}
```
6px filled dot, `background: currentColor`; **pulse only `in_turn`**:
```css
.dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
.dot--pulse { animation: scout-dot-pulse 1.4s ease-in-out infinite; }
@keyframes scout-dot-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
```

### C3. Deterministic identity (pure, no backend) — copy verbatim
```js
function xmur3(str){let h=1779033703^str.length;
  for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=(h<<13)|(h>>>19);}
  return()=>{h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);
    h^=h>>>16;return h>>>0;};}
function mulberry32(a){return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);
  t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
// seed = xmur3(name)(); rng = mulberry32(seed); → shape from rng, hue from harness, tone from state
```
Harness hues: claude 25° · codex 135° · cursor 235° · native 280° · worker 195° · pi 330°.
State tones map to (lightness, chroma): working `0.75/0.16` (vivid) → blocked `0.5/0.02`
(greyed). Render a 70×70 viewBox SVG so it's crisp from 18px to 96px.
**If you have a Swift/other port, the hash must stay bit-exact across ports** — openscout keeps
JS and Swift in lockstep on this exact function.

### C4. Keyboard nav (three composable handlers)
- **List roving focus**: ↓/`j`, ↑/`k`, Home/`g`, End/`G`.
- **Pane jump**: `[` / `]` move focus between `[data-pane]` containers.
- **Slash-to-search**: `/` focuses the search input.
Always early-return when focus is in an editable element.

### C5. Calm aesthetic checklist
- Borders are **ink-mix tints, not solid lines**: `1px solid color-mix(in srgb, var(--ink) 6%,
  transparent)` for cards; 35–40% `--border` mix for pane separators. Native parity = 0.5px
  hairlines; 1px reads chunky on Retina.
- Shadows are **shallow + diffuse**: `0 8px 22px rgba(0,0,0,.22)`; slide panels
  `-16px 0 32px -16px color-mix(in srgb,#000 60%,transparent)`. No hard edges.
- Hover `ink 4%`, active `ink 8%` — nearly imperceptible.
- Scrim `color-mix(in srgb,var(--bg) 60%,transparent)` + `backdrop-filter: blur(2px)`.
- Scrollbars 6px, transparent track, `--border` thumb.
- **No emoji** for status — geometric marks only.
- Eyebrow labels: uppercase mono, 9–11px, wide tracking (0.08–0.18em).

---

## What to AVOID (honest notes)

1. **Don't ship the 5k full-DOM ring buffer for a high-rate or long-lived stream.** It mounts
   every row; it will jank on weak hardware at high event rates. For a *read-only viewer that
   may face huge streams, add real virtualization* (windowed render of the visible range) *on
   top of* the ring buffer. The buffer caps memory; virtualization caps DOM. openscout has
   neither a virtual list here nor in the transcript — its single biggest gap.
2. **Don't swallow fetch errors silently** (the tail does). A viewer should show a
   reconnecting/failed state.
3. **Don't advertise keys you didn't wire** (`j`/`k` in the tail footer aren't real). Wire it
   or drop it.
4. **Don't indent nested messages** — use backlinks. Indentation collapses on deep tool trees.
5. **Don't bubble-ify the transcript** — avatar-led spine+bead rows are denser and align.
6. **Don't make headers sticky in the transcript** — they let it scroll with the flow and it
   reads cleaner; put persistent context in a side rail instead.
7. **Don't categorical-color row backgrounds.** Color the glyph/bead/left-edge; keep the row
   field monochrome so text stays legible and the view stays calm.
8. **Heuristic/regex severity classification is fragile** (the tail greps text for "error").
   If your producer emits a level/kind field, key off that instead.
9. **Issue/severity as left-edge inset shadow > background flood** — preserves readability.

---

## Fastest path to port (vanilla JS)

Pure, dependency-free, copy-paste candidates: **`time.ts`** (formatters), **`agent-identity.ts`**
(hash→sprite), **state→color** switch, the **follow/pause/24px/"N new"** logic, the **CSS Grid
row template**, **`tokens.css` + `primitives.css`**, and the **keyboard handlers**. Add the one
thing openscout lacks — a windowed/virtualized render of the visible range — and you'll have a
viewer that's calmer than the original and scales past it.
