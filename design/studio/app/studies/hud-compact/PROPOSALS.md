# HUD Compact — Visual Elevations

Seven proposals along rhythm, affordance, density, state, type, and hairline. Single lime accent, ink scales, sans + mono, solid colors.

---

### 1 — Optical alignment under the dot

**What**: Align secondary lines to the dot's vertical column instead of a hardcoded indent.
**Before**: `HUDStatusView.swift:596` indents `taskLine` by `.padding(.leading, 14)`; dot frame is 12pt at `spacing: 8`, so the dot drifts ~1px off-column under different name weights.
**After**: One `dotColumnX` constant reused by task, capabilities, and selector lines — every secondary line rides the same invisible rail.
**Why it elevates without polluting**: pure geometry, no new ink. Tighter read at zero visual cost.

---

### 2 — Time gutter as a fixed mono column

**What**: Reserve a fixed-width right gutter for `ago` so the column locks across `"3s"` vs `"12h"`.
**Before**: `HUDStatusView.swift:580` and `AgentRow.tsx:137` use `Spacer(minLength: 6)` / `flex-1 truncate` before `ago`; the time edge wobbles 12–18px row-to-row.
**After**: Pin `ago` to `min-w-[4ch] text-right tabular-nums` / `.frame(width: 36, alignment: .trailing)`, unit suffix ("S/M/H/D") at eyebrow tracking in `inkFaint`.
**Why it elevates without polluting**: redistributes existing space; mono digits already in the stack. The right margin becomes a calendar.

---

### 3 — Three explicit density modes

**What**: Promote `comfortable / compact / dense` as tokens for padding, dot size, and eyebrow visibility; panel picks mode from height.
**Before**: `AgentRow.tsx:106` ships a hand-tuned `manifest`; `HUDStatusView.swift:516` hardcodes `.padding(.top, isFirst ? 11 : 10)` with no density switch.
**After**: `padY ∈ {6, 4, 2.5}`, `dot ∈ {7, 6, 5}`, `eyebrow ∈ {shown, shown, hidden-on-passive}`. Below 380pt panel height, fleet shifts to `dense` and drops STATE eyebrows on `available/waiting/done`.
**Why it elevates without polluting**: same row, three breathing patterns; state semantics survive on dot + accent.

---

### 4 — Inset hairlines, full-bleed section breaks

**What**: Inset row dividers; full-bleed only on structural breaks.
**Before**: row dividers already inset (`HUDStatusView.swift:533`), but the expanded panel (`:754`) has no top hairline, so it floats against the parent row's inset divider with no edge.
**After**: `borderSoft` row-to-row; `border` full-bleed for masthead, footer, and the expanded panel's top + bottom. Two tokens, two jobs.
**Why it elevates without polluting**: zero new color; reuses existing tokens. The eye learns which edges are delimiter vs navigation.

---

### 5 — Empty / loading / broker-down as one typographic ladder

**What**: One layout for all three non-list states: eyebrow → sans headline (18/600) → one-line caption → keyboard pill.
**Before**: `FleetEmptyView` (`:825`) leans on a 44pt mark and italic body; `FleetLoadingView` (`:772`) shows skeletons with no heading; broker-offline is only a 5pt red dot in the meter (`:398`).
**After**: One `HUDEmptyFrame`, three variants — `loading` ("listening", skeletons below), `empty` ("the fleet is quiet"), `offline` ("broker unreachable", `⌃R retry` chip). Drop italics; differentiate through copy and weight.
**Why it elevates without polluting**: three states stop looking like three apps. Type does the work, no serif, no italics.

---

### 6 — Eyebrow tracking and weight discipline

**What**: Lock eyebrows to two tracking/size/weight pairs; reserve accent for eyebrows on rows the operator should look at.
**Before**: `HUDStatusView.swift` ships three eyebrow tunings — `mono(9, .semibold)` on rows (`:572`), `mono(8.5, .bold)` in footer (`:227`), `mono(9.5)` in empty (`:864`). The STATE label uses `stateColor` even on passive rows.
**After**: `eyebrow.row` (`mono 9 / semibold / +0.6`) and `eyebrow.micro` (`mono 8.5 / bold / +0.8`). Color = `inkDeep` by default; `accent` only when state ∈ {working, needs-attention}. Passive rows lose the colored eyebrow.
**Why it elevates without polluting**: less paint; accent regains meaning by leaving idle rows.

---

### 7 — Focus, hover, selection as three distinguishable ink moves

**What**: A three-state affordance system that never overloads one signal with two meanings.
**Before**: `HUDStatusView.swift:524` overloads the 1.5px left rule on both `isExpanded` and `isActive`, so "selected idle" and "live working" render identically. No keyboard focus indicator exists.
**After**: `hover` → `canvasLift` 30% fill (kept). `focus` → 1px inset accent rule on the **right** edge via `:focus-visible` / `@FocusState`. `selection/expanded` → 1.5px accent **left** rule (kept). `working` → existing dot halo, no rule. Left = pinned, right = keyboard, halo = live.
**Why it elevates without polluting**: one accent color, three positions. Keyboard becomes visible without a focus color.
