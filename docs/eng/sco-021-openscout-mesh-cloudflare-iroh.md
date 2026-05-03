# SCO-021: OpenScout Mesh Cloudflare Rendezvous And Progressive Transport

## Status

Draft implementation plan for [issue #48](https://github.com/arach/openscout/issues/48).

## Guiding Principle

Optimize for simplicity first.

For users, OpenScout Mesh should feel like one stable place to point their phone
and web clients. For us, the first implementation should reuse transport paths
that already work well enough and leave room to grow into deeper Iroh
infrastructure later.

## Goal

OpenScout Mesh should give users a batteries-included private agent mesh. A phone
or second machine should point at one stable OpenScout-controlled URL, discover
the user's reachable Scout nodes, then use the simplest available transport that
can safely reach the broker.

The product behavior is:

```text
sign in -> nodes appear -> tap a node -> broker state is reachable
```

Users should not need to know about Tailscale, Iroh, IP addresses, ports, or
relay topology.

## Architecture

Cloudflare is the safe public entrypoint. Tailscale and existing local-edge HTTP
paths are the initial data plane because they already work well enough to start.
Iroh is the next transport to add when we are ready to own more of the mesh
experience. The Scout broker remains the source of truth throughout.

```text
iPhone / web client
  -> Cloudflare Access
  -> mesh.openscout.app rendezvous Worker
  -> short-lived node presence
  -> Tailscale/local-edge or Cloudflare Tunnel fallback
  -> local Scout broker /v1/mesh/*
```

Cloudflare handles:

- human and service authentication
- a stable rendezvous URL
- short-lived node presence records
- optional Cloudflare Tunnel fallback for low-volume broker control traffic

Tailscale/local-edge handles the first practical transport:

- same-user device reachability that already works
- current broker HTTP and mesh forwarding endpoints
- a working bridge while users and the product learn the shape

Scout handles:

- node identity and mesh authority
- conversations, messages, invocations, flights, and collaboration records
- durable journal and SQLite replay
- delivery planning and retries

Iroh later handles:

- OpenScout-owned endpoint identity
- QUIC streams
- NAT traversal
- encrypted relay fallback
- managed relay infrastructure if product demand justifies it

## First Protocol Boundary

The first stable protocol identifiers are:

- protocol version: `1`
- Iroh ALPN: `openscout/mesh/0`
- default rendezvous URL: `https://mesh.openscout.app`

Each broker publishes short-lived presence shaped like this. The first production
records can omit the `iroh` entrypoint and publish Tailscale/local-edge or
Cloudflare fallback URLs only.

```json
{
  "v": 1,
  "meshId": "openscout",
  "nodeId": "macbook-pro-openscout",
  "nodeName": "MacBook Pro",
  "issuedAt": 1777821400000,
  "expiresAt": 1777821460000,
  "entrypoints": [
    {
      "kind": "iroh",
      "endpointId": "hex-public-key",
      "endpointAddr": {},
      "alpn": "openscout/mesh/0",
      "bridgeProtocolVersion": 1
    },
    {
      "kind": "http",
      "url": "https://macbook-pro.tailnet-name.ts.net:4080"
    },
    {
      "kind": "cloudflare_tunnel",
      "url": "https://macbook-pro.mesh.openscout.app"
    }
  ]
}
```

The presence record is intentionally a directory record, not broker state. If
the Cloudflare Worker loses it, the node republishes. If a client cannot resolve
it, existing local and HTTP mesh paths continue to work.

## Sidecar Boundary

The Rust sidecar is named `openscout-iroh-bridge`.

It is intentionally not required for the first user-facing OpenScout Mesh
release. It can live behind the same presence contract and become another
entrypoint when ready.

Responsibilities for the first slice:

- persist one Iroh secret key per Scout node
- print its public endpoint identity as JSON for the broker
- bind an Iroh endpoint with ALPN `openscout/mesh/0`
- report its current `EndpointAddr` as JSON for rendezvous publication

Responsibilities after the first slice:

- accept incoming QUIC streams for `openscout/mesh/0`
- decode a framed JSON mesh bundle
- POST the bundle to the local broker's existing `/v1/mesh/*` endpoints
- dial a remote Iroh endpoint and send the same JSON bundle when the broker
  chooses Iroh forwarding

## Non-Goals

- Cloudflare does not store conversations, flights, messages, collaboration
  records, or replay state.
- Iroh does not replace Scout agent identity or broker authority.
- iOS does not embed Iroh until the sidecar path proves the protocol shape.
- The first user-facing implementation does not require Iroh at all.
- The first implementation does not operate a custom Iroh relay fleet.

## Decisions

- Do not operate an OpenScout Iroh relay fleet from day one. Start with
  Tailscale/local-edge and Cloudflare fallback, then add Iroh using default
  relays for experimentation before deciding whether managed relays are worth
  owning.
- Prefer the simplest Cloudflare fallback shape first: a single
  Worker-routed endpoint. Node subdomains can come later if routing,
  observability, or customer isolation needs justify them.
- Do not require a dedicated rendezvous signing key in the first slice. Use
  Cloudflare Access identity plus short TTL presence first. Add signed presence
  after the node identity model is stable enough to make signatures meaningful.
- Do not block the first mesh entrypoint on mobile wake. The first iPhone path
  should discover reachable nodes and clearly show offline/unreachable nodes.
  Push/wake can become the second reliability slice.
