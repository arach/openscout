# SCO-021: OpenScout Mesh Cloudflare Rendezvous And Iroh Transport

## Status

Draft implementation plan for [issue #48](https://github.com/arach/openscout/issues/48).

## Goal

OpenScout Mesh should give users a batteries-included private agent mesh. A phone
or second machine should point at one stable OpenScout-controlled URL, discover
the user's reachable Scout nodes, then use peer-to-peer encrypted transport when
available.

The product behavior is:

```text
sign in -> nodes appear -> tap a node -> broker state is reachable
```

Users should not need to know about Iroh, Tailscale, IP addresses, ports, or
relay topology.

## Architecture

Cloudflare is the safe public entrypoint. Iroh is the mesh data plane. The Scout
broker remains the source of truth.

```text
iPhone / web client
  -> Cloudflare Access
  -> mesh.openscout.app rendezvous Worker
  -> signed node presence
  -> Iroh endpoint dial
  -> remote openscout-iroh-bridge
  -> local Scout broker /v1/mesh/*
```

Cloudflare handles:

- human and service authentication
- a stable rendezvous URL
- short-lived node presence records
- optional Cloudflare Tunnel fallback for low-volume control traffic

Iroh handles:

- endpoint identity
- QUIC streams
- NAT traversal
- encrypted relay fallback

Scout handles:

- node identity and mesh authority
- conversations, messages, invocations, flights, and collaboration records
- durable journal and SQLite replay
- delivery planning and retries

## First Protocol Boundary

The first stable protocol identifiers are:

- protocol version: `1`
- Iroh ALPN: `openscout/mesh/0`
- default rendezvous URL: `https://mesh.openscout.app`

Each broker publishes short-lived presence shaped like:

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
- The first implementation does not require a custom Iroh relay fleet.

## Open Decisions

- Whether managed OpenScout plans should use default Iroh relays initially or
  operate an OpenScout relay fleet from day one.
- Whether Cloudflare Tunnel fallback should use node subdomains or a single
  Worker-routed endpoint.
- Which key signs node presence: Scout node key, Iroh endpoint key, or a
  dedicated rendezvous signing key.
- What mobile wake/push path is required before this becomes the default iPhone
  entrypoint.
