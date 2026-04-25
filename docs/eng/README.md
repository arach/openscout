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

## Current Proposals

- [sco-001-authority-thread-events-proposal.md](./sco-001-authority-thread-events-proposal.md)
- [sco-002-work-projection-and-trace-spec.md](./sco-002-work-projection-and-trace-spec.md)
- [sco-003-agent-sessions-capability-proposal.md](./sco-003-agent-sessions-capability-proposal.md)
  - [sco-003-implementation-plan.md](./sco-003-implementation-plan.md)
- [sco-004-addressable-identities-and-session-bindings-proposal.md](./sco-004-addressable-identities-and-session-bindings-proposal.md)
- [sco-005-trace-first-session-observability-proposal.md](./sco-005-trace-first-session-observability-proposal.md)
- [sco-006-integration-layer-and-boundary-proposal.md](./sco-006-integration-layer-and-boundary-proposal.md)
- [sco-007-concierge-routing-and-delegation-proposal.md](./sco-007-concierge-routing-and-delegation-proposal.md)
- [sco-007-run-graphs-and-recipes-proposal.md](./sco-007-run-graphs-and-recipes-proposal.md)
- [sco-008-context-blocks-and-skills-proposal.md](./sco-008-context-blocks-and-skills-proposal.md)
- [sco-009-activation-lifecycle-and-wake-triggers-proposal.md](./sco-009-activation-lifecycle-and-wake-triggers-proposal.md)
- [sco-010-public-relay-connectivity-and-rendezvous-proposal.md](./sco-010-public-relay-connectivity-and-rendezvous-proposal.md)
- [sco-011-external-runtime-integration-and-handoff-proposal.md](./sco-011-external-runtime-integration-and-handoff-proposal.md)

## Operations

- [releasing.md](./releasing.md) — npm package and macOS DMG release flow

## Research Notes

- [external-runtime-inventory-and-handoff.md](./external-runtime-inventory-and-handoff.md)
