# Apps

This directory contains OpenScout's runnable application surfaces and a few
legacy/transitional app roots. Shared runtime, protocol, CLI distribution, and
bundled web code live in `packages/`; apps are host-specific shells and services
that sit on top of those package boundaries.

## Directory Map

| Path | Purpose | Start here |
| --- | --- | --- |
| [`desktop`](./desktop) | Transitional source for CLI/core/local-host code that is moving into packages or native app homes | [`desktop/README.md`](./desktop/README.md) |
| [`ios`](./ios) | Scout iOS app and mobile human surface | [`ios/README.md`](./ios/README.md) |
| [`macos`](./macos) | Native macOS menu bar shell and launch affordances | [`macos/README.md`](./macos/README.md) |
| [`mesh-front-door`](./mesh-front-door) | Cloudflare Worker rendezvous and push relay service | [`mesh-front-door/README.md`](./mesh-front-door/README.md) |
| [`cloud`](./cloud) | Small hosted API/review surfaces for feedback and intent capture | [`cloud/README.md`](./cloud/README.md) |
| [`scout`](./scout) | Compatibility entrypoint for the old app path | [`scout/README.md`](./scout/README.md) |

OpenScout remains local-first. Hosted app surfaces support setup, feedback,
rendezvous, or notification flows; they are not the canonical broker and should
not store broker-owned coordination records.

## Common Commands

From the repo root:

```bash
bun run dev
bun run --cwd apps/desktop check   # only when touching transitional desktop code
bun run --cwd apps/mesh-front-door check
bun run --cwd apps/cloud check
```

## Read Next

- [`../README.md`](../README.md) for the repo overview
- [`../packages/README.md`](../packages/README.md) for shared packages
- [`../docs/architecture.md`](../docs/architecture.md) for the broker/runtime/protocol model
- [`../docs/current-posture.md`](../docs/current-posture.md) for maturity and trust boundaries
