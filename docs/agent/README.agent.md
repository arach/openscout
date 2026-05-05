# OpenScout Agent Context

Purpose: dense context for coding agents working in this repo.

## Identity

| Field | Value |
|---|---|
| Product | OpenScout |
| Current status | v0.x active product codebase |
| Trust posture | high-trust local developer pilots |
| Not ready for | enterprise, compliance, untrusted multi-tenant runtime |
| CLI | `scout` |
| Runtime | Bun |
| Primary state owner | local broker |
| Protocol package | `@openscout/protocol` |

## Main Paths

| Area | Path |
|---|---|
| Desktop app, CLI, app services | `apps/desktop` |
| iOS app | `apps/ios` |
| Broker/runtime | `packages/runtime` |
| Shared protocol | `packages/protocol` |
| Public CLI package | `packages/cli` |
| Web package | `packages/web` |
| Docs | `docs` |

## Must-Read Docs

| Need | Doc |
|---|---|
| first run | `docs/quickstart.md` |
| maturity/trust/license | `docs/current-posture.md` |
| architecture | `docs/architecture.md` |
| data boundary | `docs/data-ownership.md` |
| agent integration | `docs/agent-integration-contract.md` |
| identity grammar | `docs/agent-identity.md` |
| collaboration model | `docs/collaboration-workflows-v1.md` |
| operator attention | `docs/operator-attention-and-unblock.md` |
| glossary | `docs/glossary.md` |

## Core Records

| Record | Meaning |
|---|---|
| `message` | durable conversation record |
| `invocation` | explicit request for work |
| `flight` | execution lifecycle for an invocation |
| `delivery` | planned transport-specific fan-out |
| `binding` | external thread/channel mapping |
| `question` | lightweight information-seeking collaboration record |
| `work_item` | durable owned execution record |

## Non-Negotiable Rules

- Broker is the canonical writer for Scout-owned coordination records.
- Do not make external harness transcripts canonical Scout messages.
- Use explicit target metadata; message body is payload, not routing.
- One target means DM.
- Group coordination means explicit channel.
- Shared broadcast is opt-in.
- `send` / `messages_send` is tell/update.
- `ask` / `invocations_ask` is work or requested reply.
- If blocked, record who or what owns the next move.
- Mesh means reachability, not distributed consistency guarantees.
- Do not claim enterprise readiness.

## Common Checks

```bash
bun test apps/desktop/src/core/pairing/runtime/bridge/router.test.ts
bun run --cwd apps/desktop check
npm --prefix packages/protocol run check
npm --prefix packages/runtime run check
```

Use narrower tests/checks when the root check is blocked by unrelated workspace tooling.
