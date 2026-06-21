# Handoff: macOS Tail styling pass

## Goal

Polish the **macOS Scout app Tail tab** so it feels technical and scannable (htop-ish lean) while **keeping table affordances** — not a flat firehose, not Finder-card chrome.

## Primary files

- `apps/macos/Sources/Scout/ScoutTailView.swift` — main table + inspector
- `apps/macos/Sources/ScoutAppCore/ScoutTailStore.swift` — filter state
- `apps/macos/Sources/Scout/ScoutRootView.swift` — inspector shell title for tail section
- `apps/macos/Sources/ScoutAppCore/ScoutTailModels.swift` — event/kind labels

## Design reference (canonical)

- `design/studio/app/studies/scout-tail/page.tsx`
- `design/studio/app/studies/scout-tail/page.module.css`

Match the study's intent:
- **Main column**: ScoutSurface header, filter toolbar, **table stream** with kind tone in the KIND column only
- **Inspector**: faceted **Distribution** (one facet at a time, share bars, click row → filter stream)
- Single accent for active filter chips; per-kind color only in stream rows

## User constraints (do not violate)

1. **Keep the table** — pinned header row, fixed columns, row selection, inline detail expand, context menu actions
2. **Sidebar must earn its space** — distribution/filter only; no duplicate vitals/coverage cards, no Tracks glossary
3. **Don't over-flatten** — Scout-native controls (search field, segmented kind filter, toolbar buttons) are OK
4. **macOS only** for this pass — do not change web/iOS unless needed for shared models

## Current state (partial work landed)

- Inspector renamed "Distribution"; facet tabs + share bars wired to `ScoutTailStore` filters
- Main view uses `ScoutColumnHeader`, kind badges, active filter banner
- Prior pass may still feel rough — your job is the **polish pass**

## Suggested improvements

- Typography/spacing alignment with other Scout tabs (Agents, Repos)
- Inspector facet tabs + bar chart visual balance at ~300px inspector width
- Kind filter toolbar: avoid overflow/clipping; ensure horizontal scroll or wrap works
- Row hover/selection states: subtle, not accent-heavy
- Empty/loading/error states: concise mono, not marketing copy
- Verify filter wiring: source/origin/kind/project + search + kind chips + inspector rows all stay in sync

## Verification

```bash
cd apps/macos && swift build
```

Report: files changed, what you improved visually, any tradeoffs, build result.