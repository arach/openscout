# SCO-006: Integration Layer and Boundary

## Status

Proposed.

## Proposal ID

`sco-006`

## Intent

Define a stable architectural home for external platform integrations in
OpenScout without making any one platform framework, SDK, or adapter central to
the product.

SCO-006 is meant to sit on top of the existing broker-first architecture and
the address/binding work described in SCO-004. It does not introduce a second
canonical routing or persistence model. It names where external integrations
should live and how they should connect to the broker-owned core.

The named concepts are:

- **Integrations** as the product-facing feature area
- **Integration layer** as the implementation area where platform adapters live
- **Integration boundary** as the normalized contract between integrations and
  the OpenScout core

This proposal is intentionally modest.

It does not require immediate Telegram migration, immediate Talkie work, or a
large refactor. It exists to give future integration work one consistent place
to land.

## Problem

OpenScout already behaves like a broker-first system with external transports at
the edge, but the integration story is not named or formalized enough.

That causes three problems:

1. Platform work looks bespoke even when the architecture is trying to do
   something general.
2. It is harder to evaluate external frameworks such as Chat SDK because there
   is no explicit rule for where they are allowed to sit.
3. New integrations such as Discord, Slack, Google Chat, WhatsApp, GitHub,
   Linear, or Talkie-adjacent surfaces risk leaking platform-specific models
   into the broker, runtime, or product surface.

The missing piece is not "more bridge code." The missing piece is an explicit
integration architecture:

- where platform SDKs belong
- what is allowed to cross inward
- what the core continues to own
- how future integrations can be added without rewriting the product around
  them

## Decision

OpenScout SHOULD formalize an **integration layer** around all external
platforms and an **integration boundary** between that layer and the core.

The architectural rule is:

- integrations live in the integration layer
- the core owns canonical actors, conversations, invocations, and delivery
  semantics
- all traffic between those two sides crosses the integration boundary

The policy rule is equally important:

- adapters MAY classify and normalize external activity
- adapters MUST NOT become the source of truth for authorization, wake policy,
  routing policy, or invocation policy
- the broker/core MUST make the canonical decision about whether an inbound
  event becomes a message, an invocation, a state change, or no-op

The authority rule is also explicit:

- integration endpoints MUST be activated only on the broker-authorized
  authority node for that integration or binding
- non-authoritative nodes MUST remain passive or forward through the
  authoritative broker path
- third-party frameworks and SDKs MUST NOT decide ingress or egress ownership
  for the mesh

The integration layer MAY use third-party frameworks, SDKs, or hosted adapter
systems, but those dependencies MUST remain peripheral. They MUST NOT become the
source of truth for:

- canonical conversation identity
- canonical actor identity
- delivery lifecycle
- invocation semantics
- broker persistence
- mesh authority or ownership rules

Existing Telegram code MAY remain where it is until there is implementation
pressure to move it. This proposal does not require immediate migration.

Talkie-related work MAY adopt the same architecture later, but Talkie is not a
driver for immediate implementation in SCO-006.

## Reading This Doc

This is a working design note, not a standards document.

Words like `must`, `should`, and `may` are here to make the guardrails clear,
not to turn SCO-006 into standards prose. When the wording feels a little
strong, read it as:

- what we want to protect
- what we want to avoid
- where we do and do not want future integration work to go

## Design Principles

1. The core stays broker-first.
2. Platform SDKs are edge details, not product semantics.
3. The integration boundary is normalized, but not lossy.
4. Platform-specific payloads MUST NOT leak into core types.
5. Broker-owned policy stays in the core.
6. Outbound rendering is as important as inbound normalization.
7. Framework adoption is optional and replaceable.
8. Migration should be incremental and low-risk.
9. Harness transports and live session trace adapters remain outside the
   integration layer.

## Goals

- name the architectural home for external integrations
- protect the broker/runtime model from platform-specific semantics
- define where future adapters for Telegram, Discord, Slack, Google Chat,
  WhatsApp, GitHub, Linear, and related surfaces should live
- make external frameworks safe to evaluate at the periphery
- preserve one canonical OpenScout model inside the integration boundary
- support incremental migration from bespoke adapters to shared integration
  infrastructure

## Non-Goals

- immediate migration of Telegram into a new package or namespace
- immediate adoption of Chat SDK or any other framework
- replacement of the broker with an external bot framework data model
- making integrations the center of OpenScout architecture
- introducing a second canonical conversation store
- forcing every external system to support the same interaction model
- moving harness transports, runtime adapters, or trace observers into the
  integration layer

## Terminology

| Term | Meaning |
|---|---|
| **Integrations** | The product and engineering area for external systems such as Telegram, Discord, Slack, WhatsApp, GitHub, Linear, or Talkie-adjacent surfaces |
| **Integration layer** | The implementation area that contains platform adapters, SDK wrappers, webhook/polling handlers, renderers, and platform-specific capability code |
| **Integration boundary** | The normalized contract between the integration layer and the OpenScout core |
| **Adapter** | A platform-specific implementation that translates between an external API and the integration boundary |
| **Capability** | A platform-specific feature such as mentions, commands, actions, cards, reactions, attachments, DMs, or streaming |
| **Integration event** | A transient integration-owned inbound envelope produced by an adapter before the broker reduces it to canonical protocol records |
| **Integration intent** | A transient integration-owned outbound envelope produced by core-side logic before an adapter renders it to a platform-specific API |

## Core Responsibilities

The OpenScout core MUST remain the source of truth for:

- canonical actor identity
- canonical conversation identity
- invocation and wake semantics
- delivery planning and state
- durable persistence
- mesh ownership and routing policy
- authorization and policy decisions for whether an inbound integration event
  becomes a message, invocation, update, or ignored input
- canonical identity, alias, and binding creation or mutation

The core SHOULD be able to operate without any specific integration framework.

## Integration Layer Responsibilities

The integration layer SHOULD own:

- webhook and polling setup
- request verification and auth
- platform SDK interaction
- raw event intake
- idempotency and de-duplication
- capability detection
- outbound rendering into platform-native messages, actions, or cards
- platform-specific retry, rate-limit, and error handling
- translation from external payloads into integration-boundary events and
  intents

For first-party integrations, the integration layer MUST:

- verify inbound requests when the platform supports signatures, tokens, or
  equivalent verification primitives
- preserve stable external IDs when the platform provides them
- provide de-duplication hooks or equivalent replay-safe correlation inputs
- translate inbound and outbound traffic through the integration boundary
- defer identity, binding, routing, wake, and authorization decisions to the
  broker/core
- render an explicit fallback when the target platform lacks a richer
  capability such as cards, actions, or edits

The integration layer MAY preserve raw payloads for debugging and audit
purposes, but those payloads SHOULD live in integration-owned logs, blobs, or
debug stores.

Core records MUST NOT embed raw platform payload bodies as canonical metadata.
If the core needs debug correlation, it SHOULD store only an opaque reference,
hash, or external event ID.

Raw payload references are correlation-only. Core code MUST NOT dereference raw
payload stores for routing, authorization, canonical replay, or policy.

## Integration Boundary

The integration boundary MUST present neutral concepts to the core.

Those concepts are broader than chat alone and SHOULD cover both conversational
and work-tracking surfaces.

Examples include:

- inbound message or mention
- command
- action
- reaction
- thread or DM context
- resource created, commented, labeled, assigned, reviewed, or status-changed
- outbound post, edit, typing signal, reaction, action response, or work-item
  update intent

The integration boundary SHOULD carry:

- stable external IDs
- actor information
- conversation or thread references
- structured content and attachment references
- capability flags
- opaque raw payload references when needed for debugging

The integration boundary MUST NOT expose platform SDK classes or platform-native
payload schemas as required core dependencies.

The integration boundary is an edge contract, not a second canonical protocol.
It SHOULD translate into existing broker/protocol concepts such as bindings,
messages, invocations, and delivery intents rather than replacing them.

Reusable boundary shapes MUST either remain adapter-local and transient, or be
formalized in the protocol package through a separate proposal. The integration
boundary MUST NOT quietly become a shadow protocol.

## Boundary Envelope Minimums

Any adapter-local `integration event` SHOULD include at minimum:

| Field | Requirement | Notes |
|---|---|---|
| `platform` | MUST | Stable adapter or platform identifier |
| `kind` | MUST | Event taxonomy entry such as `message.created` or `resource.assigned` |
| `externalEventId` | SHOULD | Stable source event ID when available |
| `actorRef` | SHOULD | External actor reference plus provenance |
| `subjectRef` | MUST | The external subject or resource this event is about |
| `containerRef` | MAY | Channel, thread, workspace, repo, project, or ticket container |
| `occurredAt` | MUST | Source event time when known, ingest time otherwise |
| `payload` or `delta` | MUST | Normalized content or change description |
| `capabilities` | MAY | Capability hints from the source surface |
| `rawRef` | MAY | Correlation-only debug reference |

Any adapter-local `integration intent` SHOULD include at minimum:

| Field | Requirement | Notes |
|---|---|---|
| `platform` | MUST | Target adapter or platform identifier |
| `kind` | MUST | Intent taxonomy entry such as `message.post` or `resource.comment` |
| `targetRef` | MUST | External target to render against |
| `actorRef` | MAY | External actor to present as sender when supported |
| `subjectRef` | MAY | External subject or resource this intent modifies |
| `content` or `delta` | MUST | Renderable content or requested change |
| `replyToRef` | MAY | External reply or thread linkage |
| `idempotencyKey` | SHOULD | Stable replay-safe key when available |

For conversational surfaces, `subjectRef` or `containerRef` MAY refer to a
conversation, thread, DM, or channel.

For work-tracking surfaces, `subjectRef` SHOULD refer to the external resource
such as an issue, pull request, ticket, or review target.

## Inbound Model

Inbound platform traffic SHOULD be translated by an adapter into an
`integration event` before entering the core.

That integration event SHOULD be sufficient to:

- submit external address references and provenance for core-side identity or
  binding resolution
- post a broker message
- describe a resource change when the source is not primarily conversational
- let the broker/core decide whether to trigger an invocation or wake path

Platform-specific event distinctions MAY remain in integration metadata, but the
core should not need to understand Telegram updates, Discord interaction
objects, or Slack block action payloads directly.

Adapters MUST NOT mint canonical identities, aliases, or conversation bindings
on their own. They may only submit external references and provenance to the
broker-owned identity and binding registries.

Until a separate proposal defines first-class durable work-item protocol types,
non-chat integrations MUST reduce resource-oriented events into existing
broker/protocol concepts rather than introducing a parallel durable event model.

## Outbound Model

Outbound OpenScout activity SHOULD cross the integration boundary as an
`integration intent`, not as platform-specific rendering instructions.

The integration layer SHOULD decide how to realize that intent for the target
platform:

- rich action/card UX where supported
- plain text fallback where not
- DM fallback where required
- platform-specific streaming or post-edit behavior where available
- work-item comment, assignment, or status update where the target is not a
  chat surface

This keeps capability mismatches local to the adapter.

## Delivery and Failure Semantics

Integration ingress SHOULD be assumed to be at-least-once unless a platform
proves otherwise.

Adapters MUST assume:

- inbound events may be duplicated
- inbound events may arrive out of order
- outbound requests may partially fail or time out after the remote side has
  already applied them

When the platform provides stable event or object IDs, adapters MUST surface
them.

Core-side handling of integration-derived actions MUST be replay-safe and
idempotent against the available external IDs and local provenance.

If an adapter cannot provide stable source IDs, it MUST document the fallback
correlation strategy used for deduplication and replay safety.

## Framework Position

External frameworks such as Chat SDK MAY be used inside the integration layer
when they reduce edge implementation cost.

However:

- the framework MUST remain optional
- the framework MUST NOT define OpenScout's canonical data model
- the framework MUST NOT become a required dependency of the broker core
- the framework MUST be replaceable per platform or per adapter

The evaluation criterion is practical:

Does the framework reduce edge complexity without distorting the core model?

If not, it should be rejected or isolated further.

Chat SDK is a useful reference point here because it already has a multi-surface
adapter model, but SCO-006 is not a proposal to build OpenScout around Chat SDK
or any equivalent framework. The main value is learning from adapter shape and
edge ergonomics, not adopting a second center of gravity.

## Near-Term Case Studies

The two most useful case studies for SCO-006 right now are Talkie and
Telegram.

### Talkie

Talkie is a good first-party case study because it is concrete, close to the
team, and likely to share some integration semantics with chat-style surfaces
without forcing us into a full framework adoption.

The near-term bias for Talkie should be light:

- treat Talkie as an integration-layer adapter when it behaves like an external
  product surface
- keep harness/runtime/trace concerns out of the integration layer
- map Talkie-originated activity into adapter-local `integration event`
  envelopes, then reduce those into broker-owned records
- map outbound broker activity into adapter-local `integration intent`
  envelopes, then render those back into Talkie
- keep Talkie-specific affordances or richer semantics in adapter-owned
  metadata unless and until they clearly deserve protocol support

In other words:

- use Talkie as a practical test of the integration boundary
- do not use Talkie as a reason to widen the core model too early

### Telegram

Telegram is the obvious existing case study because there is already Telegram
transport-specific code in the repo.

The near-term bias for Telegram should also be light:

- rehome Telegram over time into the integration layer only when that work is
  useful and low-risk
- preserve the current owner-node, polling/webhook, and broker-routing
  assumptions
- avoid forcing Telegram into a Chat SDK-shaped model just because that model
  exists
- prefer a small independent Telegram adapter first, then compare that shape to
  what Chat SDK or similar frameworks would buy us later

That makes Telegram a good reality check:

- if the integration boundary helps Telegram without adding churn, the boundary
  is earning its keep
- if Telegram becomes more awkward after rehoming, the layer is too abstract

## Rough Scope: Talkie Then Telegram

If we want to start with Talkie and then do Telegram, the cleanest path is a
small boundary-prep slice, a light Talkie pilot, and then a careful Telegram
rehome.

This is the rough cut, not a locked project plan.

### Slice 0: Boundary Prep

Before either adapter moves, we should do a small amount of setup work:

- pick the local home for integration adapters and adapter-local boundary
  helpers
- define the smallest useful `integration event` and `integration intent`
  shapes close to the adapter code, not in the shared protocol package
- make one golden-path test shape for inbound and outbound adapter behavior
- keep this as naming and file layout work, not a core rewrite

Rough size: small. Think days, not weeks.

### Slice 1: Talkie Pilot

In this repo, Talkie does not already show up as a concrete integration
adapter. Most `talkie` references today are agent/project examples or report
compatibility, not an existing edge adapter.

That makes Talkie a good first case study, but it also means the first slice is
partly greenfield.

The goal should stay narrow:

- choose one inbound path that matters
- choose one outbound path that matters
- translate those through adapter-local boundary envelopes into the existing
  broker flow
- keep richer Talkie semantics in adapter-owned metadata unless there is an
  obvious reason to promote them
- avoid adding shared abstractions until the first thin slice is real

What we should not do in this slice:

- no Chat SDK dependency
- no shared multi-platform package yet
- no protocol expansion just to make Talkie feel elegant
- no pulling harness/runtime/trace concerns into the integration layer

Rough size: medium, with product-shape ambiguity. If the first Talkie surface is
simple, this is probably on the order of a few focused days to about a week.

### Slice 2: Telegram Rehome

Telegram is the second slice because it is already partly real in the repo.
There is existing Telegram-specific behavior around binding IDs, outbound
filtering, owner-node election, runtime state, and settings.

That means the Telegram work is less ambiguous than Talkie, but more
regression-sensitive.

The safe scope is:

- preserve current Telegram behavior and stable IDs
- rehome Telegram behind integration-layer naming and boundaries without
  changing the broker-owned policy story
- keep the current owner-node rule and polling/webhook assumptions
- keep the current settings model intact while the adapter moves
- add parity checks around inbound normalization and outbound delivery rules as
  part of the move

What we should not do in this slice:

- no Telegram rewrite
- no forced Chat SDK-shaped model
- no change to authority ownership just because the code moved
- no new canonical protocol types

Rough size: medium. The work is conceptually straightforward, but it deserves
more regression attention than the Talkie pilot.

### Rough Sequence

1. Do the small boundary-prep slice.
2. Build one end-to-end Talkie thin slice.
3. Review what that taught us about the boundary.
4. Rehome Telegram with the smallest behavior-preserving move that still makes
   the new structure real.
5. Re-evaluate whether a framework such as Chat SDK buys us anything at the
   edge after both case studies exist.

### What This First Pass Does Not Need

- a shared cross-platform integration package
- broad support for every external platform
- a new durable protocol for work-item systems
- migration of harness transports, runtime adapters, or trace observers
- a formal framework decision

If the first Talkie slice and the Telegram rehome both feel lighter after this
structure is in place, SCO-006 is paying for itself. If they feel heavier, we
should shrink the layer, not defend it.

## Migration Posture

SCO-006 is a direction-setting proposal, not an implementation plan.

The preferred migration posture is incremental:

1. Name the architecture first.
2. Keep existing Telegram behavior stable.
3. Any new integration work MUST describe its local mapping in integration-layer
   and integration-boundary terms from day one, even if no shared package is
   extracted yet.
4. Move or rehome Telegram only when that work pays for itself.
5. Evaluate third-party frameworks only at the adapter edge.

The default bias SHOULD be toward avoiding churn unless the new structure makes
the next integration materially easier.

## Initial Implications

If future work follows SCO-006, the expected long-term shape is:

- Telegram becomes one integration adapter, not a special case
- Discord, Slack, Google Chat, WhatsApp, GitHub, and Linear can be evaluated
  against the same integration boundary
- Talkie-related external surfaces can plug into the same layer when useful
- the broker continues to own the durable story

The practical one-line rule is:

**Integrations live in the integration layer and talk to the core only through
the integration boundary.**

## Minimum Adapter Conformance

Any first-party integration adapter SHOULD meet this minimum bar:

1. Verify inbound requests when the platform supports verification.
2. Preserve stable external IDs whenever the platform provides them.
3. Provide replay-safe de-duplication inputs.
4. Translate through adapter-local `integration event` and `integration intent`
   envelopes instead of leaking platform schemas inward.
5. Defer identity, binding, routing, authorization, and wake policy to the
   broker/core.
6. Keep raw payload bodies outside canonical core records.
7. Support one end-to-end inbound path and one end-to-end outbound path with
   tests or equivalent validation.
