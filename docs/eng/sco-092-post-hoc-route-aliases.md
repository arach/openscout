# SCO-092: Post-hoc Route Aliases For Existing Agents And Sessions

## Status

Implemented.

## Proposal ID

`sco-092`

## Date

2026-07-23

## Summary

Scout should let an authorized operator or running agent attach a short,
mutable route alias to an existing durable agent identity or to one exact live
session:

```bash
scout alias set review --to scope.main.arts-mac-mini-local
scout alias set patch --to session:019eff52-9347-7470-ba5c-6bfe99d8dd83
scout ask --to review "take a fresh pass"
scout ask --to patch "continue in that exact context"
```

An alias is a broker-owned route pointer. It is not an agent card, does not add
an agent to the fleet, and does not copy identity or session state. The broker
resolves it once, at dispatch acceptance, to a canonical agent or session
target. Repointing or unsetting an alias changes only future resolutions. It
never rewrites a prior message, conversation, invocation, flight, work item, or
session association.

This proposal adds first-class create, list, resolve, repoint, and unset
operations; defines project and host scoping; and makes route-alias state
visible without conflating it with the configured-agent inventory.

## Motivation

Scout's configured-agent inventory already carries the identity needed for
correct routing: friendly name, durable id, project/workspace, harness and
model constraints, backing endpoints and sessions, configured/manual state,
and authority node. Those identities can still be cumbersome to type, and an
exact session id is intentionally opaque.

Creating another card to obtain a short name is the wrong abstraction:

- it invents a second durable identity for the same participant;
- it changes fleet counts and ownership surfaces;
- it implies fresh-work card semantics even when the intent is exact-session
  continuation; and
- it makes later reassignment look like identity mutation rather than routing
  indirection.

The missing primitive is a named, mutable pointer over existing routable
objects.

## Current-state findings

The repository contains three related mechanisms, none of which satisfies the
requested product contract:

1. `AgentIdentityCandidate.aliases` and agent selectors are identity-resolution
   inputs derived from configured/registered agent data. They are not a
   user-managed, post-hoc binding with ownership, revision, or lifecycle.
2. `runtime_session_aliases` is an automatically projected lookup index for
   observed endpoint/session identifiers. Its rows may be many-to-many, expire
   with runtime-session retention, and are rewritten as endpoints are observed.
   It is not operator intent and must not become the user-managed alias table.
3. `target:<handle>` / `⌖handle` currently parses as `target_handle` and resolves
   session-actor handles heuristically. It has no first-class set, repoint,
   ownership, or audit contract.

[SCO-073](./sco-073-session-alias-lookup.md) proposed provisional aliases minted
for cardless sessions. SCO-092 supersedes SCO-073 for the user-managed alias
surface and generalizes the target to durable agents as well as exact sessions.
SCO-073's automated session-name/indexing concern may remain implemented by
`runtime_session_aliases`; such observed aliases are compatibility inputs, not
route-alias bindings.

Schema changes must follow [SCO-075](./sco-075-drizzle-managed-migrations.md):
the declarative Drizzle model is the authoring authority, generated migrations
are checked in, and the raw schema mirror and parity gates move in lockstep.

## Normative language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative.

## Terminology

| Term | Meaning |
| --- | --- |
| **Agent** | A durable, addressable identity admitted by configuration, a card, or explicit registration. |
| **Session** | One exact harness conversation/process/thread, routed through an endpoint. |
| **Card** | Durable identity and execution settings. A card is not an alias and does not imply a live session. |
| **Route alias** | A mutable, scoped pointer to one canonical agent id or one canonical runtime session id. |
| **Observed session alias** | A provider/endpoint-derived identifier in `runtime_session_aliases`; not user-managed intent. |
| **Alias binding** | The current persisted route-alias row, including target, scope, owner, state, and revision. |
| **Alias revision** | A monotonically increasing version used to prove which target a dispatch resolved. |
| **Scope** | The owner realm, project/workspace, and host/node namespace in which an alias name is unique. |

## Goals

- Add a short name to an existing agent or exact live session after creation.
- Resolve a bare alias inside `send`, `ask`, and compatible follow-up routes
  without a client-side discovery preflight.
- Make repointing atomic and future-only.
- Infer current project and local host when that scope is unambiguous.
- Require explicit scope for cross-project or cross-host use.
- Preserve the existing card-versus-session behavior after dereferencing.
- Keep alias ownership, authorization, expiry, and audit state broker-owned.
- Show aliases in agent/session inventory without counting them as agents.

## Non-goals

- Minting, cloning, renaming, or promoting an agent card.
- Turning aliases into identities, actors, conversations, or sessions.
- Making an alias sticky to every historical conversation that once used it.
- Importing provider transcripts or rewriting Scout history.
- Fuzzy dispatch, implicit cross-owner routing, or a global mesh-wide namespace.
- Replacing exact `agent:<id>`, `session:<id>`, `ref:<id>`, or project/capability
  routing.
- Claiming hardened multi-tenant or globally consistent alias semantics. The
  current product posture remains high-trust local developer pilots.

## Product decisions

### 1. Alias targets

A route alias MUST target exactly one of:

- `agent`: a durable Scout `AgentDefinition.id`; or
- `session`: an exact broker-known runtime session id, with its authority node
  and harness recorded.

An alias MUST NOT target another alias. Preventing alias chains avoids cycles,
hidden multi-hop authorization, and surprising repoint propagation.

The target is canonicalized before the binding is written. A human-friendly
agent selector or provider-native session id may be accepted as input, but the
stored target is the resolved Scout id plus enough immutable display snapshot
data to explain the binding after the target retires.

### 2. Cards remain distinct

Setting an alias MUST NOT:

- create or update an agent card;
- change an agent selector, display name, configured/manual state, or fleet
  admission;
- start, attach, wake, or fork a session merely to validate the binding; or
- increase configured-agent counts.

The inventory may render `review → scope.main…` under the existing agent, but
`review` is not a second agent row.

### 3. Dispatch-time dereference

The broker resolves an alias once while accepting a `send` or `ask`. The
accepted delivery/invocation stores:

- the requested alias text;
- alias binding id and revision;
- resolved target kind and canonical target id;
- resolved authority node; and
- resolution timestamp.

All subsequent work for that accepted request uses the pinned canonical target.
A concurrent repoint after acceptance affects the next request, not the request
already accepted.

Historical messages, tasks, flights, work items, and conversations MUST retain
their original canonical target and alias-resolution proof. Inventory views may
show that an alias now points elsewhere, but must not relabel history as if the
new target had handled old work.

### 4. Agent and session semantics survive dereference

Dereferencing does not invent a third execution behavior:

| Alias target | `ask` behavior | `send` behavior |
| --- | --- | --- |
| Durable agent | Same as an exact agent/card target: fresh-work semantics, with the broker free to choose/start a compatible session. | Same as an exact agent DM/update target. |
| Exact session | Same as `targetSessionId` / `session:<id>`: continue only that harness context. | Deliver through that exact session endpoint; do not silently start or select a different session. |

Harness mismatch, terminal session, unavailable agent, and wake policy are
diagnosed after dereference by the existing routing layers. The alias layer
must not weaken those checks.

### 5. Follow-up semantics

- A follow-up that again names the alias resolves its current binding and is
  therefore affected by a repoint.
- A follow-up using a returned `session:<id>`, `ref`, `flightId`,
  `conversationId`, or `workId` follows that durable handle and MUST NOT
  re-resolve the alias.
- A threaded reply remains in its existing conversation/reply context even if
  the original request used an alias that has since moved.

This is the boundary between a mutable pointer and durable coordination
history.

## Alias names and reserved words

V1 names use an intentionally narrow ASCII grammar:

```text
^[a-z][a-z0-9-]{0,62}$
```

Input is lowercased and surrounding whitespace is removed before validation.
Dots and colons are excluded because they already carry identity and route
qualifier meaning. Unicode display labels may be stored separately, but are not
routing keys in v1.

The broker MUST reject reserved product or route words, including at least:

```text
scout, openscout, scoutbot, operator, shared, broadcast,
agent, alias, target, session, ref, id, project, channel
```

It must also reject any value reserved by the active broker for a system actor,
product inbox, or route prefix. Validation is server-side; CLI validation is
only early feedback.

## Scope and qualification

### Scope key

An active alias is unique by:

```text
(owner_realm_id, scope_project_key, scope_node_id, normalized_alias)
```

- `owner_realm_id` is the authenticated local/mesh owner realm, not a free-form
  actor-supplied value.
- `scope_project_key` is a broker-canonical project identity derived from the
  resolved project root. The normalized absolute root is stored for display
  and local lookup.
- `scope_node_id` is the host/node namespace where the alias is managed.

Aliases with the same name may exist in different projects or on different
hosts. There is no implicit global alias.

### Inference

For `alias set/list/resolve/repoint/unset`, omission of scope flags means:

1. infer the canonical project from the current working directory; and
2. use the current local broker node.

Inference succeeds only when the directory maps to one canonical project and
the current broker node is known. Otherwise the command fails with the
candidate projects/nodes and an exact retry using `--project` and/or `--host`.

Dispatch of a bare name uses the caller context captured by the broker:
current project plus local node. It MUST NOT search every project or remote host
and pick an apparently unique result. That behavior would become unstable as
inventory changes.

### Explicit qualification

Management commands accept:

```bash
--project <path-or-project-id>
--host <node-id-or-unique-node-name>
```

Protocol/API routes carry structured `projectKey`/`projectRoot` and `nodeId`
fields. Human dispatch surfaces MUST also accept an explicit alias target form;
the parser may render a typed qualifier, but it must produce this structure:

```ts
{
  kind: "route_alias",
  alias: "review",
  scope: { projectKey?: string, projectRoot?: string, nodeId?: string }
}
```

Recommended CLI spelling:

```bash
scout ask --to alias:review --alias-project ~/dev/talkie --alias-host mini "continue"
```

`scout alias resolve` returns a copyable fully qualified selector and the stable
binding id so clients do not have to invent a string grammar. Exact binding-id
addressing MAY be exposed as `alias-id:<id>` for automation.

## Collisions and resolution precedence

### Binding collisions

Only one active binding may occupy a scope key. `alias set` is create-only by
default and fails with `alias_exists` if the name is active. Mutation is
explicit:

```bash
scout alias repoint review --to <new-target>
scout alias set review --to <new-target> --replace   # convenience synonym
```

Repoint is atomic and increments `revision`. Automation SHOULD pass
`--if-revision <n>`; a mismatch fails with `revision_conflict` rather than
overwriting a concurrent change.

An alias may not be set when its bare name currently resolves as a native agent
name/selector/declared configuration alias in the same scope. The error names
the agent and suggests a different alias. There is no `--force-shadow` in v1.

If a later configuration change introduces a native agent name that collides
with an existing route alias, the binding remains stored but is marked
`shadowed` in projections. Bare resolution chooses the native agent. Explicit
`alias:<name>` or exact binding-id resolution still reaches the alias after
normal authorization checks, allowing the operator to inspect, repoint, rename,
or unset it safely.

### Dispatch precedence

For one structured or parsed target, the broker applies this order:

1. Exact typed routes: agent id, session id, binding/ref, project path, channel,
   or broadcast.
2. Explicit `alias:<name>` / `route_alias`: resolve the route-alias table only.
3. Bare native agent identity: exact durable agent id, selector, default
   selector, handle, or configured identity alias.
4. Bare route alias in the inferred project/node scope.
5. Legacy `target:<handle>` / `⌖handle` and observed session-handle fallback
   during compatibility migration.
6. Suggestions for similar targets, which are diagnostic only and never
   dispatched automatically.

Thus existing direct agent names retain precedence, while a bare non-colliding
alias still resolves at dispatch time as requested.

`target:<name>` and `⌖name` SHOULD first consult route aliases, then fall back to
their current session-handle behavior. Once telemetry shows no required legacy
fallbacks, a later proposal may make them display shorthands for route aliases.

## Failure behavior

Alias failures fail closed. The broker MUST NOT fall back to a similarly named
agent, create a card, spawn a project worker, or choose another session.

Stable diagnostic codes:

| Code | Meaning | Required remediation |
| --- | --- | --- |
| `invalid_alias` | Name or qualifier is malformed/reserved. | Show accepted grammar. |
| `alias_exists` | Active binding already occupies the scope. | Show target/revision and `repoint` command. |
| `unknown_alias` | No binding exists in the selected scope. | Show scope and scoped suggestions. |
| `ambiguous_alias_scope` | Project or host could not be inferred uniquely. | Show candidates and qualified retry. |
| `alias_inactive` | Binding was unset or expired. | Show status/time; suggest set or another target. |
| `alias_shadowed` | Explicit inspection found a native-name collision. | Explain bare-name precedence and explicit alias selector. |
| `alias_target_unavailable` | Durable agent exists but cannot currently route/wake. | Reuse existing agent availability diagnostics. |
| `alias_session_not_reachable` | Exact session reference exists but cannot be contacted. | Suggest exact resume/fork/start-fresh paths; never substitute. |
| `alias_session_terminal` | Harness/provider reports the exact session terminal. | Suggest repoint or unset. |
| `not_authorized` | Caller cannot read/manage alias or route to target. | Do not leak hidden target details. |
| `revision_conflict` | Conditional repoint/unset used a stale revision. | Return current revision and target if visible. |

Unknown and unauthorized responses should be indistinguishable when revealing
existence would cross an owner/visibility boundary.

## CLI contract

### Create or explicitly replace

```bash
scout alias set <name> --to <existing-agent-or-exact-session>
scout alias set <name> --to <target> --project <path> --host <node>
scout alias set <name> --to <target> --expires-in 8h
scout alias set <name> --to <target> --replace --if-revision 3
```

`--to` must resolve to one canonical existing target. Agent ambiguity fails
closed. Session input accepts broker session id and the existing exact native
session forms only when they resolve to one broker-known runtime session.

### Self-claim convenience

```bash
scout alias set patch --self
scout alias set reviewer --self-agent
```

- `--self` binds to the exact current Scout-attached harness session. It is the
  convenience path for a running agent that wants a callback handle.
- `--self-agent` binds to the current durable agent identity.
- Neither option may mint a card or session.
- `--self` fails when the host cannot prove the current session id, or when the
  session has not been attached/registered with Scout.
- A session actor may self-claim only its own exact session. An agent may
  self-claim only its own durable identity. Normal alias-management authority is
  still required to overwrite or unset an existing binding.

The success receipt is pointer-forward:

```text
alias patch → session:019eff52-… (codex, openscout, mini)
scope openscout · mini   revision 1   expires with session
```

It must not say that a new agent joined or was created.

### List

```bash
scout alias list
scout alias list --project ~/dev/openscout --host mini
scout alias list --target scope.main.arts-mac-mini-local
scout alias list --include-inactive --json
```

Default list output includes name, target kind/label/id, project, host, state,
revision, owner/creator where visible, updated time, and expiry. JSON returns
canonical ids and never relies only on display strings.

### Resolve

```bash
scout alias resolve patch
scout alias resolve patch --project ~/dev/openscout --host mini --json
```

Resolve is read-only and runs the same precedence/scope/authorization logic as
dispatch, but performs no wake or delivery. It reports both the binding and the
target's current routability. `resolved` and `available` are separate fields.

### Repoint

```bash
scout alias repoint patch --to session:<new-id>
scout alias repoint patch --to @reviewer --if-revision 4
```

Repoint updates the existing binding id in one broker transaction, increments
the revision, and appends an audit event containing old and new canonical
targets. It does not mutate outstanding work or conversations.

### Unset

```bash
scout alias unset patch
scout alias unset patch --if-revision 5
```

Unset is a soft revocation. It increments the revision, records actor/time, and
makes future resolution inactive immediately. Reusing the name creates a new
binding id by default; restoration of an old id is not a v1 operation.

## Protocol and API changes

### Shared protocol

Add protocol types equivalent to:

```ts
type RouteAliasTarget =
  | { kind: "agent"; agentId: ScoutId; nodeId: ScoutId }
  | {
      kind: "session";
      sessionId: ScoutId;
      agentId: ScoutId;
      endpointId: ScoutId;
      nodeId: ScoutId;
      harness: AgentHarness;
    };

type RouteAliasState = "active" | "unset" | "expired";

interface RouteAliasBinding {
  id: ScoutId;
  alias: string;
  displayAlias?: string;
  ownerRealmId: ScoutId;
  scopeProjectKey: string;
  scopeProjectRoot?: string;
  scopeNodeId: ScoutId;
  target: RouteAliasTarget;
  state: RouteAliasState;
  revision: number;
  createdByActorId: ScoutId;
  updatedByActorId: ScoutId;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  revokedAt?: number;
  metadata?: MetadataMap;
}
```

`ScoutRouteTargetKind` gains `route_alias`; do not overload `agent_label` or
`target_handle` internally after parsing. Dispatch results gain an optional
`aliasResolution` proof with binding id, revision, requested alias, scope, and
canonical target.

### Broker service and HTTP

The broker is the canonical writer. Add focused alias service/store boundaries
rather than embedding CRUD in the HTTP router:

```text
POST   /v1/aliases                 set
GET    /v1/aliases                 list/filter
POST   /v1/aliases/resolve         resolve without dispatch
PATCH  /v1/aliases/:id             repoint or update expiry
DELETE /v1/aliases/:id             soft-unset
GET    /v1/aliases/:id/history     authorized revision history
```

Mutation requests include caller context and optional `expectedRevision`.
Cross-node management requests are authenticated and forwarded to the scope
node's broker; clients do not write a remote projection directly.

`/v1/deliver`, `/v1/invocations`, broker command-boundary schemas, and the MCP
`send`/`ask` front doors accept `route_alias` and return alias-resolution proof
in receipts.

### MCP

Expose pro/integration tools aligned with the same broker service:

```text
aliases_set
aliases_list
aliases_resolve
aliases_repoint
aliases_unset
```

Ordinary `messages_send` and `ask` accept an alias target directly and resolve
server-side. Agents should not be required to call `aliases_resolve` before
every dispatch.

## Persistence model

### New table: `route_alias_bindings`

Use a dedicated table. Do not repurpose `runtime_session_aliases`, `agents`,
actor handles, or conversation bindings.

Recommended columns:

```text
id                       TEXT PRIMARY KEY
normalized_alias         TEXT NOT NULL
display_alias            TEXT
owner_realm_id           TEXT NOT NULL
scope_project_key        TEXT NOT NULL
scope_project_root       TEXT
scope_node_id            TEXT NOT NULL
target_kind              TEXT NOT NULL CHECK ('agent' | 'session')
target_agent_id          TEXT
target_session_id        TEXT
target_endpoint_id       TEXT
target_node_id           TEXT NOT NULL
target_harness           TEXT
target_snapshot_json     TEXT NOT NULL
state                    TEXT NOT NULL CHECK ('active' | 'unset' | 'expired')
revision                 INTEGER NOT NULL
created_by_actor_id      TEXT NOT NULL
updated_by_actor_id      TEXT NOT NULL
created_at               INTEGER NOT NULL
updated_at               INTEGER NOT NULL
expires_at               INTEGER
revoked_at               INTEGER
metadata_json            TEXT
```

Database checks enforce exactly one target shape:

- agent target: `target_agent_id` set and session/endpoint fields null;
- session target: session, agent, endpoint, node, and harness set.

Target foreign keys SHOULD NOT cascade-delete the binding. Retired agents and
garbage-collected sessions must leave an explainable inactive/broken pointer
and its immutable target snapshot. Referential validity is enforced on writes
and rechecked during resolution.

A partial unique index enforces one active binding per scope key. Supporting
indexes cover target agent, target session, owner/project/node listing, and
expiry sweep.

### Revision history

Every set, repoint, unset, automatic expiry, and administrative repair appends
an immutable `route_alias_revision` (or equivalent broker control event) in the
same transaction as the current-row update. It records:

- binding id and revision;
- operation;
- old and new target snapshots;
- actor and authority node;
- timestamp;
- optional reason; and
- request/correlation id.

This is alias audit history, not conversation history and not provider
transcript material.

### Lifetime and expiry

- Agent-target aliases are durable by default and survive broker restarts until
  explicitly unset or given an expiry.
- Session-target aliases are durable records but live-bound routes. By default
  they become inactive when the exact session is terminal or its runtime record
  reaches the existing retention/GC boundary. They do not float to another
  session for the same agent.
- `--expires-at` and `--expires-in` MAY shorten either lifetime. They may not
  extend a session alias beyond the underlying exact session's routable life.
- Temporary unreachability does not immediately delete or repoint a session
  alias. Resolution returns `session_not_reachable`; terminal/GC evidence moves
  it to `expired` through the broker-owned sweeper.
- Unset and expired rows remain queryable with `--include-inactive` according to
  the broker's normal control-record retention policy.

Expiry is enforced both lazily during resolution and eagerly by a bounded
sweeper. The first observer that detects expiry may submit the idempotent
broker command; clients never update the projection directly.

## Authorization and security

### Read and route

Resolving an alias is allowed only when the caller is authorized to:

1. see the alias's owner/project/node scope; and
2. route directly to the canonical target.

Aliases cannot be used to launder access to a hidden agent, remote host, or
session. A caller who loses direct access loses alias resolution access without
requiring the binding to be rewritten.

### Manage

Set, repoint, and unset require alias-management authority in the owner realm
and scope. In the current local-pilot posture, the authenticated local operator
has this authority. Remote operations require the same authenticated owner and
the destination broker's authorization; node reachability alone is
insufficient.

Self-claim is the narrow exception for agents:

- the broker must cryptographically or host-contextually bind the caller to the
  current actor/session;
- self-claim cannot select an arbitrary `--to` target;
- self-claim cannot replace another active binding without ordinary management
  authority; and
- revocation by the owner always wins.

### Input and disclosure controls

- Normalize before uniqueness and reserved-name checks.
- Use parameterized queries and bounded list/history pagination.
- Never accept owner, node authority, target actor, or current-session claims
  solely from message body text.
- Audit denied mutations without logging prompt bodies, provider transcripts,
  credentials, or unnecessary file paths.
- Redact target details in unauthorized and cross-owner unknown responses.
- Rate-limit mutation and remote-resolution endpoints consistently with other
  broker control-plane writes.

## Inventory and UI observability

### Agent inventory

An agent detail row/page shows active aliases targeting that agent as compact
pointer chips or an `Aliases` section. It must retain the agent's canonical
name as primary and show that each alias is a route pointer.

The top-level configured-agent count and roster contain the agent once. Alias
count may be shown separately.

### Session inventory

An exact session row shows active session-target aliases, expiry/state, and a
copyable canonical session id. Session aliases appear under Sessions or the
owning agent's session list, not as new agent cards.

### Alias inventory

Web and native surfaces SHOULD provide a filtered alias inventory with:

- alias and fully qualified scope;
- target kind, canonical id, friendly label, harness, project, and host;
- `active`, `shadowed`, `unreachable`, `terminal`, `expired`, or `unset`
  projection status;
- owner/creator and last updater when visible;
- revision, created/updated time, and expiry; and
- set/repoint/unset history.

`shadowed`, `unreachable`, and `terminal` are computed health/status overlays;
the stored binding state remains `active` until unset or expired.

`scout who --json` may embed aliases under their target agent/session. Human
`scout who` output SHOULD keep them secondary or behind an `Aliases` section so
they are not mistaken for fleet members.

Receipts, dispatch inspector, messages, invocations, and flights should expose
the alias-resolution proof. The normal UI may render `review → Hudson`; the
inspector retains binding id, revision, and canonical target.

## Migration and compatibility

1. Add the two alias tables/types through the SCO-075 Drizzle workflow,
   including raw-schema mirror, generated migration, version bump if required,
   and parity tests.
2. Do not automatically backfill user bindings from agent selector arrays,
   actor handles, `runtime_session_aliases`, or `target:<handle>` heuristics.
   Their ownership and collision semantics are not equivalent.
3. Keep current native agent-name resolution unchanged and ahead of bare route
   aliases.
4. Teach `target:<name>` / `⌖name` to consult route aliases before the legacy
   heuristic. Emit resolution provenance so fallback use can be measured.
5. Keep `runtime_session_aliases` as the observed runtime lookup index. Rename
   its UI label to `Observed identifiers` if users could confuse it with route
   aliases.
6. Existing messages, invocations, flights, work items, cards, sessions, and
   bindings require no rewrite.
7. If an operator wants to preserve a legacy session handle, provide an
   explicit preview/import command later; do not silently convert it on boot.

Rollback to a binary without the migration is governed by the existing schema
downgrade guard. The migration must not weaken that guard.

## Implementation seams

| Concern | Likely location | Required change |
| --- | --- | --- |
| Protocol route/types | `packages/protocol/src/scout-dispatch.ts` plus new alias types | Add `route_alias`, binding, scope, mutation, and resolution-proof types. |
| Parser/CLI options | `packages/protocol/src/scout-composer.ts`, `apps/desktop/src/cli` | Parse explicit alias target; add command family and scope/CAS options. |
| Schema/migrations | `packages/runtime/src/drizzle-schema.ts`, `packages/runtime/drizzle`, `packages/runtime/src/schema.ts` | Add current binding + revision history tables and indexes through SCO-075 workflow. |
| Store/service | `packages/runtime/src/broker-route-alias-store.ts`, `broker-route-alias-service.ts` (suggested) | Transactional CRUD, expiry, authorization hooks, and audit events. |
| Resolution | `packages/runtime/src/scout-dispatcher.ts`, delivery/invocation routing services | Apply precedence, scope inference, dereference once, and pin proof. |
| HTTP/MCP | broker router/service boundaries, `apps/desktop/src/core/mcp/scout-mcp.ts` | Management/read API plus alias-aware send/ask. |
| Inventory | web/native agent and session projections | Display pointers without changing fleet counts. |
| Observability | dispatch records, receipts, inspector | Persist/render binding id, revision, requested alias, and canonical target. |

Names above are guidance, not permission to re-grow composition roots. The
implementation should preserve the repository's focused broker-service
boundaries.

## Acceptance criteria

1. An authorized operator can bind a new alias to an existing durable agent
   without creating or modifying a card, actor, agent definition, or session.
2. An authorized operator can bind a new alias to one exact live session
   without creating a card or a replacement session.
3. `scout ask --to <bare-alias>` resolves in the current project/local-host
   scope at broker dispatch time.
4. Agent-target asks retain fresh-work agent/card semantics; session-target
   asks continue only the exact session.
5. `scout send` uses the same alias resolver and preserves agent-versus-session
   routing semantics.
6. Repoint is atomic, increments revision, and changes only requests accepted
   after the repoint transaction commits.
7. Prior messages, conversations, invocations, flights, work items, and session
   associations retain the original canonical target and alias revision.
8. Unset immediately prevents future resolution while preserving authorized
   audit/history reads.
9. Native direct agent names/selectors win over a bare alias. New conflicting
   alias creation is rejected; a later collision is visibly shadowed and still
   manageable through explicit alias addressing.
10. Same-name aliases in two projects or on two hosts never cross-resolve.
    Missing/ambiguous caller scope fails with qualified remediation.
11. Explicit project/host qualification resolves the intended cross-project or
    cross-host alias and requires authorization at the authoritative broker.
12. Unknown, inactive, expired, terminal-session, unavailable-target,
    unauthorized, and revision-conflict paths return stable, actionable
    diagnostics and never fall back to a different target.
13. Agent aliases survive broker restart by default. Session aliases never
    float to a replacement session and expire at terminal/GC lifecycle unless
    explicitly unset earlier.
14. `--self` binds only the provable current session; `--self-agent` binds only
    the provable current durable identity; neither mints an identity/session.
15. Agent and session inventories show aliases as pointers. Configured-agent
    counts are unchanged.
16. Receipts and inspectors expose requested alias, binding id/revision, scope,
    and resolved canonical target.
17. Existing direct agent, exact session, ref, project/capability, channel, and
    broadcast routes pass regression tests unchanged.
18. Existing `target:<handle>` / `⌖handle` continues to work through the
    documented compatibility order.

## Verification plan

### Protocol and parser tests

- Round-trip `route_alias` targets with inferred and explicit scope.
- Reject invalid/reserved/confusable route keys and alias-to-alias targets.
- Prove explicit `alias:<name>` differs from bare agent-label parsing.
- Preserve all existing composer target forms.

### Store and migration tests

- Virgin database, upgrade from the previous migration, migration-ledger
  seeding, raw-schema parity, checked-in migration parity, and downgrade guard.
- Partial uniqueness for active scope keys.
- One-of agent/session target checks.
- Transactional revision increments and append-only history.
- Conditional repoint/unset conflicts under concurrent writers.
- Lazy and eager expiry idempotence.
- Target deletion/GC leaves an explainable inactive/broken binding rather than
  cascading away history.

### Resolver tests

Build matrices over:

- bare direct agent vs bare alias vs explicit alias;
- current project/local node vs same-name cross-project/cross-node aliases;
- active, shadowed, unset, expired, unreachable, terminal, and unauthorized
  bindings;
- agent target vs exact session target;
- legacy `target:<handle>` / `⌖handle` and observed-session fallback; and
- a repoint race between resolution and dispatch acceptance.

Assert the resolver pins one canonical target and revision or fails closed.

### Broker flow tests

- `send` and `ask` through agent aliases.
- `send` and `ask` through exact-session aliases.
- Fresh agent work may select/start a compatible session; exact-session alias
  never does.
- Alias-based follow-up after repoint goes to the new target.
- Ref/session/conversation/work-based follow-up after repoint stays with the
  old accepted context.
- Receipts, dispatch records, invocations, flights, and work items retain
  resolution proof.
- Cross-node resolution forwards to the authoritative node and rejects owner or
  permission mismatch.

### CLI/MCP tests

- Human and JSON output for set, list, resolve, repoint, unset, `--replace`,
  scope flags, expiry flags, and `--if-revision`.
- `--self` in supported, unattached, mismatched, and spoofed host contexts.
- Alias-aware `messages_send` and `ask` without a preflight resolve call.
- Stable error codes and copyable remediation commands.

### UI tests

- Agent details show aliases without duplicate roster rows or count changes.
- Session details show exact-session aliases and lifecycle health.
- Alias inventory distinguishes active binding state from computed routability.
- Historical activity continues to display the target resolved at acceptance,
  even after repoint/unset.
- Accessibility labels say “route alias” or “points to,” not “agent.”

### Narrow project checks

Run the narrowest new test files first, then the relevant package checks:

```bash
npm --prefix packages/protocol run check
npm --prefix packages/runtime run check
bun run --cwd apps/desktop check
bun run --cwd packages/web build:server
```

If native inventory surfaces change, add the appropriate Swift package/build
checks using the repository's per-run DerivedData hygiene.

## Documentation updates required with implementation

- `docs/architecture.md` — identity/addressing and data model.
- `docs/runtime-sessions.md` — exact-session alias lifetime and failure rules.
- `docs/scout-comms.md` — routing precedence, follow-up behavior, and receipts.
- `docs/agent/*.agent.md` equivalents — dense agent guidance.
- `packages/cli/README.md` and command help — management and dispatch examples.
- `docs/concepts.md` — card versus alias versus session.
- Mark SCO-073 superseded for user-managed aliases while preserving the
  observed-session-index distinction.

## Final decision boundary

The route alias is mutable routing state owned by the broker. The agent card is
durable identity and execution configuration. The session is exact harness
continuity. Keeping those three nouns separate is the central invariant of this
proposal.
