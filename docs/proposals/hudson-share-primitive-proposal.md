# Hudson Share Primitive — External Proposal

## Status

Draft. Sent from OpenScout to Hudson for review.

## Audience

Hudson maintainers. This is an external request, not an OpenScout SCO.

## Summary

We would like Hudson to own a single primitive: **a share button (and the
mechanism behind it) that any Hudson app can drop into a page or panel to
package a region of UI into a portable artifact — primarily a markdown
flattening — that a human can paste into a CLI, an email, another LLM, or
anywhere else they need to hand context to an agent.**

The artifact is for **human-mediated transport to an agent**, not in-app
routing. Hudson does not need to know about Scout's mesh, broker, or any
agent. It just produces the artifact.

We want to start small and learn. v1 should not include a genre catalog,
prompt sub-types, or an annotation grammar. Those can be added later when
real friction surfaces them.

## Motivation

OpenScout's broker page (`packages/web/client/screens/BrokerScreen.tsx`)
currently has **zero copy affordances**. Errors, dispatch attempts,
inspector field values, and metadata JSON blocks all lack any way to
grab them as context. Users investigating broker issues end up
hand-selecting text or screenshotting.

We could solve that one-off in OpenScout, the way other screens do today
(right-click context menus wired through `useContextMenu()` in
`packages/web/client/components/ContextMenu.tsx`, e.g. `ActivityScreen`,
`ConversationScreen`, `AgentsScreen`). But the same need recurs in
basically every Hudson app: at some point a human will want to grab
"the thing on my screen" and hand it to an agent, an issue tracker, a
chat thread, a teammate.

If Hudson owns this primitive once, every app gets a uniform copy/share
affordance without re-implementing it, and the artifact format is
consistent across apps.

## What Hudson Provides (v1)

A single visible affordance plus the mechanism behind it.

### 1. `<ShareButton>` (or equivalent)

A button component an app developer drops anywhere in their UI. When
pressed, it walks its declared **scope**, serializes the subtree to
markdown, and writes the result to the clipboard.

### 2. `<ShareScope>` (or `data-share-scope` attribute)

A wrapper / marker that declares "this DOM region is what nearby share
buttons should serialize." The button walks up to the nearest scope
ancestor. If no scope is declared, the button defaults to its parent
element. Page-level share wraps the page; row-level share wraps the row.

### 3. A best-effort DOM-to-markdown serializer

- `<h*>` → headings
- `<ul>/<ol>/<li>` → markdown lists
- `<pre>/<code>` → code fences
- `<a>` → markdown links
- `<table>` → markdown tables
- Paragraph text → paragraphs
- Buttons, icons, presentational chrome → skipped
- Pre-existing markdown content (rendered) → preserved structurally

It does **not** need to be perfect. "Best effort" is the contract. When
something comes out wrong, that becomes the trigger for a future
annotation (see "Not in v1" below).

### 4. Uniform surfacing

- Click the visible button → copy
- Right-click anywhere inside a scope → context-menu entry to copy
- Keyboard shortcut (e.g. `Cmd+Shift+C`) when focus or hover is within a
  scope → copy
- Toast / micro-feedback on success

That's the entire v1 surface.

## What the App Decides

- **Where** to place share buttons (the prominent ones)
- **What** the scope covers — by wrapping the right region
- **Whether** to expose a button at all on a given screen, or rely only
  on context-menu / keyboard discoverability
- Nothing about content shape, format, or labels — Hudson handles those
  uniformly

## Explicitly NOT in v1

We intentionally exclude these so we can learn from real usage first:

- A **genre catalog** (markdown vs. prompt vs. link vs. JSON). The
  button emits markdown. One genre. If users need more, we add later.
- **Sub-typed prompts** ("investigate", "summarize", etc.)
- An **annotation grammar** at the app level (`data-share-skip`,
  `data-share-as-link`, `data-share-instruction`, etc.). These will
  almost certainly happen, but we want them to be reactions to concrete
  friction, not upfront design.
- Any **agent routing**. The artifact lives on the clipboard. Where it
  goes after that is the human's problem.
- A **share-to-agent sink** that calls Scout. Hudson stays mesh-agnostic.

When friction appears (a URL renders badly, a debug `<div>` leaks into
the dump, an error row needs an embedded instruction to the agent),
that's when annotations earn their place — one at a time, with a real
complaint backing each.

## First Consumer: OpenScout BrokerScreen

We would wire Hudson's primitive into the broker page as the first real
use case:

- **Page-level share button** — top-right of the BrokerScreen header,
  scope = the whole tab content
- **Inspector header share button** — next to "Open thread" /  "Close"
  in `BrokerAttemptInspector`
  (`packages/web/client/screens/BrokerScreen.tsx:359`), scope = the
  inspector's detail card region
- **Row-level share** — exposed via right-click context menu on each
  attempt / dialogue row (no visible button to keep chrome quiet), scope
  = the row
- **Error row variant** — visible inline copy icon on rows with
  non-`delivered` status, since errors are the highest-value copy target
  in this screen

That gives us four placements to validate the primitive against before
any other app picks it up.

## Design Conversation Background

This proposal came out of a design conversation that progressively
narrowed scope:

1. Started with "add copy buttons to the broker page" — too narrow.
2. Considered a Scout-level share/copy primitive — better, but bound
   the share concept to the mesh.
3. Considered a Hudson-level **genre registry** with declared kinds
   and per-app serializers — too much upfront structure.
4. Landed on: Hudson ships the dumb v1 (one button, markdown flattening),
   and the structure earns its way in later through annotations
   responding to real complaints.

Key principle that survived the narrowing: **Hudson owns mechanism, the
app owns policy.** The dumb v1 is what Hudson can ship without making
policy decisions on the app's behalf.

## Open Questions for Hudson

1. **Does this fit your current roadmap and surface ownership model?**
   Specifically, does a `<ShareButton>` / `<ShareScope>` pair belong in
   Hudson's core, or as a sibling utility module?
2. **DOM-to-markdown serializer:** do you already have one (or a
   dependency you'd want to reuse) that we should align on? If not, are
   you open to bringing one in?
3. **Keyboard / context-menu surface:** does Hudson already own a global
   keyboard handler and context-menu provider, or would this primitive
   need to bring its own? In OpenScout we already have
   `packages/web/client/components/ContextMenu.tsx`; we'd prefer Hudson's
   if one exists.
4. **Timeline / interest:** if this is interesting but not soon, would
   you prefer OpenScout build a one-off in-app version first and
   contribute back, or wait for a Hudson-native implementation?

## Ask

A synchronous read and reaction from Hudson:

- Does the framing make sense?
- Is the scope right (small enough, broad enough)?
- Anything we're missing or shouldn't ship?
- If green-lit, what's the right next step — a Hudson-side design doc,
  a prototype branch, or a back-and-forth on the API shape first?

Reply inline; we'll iterate from there.

## References

- OpenScout broker page: `packages/web/client/screens/BrokerScreen.tsx`
- Existing context-menu pattern:
  `packages/web/client/components/ContextMenu.tsx`
- Theme/portal wrapper:
  `packages/web/client/scout/Provider.tsx` (`data-scout-theme` boundary)
- Sibling screens with existing copy affordances:
  `packages/web/client/screens/ActivityScreen.tsx`,
  `ConversationScreen.tsx`, `AgentsScreen.tsx`
