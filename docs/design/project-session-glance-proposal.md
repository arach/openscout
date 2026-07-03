# Project Session Glance — UX/IA Proposal

Design-only proposal for the selected-session component on the Projects surface
(`/projects/:projectId` with a `sessionId` selected). No code changes yet.

Scope of the component: `ProjectSessionOverview` + `ProjectSessionGlance` + `TokenTelemetry`
in `packages/web/client/screens/projects/ProjectsInbox.tsx:612-1038`, styled in
`packages/web/client/screens/projects/projects-inbox.css:1096-1400`, rendered by
`SelectedSessionMain` (`ProjectsInbox.tsx:668`) above `SessionRefScreen` (transcript).

---

## 0. Current-state read (what the screenshot shows)

The stack today, top to bottom:

1. **Stable project header** (`ProjectScopeHeader`, `ProjectsInbox.tsx:130-246`) — goes
   `data-compact` when a session is selected and injects a `pi-projectSessionContext`
   line ("Session · title · ref · agent · when", lines 176–184).
2. **Session hero** (`pi-sessionHero`, `ProjectsInbox.tsx:636-655`) — kicker
   `/project · live · 26s`, headline, attribution chips (agent · harness · branch).
3. **Session glance** (`ProjectsInbox.tsx:972-1037`) — kicker + summary line, pills
   (branch/model/topology), four bordered cards (Timeline / Activity / Workspace /
   Related), then the token strip.
4. **Transcript** (`SessionRefScreen`).

Concrete problems:

- **Identity said three times.** Session title appears in the compact header line, the
  hero headline, and (via agent-name fallback) the attribution chips. Project name
  appears in the stable header *and* the hero kicker. In the screenshot the agent name
  equals the session title ("Codex session"), so it reads four times.
- **Data said twice.** Started/duration/last live in both the glance summary line and
  the Timeline card. Context % lives in both the Workspace card and the token strip
  (77% twice). Workspace Root repeats the header's project root.
- **Related is low signal.** `nearbySessions` (`ProjectsInbox.tsx:891-903`) takes the
  first 3 other sessions in list order — no branch/agent/time relationship, no reason
  shown. Even reasoned "related sessions" are less useful than files changed, tools used,
  context/budget state, topology, and agent-to-agent coordination threads.
- **The sparkline is fake.** `contextSamples` (`ProjectsInbox.tsx:741-755`) reads
  `data.contextUsage`, which is a synthetic ramp (see memory
  `reference_observe_contextusage_synthetic`; real numbers live only in
  `metadata.usage`). The fallback even fabricates a two-point line
  `[0.35*exact, exact]`. This must not ship as a trend chart.
- **The proportional token bar crushes small buckets.** input 92.7m and cache-rd 87.1m
  eat the row; cache-wr/output collapse to "31.." / "11..". Inside-segment labels
  truncate exactly when they matter.
- **Box stacking.** Hero band + glance band + 4 bordered cards + bordered token strip =
  seven framed surfaces before the transcript. Also `pi-sessionHero[data-state=working]`
  uses `inset 2px 0 0 var(--pi-accent)` — the banned left-edge accent bar treatment.
- **Ambiguous numbers.** Duration rendered as `14:18:03` (clock format) next to start
  `22:14:18` — two colon-triples with different meanings on one line.

---

## 1. What the component must communicate at a glance

One fact per surface, in this priority order:

| Fact | Where it lives | Notes |
|---|---|---|
| Project identity | Stable header only | Never repeated below |
| Session identity | Masthead headline | Title + short ref on hover/copy |
| State + recency | Masthead, inline | live/idle/ended + "last 7s ago"; live dot only when genuinely live |
| Agent + harness + model + branch | Masthead meta line | One mono line, not chips-plus-cards |
| Started/duration | Masthead meta line | "started 22:14 · 14h 18m" — duration in `14h 18m` form, never clock format |
| Activity (turns/tools/edits) | Vitals strip | Numbers only, no card frames |
| Context pressure | Vitals strip | One % + thin bar, said once |
| Tokens | Vitals strip (collapsed) | "93m tok" headline; split on demand |
| Workspace/worktree | Vitals strip, **only when it differs from project root** | The interesting case is a worktree; the default case is noise |
| Files touched | Vitals strip count; concrete file list in signal panel | Prefer changed/read/new with paths and reason |
| Tools/context/topology | Signal panel | Tool counts, context pressure, subscription/budget, worktree/repo state, parent/child lineage |
| Coordination threads | Signal panel | Recent agent-to-agent threads with participants, channel, state, and why it matters |

## 2. Visual structure — two bands, not seven boxes

Collapse hero + glance-top + four cards into **two bands** directly under the stable
header:

**Band A — Session masthead** (replaces `pi-sessionHero` + glance kicker/summary/pills)

```
Sessions ▸  Codex session                                   ● live · last 7s
@codex-agent · codex · gpt-5.x · codex/project-session-token-telemetry
started 22:14 · 14h 18m · turn 30
```

- The `Sessions ▸` prefix is the "you are inside the project, looking at one session"
  cue — it ties the masthead to the already-selected Sessions facet instead of
  repeating `/Openscout`.
- Live indicator: a single state dot next to "live" (genuine live state, allowed);
  remove the inset left accent bar.
- No borders; a slight surface lift (solid, same-hue, per no-white-alpha rule)
  distinguishes the session band from the project header above.

**Band B — Vitals strip** (replaces the four cards + token strip)

One row of `GlanceField`-style stats, no per-card frames:

```
TURNS 30   TOOLS 1.2k   EDITS 0   FILES —   CTX ▓▓▓▓▓▓▓░ 77%   TOKENS 93m ▸
```

- `CTX` is a thin single bar (0–100%), amber past ~80%. Said once — remove it from the
  Workspace card.
- `TOKENS 93m ▸` expands (click or hover-intent) into the split view (§4).
- Worktree root appears here as a prefixed field **only when** session cwd ≠ project
  root: `WORKTREE ~/dev/openscout-wt/foo`.
- Signal panel (§5) sits under the strip with files/tools/context/topology and recent
  coordination threads. Do not use the glance area for transcript replay.

Full transcript and trace stay below as tab content in the existing `SessionRefScreen`
region. The glance should summarize operational state, not replay recent transcript lines.

## 3. Header vs session section vs content below

- **Stable header keeps:** project avatar/title, root, digest, facet tabs
  (Overview/Sessions/Agents/Worktrees/Rules). Sessions facet stays highlighted while a
  session is selected.
- **Header sheds:** most of `pi-projectSessionContext` (title + ref + agent + when —
  all restated 40px lower). Keep at most a short breadcrumb tail after the facet row,
  or drop the line entirely and let Band A's `Sessions ▸` prefix carry it.
  *Recommended: drop it; one place for session identity.*
- **Session section (Bands A+B):** identity, state, vitals, and operational signals.
  Never grows a second nav row, action toolbar duplicating facets, or its own avatar
  block — that is what would make it read as a standalone session page.
- **Below:** transcript / files / trace via `SessionRefScreen`. If per-session actions
  (Steer/Resume/Observe — cf. `ProjectSessionDetail.tsx:403-418`) are wanted here
  later, they belong at the right edge of Band A, not as a new band.

## 4. Token/context telemetry

- **Kill the sparkline** until real per-turn context history exists. Plotting
  `data.contextUsage` (synthetic) or a fabricated 2-point ramp is worse than nothing.
  Replace with the single static CTX bar in the vitals strip.
- **Collapsed by default:** `TOKENS 93m · CTX 77%` in the vitals strip is the whole
  at-a-glance story.
- **Expanded split** (one extra row, on demand): keep the stacked proportional bar but
  fix legibility —
  - labels/values move **below** the bar as a legend row (`input 92.7m · cache rd
    87.1m · cache wr 31m · output 11m`), never inside segments;
  - segments keep proportional width with the existing 3.5% floor, color-coded to the
    legend;
  - hide the `reasoning` bucket unless it's ≥ ~2% of total;
  - tooltip per segment stays.
- **Hide entirely** when `metadata.usage` is absent (conversation-kind lookups, dead
  history) instead of rendering an empty frame.
- Cache-read dominating input is normal and fine to show proportionally — the fix is
  moving labels out, not rescaling.

## 5. Operational signals, not transcript replay

Replace the current Related card plus mini transcript replay with a compact signal panel:

1. **Files changed/read/new** — path, kind, and short reason. This answers "what did it
   touch?" faster than transcript snippets.
2. **Tools + context + topology** — high-signal tool counts, context pressure,
   subscription/budget window if available, repo/worktree state, and parent/child session
   lineage.
3. **Recent coordination threads** — agent-to-agent threads with title, channel,
   participants, state, recency, and a reason such as `same branch`, `design handoff`, or
   `verification evidence`.

Rules: keep the panel compact; empty groups disappear; recency alone never qualifies.
Thread rows click into the channel/thread in-place where possible, and session rows still
use `sessionSelectRoute` when the target is another session. "Related" should not be a
generic bucket.

## 6. Routes and interaction (mostly keep as-is)

The existing model in `projects-inbox-model.ts:487-545` is right; codify it:

- **Project row click** → project route, Overview mode.
- **Session row single-click** → `sessionSelectRoute` (`:515`) — stays in
  `agents-v2`/project family, sets `indexView:"sessions"` + `sessionId`, swaps content
  in-page under the stable header. This is the selected-session view being designed.
- **Session row double-click / Enter** → `sessionOpenRoute` (`:541`) — the deeper
  destination (agent profile / native session). Unchanged.
- **Overview / Sessions facet click while a session is selected** → clears `sessionId`,
  returns to that tab's list. Works today via `baseRoute`; keep.
- **Coordination thread row** → thread/channel view in-place where available; if the row
  points to a session, use `sessionSelectRoute`.
- Add an explicit `← Sessions` affordance only if the facet-click path proves
  undiscoverable; prefer no extra chrome.

## 7. Reuse, refactor targets, staged plan

**Files/anchors**

- `packages/web/client/screens/projects/ProjectsInbox.tsx`
  - `ProjectScopeHeader` compact session line: 176–184
  - `ProjectSessionOverview` (hero): 612–666
  - `SelectedSessionMain`: 668–709
  - `TokenTelemetry` + helpers: 711–838
  - `nearbySessions`: 891–903 (replace with signal scoring or delete)
  - `ProjectSessionGlance`: 914–1038
- `packages/web/client/screens/projects/projects-inbox.css`: 1096–1400
  (`pi-sessionHero`, `pi-sessionGlance*`)
- Reuse: `GlanceField` (`ProjectsInbox.tsx:905`), `HarnessMark`, `AgentAvatar`,
  `shortHomePath`, `compactNumber/tokenLabel`.
- Adjacent-but-different: `ProjectSessionDetail.tsx` is the **side sheet** (av2-sheet),
  not this component; don't merge, but keep field naming/format conventions aligned
  (duration format, ctx bar) so the two read as one system.
- Studio references: `design/studio/app/studies/session-profile`,
  `session-summary-card`, `agents-projects-first` — mine for treatment, but judge
  against the real app (studio flatters mockups).

**Stages (each independently shippable, verify after each)**

1. **De-dupe + honesty** (lowest risk): remove hero kicker's project repetition; merge
   glance summary into the masthead meta line; context % said once; duration to
   `14h 18m` form; remove the synthetic sparkline + the inset left accent bar; hide
   telemetry when usage is absent.
   *Check:* typecheck + `build:client`; view a live session, an ended session (no
   observe payload), and a conversation-kind lookup; confirm nothing renders blank
   frames.
2. **Structure collapse:** four cards → Band A + Band B vitals strip; shrink/drop the
   header `pi-projectSessionContext` line; worktree field only-on-divergence.
   *Check:* narrow-width wrap (vitals strip must wrap, not overflow); compact header
   still stable across select/deselect.
3. **Telemetry split:** collapsed `TOKENS 93m ▸` + expandable legend-below bar;
   reasoning-bucket threshold.
   *Check:* buckets with extreme ratios (cache-heavy codex session) stay legible.
4. **Signal panel:** replace Related/transcript replay with files/tools/context/topology
   plus recent agent-to-agent threads. Delete the empty-state placeholder.
   *Check:* project with 1 session, session with no usage metadata, active multi-agent
   handoff, and a worktree-diverged session.
5. **Extraction (optional hygiene):** move `ProjectSessionGlance`/`TokenTelemetry` into
   `ProjectSessionGlance.tsx`; `ProjectsInbox.tsx` is 1,515 lines and this is its
   biggest self-contained chunk.

## Unresolved decisions

1. **Header session line:** drop entirely (recommended) vs keep a minimal
   `Sessions ▸ title` tail in the header. Affects whether Band A needs the prefix.
2. **Degenerate titles:** when agent name == session headline ("Codex session"), the
   masthead reads doubled; needs a better fallback (first user ask? branch leaf?).
3. **Token expand interaction:** click-to-pin vs hover-intent.
4. **Thread placement:** keep recent coordination threads in the signal panel, or move
   them into the Sessions/Agents tab once the channel navigation is stronger.
5. **Session actions** (Steer/Resume/Observe) on this surface at all, or reserved for
   the side sheet/agent profile.
6. **Real context-trend data:** if a true per-turn context series lands in observe
   metadata later, the sparkline can return — as a real chart in the expanded telemetry
   row only.
