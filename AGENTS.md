# Agent Instructions

See [DEV_INSTRUCTIONS.md](./DEV_INSTRUCTIONS.md) for repository-wide development instructions.

For fast project context, read [llms.txt](./llms.txt), then the dense agent notes in [docs/agent/README.agent.md](./docs/agent/README.agent.md). If you need a larger copy/paste context bundle, use [llms-full.txt](./llms-full.txt).

Host-specific instruction files [CODEX.md](./CODEX.md) and [CLAUDE.md](./CLAUDE.md) are intentionally thin redirects. Keep shared guidance here or in `docs/agent`, not duplicated per host.

## Product Posture

OpenScout is currently for high-trust local developer pilots, not enterprise-ready deployment. Do not claim compliance readiness, hardened multi-tenant security, guaranteed distributed delivery, or a finalized open-source license unless package and repo metadata have changed.

## Core Architecture Rules

- The broker is the canonical writer for Scout-owned coordination records.
- Scout-owned records include messages, invocations, flights, deliveries, bindings, agent registrations, questions, and work items created through Scout.
- External harness transcripts such as Claude Code and Codex JSONL are observed source material. Do not bulk-import them into Scout as first-party conversation messages.
- Mesh means reachability and coordination across machines. It does not mean exactly-once delivery, global consensus, CRDT convergence, or replicated external transcript storage.
- Prefer explicit routing metadata over body mentions. Message body text is payload.

## Main Entry Points

| Area | Path |
| --- | --- |
| Desktop app, CLI, app services | `apps/desktop` |
| iOS app | `apps/ios` |
| Broker/runtime | `packages/runtime` |
| Shared protocol | `packages/protocol` |
| Public CLI package | `packages/cli` |
| Web package | `packages/web` |
| Landing/docs site | `landing` |
| Product docs | `docs` |

## Routing Model

- One explicit target means a DM.
- Group coordination requires an explicit channel.
- Shared broadcast is opt-in.
- Use `scout send` or `messages_send` for tell/update.
- Use `scout ask` or `invocations_ask` for owned work or requested replies.
- Use `replyMode: "notify"` for longer-running agent work that should return quickly and report back later.

## Must-Read Docs

- [install.md](./install.md) for install and bootstrap expectations.
- [docs/current-posture.md](./docs/current-posture.md) for maturity, trust, mesh, install footprint, and license boundaries.
- [docs/architecture.md](./docs/architecture.md) for the broker/runtime/protocol model.
- [docs/data-ownership.md](./docs/data-ownership.md) before changing transcript persistence.
- [docs/agent-integration-contract.md](./docs/agent-integration-contract.md) before adding agent/adaptor integrations.
- [docs/operator-attention-and-unblock.md](./docs/operator-attention-and-unblock.md) before changing permission, approval, or human-input flows.

## Common Verification

Run the narrowest relevant checks for your change. Common commands:

```bash
bun run --cwd apps/desktop check
npm --prefix packages/runtime run check
npm --prefix packages/protocol run check
bun run --cwd landing build
```
