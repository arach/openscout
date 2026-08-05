# Channel view audit — message rendering, formatting, and scroll/freeze

Status: investigation only, no code changed.
Date: 2026-08-04
Branch at time of audit: `codex/delivery-campaign-source` @ `03368044`

## 0. Reproduction caveat — read this first

**There is no "PDF Research" channel in this broker.** The `conversations`
table holds exactly 6 `kind='channel'` rows:

| id | title |
| --- | --- |
| `chn-b9bcf00c…` | `fleet-deck` |
| `channel.shared` | `shared-channel` |
| `chn-c7204e2a…` | `shared-channel` |
| `chn-6c34b144…` | `blink-ios-sync-council` |
| `channel.studio` | `studio` |
| `chn-fffb8873…` | `studio` |

The only message anywhere in the store containing the string "pdf" is the ask
that requested this audit. So the named reproduction case either lives on
another node, or the name refers to something the local broker has never seen.

Everything below was therefore reproduced against the **real local corpus**
(531 messages) rather than that channel. That is enough to confirm the content
pipeline defects with measurements, but it is **not** enough to confirm the
scroll-freeze report empirically — the largest local channel is `fleet-deck` at
27 messages / 106 KB, well under the size where the suspected mechanisms bite.
The freeze section is therefore ranked by mechanism, with the confidence of each
stated honestly.

## 1. Where the channel view actually lives

One implementation serves all three surfaces, which matters for triage:

- **Web**: `packages/web/client/screens/chat/ConversationScreen.tsx` (2800 lines),
  also mounted at route `/embed/thread` (`ConversationScreen.tsx:2790`).
- **macOS**: `ScoutThreadRenderer.shared` is the **default**
  (`apps/macos/Sources/Scout/ScoutCommsSettings.swift:21`) and mounts that same
  `/embed/thread` surface in a `WKWebView`
  (`apps/macos/Sources/Scout/ScoutRootView.swift:2841`). The SwiftUI
  `nativeMessageList` (`ScoutRootView.swift:2854`) is the escape hatch only.
- **iOS**: native, `apps/ios/Scout/CommsSurface.swift:1250` →
  `MessageMarkupView`.

So a web-side regression in the thread surface presents as "the macOS app is
frozen", because the macOS Comms transcript *is* the web surface.

## 2. Message content pipeline — literal escaped newlines

### 2.1 The escape is baked into stored data, not introduced at render

Measured against `control-plane.sqlite`:

- 531 messages total; **22 carry the literal two-character sequence `\n`**.
- All 22 are `class='agent'` bodies whose `metadata_json.source` is
  `"scout-cli"` — agent-authored `scout ask` / `scout send` prompt text.
- 1 of the 22 (`msg-ms6olgxx-arlsbu`) contains *both* literal `\n` and real
  newlines.

The most likely origin is authoring, not Scout: `zsh` does not expand `\n`
inside double quotes, so an agent shelling out
`scout ask --to X "line one\nline two"` stores the backslash verbatim.

**There is no normalization anywhere on the ingest side.** A grep across
`apps/desktop/src`, `packages/runtime/src`, and `packages/protocol/src` for any
escaped-newline restoration returns nothing. The CLI (`apps/desktop/src/cli/commands/send.ts`,
`ask.ts`) passes the body through untouched, and the broker stores it as given.

### 2.2 Only one of three renderers repairs it, and it repairs it heuristically

| Surface | Parser | Repairs `\n`? |
| --- | --- | --- |
| Web + macOS embed | `packages/web/client/lib/message-markup.ts` | Yes, heuristically |
| macOS native list | `apps/macos/Sources/ScoutSharedUI/MessageMarkupParser.swift:132` (`normalize`) | **No** |
| iOS | `apps/ios/Scout/MessageMarkupView.swift` → Hudson `HudMarkdownView` | **No** |

Three independent block grammars, one shared message. The same body reads three
different ways depending on where you open it.

### 2.3 The web heuristic has one precise, reproducible hole

`restoreEscapedMessageLineBreaks` (`message-markup.ts:31`) opens with:

```ts
if (/[\r\n]/u.test(value)) {
  return value;
}
```

Any real newline anywhere in the body disables repair for the whole body. Run
over the real corpus, this is exactly right 21 times and exactly wrong once:

```
literal-\n messages: 22   restored=21   STILL LITERAL=1
mixed real+literal newline messages: 1
  msg-ms6olgxx-arlsbu: 9 blocks, 1 still carries literal \n
```

That message is a review report — the shape that shows up in a research
channel — and it renders one block of run-together prose with visible `\n`
between sentences.

## 3. Formatting and typography defects (web/shared renderer)

All four reproduced directly against `parseMessageMarkup`:

### 3.1 A stray `#` promotes mid-sentence text to an H1 — **highest severity**

`normalizeMessageMarkupText` (`message-markup.ts:56`) rewrites
`([^\n])\s+(#{1,6}\s+)` into a paragraph break plus heading:

```
in : "Filed under tracker # 42 for the next sweep."
out: [{paragraph "Filed under tracker"}, {heading depth:1 "42 for the next sweep."}]
```

A sentence is cut in half and the tail is rendered as a top-level heading.
`PR #179` is safe (no space after `#`), but `issue # 42`, `channel # foo`, and
shell comments inside prose are not. In a research channel that quotes source
and issue numbers, this fires.

### 3.2 Hard-wrapped agent prose renders with hard breaks

The parser joins paragraph lines with `\n`
(`message-markup.ts:210`), and `.s-message-markup-paragraph` is
`white-space: pre-wrap` (`packages/web/client/app.css:2169`). An agent that
wrapped its output at 80 columns gets a ragged 80-column right edge inside a
much wider pane, instead of reflowing to the container. This is the single most
visible typography problem on long agent messages.

### 3.3 Nested lists are flattened

```
in : "- top\n  - nested one\n  - nested two\n- second top"
out: one flat list: ["top", "nested one", "nested two", "second top"]
```

`UNORDERED_LIST_PATTERN` (`message-markup.ts:14`) matches `^\s*[-*]\s+` and
discards the indentation, so structure is lost. Same in the Swift parser
(`MessageMarkupParser.swift:160`, `trimmingCharacters` before the prefix check).

### 3.4 Unsupported inline syntax renders literally

`~~strikethrough~~` and `![alt](url)` pass through as raw text. The inline
grammar (`packages/web/client/lib/mentions.tsx:45`) covers inline code, `**bold**`,
`*em*`, `[text](url)`, bare URLs, and filesystem-path tokens — nothing else.
Reference links and nested emphasis are also unsupported.

### 3.5 Minor

- `MessageMarkup` returns a bare string when the parse yields no blocks
  (`message-markup.tsx:99`), dropping the `.s-message-markup` wrapper and with
  it the typography, wrapping, and link styling.
- `.s-message-markup { overflow-wrap: anywhere }` (`app.css:2149`) breaks words
  at arbitrary points; `break-word` gives the same overflow protection with
  better ragging.

### 3.6 What is already correct — do not "fix" these

Wrapping and overflow are in good shape and should be left alone: code blocks
carry `overflow: auto` + `white-space: pre` (`app.css:2245`), tables are wrapped
in an `overflow-x: auto` container (`app.css:2288`), and the block container is
`max-width: 100%`. Similarly the animated selectors in
`conversation-screen.css` are presence/working-turn chrome, not per-message, so
the 11 `infinite` animations do **not** multiply across a long transcript. The
two `:has()` selectors (`conversation-screen.css:1157`) are direct-child scoped
and are not a meaningful style-recalc cost.

## 4. Scroll lock and "the whole app feels frozen"

Ranked by confidence. Only the first is a *lock*; the rest are cost.

### 4.1 Autoscroll has no "reader is scrolled up" guard — **most likely root cause**

`resolveConversationAutoscroll` (`conversation-model.ts:354`) decides purely
from message identity:

```ts
if (input.newestMessageId && input.newestMessageId !== input.previousNewestMessageId) {
  return "smooth";
}
```

There is no input for scroll position. The caller
(`ConversationScreen.tsx:1424`, a `useEffect` with **no dependency array**, so
it runs on every commit) then does
`bottomRef.current?.scrollIntoView({ behavior: "smooth" })`.

Consequence: in a channel that is actively receiving messages, every arrival
yanks the reader back to the bottom with a smooth animation. Under a steady
arrival rate the smooth scrolls overlap and the view is effectively pinned —
the user reads this as "scrolling is locked". Three independent timers keep
commits flowing: a 5 s outstanding-turn poll (`ConversationScreen.tsx:1393`), a
3.5 s working-turn trace poll (`WORKING_TURN_TRACE_POLL_MS`,
`ConversationScreen.tsx:173`), and a 15 s relative-time `setTick`
(`ConversationScreen.tsx:1447`).

Note the parity gap: the **macOS native** list does this correctly, with a 1 px
bottom sentinel driving a `followLatest` flag
(`ScoutRootView.swift:2934`). The shared web surface — which is what macOS
actually renders by default — has no equivalent.

### 4.2 No virtualization, no memoization, up to 2000 rows

- `INITIAL_CHAT_HISTORY_LIMIT = 300`, `MAX_CACHED_MESSAGES_PER_CHAT = 2_000`
  (`packages/web/client/lib/chat-cache.ts:9-12`).
- Every message is rendered inline in `ConversationScreen`'s JSX with no
  windowing and no `React.memo` on the row.
- `MessageMarkup` calls `parseMessageMarkup` on every render with **no
  `useMemo`** (`message-markup.tsx:98`).
- `MessageEmbeds` re-runs `bodyUrls(message.body)` per render
  (`MessageEmbeds.tsx:157`), also unmemoized.
- `findPathMatches` allocates a fresh `RegExp` per call
  (`packages/web/client/lib/path-token.tsx:64`) and is called once per plain-text
  slice per render.

Measured cost of the parse step alone over the real 300-message window
(567,963 chars, largest body 19,318 chars):

```
parseMessageMarkup: 11.50 ms per full 300-message pass
worst single message: 1.02 ms (19,092 chars)
```

11.5 ms is the *parse only*; the React reconcile, inline segmentation, and
layout on top of it are the larger share. Since the 15 s tick re-renders the
whole tree, a large channel pays this repeatedly for no visual change. On a
channel several times the local maximum this crosses into visible jank.

### 4.3 The macOS embed readiness probe forces full-document reflow

`renderProbeScript(for: .thread)` (`ScoutWebEmbedView.swift:713`) evaluates
`document.body?.innerText` and `querySelectorAll('.s-thread-msg')` every
**60 ms** (`renderPollInterval = 0.06`, `ScoutWebEmbedView.swift:522`) for up to
5 s (`maximumRenderWait`). `innerText` forces synchronous layout of the entire
document. On a long transcript that is a repeated full-page reflow during the
exact window when the transcript is being built.

This is bounded — it stops once `ready` or at 5 s — so it explains "opening the
channel hangs", not "scrolling locks". But it is real, and on a big channel the
probe may never see `ready` cheaply and will pay all ~83 reflows.

### 4.4 Does recent rebuild/hot-reload work contribute? — probably not, but check

The specific concern is plausible on its face but the evidence points away from
it:

- `9ded54cc Fix session knowledge indexing freezing the web server` already
  moved indexing into a child process behind an in-flight gate and put knowledge
  reads on readonly WAL connections. That was the known freeze path and it is
  closed.
- HEAD (`03368044`, "Add explicit scout search for past harness sessions") adds
  `scout search index`, which can now be triggered on demand. It writes to
  `knowledge.sqlite`, a **separate** database from `control-plane.sqlite`, so it
  does not contend for the broker's lock. The residual risk is CPU/IO saturation
  from the indexer child while the transcript is polling — that would present as
  general sluggishness, not a scroll lock.
- The embed does have a stale-asset failure mode worth ruling out: `:43120`
  serves the prebuilt `packages/web/dist/client`, so client edits are invisible
  until `vite build` runs, and `ScoutWebEmbedView` has explicit handling for a
  missing Vite dev server (`ScoutWebEmbedView.swift:657` onward). A half-built
  `dist` would present as a blank or wedged panel — which is easy to
  misattribute to a freeze.

**Verdict:** treat rebuild/hot-reload as a confounder to rule out, not as the
cause. Confirm which state the reporter's `:43120` was in before spending time
here.

## 5. Implementation plan

Ordered so the highest-severity, lowest-risk items land first. Each step is
independently shippable.

### Step 1 — Stop the scroll lock (fixes the reported symptom)

- `packages/web/client/screens/chat/conversation-model.ts`: add
  `readerIsAtBottom: boolean` to `resolveConversationAutoscroll`'s input and
  return `"none"` when it is false and `initialScrollDone` is true.
- `packages/web/client/screens/chat/ConversationScreen.tsx`: track it from the
  feed element's `scrollHeight - scrollTop - clientHeight <= threshold`, or port
  the macOS bottom-sentinel `IntersectionObserver` idiom for symmetry with
  `ScoutRootView.swift:2934`.
- Add a "jump to latest" affordance so the reader can opt back in — otherwise
  removing the pin trades one complaint for another.
- Tests: extend `conversation-model.test.ts` with the scrolled-up-plus-new-message
  case and the scrolled-up-plus-typing case; both must return `"none"`.

### Step 2 — Fix the heading false positive

- `packages/web/client/lib/message-markup.ts:56`: require the `#` run to be at a
  line start, or at minimum require `#` to be immediately followed by a
  non-space word character before treating it as a heading. Mirror the change in
  `MessageMarkupParser.swift`.
- Tests: `message-markup.test.ts` — `"Filed under tracker # 42 …"` must stay a
  single paragraph; `"Intro\n# Real heading"` must still split.

### Step 3 — Normalize escaped newlines at ingest, once

- Add a shared `normalizeMessageBody` in `packages/protocol` and call it from
  the broker's message-write path so every surface reads one repaired body.
- Keep the existing renderer heuristic as a compatibility shim for the 22 rows
  already stored, but **close the mixed-content hole**: drop the
  `if (/[\r\n]/u.test(value)) return value` early bail in
  `message-markup.ts:32` and instead gate on the `hasEncodedLayout` signal
  alone, so a body with both real and escaped breaks is still repaired.
- Tests: `message-markup.test.ts` — a body with both real and literal breaks
  must be fully repaired; the existing guards (`` `\n` `` inside inline code, a
  Windows path like `C:\new\name`) must keep passing untouched. Those two guards
  are the whole reason the heuristic exists; do not regress them.

### Step 4 — Reflow prose, keep code literal

- Join paragraph continuation lines with a space rather than `\n`
  (`message-markup.ts:210`), preserving a hard break only on a trailing
  double-space or explicit blank line, and drop `white-space: pre-wrap` from
  `.s-message-markup-paragraph` (`app.css:2169`). Code blocks keep
  `white-space: pre` and are unaffected.
- Tests: an 80-column hard-wrapped paragraph parses to one reflowable paragraph;
  a fenced block keeps every internal newline.

### Step 5 — Make long channels cheap

- `useMemo` the parse in `MessageMarkup` keyed on `text`
  (`message-markup.tsx:98`), and memoize `bodyUrls` in `MessageEmbeds`.
- Hoist the `RegExp` in `findPathMatches` (`path-token.tsx:64`) to module scope
  and reset `lastIndex` per call.
- Extract the message row into a `React.memo` component so the 15 s tick stops
  re-rendering every body. The tick only needs to invalidate the relative
  timestamps — scope it to those.
- Then re-measure before adding virtualization; steps above may be sufficient
  and windowing a variable-height transcript is a much larger change.
- Tests: a render benchmark over a 300-message fixture as a regression guard.

### Step 6 — Renderer parity

- Port the escape repair and the step-2 heading fix into
  `MessageMarkupParser.swift`.
- Decide iOS deliberately: either back `MessageMarkupView` with the same
  grammar, or accept Hudson's `HudMarkdownView` as the standard and retire the
  other two toward it. Today the divergence is accidental, and the iOS path
  quietly diverges most.
- Tests: a shared fixture corpus asserted identically in
  `message-markup.test.ts` and a new Swift test.

### Deferred

Nested lists (3.3), strikethrough/images (3.4), the bare-string fallback (3.5),
and `overflow-wrap` (3.5) are genuine but low-severity. Group them into one
follow-up rather than expanding the critical path.

## 6. What is still unverified

1. **The actual reproduction channel.** Everything in §4 is mechanism analysis
   at local corpus scale (max 27 messages/channel). The reporter's channel is
   presumably far larger. Its message count and largest body size would let §4.1
   and §4.2 be ranked against each other instead of guessed at.
2. **Which surface froze** — browser tab, macOS window, or iOS. §4.1 and §4.2
   hit web and the macOS embed; §4.3 hits only macOS; iOS shares none of them.
3. **The state of `:43120`** when the freeze was seen (fresh `vite build`,
   stale `dist`, or mid-rebuild), which is what decides whether §4.4 stays ruled
   out.
