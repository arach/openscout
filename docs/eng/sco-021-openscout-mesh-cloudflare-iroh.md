# SCO-021: OpenScout Mesh Cloudflare Rendezvous And Progressive Transport

## Status

Draft implementation plan for [issue #48](https://github.com/arach/openscout/issues/48).

## Guiding Principle

Optimize for simplicity first.

For users, OpenScout Mesh should feel like one stable place to point their phone
and web clients. For us, the work should land in phases that keep each boundary
small: first make brokers Iroh-compatible, then add the Cloudflare front door,
then route iOS through that front door.

## Goal

OpenScout Mesh should give users a batteries-included private agent mesh. The
first milestone is not mobile or Cloudflare. It is two or more desktop machines
running Iroh-compatible Scout brokers where Scout routing and the web app work
across machines.

The product behavior is:

```text
start brokers -> nodes appear -> Scout and web app work across machines
```

After that works, Cloudflare becomes the stable place to point phones and web
clients. Users should not need to know about Tailscale, Iroh, IP addresses,
ports, or relay topology.

## Architecture

The Scout broker remains the source of truth throughout. Iroh is introduced at
the broker-to-broker transport boundary first. Cloudflare is added later as a
safe public entrypoint and rendezvous layer. iOS comes after Cloudflare because
the phone needs one stable URL, not peer transport details.

```text
Phase 1:
Scout broker A
  -> openscout-iroh-bridge
  -> Iroh QUIC stream
  -> openscout-iroh-bridge
  -> Scout broker B /v1/mesh/*

Phase 2:
web / desktop client
  -> Cloudflare Access + mesh.openscout.app
  -> node directory / fallback route
  -> local Scout broker /v1/mesh/*

Phase 3:
iOS app
  -> Cloudflare Access + mesh.openscout.app
  -> node directory
  -> reachable broker entrypoint
```

Iroh handles in phase 1:

- OpenScout-owned endpoint identity
- QUIC streams for existing Scout mesh JSON bundles
- NAT traversal and encrypted relay fallback through default Iroh relays
- a future path away from requiring users to configure Tailscale

Tailscale remains useful during phase 1:

- it works well enough today
- it gives us a comparison path while the Iroh sidecar matures
- it can stay as an advanced/manual transport even after Iroh works

Scout handles:

- node identity and mesh authority
- conversations, messages, invocations, flights, and collaboration records
- durable journal and SQLite replay
- delivery planning and retries

Cloudflare handles in phase 2:

- human and service authentication
- a stable rendezvous URL
- short-lived node presence records
- optional Cloudflare Tunnel fallback for low-volume broker control traffic

The iOS app handles in phase 3:

- sign-in through the Cloudflare front door
- node discovery through the rendezvous URL
- choosing the reachable broker entrypoint returned by rendezvous

## Phases

### Phase 1: P2P Machines On Iroh-Compatible Broker

Goal: multiple desktop machines can run Scout, discover or exchange Iroh
entrypoints, route broker mesh bundles over Iroh, and keep the web app working.

Requirements:

- `openscout-iroh-bridge` persists one Iroh identity per Scout node.
- The bridge binds ALPN `openscout/mesh/0`.
- The broker can learn the local Iroh `EndpointAddr`.
- The broker can advertise an `iroh` entrypoint alongside existing `brokerUrl`
  and Tailscale/local-edge URLs.
- Existing `/v1/mesh/*` bundles can be forwarded through an Iroh stream.
- The receiving bridge POSTs the decoded bundle into its local broker.
- Existing HTTP/Tailscale mesh forwarding remains as fallback.
- The web app reads broker state normally; it does not need to know whether a
  peer bundle arrived over HTTP, Tailscale, or Iroh.

Exit criteria:

- Machine A can message/invoke an agent on Machine B over Iroh.
- Machine B can reply and the conversation/flight records replay correctly.
- The web app surfaces the remote node/agent state from broker records.
- Shutting off Iroh leaves existing HTTP/Tailscale forwarding usable.

Smoke-test loop before Cloudflare:

```bash
# On both machines:
bun scripts/mesh-iroh-smoke.mjs build-bridge
bun scripts/mesh-iroh-smoke.mjs run-broker

# In another shell on both machines:
bun scripts/mesh-iroh-smoke.mjs export-node --out node.json

# Copy each node.json to the other machine, then import the peer:
bun scripts/mesh-iroh-smoke.mjs import-node --file peer-node.json

# Confirm both local and peer records include kind: "iroh" entrypoints:
bun scripts/mesh-iroh-smoke.mjs inspect

# Send a real authority-forwarded broker message through the peer node record:
bun scripts/mesh-iroh-smoke.mjs send-message --peer-node-id <peer-node-id>

# On the peer, verify that the authority received the message:
bun scripts/mesh-iroh-smoke.mjs check-message --conversation-id <conversation-id>
```

Until phase 2 adds Cloudflare rendezvous, exchanging `node.json` manually is the
simple directory substitute for home/work tests where HTTP discovery is not
available. The transport under test is still Iroh: once each broker knows the
peer's Iroh entrypoint, mesh forwarding can use the sidecar and keep HTTP or
Tailscale only as fallback.

### Phase 2: Cloudflare Front Door

Goal: add a simple and safe public entrypoint without changing broker authority.

Requirements:

- `https://mesh.openscout.app` or equivalent is the stable rendezvous URL.
- Cloudflare Access authenticates humans and service clients.
- A Worker/Durable Object stores short-lived node presence records.
- Nodes publish reachable entrypoints with short TTLs.
- Clients can list the user's nodes through Cloudflare.
- Cloudflare Tunnel fallback exists for low-volume broker control paths.
- The first fallback shape is a single Worker-routed endpoint.

Exit criteria:

- A browser/client can authenticate through Cloudflare and list nodes.
- A client can reach a broker through a returned entrypoint.
- Broker state remains local; Cloudflare stores only directory/presence data.

### Phase 3: iOS App To Cloudflare

Goal: the iOS app points at the Cloudflare front door and gets a usable Scout
entrypoint without QR codes, IPs, or Tailscale setup as the primary UX.

Requirements:

- iOS signs in through the Cloudflare-protected rendezvous URL.
- iOS fetches authorized nodes and their entrypoints.
- iOS chooses a reachable broker entrypoint and uses existing mobile broker
  surfaces.
- Offline/unreachable nodes are shown clearly.
- Push/wake can be added after the first discover-and-connect path works.

Exit criteria:

- Fresh iOS install can sign in, see desktop Scout nodes, and open one.
- Existing mobile session, activity, inbox, and approval flows work through the
  selected entrypoint.
- No user-facing setup mentions Iroh, Tailscale, IPs, ports, or relays.

## First Protocol Boundary

The first stable protocol identifiers are:

- protocol version: `1`
- Iroh ALPN: `openscout/mesh/0`
- default rendezvous URL: `https://mesh.openscout.app`

Each broker publishes short-lived presence shaped like this. Phase 1 can exchange
this locally or through existing broker discovery. Phase 2 publishes it through
Cloudflare.

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
release to iOS, but it is required for phase 1 because phase 1 proves
Iroh-compatible broker-to-broker transport before Cloudflare and iOS enter the
path.

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
- iOS does not embed Iroh in these phases.
- The first implementation does not operate a custom Iroh relay fleet.
- Phase 1 does not require Cloudflare.
- Phase 2 does not require iOS.
- Phase 3 does not require a custom Iroh relay fleet.

## Decisions

- Do not operate an OpenScout Iroh relay fleet from day one. Start Iroh with
  default relays and keep Tailscale/local-edge as fallback while deciding
  whether managed relays are worth owning.
- Prefer the simplest Cloudflare fallback shape first: a single
  Worker-routed endpoint. Node subdomains can come later if routing,
  observability, or customer isolation needs justify them.
- Do not require a dedicated rendezvous signing key in the first slice. Use
  Cloudflare Access identity plus short TTL presence first. Add signed presence
  after the node identity model is stable enough to make signatures meaningful.
- Do not block the first mesh entrypoint on mobile wake. The first iPhone path
  should discover reachable nodes and clearly show offline/unreachable nodes.
  Push/wake can become the second reliability slice.
