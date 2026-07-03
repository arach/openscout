# OpenScout Agent Sessions

`@openscout/agent-sessions` is the shared session capability substrate for
OpenScout. It normalizes live harness sessions into a small stream of session
events, snapshots, approvals, topology hints, and replayable state that the
runtime and surfaces can consume.

This package observes harness-owned material. It should not make Claude Code,
Codex, pi, or future harness transcripts into first-party Scout conversation
messages. Durable coordination records belong in the broker/runtime; adapter
state here is the bridge between a concrete harness session and Scout's control
plane.

## What This Package Owns

- protocol primitives and adapter types
- adapter implementations for ACP stdio agents, Grok ACP, Codex, Claude Code,
  pi, opencode, OpenAI-compatible processes, and the echo test harness
- in-memory session state and replay helpers
- `SessionRegistry`
- a browser-safe `./client` boundary for trace consumers
- a broker-free `./local` boundary for embedding local pi / Grok ACP turns
- adapter spec fixtures and validation tooling

`./client` is intentionally narrower than the package root. It exposes only
browser-safe protocol, snapshot, event, and approval helper types so web and
mobile trace consumers can avoid pulling in registry or adapter code paths.

`./local` exposes `completeLocalAgentTurn` and `createLocalAgentClient` for
apps that need a direct local turn without broker records or runtime imports.

## Local Commands

From the repo root:

```bash
npm --prefix packages/agent-sessions run build
npm --prefix packages/agent-sessions run check
npm --prefix packages/agent-sessions run test
npm --prefix packages/agent-sessions run adapter:validate-specs
```

## Important Boundaries

- Adapter code may inspect harness transcripts, topology, logs, and process
  signals, but must not bulk-import external turns as Scout `message` records.
- Browser-facing imports should come from `@openscout/agent-sessions/client`
  unless registry or adapter code is explicitly needed.
- Adapter behavior should fail with actionable diagnostics when a harness,
  executable, cwd, or session is unavailable.

## Read Next

- [Data model](../../docs/architecture.md#the-data-model) for the Scout-owned versus
  harness-owned boundary.
- [Agent integration contract](../../docs/agent-integration-contract.md) for
  adapter expectations.
- [Architecture](../../docs/architecture.md) for how sessions connect to the
  broker and runtime.
