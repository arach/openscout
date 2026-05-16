# Packages

This directory contains OpenScout's shared TypeScript packages. The apps use
these packages to speak one broker/runtime/protocol model instead of each host
surface inventing its own state shape.

## Directory Map

| Path | Purpose | Start here |
| --- | --- | --- |
| [`protocol`](./protocol) | Shared contracts, identity grammar, route metadata, and durable record types | [`protocol/README.md`](./protocol/README.md) |
| [`runtime`](./runtime) | Local broker, SQLite store, service management, discovery, mesh, and delivery planning | [`runtime/README.md`](./runtime/README.md) |
| [`cli`](./cli) | Public `@openscout/scout` package and installed `scout` command | [`cli/README.md`](./cli/README.md) |
| [`web`](./web) | Local web UI server/client bundled into the public CLI package | [`web/README.md`](./web/README.md) |
| [`agent-sessions`](./agent-sessions) | Harness session adapters, event snapshots, and browser-safe trace boundary | [`agent-sessions/README.md`](./agent-sessions/README.md) |
| [`session-trace`](./session-trace) | Framework-agnostic live session trace model | [`session-trace/README.md`](./session-trace/README.md) |
| [`session-trace-react`](./session-trace-react) | React presentation layer for live session traces | [`session-trace-react/README.md`](./session-trace-react/README.md) |

## Common Checks

From the repo root:

```bash
npm --prefix packages/protocol run check
npm --prefix packages/runtime run check
npm --prefix packages/cli run build
bun run --cwd packages/web build
```

Use narrower package checks when working in a specific area.

## Read Next

- [`../README.md`](../README.md) for the repo overview
- [`../apps/README.md`](../apps/README.md) for runnable app surfaces
- [`../docs/architecture.md`](../docs/architecture.md) for the package boundaries
- [`../docs/data-ownership.md`](../docs/data-ownership.md) before changing persistence
