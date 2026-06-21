# Scout macOS — Design-Review Brief & Augmentation Plan

**Baseline:** `docs/artifacts/macos-app-screenshots-2026-06-20/` (6 captures, 2026-06-20)
**Status:** Review only. No files modified. Intended as a Studio design baseline + ordered improvement path.
**Matrix caveat:** Every capture is a *single corner* of the theme matrix — `Paper` preset + `Dark` mode override + `Indigo` accent + `100%` surface opacity. Conclusions below must be re-checked against the light presets and the reduced-opacity (glass) states before shipping.

---

## 1. The product shell, read as one thing

The five surfaces already share real bones, and that is the good news:

- **One navigation spine** — far-left icon rail + `SCOUT` wordmark, consistent on every surface.
- **One header contract** — `ScoutColumnHeader` (64pt, hairline divider) drives every surface title.
- **One inspector** — `ScoutAgentInspector` is genuinely shared between Comms and Agents (not duplicated).
- **One accent + token system** — `ScoutThemeColors` / `ScoutPalette` decouples preset · accent · opacity cleanly.

So this is **not** a "rebuild the design language" job. It's a **finishing** job: the language exists but is applied at slightly different fidelity per surface, and a few global defaults undersell it. The most visible problem is that the **four data surfaces (Comms, Agents, Repos, Tail) read as one dense, confident app, while Settings reads as a different, half-empty app** — and a handful of shared atoms (eyebrows, selection, count chips) are tuned a notch too quiet to hold the whole thing together.

The single highest-leverage observation: almost everything that feels "not quite premium" traces back to **3–4 shared atoms**, not to 5 separate surfaces. Fixing the atoms lifts all five at once with near-zero structural churn.

---

## 2. Ranked opportunities

Ranked by **visible impact ÷ churn** — top items are the cheapest, most-propagating wins.

### R1 — Eyebrow/section-label contrast (highest leverage, one file)
Every section label (`ACTIVITY`, `RUNTIME`, `WHY`, `SESSIONS`, `DISTRIBUTION`, `TODAY`/`EARLIER`) renders through one component — `HUDEyebrow` in `ScoutHUD/HUDChrome.swift:425` — defaulting to `.inkFaint` (dim gray). It's on every surface, so it sets the app's perceived contrast floor. These labels are doing real structural work but are tuned to "barely there." **Lift the default to a readable muted-ink**, and keep hierarchy where it belongs — size (9pt), weight (semibold), mono, and the 1.85px tracking. This is the "ink always, hierarchy via size+weight, not opacity" principle, and it's a one-component change that propagates to all five surfaces.

### R2 — Selection state (low contrast + a disfavored pattern)
All three list surfaces select a row with a **2pt left accent bar + ~10% accent alpha wash** (`ScoutCommsView.swift:821`, `ScoutAgentsTree.swift:370`, `ScoutReposView.swift:634`). On the near-black background this barely registers, and the left-edge accent bar is exactly the treatment to move away from. **Replace with a solid same-hue surface lift** (raise the row's surface lightness rather than overlay an alpha wash), anchor selection on the leading avatar/status dot, and **extract one `.scoutSelectionHighlight()` modifier** so the three copies converge.

### R3 — Surface-header normalization (makes 5 screens feel like 1 product)
`ScoutColumnHeader` is shared, but each surface fills the trailing/secondary lanes its own way: Agents has a "98 AGENTS" pill, Tail has "32 logs · 61 procs" metrics, Comms has a live dot + Refresh/New, Repos has sortable column heads. **Standardize three things:** one title scale, **one count-chip treatment** (Agents pill = Tail metrics = the canonical chip), and one right-side action cluster. This is the change that most directly answers "make it feel like one shell."

### R4 — Inspector section rhythm
`ScoutAgentInspector` is shared and content-rich, but its internal sections (the `1 TURNS / 31 TOOLS` stat grid, `ScoutInspectorKVRow` runtime table, activity sparkline, context bar) each carry slightly different label→content spacing. The Repos inspector (`WHY` / `WORKTREES` / `CHANGES` / `ATTACHED`) is a separate stack with its own rhythm. **Define one inspector-section spacing token** and apply it across both — the panels become visually interchangeable.

### R5 — Settings density parity (kills the "two different apps" read)
About (`06`) is four rows pinned top-left in a vast empty canvas; Appearance (`05`) is similarly sparse. Against the dense data surfaces this looks unfinished. **Constrain settings to a max-width reading column with real vertical rhythm**, and give About an intentional centered identity card. Re-use the same eyebrow/section treatment as the data surfaces.

### R6 — Accent discipline
The Mode segmented control (`System / Light / Dark`, capture `05`) renders the active segment in **macOS system-blue** while the app accent is **Indigo** — two near-blues competing in one window. Route that control (and any other system-tinted control) to the **accent token** so there is exactly one accent.

### R7 — Semantic-color consistency
The tokens already exist (`statusOk / statusWarn / statusError / statusInfo`). Churn green/red, the amber `ATTENTION` badge, and live/idle dots should all flow from them, and the **live/idle vocabulary should read identically** across Agents, Repos ("1 live / 218 idle"), and the Comms live dot. Audit for any hardcoded hues.

### R8 — Type scale + density tokens (do last; most churn)
Formalize a small scale (display / title / eyebrow / body / caption / mono) and 1–2 row-density tokens, then retrofit. Lowest priority because it touches the most code for the least *immediately visible* gain once R1–R5 land.

---

## 3. Per-surface notes (tied to the captures)

**01 — Comms / Chats.** Rows carry a lot: avatar + name + secondary label (`session relay-openscout`) + preview + time + unread badge. Two cheap wins: (a) the `[ask:f-…]` signatures in previews are noise — strip them for parity with the mobile list, which already does this; (b) the secondary `session …`/`chat …` label rides on the dim eyebrow tone, so R1 fixes it for free. The message-thread reading column width and markdown rendering are good — leave them. The stale `Starting` pending row is a known live-state artifact (already fixed in source) — **do not design around it.**

**02 — Agents.** The project group-node vs child-agent distinction is carried only by a disclosure triangle + right-aligned "N agent" count; **strengthen the group-node weight** so the tree reads at a glance. The `UPDATED` column is a wall of identical "4h 53m" — de-emphasize repeated values or only surface time when it's meaningfully recent. "98 AGENTS" is the natural canonical count-chip for R3.

**03 — Repos.** Churn green/red is a strong signal — keep it. The `DRIFT` mini-track is too subtle to parse; consider a clearer ahead/behind affordance or a small label. The inspector (`WHY: Dirty main` → `WORKTREES / CHANGES / ATTACHED`) is the **cleanest stat stack in the app — make it the rhythm template for R4.** Ensure the amber `ATTENTION` badge is `statusWarn`, not a one-off hue. The inline "ask Scout about this repo" composer should match the Comms composer styling.

**04 — Tail.** Density here is *correct* — this is the firehose; don't sand it down. The real lever is the **bold-narration vs dim-raw-command** hierarchy (`exec_command(...)`, `write_stdin(...)` are the dim layer) — keep and sharpen it. `TIME / HARNESS / AGENT` repeats "codex openscout" endlessly; **blank or dim values that repeat the row above** so `ACTION` breathes. The `DISTRIBUTION` bars (codex 69% / claude 30% / cursor 2%) are a clean accent-tinted bar style — **reuse that exact bar for the inspector CONTEXT meter** for cross-surface consistency.

**05 — Settings / Appearance.** Theme preset cards are a good concept; the abstract swatches could preview the real surface/ink/accent triplet. Mode segmented = R6. Note the model: `Paper` is a *light* preset shown under a `Dark` mode override — which is why About reads "Theme: Paper" while the window looks dark.

**06 — Settings / About.** Four rows top-left in an empty window. Give it a centered identity card (wordmark, `0.2.72`, bundle, links). Consider showing the **effective** appearance ("Paper · Dark") so the light-preset-under-dark-mode model doesn't read as a bug.

---

## 4. Studio step plan

**First pass — token-level, near-zero structural churn, highest propagation.**
- R1: lift `HUDEyebrow` default off `.inkFaint` to readable muted-ink (keep size/weight/tracking as hierarchy).
- R6: route the Mode segmented control + any system-blue controls to the accent token.
- R7: confirm churn / `ATTENTION` / status dots all derive from `statusOk/Warn/Error/Info`.
- **Gate:** re-render across the matrix — all 4–5 presets × light/dark × 3 accents × the opacity slider — *before* moving on. The captures only prove Paper+Dark.

**Second pass — shared-component normalization.**
- R2: extract `.scoutSelectionHighlight()` (solid same-hue lift, no left bar, no white-alpha) → apply to Comms/Agents/Repos.
- R3: normalize `ScoutColumnHeader` — one title scale, one count-chip, one trailing action cluster.
- R4: one inspector-section spacing token → `ScoutAgentInspector` + Repos inspector + channel inspector.
- Comms: strip `[ask:…]` preview signatures (mobile parity).

**Third pass — surface-specific polish + scale.**
- R5: Settings max-width column + vertical rhythm + About identity card.
- Agents: group-vs-child weight; collapse repeated `UPDATED` times.
- Repos: clarify `DRIFT`; show effective theme/mode.
- Tail: collapse repeated `TIME/HARNESS/AGENT`; sharpen narration-vs-raw; reuse distribution bar for CONTEXT.
- R8: formalize type scale + density tokens; retrofit.

---

## 5. Implementation cautions (before touching SwiftUI / Hudson)

1. **Token-driven only.** Everything routes through `ScoutThemeColors` / `ScoutPalette` / `ScoutSurface` in `apps/macos/Sources/Scout/ScoutTheme.swift`. No hardcoded `Color`/hex — a literal that looks right in Paper+Dark will break across the preset × mode × accent × opacity matrix.
2. **The baseline is one corner of the matrix.** Verify the light presets and especially the **<100% surface-opacity (glass) states** — at reduced opacity, surfaces need the glass treatment (alpha + blur), and the new selection lift (R2) must still read against a translucent row.
3. **Hudson blast radius.** `HUDEyebrow` lives in-repo (`ScoutHUD/`) — safe to change locally. But anything inside the **Hudson package** (`HudCard`/`HudDivider`/`HudFont`/tokens, the `HudTheme` bridge in `ScoutDesign.swift`) is a *separate monorepo* consumed by **both** the ScoutMenu and Scout executables (offering pattern) — change it there only deliberately, via adoption, never silently.
4. **Don't reintroduce disfavored treatments.** Selection should not use a left-edge accent bar or a near-white-alpha wash — use a solid same-hue lightness lift. Eyebrows should lift to *readable muted*, not full ink (they're still eyebrows).
5. **Build/restart.** After any Swift edit, `bun apps/macos/bin/openscout-menu.ts restart` — `swift build` alone does not refresh the running app. Keep `#Preview` blocks guarded with `#if DEBUG && canImport(PreviewsMacros)` or the release/DMG build breaks.
6. **Live-state artifacts in the baseline.** The Comms `Starting` pending row is already fixed in source; the Tail stream is real agent chatter including this capture workflow. Treat both as live state, not target design.
