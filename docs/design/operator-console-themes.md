# Operator Console — the six themes, decomposed

Extracted from `Operator Console.dc.html`
([Claude Design project](https://claude.ai/design/p/eb06d124-c7a9-4a05-b78f-1fd63cbbd774?file=Operator+Console.dc.html)).
Companion to [operator-console-harvest.md](./operator-console-harvest.md), which
covers the component ideas. This doc preserves the **themes**.

Rendered side by side at `/studies/operator-console-themes`.

---

## Why decomposed and not copied

[appearance-decomposed-picker.md](./appearance-decomposed-picker.md) §0.1 already
names our own failure here: `hudson` / `editorial` / `drafting` are "monolithic
blocks that each set canvas hue *and* accent hue *and* `--radius` together …
The picker is not offering three settings; it is offering three opinions."

The mock welds **harder** — it adds type, texture, and light to the same bundle.
So copying its six blocks in would import the exact defect we diagnosed, six
times over instead of three.

Instead: every theme below is pulled apart onto six axes. That keeps each theme
recoverable as a **named preset** while making the axes independently
selectable — Unit 47's corners on Meridian's canvas becomes a legal request.

---

## The six axes

| Axis | Tokens | In our contract today? |
|---|---|---|
| **Canvas** | `desk` `frame` `panel` `canvas` `raised` `sunken` `screen` | ✅ yes (as a surface ramp) |
| **Accent** | `accent` `accent-deep` `accent-ink` `accent-wash` `live` `danger` | ✅ yes |
| **Radius** | `r-sm` `r-md` | ✅ yes — but welded to canvas+accent |
| **Type** | `display` `prose` `label` `prose-size` `prose-lh` `label-w` | ❌ **new** |
| **Texture** | `texture` `texture-size` | ❌ **new** |
| **Light** | `bloom` `frost` | ❌ **new** |

The three new axes are the up-level. They are also the three Grok is being asked
to attack — see harvest §5, open call 1.

---

## The presets

### Mission — dark, warm, square
The default. Amber on near-black, condensed sans, zero radius, faint hairline grid.

| axis | value |
|---|---|
| canvas | `#030405` → `#0d0f13` → `#14171c` (neutral, chroma ~0) |
| accent | `#c9903f` amber · live `#86b39a` sage · danger `#c8655a` |
| radius | `0 / 0` |
| type | Barlow Condensed display+prose @ `16.5px/1.68` · JetBrains Mono label @ 400 |
| texture | hairline grid, 88px both axes |
| light | one amber radial, `900×460` at `22% 0%`, α 0.045 |

### Atelier — light, paper, editorial
Playfair serif on warm paper, one rationed red, real grain. Closest to the
[landing brand direction](./landing-refinement.md)'s Basel discipline.

| axis | value |
|---|---|
| canvas | `#e7e3da` → `#fbfaf7` warm paper · **screen stays dark** `#14110e` |
| accent | `#d8382a` red · **live = accent** (no second hue) |
| radius | `0 / 0` |
| type | Playfair Display display+prose @ `16.5px/1.68` · JetBrains Mono label |
| texture | `grain.png` + **asymmetric** grid, 124px × / 31px y — ruled paper, not graph paper |
| light | white radial, α 0.85 |

> The asymmetric grid is the single best texture idea in the set: a wide column
> rule against a tight baseline rule reads as *ruled stock* rather than as a
> grid overlay.

### Unit 47 — light, industrial, the only rounded one
Safety orange on warm gray, **monospace prose**, Syne labels at weight 700.

| axis | value |
|---|---|
| canvas | `#cfcbc2` → `#efece6` warm gray |
| accent | `#ff6a13` safety orange · live `#46c26a` with a hot glow (α 0.75) |
| radius | **`8 / 10`** — the only rounded preset |
| type | IBM Plex Sans display · **JetBrains Mono prose @ `12.5px/1.75`** · Syne label @ 700 |
| texture | 3px vertical hairlines + 22px dot grid |
| light | white radial |

> The one that proves the type axis matters: monospace prose at 12.5px is a
> different *instrument*, not a different palette. It is also the preset most
> likely to break our layouts — see harvest §5.

### Meridian — dark, cool, two light sources
Blue/teal on cool slate. The only preset with a second bloom.

| axis | value |
|---|---|
| canvas | `#04060a` → `#12171e` → `#1a2027` cool |
| accent | `#4fa3ff` blue · live `#3ecfa8` teal |
| radius | `4 / 8` |
| type | Bricolage Grotesque display · Archivo prose @ `15px/1.72` · Archivo label @ 600 |
| texture | 32px grid, both axes |
| light | **two** radials — blue at `56% -16%`, teal at `96% 112%` |

> Two opposing light sources at opposite corners give the frame a depth the
> single-bloom presets do not have. Cheapest dimensionality in the set.

### Porcelain — light, formal, dot-screen
Bodoni display over Instrument Sans, indigo accent, print-halftone texture.

| axis | value |
|---|---|
| canvas | `#eceef1` → `#fcfcfd` → `#ffffff` near-neutral cool |
| accent | `#3346c9` indigo · live `#12855c` green |
| radius | `5 / 9` |
| type | Bodoni Moda display · Instrument Sans prose @ `15.5px/1.7` · Instrument Sans label @ 600 |
| texture | **two** dot screens, 14px + 42px |
| light | white radial, α 0.9 |

### Editor — dark, neutral, textureless
A VS Code homage, and the control case: the only preset with `texture: none`.

| axis | value |
|---|---|
| canvas | `#141414` → `#1f1f1f` → `#252526` pure neutral |
| accent | `#4d9dfb` blue · live `#4ec9b0` teal |
| radius | `4 / 6` |
| type | Archivo display+prose @ `14.5px/1.72` · JetBrains Mono label |
| texture | **none** |
| light | neutral white, α 0.025 |

> Keep this one as the null hypothesis. If the textured presets do not beat
> Editor on legibility at equal reading time, the texture axis is decoration
> and should not ship.

---

## Cross-cutting observations

**Every preset carries a dark `screen` token, including the light ones.** Atelier
sits a `#14110e` terminal inside a paper-white UI. The terminal is treated as a
*physical instrument embedded in the surface*, not as a themed panel — which is
correct, and something our light-mode passes get wrong (see
[dispatch light-mode pass](../../MEMORY.md): muddy embeds from window opacity
over a black WKWebView).

**Two presets collapse `live` into `accent`.** Atelier sets `--live: var(accent)`
outright. That is the one-accent house rule, expressed as a theme choice rather
than a global constraint — and it is evidence the two-hue split in the other four
is optional, not structural.

**Radius and texture correlate inversely with formality.** Square + grain reads
editorial; rounded + dots reads industrial. Not a rule to encode, but it explains
why decomposing the axes matters: the *combination* is the character.

---

## What to do with this

1. **Preserve all six as presets** over the decomposed axes — done, above and in
   the studio study.
2. **Do not ship six themes.** The maintenance tax is N × 6 axes; harvest §5
   open call 1 is the gate.
3. **Editor is the control.** Any texture claim gets measured against it.
4. Canvas chroma check before any port: `appearance-decomposed-picker.md` §0.2
   puts our doctrinal canvas at chroma 0.004–0.008. Mission and Editor pass
   (~0). Atelier and Unit 47's warm grays do not — they would need the same
   "pull canvas chroma down, let the accent carry hue" fix that doc prescribes.
