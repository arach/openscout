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
```

The repo currently keeps the TypeScript service manager as the production path.
The supervisor is a parallel slice until it has proven start/stop/restart
behavior locally.
