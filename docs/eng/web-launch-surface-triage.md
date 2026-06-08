# Web Launch Surface Triage & Feature-Flag Plan

## Status

Plan only — **no code changes yet**. We are waiting on the Hudson
feature-flag primitive (`docs/proposals/hudson-feature-flags-primitive-proposal.md`)
before wiring. This doc is the hard pass over every web surface: what
ships in the lean launch, what hides behind a flag, and the flag key for
each.

## Goal

Ship a **clean, lean web UI** that mirrors the macOS app's curated core,
and gate everything else behind flags so the default surface is
"agents, chats, tail" + the web additions "dispatch, repos". Everything
"sexy/fun ops" stays reachable but is gated by a different (audience)
factor, not the entry flag.

## The macOS reference

macOS Scout ships **4 sections by hand** — no flags, just a curated set
(`apps/macos/Sources/Scout/ScoutModels.swift`, `ScoutSection`):

> **Comms · Agents · Tail · Repos**

The web target is that set, with **Dispatch** added, plus the
unavoidable shell (a landing + settings).

## Current state (what we're changing)

- Top nav is 5 items (`packages/web/client/scout/topNavConfig.ts:11`):
  **Home · Agents · Chat · Search · Ops**.
- The only flag is `isOpsEnabled()`
  (`packages/web/client/lib/feature-flags.ts:1`) — a URL-string boolean
  (`?no-ops`), no registry, returns `false` on the server.
- **The structure is inverted.** Three of the five intended core
  surfaces live *inside* the Ops shell, gated by that flag
  (`packages/web/client/scout/secondaryNavConfig.ts:69` — Ops sub-nav is
  Control · **Dispatch** · **Repos** · Mesh · **Tail** · Runtime ·
  Plans). So today the core stuff only appears when ops is on.

## Target nav

A 5-item daily-driver top nav, mirroring macOS + Dispatch:

> **Agents · Chat · Tail · Dispatch · Repos**  (+ Home landing, + Settings)

This requires **promoting** Tail, Dispatch, and Repos out of Ops to
top-level, and pushing the rest of Ops behind the power flag.

## Two flag tiers

- **`surface.*`** — tier `everyone`, **default off**. Pure declutter for
  the launch: useful surfaces that simply aren't part of the core daily
  loop yet. Flip on per-deploy or per-user as they mature.
- **`ops.*`** — tier `power`, **audience-gated**. The ops / observability
  / power surfaces. On for internal/power audiences, off for a clean
  public launch. This is the "gate by some other factor" tier — resolved
  by *who you are*, not a URL string.

Core surfaces carry **no flag** — they always render.

## Surface triage (all 21 top-level surfaces)

| Surface | Defining screen | Today | Tier | Flag key |
|---|---|---|---|---|
| Home / Inbox / Fleet | `HomeScreen.tsx` | top-nav | **Core** | — |
| Agents (Directory, Config) | `AgentsScreen.tsx` | top-nav | **Core** | — |
| Chat (Messages, Conversations) | `MessagesScreen.tsx`, `ConversationScreen.tsx` | top-nav | **Core** | — |
| Channels | `ChannelsScreen.tsx` | under Chat | **Core** | — |
| Tail | `OpsScreen.tsx` (mode `tail`) | under Ops | **Core** ← promote | — |
| Dispatch | `BrokerScreen.tsx` | under Ops | **Core** ← promote | — |
| Repos | `ReposScreen.tsx` | under Ops | **Core** ← promote | — |
| Repo Diff | `RepoDiffPageScreen.tsx` | route | **Core** (w/ Repos) | — |
| Settings | `SettingsScreen.tsx`, `AgentConfigurationScreen.tsx` | route | **Core** | — |
| Search (Knowledge, Indexer) | `KnowledgeSearchScreen.tsx` | top-nav | Entry | `surface.search` |
| Sessions (standalone) | `SessionsScreen.tsx` | route | Entry | `surface.sessions` |
| Briefings | `BriefingsScreen.tsx`, `BriefingDetailScreen.tsx` | route | Entry | `surface.briefings` |
| Work | `WorkDetailScreen.tsx` | route | Entry | `surface.work` |
| Activity | `ActivityScreen.tsx` | route | Entry | `surface.activity` |
| Follow | `FollowScreen.tsx` | route | Entry | `surface.follow` |
| Ops / Control (Mission, Issues) | `OpsScreen.tsx` | top-nav | **Power** | `ops.control` |
| Mesh | `MeshScreen.tsx` | under Ops | **Power** | `ops.mesh` |
| Runtime (atop) | `OpsScreen.tsx` (mode `atop`) | under Ops | **Power** | `ops.runtime` |
| Plans | `OpsScreen.tsx` (mode `plan`) | under Ops | **Power** | `ops.plans` |
| Terminal (observe/takeover) | `TerminalScreen.tsx` | route | **Power** | `ops.terminal` |
| Observe / RepoDiff / Session embeds | `*EmbedScreen.tsx` | embed-only URLs | Untouched | — (not in nav) |

Counts: **9 core**, **6 entry-flagged** (`surface.*`), **5 power**
(`ops.*`), **3 embed routes left as-is**.

## Open decisions (call before wiring)

1. **Search** — entry-flagged here (hide for v1). It's arguably core for
   some users; easy to flip to core if launch feedback wants it.
2. **Home vs. Agents as landing** — macOS opens straight into a section;
   web keeps a Home/Inbox digest. Keep Home as the landing for v1, or
   collapse it and land on Agents?
3. **Sessions** — kept available under Agents' sub-nav regardless; the
   `surface.sessions` flag only controls a *standalone* top-level entry.
4. **Channels** — folded under Chat as core; confirm it's not entry-flagged.

## Deferred wiring (once Hudson lands)

When the Hudson primitive is available, the mechanical work is:

1. Register the `surface.*` and `ops.*` keys in the app's flag registry,
   with tiers and defaults per the table above.
2. Restructure `topNavConfig.ts`: add `tail`, `dispatch`, `repos` as
   top-level nav keys; demote `Ops` to power-gated; route
   `topNavKeyForRoute` accordingly (today it sends repos/broker/mesh →
   `ops`).
3. Rework `secondaryNavConfig.ts`: Tail/Dispatch/Repos leave
   `OPS_SECONDARY_NAV`; Ops sub-nav keeps Control/Mesh/Runtime/Plans.
4. Tag each nav/palette entry with its `flag:` so the shell auto-hides.
5. Delete `isOpsEnabled()` and its callsites
   (`scout/hooks.ts`, `HomeScreen.tsx`, `lib/router.ts`), replaced by
   `useFlag("ops.control")` etc.

No part of this is done yet — it's the post-Hudson checklist.

## References

- Hudson request: `docs/proposals/hudson-feature-flags-primitive-proposal.md`
- Current flag: `packages/web/client/lib/feature-flags.ts`
- Nav: `packages/web/client/scout/topNavConfig.ts`,
  `packages/web/client/scout/secondaryNavConfig.ts`
- macOS curated core: `apps/macos/Sources/Scout/ScoutModels.swift`
