# Native Supervisor Proposal

## Decision

Add a small native supervisor for OpenScout's local control plane, implemented in Rust, while keeping the broker, web UI, CLI UX, MCP glue, and agent protocol logic in Bun/TypeScript.

This is not a rewrite of the broker. The first milestone is a dependable process and service kernel that can start, stop, restart, inspect, and repair the existing Bun services.

## Why Rust Here

The supervisor owns behavior where correctness matters more than iteration speed:

- launchd/service lifecycle
- process-tree ownership
- signal forwarding and forced cleanup
- stale socket and port detection
- orphan detection
- health checks and restart backoff
- log path and runtime-directory hygiene
- machine-readable doctor output

Rust gives this layer a small single-binary footprint, explicit error handling, predictable process control, and fewer runtime assumptions than supervising Bun from inside Bun.

## Non-Goals

- Do not move the web UI out of TypeScript.
- Do not move the broker's HTTP API, routing semantics, or protocol iteration out of TypeScript in this milestone.
- Do not replace SQLite projection, mesh forwarding, or harness adapters yet.
- Do not require native Node addons for the npm package.

## First Milestone

Create `openscout-supervisor` with these commands:

```bash
openscout-supervisor status --json
openscout-supervisor start --json
openscout-supervisor stop --json
openscout-supervisor restart --json
openscout-supervisor doctor --json
```

The first repository slice should:

- install the launchd plist for the base service when it is missing
- start the existing `openscout-runtime.mjs base` process
- inspect the base process, broker wrapper, broker process, supervised web process, and menu app
- detect and report orphaned `scout-broker` and `scout-web` children
- verify the broker over the Unix socket first, then HTTP as fallback
- fail `stop` if launchd or broker health do not report stopped within a bounded timeout
- produce JSON status that the existing `scout` CLI can render

The existing TypeScript service manager can become a thin compatibility wrapper that shells out to `openscout-supervisor` when it is present.

Later supervisor ownership can expand into explicit process-tree signal
forwarding, forced cleanup, edge proxy inspection, mDNS helper inspection, and
doctor repair actions after this launchd-only path feels boring.

The numbered engineering proposal for this work is tracked in
[`docs/eng/sco-062-native-supervisor.md`](../eng/sco-062-native-supervisor.md).
The first repository slice lives in `crates/openscout-supervisor`.

## Dependency Implications

### Runtime Users

For npm users, the goal is no new required system dependency.

The public `@openscout/scout` package should ship or resolve a prebuilt supervisor binary. The CLI calls it as a child process. Users should not need Rust, Cargo, node-gyp, Python, or a native build chain during install.

Preferred packaging shape:

- `@openscout/scout` keeps the `scout` JavaScript CLI.
- Platform-specific optional packages may provide native binaries later, for example `@openscout/supervisor-darwin-arm64`.
- The CLI/runtime resolves the bundled supervisor, then falls back to current Bun service management when unavailable.

This keeps the npm surface CLI-style, not native-addon-style.

### Developers

Repo developers will need Rust only when editing the supervisor:

- Rust stable toolchain
- Cargo
- `Cargo.lock` checked in once the crate is first built
- CI job for supervisor build/test

The main Bun/TypeScript workflows should keep working without touching Rust unless the supervisor code changed.

### Rust Crates

Keep the first crate small. The first slice intentionally uses no external Rust
crates. Reasonable follow-up dependencies, once the command shape settles:

- `clap` for command parsing
- `serde` and `serde_json` for stable JSON output
- `thiserror` or `anyhow` for error reporting
- `tokio` only if async process and timeout handling clearly pays for itself

Avoid early dependencies on service-manager frameworks, embedded HTTP servers, or cross-platform daemon abstractions until the macOS launchd path is boring.

### Release And CI

The release pipeline will need to build and attach native binaries per target. Initial target can be macOS arm64 because that is the active pilot environment.

Before public packaging, decide between:

- bundled binaries inside `@openscout/scout`
- optional platform packages
- postinstall download from a release artifact

Prefer bundled or optional packages over postinstall compilation.

### License And Security

Adding Rust crates introduces a second dependency license set. CI should eventually include a Rust license/audit check. The supervisor should not add network access in the first milestone, except probing configured local broker URLs.

## Boundary Contract

The supervisor should treat Bun processes as opaque services. It can know command lines, pids, sockets, ports, log paths, and health endpoints. It should not know message-routing semantics, agent identities, mesh forwarding rules, or protocol record details.

The broker remains the canonical writer for Scout-owned coordination records.

## Open Questions

- Should `scout service restart` become stop-then-start through the supervisor, or should launchd own restart entirely?
- Should the supervisor own web/menu/edge directly, or only own the base process and inspect descendants?
- How soon should stale-agent repair move into the supervisor versus remain a broker doctor operation?
- What is the minimum useful Linux story after macOS launchd is stable?
