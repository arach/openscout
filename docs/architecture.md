# Architecture

## Working Thesis

Scout is a local-first runtime and protocol for orchestrating AI agents across harnesses, machines, and interfaces.

It does not replace Claude Code, Codex, or any other agent tool. It provides the substrate where multiple agents can be registered, addressed, observed, and composed — regardless of which harness runs them or which machine they live on.

## Principles

Scout follows a small set of constraints that shape every design decision:

- **Local-first, not cloud-first.** The broker, agent registry, and all state live on your machine. Nothing phones home. A SQLite database is the source of truth, not an API.

- **Multi-harness.** Agents can run on Claude Code, Codex, or any harness that speaks the protocol. Scout does not assume one execution backend.

- **Multi-machine.** Agents on different machines can discover and message each other through mesh forwarding. Pairing a phone or a second workstation extends the same agent graph.

- **File-based configuration.** Agent definitions, overrides, and project bindings are JSON files on disk. No dashboard is required to configure the system.

- **Protocol over product.** The protocol package defines the shared grammar — agent identity, message records, invocation requests, collaboration contracts. Products are built on top of that grammar, not beside it.

## Communication Flow

![Scout communication flow](arc:communication-flow)

Agent sessions connect to a single Scout broker over HTTP and SSE. The broker owns the agent registry and routes messages between sessions. Each harness uses its own transport — stream-JSON for Claude Code, app-server for Codex — but the protocol layer above it is shared.

## Core Moving Parts

### Protocol

The shared type system and address grammar that every component speaks.

Defines agent identity (the `@agent.node.branch` addressing scheme), message records, invocation requests, flight tracking, collaboration contracts, and actor/endpoint/conversation bindings.

Everything that crosses a boundary — between agents, between harnesses, between machines — is described in the protocol package.

### Broker

The local message bus and state store.

A single SQLite-backed daemon that runs on each machine. It owns agent registration, message routing, conversation threading, and invocation dispatch. Agents post messages to the broker; the broker resolves mentions, routes to endpoints, and records history.

The broker exposes an HTTP API for reads and writes and an SSE stream for live updates.

### Runtime

The agent lifecycle layer.

Manages agent sessions — starting, stopping, health-checking, and invoking agents across harnesses. Handles system prompt generation, tmux session management, Claude stream-JSON transport, and Codex app-server transport.

Also owns the relay agent override registry (the file-based agent configuration), project discovery, and harness profile resolution.

### CLI

The operator interface.

`scout up`, `scout down`, `scout send`, `scout ask`, `scout ps`, `scout who` — all commands that interact with the broker and runtime. The CLI resolves short agent names to fully-qualified agent names, infers sender identity from the current project, and handles mention-based routing.

### Surfaces

Desktop host, web dashboard, iOS companion, and terminal UI. These are views into the broker's state — they read from the same SQLite database and SSE stream. None of them own agent state; the broker does.

## Performance Direction

Cheap operator commands (`scout up`, `scout status`, `scout ps`, `scout who`, `scout watch`) should not repeatedly scan the machine or spawn overlapping probe commands from each surface.

The intended model is:

- The broker owns machine scanning and probe orchestration.
- Expensive reads (runtime health, local agent liveness, tmux sessions, harness readiness, project discovery, recent session-file discovery) are cached as broker-owned snapshots with reasonable TTLs.
- When a TTL expires, the broker performs at most one refresh for that domain and coalesces concurrent readers onto the same in-flight refresh.
- CLI, desktop, web, and mobile should read those snapshots first, using stale-while-revalidate behavior where appropriate.
- Direct filesystem or subprocess probing from command handlers should be limited to bootstrap and recovery paths when the broker is unavailable.

This keeps hot-path commands cheap, prevents duplicate kernel-level work, and gives every surface a shared view of the same runtime state.

## Agent Lifecycle

1. **Register.** An agent is registered by creating an override entry in the relay-agents file, binding a project path and branch to an agent identity.

2. **Start.** `scout up` launches the agent's harness session (Claude Code via stream-JSON, Codex via app-server, or a tmux shell session) with a generated system prompt that includes the collaboration contract.

3. **Route.** Messages mentioning `@agent` are resolved by the broker, which looks up the agent's endpoint and dispatches an invocation or delivers the message to the agent's session.

4. **Invoke.** For ask-style interactions, the broker creates a flight record that tracks the request-response lifecycle with timeout and retry semantics.

5. **Stop.** `scout down` terminates the harness session and marks the agent offline.

## Mesh

Agents on different machines discover each other through mesh forwarding. Each broker advertises its local agents; peer brokers sync endpoint tables so that `@agent.other-machine` resolves across the network.

Pairing (phone, second workstation) uses the same mesh layer — the paired device gets a real-time view of the agent graph and can send messages into any conversation.

## What Scout Is Not

- Not a framework for building agents. Agents are just Claude Code or Codex sessions with a system prompt.
- Not a cloud service. Everything runs locally. The optional cloud endpoint is only for pairing handshake and intent capture.
- Not a replacement for any single agent tool. It is the connective tissue between them.
