# OpenScout Runtime

`@openscout/runtime` is the runtime-side foundation for the OpenScout control plane.

`@openscout/protocol` defines the language. `@openscout/runtime` defines how that language is stored, served, recovered, and executed on a local machine.

## What This Package Owns

The runtime is responsible for:

- the SQLite schema and local canonical store
- the broker daemon and local HTTP/SSE surface
- service installation and launch-agent management
- workspace and agent discovery
- endpoint registration and wake behavior
- delivery planning and delivery attempts
- mesh discovery via Tailscale peers or explicit broker seeds

This is the operational layer that makes the protocol feel reliable instead of theoretical.

## Machine Bootstrap

The intended first-run flow is:

```bash
scout setup
scout doctor
```

`scout setup` is expected to:

- create `~/Library/Application Support/OpenScout/settings.json`
- create `~/Library/Application Support/OpenScout/relay-agents.json`
- create `.openscout/project.json` for the current repo when needed
- discover workspace roots and infer project-backed agents
- install the broker launch agent
- attempt to start the broker service immediately

`scout init` remains available as a deprecated compatibility alias.

`scout doctor` is the operator-facing check that the support paths, service state, broker reachability, and logs line up.

## Broker Service Model

The runtime manages the broker as a macOS launch agent.

- the plist lives under `~/Library/LaunchAgents/<label>.plist`
- `launchd` owns process supervision
- stdout and stderr are written into the OpenScout support logs tree
- the runtime can inspect service state, health, and last exit status

That is the intended story for "how does the broker come up and stay up?" It is not supposed to depend on one terminal staying open.

## Agent Mapping And Discovery

The runtime already has a layered discovery model:

- machine-local settings declare workspace roots
- repo-local `.openscout/project.json` manifests provide explicit project-backed agent definitions
- machine-local `relay-agents.json` can override or add manual agents
- nearby repo markers such as `AGENTS.md`, `CLAUDE.md`, `.agents`, and `.claude` help infer the preferred harness

That gives OpenScout a way to map "which agents exist on this machine?" without making every repo hand-configure everything from scratch.

The next abstraction boundary is:

- `Project`
- `Agent Definition`
- `Agent Instance`

The important distinction is that operator-facing mentions usually start from a logical definition like `@fabric`, while routing and mesh replication eventually need a concrete instance such as `@fabric@laptop#feature-x`.

## Durable Execution Story

The runtime separates communication from execution tracking:

- conversations and messages store human-readable history
- invocations store explicit requests for work
- flights store the lifecycle of that work
- deliveries and attempts store how the work or message was routed

This is the answer to "how do we make sure nothing gets lost?"

The goal is not magic. It is that after a restart or failure, the broker has enough durable state to reconcile unfinished work instead of relying on volatile terminal memory.

## Harness-Agnostic Endpoints

The runtime should stay harness-agnostic.

- endpoints record the harness and transport they use
- the broker routes to endpoints without changing the protocol
- harness-specific startup, wake, and resume behavior stays in adapters

Claude and Codex may have different launch mechanics, but they should not require different durable work semantics.

## Current Direction

The intent remains:

- `@openscout/protocol` defines the language
- `@openscout/runtime` defines how that language is stored and executed locally
- the control plane is the source of truth for local communication and execution
