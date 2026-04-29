# SCO-014: Broker-Owned Routing And Caller Context

## Status

Proposed for implementation.

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

## Caller Context

Senders may provide raw context. The broker resolves it.

```ts
export interface ScoutCallerContext {
  cwd?: string;
  envAgent?: string;
  sessionId?: string;
  deviceId?: string;
  transport?: "cli" | "mcp" | "web" | "mobile" | "agent" | "api";
  surface?: string;
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

## Route Intent

Delivery requests should describe intent instead of precomputed routes.

```ts
export type ScoutRoutePolicy =
  | "broker_default"
  | "dm"
  | "channel"
  | "fanout"
  | "routable_first"
  | "ask_if_ambiguous";

export type ScoutRouteTarget =
  | { kind: "agent_label"; label: string }
  | { kind: "agent_id"; agentId: ScoutId }
  | { kind: "channel"; channel: string }
  | { kind: "broadcast" }
  | { kind: "role"; role: "scout" | "openscout" | "ranger" }
  | { kind: "harness"; harness: AgentHarness; projectRoot?: string };

export interface ScoutDeliverRequest {
  id?: ScoutId;
  caller?: ScoutCallerContext;
  requesterId?: ScoutId;      // compatibility
  requesterNodeId?: ScoutId;  // compatibility
  intent: "tell" | "consult";
  body: string;
  target?: ScoutRouteTarget;
  targets?: ScoutRouteTarget[];
  channel?: string;
  routePolicy?: ScoutRoutePolicy;
  replyToMessageId?: ScoutId;
  speechText?: string;
  ensureAwake?: boolean;
  execution?: InvocationExecutionPreference;
  createdAt?: number;
  workItem?: ScoutWorkItemInput;
  collaborationRecordId?: ScoutId;
  messageMetadata?: MetadataMap;
  invocationMetadata?: MetadataMap;
}
```

Compatibility rules:

- `targetLabel` maps to `{ kind: "agent_label" }`.
- `targetAgentId` maps to `{ kind: "agent_id" }`.
- Missing `id` and `createdAt` are broker-generated.
- Body mention scanning is disabled by default.
- Legacy `scout send "@agent message"` may parse only a leading target at the
  CLI boundary and pass it as structured `target`.

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

Successful delivery returns a compact receipt plus structured records.

```ts
export interface ScoutDeliverReceipt {
  kind: "delivery";
  accepted: true;
  caller: ScoutResolvedCallerContext;
  routeKind: "dm" | "channel" | "broadcast" | "fanout";
  receiptText: string;
  conversation: ConversationDefinition;
  message: MessageRecord;
  targets: ScoutResolvedRouteTarget[];
  targetAgentId?: ScoutId;
  flight?: FlightRecord;
  workItem?: CollaborationRecord;
  actions: ScoutRemediationAction[];
}
```

Human-facing text should be short:

```text
sent as ranger.main.mini from openscout to @scout-feedback via DM
```

MCP tools should put this text in `content` and the full receipt in
`structuredContent`.

## Remediation Actions

Failures and partial deliveries carry first-class actions. Senders render or
execute these; they should not invent recovery logic.

```ts
export type ScoutRemediationAction =
  | {
      kind: "retry_with_target";
      label: string;
      target: ScoutRouteTarget;
      command?: string;
      payload?: unknown;
    }
  | {
      kind: "start_agent";
      label: string;
      projectRoot: string;
      harness?: AgentHarness;
      command: string;
    }
  | {
      kind: "open_picker";
      label: string;
      candidates: ScoutDispatchCandidate[];
    }
  | {
      kind: "send_to_feedback";
      label: string;
      target: ScoutRouteTarget;
    }
  | {
      kind: "create_ranger";
      label: string;
      projectRoot: string;
      command: string;
    };
```

Unknown target example:

```json
{
  "receiptText": "no agent matches @codex; closest routable target is @ranger.harness:codex",
  "actions": [
    {
      "kind": "retry_with_target",
      "label": "Ask Codex-backed Ranger",
      "target": { "kind": "agent_label", "label": "@ranger.harness:codex" },
      "command": "scout ask --to ranger.harness:codex \"...\""
    }
  ]
}
```

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
- `scout send "@agent body"` remains legacy shorthand for leading target only.
- `scout ask --to <target> "body"` sends target as structured route intent.
- Errors display `receiptText` and at most three broker-suggested actions.

MCP:

- `messages_send` and `invocations_ask` call broker deliver directly.
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

1. Add protocol types for caller context, route targets, route policy, receipt,
   and remediation actions.
2. Implement broker context resolution and route preview.
3. Teach `/v1/deliver` to accept route intent while preserving legacy fields.
4. Move multi-target explicit-ID sends from client message planning to deliver.
5. Add atomic work item creation to deliver.
6. Replace client/MCP directory reconstruction with broker presence endpoints.
7. Make MCP visible content compact receipt text.
8. Update CLI help and docs to prefer explicit target fields.
9. Update agent instructions and smoke-test with a new Claude-backed agent.

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
