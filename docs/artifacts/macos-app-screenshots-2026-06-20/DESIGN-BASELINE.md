# Scout macOS — design baseline brief (2026-06-20)

Studio review of the six current-state screenshots in this folder. The goal is a step-by-step augmentation that lifts Scout's beauty/quality without broad churn.

Treat this as the shared baseline the next implementation pass works from.

---

## 1. Reading Scout as one product shell

The five user-facing surfaces (Comms, Agents, Repos, Tail, Settings) plus the inspector form a single shell with four layers:

1. **Sidebar rail** — 32px column of mode icons, plus footer gear.
2. **Surface header** — page title + count chip + actions.
3. **Primary content** — list, tree, table, or form.
4. **Right inspector / context panel** — entity card, filter facet, action surface, or omitted.

The dominant impression looking at all five at once: **the layers don't read as layers.** Backgrounds are too uniform, accents are too rare, and the inspector is doing four different jobs without a shared skeleton. The bones are good; the layering is what's flat.

Selection and density are inconsistent between surfaces, so the eye has to relearn the shell on each route.

---

## 2. Ranked opportunities (highest impact first)

1. **Surface elevation tokens.** Give rail / content / inspector distinct fills. Today they share a near-black fill so the eye can't separate them. Even ~3–5% luminance steps would resolve most of the flatness.
2. **One page-header pattern.** H1 + count chip + secondary controls + primary CTA. Every surface invents its own header now (compare Comms' tiny "Chats" left + "Action" center vs. Agents' "Agents" + "98 AGENTS" right-pill — same intent, different shapes).
3. **Right-inspector contract.** Three legitimate variants — *entity inspector* (Comms, Agents), *facet/filter* (Tail Distribution), *action surface* (Repos composer). Pick one skeleton, register the variants, stop inventing each one.
4. **Selection state token.** Unify on tinted background + 3px left rail. Comms and Repos almost match; Agents diverges; tree group nodes don't have a state at all.
5. **Density tiers.** Document "compact" (Tail rows ≈ 22px), "default" (Comms / Agents / Repos), "spacious" (Settings). Right now Settings reads as underdesigned next to Tail purely from contrast.
6. **Type ramp discipline.** Three chrome sizes: H1 / eyebrow / body. Reserve mono for stream content (Tail, command rows) — not for value display in Settings/About.
7. **Semantic data tokens.** Status (live / idle / attention), diff (+/−), churn level, sparkline accent. Today the strongest data moment (Repos churn deltas + drift sparkline) is rendered nearly as quietly as metadata.
8. **Rail polish.** Active rail icon has two treatments in these six shots (faint blue rectangle on top icons, hard purple rounded square on the bottom Settings icon). Pick one. Consider widening to ~40–44px so the icons have air.
9. **Comms thread header link.** "Action" in the center reads as a separate page from the inspector that describes it. They should feel like one entity surface with the list, not two unrelated panels.
10. **Settings parity.** Add a section card / preview area so Appearance and About don't read as a hosed-out form on a giant void.

---

## 3. Studio-oriented step plan

### First pass — foundations (low risk, broad gain)
- Three-layer elevation tokens in HudsonShell (`surface.rail`, `surface.content`, `surface.inspector`) wired through all four themes.
- Standard `PageHeader` component (H1 + count chip + actions slot).
- Unified `SelectionRow` token (tinted bg + 3px accent rail).
- Trim the type ramp to title / eyebrow / body and audit usages.

### Second pass — patterns
- `InspectorPanel` skeleton with registered variants: `entity`, `facet`, `action`.
- Density tier modifier on row components; document the row heights.
- Semantic data color tokens (`status.live`, `status.idle`, `status.attention`, `diff.add`, `diff.remove`, `churn.high/med/low`).
- Rail component unified (single active treatment, optional width bump).

### Third pass — per-surface refinement
- Comms: link list/thread/inspector via shared header, promote unread badge contrast, calm down avatar tile sizing.
- Agents: weight-differentiate tree group nodes, hover band, count-chip on group rows.
- Repos: numeric column alignment + semantic tints on diff/drift, reuse Agents inspector skeleton.
- Tail: extract the Distribution facet pattern, sticky column header, row-tap-to-filter feedback. Keep `follow +25` chip exactly as is — it's the best inline live-state pattern in the app.
- Settings: theme card with live preview, Accent chip styling, About data block as a labeled grid (drop mono from non-IDs).

---

## 4. Per-surface notes tied to the screenshots

### `01-comms.jpeg` — Comms / Chats
- **Dual title problem.** "Chats" on the left and "Action" mid-pane fight for the role of page title. The center is the actual subject; promote it. Reduce the left to a tabbed nav label.
- **Inspector is the strongest moment in the app.** Header tile, activity sparkline, metric grid (Turns / Tools / Edits, Reads / Files / Window), Context bar, Sessions list, Runtime KV. This is the design language Repos and Settings should be pulled toward.
- **Stale `Starting` pending row** — already covered as a live-state artifact; ignore for the design pass.
- Unread `2` badge is the same indigo as the selection accent — give unread its own token (warm/amber tint) so it doesn't read as a second selection.

### `02-agents.jpeg` — Agents
- Tree group headers (`Action`, `Arach`, `Atelier`, `Devbar`…) read at the same weight as their child rows. Use mild caps / weight bump on group nodes so the tree is scannable.
- `1 agent` / `6 agents` right-aligned label is doing the job of a count chip — turn it into the chip pattern used elsewhere (`98 AGENTS`).
- `All / Live` segmented control is structurally identical to Settings' `System / Light / Dark`. Codify as one shared component.
- Inspector and Comms inspector are 1:1 here — confirm they share a component, not a duplicate.

### `03-repos.jpeg` — Repos
- The numeric grid (churn `+2,639 / −287`, drift sparkline, agent count, touched) is the most data-dense moment in the app and it's underplayed. Add semantic tints (`diff.add` green, `diff.remove` red kept subtle, drift sparkline accent).
- Repo status dot (`action` shows attention, `narrative-studio` live, `lattices` idle) is a clean affordance — promote the same pattern wherever live/idle/attention applies (Agents rows, Tail sources).
- Inspector breaks the pattern: it's an **action surface** (ask composer) where Comms/Agents are **entity inspectors**. That's fine, but make the variant explicit. The composer should sit *below* an entity card for `action` (path, branch, why, worktrees, changes, attached) so the panel reads as inspector + composer, not composer with a few stats above it.
- The `ATTENTION` pill in the inspector and in the row header are inconsistent in case/weight — pick one.

### `04-tail.jpeg` — Tail
- Best example of compact density in the app — preserve it. `32 logs · 61 procs` count strip in the header is the model for surface counts.
- `Distribution` panel with `Sources / Origins / Kinds / Projects` tabs is a great facet pattern. Extract it as a Studio component; Lattices/other surfaces will want it.
- `follow +25 · 22:50:15 codex` footer chip is the best inline live-state pattern in these screenshots. Keep its semantics intact — design changes must respect *following vs. paused*.
- Sticky column header would close the only real readability gap.
- `[thinking]`, command-row dim treatment, and the duplicate "Captured the Agents view via Computer Use" row are content-level; flag for the source side, not visual design.

### `05-settings-appearance.jpeg` — Settings / Appearance
- Empty right rail is the loudest signal that Settings is the underdesigned surface. Add a live theme/accent preview card on the right so the inspector slot stays consistent across the shell.
- Theme tiles are good in principle but the `LIGHT` / `SOFT DARK` eyebrow caps undersell what the user is picking. Give each tile a small swatch row (surface / content / inspector / accent) so the elevation tokens we're about to introduce are visible right here.
- Mode segmented control is the same component as Agents `All / Live` — codify.
- `Window Material` slider + `Preview accent on hover` are fine; spacing/section rhythm matches the rest.

### `06-settings-about.jpeg` — Settings / About
- Mono for `0.2.72` and `com.openscout.scout` is correct (those are identifiers). Mono for `Paper` and `Indigo` is wrong — those are styled labels. Render them as a tinted chip and the color swatch respectively.
- Page reads ~80% empty. Either accept Settings sub-pages as low density and lean into generous spacing intentionally, or stack additional Scout metadata blocks (build, runtime, transport, broker version) so it parallels the inspector elsewhere.

---

## 5. Implementation cautions before touching SwiftUI / HudsonShell

- **Theme tokens are 4-way.** Paper / Mist / Graphite / Nocturne all need to work; do not hard-code `NSColor` or pin to `.dark` variants. New elevation tokens must be expressed in HudsonShell's token system and resolved per theme.
- **Window Material opacity is user-controlled** (0–100% slider). Any new fills must be alpha-tolerant — test inspector + content readability at ~60–80% opacity. This rules out very dark, low-alpha layered fills that look fine at 100% but collapse to muddy translucency.
- **Shared inspector component is likely.** Comms and Agents inspectors are visually 1:1. Before adding variants confirm there is a single component to extend, not two parallel ones to keep in sync.
- **Selection row affordance is probably global.** Changing the selection token affects all surfaces simultaneously — desirable, but explicitly verify so the change isn't surprising.
- **`SCOUT` wordmark + pill at the bottom-left of every surface is process state**, not chrome decoration. Don't treat it as cosmetic; wire any redesign through the presence/process indicator it represents.
- **Inspector show/hide pin** (top-right control on every surface that has an inspector) is a real affordance; preserve it. New variants must support hidden state.
- **`follow +N` chip in Tail is a live-state subscription marker.** Visual changes must respect its three states (following / paused / disconnected).
- **Row strings carry ask IDs** (e.g. `[ask:f-mqn6y2cm-c5i764]`). Truncation logic should preserve the leading id and elide the tail — not the other way around.
- **Studio is the design venue, not the implementation venue.** Prototype the elevation/selection/header system in Studio (`examples/studio-app`) first, then port tokens into HudsonShell; do not iterate visuals directly in the Scout target.

---

## Next owner

- **Implementation pass (first-pass tokens + PageHeader + SelectionRow):** wait for operator green-light. Likely owner: a HudsonShell-aware agent on the openscout side, with Studio prototyping the surface elevation system first.
- **No file changes have been made.** This brief is the only durable artifact from this turn.
