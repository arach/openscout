# OpenScout Agent Context

Verified: 2026-06-19

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
| Transitional desktop/CLI source | `apps/desktop` |
| Web UI/server | `packages/web` |
| Native macOS Scout app + HUD + thin menu helper | `apps/macos` |
| iOS app | `apps/ios` |
| Broker/runtime | `packages/runtime` |
| Shared protocol | `packages/protocol` |
| Public CLI package | `packages/cli` |
| Web package | `packages/web` |
| Docs | `docs` |

## Semantic Specs (dense)

Start at [`INDEX.agent.md`](./INDEX.agent.md) for subsystem specs written for agents/programs.

| Subsystem | Spec |
|---|---|
| Index / read order | `docs/agent/INDEX.agent.md` |
| Broker records + routing | `docs/agent/broker.agent.md` |
| Comms workflows | `docs/agent/scout-comms.agent.md` |
| Harness sessions | `docs/agent/runtime-sessions.agent.md` |
| Pairing / mobile bridge | `docs/agent/pairing-runtime.agent.md` |
| scoutd / local services | `docs/agent/scoutd.agent.md` |
| Native macOS app (Scout + HUD + menu helper) | `docs/agent/macos.agent.md` |

## Must-Read Docs

| Need | Doc |
|---|---|
| GitHub first scan | `README.md`, `docs/README.md` |
| install/bootstrap | `install.md` |
| first run | `docs/quickstart.md` |
| maturity/trust/license | `docs/current-posture.md` |
| architecture | `docs/architecture.md` |
| runtime/session semantics (prose) | `docs/runtime-sessions.md` |
| data boundary | `docs/data-ownership.md` |
| agent integration | `docs/agent-integration-contract.md` |
| host integrations | `docs/integrations.md` |
| external client comms (prose) | `docs/scout-comms.md` |
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
| target discovery | `scout who` | use only when you need a specific existing target |
| first project ask | `scout ask --project /path/to/repo --harness claude "review this"` | broker should route/create a compatible worker and return handles |
| first specific message | `scout send --to <agent-from-scout-who> "hello"` | use a fuller selector if the short name is ambiguous |

Do not use placeholder names like `agent` or generic guesses like `claude.main`
as literal targets. For fresh capability work, pass `projectPath` / `--project`
and optional `harness` / `--harness`; for continuity, use the returned `ref`,
flight, conversation, work, or session handle. Copy a selector from `scout who`
only when you mean one specific known target.

## Non-Negotiable Rules

- Broker is the canonical writer for Scout-owned coordination records.
- Do not make external harness transcripts canonical Scout messages.
- Use explicit target metadata; message body is payload, not routing.
- One target means DM; group coordination means explicit channel; shared
  broadcast is opt-in.
- Harness/session mismatches must fail with actionable diagnostics, not silent hangs.
- If blocked, record who or what owns the next move.
- Mesh means reachability, not distributed consistency guarantees.
- Do not claim enterprise readiness.
- Session/card targeting (fresh vs `session:<id>` continue), `send`/`ask`/`messages_reply`
  semantics, project-routed asks, and reply-path rules: see
  `runtime-sessions.agent.md` and `scout-comms.agent.md`.
- Usage/cost tracking, broker-side coaching, reply modes, and stuck host
  permission prompts: see `scout-comms.agent.md`, `broker.agent.md`, and
  `integration-contract.agent.md`.
- Capability-first routing: project + harness first, returned handle for
  follow-up, broker-suggested/pinned name only after the worker is known good.
- Spec-backed handoffs should reference the durable spec or prompt file instead
  of pasting its full text into the Scout message. Keep the file as the source
  of truth for traceability; see `docs/agent/scout-comms.agent.md`.

## Common Checks

```bash
bun test apps/desktop/src/core/pairing/runtime/bridge/router.test.ts
bun run --cwd apps/desktop check
bun run --cwd packages/web build:server
npm --prefix packages/protocol run check
npm --prefix packages/runtime run check
```

Use narrower tests/checks when the root check is blocked by unrelated workspace tooling.
