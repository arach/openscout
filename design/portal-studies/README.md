# Portal studies

Side-by-side design studies for the `scout.local` portal — the page the broker
serves at the bare mesh host before the SPA shell. These are **studies, not
production**: the shipping page is `renderScoutLocalPortal` in
`packages/web/server/create-openscout-web-server.ts`.

Each file is self-contained (inline CSS/JS, no external assets, no build step).

```
open design/portal-studies/scout-local-sober-ascii.html
```

## `scout-local-sober-ascii.html`

Same product surface as production — title, one lede, one node row, the domain
once, a Docs/GitHub trust strip — with the ASCII promoted from ornament-that-fades
to the thing worth screenshotting. Palette is near-black field, warm off-white
ink, and muted warm greys only; no accent hue.

### Motion model

**Wavefronts, not a shape.** Rings emanate continuously outward from the centre
on a **6.5s** period, so the structure genuinely travels rather than a fixed
silhouette fading in and out. Crests are sharpened (`cos^3.5`) into thin arcs
with dark gaps between them, which is what keeps the field reading as an
instrument trace rather than a filled blob.

Two slower modulations stop it looking plotted: a two-fold angular **phase**
wobble on a non-commensurate **17s** — the rings go gently out-of-round and
drift, rather than being punched full of holes the way a brightness modulation
would — and a fixed per-cell grain on the quantisation edges.

The rendering is the craft bit. One density value drives **two channels**:

| channel | carries | drawn from |
| --- | --- | --- |
| glyph | coarse 2-step dither | `·` `░` |
| tone | finer 5-step ramp | 5 warm greys |

Both are monotonic in density, so together they read as an effective ~10-step
ramp built from only two glyphs. `▒`, `▓` and `█` are absent on purpose: they
are designed to tile seamlessly, so any run of two or more collapses into a
solid bar at 10px and the field goes blocky instead of woven. This was the
single biggest thing separating a cheap-looking ASCII orb from an expensive
one, and it took three iterations to isolate.

Each tone level lives in its own space-padded `<pre>`, stacked so the glyphs
register exactly. That buys real tonal separation for the cost of five
text-node writes per frame instead of ~900 individually styled DOM nodes. The
loop runs at a deliberately calm 24fps and pauses on `visibilitychange`.

The field is computed on a rectangle, so its boundary is dissolved by a radial
mask and it reads as a field the page fades into rather than a cropped texture
patch — the JS falloff handles density, the mask handles the corners.

### Accessibility

- The field is decorative and `aria-hidden="true"`.
- `prefers-reduced-motion: reduce` renders a **still frame** (`STILL_T`, phase
  2.6) and never starts the animation loop. The preference is watched live, so
  toggling it stops or resumes without a reload.
- First paint uses that same phase and the loop resumes from it, so there is no
  pop on load or on tab re-focus.
- External links carry `target="_blank" rel="noopener noreferrer"`.

### Reviewing a specific phase

Append `?t=<seconds>` to pin one frame, which makes phases comparable side by
side and screenshottable:

```
open "design/portal-studies/scout-local-sober-ascii.html?t=2.6"   # the still frame
open "design/portal-studies/scout-local-sober-ascii.html?t=5.0"
```

> Note: this study has had more than one author. If the constants above drift
> from the file, the file wins — `STILL_T` and the two periods (`p1`, `p2`) in
> the `render` function are the source of truth.

## Worth stealing into production

Ranked for Opus A. The first is the one that matters and it is independent of
which animation production ends up with.

1. **Drop `▒`/`▓`/`█` from any density ramp at this size.** They are seamless
   tiling glyphs; two adjacent cells make a bar, and the field stops reading
   as ASCII. `·` and `░` dither.
2. **Split glyph and tone into separate stacked `<pre>` layers.** A finer
   effective ramp than glyphs alone can give, for ~5 DOM writes per frame.
3. **Sharpen wave crests** (`cos^n`) so structure reads as thin arcs rather
   than wide bands.
4. **Modulate phase, not brightness**, when a field should look alive —
   brightness modulation eats holes in the structure it is meant to animate.
5. The **`?t=` frame pin** is four lines and makes any animated surface
   reviewable and diffable by screenshot.
