# OpenScout

OpenScout is the local Scout workspace for the current desktop app, CLI, and broker runtime.

This repo now has three active layers:

- A Scout app tree under `apps/scout` for product logic and UI
- An Electron shell for the operator-facing desktop surface
- A local broker/control plane in `packages/*` for durable agent communication and execution

The live Scout path is:

- `apps/scout` for product logic, CLI, UI, and app-layer services
- `packages/electron-app` for the Electron host shell
- `packages/runtime` and `packages/protocol` for the local broker/runtime foundation

## Why The Broker Matters

The product story is not just "chat between terminals." The current control-plane direction is:

- explicit: conversation, work, delivery, and bindings are different records
- durable: the broker is the only writer and local state is stored canonically
- addressable: agents, conversations, messages, invocations, and flights all have stable IDs
- replayable: surfaces rebuild from stored records instead of terminal scrollback
- observable: you can inspect ownership, status, failures, and outputs
- recoverable: broker restarts do not have to erase the story of what happened
- harness-agnostic: Claude, Codex, tmux, and future harnesses are edge concerns, not protocol forks

## Current Direction

Scout is being structured around one product path:

- `apps/scout` owns product behavior
- `packages/electron-app` is the desktop host
- `packages/runtime` and `packages/protocol` are the shared broker/runtime foundation
- `packages/cli` is the thin publish wrapper around the Scout CLI

## Getting Started

The canonical machine bootstrap is:

```bash
scout setup
scout doctor
```

`scout setup` creates or updates machine-local settings, discovers workspace projects, writes `.openscout/project.json` for the current repo when needed, registers known agents, installs the broker launch agent, and attempts to start the broker service.

`scout doctor` is the quick operational check that the broker is installed, reachable, and writing logs in the expected support paths.

## Run The Electron Shell

The main desktop loop now runs directly from the repo root:

```bash
bun install
bun run dev
```

That command starts the Scout renderer, verifies it is the Scout UI rather than another Vite app on the same machine, and then launches Electron against that renderer.

To install the CLI globally through Bun from this repo:

```bash
bun link
bun run cli:build
(cd packages/cli && bun link)
scout --help
scout setup
```

```text
~/Library/Application Support/OpenScout
```

The support directory is now organized as:

```text
~/Library/Application Support/OpenScout
├── settings.json
├── relay-agents.json
├── logs/
│   ├── app/
│   └── broker/
└── runtime/
    └── agents/
```

`~/.openscout/relay` still exists as the relay compatibility layer, but it is no longer the primary setup surface.

## Repo Layout

```text
.
├── ARCHIVED/
│   └── ...
├── apps/
│   └── scout/
├── docs/
│   ├── ARCHITECTURE.md
│   └── agent-identity.md
├── packages/
│   ├── cli/
│   ├── electron-app/
│   ├── protocol/
│   └── runtime/
└── scripts/
```

## Read Next

- `docs/ARCHITECTURE.md`
- `docs/agent-identity.md`
- `packages/protocol/README.md`
- `packages/runtime/README.md`
- `ARCHIVED/README.md`
