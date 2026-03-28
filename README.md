# OpenScout

OpenScout is the integration shell and local communication substrate for your agent stack.

This repo now has three active layers:

- A Next.js site at the repo root for product framing and launch messaging
- A native macOS/Electron shell for the operator-facing desktop surface
- A local broker/control plane in `packages/*` for durable agent communication and execution

The native scaffold is intentionally aligned with the shape discussed for Scout:

- `ScoutApp` is the main desktop shell with sidebar chrome, a footer status bar, and an embedded WebKit surface
- `ScoutAgent` is the always-on helper process Scout can supervise locally
- `ScoutCore` holds the shared contracts for routes, module descriptors, support paths, and helper status
- `packages/*` is where TypeScript-side runtime, protocol, and workflow logic should accumulate

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

Scout is being structured as the thin waist across your apps:

- `Talkie` contributes the process model and voice-adjacent context ideas
- `Action` contributes the native app/agent split and local runtime discipline
- `Hudson` contributes the shell principle: modules do not own chrome, the shell does

That means the first scaffold focuses on:

- one main native shell
- one helper process
- one embedded console surface
- one place to aggregate modules such as Talkie, Lattices, Operate, Action, and Hudson-style experiences

## Getting Started

The canonical machine bootstrap is:

```bash
scout init
scout doctor
```

`scout init` creates or updates machine-local settings, discovers workspace projects, writes `.openscout/project.json` for the current repo when needed, registers known agents, installs the broker launch agent, and attempts to start the broker service.

`scout doctor` is the quick operational check that the broker is installed, reachable, and writing logs in the expected support paths.

## Run The Website

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Run The Electron Shell

Use the Electron dev wrapper when you want a rebuild-and-relaunch loop for the desktop shell:

```bash
./scripts/openscout-dev relaunch
./scripts/openscout-dev status
./scripts/openscout-dev logs
```

Shortcuts are also exposed through the root package scripts:

```bash
bun run openscout:relaunch
bun run openscout:status
bun run openscout:logs
```

`openscout-dev relaunch` rebuilds the Electron shell, stops any existing Electron shell for this workspace, launches a detached replacement, and waits for the new process to stay alive before returning. Pass `--no-build` if you only want to restart the existing build.

To expose `openscout-dev` as a global CLI from this repo:

```bash
bun link
openscout-dev status
```

## Run The Native Scaffold

Build the native targets:

```bash
bun run native:build
```

Use the repo-local dev wrapper for the common native loop:

```bash
./scripts/scout-dev build
./scripts/scout-dev rebuild
./scripts/scout-dev launch
./scripts/scout-dev relaunch
./scripts/scout-dev status
```

To install the CLI globally through Bun from this repo:

```bash
bun link
bun run cli:build
(cd packages/cli && bun link)
scout --help
scout init
scout-dev status
```

For shell ergonomics:

```bash
alias scoutd="scout-dev"
alias osd="openscout-dev"
```

Launch the shell:

```bash
scout-dev launch
```

Launch the helper directly:

```bash
scout-dev agent
```

When `ScoutApp` starts, it creates a support directory at:

```text
~/Library/Application Support/OpenScout
```

The helper writes a status file there, and the shell monitors it to keep the footer and worker views up to date.

The `scout init` bootstrap provisions the broader support tree used by the broker, app, and runtime:

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

The `scout-dev` and `openscout-dev` wrappers now write app, broker, and Electron logs into the normalized `logs/` tree.

The native dev loop now builds with `xcodebuild` into:

```text
native/engine/.derivedData
```

## Repo Layout

```text
.
├── docs/
│   ├── ARCHITECTURE.md
│   └── native-runtime.md
├── native/
│   └── engine/
│       ├── Package.swift
│       ├── CoreSources/
│       └── Sources/
├── packages/
│   ├── protocol/
│   ├── runtime/
│   └── workflows/
├── src/
│   └── app/
└── public/
```

## Read Next

- `docs/ARCHITECTURE.md`
- `docs/native-runtime.md`
- `packages/protocol/README.md`
- `packages/runtime/README.md`
- `packages/relay/docs/overview.md`
- `native/engine/Package.swift`
