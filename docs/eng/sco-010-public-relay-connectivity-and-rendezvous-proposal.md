# SCO-010: Public Relay Connectivity and Rendezvous

## Status

Proposed.

## Proposal ID

`sco-010`

## Intent

Define an optional public relay and rendezvous layer for OpenScout that removes
the current requirement for private-network-style connectivity on both the Mac
and the mobile device.

The primary target is not "replace the broker with cloud state."

The primary target is:

- make Scout mobile connectivity work over the public Internet
- keep the broker as the canonical local-first source of truth
- avoid depending on anything outside Scout's own connectivity story
- keep the deployment affordable enough to be the default path
- support both Scout-hosted and BYOK custom-domain deployments

This proposal is about replacing the current private-network-dependent mobile
path with a Scout-owned relay and rendezvous fabric. Mesh connectivity between
brokers is a secondary beneficiary, not the first milestone.

## Problem

OpenScout's current mobile path is functional, but its baseline assumptions are
too restrictive.

Today the model leans on:

- private-network reachability as the first machine-liveness check
- network-local names and certificates in the pairing path
- local bridge and relay assumptions that are easiest when both sides share
  the same private network

That creates four product problems.

1. **Mobile access depends on outside software.**
   A user effectively needs Scout plus a private-network dependency rather than
   Scout alone.
2. **The current path is harder to explain and support.**
   "Install Scout, then install and configure a private-network tool on both
   sides" is not the right default story for a consumer-grade mobile companion.
3. **The connectivity model is not Scout-owned enough.**
   Pairing trust, relay connectivity, and machine reachability are partially
   expressed through another product's addressing model.
4. **Scout does not yet have a clean hosted-vs-BYOK story.**
   There is no first-class way to say:
   - use Scout-managed connectivity
   - or bring your own domain, relay address, and tokens

The problem is not that the private-network layer is bad.

The problem is that it is doing too much of the product work for a feature that
should feel native to Scout.

## Existing Constraints

OpenScout already has important rules that this proposal must preserve:

- the broker is the canonical writer for local state
- mesh authority stays broker-owned
- pairing trust is separate from transport health
- mobile and desktop are surfaces over the same control plane

This proposal must not quietly turn Scout into a hosted database or a hosted
agent runtime.

## Decision

OpenScout SHOULD add an optional **public relay connectivity layer** as the
preferred non-private-network mobile path.

That layer SHOULD provide:

- relay and rendezvous for mobile-to-broker connectivity
- durable pairing and session metadata
- public Internet reachability without inbound port exposure
- optional broker-to-broker forwarding later

That layer MUST NOT become:

- the source of truth for conversations, work items, invocations, or flights
- the canonical broker database
- the owner of mesh authority decisions
- the owner of end-to-end message semantics

The architectural rule is:

- the broker remains local and canonical
- the relay layer is connectivity fabric
- end-to-end trust remains Scout-owned
- the relay layer is transport and rendezvous infrastructure, not product truth

## Why Durable Coordination Units

Durable coordination units are a plausible fit for this problem because they
combine:

- globally addressable named coordinators
- durable local storage
- single-coordinator synchronization
- WebSocket server support
- idle hibernation for low cost
- alarms for lease expiry and cleanup

That combination maps surprisingly well to:

- pairing rooms
- per-node relay mailboxes
- presence registries
- lightweight offline delivery buffers
- connection and token lease cleanup

The important caveat is equally clear:

durable coordination units are coordination primitives, not replacements for
OpenScout's broker database or durable collaboration model.

## Design Principles

1. Cloud connectivity is optional, but first-class when enabled.
2. The broker remains the canonical store.
3. The relay should forward sealed envelopes whenever possible.
4. The mobile experience should work with Scout alone.
5. A Scout-hosted default and a BYOK mode should share one protocol.
6. Public Internet reachability should not require inbound ports on the Mac.
7. Costs must stay low enough that idle paired devices are cheap.
8. Mesh authority must remain broker-owned.

## Goals

- remove the default requirement for private-network software on both sides
- make mobile pairing and reconnect work through Scout-owned connectivity
- support a Scout-hosted affordable default
- support BYOK custom addresses, domains, and tokens
- preserve end-to-end encrypted broker/mobile traffic
- keep cloud state narrow and connectivity-oriented
- create a path to optional cloud-assisted broker mesh later

## Non-Goals

- replacing the local broker database with relay storage
- migrating conversations or work records into the relay layer
- requiring the relay layer for local-only users
- implementing push notifications as part of the first connectivity milestone
- replacing end-to-end Scout trust with relay identity
- making every mesh operation cloud-dependent

## Terminology

| Term | Meaning |
|---|---|
| **Connectivity layer** | Scout-owned relay and rendezvous infrastructure |
| **Relay mailbox** | A durable coordinator that accepts broker and mobile connections for a given node or pairing scope |
| **Pairing room** | A short-lived coordination unit used during pairing and bootstrap |
| **Hosted mode** | Scout-managed deployment used by default |
| **BYOK mode** | User-supplied address, domain, or token deployment using the same protocol |

## Proposed Architecture

### 1. Pairing Room Coordinator

Use a short-lived coordinator per pairing room.

Responsibilities:

- accept mobile bootstrap connection
- accept broker bootstrap connection
- coordinate QR-code room membership
- enforce pairing token or invitation validity
- relay handshake messages
- expire unused rooms automatically

This replaces the assumption that pairing works best because both ends share a
private network.

### 2. Broker Mailbox Coordinator

Use one coordinator per broker node or pairing principal.

Responsibilities:

- maintain a broker-facing outbound WebSocket from the Mac
- accept one or more mobile device WebSockets
- relay encrypted RPC and event envelopes
- keep minimal presence metadata
- buffer short-lived undelivered messages if policy allows
- expire stale connection leases with alarms

The key product benefit is that the Mac only needs an outbound connection to
the relay fabric. No inbound port exposure or private-network reachability is
required.

### 3. Optional Registry Coordinator

For later phases, a narrow registry coordinator can track:

- which node IDs are currently connected
- which relay mailbox to use for a node
- short-lived presence and lease state

This can help broker discovery and remote forwarding later, but it should not be
required for the first mobile milestone.

## Security Model

The safest model is still end-to-end Scout trust over an untrusted relay.

Recommended rules:

- broker and mobile payloads remain Noise-encrypted end to end
- relay coordinators only see routing metadata plus opaque ciphertext whenever
  possible
- pairing rooms use signed invite tokens with expiry
- broker mailbox attachment requires broker-issued auth
- device registration and revocation remain broker-owned records

The relay should be able to forward traffic without becoming the semantic or
cryptographic source of truth.

## Hosted and BYOK Modes

SCO-010 should explicitly support two deployment modes.

### Hosted Mode

Scout runs the relay deployment for the user.

What the user experiences:

- Scout account or install-linked setup
- no private-network requirement
- default Scout relay address
- broker and mobile get Scout-issued tokens

This is the simplest story and should be the preferred default if pricing is
acceptable.

### BYOK Mode

The user supplies:

- custom address or domain
- account-level deployment details handled by Scout tooling
- token or secret material for the deployment

What matters is not whether the user literally writes config by hand. What
matters is that Scout can point at:

- custom addresses
- custom domains
- custom tokens or secrets

without changing the wire protocol.

This BYOK mode is especially important for:

- teams that want their own hosting account
- users who want their own vanity domain
- privacy-sensitive or enterprise installs

## Authentication and Token Model

The minimum viable model should include:

- pairing invite token with short TTL
- broker session token for mailbox attachment
- device token for mobile reconnect
- optional scoped admin token for BYOK provisioning

Recommended properties:

- all tokens are revocable
- pairing invites are one-time or short-lived
- reconnect tokens are device-bound when possible
- hosted and BYOK deployments use the same token semantics

## Cost Model

The design should be explicitly cost-aware.

Durable coordination units are attractive here because:

- WebSocket hibernation reduces idle compute cost
- one coordinator can handle many clients for a narrow scope
- alarms can handle expiry and cleanup without always-on processes

Cost discipline rules:

- keep coordinators narrow in scope
- keep canonical state local
- store only the minimum relay metadata in durable storage
- avoid large offline buffers or transcript storage in the cloud path

The affordability target should be:

- low enough for Scout-hosted default mobile connectivity
- simple enough to estimate for BYOK users

## Relationship To Existing Mobile Health Model

This proposal changes the baseline assumptions in
`docs/mobile-bridge-health-and-keep-alive.md`.

Current baseline:

- private-network reachability is the first machine-liveness check

SCO-010 direction:

- Scout relay mailbox reachability becomes the first remote connectivity check
- direct local or LAN reachability may still be preferred when available
- private-network transport becomes optional, not the product baseline

That means health evidence should eventually distinguish:

- broker connected to relay mailbox
- mobile connected to relay mailbox
- end-to-end broker RPC healthy
- local direct path available

instead of assuming private-network reachability first.

## Relationship To Pairing Runtime

The current pairing runtime already has the right broad shape:

- relay client
- QR payload
- Noise transport
- bridge RPC and event relay

SCO-010 does not throw that away.

It gives it a first-party public transport target that Scout can own.

Recommended implementation direction:

- keep the current pairing protocol concepts
- replace the relay server assumption with a public relay fabric backed by
  durable coordination units
- preserve the bridge and mobile encrypted transport

## Mesh Implications

The primary milestone is mobile.

However, the same connectivity layer could later help with:

- broker presence discovery
- remote broker forwarding without private-network dependencies
- cross-machine direct messaging when both brokers keep outbound mailbox
  connections open

Important guardrail:

Relay-assisted mesh MUST remain an alternative transport for broker-owned mesh
semantics, not a new authority system.

## Rollout Phases

### Phase 1: Public Mobile Relay

- pairing rooms in durable coordination units
- broker mailbox coordinator
- mobile reconnect through the relay fabric
- hosted mode first

Success means:

- mobile can pair and reconnect over the public Internet
- no private-network requirement on either side
- local broker remains canonical

### Phase 2: BYOK

- custom address and domain support
- custom token or secret configuration
- Scout tooling for pointing desktop and mobile at a BYOK deployment

Success means:

- same mobile flow works against hosted or BYOK endpoints

### Phase 3: Health and Delivery Integration

- update mobile health model to use mailbox connectivity
- add better lease, expiry, and reconnect diagnostics
- optionally add narrow offline buffering

### Phase 4: Optional Cloud-Assisted Mesh

- broker presence registry
- broker-to-broker forwarding through relay paths when desired
- keep private-network and manual seeds as alternative transports

## Risks

- This weakens the purity of the current "everything runs locally" story.
- Public relay dependence becomes real even if optional.
- Hosted mode introduces service operations, abuse prevention, and billing
  concerns.
- Durable coordination units are excellent for coordination, but poor
  boundaries here could tempt us to move too much broker state into the cloud
  path.
- Mobile background limits still exist; this does not magically solve all
  terminated-app delivery needs.

## Open Questions

- Should hosted mode require a Scout account, or can install-linked anonymous
  provisioning work well enough?
- What routing metadata must the relay see, and what can remain fully opaque?
- How much offline buffering should mailbox coordinators provide, if any?
- Should BYOK tooling be "bring your own domain and token" only, or full
  deployment and bootstrap automation?
- At what point should the architecture docs stop saying Scout is "not a cloud
  service" and instead say it is local-first with optional public connectivity?

## Summary

OpenScout's current mobile path depends too much on private-network plumbing for
something that should feel native to Scout.

SCO-010 proposes a narrower and more product-native alternative:

- Scout relay fabric as the connectivity layer
- Scout broker remains canonical and local-first
- hosted mode for the simple default
- BYOK mode for custom addresses, domains, and tokens

That gives Scout a path to "works with Scout alone" mobile connectivity without
quietly turning the product into a hosted control plane.
