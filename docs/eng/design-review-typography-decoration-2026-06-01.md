# MiniMax Design Review — Typography & Decoration Consistency

**Surface:** OpenScout native macOS app (dark, developer tool)
**Screenshot:** `.codex/screenshots/scout-design-review-window-clean-20260601-213756.png`
**Date:** 2026-06-01
**Scope:** Type hierarchy + decorative vocabulary. *Not* a layout redesign. The vertical header rhythm work is good — leave structure alone; this pass is about making the glyphs and chrome read as one system.

---

## TL;DR

The bones are right: dense, dark, high-trust, four-column rhythm is working. What's noisy is the **vocabulary**, not the layout. Three problems repeat everywhere:

1. **Too many chip/badge shapes for too few meanings** — green-fill, blue-fill, gray-outline, and pill variants all coexist, and the *same* concept (`PRIVATE`) renders in two different colors.
2. **Mono is used decoratively, not semantically** — it leaks onto labels and helper text where it should mark identifiers/values only.
3. **Uppercase has no single rule** — section labels, badges, the wordmark, and tab labels each pick their own casing + tracking.

Fix those three and ~80% of the "all over the place" feeling resolves without touching a single layout constraint.

---

## 1. Typography hierarchy

### What's inconsistent today
- **Three unrelated "title" sizes** with no shared step: `Conversations` (column header), `Openscout` (main conversation header, largest), `Openscout` (inspector card title, medium). They read as three fonts rather than three levels of one.
- **Row titles vs. sender labels collide in weight.** Conversation-list names (`Talkie`, `Hudson`, `Iris`) are bold sans; the in-thread sender (`OPENSCOUT`) is bold *uppercase green mono-ish*. Same role (who is this), two completely different type treatments.
- **Mono bleeds past its job.** Mono currently appears on: `cId legacy-dm`, `CID 685A1D08` chip, inspector values (`claude_stream_json`, `Arts-Mac-mini.local`), the composer helper (`Type / for commands…`), and the status bar. Some of those are identifiers (correct); some are prose/labels (wrong). The eye can't infer "mono = machine value" because the rule isn't held.
- **Metadata rows differ column to column.** List rows: `PRIVATE` + `cId legacy-dm` + right-aligned count. Main header: `PRIVATE` + `CID 685A1D08` + avatars + `Operator + Openscout`. Inspector: `LABEL …… value`. Three metadata grammars.
- **Timestamps** (`5h 34m`, `1d`, `3d`) are fine in format but their weight/color isn't a shared token — they drift slightly brighter in the thread than in the list.

### Recommended type scale (6 steps, one family + one mono)
Use the system stack: **SF Pro Text/Display** for everything sans, **SF Mono** for values only.

| Token | Size / Weight | Use |
|---|---|---|
| `title.lg` | 20 / Semibold | Main conversation header name only (`Openscout`) |
| `title.md` | 15 / Semibold | Column header (`Conversations`), inspector card title |
| `body` | 13 / Regular | Message body copy, ability descriptions |
| `row.title` | 13 / Semibold | Conversation row names, in-thread sender, inspector row labels' *values* |
| `meta` | 11 / Regular | Timestamps, preview text, `Operator + Openscout`, helper text |
| `label` | 10.5 / Semibold, +6% tracking, UPPERCASE | Section labels (`RUNTIME`, `WORKSPACE`), badge text |
| `mono` | 11–12 / SF Mono Regular | **Identifiers & machine values only**: cIds, hashes, transport, node, branch, path |

Rules that make the scale hold:
- **Sender in thread = `row.title` (sans, not uppercase, not mono).** Keep the green as the *accent color* on a normal-case semibold name. This instantly reconciles "who is this" between the list and the thread.
- **Mono is reserved for values you'd copy-paste.** Helper text and section labels move to sans. Composer hint becomes `meta` sans.
- **One timestamp token** (`meta`, `tertiary` color) everywhere.
- **Avoid a 4th title size.** If the inspector card title competes with the column header, they should be the *same* `title.md`.

---

## 2. Decorative language

### The badge/chip zoo (biggest single offender)
Currently visible distinct treatments:
- `PRIVATE` **green** filled-ish (list rows)
- `PRIVATE` **blue** (main header) ← same meaning, different color
- `SHARED` green (channel row)
- `CID 685A1D08` gray **outlined** chip (header)
- `cId legacy-dm` bare mono **no chrome** (list rows)
- `150 cIds` small pill (column header)
- `● AVAILABLE` blue **outlined pill with dot** (inspector, appears **twice** stacked — section header *and* card)

That's ~5 shapes for ~3 real meanings. Collapse to a **3-chip vocabulary**:

| Chip type | Shape | Color | Used for |
|---|---|---|---|
| **Status pill** | filled, low-alpha tint, dot optional | semantic (green=available, amber, red) | liveness/availability — `AVAILABLE` |
| **Scope tag** | flat text, no border, tracked uppercase `label` | single neutral-accent (pick green *or* blue, not both) | `PRIVATE` / `SHARED` |
| **Identifier chip** | thin 1px outline, mono, no fill | tertiary gray | `cId …`, `CID …`, hashes |

Concrete decisions:
- **Pick one color for scope.** `PRIVATE` must be the *same* color in the list and the header. Recommend green stays for scope (you already lean green as the brand accent) and **blue is retired from scope**, reserved only for the availability/status pill so blue means "live state."
- **Don't render `AVAILABLE` twice.** The section-header pill and the card pill are redundant; keep it once (on the card) and let the `AGENT` section label stand alone.
- **Identifiers pick one chrome.** Right now `CID 685A1D08` has a box but `cId legacy-dm` doesn't. Make both the same: bare mono in tertiary gray (cheaper, denser) — drop the outlined box, it's the most over-decorated element on the header.

### Selection states — currently two languages
- Left rail selected item = **blue rounded outline**.
- Selected conversation row = **green left bar + lighter fill**.

Two accent colors for the same concept (where am I). **Unify on the green left-edge + subtle fill** for primary nav/selection across both rail and list; drop the blue outline box. Blue then exclusively means "status/live," which gives the whole UI a clean two-color logic: **green = identity/selection/scope, blue = runtime state.**

### Buttons / chrome
- `Agent`, `Open Web`, `Profile` are neutral outlined — good, keep.
- `Observe` is green-text outlined — it's the only accented button. That's fine *if* Observe is the primary action; make that intentional (one primary accent per region) and keep the rest neutral. Don't let accent spread to `Agent`/`Open Web`.
- **Standardize button radius + icon-gap.** They look close but the icon-to-label spacing varies slightly between `Agent` and `Observe`/`Profile`. One `Button` component, one radius (match chip/identifier radius, ~6px), one 6px icon gap.

### Icon containers
- Ability rows (`Conversation`, `Work requests`, `Result delivery`) use subtle icon boxes — tasteful, keep.
- Avatar circles in the header are fine but the overlap stack + `Operator + Openscout` label is slightly redundant. Low priority; leave.

---

## 3. Region-by-region notes

**Left rail**
- Selected-item blue outline → switch to green selection language (see above).
- `SCOUT` wordmark + green dot at bottom: good, keep — that's the one place a tracked uppercase wordmark belongs.
- Icons are consistent weight; no change.

**Conversations column**
- `Conversations` → `title.md`; `150 cIds` subcount → `meta` tertiary (it currently reads as a mini-pill; flatten it to plain text).
- Segmented control `All / Private / # Shared`: keep title-case, it's fine. Just ensure the selected segment uses the same fill token as the selected row (shared "active" surface token).
- Row metadata: `PRIVATE` scope tag recolored to the single scope color; `cId legacy-dm` stays bare mono; right-aligned number is an unread/seq count — give it the `meta` token and a consistent tabular alignment.
- Status bar (`150 cIds · 100 agents · 700 tail`): keep mono, this is the correct home for it.

**Main conversation header**
- `Openscout` → `title.lg` (only place this size lives).
- `PRIVATE` blue → green scope tag (match list).
- `CID 685A1D08` outlined box → bare mono identifier `cId 685a1d08` (lowercase to match the list's `cId` style; pick one casing for the prefix and one for the hex — recommend lowercase prefix, as-stored hash).
- `Agent` button neutral — keep.

**Main conversation body**
- Sender `OPENSCOUT` uppercase → `row.title` sans semibold in green, normal case (`Openscout`). This is the highest-impact single typography fix.
- Info icon + `5h 34m` → `meta` tertiary, one timestamp token.
- Body copy `body` 13/Regular — already good, keep the measure and leading.

**Right inspector**
- Section labels `AGENT / RUNTIME / WORKSPACE / ABILITIES` → standardize on the single `label` token (uppercase, +6% tracking, 10.5 semibold). They currently look close; lock the token so they're identical.
- `AVAILABLE` pill: keep once (card), remove the duplicate at the `AGENT` section header.
- Key/value rows: labels = `label` tertiary, values = `mono` for machine values (`claude_stream_json`, `Arts-Mac-mini.local`, branch/path/cid) and `row.title` sans for human values (`Relay agent`). Decide per-row whether the value is a machine token or prose and apply mono accordingly — right now `Relay agent` and `claude_stream_json` share a treatment but aren't the same kind of thing.
- `Observe` (green primary) + `Profile` (neutral): good hierarchy, keep.

**Bottom composer**
- `Message Openscout` placeholder + mic icon: fine.
- Helper `Type / for commands · @ for agents · sess…`: move from mono → `meta` sans tertiary. Mono here reads as "code" when it's instructional prose.

---

## 4. Implementation checklist (one focused pass)

Grouped by risk. Land the low-risk token work first — it's most of the visual win.

### Low risk / high impact (token-only, no layout)
- [ ] Define type tokens: `title.lg/md`, `body`, `row.title`, `meta`, `label`, `mono` (table above) and replace ad-hoc font calls.
- [ ] Recolor `PRIVATE`/`SHARED` scope tags to **one** color (green); remove blue from scope.
- [ ] Reserve **blue** exclusively for the status/availability pill.
- [ ] In-thread sender: `OPENSCOUT` mono-uppercase → `Openscout` `row.title` sans, green accent, normal case.
- [ ] Composer helper + inspector section labels: mono → sans (`meta` / `label`).
- [ ] One timestamp token across list + thread.
- [ ] Flatten `150 cIds` from pill → plain `meta` text.

### Medium risk (shared components)
- [ ] Build a 3-variant `Chip` component: `StatusPill`, `ScopeTag`, `IdentifierChip`. Replace all current badges with these.
- [ ] Header `CID` outlined box → `IdentifierChip` (bare mono, no border) to match list `cId`.
- [ ] One `Button` component: single radius (~6px), 6px icon gap, neutral default + one accent variant. Apply to `Agent / Open Web / Observe / Profile`.
- [ ] Remove the duplicate `AVAILABLE` pill in the inspector (keep card instance only).
- [ ] Per-row decision in inspector K/V: mono for machine values, sans for prose values.

### Higher risk (interaction state — verify no regressions)
- [ ] Unify selection language: left rail selected item from blue-outline → green left-edge + subtle fill, matching the conversation row. Confirm focus-ring/a11y states still distinguishable.
- [ ] Share the "active surface" fill token between selected segmented-control tab, selected nav item, and selected row.

---

## 5. Keep / Avoid

**Keep (working — don't touch):**
- The four-column density and the newly aligned header rhythm. Structurally solid.
- Green-on-dark as the brand/identity accent; the `S` logo and `SCOUT` wordmark.
- Subtle card borders + low-alpha fills — the "high-trust utility" texture is right.
- Ability rows with small icon boxes.
- The status bar's mono metric line — correct use of mono.
- Body copy size/leading in the thread.
- Neutral outlined buttons as the default.

**Avoid / simplify:**
- The same concept in two colors (`PRIVATE` green vs blue). #1 thing to kill.
- Two selection languages (blue outline vs green bar). Pick green.
- Mono as decoration on labels/helper/prose. Mono = machine values only.
- Outlined identifier box on the header while the list uses bare mono — pick one (bare).
- Duplicate `AVAILABLE` pill stacked in the inspector.
- Uppercase mono sender label in the thread.
- A creeping 4th title size — cap the scale at two title steps.

**Net:** a two-color logic (green = identity/selection/scope, blue = live state), one type scale, one mono rule, and a 3-chip vocabulary. No layout reinvention — this is a tokens + shared-component pass an engineer can land in one focused sitting, low-risk items first.
