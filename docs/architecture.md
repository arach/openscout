# Architecture

This document is the system-level map for OpenScout. If you are new, read it as a guide to three things: what the broker is, what the runtime does, and what the protocol defines.

Read this after the repo [`README.md`](../README.md) if you are orienting to the project for the first time. If you want the command-first ramp first, read [`quickstart.md`](./quickstart.md) before this page. If you need naming rules or workflow semantics after this, continue with [`agent-identity.md`](./agent-identity.md) and [`collaboration-workflows-v1.md`](./collaboration-workflows-v1.md).

## Working Thesis

Scout is a local-first control plane for orchestrating AI agents across harnesses, machines, and interfaces.

For the exact meanings of Scout's core nouns, read [`glossary.md`](./glossary.md). For the current relationship between Scout and A2A, read [`a2a-alignment.md`](./a2a-alignment.md).

Remember these three things:

- **Broker**: the local daemon that stores state, routes messages, and acts as the source of truth.
- **Protocol**: the shared language for agent identities, records, and requests.
- **Runtime**: the part that starts, stops, and health-checks agent sessions on a given harness.

It does not replace Claude Code, Codex, or any other agent tool. It is the substrate: the layer where agents get discovered, addressed, observed, and composed, regardless of which harness runs them or which machine they live on. A harness is just the agent runner and transport wrapper for a specific tool. The agent itself may live outside Scout; what Scout owns is the local routing, binding, session, and durable coordination state around that agent.

In practice, the architecture is aiming for three stable outcomes:

- one canonical writer for local state: the broker
- one shared model for messages, invocations, flights, and identities: the protocol
- many possible operator surfaces and harness adapters around that core

That framing matters because most of the design choices below are about protecting those boundaries.

## Principles

A small set of constraints shape every design decision.

**Local-first, not cloud-first.** The broker, agent registry, and Scout-owned state live on your machine. Nothing phones home by default. Local files and databases are the source of truth, not a hosted API.

**Own coordination, observe transcripts.** Scout owns the control-plane records it creates or routes: conversations, messages, invocations, flights, deliveries, bindings, and agent registrations. External harness transcripts such as Claude Code or Codex JSONL remain harness-owned source material. Scout may discover, tail, summarize, link, and index lightweight metadata from those files, but it should not bulk-import every external turn into the control-plane database as if Scout authored it. See [`data-ownership.md`](./data-ownership.md).

**Multi-harness.** Agents run on Claude Code, Codex, or anything that speaks the protocol. Scout doesn't assume one execution backend.

**Multi-machine.** Agents on different machines discover and message each other through mesh forwarding. Pair a phone or a second workstation and the agent graph extends with it.

**File-based configuration.** Agent definitions, overrides, and project bindings are JSON files on disk. No dashboard required.

**Protocol over product.** The protocol package defines the shared grammar. Products are built on top of it, not beside it.

## Communication Flow

![Scout communication flow](arc:communication-flow)

Agent sessions connect to a single Scout broker over HTTP and SSE. The broker owns the agent registry and routes messages between sessions. Each harness uses its own transport -- `stream-JSON` for Claude Code, `app-server` for Codex -- but the protocol layer above is shared.

A typical exchange looks like this:

```
operator  →  scout send --to codex "review the auth module"
scout cli →  broker /v1/deliver (target intent + message body)
broker    →  resolves codex → endpoint
broker    →  codex session (deliver message via SSE)
codex     →  broker (post reply)
broker    →  operator (deliver reply via SSE)
```

One concrete example: `scout ask --to codex "review the auth module"` sends an ask-style request to the broker. The broker resolves the `codex` target to an endpoint, forwards the request to the running Codex session, waits for the reply, and stores the whole exchange as a flight. A flight is the broker's tracked record for an ask-style request, including timeout and retry state.

## Core Moving Parts

| Layer | Role | Key detail |
|-------|------|------------|
| **Protocol** | Shared type system and address grammar | Defines the agent identity grammar, message records, invocation requests, flight records, collaboration contracts, and bindings |
| **Broker** | Local message bus and state store | SQLite-backed daemon that owns registration, routing, threading, dispatch, HTTP reads/writes, and SSE updates |
| **Runtime** | Session and runtime lifecycle management | Starts, resumes, stops, and health-checks sessions across harnesses. Manages tmux sessions, system prompts, and transport adapters |
| **CLI** | Operator interface | `scout up`, `scout send`, `scout ask`, `scout who` -- passes structured route intent to the broker and keeps bootstrap/orientation cheap |
| **Surfaces** | Views into broker state | Desktop, web, iOS, terminal, and pi. They read from the broker; none of them own agent state |

### Protocol

The shared grammar everything speaks. It defines agent identity (the address grammar described in [`agent-identity.md`](./agent-identity.md)), message records, invocation requests, flight tracking, collaboration contracts, and bindings.

Anything that crosses a boundary — between agents, harnesses, or machines — is described here.

### Broker

A single local daemon per machine. Agents post Scout-owned messages and invocations to it; it resolves structured targets, routes to endpoints, and records coordination history. It is the canonical writer for Scout control-plane state. Exposes HTTP for reads and writes, SSE for live updates.

```bash
# What the broker handles
scout send --to hudson "check the deploy"  # → resolve, route, deliver
scout who                                # → read agent registry
scout watch                              # → SSE stream of all events
```

### Runtime

Manages agent sessions across harnesses — starting them, stopping them, health-checking them. Handles system prompt generation, tmux session management, and transport adapters for each harness type.

Also owns the file-based agent override registry, project discovery, and harness profile resolution.

### CLI

The operator's main interface. It sends route intent such as `--to hudson` or `--channel triage` to the broker and renders broker receipts, remediation actions, and orientation views. Legacy body-mention shortcuts still exist for compatibility, but new flows should keep target metadata out of the message body.

### Surfaces

Desktop host, web dashboard, iOS companion, terminal UI, and pi. These are views into broker-owned control-plane state and observed harness activity. None of them own agent state; the broker does.

The pi extension (see [`eng/sco-015-pi-scout-integration.md`](../docs/eng/sco-015-pi-scout-integration.md)) runs Scout coordination as a native pi extension, letting pi sessions send and receive messages via the broker alongside other harnesses.

## Performance Direction

Operator commands like `scout up`, `scout ps`, and `scout who` need to stay cheap. They shouldn't repeatedly scan the machine or spawn overlapping probes from each surface.

The broker owns all expensive reads — runtime health, agent liveness, tmux sessions, harness readiness, project discovery. These are cached as broker-owned snapshots with TTLs. When a TTL expires, the broker refreshes once and coalesces concurrent readers onto the same in-flight refresh.

Every surface reads these snapshots first, using stale-while-revalidate where appropriate. Direct filesystem or subprocess probing is limited to bootstrap and recovery paths when the broker is unavailable.

## Addressing And Session Lifecycle

![Agent lifecycle](arc:agent-lifecycle)

1. **Bind.** Create or refresh a Scout-local binding from a project path and branch to an addressable agent target.

2. **Start or attach.** `scout up` launches or resumes the harness session Scout should use for that target, with a generated system prompt that includes the collaboration contract when Scout owns the launch path.

3. **Route.** Messages with explicit target intent hit the broker, which resolves the name, finds the endpoint, and dispatches.

4. **Invoke.** For ask-style interactions, the broker creates a flight record -- tracking the request-response lifecycle with timeout and retry semantics.

5. **Stop.** `scout down` terminates the local session and marks the endpoint offline.

```bash
scout up hudson          # bind + start
scout send --to hudson "hi"  # route + deliver
scout ask --to hudson "..."  # route + invoke (tracks flight)
scout down hudson        # stop
```

## Mesh

![Mesh topology](arc:mesh-topology)

Agents on different machines discover each other through mesh forwarding. Each broker advertises its local agents to peer brokers, which sync endpoint tables so `@agent.other-machine` resolves across the network.

### Discovery

Brokers find peers two ways: by probing Tailscale's peer list (`tailscale status --json`) and through manually configured seed URLs. No mDNS, no cloud discovery service. If you're on a Tailscale network, your brokers can find each other automatically. If not, point them at each other with `OPENSCOUT_MESH_SEEDS`.

```bash
# Automatic — brokers on the same tailnet discover each other
scout mesh discover

# Manual — seed a broker URL directly
OPENSCOUT_MESH_SEEDS=http://workstation-2:4080 scout mesh discover
```

Once a peer is found, the broker fetches its agent registry via `/v1/snapshot` and merges remote agents into its local database. Each agent carries an `authorityNodeId` — the node that owns it. Messages and invocations for remote agents get forwarded to the authority broker over HTTP.

### Forwarding

When you `scout send --to hudson "..."` and hudson lives on another machine, the broker's delivery planner detects that hudson's `authorityNodeId` differs from the local node. Instead of delivering locally, it bundles the message with its full context — actors, agents, conversation, bindings — and POSTs it to the remote broker's `/v1/mesh/messages` endpoint. The remote broker commits the bundle to its own journal and delivers locally.

Invocations work the same way. Ask-style requests forward to the authority node, which executes them and returns the flight record.

### Pairing

A phone or second workstation joins the mesh through `scout pair`. The local broker starts a relay (or connects to an external one), generates a QR code with a pairing payload, and waits. The remote device scans the code, connects over a Noise-protocol-encrypted channel, and becomes a full mesh peer — not just a viewer. It gets a live view of the agent graph and can send messages into any conversation.

```bash
scout pair              # show QR code, start managed relay
scout pair --relay url  # use an external relay
```

## What Scout Is Not

Scout is not a framework for building agents. It is not a cloud service. And it is not a replacement for any single agent tool. It is the connective tissue between agent runtimes, harnesses, and operator surfaces.
