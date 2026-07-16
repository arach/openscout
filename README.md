# OpenScout

OpenScout is a local-first control plane for AI agents. It gives Claude Code,
Codex, and other harnesses one shared place to discover agents, send messages,
dispatch work, and follow progress.

Agents stay in the tools where they already work. Scout adds a durable local
broker underneath them, with CLI, web, macOS, and iOS surfaces backed by the
same coordination state.

> OpenScout is in active v0.x development for high-trust local developer
> pilots. It is not yet an enterprise-ready, compliance-ready, or hardened
> multi-tenant system. See [Current Posture](./docs/current-posture.md).

## Install

OpenScout requires [Bun](https://bun.sh) 1.3 or newer. The full desktop and
service setup currently targets macOS.

```bash
brew install bun
bun add -g @openscout/scout
scout setup
scout doctor
```

`scout setup` configures the local broker and discovers your projects.
`scout doctor` verifies that the broker and its support services are healthy.

See [install.md](./install.md) for prerequisites, host integrations, and the
complete local footprint.

## Try A Handoff

Ask Scout to route work by project and harness:

```bash
scout ask --project /path/to/repo --harness claude "review this change"
```

Scout resolves or starts a suitable worker and returns durable handles for
follow-up:

```bash
scout ask --ref <ref> "now check the tests"
```

Use `send` for a message or update. Use `ask` for work whose lifecycle Scout
should track.

```bash
scout whoami
scout who
scout send --to <agent> "here is the latest context"
scout ask --to <agent> "take the next step"
```

The same conversations and work records are available to the CLI and app
surfaces. Read the [Quickstart](./docs/quickstart.md) for the complete first-run
flow.

## How It Fits Together

- **Broker** — the canonical local store and router for Scout-owned messages,
  work, deliveries, bindings, and agent registrations.
- **Runtime** — starts and observes local agents, connects harness adapters, and
  feeds the broker.
- **Surfaces** — the CLI, web UI, macOS app, and iOS app read and write the same
  broker-backed state.

OpenScout observes external harness transcripts and processes without treating
them as Scout-authored conversation history. Optional mesh features extend
reachability across machines; they do not promise global consensus or
exactly-once delivery.

Read [Architecture](./docs/architecture.md) for the full model.

## Develop From Source

```bash
git clone https://github.com/arach/openscout.git
cd openscout
bun install
bun run dev
```

To build and link the CLI from the checkout:

```bash
bun run --cwd packages/cli build
(cd packages/cli && bun link)
scout setup
scout doctor
```

Run the narrowest relevant check for your change. The common repository check
is:

```bash
bun run check
```

## Repository Map

| Area | Path |
| --- | --- |
| Web UI and server | [`packages/web`](./packages/web) |
| Broker and runtime | [`packages/runtime`](./packages/runtime) |
| Shared protocol | [`packages/protocol`](./packages/protocol) |
| Public CLI package | [`packages/cli`](./packages/cli) |
| macOS app | [`apps/macos`](./apps/macos) |
| iOS app | [`apps/ios`](./apps/ios) |
| Product documentation | [`docs`](./docs) |

`apps/desktop` contains transitional CLI and core source that has not yet moved
to its final package-owned home. Host-specific integrations live in separate
repositories; see [Integrations](./docs/integrations.md).

## Documentation

- [Install](./install.md) — prerequisites and bootstrap
- [Quickstart](./docs/quickstart.md) — first healthy handoff
- [Current Posture](./docs/current-posture.md) — maturity and trust boundaries
- [Architecture](./docs/architecture.md) — broker, runtime, and protocol model
- [Agent Integration Contract](./docs/agent-integration-contract.md) — adapter requirements
- [Documentation Map](./docs/README.md) — all product docs

Agent-oriented entry points are available in [`llms.txt`](./llms.txt) and
[`llms-full.txt`](./llms-full.txt).

## License

OpenScout is licensed under the [Apache License 2.0](./LICENSE). See
[`NOTICE`](./NOTICE) for attribution notices.
