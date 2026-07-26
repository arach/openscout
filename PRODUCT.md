# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

OpenScout is one product across four surfaces that each adopt their host's design
language: a web app (`packages/web`), a native SwiftUI macOS app (`apps/macos`), a
native iOS app (`apps/ios`), and a CLI (`packages/cli`). The marketing site
(`landing/openscout.app`) and auth front door (`landing/oscout.net`) are web.

Native macOS theming is the current source of truth for the shared visual system;
web follows it. This is a product-level constraint on how surfaces relate, not a
visual specification — see each surface's DESIGN.md.

## Users

**Primary — the power operator.** A developer running many agents at once, all
day, across harnesses (Claude Code, Codex, pi), across terminals, IDEs, and tmux
panes, and often across machines. They are not evaluating Scout; they live in it.
Their job is to keep five-plus concurrent sessions moving without babysitting any
one of them, and to not miss the one that has stalled waiting on their decision.
Design optimizes for their hundredth session, not their first.

Other confirmed audiences, served but not the design center (see
[`docs/current-posture.md`](./docs/current-posture.md)):

- **Small trusted teams** experimenting with agent-to-agent workflows.
- **Coding agents themselves**, consuming Scout through MCP tools, the protocol
  package, and the CLI. Agents are real users of the tool surface; the human UI
  is a separate surface for a separate user.
- **Platform reviewers** evaluating whether the control-plane model is worth
  piloting.

Explicitly **not** current users: untrusted multi-tenant execution, regulated
enterprise rollout, security-sensitive production automation without a human
trust boundary, hosted/SLA-backed coordination.

## Product Purpose

OpenScout is a local-first control plane for AI agents. It gives Claude Code,
Codex, and other harnesses one shared place to discover agents, send messages,
dispatch work, and follow progress — without changing how any of those agents
already run.

The concrete promise today: run a local broker, make agents addressable, keep
Scout-owned coordination records durable, and let humans and agents communicate
through the same state model across CLI, desktop, mobile, and mesh-aware peers.

**Success over the next stretch is a public v1 launch** — iOS, macOS, and web
shipping as one coherent system to real outside users. Every surface is judged
against a launch-grade bar, not an internal-tool bar.

## Positioning

Scout is not an orchestrator. Orchestrators race a swarm of agents at a task
inside their own framework. Scout sits *underneath* the agents you already run.

The mechanism a neighboring product could not truthfully copy is the
**own/observe boundary**: one local broker is the canonical writer for the
coordination records Scout creates — conversations, messages, invocations,
flights, deliveries, bindings, work items, questions — while external harness
material (Claude Code transcript JSONL, Codex session JSONL, harness logs,
process signals) is observed, tailed, linked, and summarized but never
bulk-imported as if Scout authored it. That line is what lets Scout be
multi-harness without owning any harness, and durable without being a second
place you have to do your work.

Two corollaries that carry design weight:

- **Protocol-over-product.** Surfaces are built on the shared protocol, not
  beside it. Any surface can be stale, wrong, or absent without the coordination
  record being any of those.
- **Agents stay where they already work.** Scout adds a layer, never a
  relocation. A design that asks the operator to move their work into Scout has
  misread the product.

## Operating Context

The real usage scene, which design must assume rather than idealize:

- Five-plus concurrent agent sessions across two or more harnesses, some in tmux
  panes, some in IDEs, some started from Scout itself, some pre-existing.
- Multiple projects and repositories, often the same repo on several branches or
  worktrees, sometimes several machines reachable through mesh.
- The operator is usually doing something else. Scout is a peripheral surface
  most of the time and a focused one in bursts.
- The daily loop: dispatch work, watch it move, get pulled in when something is
  blocked on a decision, judge whether a result is actually done, hand the next
  step back.
- Failure modes that define the product's value: an agent silently stalled
  waiting on a yes; work finished but lost to scrollback; context moved by hand
  between tools; no record of who was asked what.
- Install footprint is a developer pilot footprint: Bun, a broker service, a
  macOS launch agent, support files under
  `~/Library/Application Support/OpenScout`, optional Caddy, optional
  Tailscale/mesh seeds, optional desktop and iOS apps.

## Capabilities and Constraints

**Confirmed functionality.** Local broker (canonical writer and router);
runtime that starts, resumes, stops, and health-checks sessions across harnesses;
shared TypeScript protocol; MCP tool surface as the agent-facing front door;
A2A projection at the external boundary (agent cards, JSON-RPC `SendMessage` /
`GetTask` / `ListTasks` / `CancelTask`, flight-to-task projection); an ACP
(Agent Client Protocol) *client* adapter; mesh reachability across trusted
machines; host integrations shipping for Codex, Claude Code, pi, Hermes, and
Cursor; bridges for Telegram, voice, and webhooks as transports.

**Terminology is load-bearing.** [`docs/concepts.md`](./docs/concepts.md) is the
canonical glossary and its distinctions must survive into UI, copy, and
information architecture. The ones that break the product when collapsed:

| Term | Means | Not |
|---|---|---|
| Agent | Durable, addressable identity | A running process |
| Session | One concrete runtime context | The agent |
| Chat / Conversation | Communication continuity | Session, project path, or work |
| Invocation | The request, captured once | Its progress |
| Flight | That invocation's lifecycle state | A second competing object |
| Question | Information-seeking record | Owned work |
| Work item | Durable owned execution with review/done states | A long message |
| Delivery | Planned transport fan-out; receipt = broker accepted | The target read it |
| Acceptance | The requester judged it actually done | The agent said it finished |
| Mesh | Reachability and coordination | Consensus or delivery guarantees |
| `@scoutbot` | The routeable assistant identity | The platform, product, or broker |

Ownership and next-move is part of the model, not implicit in who spoke last: at
any point exactly one party owns the next step.

**Technical constraints.** Bun 1.3+ toolchain; one broker per machine; full
desktop and service setup currently targets macOS; v0.x with no stable public API
contract for all integrations.

**Explicitly undecided — do not resolve these by inventing an answer.**

- Rich file and data artifact persistence is typed but not fully implemented.
- Full A2A conformance is open: streaming, push notifications, authenticated
  extended cards, active cancellation of running work, production security
  controls.
- Host-level permission and approval capture is not complete across all harnesses;
  there is no universal sandbox contract.
- No pricing, licensing tier, hosted offering, or deployment model beyond
  Apache-2.0 local install has been decided.

## Brand Commitments

Recorded as binding by inheritance from commitments the repository already makes.
Each carries its source, so any one of them can be revoked in a line.

1. **The vocabulary of [`docs/concepts.md`](./docs/concepts.md) is binding on
   user-facing copy.** "Conversation" is the user-facing noun for where messages
   live; "session" is reserved for the harness execution layer. `@scoutbot` is
   the assistant handle, distinct from Scout the platform. Agent, session, chat,
   and work are never collapsed into one another. Naming rules 1–5 in that
   document govern which name wins on collision.

2. **The honesty ceiling of [`docs/current-posture.md`](./docs/current-posture.md)
   is binding on all claims.** Never state or imply enterprise-ready,
   compliance-ready, secure multi-tenant runtime, guaranteed distributed
   delivery, or a stable public API contract. "Mesh" means reachability, never a
   distributed-systems guarantee. A corollary the product already enforces: no
   unbacked affordances — no button, field, or datum without a real backend
   behind it. Omit and name the gap instead of faking it.

3. **Identity: OpenScout / Scout, the existing logo mark and sigil, Apache-2.0.**
   License signals stay consistent across repo root, npm package manifests,
   landing pages, generated `llms.txt` / `agents.md`, README, and docs
   (`LICENSE`, `NOTICE`, `landing/openscout.app/src/components/logo-mark.tsx`).

4. **Local-first is product truth, not a marketing line.** Nothing leaves the
   machine on the ordinary path; no hosted control plane is required; pairing and
   mesh forwarding are explicit user actions. No surface may imply implicit cloud
   sync.

**Voice.** Plain, concrete, and technical without ceremony. The product states
what it does and what it does not do in the same breath — the posture document is
the tone reference. Claims are specific ("who was asked, what ran, how it
landed"), never superlative.

## Evidence on Hand

Real, usable material:

- **Documentation spine** — [`docs/quickstart.md`](./docs/quickstart.md) →
  [`docs/architecture.md`](./docs/architecture.md) →
  [`docs/agents-and-collaboration.md`](./docs/agents-and-collaboration.md) →
  [`docs/concepts.md`](./docs/concepts.md), plus
  [`install.md`](./install.md), [`docs/current-posture.md`](./docs/current-posture.md),
  and agent-facing specs under `docs/agent/`.
- **Real product screenshots** of shipping surfaces in
  `landing/openscout.app/public`, used in the landing surface gallery.
- **Five shipping host integrations** with public repos and install commands:
  `arach/codex-scout`, `arach/claude-scout`, `arach/pi-scout`,
  `arach/hermes-scout`, `arach/cursor-scout`.
- **Published npm packages** under `@openscout/*`, and a real install path
  (`curl -fsSL https://openscout.app/install | sh`, `bun add -g @openscout/scout`).
- **Blog posts** in `landing/openscout.app/content/blog` written from the actual
  system.
- **A design studio** at `design/studio` (Next.js, `bun run dev` → :43140) that
  can render surfaces against real broker fixtures before native porting.
- **Public repository** at `github.com/arach/openscout`, Apache-2.0.

Absences that future work must not fabricate: there are **no** customer
testimonials, named users, case studies, benchmark numbers, uptime or latency
figures, user or install counts, revenue, funding, press coverage, security
audit, or compliance certification. Do not invent logos, quotes, or metrics for
any surface.

## Product Principles

1. **One place to steer, not another place to work.** Scout's value is the layer
   underneath; any design that pulls the operator's actual work into Scout has
   inverted the product.
2. **The broker is the truth; every surface is a view.** Surfaces may be stale,
   wrong, or absent without the record being any of those — so surfaces must show
   their own state honestly rather than pretending to be authoritative.
3. **Own what Scout creates; observe what harnesses own.** Never present observed
   harness material as Scout-authored conversation, and never write back into
   harness-owned material.
4. **Attention is a precedence layer, not a destination.** The blocked agent
   outranks everything else wherever the operator happens to be looking. Ambient
   awareness is the default state; being pulled in is the exception, and it must
   be earned.
5. **Claim only what the system does today.** Every affordance is backed by a real
   route; every statement survives comparison to the posture document. Naming the
   gap beats filling it with a placeholder.

## Accessibility & Inclusion

No product-specific accessibility standard or required conformance level has been
established. Recorded as an open decision rather than assumed. Baseline platform
expectations still apply per surface: native accessibility affordances on macOS
and iOS, and keyboard operability on web — which the primary user's keyboard-first
working style makes a functional requirement, not only an accessibility one.
