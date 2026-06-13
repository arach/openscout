# OpenScout macOS — visual design direction

Prepared by `claude.main.arts-mac-mini-local` in response to the "ugly / too green / too
washed" brief. Compares the current Scout theme against the **Lattices** and **Talkie**
native token systems and proposes one confident direction plus a concrete removal list.

Recommendation only — no code edited. File:line citations are to
`apps/macos/Sources/Scout/`.

---

## 1. Diagnosis — why it reads ugly today

### "Too green"
- **Default accent is forest green** and green is everywhere by default:
  `ScoutAccentPalette.current` defaults to `.forest` (`ScoutTheme.swift:136`), accent
  `rgb(0.18,0.60,0.34)` light / `#10B981` dark (`ScoutTheme.swift:108`).
- **4 of 5 theme presets lean green-teal**: scout=forest, workbench=teal, graphite=teal-green
  `rgb(0.16,0.57,0.50)`, juniper=green. Only porcelain is blue (`ScoutTheme.swift:182-272`).
- **Green does double duty as brand AND status.** In the scout preset `accent` and
  `statusOk` are the *same* green (`ScoutTheme.swift:193,195`). Selection wash `accentSoft`
  is a pale green (`0.84,0.91,0.87`). So buttons, selection, focus, caret, and "OK" all
  read as the same green — the eye sees green as the whole app's identity.

### "Too washed / too translucent"
- **The nav rail is liquid-glass at 0.72 translucency, always on** — `HudLiquidGlassConfig(…
  translucency: 0.72 …)` (`ScoutRootView.swift:173-184`). This is the single biggest source
  of the glassy/washed feel; it never turns off.
- **Light palettes have almost no contrast ladder.** scout light: bg `0.97`, chrome `0.94`,
  surface white — all within ~3%. Borders are `white 0.88` and hairline `0.91`, i.e. nearly
  invisible (`ScoutTheme.swift:183-199`). Everything is pale-on-pale with no edges, which is
  exactly what "washed out" looks like. workbench/porcelain/graphite/juniper repeat the same
  3%-spread mistake.
- **A window-opacity slider + vibrancy backdrop ship in the product.** `windowOpacity` ranges
  `0.0…1.0` (`ScoutAppearance.swift:53-54`) feeding an `NSVisualEffectView`
  (`.underWindowBackground`, `.behindWindow`) (`ScoutAppearance.swift:131-146`). Default is
  opaque, but the knob invites users to make the app see-through, and vibrancy desaturates
  whatever is behind it.

### "Too many knobs, none confident"
- **5 presets × 5 accents × 3 modes + an opacity slider.** The presets
  (workbench/porcelain/graphite/juniper) are near-duplicate neutrals separated by 2-3% channel
  values — choice paralysis without real differentiation, and no single look the app commits to.

**Contrast with the siblings:** Lattices (mac) and Talkie are *dark-first with a real contrast
ladder and a non-green accent*. Lattices mac: bg `#141416` → surface `#1A1A1A` (+26% lighter)
→ hover `#242424` (+40%), borders are white-opacity hairlines `0.08 / 0.14`, and **green is a
status color (`running`), not the brand** — the launch accent is white
(`lattices/apps/mac/Sources/UI/Theme.swift:6-24`). Talkie ships complete *named identities*
(Linear-indigo `#5E6AD2`, Tactical-orange `#FF8800`, Vercel-white, Carbon-green) each with a
confident single accent, not micro-variations of grey
(`talkie/.../ThemeManager.swift:113-262`).

---

## 2. Direction — "Scout Graphite": one identity, one signal accent

Pick **one** confident dark-first look, demote green to status-only, and give surfaces a real
contrast ladder. Light mode stays as a true second mode, not a fleet of presets.

### Palette (dark) — lifted from Lattices-mac + Talkie-Linear
| Token | Value | Source / note |
|---|---|---|
| `bg` | `#131416` | Lattices mac bg — hue-shifted neutral, not green |
| `chrome` (rail/toolbar) | `#0E0F11` | one real step **darker** than bg |
| `surface` (raised) | `#1A1B1E` | real +step, reads as a panel |
| hover | `#242529` | Lattices hover ladder |
| `ink` | `white 0.92` (#EAEAEA) | |
| `muted` | `white 0.58` | |
| `dim` | `white 0.40` | |
| `border` | `white 0.08` | hairline — crisp, not a grey fill |
| `borderStrong` | `white 0.14` | |
| **`accent`** | **indigo `#5E6AD2`** | Talkie "Linear" — the single non-green brand hue |
| `accentSoft` | `#5E6AD2 @ 0.13` | selection / focus wash |
| `statusOk` | green `#4CB782` | **green lives here only** |
| `statusWarn` | amber `#E89A3C` | |
| `statusError` | red `#E5484D` | |
| `statusInfo` | `= accent` (indigo) | stop using a separate blue for focus |

> If a warmer brand identity is preferred over indigo, the one alternative I'd ship is
> **amber `#E89A3C`** (Talkie "Scope" phosphor). Pick *one*; don't offer both as the default.

### Palette (light) — "Paper", a real second mode (only if light is wanted)
| Token | Value | Note |
|---|---|---|
| `bg` | `#FAFAFB` | |
| `chrome` | `#F1F2F4` | a **real** step from bg, not `0.94`-on-`0.97` |
| `surface` | `#FFFFFF` | |
| `ink` | `#14161B` | |
| `muted` | `#5B606B` | |
| `border` | `#DDE0E5` | **visible** edge (today's `0.91` is the bug) |
| `borderStrong` | `#C9CDD4` | |
| `accent` | indigo `#4954C4` | darkened for light contrast |

The single rule the current light themes break: **bg, chrome, and surface must be visibly
distinct, and borders must be seen.** Aim for ≥6-8% separation between adjacent surfaces and a
border at least ~12-15% off its surface.

---

## 3. Per-surface recommendations

### Rail / sidebar (`ScoutRootView.swift:125-184`)
- **Drop liquid glass.** Set the nav sidebar surface to a **solid `chrome`** fill (or
  `translucency: 1.0`). Glass-at-0.72 is the main "translucent" complaint.
- **Selection = solid, not wash.** Use a solid `accentSoft` fill plus a 2px accent edge bar
  (Talkie's `compactAccentBar` pattern, `talkie/.../SidebarLayout.swift`) instead of a glassy
  tint. The "S" rail swatch (`:142-147`) just re-tints to the new accent.
- Keep the fixed narrow rail + animated label column — that structure is good.

### Search / controls (`ScoutControls.swift`)
- **Unify the focus color to `accent`.** The search field currently focuses to `statusInfo`
  (blue) while the rest of the app accents green (`ScoutControls.swift:32,81`) — two competing
  highlight colors. One accent everywhere.
- **Give controls a real inset.** Today `ScoutSurface.control` light = `0.985` on a `0.97` bg
  (`ScoutTheme.swift:426-431`) — invisible. Dark: `white 0.04-0.05` fill + `white 0.08-0.10`
  border. Light: `#F0F1F3` inset on white + `#D8DADF` border. Focus = accent border `~0.65` +
  thin ring.

### Composer (`ScoutRootView.swift:997-1083`)
- The well's shadow is heavy (`radius 14`, `black 0.22`, `:1074-1079`) and reads muddy on a
  washed bg. With a real surface ladder you can drop to a hairline border + `radius 6 / black
  0.12`. Keep the accent caret (`:1006`) — that's correct; just re-tint to indigo.

### Settings (`ScoutSettingsView.swift`)
- **Collapse the sidebar to two groups: Appearance + About.** Drop the "System / Window"
  section entirely when the opacity slider goes.
- **Theme page = Mode segmented (System / Light / Dark) + at most 2 identity tiles** ("Scout"
  dark, "Paper" light), not the 5-tile grid (`:196-207`).
- **Accent page → 2-3 swatches max** (Indigo default, Amber, optional neutral) instead of 5
  (`:210-222`); or remove the accent page and ship a single brand color.

---

## 4. What to remove (concrete)

1. **Window opacity slider + vibrancy backdrop** — delete the Window settings section
   (`ScoutSettingsView.swift:224-254`), `windowOpacity` (`ScoutAppearance.swift:49-54`), and
   `ScoutWindowBackdrop` (`ScoutAppearance.swift:131-146`). Ship opaque. This is the literal
   "translucent" source under user control.
2. **Liquid-glass nav rail** → solid (`ScoutRootView.swift:173-184`, `translucency 0.72`).
3. **3 of 5 theme presets** — keep `scout` (retuned to Graphite) + optionally one light
   ("Paper"); drop `workbench`, `porcelain`, `graphite`, `juniper` near-duplicates
   (`ScoutTheme.swift:140-368`).
4. **2-3 of 5 accent palettes** — drop `forest` + `teal` (the green overload), keep indigo +
   amber (`ScoutTheme.swift:85-138`).
5. **accent == statusOk coupling** — decouple so green is status-only, never the brand
   (`ScoutTheme.swift:193,195`).
6. **statusInfo-as-focus** in search — use accent (`ScoutControls.swift:81`).

---

## 5. Suggested sequencing (if routed to implement)

1. Retune `ScoutThemePreset.scout` light+dark to the Graphite/Paper values above; set default
   accent to indigo and decouple `statusOk`. *(highest impact, smallest diff — kills "too
   green" + "no contrast" in one preset edit.)*
2. Solid-fill the nav rail (kill liquid glass). *(kills "translucent".)*
3. Unify control/search focus to accent; fix control inset fills.
4. Remove the opacity slider + Window settings section + backdrop.
5. Prune presets 5→1-2 and accents 5→2-3; restructure the settings sidebar.

Steps 1-2 alone resolve the three complaints; 3-5 are the cleanup that makes it feel
deliberate. **Next owner:** whoever is routed to the macOS theme work — this is a focused,
mostly-mechanical edit to `ScoutTheme.swift` + `ScoutRootView.swift:173-184` +
`ScoutSettingsView.swift`.
