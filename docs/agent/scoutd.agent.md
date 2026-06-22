# scoutd Agent Notes

Source: `crates/scoutd/**`, `packages/runtime/src/broker-process-manager.ts`.

Status: shipped first slice (SCO-062). Native service kernel only — not broker logic.

Verified: 2026-06-11

## Role

`scoutd` is the Rust local daemon at the root of the Scout process tree. It installs launchd, supervises the Bun base composer, exposes doctor/status JSON, and repairs stale process ownership.

| Owns | Does not own |
|---|---|
| launchd plist install/bootout | message routing |
| `supervise` child lifecycle | invocations / flights |
| broker reachability probe | harness sessions |
| orphan/stale process diagnosis | mesh forwarding |
| `scoutd-state.json` | protocol records |

Legacy binary name `openscout-supervisor` is compatibility-only; doctor still recognizes `supervise` orphans.

## Model

| Noun | Meaning |
|---|---|
| `scoutd` | Rust CLI + long-running supervisor |
| `scout-base` | Bun process composer (`openscout-runtime.mjs base`) |
| `scout-broker` | broker child started by base |
| `scout-web` / `scout-edge` / `OpenScoutMenu` | optional children under base |
| `launchd` | macOS service keeper for `scoutd supervise` |
| `daemon_state` | `scoutd-state.json` in runtime directory |
| `service_status` | merged launchd + health + process-tree view |

## Process Shape

```plaintext
launchd
  → scoutd supervise
      → bun openscout-runtime.mjs base   (scout-base)
          → scout-broker-run → broker
          → scout-web
          → scout-edge (caddy)
          → OpenScoutMenu (optional)
```

Operator path: `scout` CLI → shells out to `scoutd` for service commands when available.

## Commands

| Command | Mode | Effect |
|---|---|---|
| `status [--json]` | one-shot | launchd label, child pids, broker health |
| `doctor [--json]` | one-shot | actionable repair report |
| `install [--json]` | one-shot | write launchd plist if missing |
| `start [--json]` | one-shot | `launchctl kickstart` |
| `stop [--json]` | one-shot | `launchctl bootout` |
| `restart [--json]` | one-shot | stop then start |
| `uninstall [--json]` | one-shot | stop, bootout legacy, remove plist |
| `--version` / `version` | one-shot | print daemon package version and optional build git SHA |
| `supervise` | long-running | spawn/restart base with backoff |

## Daemon State

`scoutd-state.json` (runtime dir):

| Field | Meaning |
|---|---|
| `version` | `scoutd` package version from `CARGO_PKG_VERSION` |
| `gitSha` | optional compile-time git SHA (`SCOUTD_GIT_SHA`) or null |
| `startedAtMs` | supervise epoch |
| `basePid` | current `scout-base` pid or null |
| `baseState` | `running` \| `exited` \| `stopping` \| `stopped` |
| `restartCount` | base restart tally |
| `restartBackoffMs` | current bounded restart delay, 1000→30000 ms |
| `lastChildExit` | last base exit `{ atMs, code, signal, description }` or null |

Written every ~2s while child alive; updated on exit/restart/shutdown.

## Supervise Behavior

- spawn: `bun <runtime-entrypoint> base` with broker env passthrough
- child exit → log → backoff 1s→30s → respawn unless shutdown requested
- child stdout/stderr append to scoutd-owned `stdout.log` / `stderr.log`; before
  each spawn, files above 512 KiB retain a bounded tail in `.1` and are truncated
- SIGINT/SIGTERM → `stopping` → terminate child (12s budget) → `stopped`
- forwards optional launch env: mesh, node, tailscale, web portal hosts

## Config Resolution

`scoutd` resolves the same service paths as TypeScript `resolveBrokerServiceConfig()`:

| Input | Typical value |
|---|---|
| `broker_host` | `127.0.0.1` (local) or `0.0.0.0` (mesh advertise) |
| `broker_port` | `43110` default |
| `broker_url` | `http://127.0.0.1:43110` |
| `broker_socket_path` | unix socket under support dir |
| `support_directory` | `~/Library/Application Support/OpenScout` |
| `runtime_directory` | support/runtime |
| `launch_agent_path` | `~/Library/LaunchAgents/com.openscout.scoutd.plist` |
| `runtime_entrypoint` | `packages/runtime/bin/openscout-runtime.mjs` |

## Health / Doctor

Doctor merges:

- launchd loaded/running state
- `scoutd-state.json` child pid alive?
- restart telemetry from `scoutd-state.json` (`restartCount`, backoff, last child exit)
- broker HTTP or unix socket `/health` (or equivalent)
- stale orphans: legacy `openscout-supervisor supervise`, duplicate brokers, zombie base

Output schema: `scout.doctor.v1` phases (CLI wraps same config).

`doctor --fix` is intentionally not implemented in the current Rust slice. If
added, keep it opt-in and conservative: ensure directories/plist, boot out the
legacy launchd label, remove a stale broker socket only when health is
unreachable and no broker process owns it, and terminate only exact-match
orphaned Scout processes already reported by doctor.

## Invariants

1. Exactly one intended `scoutd supervise` per machine service label.
2. `scoutd` never embeds Bun; it execs configured `bun` + runtime entrypoint.
3. Broker business logic stays in TypeScript broker process.
4. `scout-base` remains the Bun orchestrator for broker/web/edge/menu children.
5. Status/doctor read daemon state file; they do not guess from log tail alone.
6. Legacy supervisor process names count as conflicts in doctor until cleaned.

## Forbidden

- Implement routing or flight semantics in `scoutd`.
- Replace `scout-base` child composition with Rust reimplementation.
- Treat `scoutd` as the broker canonical writer.
- Require `scoutd` for dev-only `bun ... server open` paths (optional acceleration).

## Code Map

| Concern | Path |
|---|---|
| Rust daemon | `crates/scoutd/src/main.rs` |
| TS service config | `packages/runtime/src/broker-process-manager.ts` |
| Bun base composer | `packages/runtime/src/base-daemon.ts` |
| Runtime entry | `packages/runtime/bin/openscout-runtime.mjs` |

## Verification

```bash
cargo run --manifest-path crates/scoutd/Cargo.toml -- status --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- doctor --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- --version
scout doctor --json
```

Expect: broker reachable when base running; `basePid` matches live `scout-base`.
