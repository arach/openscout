# openscout-supervisor

Native first slice for SCO-062.

This binary supervises the existing Bun-backed OpenScout base service. It is
intentionally stdlib-only for the first pass so the resulting package stays
small and easy to reason about.

```bash
cargo run --manifest-path crates/openscout-supervisor/Cargo.toml -- status --json
cargo run --manifest-path crates/openscout-supervisor/Cargo.toml -- doctor --json
cargo run --manifest-path crates/openscout-supervisor/Cargo.toml -- start --json
cargo run --manifest-path crates/openscout-supervisor/Cargo.toml -- stop --json
cargo run --manifest-path crates/openscout-supervisor/Cargo.toml -- supervise
cargo run --manifest-path crates/openscout-supervisor/Cargo.toml -- repo-watch snapshot --json
```

The repo currently keeps the TypeScript service manager as the production path.
The supervisor is a parallel slice until it has proven start/stop/restart
behavior locally.

`supervise` is the long-running daemon mode intended for launchd. It starts the
existing Bun base service as a child, restarts it with bounded backoff, handles
shutdown by terminating the child, and writes `supervisor-state.json` under the
runtime directory for `status` and `doctor`.

`repo-watch snapshot --json` is a first native worker slice. It shells out to
`git`, parses worktree/status porcelain, and emits the same snapshot shape used
by `/v1/repo-watch/snapshot`. The Bun runtime opts into this path only when
`OPENSCOUT_REPO_WATCH_NATIVE=1` or `OPENSCOUT_REPO_WATCH_NATIVE_BIN` is set;
otherwise it keeps using the TypeScript scanner.
