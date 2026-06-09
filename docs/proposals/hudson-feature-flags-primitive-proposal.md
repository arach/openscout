# Hudson Feature-Flags Primitive — External Proposal

## Status

Draft. Sent from OpenScout to Hudson for review.

## Audience

Hudson maintainers. This is an external request, not an OpenScout SCO.

## Summary

We would like Hudson to own a single primitive: **a feature-flag system
in HudsonKit that any Hudson app can use to gate functionality at three
levels of granularity — the nav level, the page level, and *inside* a
page (an individual feature/control) — behind named flags, where a flag
resolves from layered configuration and an *audience*, not just a
hardcoded boolean.**

Hudson already owns the shell: nav, command palette, chrome. That's
exactly where surfaces are *declared*, so it's where they should be
*gated*. Every Hudson app eventually wants to ship a lean default
surface and hide the rest behind a flag — OpenScout's macOS app already
does this by hand (it curates to 4 sections), and the web app needs to
do the same against ~21 surfaces. If Hudson owns the mechanism once,
every app gets uniform gating and we stop re-implementing one-off
booleans.

**Keep v1 simple.** Static layered config + local overrides + a dev
toggle panel. It is explicitly *not* a remote experimentation platform
(no metrics, no percentage rollouts, no per-user targeting backend) —
those earn their way in later if real need surfaces them. That said, we
want Hudson to **take the room to research the design space first** (how
other shells model flag granularity, SSR-safe resolution, and
audience/tier resolution) before settling the API — land a small v1, but
land the *right* small v1.

## Motivation

OpenScout's web app (`packages/web/client`) has grown to ~21 top-level
navigable surfaces. The only gating that exists today is a single
one-off boolean:

```ts
// packages/web/client/lib/feature-flags.ts
export function isOpsEnabled(): boolean {
  if (typeof window === "undefined") return false;     // SSR → false
  const params = new URLSearchParams(window.location.search);
  if (params.has("no-ops")) return false;              // URL string only
  return true;
}
```

This has three problems we keep hitting:

1. **It's not a registry.** There's one flag, named in code, with no
   metadata, no list of what flags exist, no defaults. Adding a second
   gate means another bespoke function.
2. **It's SSR-unsafe.** It returns `false` on the server, so anything
   gated by it flickers/hides during server render.
3. **It's a single axis (on/off via URL).** We can't say "this surface
   is on for internal/power users but off for a clean public launch"
   without inventing more URL params by hand.

We want to ship a **lean, macOS-mirroring core** for the web app —
`Agents · Chat · Tail · Dispatch · Repos` (plus a landing + settings) —
and gate everything else. See the companion triage:
`docs/eng/web-launch-surface-triage.md`.

We could solve this one-off in OpenScout (extend `feature-flags.ts` into
a local registry). But the same need recurs in every Hudson app, and the
gate is most natural *adjacent to the shell's nav/palette declarations*,
which Hudson owns. So we'd rather ask Hudson first.

## What Hudson Provides (v1)

### 0. Three levels of granularity

The same flag mechanism must read cleanly at three scopes — this is the
core requirement:

- **Nav level** — hide/show a whole top-level surface (e.g. `Search`,
  `Ops`). The shell drops the nav entry when off.
- **Page level** — hide/show a screen or a sub-route even when its nav
  parent is visible (e.g. a `Plans` tab inside Ops).
- **Intra-page level** — gate an individual feature/control *within* a
  page (a button, a panel, an experimental section) without touching the
  surrounding page.

All three are the same `isEnabled(key)` / `useFlag(key)` call and the
same registry — the only difference is *where* it's read. The nav and
palette integration (below) is sugar over the nav/page cases; the
intra-page case is just the hook used inline in a component.

### 1. A typed flag registry

A single source of truth where an app declares the flags it has, with
metadata — not flags scattered as ad-hoc booleans.

```ts
const flags = defineFlags({
  "surface.search":   { label: "Search",   default: false, tier: "everyone" },
  "ops.mesh":         { label: "Mesh",      default: false, tier: "power" },
  // …
});
```

### 2. An SSR-safe resolver

`isEnabled(key)` and a `useFlag(key)` hook that work identically on
server and client (no bare `window` assumption). Server render and
client render agree, so gated UI doesn't flicker.

### 3. Layered resolution with a documented precedence

A flag's value is resolved through an ordered stack, highest wins:

```
local override (persisted)  →  URL override  →  shared config
(~/.openscout/config.json)  →  build/env  →  registry default
```

This lets us flip a surface on/off **without a redeploy** (shared config
or URL), and lets a developer pin their own view (local override).

### 4. An *audience* dimension (the key thing beyond a boolean)

A flag resolves not just to on/off but against an **audience** the host
sets once (e.g. `everyone | internal | power`). A flag declared
`tier: "power"` is on only when the active audience includes that tier.
This is how we gate "the sexy ops surfaces" by *who you are* rather than
by a hand-rolled URL string per surface.

The set of audience values is the app's policy; Hudson just resolves a
flag's declared tier against the host-provided audience.

### 5. Shell integration

Nav items and command-palette entries accept an optional `flag:` (and/or
a predicate), and Hudson's shell **auto-hides** them when the flag is
off. The app shouldn't have to filter its own nav array — the shell that
renders nav should honor the gate.

### 6. A dev toggle panel

A command-palette-reachable panel listing every registered flag with its
current resolved value, source (which layer won), and a live on/off +
audience override that persists locally. Hudson owns the palette, so
this belongs there.

## What the App Decides

- **Which flag keys exist** and their defaults.
- **What the audiences mean** and how the active audience is determined
  (login role, env, dev toggle).
- **Which surfaces map to which keys** — by tagging nav/palette entries.
- Nothing about the resolution mechanism, persistence, or the toggle
  panel — Hudson handles those uniformly.

Same principle as the Share primitive proposal: **Hudson owns mechanism,
the app owns policy.**

## Explicitly NOT in v1

We intentionally exclude these so we can learn from real usage first:

- A **remote/dynamic config service** that pushes flag changes live.
  v1 reads static layers (env, on-disk config, URL, local). A polling or
  socket-pushed source can be added later as just another layer.
- **Experimentation / metrics** — no A/B assignment, no exposure
  logging, no analytics.
- **Percentage rollouts** and **per-user targeting backends**. The
  audience dimension is coarse and host-set, not a server cohorting
  system.
- A **flag-management UI for non-developers**. The dev toggle panel is
  for us, not an admin console.

## First Consumer: OpenScout Web

We would register OpenScout's surface flags against this primitive and
gate the top nav + palette with them. Two tiers, drawn from the triage
doc:

- **`surface.*`** (tier `everyone`, default **off**) — declutter the
  default launch: `surface.search`, `surface.sessions`,
  `surface.briefings`, `surface.work`, `surface.activity`,
  `surface.follow`.
- **`ops.*`** (tier `power`, audience-gated) — the ops/observability
  surfaces: `ops.control`, `ops.mesh`, `ops.runtime`, `ops.plans`,
  `ops.terminal`.

Core surfaces (`Agents · Chat · Tail · Dispatch · Repos` + Home +
Settings) carry **no flag** — they always render. This replaces
`isOpsEnabled()` entirely.

That gives Hudson a concrete first integration (a real nav, a real
palette, ~11 flags across 2 tiers) to validate the API against.

## Open Questions for Hudson

1. **Ownership model:** does a flag registry belong in HudsonKit core, or
   as a sibling utility module (the way you're weighing the Share
   primitive)?
2. **Config layer:** do you already own a resolution path for
   `~/.openscout/config.json` (or an equivalent shared-config reader) we
   should align the "shared config" layer on, rather than each app
   inventing its own?
3. **Nav/palette extension point:** does your nav + command-palette
   config already have a per-item predicate / visibility hook we'd hang
   `flag:` off of, or would this primitive add one?
4. **SSR contract:** how does your Provider want flags hydrated so server
   and client resolution match (initial values serialized into the
   page)?
5. **Audience:** is a coarse host-set audience (`everyone/internal/power`)
   the right shape, or do you already model "who the user is" somewhere
   we should derive the tier from?
6. **Timeline / interest:** if this is interesting but not soon, would
   you prefer OpenScout build a local registry first (extending
   `feature-flags.ts`) and contribute the shape back, or wait for a
   Hudson-native implementation? OpenScout's current plan is to **wait**
   for the Hudson primitive before wiring (see triage doc), so timeline
   matters to us.

## Ask

A synchronous read and reaction from Hudson:

- Does the framing make sense — flags as a shell-adjacent primitive?
- Is the scope right (static layers + audience + toggle panel, no remote
  experimentation)?
- Is the audience dimension the right generalization, or overkill for v1?
- If green-lit, what's the next step — a Hudson-side design doc, a
  prototype branch, or an API back-and-forth first?

Reply inline; we'll iterate from there.

## References

- Current one-off flag: `packages/web/client/lib/feature-flags.ts`
- Top nav config: `packages/web/client/scout/topNavConfig.ts`
- Ops sub-nav (where core surfaces are currently buried):
  `packages/web/client/scout/secondaryNavConfig.ts:69`
- Shell consumption point: `packages/web/client/scout/Provider.tsx`
- Companion triage (which surfaces, which keys):
  `docs/eng/web-launch-surface-triage.md`
- Curated-core precedent (macOS ships 4 sections by hand):
  `apps/macos/Sources/Scout/ScoutModels.swift` (`ScoutSection`)
- Sibling external proposal (same mechanism/policy split):
  `docs/proposals/hudson-share-primitive-proposal.md`
