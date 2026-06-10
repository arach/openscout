# SCO-062: scoutd Native Daemon

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Local service/process lifecycle control for the OpenScout control plane
- **Intent:** Add a small Rust daemon that makes OpenScout's local Bun services easier to start, stop, inspect, and repair without moving product logic out of TypeScript.

## 2. Summary

OpenScout should keep Bun/TypeScript for the broker, web UI, CLI UX, MCP glue,
and agent protocol iteration. Those layers change often and benefit from the
same development loop as the rest of the product.

The process daemon layer has different needs. It owns launchd service
installation, process-tree cleanup, stale socket diagnosis, health checks, and
machine-readable repair hints. Recent runtime investigation showed that small
daemon ownership mistakes can leave orphaned Bun broker processes consuming CPU even
when the product code is otherwise healthy.

SCO-062 introduces `scoutd`, a Rust CLI binary that becomes the native service
kernel for the local control plane. The first implementation is
intentionally narrow: supervise the existing Bun base/broker/web stack rather
than replacing it.

## 3. Decision

Build a Rust binary named `scoutd`.

The first supported command surface:

```bash
scoutd status --json
scoutd install --json
scoutd start --json
scoutd stop --json
scoutd restart --json
scoutd uninstall --json
scoutd doctor --json
scoutd supervise
```

The existing JavaScript `scout` CLI remains the operator entrypoint. It shells
out to `scoutd` for local service commands.

`supervise` is the long-running daemon process. The other commands are one-shot
operator commands that inspect launchd/broker state or ask launchd to start and
stop the daemon.

Process ownership is intentionally layered:

```text
launchd -> scoutd -> scout-base -> scout-broker -> scout-web / scout-edge / OpenScoutMenu
```

`launchd` keeps `scoutd` alive. `scoutd` is the durable native root and doctor
for the local runtime. `scout-base` remains the Bun service composer that starts
the broker and web/edge/menu children.

## 4. Why Rust

This decision is not primarily about speed. Rust is a good fit because the
daemon is a small correctness-heavy local kernel:

- one native binary
- explicit errors
- predictable signal handling
- direct process and filesystem APIs
- no JS runtime dependency for supervising JS runtime processes
- efficient npm packaging through prebuilt platform binaries

## 5. Boundary

`scoutd` may know:

- pids, parent pids, command lines, and process trees
- launchd labels, plist paths, and service state
- broker host, port, Unix socket path, health endpoint, and log paths
- support, runtime, and control-plane directories
- stale process and stale socket repair actions

`scoutd` must not know:

- message routing semantics
- agent identity grammar beyond command-line diagnostics
- mesh forwarding rules
- invocation, flight, or delivery business logic
- protocol record ownership rules

The broker remains the canonical writer for Scout-owned coordination records.

## 6. First Slice

Add a stdlib-only Rust crate under `crates/scoutd`.

The first slice should:

1. Resolve the same default service config used by the TypeScript manager.
2. Render and install a launchd plist when one is missing.
3. Read launchd state with `launchctl print`.
4. Probe broker health through the Unix socket first, then TCP HTTP.
5. Start `scoutd supervise` through launchd.
6. Have `supervise` start the existing `openscout-runtime.mjs base` process as
   a child.
7. Restart the child with bounded backoff if it exits unexpectedly.
8. Stop the service through launchd and wait until both launchd and broker health report down.
9. Restart as stop-then-start.
10. Emit stable JSON for `status` and `doctor`.
11. Write a small `scoutd-state.json` file with daemon pid, child pid, restart
    count, and last update time.
12. Detect obvious orphan candidates such as `scoutd`,
    `scout-broker`, and `scout-web` with parent pid `1`.

This first crate should avoid external Rust dependencies. Once the shape feels
right, we can add `clap`, `serde`, and `serde_json` for maintainability.

## 7. Dependency Implications

### Runtime Users

The npm install should not require Rust.

The public `@openscout/scout` package should eventually ship a prebuilt
`scoutd` binary or depend on an optional platform package such as
`@openscout/scoutd-darwin-arm64`.

Users should not need:

- Cargo
- Rustup
- node-gyp
- Python
- a C/C++ build chain
- postinstall native compilation

### Developers

Repo developers need Rust only when editing or building `scoutd`.

The normal Bun/TypeScript workflows should continue to work when `scoutd`
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

- missing `scoutd` state while launchd is loaded
- multiple `scoutd` processes
- multiple brokers
- orphaned brokers
- stale web processes
- missing runtime entrypoint
- missing Bun executable
- broker socket present while health is unreachable

## 9. Acceptance Criteria

- `scoutd status --json` works when the broker is up or down.
- `scoutd install --json` writes the launchd plist without starting the service.
- `scoutd start --json` can bring up the existing Bun service.
- launchd starts `scoutd supervise`, not Bun directly.
- `scoutd stop --json` leaves no `scout-broker` or supervised `scout-web` descendants behind.
- `scoutd restart --json` succeeds from a healthy service.
- `scoutd status --json` includes the last written daemon state when `scoutd` is running.
- `scoutd doctor --json` reports orphaned broker processes without mutating state.
- Existing `scout` CLI and Bun service manager continue to work if the `scoutd` binary is absent.

## 10. Non-Goals

- Rewriting the broker in Rust.
- Moving web, CLI, MCP, or agent integration code out of TypeScript.
- Solving cross-platform service management beyond macOS in the first slice.
- Adding native Node addons.
- Requiring Rust to install the npm package.

## 11. Follow-Ups

- Wire the TypeScript service manager to prefer `scoutd` when present.
- Add CI for Rust build/test/lint.
- Add prebuilt binary packaging.
- Decide whether doctor repair actions should be explicit subcommands or interactive prompts.
- Expand Linux support after macOS launchd is stable.
