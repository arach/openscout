# openscout.app home — refinement pass (craft + legibility)

Date: 2026-07-09
Status: applied 2026-07-09 (same day) — items 2–6 as specced; item 1 revised
during implementation, see the addendum inside it. Remaining open work: the
full-window macOS retake (item 1).
Surface: `landing/openscout.app` home page (`src/app/page.tsx` + hero/figure components)
Source: design critique of a full-page capture (1263×2018, 2026-07-09), grounded
in the code below. Line numbers are against the working tree at the time of
writing and will drift — anchor on the symbol names.

The direction is not in question. Basel paper/ink is landing: red rationed to
annotations (kickers, the scout node, `MESH · LOCAL`), the copy voice is human
("We built Scout because we kept jumping between…"), and the with/without story
told through matched artifact panels is persuasion, not decoration.

The through-line of this pass: **every artifact panel must be legible at
display scale.** The hero console, mesh figure, and silo desktop are *drawn*
at 1:1 and set the craft bar. The Apps section breaks it with raw app
screenshots scaled ~3× down. A second theme: two things that are deliberate in
the code (the `@arc` pair, the with-first ordering) don't read as deliberate on
the page — make the intent legible instead of removing it.

---

## 1. The Apps — recrop, don't shrink (the big one)

**Where:** `src/app/page.tsx` surfaces section (`id="surfaces"`, gallery filter
to `["Mobile", "Native app", "Fleet briefing"]`); assets
`public/scout/ios-home.png` (1206×2622), `public/mac/app-native.png`
(1332×947), `public/relay/home-command-center.png`.

**Observed:** the `scout · agents` panel squeezes the full 1332px-wide macOS
window into ~430px — every roster row is illegible pixel noise. The iPhone
frame shows the top of `ios-home.png` (status bar + header + whitespace)
because `object-cover object-top` crops a 2622px-tall shot to the least
interesting region. Next to the crafted hero console and mesh figure, the
closer section reads unfinished.

**Change:** export purpose-built crops at ≤1.5× display size, each making
ONE legible point:

- **iphone** — a content-rich region: machines + a couple of project rows,
  type readable inside the device frame. If the current iOS home's top half is
  sparse, crop to the band that isn't, or retake the shot with the fleet
  populated.
- **mac** — roster rows + inspector header at ~1:1, cropped to the panel
  width. Not the whole window; the point is "roster with a live inspector,"
  three readable rows prove it.
- **web (Fleet briefing)** — same treatment: one readable band (active asks +
  a couple of agents), not the whole dashboard.

Keep the existing `surface-figure__chrome` labels (`scout · iphone`,
`scout · agents`) — they're doing the framing work already.

**Rule going forward:** no full-app screenshot rendered below ~75% of natural
size anywhere on the page. If it needs to shrink more than that to fit, it's
the wrong crop.

**Accept when:** at 100% browser zoom, every line of text inside all three
panels is readable, and each panel demonstrates the one claim its gallery
`description` makes.

**Addendum (applied):** implementation revised this item against the code:

- **iphone — no change.** The CSS is explicit that the full screenshot shows
  in a bezel, uncropped (`.surface-phone__stage` comment in `globals.css`) —
  the deliberate device-shape idiom, not a bad crop. The "empty phone" in the
  critique capture was banding in the capture itself; the live panel shows
  the full populated home. Phones read as whole devices; a mid-screen band
  under a bezel + island would look broken.
- **mac — interim asset swap, not a crop of `app-native.png`.** The
  full-window shot's roster carries dev-noise names ("Openscout Card 0
  Lxrq1a", "Grok Hudson None"); any legibility improvement makes that *more*
  visible. Swapped the slot to `/mac/hud-roster-band.png` (538×312, top band
  of `hud-agents-roster.png`: tab bar + five clean roster rows) at ~75% scale,
  chrome `scout · hud`, description rewritten to the menu-bar-cockpit claim.
  The full-window app shot returns when a clean retake exists — that retake is
  the one remaining open task.
- **web — as specced.** `/relay/home-briefing-band.png` (960×314, the
  greeting band of `home-command-center.png`): "Good afternoon, operator. /
  1 agent is working now, 1 thing needs you." + actions + fleet heart-rate.
  Fully legible at display scale.

## 2. Peers rail — make the `@arc` pair read as a feature

**Where:** `src/components/scout-console.tsx` — roster entries `arc` /
`arc-codex` (`AGENTS`, lines ~42–43) and the rail tag rule (~404–406).

**Observed:** `arc` (claude, main) renders as bare `@arc`; `arc-codex` (codex,
main) renders as `@arc` + `codex` chip. Two visually identical `@arc` rows in
the single most-examined mock on the page. The code intends "one definition,
two harnesses" — the page shows "duplicate mock data."

**Change:** when a `definitionId` appears more than once within a node group,
chip the harness on **both** rows (`claude` and `codex`), not just the
non-claude one. Keep the existing rule (chip non-claude harnesses, chip
non-main workspaces) and keep the `@arc#codex` search hint in the composer —
with symmetric chips the pair now demos harness-qualified addressing instead
of looking like a bug.

**Accept when:** the rail shows `@arc [claude]` / `@arc [codex]` adjacent, and
no two rail rows are visually identical.

## 3. Nav — drop the sigil costume

**Where:** `src/app/page.tsx` header (`operator-link` render: the
`operator-link__sigil` span and the `label.toLowerCase().replace(/\s+/g, "-")`
transform), plus the right-side `:github` / `:docs` / `:blog` links.

**Observed:** `:how-it-works`, `:features`, `:github` — syntax dress-up in the
most-read strip on the page. The RFC costume was retired for layered-plain
language (2026-06-12); this is the last place chrome still dresses up as code.

**Change:** plain labels — "How it works", "Features", "GitHub", "Docs",
"Blog". Delete the `:` sigil span and the lowercase-hyphenate transform. The
mono face can stay; texture is fine, syntax is the costume.

## 4. Stop calling the problem "How it works"

**Where:** `src/app/page.tsx` — `howItWorksContent.eyebrow` and the matching
`navLinks` label (`{ label: "How it works", href: "#mesh" }`).

**Observed:** one "How it works" eyebrow spans both rows, but the second row
("Every agent in its own tool", the silo desktop) is the *problem*, not how
anything works. The with-first ordering is a deliberate, commented call —
lead with the positioning — and it's the right one for scroll behavior; the
mislabel is the only thing wrong.

**Change:** rename the eyebrow to **"Why Scout"** — it honestly covers a
value-then-contrast pair and keeps the chosen order. Update the nav label to
match. (The alternative — swap back to before→after under the current eyebrow
— trades the stronger first impression for rhetorical convention; not worth
it.)

## 5. Silo desktop — clutter, not garble

**Where:** `src/components/silo-desktop.tsx` (`WINDOWS` lines), `.silo-win`
cascade in `globals.css` (58% width, staggered `left` offsets).

**Observed:** the overlapping windows occlude body lines mid-identifier —
"✎ addressab…" reads as a rendering bug in stills, and stills are how this
page gets shared. The chaos is the point; the garble isn't.

**Change:** shorten each window's `line` to fit its exposed strip in the
cascade — e.g. `✎ agents.ts · unsaved`, `$ bun run build`, `› drafting plan`,
`● 3 files changed`. Occlusion should land between words, never inside an
identifier.

## 6. Ration "neutral"

**Where:** `src/app/page.tsx` — the PROTOCOL entry in
`howItWorksContent.after.capabilities`.

**Observed:** five "neutral"s by the first scroll: the headline ("Neutral by
design."), the three hero badges, and "Speaks ACP — open and model-neutral, no
lock-in."

**Change:** the headline + badge triplet IS the drumbeat — keep it. Reword the
capability line to "Speaks ACP — open protocol, no lock-in." One word out, the
theme stops echoing.

---

## Locked (working — don't "fix")

- **Mesh figure** (`mesh-figure-svg.tsx`) — drawn at display scale, caption
  matches the drawing (`scout + 5 peers · 2 mesh links`). This is the craft
  bar item 1 raises the Apps section to.
- **Copy voice** — "We built Scout because…", "It's mostly about the
  agents…". Layered-plain is working; don't formalize it.
- **Kicker color logic** — gray WITHOUT / red WITH. Quiet and correct.
- **Hero console** — composer grammar demo, thread/resolve/send tabs, the
  Agent-View toggle concept.

## Order of work

Items 2, 5, 6 are minutes each (mock data + one word). Items 3 and 4 are
small diffs but brand-level calls — do them together as one "language" commit.
Item 1 is the real work and it's mostly **asset work** (three purpose-built
crops), not layout work; the section code barely changes.
