# Architecture

## Working Thesis

Scout is a local-first runtime and protocol for orchestrating AI agents across harnesses, machines, and interfaces.

It doesn't replace Claude Code, Codex, or any other agent tool. It's the substrate — the layer where agents get registered, addressed, observed, and composed, regardless of which harness runs them or which machine they live on.

## Principles

A small set of constraints shape every design decision.

**Local-first, not cloud-first.** The broker, agent registry, and all state live on your machine. Nothing phones home. A SQLite database is the source of truth, not an API.

**Multi-harness.** Agents run on Claude Code, Codex, or anything that speaks the protocol. Scout doesn't assume one execution backend.

**Multi-machine.** Agents on different machines discover and message each other through mesh forwarding. Pair a phone or a second workstation and the agent graph extends with it.

**File-based configuration.** Agent definitions, overrides, and project bindings are JSON files on disk. No dashboard required.

**Protocol over product.** The protocol package defines the shared grammar. Products are built on top of it, not beside it.

## Communication Flow

![Scout communication flow](arc:communication-flow)

Agent sessions connect to a single Scout broker over HTTP and SSE. The broker owns the agent registry and routes messages between sessions. Each harness uses its own transport — `stream-JSON` for Claude Code, `app-server` for Codex — but the protocol layer above is shared.

A typical exchange looks like this:

```
operator  →  scout send "@codex review the auth module"
scout cli →  broker (resolve @codex → endpoint)
broker    →  codex session (deliver message via SSE)
codex     →  broker (post reply)
broker    →  operator (deliver reply via SSE)
```

## Core Moving Parts

| Layer | Role | Key detail |
|-------|------|------------|
| **Protocol** | Shared type system and address grammar | Defines `@agent.node.branch` identity, message records, invocation requests, collaboration contracts |
| **Broker** | Local message bus and state store | SQLite-backed daemon — owns registration, routing, threading, dispatch. HTTP API + SSE stream |
| **Runtime** | Agent lifecycle management | Starts, stops, health-checks agents across harnesses. Manages tmux sessions, system prompts, transport adapters |
| **CLI** | Operator interface | `scout up`, `scout send`, `scout ask`, `scout who` — resolves short names, infers sender identity, handles mention routing |
| **Surfaces** | Views into broker state | Desktop, web, iOS, terminal. They read from the broker — none of them own agent state |

### Protocol

The shared grammar everything speaks. Defines agent identity (the `@agent.node.branch` addressing scheme), message records, invocation requests, flight tracking, collaboration contracts, and bindings.

Anything that crosses a boundary — between agents, harnesses, or machines — is described here.

### Broker

A single SQLite-backed daemon per machine. Agents post messages to it; it resolves mentions, routes to endpoints, and records history. Exposes HTTP for reads and writes, SSE for live updates.

```bash
# What the broker handles
scout send "@hudson check the deploy"   # → resolve, route, deliver
scout who                                # → read agent registry
scout watch                              # → SSE stream of all events
```

### Runtime

Manages agent sessions across harnesses — starting them, stopping them, health-checking them. Handles system prompt generation, tmux session management, and transport adapters for each harness type.

Also owns the file-based agent override registry, project discovery, and harness profile resolution.

### CLI

The operator's main interface. Resolves short agent names (`@hudson`) to fully-qualified names (`@hudson.macbook.main`), infers sender identity from the current project or `~/.openscout/user.json`, and handles mention-based routing.

### Surfaces

Desktop host, web dashboard, iOS companion, terminal UI. These are views into the broker — they read from the same SQLite database and SSE stream. None of them own agent state; the broker does.

## Performance Direction

Operator commands like `scout up`, `scout ps`, and `scout who` need to stay cheap. They shouldn't repeatedly scan the machine or spawn overlapping probes from each surface.

The broker owns all expensive reads — runtime health, agent liveness, tmux sessions, harness readiness, project discovery. These are cached as broker-owned snapshots with TTLs. When a TTL expires, the broker refreshes once and coalesces concurrent readers onto the same in-flight refresh.

Every surface reads these snapshots first, using stale-while-revalidate where appropriate. Direct filesystem or subprocess probing is limited to bootstrap and recovery paths when the broker is unavailable.

## Agent Lifecycle

![Agent lifecycle](arc:agent-lifecycle)

1. **Register.** Create an override entry in the relay-agents file, binding a project path and branch to an agent identity.

2. **Start.** `scout up` launches the harness session with a generated system prompt that includes the collaboration contract.

3. **Route.** Messages mentioning `@agent` hit the broker, which resolves the name, finds the endpoint, and dispatches.

4. **Invoke.** For ask-style interactions, the broker creates a flight record — tracking the request-response lifecycle with timeout and retry semantics.

5. **Stop.** `scout down` terminates the session and marks the agent offline.

```bash
scout up hudson          # register + start
scout send "@hudson hi"  # route + deliver
scout ask "@hudson ..."  # route + invoke (tracks flight)
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

When you `scout send "@hudson"` and hudson lives on another machine, the broker's delivery planner detects that hudson's `authorityNodeId` differs from the local node. Instead of delivering locally, it bundles the message with its full context — actors, agents, conversation, bindings — and POSTs it to the remote broker's `/v1/mesh/messages` endpoint. The remote broker commits the bundle to its own journal and delivers locally.

Invocations work the same way. Ask-style requests forward to the authority node, which executes them and returns the flight record.

### Pairing

A phone or second workstation joins the mesh through `scout pair`. The local broker starts a relay (or connects to an external one), generates a QR code with a pairing payload, and waits. The remote device scans the code, connects over a Noise-protocol-encrypted channel, and becomes a full mesh peer — not just a viewer. It gets a live view of the agent graph and can send messages into any conversation.

```bash
scout pair              # show QR code, start managed relay
scout pair --relay url  # use an external relay
```

## What Scout Is Not

Scout is not a framework for building agents. Agents are just Claude Code or Codex sessions with a system prompt. It's not a cloud service — everything runs locally. And it's not a replacement for any single agent tool. It's the connective tissue between them.
