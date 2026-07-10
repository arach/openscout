# OpenScout

> **Requires [Bun](https://bun.sh).** Scout uses Bun as its JavaScript runtime and package manager. Install it first: `brew install bun` or `curl -fsSL https://bun.sh/install | bash`

OpenScout is a local-first control plane for AI agents. It gives Claude Code,
Codex, and future harnesses one shared broker, runtime, and protocol so agents
can be discovered, addressed, observed, and composed without each surface
inventing its own state model.

This repository is the active OpenScout product codebase. It contains the local
broker/runtime, shared protocol, public CLI, web, native, and mobile surfaces,
docs, and release tooling.

Current posture: high-trust local developer pilots. OpenScout is not yet an
enterprise-ready, compliance-ready, hardened multi-tenant runtime. Start with
[`docs/current-posture.md`](./docs/current-posture.md) before making maturity,
trust, mesh, or license claims.

## Repo Map

| Area | Path | Start here |
| --- | --- | --- |
| App surfaces | [`apps`](./apps) | [`apps/README.md`](./apps/README.md) |
| Native macOS menu app | [`apps/macos`](./apps/macos) | [`apps/macos/README.md`](./apps/macos/README.md) |
| Transitional desktop/CLI source | [`apps/desktop`](./apps/desktop) | [`apps/desktop/README.md`](./apps/desktop/README.md) |
| iOS app | [`apps/ios`](./apps/ios) | [`apps/ios/README.md`](./apps/ios/README.md) |
| Shared packages | [`packages`](./packages) | [`packages/README.md`](./packages/README.md) |
| Broker/runtime | [`packages/runtime`](./packages/runtime) | [`packages/runtime/README.md`](./packages/runtime/README.md) |
| Shared protocol | [`packages/protocol`](./packages/protocol) | [`packages/protocol/README.md`](./packages/protocol/README.md) |
| Public CLI package | [`packages/cli`](./packages/cli) | [`packages/cli/README.md`](./packages/cli/README.md) |
| Web package/bundle | [`packages/web`](./packages/web) | [`packages/web/README.md`](./packages/web/README.md) |
| Product docs | [`docs`](./docs) | [`docs/README.md`](./docs/README.md) |
| Landing/docs site | [`landing`](./landing) | [`landing/README.md`](./landing/README.md) |

Host-specific integrations live in standalone repositories when they are
independently installable packages. See [`docs/integrations.md`](./docs/integrations.md)
for the current pi, Claude Code, Codex, Cursor, Hermes, and Herdr integration
map.

## Start Here

If you are new to the docs, start with [`docs/README.md`](./docs/README.md) for
the reading order. The shortest newcomer path is:

1. [`install.md`](./install.md) for install and bootstrap expectations
2. [`docs/quickstart.md`](./docs/quickstart.md) for the first healthy local run
3. [`docs/current-posture.md`](./docs/current-posture.md) for maturity and trust boundaries
4. [`docs/architecture.md`](./docs/architecture.md) for the broker/runtime/protocol model
5. [`docs/architecture.md`](./docs/architecture.md#agent-identity-and-addressing) for address grammar and routing

Scout is aware of adjacent standards such as A2A, but it does not collapse its internal model into them. For the definitive terminology and Scout's current A2A position, see [`docs/concepts.md`](./docs/concepts.md).

For agent-ready entry points, read [`llms.txt`](./llms.txt), [`llms-full.txt`](./llms-full.txt), and [`install.md`](./install.md).

## Why The Broker Matters

OpenScout is not just "chat between terminals." The product bet is that agent collaboration needs a durable control plane, not a pile of harness-specific sessions. The current direction is:

- explicit: conversation, work, delivery, and bindings are different records
- durable: clients and adapters submit commands to the broker instead of writing coordination records directly
- addressable: agents, conversations, messages, invocations, and flights all have stable IDs
- replayable: surfaces rebuild from stored records instead of terminal scrollback
- observable: you can inspect ownership, status, failures, and outputs
- recoverable: broker restarts do not have to erase the story of what happened
- harness-agnostic: Claude, Codex, tmux, and future harnesses are edge concerns, not protocol forks

## Product Shape

At the repo level, Scout is organized around one product path:

- `packages/web`, `apps/macos`, and `apps/ios` own the current human-facing surfaces
- `packages/runtime` and `packages/protocol` are the shared broker/runtime foundation
- `packages/cli` is the public npm package; the other packages stay as private internal boundaries
- `apps/desktop` is transitional source for CLI/core pieces that have not yet moved to package-owned homes
- host-specific integrations are documented in [`docs/integrations.md`](./docs/integrations.md);
  separate repos are linked rather than vendored unless the integration needs
  to build with OpenScout internals

## Getting Started

Choose the install path that matches what you are doing:

- If you already have the published CLI, start with the machine bootstrap.
- If you are working from a fresh checkout, link the repo CLI first.

Published CLI path:

```bash
scout setup
scout doctor
```

Fresh checkout path:

```bash
bun install
npm --prefix packages/cli run build
(cd packages/cli && bun link)
scout --help
scout setup
scout doctor
```

`scout setup` creates or updates machine-local settings, writes missing
`~/.openscout/config.json` host/port defaults, discovers workspace projects,
writes `.openscout/project.json` for the current repo when needed, registers
known agents, installs the base Scout launch agent, attempts to start the base
service, and ensures Caddy is available for the local `scout.local` edge. On
macOS, setup installs missing Caddy with `brew install caddy`; otherwise install
Caddy yourself or set `OPENSCOUT_CADDY_BIN`. The base launch agent owns the
broker, local edge, web startup, and menu bar launch; boot it out with the
command shown by `scout doctor`.

Scout runs on Bun, but the web terminal additionally needs a system **Node.js**
(20+) on `PATH`: the PTY relay behind web terminal sessions is spawned under Node
and loads a prebuilt `@lydell/node-pty` binary. Nothing else requires Node; if
you never open a web terminal you can skip it. `scout doctor` probes this
("Web terminal (Node PTY relay)") and points you at `brew install node` or a
reinstall when the runtime or its native binding is missing.

`scout doctor` is the quick operational check that the broker is installed, reachable, and writing logs in the expected support paths.

For fresh delegated work, prefer project/capability routing over guessing an
agent name:

```bash
scout ask --project /path/to/repo --harness claude "review this"
```

Scout should choose or create the concrete worker and return durable follow-up
handles. Use those handles for continuity; promote a memorable worker name only
after the route is known good.

What success looks like after setup:

- `scout doctor` exits cleanly and reports the broker as reachable
- the support directory exists under `~/Library/Application Support/OpenScout`
- `scout --help` works and `bun run dev` starts the local web UI without repeating setup prompts

## Run The Local Web App

The main local web loop now runs directly from the repo root:

```bash
bun install
bun run dev
```

That starts the current OpenScout web UI and local web server from `packages/web`.

To install the CLI globally from this repo:

```bash
npm --prefix packages/cli run build
(cd packages/cli && bun link)
scout --help
scout setup
scout doctor
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

`relay-agents.json` remains the compatibility filename for machine-local agent
registry entries.

## Read Next

- [`docs/README.md`](./docs/README.md) for the docs map and reading order
- [`install.md`](./install.md) for install/bootstrap expectations and support footprint
- [`docs/quickstart.md`](./docs/quickstart.md) for the first successful local flow
- [`docs/current-posture.md`](./docs/current-posture.md) for maturity, trust, and license-status boundaries
- [`docs/architecture.md`](./docs/architecture.md) for the broker/runtime/protocol split
- [`docs/architecture.md`](./docs/architecture.md#agent-identity-and-addressing) for address grammar and name resolution
- [`docs/agent-integration-contract.md`](./docs/agent-integration-contract.md) for the minimum contract expected from agents and adapters
- [`docs/concepts.md`](./docs/concepts.md) for the definitive Scout vocabulary and A2A alignment

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
