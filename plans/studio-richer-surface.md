---
title: Studio richer surface
status: draft
blurb: Synthesis from three parallel reviewers on the new component studies + a shipping order.
source:
  - design/studio/app/studies/agent-cards/page.tsx
  - design/studio/app/studies/agent-pulse/page.tsx
  - design/studio/app/studies/tree-viewer/page.tsx
  - design/studio/app/studies/file-card/page.tsx
  - design/studio/app/globals.css
order: 20
---

# Studio richer surface

Synthesis of three parallel reviewer audits on the new studies. One reviewer per beat: **agent surface**, **file/code surface**, **cross-cutting foundations + polish**. The shared theme: the studio works as a quick-iteration playground, but each surface deserves a richer composition + the foundations bucket needs more before the surface studies can fully lean on it.

## Cross-cutting themes

These came up from more than one reviewer — load-bearing fixes:

1. **Status grammar is fragmented.** A `StatusPill` is rebuilt inline in `PageStrip.tsx:85-96`, the status-pills study, and `EngDocHeader`. Extract a single atom (`components/StatusPill.tsx`) and burn the duplication.
2. **Eyebrow / `· Label` pattern is hardcoded everywhere.** Sidebar (`StudioSidebar.tsx:206,222`), landing cards (`app/page.tsx:174`), every study page header. A reusable `<EyebrowLabel>` (or its sibling `<SectionRule>`) would let one place own font / tracking / dot.
3. **Sidebar accent dot uses a stale hex** (`StudioSidebar.tsx:72` — `#3F9BB5`) instead of `var(--scout-accent)`. Tiny fix, but it's literally the wrong color in dark mode now.
4. **No focus rings anywhere.** Keyboard navigation is undefined — sidebar links, theme toggle pills, tree nodes, all `:hover` only. Add `outline-2 outline-offset-1 outline-scout-accent` (or define a `.focus-ring` utility in `globals.css`).

## Agent surface — consolidate

The owner's instinct (collapse pulse + cards + more into one "agent-centered" study) was endorsed by the reviewer. New study:

**`/studies/agent`** (label: "Agent Vocabulary") — twelve sections covering the full agent vocabulary in one place:

1. Identity block (lift from `AgentsInspector:155-181`)
2. Presence indicator + dot, all variants (`HomeAgentsInspector:88-96` + `AgentsInspector:161-169`)
3. Agent row — comfortable / compact / manifest (current `agent-pulse`)
4. Agent card (current `agent-cards`)
5. Agent mention chip — `@hudson` inline (currently undesigned)
6. Presence mesh — radial SVG with animated peer connections (lift from `AgentsInspector:433-584`)
7. Observe block — trace stats 2×4 matrix + session metadata + top files (`AgentsInspector:295-386`)
8. Incoming asks alert card (`AgentsInspector:606-631`)
9. Agent breadcrumb — short form for page titles
10. Capability matrix — agents × capability columns

New sub-components worth designing:

- **AgentPresenceDot** — status-colored circle w/ optional ring + halo modifier
- **AgentMentionChip** — inline `@name` button with avatar + tooltip
- **ObserveStatsMatrix** — reusable 2×4 grid of trace metrics
- **AgentPresenceMesh** — extracted SVG radial topology
- **AgentAskAlertCard** — amber "AWAITING" card with origin breadcrumb

Trace into the app: `HomeAgentsInspector.AgentRow` becomes a reusable `AgentRowView` atom taking a `density` prop. `AgentsInspector` gets vocabulary references for asks, observe, mesh.

## File / code surface — compose

Reviewer proposed a new composition study that ties tree + card + viewer together:

**`/studies/file-explorer`** — split-pane workspace:
- Left rail (240px): `TreeView` density="compact" rooted at `design/studio/app`, sync with right pane selection
- Right pane: BreadcrumbPath + `FileCardCompact` stat header + `CodeExcerpt` body + collapsible `SymbolOutline` sidebar
- Clicking outline symbols scrolls the code pane + highlights the range

New sub-components:

- **BreadcrumbPath** — full repo-relative path as hoverable, clickable segments (the file viewer at `app/eng/file/[...path]/page.tsx:39-58` already hand-rolls a weaker version)
- **CodeExcerpt** — N-line snippet with optional line-range annotation; lighter than CodeViewer
- **SymbolOutline** — h2/h3 outline for markdown, function/class list for code
- **DirSummary** — one-glance card: N files · M dirs · last touched · top 3 langs
- **FilePeekCard** — FileCardPreview rendered floating; consumed by EngMarkdown to upgrade inline path code spans into hover cards

TreeView improvements: indent guides, keyboard nav (↑↓←→), search filter (case-insensitive), jump-to-current (`currentPath` prop auto-expands ancestors).

FileCard improvements: real extension glyphs (not colored squares), git-state badges, test/spec indicator, recent-edits sparkline, owner avatar.

## Foundations — fill the gaps

The Atoms shelf is one entry deep (`InspectorSection`). Reviewer ranked five missing foundational studies by impact:

1. **`/foundations/color-tokens`** — every `--studio-*`, `--scout-*`, `--status-*` var rendered side-by-side in dark + light, copy-pasteable. Doubles as a debugging surface.
2. **`/foundations/typography`** — display / sans / mono ramps + every prose element stacked. Reveals whether Instrument Serif on h4 reads right in dark mode at 13.5px.
3. **`/foundations/spacing-density`** — the actual spacing scale (8/12/14/16/20/24) + two representative rows in comfortable / compact / manifest with px callouts.
4. **`/foundations/status-grammar`** — beyond pills: dot · pill · text · ring · highlight bg · accent rule. Documents which form to use when.
5. **`/foundations/interactive-states`** — focus, hover, active, disabled — applied to representative controls. Pairs with the focus-ring polish work.

(The bucket needs renaming or a new section: `Atoms` for components, `Foundations` for tokens / type / spacing — the line is currently fuzzy.)

## Bold scoutification move

Reviewer's strongest opinion: **replace the page-strip pattern** with scout's actual HUD-style header. Drop the editorial-serif breadcrumb on top, collapse to a single mono eyebrow above the h1. Embed an ink-stacked status ladder on the right edge (dot + status text + source links pinned vertically) instead of letting it flow in a horizontal strip. Makes the studio unmistakably scout rather than a recolored talkie.

Bigger structural change — save for after the simpler wins land.

## Recommended shipping order

Smallest blast radius first, biggest reach second:

1. **Polish bundle** (1 PR): extract `<StatusPill>` + `<EyebrowLabel>` atoms, fix the sidebar dot hex, add a `.focus-ring` utility, retire duplication. Ripples through every existing study.
2. **Foundations starter** (3 new routes): color-tokens + typography + spacing-density. Each is self-contained, each unblocks studies that follow.
3. **Agent Vocabulary** (`/studies/agent`): consolidates pulse + cards, lifts 5 new sub-components from real scout sources. Highest direct value to the operator surface.
4. **File Explorer** (`/studies/file-explorer`): the composition study. Stress-tests TreeView + FileCard + BreadcrumbPath + CodeExcerpt + SymbolOutline at once.
5. **HUD-style chrome pivot**: scoutify page strip. Bigger structural change, do once foundations are solid.

The first two are quick wins. The next two are real design work. The fifth is the bold pivot.
