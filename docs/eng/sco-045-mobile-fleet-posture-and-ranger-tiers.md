# SCO-045: Mobile Fleet Posture and Ranger Tiers

## Status

Proposed.

## Proposal ID

`sco-045`

## Intent

Reframe the iOS Scout app from "remote control for one paired Mac" to
"remote surface for a personal fleet." Introduce a cross-node inbox, a
Ranger surface as the conversational consumer of fleet state, and a
hosted Ranger tier (`oscout.net`) that runs Ranger off-device so the
fleet keeps thinking when the user's laptop sleeps.

## Context

OpenScout already persists N paired primaries on iOS, but the runtime
is single-primary in practice. A review of the current code surfaces
the gap:

- `ConnectionManager` holds exactly one socket, one
  `BridgeConnectionInfo`, one `SecureTransport` at a time
  (`apps/ios/Scout/Services/ConnectionManager.swift:699,706`).
- Switching primaries is destructive:
  `activatePrimary(publicKeyHex:)` tears down the socket and calls
  `sessionStore.clearAll()` + `inboxStore.clear()` before reconnecting
  (`ConnectionManager.swift:1529-1547`). No drain, no per-node cache.
- Discovery surfaces all visible nodes including ones already paired;
  re-pairing dedups by public key but there is no cross-node feed,
  search, or notification surface.
- Push registration is per-bridge; Mac B cannot notify the phone while
  the active socket is to Mac A.
- "Forget Primary" in `SettingsView.swift:147-149` only acts on the
  *active* primary — stale entries linger.

The data layer is multi-primary. The runtime is firmly single-primary.

## Mobile use cases

The mobile surface is *not* a full-power IDE replacement. The shape of
real usage is:

1. **Check in on ongoing work** — "what's happening with refactor-X?"
2. **Quick terminal jump** — attach to a specific running session.
3. **Triage notifications** — review what wants attention.
4. **Spin up an agent for a quick chat** — fire a one-shot question or
   start a small session.
5. **Ask Ranger** — meta/concierge questions that don't belong to any
   single agent. "Remind me what's going on with XYZ."
   *(builds on [[project_scout_assistant_ios]])*

Four of five want an **aggregate-across-nodes** surface. Only (2)
wants targeted node routing — and even then, the user typically wants
to *find* the session before attaching, which is itself a cross-node
query.

## Decision

OpenScout SHOULD restructure the iOS app around three layers:

### 1. Fleet Inbox (cross-node, free)

A passive, pull-on-demand aggregation of state across every paired
primary, consistent with [[project_mesh_presence_pull_not_push]] and
[[project_thread_residency]]. The inbox is the home surface; the
active socket is an implementation detail.

- All paired primaries contribute to one inbox view, scoped per-node
  in the data model but presented unified in the UI.
- Push notifications register per bridge and route into the unified
  inbox.
- "Forget" works on any non-active primary, not just the active one.
- Switching primaries no longer wipes `SessionStore`/`InboxStore`.
  Per-node partitions persist; the active socket is just which one
  the phone is *currently subscribed to* for live updates.

### 2. Ranger on iOS (conversational concierge)

Ranger is the conversational consumer of the fleet inbox. The phone's
default "ask anything" surface, distinct from per-agent threads.

- Fire-and-forget Q&A — "anything important?", "what's blocked?",
  "what did Codex finish today?"
- Can answer about state across nodes; can route a request to a
  specific agent or spin one up.
- Sits alongside per-agent sessions, not inside them. The web
  `RangerPanel` is the conceptual sibling
  (`packages/web/client/scout/ranger/RangerPanel.tsx`).

### 3. Ranger deployment tiers

Ranger needs a home. Three tiers; the architecture must support all
three behind the same iOS UI:

- **Pinned-home Ranger (free).** Ranger runs on whichever Mac the
  user picks as Ranger's host. Simple, works today. Fails when that
  Mac sleeps or goes offline.
- **`oscout.net` Pro (paid).** Ranger runs on Cloudflare-hosted
  openscout infrastructure. Fans out to the user's paired primaries
  via the broker. Survives any one node going dark. Push aggregates
  there. Out-of-network access works without a Mac being awake. This
  is the upsell.
- **On-device (future).** Small LLM on the phone for offline /
  privacy-sensitive Q&A. Limited context; complements rather than
  replaces the above.

The Pro tier is the architectural forcing function: Ranger must be
*addressable as a node* in the mesh, not assumed to be co-located
with an agent's working tree. This pairs with
[[project_session_discovery_opt_in]] — sessions become broker-routable
through deliberate opt-in, so the cloud Ranger reaches them via the
same path any other mesh client would.

## Value framing

Free tier: solo-Mac users get a working remote.
Pro tier (`oscout.net`): *"your fleet keeps thinking when your
laptop sleeps."* Concrete pain (Macs sleep, phone is the only
always-on device the user owns), concrete fix (off-device always-on
Ranger), aligned with mobile-first interaction patterns.

The segmentation is clean: solo-Mac users don't need Pro. Multi-Mac
users (and anyone who wants Ranger to keep working away from home)
get a real pain point solved.

## Out of scope

- Specific UI for the cross-node inbox layout.
- iOS view controller changes for Ranger surfacing.
- The on-device LLM tier — listed for completeness; not part of v1.
- Billing, account, and `oscout.net` provisioning details.
- Changes to broker/bridge code beyond what is implied by Ranger
  needing to be a non-co-located mesh participant.

## Open questions

- **Default home for free-tier Ranger.** Is it implicit (most-recent
  primary), explicit (user picks), or sticky-last-online? Each has
  failure modes when the picked Mac sleeps.
- **State partitioning.** Do per-node `SessionStore` partitions live
  in memory only, or on disk? On-disk persistence enables offline
  inbox review but raises encryption-at-rest questions.
- **Identity for cloud Ranger.** Does the Pro Ranger pair with each
  primary as its own bridge client, or does it sit *behind* the
  user's existing pairings via delegated trust? The latter is
  cleaner UX but a harder security story.
- **Push fan-in.** APNS topic per bridge vs. a single topic owned by
  Pro Ranger that re-publishes — affects whether free-tier users can
  get aggregated push without Pro.
- **Naming.** "Ranger" vs "Scout" for the meta-agent on mobile. The
  web uses Ranger; the phone marketing is "Scout." Picking one is a
  product question, not a technical one.

## Related

- [[project_scout_assistant_ios]] — always-available Scout assistant
  on iOS for help, search, session creation. SCO-045 is the
  architectural shape that lets that exist.
- [[project_thread_residency]] — cross-node thread model.
- [[project_mesh_presence_pull_not_push]] — presence model.
- [[project_session_discovery_opt_in]] — broker-routable sessions.
- SCO-035 (Ranger Chip Unification) — Ranger surface on desktop.
- SCO-037 (Ranger Brief Pipeline) — Ranger's content production
  pipeline; cloud Ranger reuses it.
