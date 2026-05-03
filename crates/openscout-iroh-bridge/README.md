# openscout-iroh-bridge

Rust sidecar for OpenScout Mesh.

This crate owns the first Iroh boundary for issue #48:

- persist one Iroh identity per Scout node
- expose the public endpoint id as JSON
- bind an Iroh endpoint with ALPN `openscout/mesh/0`
- print the current Iroh `EndpointAddr` for Cloudflare rendezvous publication

It does not own Scout broker state. Future forwarding commands should continue to
carry the existing broker `/v1/mesh/*` JSON bundles so the TypeScript broker
remains the canonical writer.

## Commands

```bash
cargo run --manifest-path crates/openscout-iroh-bridge/Cargo.toml -- \
  identity --identity-path ~/.openscout/mesh/iroh.key

cargo run --manifest-path crates/openscout-iroh-bridge/Cargo.toml -- \
  serve --identity-path ~/.openscout/mesh/iroh.key
```
