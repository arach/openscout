# Engineering Docs

This folder is the home for engineering-facing design docs, proposals, and
implementation specs.

## What Goes Here

- proposals for new broker, protocol, runtime, or product architecture
- design specs that are detailed enough to implement against
- tradeoff documents for significant engineering decisions

## Conventions

- keep proposal-style docs in this folder
- prefer numbered proposal filenames like `sco-001-*.md`
- write specs so they can stand on their own without chat context
- keep product marketing or user-facing docs elsewhere under `docs/`
- when a companion exists (implementation plan, review, addendum), the
  proposal links to it in the header area via an `## Implementation` (or
  `## Reviews`, etc.) section right after `## Proposal ID`. Reciprocally,
  the companion links back in its `## Status` section. The studio's
  sibling detection still surfaces these automatically, but the explicit
  link makes the relationship visible in raw markdown too.

## Registration

**Any file matching `sco-*.md` in this folder auto-registers as a studio
page.** No manual entry in `design/studio/lib/studio-pages.ts` or in this
README is required or wanted; the studio reads this folder live via
`design/studio/lib/eng-docs.ts`. Hand-maintained index lists drift the
moment someone adds a doc.

To see the live, complete list of proposals: open the studio at
`/eng` (or browse `docs/eng/` directly).

## Operations

- [releasing.md](./releasing.md) - npm package and macOS DMG release flow

## Research Notes

- [external-runtime-inventory-and-handoff.md](./external-runtime-inventory-and-handoff.md)

## Archive

- [openagents-tracks/](./openagents-tracks/README.md) - the OpenAgents-inspired
  implementation tracks; the durable concepts were folded into the top-level
  docs (`architecture.md`, `agents-and-collaboration.md`, `concepts.md`), and
  the rest is kept here as historical planning context
