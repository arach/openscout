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
| GitHub first scan | `README.md`, `docs/README.md` |
| install/bootstrap | `install.md` |
| first run | `docs/quickstart.md` |
| maturity/trust/license | `docs/current-posture.md` |
| architecture | `docs/architecture.md` |
| runtime/session semantics | `docs/runtime-sessions.md` |
| data boundary | `docs/data-ownership.md` |
| agent integration | `docs/agent-integration-contract.md` |
| host integrations | `docs/integrations.md` |
| external client comms | `docs/scout-comms.md` |
| identity grammar | `docs/agent-identity.md` |
| collaboration model | `docs/collaboration-workflows-v1.md` |
| operator attention | `docs/operator-attention-and-unblock.md` |
| glossary | `docs/glossary.md` |

## Core Records

| Record | Meaning |
|---|---|
| `message` | durable conversation record |
| `session` | concrete harness conversation/process attached to an agent endpoint |
| `invocation` | explicit request for work |
| `flight` | execution lifecycle for an invocation |
| `delivery` | planned transport-specific fan-out |
| `usage` | lightweight token/cost metadata linked to Scout records |
| `binding` | external thread/channel mapping |
| `question` | lightweight information-seeking collaboration record |
| `work_item` | durable owned execution record |

## First-Run Ladder

| Step | Command | Not Ready Means |
|---|---|---|
| CLI installed | `scout --help` | install published CLI or build/link `packages/cli` |
| machine bootstrap | `scout setup` | fix printed prerequisite or local permission issue |
| broker health | `scout doctor` | broker/service is not ready for routing |
| sender identity | `scout whoami` | wrong cwd or project metadata; rerun setup from target project |
| target discovery | `scout who` | no usable agent/session yet; install host integration or start/register agent |
| first message | `scout send --to <agent-from-scout-who> "hello"` | use a fuller selector if the short name is ambiguous |

Do not use placeholder names like `agent` as literal targets. Copy a selector
from `scout who`, or pass an exact `targetAgentId` / `targetLabel` through the
MCP tools.

## Non-Negotiable Rules

- Broker is the canonical writer for Scout-owned coordination records.
- Do not make external harness transcripts canonical Scout messages.
- Use explicit target metadata; message body is payload, not routing.
- One target means DM.
- Group coordination means explicit channel.
- Shared broadcast is opt-in.
- `send` / `messages_send` is a durable message/update with receipt ids.
- `ask` / `invocations_ask` is an invocation with receipt ids, target acknowledgement, and lifecycle state.
- Cards describe identities and return addresses; sessions are concrete harness lifecycles.
- Harness/session mismatches must fail with actionable diagnostics, not silent hangs.
- Broker-side guidance should reduce sender burden; prefer candidates and remediation over opaque routing errors.
- Track token/coordination cost as metadata when available; do not import full harness transcripts.
- If blocked, record who or what owns the next move. For long-running MCP work,
  prefer `replyMode: "notify"` over holding the caller open for completion; use
  `replyMode: "inline"` only when the caller needs an acknowledgement before
  continuing.
- If a host-side approval or permission prompt is stuck, open the host UI or use
  the host integration's forwarded unblock request. An MCP server cannot see a
  prompt intercepted by the host before the tool call reaches Scout.
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
