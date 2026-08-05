# Operator Console — design harvest

Source: `Operator Console.dc.html` in the Claude Design project
["Design critique: OpenScout interface"](https://claude.ai/design/p/eb06d124-c7a9-4a05-b78f-1fd63cbbd774?file=Operator+Console.dc.html).
A 1600×1000 three-pane mock of the Comms surface — rail · conversation · context —
shipped with **six complete themes** (Mission, Atelier, Unit 47, Meridian,
Porcelain, Editor).

This doc is the harvest: what the mock does better than our current direction,
what we should *not* trade away for it, and the two calls we need to settle
before any of it ports.

Compare against our current work:
- `design/studio/views/comms-one-rail.tsx` — direction v3 (hierarchy-first rail)
- `docs/design/comms-channel-navigation.md` — the rail contract
- `docs/design/tokens.md` — the token contract this proposes to extend

---

## 1. The theme contract is the headline idea

Our themes are **color swaps**. The mock's themes are *material* swaps. Every
`[data-theme]` block redefines four axes we currently hold constant:

| Axis | Tokens | Range across the six themes |
|---|---|---|
| Type | `--display` `--prose` `--label` `--prose-size` `--prose-lh` `--label-w` | Barlow Condensed / Playfair / IBM Plex + JetBrains Mono prose / Bricolage + Archivo / Bodoni + Instrument |
| Radius | `--r-sm` `--r-md` | `0/0` (Mission, Atelier) → `8/10` (Unit 47) → `4/6` (Editor) |
| Texture | `--texture` `--texture-size` | hairline grids, paper grain, dot screens, `none` |
| Light | `--bloom` | one or two radial gradients placing a light source in the frame |

Unit 47 sets `--prose: 'JetBrains Mono'` at `12.5px/1.75` while Porcelain sets
`'Instrument Sans'` at `15.5px/1.7`. Same markup, genuinely different instrument.
That is a much stronger claim than "dark and light."

**The mechanism worth stealing**, independent of the themes themselves: texture
and bloom render as *one non-interactive overlay* per pane, not as per-component
decoration —

```html
<div style="position:absolute; inset:0; pointer-events:none;
            background-image: var(--texture), var(--bloom);
            background-size: var(--texture-size), 100% 100%;"></div>
```

One div, zero interaction cost, fully themed. Turn bodies then sit *on* it with
`background: var(--frost); backdrop-filter: blur(8px)` and negative margins, so
the frost bleeds past the text and keeps prose legible over the grain.

**Caveat before porting:** native macOS theming (5×5) is our source of truth and
web follows. Extending the contract to type/radius/texture has to start there,
not in web CSS. And the mock's type ladder is off our scale
(9.5/10.5/11.5/12.5px) — `docs/design/tokens.md` bans those rungs, so any port
snaps to `--text-*`.

---

## 2. The agent turn as a live instrument

The strongest *component* idea. An agent's message is not a bubble — it is a
work object with four stacked registers:

1. **Header** — title, session-id chip, runtime line (`claude · tmux · 11 tools`),
   activity sparkline, `● Working 44s` with a pulsing dot.
2. **Running now** — the live command as syntax-tinted text with a blinking
   caret, behind a `2px` left rule with a faint glow. Not a spinner: *the actual
   thing currently executing*.
3. **Steps ledger** — a real table, `# | Tool call | Result | Took`, monospace,
   tabular-nums, one row per call, with `↑ 6 earlier steps` collapsing the tail.
4. **Actions** — `Observe · Terminal · Steer`.

We already have the steps ledger (working-turn steps ledger, macOS Live trace).
The mock resolves it further in three ways worth taking:

- **Four columns, not three.** A dedicated `Took` column in tabular-nums makes
  slow calls scannable down the column edge. Ours reads as prose.
- **Failure is legible at three zoom levels** — the step row carries a
  `2px solid var(--danger)` left border, the Result cell reads `✕ error`, and
  that call's sparkline bar is danger-colored. Glance / scan / read all land.
- **The sparkline itself** — 11 bars, ~3px wide, heights from call duration, the
  last few colored. The shape of the last N tool calls in 40px. We have uptime
  sparklines on Home; we have nothing per-turn.

---

## 3. Smaller ideas, ranked by leverage per line of code

1. **Composer placeholder teaches the routing model.**
   `Message #openscout — or @session to steer an agent` — the dual-address
   model in one line, at the exact moment you need it. Ours says "Reply to
   drover-7…". Free, and it's the thing people get wrong.
2. **Keycap chips.** `1px` border with `border-bottom-width: 2px` on a raised
   background = a physical key in 17px. Used for `⌘K`, `⏎ send`, `⇧⏎ newline`.
   One primitive would serve the keyboard-nav lane (K1–K8) and the shipped
   macOS chords.
3. **Section headers carry a count and a rule.** `NEEDS YOU ———— 2`. The rule
   uses `--line-strong` and the label uses accent for Needs-you, `--line` and
   muted elsewhere — **section weight itself encodes precedence**, before you
   read a word. Our rail sections are labels only.
4. **Elapsed as a hero numeral.** `52px` `MM:SS`, tabular-nums, with `elapsed`
   as a mono label and `since 20:53:48` beside it. Mission-clock idiom. This is
   exactly what the Inspector→Instrument direction wants. *Take the numeral,
   drop the box the mock puts it in — our rule is flat, no boxes.*
5. **Terminal at-rest state names the time.** `At rest — no output since
   20:54:32` over `Output appears here while the agent runs`. Not "empty" —
   *at rest, since*. The loading-vs-empty-vs-failed discipline, applied to a
   viewport.
6. **Corner registration ticks.** Four 4px accent squares at the terminal's
   corners. Says "instrument viewport" without spending a chrome bar.
7. **`§ 1` / `§ 2` section marks** in the context pane — makes a long inspector
   navigable and reads as instrument, not as document.
8. **Tabular-nums everywhere, ruthlessly** — every timestamp, duration, count,
   and id. Plus `text-wrap: pretty` on prose. Both are free.
9. **Scale-to-fit frame.** `transform: scale(min(vw/1600, vh/1000))` — how you
   present a fixed native canvas honestly in a studio page at any window size.
   Studio technique, not product.

---

## 4. What we should NOT trade away

The mock is better material; our v3 is better *architecture*. Three places
where taking the mock wholesale would be a regression:

- **It has no compression scheme.** The rail is a flat list — 14 agents, 4
  channels, every one a row. It does not survive 162 sessions, let alone 500.
  Our one-rail hierarchy (project grouping, sessions folded onto identities,
  churn rolled up, 112 observed behind one line) is load-bearing and the row
  count is load-invariant. Keep it; re-skin it.
- **It uses two accents plus danger.** Amber for attention, green for working.
  That is the categorical status coloring we banned. Keep one accent for
  attention and let *working* be carried by motion — the pulsing dot and the
  live caret already do it without a second hue.
- **Every turn is a frosted card.** That flattens the register distinction our
  turn grammar is built on, where only the ask is carded and accented. Use
  frost as the *material* under all turns; keep the card for the ask alone.

---

## 5. Resolved: the axes do not cost the same

Open call 1 went to Grok as an adversarial review
(`docs/eng/theme-token-contract-adversarial-review.md`). Its verdict was a flat
**no ship** on the four-axis contract. The load-bearing objections verify:

- `ScoutThemeColors` is **fifteen `Color` fields and nothing else**
  (`apps/macos/Sources/Scout/ScoutTheme.swift:27–42`) — no font, no radius, no
  texture. Radius is hardcoded outright: `bubbleRadius: CGFloat = 11`
  (`apps/macos/Sources/Scout/ScoutCommsView.swift:55`). Native has **nowhere to
  put** type or radius, and native is where the contract has to originate.
- Rail rows pair fixed padding with single-line ellipsis
  (`comms-one-rail.module.css:105–148`).

Grok also sharpened a claim this doc got loose. The rail's **structural** row
count is a compression scheme over data and survives a type swap untouched; what
does not survive is **viewport density** — 12.5px → 16.5px, or proportional →
monospace, reintroduces scroll. Those are different failures and only the second
one is real.

But "no ship" over-rejects, because the decomposition
([operator-console-themes.md](./operator-console-themes.md)) shows the four axes
have wildly different costs — which is the whole reason to decompose:

| Axis | Cost | Call |
|---|---|---|
| **Type** | ~88 web CSS files, ~55 macOS + ~28 iOS call sites; no native home; fights the fixed `--text-*` ladder | **Reject.** This is a design-system rewrite sold as four CSS vars. |
| **Texture** | one `pointer-events:none` overlay div | **Experiment.** No native parity burden — decoration may simply be absent natively without the themes diverging. |
| **Light** (`bloom`/`frost`) | one overlay div, same as texture | **Experiment**, with texture. |
| **Radius** | already in our contract, welded to canvas+accent | **Out of scope here.** Decoupling it is a standing ask from `appearance-decomposed-picker.md` §0.1 and is worth doing on its own merits. |

Grok's own concession matches: *"optional texture as a single non-default skin
is the only cheap piece."*

**So: the presets are preserved, the type axis is rejected, and texture + light
get a gated experiment against the control.**

## 5b. Bonus finding — the ask card survives light mode

Rendering the multi-agent thread under all six presets surfaced something the
mock wasn't trying to prove. `appearance-decomposed-picker.md` §0.3 and
`appearance-palette-spine.md` §1 both flag that **our selected/attention state is
invisible in light mode** — `--hud-accent-line` is accent at 0.42 alpha, so over a
near-white card it composites *toward* the surface (hudson light measures
**1.04:1** against the resting border, i.e. no signal at all).

The mock's ask treatment does not have this failure: a **solid** accent border
plus a low-alpha accent *fill*. The border carries full chroma regardless of
surface lightness, and the wash does the softening. It reads correctly in Atelier
and Porcelain, not just in the dark presets.

That is a direct, cheap fix for a filed defect and it is independent of every
theme-axis question above. **Take it.**

## 5c. Silhouette as a fourth marking channel for the ask

Six treatments rendered at `/studies/operator-console-themes`, under every
preset. The ask is currently marked three ways — carded, accent stroke, accent
wash — and **all three are color**. Shape is pre-attentive, spends no accent
budget, and reads identically in every preset.

Two house rules bound the option set, and both are load-bearing:

- **No tails.** Avatar-led turns were chosen over chat bubbles outright, so
  pointer/beak treatments are out on doctrine, not taste.
- **A left accent bar is legal only on square elements**, never on rounded. So
  "go square" is not a neutral option — it unlocks an idiom rounding forbids.

**The finding that decides it:** in the square presets (Mission, Atelier — both
`--r-md: 0`) the baseline "rounded card" has **no silhouette at all**. It is a
rectangle among rectangles, and the entire distinction falls back to color. So
the ask needs a shape that is *independent of the radius token* rather than
derived from it.

| Treatment | Verdict |
|---|---|
| **Ticket** (opposed chamfers) | **Take it.** Categorically different silhouette in all six presets — cuts against square presets *and* rounded ones. Semantic fit: a tag pulled from a rack is a work item you take. Collides with no existing idiom. |
| Chamfer (single corner) | Fallback if Ticket reads loud. Quietest option; same radius-independence. |
| Perforated foot | Reject — at turn size the punches read as a rendering artifact, not a tear-off. |
| Registration ticks | Reject — already spent on the live-terminal viewport (§3.6). Reusing it blurs both. |
| Square + left bar | Reject — collides with rail-row selection, and it collapses to the baseline in the square presets. |

**Guardrail, and it matters more than the choice:** shape must stay **binary** —
needs-your-reply versus everything else. The moment "working" gets one shape and
"error" gets another, we have rebuilt categorical status coding in a new channel,
which is the thing the one-accent rule exists to prevent. One shape, one meaning.

## 6. Still open

**Does texture belong in the product at all, or only in marketing surfaces?**
One cheap div, but it is the loudest thing in the mock and our house style is
quiet. The experiment has a built-in control: Editor is the only preset with
`texture: none`. If the textured presets do not beat it on legibility at equal
reading time, the texture axis is decoration and does not ship.
