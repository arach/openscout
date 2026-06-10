# scoutd

Native first slice for SCO-062.

This binary is the native daemon for the existing Bun-backed OpenScout base service. It is
intentionally stdlib-only for the first pass so the resulting package stays
small and easy to reason about.

```bash
cargo run --manifest-path crates/scoutd/Cargo.toml -- status --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- install --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- doctor --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- start --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- stop --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- uninstall --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- supervise
```

The TypeScript service manager shells out to `scoutd` for local service control.

`supervise` is the long-running daemon mode intended for launchd. It starts the
existing Bun base service as a child, restarts it with bounded backoff, handles
shutdown by terminating the child, and writes `scoutd-state.json` under the
runtime directory for `status` and `doctor`.
