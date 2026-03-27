# OpenScout

OpenScout is the integration shell for your local agent stack.

This repo now has two active layers:

- A Next.js site at the repo root for product framing and launch messaging
- A native macOS scaffold at `native/engine` for the first real Scout shell

The native scaffold is intentionally aligned with the shape discussed for Scout:

- `ScoutApp` is the main desktop shell with sidebar chrome, a footer status bar, and an embedded WebKit surface
- `ScoutAgent` is the always-on helper process Scout can supervise locally
- `ScoutCore` holds the shared contracts for routes, module descriptors, support paths, and helper status
- `packages/*` is where TypeScript-side runtime, protocol, and workflow logic should accumulate

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

The `scout-dev` wrapper also writes app and helper logs there when it launches binaries directly.

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
- `native/engine/Package.swift`
