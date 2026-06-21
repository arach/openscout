# SCO-070: Scout-Initiated Cardless Sessions

## Status

Reviewed (codex sibling, 2026-06-20) — revised. The coupling and identity
sections below incorporate that review; remaining work is the resolver
de-agent-typing (seam 3).

## Proposal ID

`sco-070`

## Date

2026-06-20

## Intent

Make a **session** a first-class thing that belongs to a **project path**, and
demote the **agent card** to an optional *alias* for a particular setup. A
"scout-initiated cardless session" is a new conversation started against a
project path that mints no card — conceptually `project.sessions.append(session)`.

## Problem

Starting "a new conversation in a project" is broken today. The Scout composer's
Project target posts `/api/sessions` with `target: { kind: "project_path" }`,
which routes through the broker's **existing-agent resolver**
(`resolveProjectPathTarget`, `scout-dispatcher.ts:285`). That resolver collects
every non-stale agent whose `projectRoot` matches, ranks them, and returns
`ambiguous` when the top candidates tie. For a real repo this is fatal:

```
POST /api/sessions { target: { projectPath: "/Users/arach/dev/openscout" } }
→ 409 could not start session: /Users/arach/dev/openscout
  targetDiagnostic.state = "ambiguous"  (13 candidates)
```

The request *also* carries the new-session intent
(`projectAgent: { persistence: "one_time" }`, `execution.session: "new"`), but
that intent is dropped before resolution: `resolveWithImplicitProjectAgent`
(`broker-delivery-routing.ts:195`) is a stub that ignores `projectAgent` and
`execution`, and `shouldMaterializeProjectAgent` (`:90`) hard-returns `false` by
design ("project paths are route selectors; delivery must not synthesize agent
cards").

The deeper issue is **ownership direction**. The model today is:

```
agent (card) → endpoint → session
```

So every conversation needs an agent actor, every session hangs off an endpoint,
and an endpoint requires an `agentId`. "New session for a project, no reuse, no
card" is therefore *not expressible* — a conversation has nothing to put in
`actorId`. The ambiguity error is just that gap surfacing.

## Model

Invert the ownership. The organizing root is the **project path**; a session
attaches to it directly:

```
projectRoot → [session, session, …]
```

- **Session** is the unit. Its *stable* identity is the **broker-minted
  `endpoint.id`** — assigned synchronously at start, globally namespaced, and
  durable across resume churn. The harness session id (`threadId` /
  `externalSessionId`) is an *alias*, not the identity: it's minted
  asynchronously on first response (`ensureClaudeStreamJsonAgentOnline` returns
  `sessionId: string | null`) and isn't unique across harnesses/cwds.
  `endpointSessionAliasValues` (`broker-endpoint-selection.ts:189`) already
  treats `endpoint.id` + `sessionId` + metadata keys as interchangeable aliases,
  so addressing by either works once the endpoint exists. No card required.
- **Card** is an *alias*: a named preset (harness + model + branch + instructions
  + stable identity) you *may* stamp a session with. Using a card configures and
  names a session; not using one is the default. The project membership happens
  regardless.
- **Cardless session start** = create a session in the project dir, give it a
  session-kind identity, bind a conversation to it, and append it to the
  project's list. Nothing to disambiguate.

A card stops being a prerequisite and becomes provenance: a session records
`viaCard: <cardId>` when one was used, and "reuse a card" simply means "append
another session to the project, stamped with that preset."

## What already supports this

Three of the four layers do not fight the model:

1. **The harness primitive is already cardless.**
   `ensureClaudeStreamJsonAgentOnline` (`claude-stream-json.ts:1121`) and
   `ensureCodexAppServerAgentOnline` (`codex-app-server.ts:2501`) take only
   `cwd + systemPrompt + ids` and return a `sessionId` / `threadId`. The card is
   minted *above* them in `startLocalAgent` → `writeRelayAgentOverrides`
   (`local-agents.ts:~3936`). Cardless = call the primitive, skip that layer.

2. **Conversations don't require an agent — `operator` is the precedent.**
   `actorId` is a free `ScoutId` string; the operator participates as
   `kind: "person"`, not an agent (`broker-conversation-service.ts:~48`). The
   only hard rule is that an actor row exists (`messages.actor_id` →
   `actors(id)`, `schema.ts:171`). A session can be its own actor
   (`kind: "session"`, `id = sessionId`) exactly as the operator is its own
   non-agent actor.

3. **The broker already routes by session.** `session_id` is a real
   `ScoutRouteTarget` (`scout-dispatch.ts`), and `resolveSessionTarget`
   (`scout-dispatcher.ts:327`) already matches endpoints by `sessionId` /
   `externalSessionId` / `threadId` (`endpointSessionAliasValues`). Session
   addressing exists.

## The one coupling

The coupling is **not** the required `AgentEndpoint.agentId` field — it's that
**session resolution is agent-typed end to end.** `resolveSessionTarget`
(`scout-dispatcher.ts:332`) does:

```ts
.map((endpoint) => snapshot.agents[endpoint.agentId])
.filter((agent): agent is AgentDefinition => Boolean(agent)) // drops unresolved
```

It returns `BrokerLabelResolution { agent: AgentDefinition }`, and the entire
downstream dispatch consumes an *agent*, not an endpoint. So the tempting move —
`agentId = sessionId` with "no card written" — **breaks routing**:
`snapshot.agents[sessionId]` is `undefined`, the endpoint is filtered out, and the
session is unroutable. That doesn't remove the coupling; it relocates it into a
dangling reference.

There are only two honest ways to route a cardless session:

- **(a)** register a synthetic `AgentDefinition` under `id = sessionId` — a card
  in all but name. This contradicts the proposal; reject.
- **(b)** teach `resolveSessionTarget` to return an **endpoint/session
  resolution** that needs no `AgentDefinition`, and widen the resolved-target
  type + dispatch consumers to accept it.

**(b) is the necessary work.** Whether `endpoint.agentId` stays required (holding
`sessionId` as an opaque marker) or becomes optional is secondary; the
unavoidable change is *de-agent-typing the session resolution path*. Do not ship
expecting a field assignment alone to route. (`buildManagedLocalSessionAgent`,
`broker-managed-session-helpers.ts:196`, is the (a) shape — a full card — and is
exactly what we're avoiding.)

## Seams (the actual work)

1. **Cardless session-start primitive.** A start path that calls the harness
   primitive directly and *skips* `writeRelayAgentOverrides` / relay-agent
   registration. Returns `{ endpointId, sessionId? }` — the broker-minted
   `endpointId` is the identity; `sessionId`/`threadId` fills in later as an alias
   when the harness emits it.
2. **Session-as-actor.** On start, `upsertActor({ id: <endpointId>, kind:
   "session", … })` (mirrors `ensureBrokerActor` for operator). Requires adding
   `"session"` to `ActorKind` (`common.ts`) — and this is a **fan-out**: every
   `switch` on `ActorKind` (roster, feed projections, attention, permissions)
   must handle the new kind or it silently drops session actors. Grep `ActorKind`
   before landing.
3. **De-agent-type session resolution** (the real work — see "The one coupling").
   `resolveSessionTarget` must return an endpoint/session resolution that carries
   no `AgentDefinition`; the resolved-target union and dispatch consumers widen to
   accept it. Also add a **staleness filter** to the session path — today only the
   project path ranks by recency, so a dead session's endpoint still resolves.
4. **Project grouping.** "The project's sessions" = endpoints/sessions filtered
   by `projectRoot` / `cwd`. No new `projects` table needed; `projectRoot` is the
   key endpoints already carry — but reuse the resolver's existing `projectRoot`
   normalization (trailing slash / realpath / case) plus staleness, or you get
   split groups and dead sessions in the list.

The new-session-for-project flow then stops calling the existing-agent resolver
entirely: it appends a fresh session to the project. Ambiguity becomes
structurally impossible.

## Seam 3 design (reviewed)

The de-agent-typing of session resolution, grounded against the live code.

**Union change** (`scout-dispatcher.ts:33`) — add one variant; cardless never
goes ambiguous (it collapses to the preferred endpoint):

```ts
export interface ResolvedSessionTarget {
  sessionId: string;        // what the caller addressed
  actorId: ScoutId;         // session-kind actor id (== endpoint.agentId marker)
  endpoint: AgentEndpoint;  // live endpoint to dispatch through
  label: string;
  nodeId: ScoutId;          // endpoint.nodeId — cross-node forwarding key
}
export type BrokerLabelResolution =
  | { kind: "resolved"; agent: AgentDefinition }
  | { kind: "resolved_session"; session: ResolvedSessionTarget }   // NEW
  | { kind: "ambiguous"; label: string; candidates: AgentDefinition[] }
  | { kind: "unparseable"; label: string }
  | { kind: "unknown"; label: string };
```

`InvocationResolution` (`broker-delivery-routing.ts:21`) spreads
`BrokerLabelResolution`, so it inherits the member with no edit.

**`resolveSessionTarget` rewrite** (`scout-dispatcher.ts:327-349`) — card path
unchanged; cardless path resolves to the endpoint itself:

```ts
const endpoints = Object.values(snapshot.endpoints)
  .filter((e) => endpointMatchesTargetSession(e, sessionId))
  .filter((e) => !isStaleLocalEndpoint(snapshot, e));            // staleness filter
if (endpoints.length === 0) return { kind: "unknown", label: `session:${sessionId}` };
const carded = /* endpoints whose agentId resolves to an AgentDefinition */;
if (carded.length === 1) return { kind: "resolved", agent: carded[0]! };
if (carded.length > 1) return { kind: "ambiguous", label: …, candidates: carded };
// Cardless: no AgentDefinition -> resolve to the endpoint/session itself.
const endpoint = endpoints.sort(byLocalEndpointPreferenceRank)[0]!; // helper :209
return { kind: "resolved_session", session: { sessionId, actorId: endpoint.agentId,
  endpoint, nodeId: endpoint.nodeId, label: … } };
```

**Consumers** — one normalizer, then mechanical swaps:

```ts
type DeliveryTarget = { actorId: ScoutId; label: string; nodeId?: string;
  endpoint?: AgentEndpoint; agent?: AgentDefinition };
function deliveryTargetOf(r, snapshot): DeliveryTarget { /* agent | session */ }
```

Across the entire dispatch flow the **only genuinely agent-typed dependency is
`describeUnavailableDeliveryTarget`** (`broker-delivery-acceptance-service.ts:496`)
— it needs a session branch that checks `endpoint.state` instead of agent state.
Every other site (`:500,:527,:535,:545,:555-572,:597,:610,:636,:678,:688`, and
`broker-invocation-dispatch-service.ts:181,:186`) is id-string or label-string
keyed and works once fed `target.actorId` / `target.label`.

**Staleness gotcha (verified, mandatory).** `isStaleLocalEndpoint`
(`broker-endpoint-selection.ts:168-176`) short-circuits on
`endpoint.metadata.staleLocalRegistration`, then falls to
`isInactiveLocalAgent(snapshot.agents[endpoint.agentId])` — and
`isInactiveLocalAgent(undefined) === false`. So a cardless endpoint **never
auto-stales**; its liveness rides entirely on `staleLocalRegistration`. The GC
reaper (see Lifecycle) **must** stamp `endpoint.metadata.staleLocalRegistration =
true` (or flip `endpoint.state`) on harness exit, or dead cardless sessions
resolve forever. This is the seam-3 ↔ lifecycle coupling — wire them together.

**`agentId` required vs optional.** Ship **Option A**: keep `agentId` required,
set `agentId = sessionId` as an opaque marker plus a `kind: "session"` actor row.
Zero protocol/schema change; ~12 `snapshot.agents[endpoint.agentId]` deref sites
must tolerate a miss (the `resolved_session` variant is what makes them safe).
Option B (make `agentId` optional) is a ~192-site migration + nullable column —
later hardening. Flipping to B changes nothing in the above except the marker
source (`actorId: endpoint.agentId` → `endpoint.id`).

## Card-as-alias contract

- A card is a named preset: `{ name, harness, model, branch?, instructions?,
  persistence }`, resolvable to a stable selector/identity.
- Starting a session *with* a card applies the preset and stamps
  `session.metadata.viaCard = cardId`.
- Starting a session *without* a card uses the project defaults (harness/model
  from the composer or project config) and stamps nothing.
- Cards remain fully routable (`@card-name`) and persistent; cardless sessions
  are routable only by `session_id` and are not advertised for discovery
  (consistent with opt-in session discovery).

## Non-goals

- Not removing cards. Cards stay for persistent, named, discoverable agents.
- Not changing the operator model.
- Not a broker resolver rewrite — `resolveProjectPathTarget` keeps its
  existing-agent semantics for callers that *want* to reuse; new sessions just
  don't go through it.

## Lifecycle / GC (constraint, not optional)

`pruneOneTimeLocalAgentCards` (`local-agents.ts:2071`) prunes **cards** —
cardless sessions have none, so that reaper never touches them. This needs a
**parallel endpoint/session reaper** keyed on harness liveness + TTL.

GC must be **soft**: `messages.actor_id` FK-references `actors(id)`, so deleting
a session actor orphans transcript history. The rule: **session actors are
permanent (provenance)** — mark them stopped/stale and reap only the
endpoint/liveness, never the actor row.

## Cross-node (known gap, not an open question)

Bare `session_id` routing only works on the **owning node**:
`resolveSessionTarget` scans the local `snapshot.endpoints`; a remote broker has
no such endpoint and returns `unknown`. There is no session-keyed mesh
forwarding today (`broker-mesh-forwarding-service` has no `sessionId` path). This
also collides with the card-as-alias rule that cardless sessions are
*not advertised for discovery*: un-advertised + node-local = unreachable from
another node.

If a cardless session must be reachable cross-node (operator on another device),
address it as **`(homeNodeId-or-projectRoot, sessionId)`** and forward to the
owner — like thread residency — not bare `session_id`. That path is **unbuilt**;
it's a prerequisite for cross-device, not a someday-maybe.

## Discoverability

Routable-only-by-`session_id` + not-advertised means that once the starting
surface loses the id, the session is effectively unfindable. The composer must
**capture/surface the `session_id` (deep link)** and the session must reliably
land under its project view (seam 4), so **project grouping is the recovery
path**.

## Open questions

1. Do cardless sessions appear in roster/fleet views, or only under their project
   until promoted? (Promotion = "save as card".)
2. Default TTL for the cardless-session reaper, and whether liveness alone (no
   TTL) is enough.
