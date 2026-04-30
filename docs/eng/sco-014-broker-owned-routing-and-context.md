# SCO-014: Broker-Owned Routing And Caller Context

## Status

Partially implemented in `edeec8f0`.

This document is both a target-state spec and a migration tracker. The first
pass landed the broker delivery contract and fixed the immediate sender-facing
failure modes. The remaining sections call out the still-proposed pieces.

## Problem

Scout message senders currently burn too much context and too many tool calls
before a message can move. A sender often has to determine:

- who it is speaking as
- which project or workspace it is in
- which agents are known, online, wakeable, stale, or offline
- whether a label is an address, product alias, harness hint, or prose
- whether to send, ask, wake, queue, fan out, or ask the user to disambiguate
- how to recover when routing fails

Those decisions are platform decisions. They should not be repeated in the CLI,
MCP tools, web UI, mobile UI, and agent prompts.

The broker already has the right position in the system: it owns durable state,
node identity, endpoints, conversations, deliveries, flights, collaboration
records, and dispatch records. The missing piece is a broker-owned routing
contract that accepts caller intent and returns a compact receipt.

## Goals

- Make routine send/ask one broker call from every surface.
- Derive requester identity, node, project, and presence from call context.
- Keep message body as payload, not a routing surface.
- Keep `Scout` and `OpenScout` product names separate from `Ranger`.
- Move route preview, target resolution, wake policy, queue policy, and recovery
  actions into broker-owned APIs.
- Return compact human receipts by default and structured diagnostics for tools.
- Preserve advanced explicit addressing for power users and tests.

## Current Implementation

Landed:

- Protocol types for caller context, route targets, route policy, delivery
  receipts, and remediation actions.
- `/v1/deliver` accepts typed `target` intent for `agent_label`, `agent_id`,
  `channel`, and `broadcast`, while preserving legacy `targetLabel` and
  `targetAgentId` fields.
- Broker delivery generates missing delivery request IDs and timestamps.
- `scout send --to <target>` is the preferred explicit tell path. In that path,
  body `@handles` remain payload text.
- MCP explicit-target `messages_send` and `invocations_ask` return compact
  visible text with full detail in `structuredContent`.
- `@scout` and `@openscout` no longer get donated to a Ranger manifest agent.
  They are reserved until the product inbox is implemented.

Still proposed:

- Product inbox routing for `@scout` and `@openscout`, including a receipt field
  that can show the virtual target and the concrete handler.
- Broker-derived caller identity from raw process/session context. Current
  desktop clients still resolve the sender before calling deliver.
- Route preview or dry-run endpoint.
- Broker-owned presence directory for `scout who` and pickers.
- Multi-target route intent.
- Atomic work item creation inside `/v1/deliver`.
- Replacing all remaining client-side message planning paths.
- Moving legacy body mention parsing and conversation planning out of the
  desktop client. Today the explicit `--to` path is broker-directed; the legacy
  `scout send "@agent body"` path still exists for compatibility.
- Publishing a new global `scout` binary. The repo-local CLI has `send --to`;
  older installed CLIs still parse body mentions.

## Non-Goals

- Removing fully qualified Scout addresses.
- Removing Ranger as the preferred orchestration agent.
- Making the broker guess unsafe multi-agent fan-out without policy.
- Replacing collaboration records, messages, or flights.

## Naming Contract

`Scout` and `OpenScout` are product and platform nouns. `Ranger` is an
orchestration agent.

Broker-owned virtual addresses:

| Address | Meaning |
| --- | --- |
| `@scout` | Product/platform feedback and coordination inbox. |
| `@openscout` | Alias for the OpenScout product inbox. |
| `@ranger` | Workspace orchestration agent. |

`@scout` may delegate internally to Ranger, but senders should not need to know
or address that implementation detail. Receipts can state the actual handler:

```text
sent to @scout-feedback; handler ranger.pre-tail.mini
```

This is not implemented yet. The current implementation only prevents
manifest-backed Ranger agents from claiming these product handles.

## Caller Context

Senders may provide raw context. The broker resolves it.

```ts
export interface ScoutCallerContext {
  actorId?: ScoutId;
  nodeId?: ScoutId;
  displayName?: string;
  handle?: string;
  currentDirectory?: string;
  metadata?: MetadataMap;
}

export interface ScoutResolvedCallerContext {
  requesterId: ScoutId;
  requesterNodeId: ScoutId;
  projectRoot?: string;
  workspaceLabel?: string;
  senderKind: "operator" | "agent" | "device" | "system";
  inferred: boolean;
}
```

Resolution order:

1. Explicit authenticated caller from trusted server/session context.
2. Explicit `envAgent` or `OPENSCOUT_AGENT`.
3. Existing active endpoint/session identity.
4. Project-local default agent from nearest project root.
5. Operator identity from user config.

Clients can still pass explicit `requesterId` for compatibility, but the broker
stamps the final resolved caller into the receipt.

Raw hints such as `OPENSCOUT_AGENT`, transport name, session id, and device id
belong in `metadata` until the broker owns full caller inference.

## Route Intent

Delivery requests should describe intent instead of precomputed routes.

```ts
export type ScoutRouteAmbiguousPolicy = "reject" | "ask";

export interface ScoutRoutePolicy {
  preferLocalNodeId?: ScoutId;
  ambiguous?: ScoutRouteAmbiguousPolicy;
  allowStaleDirectId?: boolean;
}

export type ScoutRouteTarget =
  | { kind: "agent_label"; label: string; value?: string }
  | { kind: "agent_id"; agentId: ScoutId; value?: string }
  | { kind: "binding_ref"; ref: string; value?: string }
  | { kind: "channel"; channel: string; value?: string }
  | { kind: "broadcast"; value?: string };

export interface ScoutDeliverRequest {
  id?: ScoutId;
  caller?: ScoutCallerContext;
  requesterId?: ScoutId;      // compatibility
  requesterNodeId?: ScoutId;  // compatibility
  intent: "tell" | "consult";
  body: string;
  target?: ScoutRouteTarget;
  targetLabel?: string;
  targetAgentId?: ScoutId;
  channel?: string;
  routePolicy?: ScoutRoutePolicy;
  replyToMessageId?: ScoutId;
  speechText?: string;
  ensureAwake?: boolean;
  execution?: InvocationExecutionPreference;
  createdAt?: number;
  collaborationRecordId?: ScoutId;
  messageMetadata?: MetadataMap;
  invocationMetadata?: MetadataMap;
}
```

Compatibility rules:

- `targetLabel` maps to `{ kind: "agent_label" }`.
- `targetAgentId` maps to `{ kind: "agent_id" }`.
- Bare `ref:<suffix>` maps to `{ kind: "binding_ref" }`.
- Missing `id` and `createdAt` are broker-generated.
- Body mention scanning is disabled by default.
- Legacy `scout send "@agent message"` is still a compatibility path. It
  currently scans body mentions and should be narrowed to leading-target-only
  before this migration is complete.
- During migration, older clients may still send both typed `target` and legacy
  `targetLabel` / `targetAgentId` fields so new clients can talk to older
  running brokers.
- Role targets, harness targets, multi-target arrays, and inline `workItem`
  payloads are planned extensions, not part of the landed protocol yet.

## Session Context Policy

Routing has two separate questions:

- `target`: which stable agent identity should own the work?
- `execution.session`: should this delivery create fresh model context or reuse
  an existing live session?

Stable agent identity is durable. Session binding is per live or newly-created
harness session. Default label delivery should use fresh context:

```json
{
  "target": { "kind": "agent_label", "label": "@openscout.harness:claude" },
  "execution": { "harness": "claude", "session": "new" }
}
```

That means `@openscout` remains the stable human address, while the broker
creates or selects a concrete session binding under it. Receipts and history
should expose both layers: the stable target label / agent identity and the
ephemeral session identity that actually handled the delivery.

`execution.session` values:

| Value | Meaning |
| --- | --- |
| `new` | Start a fresh session/context for the selected agent identity. This is the default for broker-owned label sends/asks because context-window pollution is more dangerous than startup cost. |
| `existing` | Require an already-running session for continuity. If none is available, return a route question/action instead of silently creating fresh context. |
| `any` | Prefer a live session when available, otherwise create or wake according to target policy. This is useful for low-stakes tells and status updates. |

The session binding is not the user-facing address. A sender should be able to
say `@openscout` or `@openscout.harness:claude`; the broker owns the mapping
from that stable name to the concrete session started for this handoff.

Within an interaction, the broker may also mint a reference for that specific
binding. The reference is scoped to the conversation/work item/flight, not
global agent identity. It should be mechanically derived and low-editorial, such
as the last eight characters of the concrete binding/session/flight id. UIs may
show friendly labels, but the routable primitive should stay boring and
collision-resistant. The routable form is the bare reference target, for example
`ref:7f3a9c21`.

If the same durable identity is bound through multiple harnesses, each harness
binding gets a distinct reference:

```text
@openscout            -> stable product/project identity
@openscout#claude     -> harness-qualified stable identity
ref:7f3a9c21          -> this interaction's concrete Claude session binding
ref:b64e0d88          -> this interaction's concrete Codex session binding
```

Do not overload identity shorthand for references. `@openscout#7f3a9c21`
already means a harness qualifier, and `@openscout#claude?7f3a9c21` already
means harness plus model qualifier. References should live outside that grammar.
Prefer the bare `ref:7f3a9c21` form and let receipts/history show the bound
stable identity (`@openscout#claude`) beside it.

Once the binding exists, follow-up messages in the same interaction can use the
reference and preserve continuity without making future unrelated sends inherit
that session's context. In other words, references are handles to interaction
sessions, while agent names are handles to durable identities. A reference must
point to exactly one binding; if it is missing, expired, or ambiguous, the
broker should reject it with a choose-target or stale-reference action.

CLI continuations should pass the ref as a route target:

```bash
scout ask --ref 7f3a9c21 "continue with the same Claude session"
scout send --ref 7f3a9c21 "heads up for that concrete session"
```

When the target label includes a harness qualifier and no matching live session
exists, the broker should treat that as a request to create a new session with
that harness under the same stable agent identity, not as an unresolved target.

## Route Preview

Every delivery can be previewed without writing state.

```http
POST /v1/route/preview
POST /v1/deliver?dryRun=true
```

Response:

```ts
export interface ScoutRoutePreview {
  caller: ScoutResolvedCallerContext;
  routeKind: "dm" | "channel" | "broadcast" | "fanout" | "blocked";
  targets: ScoutResolvedRouteTarget[];
  blocked?: ScoutDispatchRecord;
  actions: ScoutRemediationAction[];
  receiptText: string;
}
```

Preview is the single source used by CLI, MCP, web, mobile, and agents for:

- agent search and picker metadata
- unknown/ambiguous target recovery
- `scout who` current-project roster
- dry-run tests

## Delivery Receipt

Successful delivery returns a structured receipt plus the records created by the
broker.

```ts
export interface ScoutDeliveryReceipt {
  requestId: ScoutId;
  routeKind: "dm" | "channel" | "broadcast";
  requesterId: ScoutId;
  requesterNodeId: ScoutId;
  targetAgentId?: ScoutId;
  targetLabel?: string;
  bindingRef?: string;
  conversationId: ScoutId;
  messageId: ScoutId;
  flightId?: ScoutId;
  acceptedAt: number;
}

export interface ScoutDeliverAcceptedResponse {
  kind: "delivery";
  accepted: true;
  routeKind: "dm" | "channel" | "broadcast";
  receipt: ScoutDeliveryReceipt;
  conversation: ConversationDefinition;
  message: MessageRecord;
  targetAgentId?: ScoutId;
  flight?: FlightRecord;
}
```

`receiptText`, resolved caller summaries, target arrays, stable target fields,
binding refs, and work item records are target-state response fields. Today,
CLI and MCP render compact text from the structured response.

Virtual route receipts also need a concrete handler field before `@scout` can
delegate internally without confusing senders. The landed receipt does not have
that field yet.

Human-facing text should be short:

```text
sent as ranger.main.mini from openscout to @scout-feedback via DM (ref:7f3a9c21)
```

When a concrete binding handled the delivery, receipts should show both the
stable target (`targetLabel` / `targetAgentId`) and the continuation reference
(`bindingRef`). Refs are route targets for follow-up, not replacements for the
stable identity.

MCP tools should put this text in `content` and the full receipt in
`structuredContent`.

## Remediation Actions

Failures and partial deliveries carry first-class actions. Senders render or
execute these; they should not invent recovery logic.

```ts
export type ScoutDeliveryRemediationAction =
  | { kind: "choose_target"; detail: string; targetLabel?: string }
  | { kind: "register_target"; detail: string; targetLabel?: string }
  | { kind: "wake_target"; detail: string; targetAgentId?: ScoutId }
  | { kind: "retry_later"; detail: string; targetAgentId?: ScoutId };
```

Unknown target example:

```json
{
  "receiptText": "no agent matches @codex; closest routable target is @ranger.harness:codex",
  "actions": [
    {
      "kind": "register_target",
      "detail": "no agent matches @codex",
      "targetLabel": "@codex"
    }
  ]
}
```

First-class retry/start/open-picker payloads are still proposed. Current
remediation is intentionally small so senders can display useful failures
without inventing their own recovery taxonomy.

## Runtime Paths

There are two sender runtime paths and both must stay simple:

- CLI-backed agents, including current Claude stream-json agents, call
  `scout send --to ...` or `scout ask --to ...`. The CLI may infer process
  context, but it must hand the broker structured route intent and compact
  caller context. It must not require `whoami`, `who`, search, or resolve
  preflight for routine sends.
- MCP-backed hosts call `messages_send` or `invocations_ask` with
  `targetLabel`, `targetAgentId`, or `channel`. The MCP server should establish
  default session/workspace context and let `/v1/deliver` resolve the caller,
  route, wake behavior, and receipt.

Both paths converge at `/v1/deliver`. Differences between CLI and MCP should be
transport ergonomics only, not separate planning algorithms.

## Presence Directory

The broker exposes a route-aware directory:

```http
GET /v1/presence?scope=current-project
GET /v1/presence?scope=all
```

Entries include:

- canonical label
- display name
- role
- project root
- harness
- model
- node
- endpoint state
- routable
- wakeable
- stale/retired flags
- last activity
- suggested actions

Default `scout who` uses `scope=current-project`, routable first. `--all`
requests fleet-wide inventory.

## Atomic Work Creation

When `intent: "consult"` and `workItem` is present, the broker creates these in
one durable write:

- message
- invocation
- flight
- collaboration record
- collaboration event
- delivery records

The client should not deliver first and create work second.

## Sender Surface Changes

CLI:

- `scout send --to <target> "body"` becomes the preferred explicit form.
- `scout send "@agent body"` remains a legacy shorthand and must be narrowed to
  leading-target-only before full broker-owned routing.
- `scout ask --to <target> "body"` sends target as structured route intent.
- `scout ask --ref <ref>` and `scout send --ref <ref>` continue the concrete
  bound session for an existing interaction.
- Target state: errors display `receiptText` and at most three
  broker-suggested actions. Current CLI errors still render from local
  `targetDiagnostic` data.

MCP:

- Explicit-target `messages_send` and `invocations_ask` call broker deliver
  directly. `mentionAgentIds` and no-target body-mention paths are still legacy
  client-planned paths.
- Visible `content` is compact receipt text.
- Full details remain in `structuredContent`.
- MCP server establishes default caller context once per server/session.

Web/Mobile:

- Send APIs pass raw caller context and route intent.
- Picker data comes from broker presence/preview.
- No body mention scanning for routing.

Agents:

- Prompt guidance should say: use direct send/ask first.
- Do not run `whoami`, `who`, or `agents_search` unless broker receipt asks for
  disambiguation.
- Treat body `@handles` as prose unless using an explicit target field.

## Migration Plan

1. [x] Add protocol types for caller context, route targets, route policy, receipt,
   and remediation actions.
2. [x] Teach `/v1/deliver` to accept route intent while preserving legacy fields.
3. [x] Make MCP visible content compact receipt text.
4. [x] Update CLI help and docs to prefer explicit target fields.
5. [x] Smoke-test with a new Claude-backed agent using repo-local `send --to`.
6. [ ] Implement `@scout` / `@openscout` product inbox routing.
7. [ ] Implement broker context resolution and route preview.
8. [ ] Move legacy body mention parsing, target registration, and conversation
   planning from client service code into deliver.
9. [ ] Move multi-target explicit-ID sends from client message planning to deliver.
10. [ ] Add atomic work item creation to deliver.
11. [ ] Replace client/MCP directory reconstruction with broker presence endpoints.
12. [ ] Publish the updated CLI so global `scout send --to` has the same behavior.

## Test Plan

Unit tests:

- caller context resolves from explicit agent, environment agent, project root,
  session endpoint, and operator fallback
- `@scout` resolves to product inbox, not Ranger
- body handles in code spans or prose do not affect delivery
- legacy leading target shorthand still works
- unknown target returns remediation actions
- ambiguous target returns picker action and candidates
- multi-target deliver uses broker planning
- consult with work item creates message, flight, and work item atomically
- MCP content is compact while structured content remains complete

Smoke tests:

1. Start or create a Claude-backed project agent.
2. Ask it to send feedback to Scout using only `scout send --to scout`.
3. Confirm it does not call `scout whoami`, `scout who`, or search first.
4. Confirm the receipt names resolved caller, project, route, and handler.
5. Ask it to mention `@codex` in the body and confirm the message still sends.

## Open Questions

- Should `@scout` create a dedicated `scout-feedback` agent record, or should it
  be a virtual broker inbox without an agent card?
- Should `routable_first` ever choose an offline but wakeable target over an
  online non-default target?
- Should route preview be a separate endpoint or a dry-run mode of deliver?
- How much caller environment can MCP safely pass without exposing secrets?
