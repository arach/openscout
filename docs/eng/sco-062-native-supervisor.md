# SCO-062: Native Supervisor

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Local service/process supervision for the OpenScout control plane
- **Intent:** Add a small Rust supervisor that makes OpenScout's local Bun services easier to start, stop, inspect, and repair without moving product logic out of TypeScript.

## 2. Summary

OpenScout should keep Bun/TypeScript for the broker, web UI, CLI UX, MCP glue,
and agent protocol iteration. Those layers change often and benefit from the
same development loop as the rest of the product.

The process supervision layer has different needs. It owns launchd service
installation, process-tree cleanup, stale socket diagnosis, health checks, and
machine-readable repair hints. Recent runtime investigation showed that small
supervision mistakes can leave orphaned Bun broker processes consuming CPU even
when the product code is otherwise healthy.

SCO-062 introduces `openscout-supervisor`, a Rust CLI binary that becomes the
native service kernel for the local control plane. The first implementation is
intentionally narrow: supervise the existing Bun base/broker/web stack rather
than replacing it.

## 3. Decision

Build a Rust binary named `openscout-supervisor`.

The first supported command surface:

```bash
openscout-supervisor status --json
openscout-supervisor start --json
openscout-supervisor stop --json
openscout-supervisor restart --json
openscout-supervisor doctor --json
```

The existing JavaScript `scout` CLI remains the operator entrypoint. It may
shell out to `openscout-supervisor` when the binary is available, and fall back
to the current Bun service manager when it is not.

## 4. Why Rust

This decision is not primarily about speed. Rust is a good fit because the
supervisor is a small correctness-heavy local kernel:

- one native binary
- explicit errors
- predictable signal handling
- direct process and filesystem APIs
- no JS runtime dependency for supervising JS runtime processes
- efficient npm packaging through prebuilt platform binaries

## 5. Boundary

The supervisor may know:

- pids, parent pids, command lines, and process trees
- launchd labels, plist paths, and service state
- broker host, port, Unix socket path, health endpoint, and log paths
- support, runtime, and control-plane directories
- stale process and stale socket repair actions

The supervisor must not know:

- message routing semantics
- agent identity grammar beyond command-line diagnostics
- mesh forwarding rules
- invocation, flight, or delivery business logic
- protocol record ownership rules

The broker remains the canonical writer for Scout-owned coordination records.

## 6. First Slice

Add a stdlib-only Rust crate under `crates/openscout-supervisor`.

The first slice should:

1. Resolve the same default service config used by the TypeScript manager.
2. Render and install a launchd plist when one is missing.
3. Read launchd state with `launchctl print`.
4. Probe broker health through the Unix socket first, then TCP HTTP.
5. Start the existing `openscout-runtime.mjs base` process through launchd.
6. Stop the service through launchd and wait until both launchd and broker health report down.
7. Restart as stop-then-start.
8. Emit stable JSON for `status` and `doctor`.
9. Detect obvious orphan candidates such as `scout-broker` with parent pid `1`.

This first crate should avoid external Rust dependencies. Once the shape feels
right, we can add `clap`, `serde`, and `serde_json` for maintainability.

## 7. Dependency Implications

### Runtime Users

The npm install should not require Rust.

The public `@openscout/scout` package should eventually ship a prebuilt
supervisor binary or depend on an optional platform package such as
`@openscout/supervisor-darwin-arm64`.

Users should not need:

- Cargo
- Rustup
- node-gyp
- Python
- a C/C++ build chain
- postinstall native compilation

### Developers

Repo developers need Rust only when editing or building the supervisor.

The normal Bun/TypeScript workflows should continue to work when the supervisor
is absent.

### Release

Start with macOS arm64. Before public packaging, decide whether binaries live:

- inside `@openscout/scout`
- inside optional platform packages
- as release artifacts resolved by the CLI

Prefer bundled or optional packages over postinstall downloads.

## 8. Command Contract

### `status --json`

Reports:

- service label and launch agent path
- loaded state, pid, launchd state, last exit status
- broker URL and socket path
- health reachability, transport, and raw health body

### `start --json`

Ensures the launch agent exists, bootstraps it, kickstarts it, and waits for
broker health.

### `stop --json`

Boots out the launchd service and waits until the service is unloaded and broker
health is unreachable.

### `restart --json`

Runs the same stop/start sequence. Restart should not be a special launchd
shortcut until stop and start are boring.

### `doctor --json`

Includes `status` plus local process observations and warnings:

- multiple brokers
- orphaned brokers
- stale web processes
- missing runtime entrypoint
- missing Bun executable
- broker socket present while health is unreachable

## 9. Acceptance Criteria

- `openscout-supervisor status --json` works when the broker is up or down.
- `openscout-supervisor start --json` can bring up the existing Bun service.
- `openscout-supervisor stop --json` leaves no `scout-broker` or supervised `scout-web` descendants behind.
- `openscout-supervisor restart --json` succeeds from a healthy service.
- `openscout-supervisor doctor --json` reports orphaned broker processes without mutating state.
- Existing `scout` CLI and Bun service manager continue to work if the supervisor binary is absent.

## 10. Non-Goals

- Rewriting the broker in Rust.
- Moving web, CLI, MCP, or agent integration code out of TypeScript.
- Solving cross-platform service management beyond macOS in the first slice.
- Adding native Node addons.
- Requiring Rust to install the npm package.

## 11. Follow-Ups

- Wire the TypeScript service manager to prefer the supervisor when present.
- Add CI for Rust build/test/lint.
- Add prebuilt binary packaging.
- Decide whether doctor repair actions should be explicit subcommands or interactive prompts.
- Expand Linux support after macOS launchd is stable.
