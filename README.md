# OpenScout

OpenScout is the active Scout codebase: desktop app, CLI, broker runtime, and shared protocol.

The live product path is:

- `apps/scout` for product logic, CLI, UI, and app-layer services
- `packages/electron-app` for the Electron host shell
- `packages/runtime` for the broker/runtime foundation
- `packages/protocol` for shared contracts and identity grammar
- `packages/cli` for the published `@openscout/scout` wrapper that installs `scout`

## Why The Broker Matters

The product story is not just "chat between terminals." The current control-plane direction is:

- explicit: conversation, work, delivery, and bindings are different records
- durable: the broker is the only writer and local state is stored canonically
- addressable: agents, conversations, messages, invocations, and flights all have stable IDs
- replayable: surfaces rebuild from stored records instead of terminal scrollback
- observable: you can inspect ownership, status, failures, and outputs
- recoverable: broker restarts do not have to erase the story of what happened
- harness-agnostic: Claude, Codex, tmux, and future harnesses are edge concerns, not protocol forks

## Product Shape

Scout is structured around one product path:

- `apps/scout` owns product behavior
- `packages/electron-app` is the desktop host
- `packages/runtime` and `packages/protocol` are the shared broker/runtime foundation
- `packages/cli` is the thin publish wrapper around the Scout package

## Getting Started

The canonical machine bootstrap is:

```bash
scout setup
scout doctor
```

`scout setup` creates or updates machine-local settings, discovers workspace projects, writes `.openscout/project.json` for the current repo when needed, registers known agents, installs the broker launch agent, and attempts to start the broker service.

`scout doctor` is the quick operational check that the broker is installed, reachable, and writing logs in the expected support paths.

## Run The Desktop App

The main desktop loop now runs directly from the repo root:

```bash
bun install
bun run dev
```

That starts the Scout renderer and launches Electron against it.

To install the CLI globally from this repo:

```bash
brew install bun
npm --prefix packages/cli run build
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

## Repo Layout

```text
.
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
