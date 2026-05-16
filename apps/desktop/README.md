# OpenScout Desktop

Canonical home for the Scout desktop app, CLI command handlers, terminal UI,
and app-layer services. This app is the main developer surface over the local
broker/runtime; it should read and write Scout-owned coordination records
through the broker instead of inventing a second state model.

OpenScout is currently for high-trust local developer pilots. Keep desktop
copy and behavior aligned with that posture: local-first, explicit setup, no
enterprise/compliance claims.

## What Lives Here

- `bin/` contains executable entry points used by source installs.
- `src/cli` owns argv parsing, command registration, and command handlers.
- `src/app` owns host-specific desktop wiring and native integration.
- `src/core` owns product logic, setup, broker orchestration, mesh, pairing,
  mobile, MCP, and service coordination.
- `src/server` contains local server entry points used by desktop flows.
- `src/ui` contains terminal and monitor presentation.
- `src/shared` contains low-level utilities shared inside this app.

Legacy repo code outside `apps/desktop` should be treated as donor material,
not a second canonical implementation.

## Local Commands

From the repo root:

```bash
bun run dev
bun run --cwd apps/desktop check
bun run --cwd apps/desktop scout --help
bun run --cwd apps/desktop test:happy
```

Use the public package path when testing installed CLI behavior:

```bash
npm --prefix packages/cli run build
(cd packages/cli && bun link)
scout setup
scout doctor
```

## Read Next

- [Root README](../../README.md) for the product overview and bootstrap path.
- [Architecture](../../docs/architecture.md) for broker/runtime/protocol
  boundaries.
- [Current posture](../../docs/current-posture.md) for maturity and trust
  limits.
- [Agent integration contract](../../docs/agent-integration-contract.md) before
  changing harness or adapter behavior.
