# HUD roadmap — next phase (iter 7 → 12)

Supersedes the visual assumptions in `~/.claude/plans/cryptic-nibbling-rabin.md`. The iter-1–6 trajectory still holds; the broadsheet/serif/per-agent-hue/gradient-hairline language called for there no longer matches what shipped.

## Design baseline (current)

- **Canvas.** Warm-dark solid (`HUDChrome.canvas` ≈ rgb 30,28,25) over `NSVisualEffectView(.hudWindow)`. No glass-on-glass, no mesh-light, no specular sweep on the body.
- **Type.** Inter for body + "display" (serif alias retired in `HUDType.display`, forwards to `body`). JetBrains Mono for counts, eyebrows, keycaps, time. No italic voice.
- **Accent.** Single lime (`HUDChrome.accent`) for working/attention states and the active navigator underline. No cyan, no rose, no per-agent hue paint.
- **Row pattern.** "Manifest" — `[6pt state dot] [name sans 13/semi] [STATE mono 9 eyebrow] [ago mono 10]` over `[indented task sans 12]`. Active/expanded gets a 1.5px lime left rule; hover lifts canvas-alt to 0.30. Hairlines: solid 1px `HUDChrome.border`.
- **Removed.** Edition number, italic voice quote, per-agent hue underline, gradient hairlines, mesh-light specular, glass-on-glass.

Files: [`HUDChrome.swift`](../Sources/HUD/HUDChrome.swift), [`HUDStatusView.swift`](../Sources/HUD/HUDStatusView.swift), [`HUDTailView.swift`](../Sources/HUD/HUDTailView.swift), [`HUDSessionsView.swift`](../Sources/HUD/HUDSessionsView.swift), [`HUDController.swift`](../Sources/HUD/HUDController.swift).

---

## Iterations 7–12

### Iter 7 — Chatter view

**Goal.** Fourth view: unified messages stream across channels, DMs, a2a.

**Deltas from rabin plan.** Original called for per-source glyphs and wire-copy rows. Now: a Chatter row is a manifest variant — `[6pt source dot] [who → to sans 12] [SRC mono 9 eyebrow: CHAN/DM/A2A] [ago mono 10]` over `[snippet sans 12 muted]`. No glyph parade, no italic. Selected row reuses Fleet's lime left rule.

**Files.** `Sources/Services/ChatterService.swift` (new, mirrors [`HudFleetService.swift`](../Sources/Services/HudFleetService.swift)), `Sources/HUD/HUDChatterView.swift` (new), [`HUDState.swift`](../Sources/HUD/HUDState.swift) (+ `.chatter`), [`HUDController.swift`](../Sources/HUD/HUDController.swift) (key 21), [`HUDStatusView.swift`](../Sources/HUD/HUDStatusView.swift) (router + navigator).

**Done.** Press `4`, see broker messages newest-first; Enter handed to iter 8; offline shows the same `BrokerOfflinePip` Fleet uses.

### Iter 8 — Selection + drill-in (Agent Detail)

**Goal.** Every view is j/k navigable; Enter opens a detail surface.

**Deltas from rabin plan.** Selection reuses the existing 1.5px lime left rule (no new 2px stripe). Detail drops the "full agent page + stat grid + thread" maximalism — v1 lifts the current `AgentExpandedPanel` ([`HUDStatusView.swift`](../Sources/HUD/HUDStatusView.swift)) into a routed view: masthead echo + stacked manifest sections (PENDING ASK → LAST TURN → CAPABILITIES → SELECTOR) + back chip. No serif headline, no per-agent hue band.

**Files.** [`HUDState.swift`](../Sources/HUD/HUDState.swift) (+ `selectedRowIndex` per view, `previousView`, `.agentDetail(id)`), `Sources/HUD/HUDAgentDetailView.swift` (new), `Sources/HUD/HUDChatterThreadView.swift` (new, post-iter 7), row components (`isSelected` prop), [`HUDController.swift`](../Sources/HUD/HUDController.swift) (j=38, k=40, Return=36).

**Done.** j/k cycles in every view; Enter opens detail; Esc returns and restores prior selection.

### Iter 9 — Operator input dock

**Goal.** Critique/direct the selected agent without leaving the HUD.

**Deltas from rabin plan.** Inline under the selected row (no separate panel), manifest-flavored not "QuickSteer translated": `canvasLift` fill, 1px solid border, mic glyph + Inter text field + send + save on one row. No accent flood on focus — focus lifts border to `borderStrong` and extends the lime left rule through the dock. Save-as-annotation is a thin lime tick at the row's left edge.

**Files.** `Sources/HUD/HUDInputDock.swift` (new), [`HUDStatusView.swift`](../Sources/HUD/HUDStatusView.swift) (conditional layout under selected row), [`HUDController.swift`](../Sources/HUD/HUDController.swift) (`i`=34, ⌘↵, Esc), [`HudFleetService.swift`](../Sources/Services/HudFleetService.swift) (+ `send(message:, to:)`).

**Done.** `i` on Hudson, type, ↵ delivers via broker `messages_send`; Esc dismisses; ⌘↵ leaves a lime tick.

### Iter 10 — Summon variants + position persistence

**Goal.** Five hotkeys; HUD remembers where you put it.

**Deltas from rabin plan.** Hyper+Space omnibar adopts the warm-dark canvas + Inter/JBM tokens — a *short* HUD, not a different surface. 600×52 single line, lime left rule on focus, no separate chrome. Position store keys on `(screenID, view)`.

**Files.** `Sources/HUD/HUDOmnibarController.swift` (new, reuses `OverlayPanelShell`), `Sources/Services/HUDPositionStore.swift` (new, `~/.openscout/hud-position.json`), [`AppDelegate.swift`](../Sources/AppDelegate.swift) (Hyper+Space/T/S/C), [`HUDController.swift`](../Sources/HUD/HUDController.swift) (consult on show, write on drag-end).

**Done.** Five summon hotkeys live; omnibar sends via broker; HUD frame is sticky per `(screen, view)`.

### Iter 11 — Density + `/` search + `?` cheatsheet + `,` settings

**Goal.** Scale the manifest across operator load; give the keymap a surface.

**Deltas from rabin plan.** Density cycles compact (current default) ↔ comfortable ↔ dense — height + leading change only; identity-line layout never restructures. `/` filter strip lives under the masthead, reuses iter 9's dock styling. `?` is a `canvasAlt` overlay with mono keys + Inter labels — no translucent glass. `,` settings is a routed view (`.settings` case), not a popover, so it inherits navigator chrome.

**Files.** [`HUDState.swift`](../Sources/HUD/HUDState.swift) (+ density, filter, overlay state), `Sources/HUD/HUDCheatsheetView.swift` (new), `Sources/HUD/HUDSettingsView.swift` (new), row components (density-aware), [`HUDController.swift`](../Sources/HUD/HUDController.swift) (`c`=8, `/`=44, `?`=44+shift, `,`=43).

**Done.** Three density tiers render legibly; `/` filters everywhere; `?` lists every key; `,` exposes density-default, hotkey rebind, position reset.

### Iter 12 — Slot extension (web views inside the HUD)

**Goal.** HUD hosts arbitrary studio web views in numeric slots.

**Deltas from rabin plan.** Slots inherit panel chrome + corner radius — `WKWebView` masked into the warm-dark canvas with a 1px `border` overlay. Slot tabs reuse the `NavigatorLink` atom (no separate slot strip). Default slot bg is `HUDChrome.canvas`, not white, so studio dark pages don't flash.

**Files.** `Sources/HUD/HUDSlotView.swift` (new, hosted `WKWebView`), [`HUDState.swift`](../Sources/HUD/HUDState.swift) (`.slot(id)` + registry), `Sources/Services/HUDSlotStore.swift` (new), [`AppDelegate.swift`](../Sources/AppDelegate.swift) (Hyper+5..9), [`HUDStatusView.swift`](../Sources/HUD/HUDStatusView.swift) (navigator extension).

**Done.** Bind a URL to slot 5 in settings; Hyper+5 summons that studio page inside the HUD shell with no chrome flash.

---

## Cross-cutting tracks (run in parallel with the iteration list)

### Size tiers (compact / medium / wide)

Currently **compact** at 420×520. Two larger tiers are deferred from task #54:

- **Compact** (360–520w). Manifest row, today's baseline.
- **Medium** (~640w). Aligns with the `agent-cards` study tile: identity line + a second eyebrow strip for runtime/files/tokens/branch — the `statRibbon` already in [`HUDStatusView.swift`](../Sources/HUD/HUDStatusView.swift) is the seed. No new tokens.
- **Wide** (~880w, max). Aligns with `hud-native` 3-column: left = manifest list, center = selected agent detail (iter 8), right = activity tail filtered to that agent (iter 7 atoms).

Size tier follows panel width, not a mode toggle. Each iter lands compact first; medium/wide follow once iter 8 gives the center column something to render.

### Sessions: AppleScript permission affordance (task #44)

[`SessionScanner.swift`](../Sources/Services/SessionScanner.swift) hits AppleScript for iTerm/Terminal; denials currently fail silently. Affordance: when scanner returns `.permissionDenied` for a source, the Sessions header shows a single inline manifest row — `[stop dot] [iTerm permission required eyebrow] [Grant chip]` — opening System Settings → Privacy & Security → Automation. Same chrome as a session row; no banner, no modal.

### Keyboard nav consistency

j/k/Enter/Esc/`/`/`?`/`,`/`i` must behave identically across Fleet, Tail, Sessions, Chatter, Settings. Each iter that adds a view extends both monitors in [`HUDController.swift`](../Sources/HUD/HUDController.swift) with the full key set — `globalKeyMonitor` and the local `onKeyDown` must stay in lockstep; drift is the likeliest regression vector.

---

## Critical ordering note

Selection + drill-in (iter 8) unlocks every interaction after it — input dock (9) targets a selected row, density (11) needs a selection model to preserve focus across resizes, and detail is the only surface that justifies the wide tier — so 8 is the highest-leverage next ship even though Chatter (7) is sequentially numbered first.
