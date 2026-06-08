# Home › Projects — design review (round 2)

Second design-eye pass on the projects-first Home list. Target device: **iPhone 13 mini (375pt wide)**.
Files: `HomeSurface.swift`, `Glyphs.swift`. Reference screenshot: `~/Downloads/Screenshot 2026-06-06 at 9.22.03 PM.png`.

Token reality on mini (so the numbers below are real, not guessed):
- `surfacePadding` = `HudSpacing.xl` = **12** per side → card width ≈ **351**, inner content ≈ **335**.
- `HudSpacing`: xxs 2 · xs 4 · sm 6 · md 8 · lg 10 · xl 12 · xxl 14 · xxxl 20.
- `HudTextSize`: micro 9 · xxs 10 · xs 11 · sm 12 · md 14 · lg 16.

The interaction model is right: folder rows, multi-agent projects expand, single-agent projects compress inline like a one-child IDE path, one line per agent, head/shoulders glyph for a single agent. The notes below are refinement, not redirection.

---

## 1. The one structural bug — child rows restate the parent (fix first)

In the screenshot, expanded `openscout` is nine rows that mostly read **"Openscout / Openscout / Openscout…"**. That's not a styling problem — it's that the restatement guard exists for the *compressed solo* case but **not** for the *expanded child* case.

- `ProjectRow.compressedAgentTitle` (HomeSurface.swift:685) already drops a title that restates the project and falls back to runtime / "agent".
- `AgentFleetRow.identityLine` (HomeSurface.swift:771) renders **raw `agent.title`** with no such guard.

**Fix:** give `AgentFleetRow` the project name and reuse the same logic, but prefer a *discriminator* over the generic "agent" fallback. Priority when the title == project name:
1. trailing id already in the title (e.g. `…1c26ij`, `C0j003`) — keep it, it's the only thing that distinguishes these rows,
2. else `harness`/`model` (`claude`, `gpt-5-codex`),
3. else short `sessionId`,
4. else `branch`,
5. else "agent" (last resort).

A scannable column reads `1c26ij · claude · 7h`, not `Openscout · Openscout · Openscout`. This single change is 80% of the visual win and matches the screenshot's actual failure.

---

## 2. Inline runtime — plain mono token, not a capsule

`InlineRuntimePill` (HomeSurface.swift:558) is a bordered capsule. One per agent means **nine boxes** in the openscout expansion — chrome stacked on chrome, and it eats ~30–50pt of the scarce 264pt child text column.

- In **list rows** (`AgentFleetRow`, expanded children): render harness/model as **plain `HudFont.mono(.micro)` in `HudPalette.dim`** with a thin ` · ` separator before the age. No fill, no stroke. Mono stays an accent (the repo rule is ≤~20% mono / no card-chrome-on-rows), and you reclaim width for the title.
- Keep the **capsule only** for the *compressed solo* row, where it's a single deliberate accent disambiguating one inline child — there it earns its border.

So: child row = `title  ·  claude        7h` (all text, one weight family). Solo row = `folder  name / [claude]  7h` (pill is the one ornament).

---

## 3. Typography

Current sizes are close. Tighten the parent↔child contrast so children never visually outrank the folder:

| Element | Now | Suggest |
|---|---|---|
| Project name | `ui md(14) semibold` | keep — this is the anchor |
| Agent title (child) | `ui sm(12) medium` | keep weight, but ensure it's clearly *lighter in color* than the project name (`HudPalette.ink` for project, a step down — `HudPalette.muted`-plus — for agents) so hierarchy reads by tone, not just size |
| Inline runtime | pill `mono micro(9) semibold` | `mono micro(9) regular`, `HudPalette.dim`, no pill |
| Age | `mono micro(9)` muted, `monospacedDigit()` | keep — the `monospacedDigit` is correct, hold it |
| `agentCount` ("9 agents") | `mono xs(11)` | keep |

One rule to adopt: **right-edge column is always mono + `monospacedDigit`, always `HudPalette.muted`, never truncates.** Title is the only thing that yields.

---

## 4. Spacing & indentation

The child indent is built from **three stacked paddings**, which is both more than one tree level needs and a width tax:

```
ForEach child:  .padding(.leading, HudSpacing.lg = 10)     // HomeSurface.swift:226
AgentFleetRow:  .padding(.horizontal, HudSpacing.xl = 12)  // :739   (12 each side)
leafRail:       29pt fixed (14 connector + 2 + ~13 glyph)  // :765
```

Agent title starts ~**59pt** from the card edge; project title starts ~**36pt**. The 23pt step is fine *as a step*, but the components are redundant and the 29pt rail is heavy on a 335pt card. Collapse to **one** indent system:

- Drop the child's extra `.padding(.leading, HudSpacing.lg)` (:226). Let the leaf rail *be* the indent.
- Narrow `leafRail` from 29 → ~**22** (connector 12 + 2 + glyph 13, trim the slack). Align the agent glyph's optical center to sit one clean tab right of the folder glyph column so the eye reads a vertical spine: folder-glyph-column → agent-glyph-column.
- Vertical rhythm is already correctly subordinate (project `.vertical md=8` :622, child `.vertical sm=6` :740). On mini, consider child → `xs(4)` to fit one more agent per screen without flattening the hierarchy. Keep the project row roomier than its children — that ratio is doing real work.

Net: ~15–20pt of width back to the title column, and a tidier spine.

---

## 5. The tree connector is invisible — decide in or out

`AgentTreeConnector` strokes at `HudHairline.standard`, 1pt (HomeSurface.swift:756). On the warm-dark canvas at mini scale it's gone — you can't see a spine in the screenshot. A connector you can't see is just width tax. Two honest options:

- **Keep it, make it read:** bump to a slightly warmer hairline (a brand-warm hex a hair above `bg-surface`, per the repo's "barely-visible underline" rule), confirm it runs continuously top→bottom between rows (each row drawing its own segment is fine *if* they abut — verify no gap at the `rowSeparator(inset:)` between children). The elbow on the last child (`isLast`) is the right detail.
- **Drop it:** rely on the agent glyph + indent + `HudSurface.inset` background to signal nesting. Cleaner, less to tune, and the inset background already groups the children. For a 9-child list this may actually read *better* than a faint spine.

Given the IDE/GitHub reference the owner cited, a *visible* spine is on-brief — but only if it's actually visible. If you can't make it legible without it looking like a border error, cut it.

---

## 6. Single-line truncation on mini

Child text column ≈ **264pt** (after rail + paddings). Rules to lock:

- **Title:** `lineLimit(1)`, `layoutPriority(1)` — already set (:775–776). For titles carrying a trailing discriminator id, use **`.truncationMode(.middle)`** so `Openscout Card K …1c26ij` keeps *both* the human prefix and the id. The compressed solo path already uses `.middle` (:667); make the expanded child match. Pick one rule: **project names → `.tail`, agent titles → `.middle`.**
- **Runtime + age:** never truncate. Give them `layoutPriority` above the title's yield and fixed/min intrinsic width. Age in a fixed right-aligned min-width slot (~20pt) so `7h`/`1d`/`2d` form a clean vertical right rail instead of dancing left/right with title length.
- **No two-line fallback:** the brief is one line per agent — enforce with `lineLimit(1)` everywhere on these rows (already true; just don't let a future pill push a wrap).

---

## 7. Affordance: expand-chevron vs drill-in-chevron read identically

`ProjectRow` shows the same right-edge chevron for two different actions (HomeSurface.swift:615):
- multi-agent project → chevron **expands** in place,
- compressed solo (tappable) → chevron **navigates** into the conversation.

Same glyph, two meanings. Differentiate so the gesture is predictable:
- expandable → the rotating chevron (`›` → `⌄`) you have,
- solo drill-in → either **no chevron** (tap the whole row; the inline `/agent` already signals it's a leaf) or the **`.arrow(.trailing)`** glyph at low opacity to read as "go" rather than "open".

Small thing, but it's the difference between the list feeling learnable vs. fiddly.

---

## Ordered quick-wins

1. **Kill child-row restatement** (§1) — biggest single win, matches the screenshot's actual failure.
2. **Runtime as plain mono token, not capsule, in list rows** (§2) — removes nine boxes, buys width.
3. **Lock the right-edge column** (mono · muted · monospacedDigit · fixed slot · never truncates) (§3, §6).
4. **Collapse the triple indent to one rail; trim rail to ~22** (§4) — width + a clean spine column.
5. **Connector: make it visible or remove it** (§5) — no faint-and-pointless middle ground.
6. **`.middle` truncation for agent titles; `.tail` for project names** (§6).
7. **Distinguish expand-chevron from drill-in-chevron** (§7).

Everything here is refinement of a correct model — the hierarchy itself is sound.
