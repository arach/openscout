# TalkieAgent — Overlay settings page polish direction

Prepared by `claude.main.arts-mac-mini-local` (cross-repo consult). Reviews the TalkieAgent
Overlay settings page and its floating preview, and proposes a concrete dress-up direction.
Recommendation only — no files edited. Citations are to `apps/macos/` in `/Users/art/dev/talkie`.

Files reviewed:
- `TalkieAgent/.../Views/Settings/OverlaySettingsSection.swift` (the page)
- `TalkieAgent/.../Views/Overlay/RecordingOverlay.swift` (real overlay + `OverlaySettingsPreviewController` floating preview)
- `TalkieKit/.../UI/LivePreviewScreen.swift` (shared in-card preview + `LiveStyleSelector`)
- `TalkieAgent/.../Views/Settings/SettingsView.swift` (the `SettingsCard`/`SettingsPageHeader`/`SettingsToggleRow` primitives)
- `TalkieKit/.../UI/OpsKit.swift` (the "Ops" design system — the Agent's amber treatment)

---

## 1. Root cause — why it reads "only okay"

**The page is half-Agent, half-legacy.** The *chrome* (page header, cards, toggle rows) is
built on OpsKit — `OpsInk` / `OpsTint.amber` (`#C47D1C`, glow `#E89A3C`) / `OpsType` /
`OpsCard` / `OpsSectionLabel` (`SettingsView.swift:502-608`). But every *custom control the
page adds itself* is built on the old tokens. Quantified on `OverlaySettingsSection.swift`:

| Signal | Count | Should be |
|---|---|---|
| `TalkieTheme.*` color refs | 15 | `OpsInk.ink/muted/dim` |
| `Color.cyan` accent | 2 | `OpsTint.amber` |
| raw `.font(.system(size:8/9/10))` | 13 | `OpsType.ui/mono(OpsSize.*)` |
| non-Ops `Spacing.*` + magic numbers | 11 | `OpsSpacing.*` |
| hand-rolled `Rectangle().fill(Design.divider)` | 5 | `OpsDivider` |
| `OpsKit` refs | **0** | — |

So you get **amber toggles sitting above cyan selection pills and grey ad-hoc sliders** — the
brand reads as two apps. `LiveStyleSelector`'s style pills and `AgentPositionButton`'s position
pills both light up `Color.cyan` (`OverlaySettingsSection.swift:389,393`,
`LivePreviewScreen.swift:680,684`); the in-card preview markers use `TalkieTheme.accent`
(`LivePreviewScreen.swift:161`). None of it is the Agent's amber.

**Three secondary problems:**
1. **The marquee Island controls are buried.** Width/Height/Speed/Response/Shape live *inside*
   the TOP BAR card, gated behind `if overlayStyle == .island`, a divider, and a 28pt indent
   (`OverlaySettingsSection.swift:67-74` → `IslandOverlayControls` `:184-244`). The five
   controls the user most wants front-and-center are a nested afterthought.
2. **Two slider idioms, misaligned.** Width/Height use `OverlayNumericSlider` (label + slider +
   numeric chip, `:275-308`); Speed/Response/Shape use `OverlayTuningSlider` (label + word +
   slider + word, `:246-273`). Different column widths (64 vs 48 vs 60pt) → the rows don't line
   up. "Reset" is a size-9, 0.7-opacity text afterthought (`:230-241`).
3. **An explanatory trail.** `SettingsToggleRow` always renders a `description` subtitle, and
   the page feeds it sentences: "Voice feedback at the top edge", "Persistent recording
   indicator", "Surface recent screenshots and clips at the top edge"
   (`:41,87,113`). For a compact pro panel, the label + live preview already say this.

**Note — duplicate previews.** There are *two* previews of the same thing: the in-card animated
`LivePreviewScreen` (`LivePreviewScreen.swift:126`) and a real floating `NSPanel`
(`OverlaySettingsPreviewController`, `RecordingOverlay.swift:434-652`) that mirrors actual
width/height/motion. Running two animated simulations is redundant and is part of the "busy /
only okay" feeling.

---

## 2. Direction — re-skin onto OpsKit, promote the Island controls, drop the trail

### A. Consistent Agent treatment (OpsKit everywhere)
- **Accent → amber.** Replace `Color.cyan` selection in `AgentPositionButton`
  (`OverlaySettingsSection.swift:389,393`) and `StylePill` (`LivePreviewScreen.swift:680,684`)
  with `OpsTint.amber`; replace `TalkieTheme.accent` preview markers
  (`LivePreviewScreen.swift:161`). **Caveat:** `LivePreviewScreen`/`LiveStyleSelector` live in
  shared **TalkieKit** and are also used by the non-Agent Talkie app — do NOT hardcode amber
  there. Thread a `tint: Color` parameter through both and have the Agent section pass
  `OpsTint.amber`. This is the one change that touches a shared file; everything else is local.
- **Type / color / spacing / dividers → Ops.** Route the 13 raw `.font(.system)` through
  `OpsType`, the 15 `TalkieTheme.*` through `OpsInk`, the 11 spacings through `OpsSpacing`, and
  the 5 hand-rolled hairlines through `OpsDivider`. This alone makes the page feel deliberate.

### B. Promote + unify the Island controls
- **Lift Island to a top-level `SettingsCard(title: "ISLAND")`**, sibling to TOP BAR, shown
  right under LIVE PREVIEW when `overlayStyle == .island` — not nested under TOP BAR behind a
  28pt indent. These are the headline controls; give them a card.
- **One slider component for all five.** Collapse `OverlayNumericSlider` + `OverlayTuningSlider`
  into a single `OverlayControlSlider`: fixed label column → slider → trailing value chip.
  Width/Height read `148pt`; Speed/Response/Shape read `0–100%` (or a single quiet end-label
  caption under the track), all on the **same grid** so the rows align.
- **Reset → a real `OpsButton` ghost/text button** pinned to the card's trailing edge, not a
  size-9 dimmed label (`:230-241`).

### C. Kill the explanatory trail
- Add a **compact `SettingsToggleRow` variant with no subtitle** (or skip the line when
  `description == ""`), and drop the three sentences (`:41,87,113`). Keep only the quiet
  eyebrow micro-labels ("Style", "Position", "Island") as `OpsSectionLabel`.
- Keep the `OverlayStyle.description` / position `.description` strings
  (`LivePreviewScreen.swift:33-42,88-119`) as `.help()` tooltips only — never inline.

### D. Compact, professional structure
- Target card order: **LIVE PREVIEW → STYLE (segmented style + position inline) → ISLAND (when
  island) → RECORDING PILL → CAPTURE PREVIEW.** Lean on `OpsCard` grouping instead of the
  toggle→divider→28pt-indent→sub-section pattern repeated in every card.
- **Dedupe the position rows.** `AgentOverlayPositionRow` and `AgentPillPositionRow`
  (`:310-371`) are near-identical (top vs bottom anchor) — replace with one
  `OverlayPositionPicker(tint:)`.
- **Match the odd-one-out control.** The Auto-dismiss `.segmented` `Picker` (4s/6s/10s,
  `:133-140`) is stock AppKit and won't match OpsKit — re-skin it as the same pill-segment
  idiom as the style/position selectors so every selector on the page looks alike.

### E. Resolve the double preview
- Keep the **floating real panel** (`OverlaySettingsPreviewController`) as the source of truth —
  it already reflects live width/height/motion (`RecordingOverlay.swift:608-627`). Slim the
  in-card `LivePreviewScreen` to a static **position map** (the 3+3 slot markers showing where
  HUD/pill anchor), and stop re-simulating the animation in-card. One animated preview, not two.

---

## 3. What to remove
1. **`Color.cyan` accents** (2×) — foreign brand in an amber app.
2. **The three toggle-row description sentences** (`:41,87,113`) — the explanatory trail.
3. **The duplicate in-card animated simulation** — collapse `LivePreviewScreen` to a static map.
4. **One of the two slider components** — unify Width/Height/Speed/Response/Shape on one row.
5. **The duplicated position-row structs** — one `OverlayPositionPicker(tint:)`.
6. **Hand-rolled `Rectangle().fill(Design.divider)` hairlines** (5×) → `OpsDivider`.

---

## 4. Suggested sequencing & owner
1. Thread `tint:` into `LivePreviewScreen` + `LiveStyleSelector` (TalkieKit), Agent passes
   `OpsTint.amber`. *(only shared-file touch; kills the cyan mismatch.)*
2. Re-skin `OverlaySettingsSection.swift` controls onto OpsKit (type/color/spacing/dividers).
3. Promote Island to its own card + unify the five sliders + real Reset button.
4. Drop the description subtitles; add the compact toggle-row variant.
5. Re-skin the Auto-dismiss picker; dedupe the position rows; slim the in-card preview.

Steps 1-2 deliver the "consistent Agent treatment"; 3 delivers "clearer Island controls"; 4
delivers "no explanatory trail"; 5 is the compact-pro finish. **Next owner:** whoever does the
TalkieAgent UI work — this is a focused re-skin of one file plus one small shared-component
signature change. No settings-binding, preview-controller, or visualization logic changes.
