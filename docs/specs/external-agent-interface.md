# External Agent Interface

Date: 2026-06-22
Status: recommendation / proposal
Audience: Scout protocol, broker, runtime, adapter, and agent-integration work

## Purpose

This document proposes the external interface Scout should expose to agents,
agent frameworks, and higher-level coordination products.

The intent is simple:

```text
Innovate internally. Conform externally.
```

Scout can keep its rich local control-plane model: broker, endpoint, session,
invocation, flight, delivery, binding, work item, mesh, and observed harness
activity. Those concepts are useful implementation machinery.

External agents should not need to learn that machinery. From the outside,
Scout should look like a normal agent interoperability endpoint with familiar
concepts from A2A, MCP, AG-UI, Chat SDK-style channel adapters, and coding-agent
host protocols.

If an agent can integrate with Mastra, eve, Cloudflare Agents, LangGraph,
OpenAI Agents SDK, or another A2A-shaped system, it should be able to integrate
with Scout without becoming Scout-specific.

## North Star

The public contract should be boring:

```text
discover agent
send message
start or continue task
stream task events
provide input or approval
cancel task
fetch artifacts
```

The agent-facing contract should be:

```text
I received a message or task.
I can emit status.
I can ask for input.
I can request approval.
I can produce artifacts.
I can finish, fail, reject, or be canceled.
```

The agent should not need to know whether Scout:

- resolved a short handle
- woke a local broker endpoint
- started a Codex or Claude harness
- reused a concrete runtime session
- forwarded over mesh
- created an invocation and flight
- bridged to a chat platform
- tailed external harness transcripts

Those are Scout implementation details and diagnostic metadata, not the default
external interface.

## Standards Posture

Scout should treat these as the external reference points:

| Need | Preferred public shape |
| --- | --- |
| Agent discovery | A2A `AgentCard` |
| Agent-to-agent work | A2A `Message`, `Task`, `TaskStatus`, `contextId`, `Artifact` |
| Tool and data access | MCP |
| Agent-to-UI streaming | AG-UI-style event stream |
| Chat-platform ingress/egress | Chat SDK-style adapters |
| Coding editor or host integration | Agent Client Protocol-style host adapter |
| Runtime execution | Scout-native, Cloudflare Agents, eve, Mastra, Codex, Claude, custom |

Scout should not collapse its internals into any one standard. It should expose
the standard shapes at the boundary, then map them into Scout-native records.

## Layer Model

```text
External clients and agents
  A2A discovery, messages, tasks, artifacts
  MCP tools and resources
  AG-UI-compatible user interaction events
  Chat adapters and coding-host adapters
        |
        v
Scout external interface
  boring protocol facade
        |
        v
Scout internal control plane
  broker, routing, sessions, endpoints, invocations, flights, deliveries
        |
        v
Runtimes and harnesses
  Codex, Claude, local sessions, Mastra, eve, Cloudflare Agents, webhooks
```

## Public Concepts

### Agent

An external agent is a discoverable actor that can receive messages and create
or update tasks.

Externally, represent it with an A2A-compatible `AgentCard`.

Internally, Scout may map it to:

- `ScoutAgentCard`
- agent identity
- endpoint
- connector binding
- project or harness profile
- invocation policy
- mesh authority

### Message

A message is a turn of communication. It can be immediate, or it can lead to a
task.

Externally, use A2A-style `Message`:

```ts
type ExternalMessage = {
  role: "ROLE_USER" | "ROLE_AGENT";
  messageId: string;
  contextId?: string;
  taskId?: string;
  referenceTaskIds?: string[];
  parts: ExternalPart[];
  metadata?: Record<string, unknown>;
};
```

Scout should not require routing to be hidden in message text. Routing remains
structured metadata at the client or adapter boundary. If a channel body
contains `@reviewer`, the adapter should translate that into an explicit target
before calling Scout.

### Part

A part is a modality-independent content unit.

```ts
type ExternalPart =
  | {
      text: string;
      mediaType?: "text/plain" | "text/markdown" | string;
      metadata?: Record<string, unknown>;
    }
  | {
      url: string;
      mediaType?: string;
      filename?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      raw: string;
      mediaType: string;
      filename?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      data: unknown;
      mediaType?: "application/json" | string;
      metadata?: Record<string, unknown>;
    };
```

Text should remain the canonical fallback. Rich UI, file previews, patches,
diffs, and structured data should travel as parts or artifacts, not as
Scout-specific transcript records.

### Task

A task is the external unit of work.

Externally, use A2A-compatible `Task`.

Internally, map it to Scout's richer model:

```text
A2A Task = Scout invocation + flight
```

If Scout creates a work item as well, that should be exposed as task metadata,
linked context, or an extension, not as a required external noun.

```ts
type ExternalTask = {
  id: string;
  contextId: string;
  status: ExternalTaskStatus;
  history?: ExternalMessage[];
  artifacts?: ExternalArtifact[];
  metadata?: {
    scout?: {
      invocationId?: string;
      flightId?: string;
      conversationId?: string;
      workId?: string;
      endpointId?: string;
      sessionId?: string;
      brokerNodeId?: string;
    };
    [key: string]: unknown;
  };
};
```

The `metadata.scout` object is for diagnostics, audit, and advanced clients. It
should not be necessary for ordinary agent behavior.

### Task Status

The external state machine should follow A2A semantics.

Recommended wire-compatible status names:

```ts
type ExternalTaskState =
  | "TASK_STATE_UNSPECIFIED"
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_AUTH_REQUIRED"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_FAILED";

type ExternalTaskStatus = {
  state: ExternalTaskState;
  message?: ExternalMessage;
  timestamp: string;
  metadata?: Record<string, unknown>;
};
```

Scout can keep more precise internal states, but should project them into this
small external set.

Suggested mapping:

| Scout internal condition | External task state |
| --- | --- |
| unknown or indeterminate state | `TASK_STATE_UNSPECIFIED` |
| request accepted, not routed | `TASK_STATE_SUBMITTED` |
| delivery planned or waiting on wake | `TASK_STATE_SUBMITTED` with queued phase metadata |
| endpoint/session claimed work | `TASK_STATE_WORKING` |
| human answer needed | `TASK_STATE_INPUT_REQUIRED` |
| permission, credential, or connector auth needed | `TASK_STATE_AUTH_REQUIRED` |
| flight/work finished successfully | `TASK_STATE_COMPLETED` |
| caller or system canceled before completion | `TASK_STATE_CANCELED` |
| target declined or policy rejected work | `TASK_STATE_REJECTED` |
| routing, runtime, or execution failed | `TASK_STATE_FAILED` |

Do not expose `flight` as a first-class external state noun. It remains the
Scout-owned execution lifecycle that backs the task projection.

### Context

`contextId` is the external continuity handle.

Internally, it can map to:

- conversation id
- thread id
- room/channel binding
- work context
- runtime session metadata

Rules:

1. A follow-up should use the same `contextId`.
2. A follow-up that refines prior work should include `referenceTaskIds`.
3. A terminal task should not be restarted. Follow-up work creates a new task in
   the same context.
4. Scout may preserve deeper runtime continuity internally, but that should not
   be required for the external caller.

### Artifact

An artifact is a durable output of a task.

```ts
type ExternalArtifact = {
  artifactId: string;
  name: string;
  description?: string;
  parts: ExternalPart[];
  metadata?: Record<string, unknown>;
};
```

Examples:

- final answer text
- review report
- patch
- file URL
- generated document
- trace link
- screenshot
- structured JSON result

Artifacts should be stable and referencable. If a follow-up changes an output,
create a new artifact and link it to the previous one in metadata rather than
mutating the old artifact silently.

## Public Operations

Scout should expose or project to these operations.

### Discover Agent

Serve A2A-compatible cards:

```http
GET /.well-known/agent-card.json
GET /v1/a2a/agent-card.json
GET /v1/a2a/agents/{agentId}/agent-card.json
```

Minimum card fields:

```ts
type ExternalAgentCard = {
  specVersion: string;
  name: string;
  description: string;
  url: string;
  provider?: {
    organization?: string;
    url?: string;
  };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  authentication?: unknown;
  skills: Array<{
    id?: string;
    name: string;
    description?: string;
    tags?: string[];
    examples?: string[];
  }>;
  metadata?: {
    scout?: {
      agentId?: string;
      projectPathKnown?: boolean;
      harnesses?: string[];
      localOnly?: boolean;
      trustPosture?: "local-pilot" | "team" | "production";
    };
    [key: string]: unknown;
  };
};
```

The card should answer boring questions:

- Who is this agent?
- What can I ask it to do?
- Where do I send work?
- Does it support streaming?
- Does it support push updates?
- What auth does it require?

Do not make callers inspect endpoint/session internals before sending normal
work.

### Send Message

Use A2A-compatible JSON-RPC as the primary interoperability shape:

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "msg-001",
      "contextId": "ctx-optional",
      "parts": [{ "text": "Review this PR." }]
    },
    "configuration": {
      "blocking": false,
      "acceptedOutputModes": ["text/markdown", "application/json"]
    }
  }
}
```

Response may be an immediate message or a task:

```ts
type SendMessageResult =
  | { message: ExternalMessage }
  | { task: ExternalTask };
```

Scout recommendation:

- simple tell/update can return a message
- any requested work should return a task
- project/harness/runtime selection remains internal dispatch

### Send Streaming Message

Provide a streaming operation for live task updates:

```json
{
  "jsonrpc": "2.0",
  "id": "req-002",
  "method": "SendStreamingMessage",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "msg-002",
      "parts": [{ "text": "Investigate this failure." }]
    }
  }
}
```

The stream should emit events that are easy to bridge into A2A and AG-UI:

```ts
type ExternalTaskEvent =
  | { type: "task.created"; task: ExternalTask }
  | { type: "task.status"; taskId: string; status: ExternalTaskStatus }
  | { type: "message"; taskId?: string; message: ExternalMessage }
  | { type: "artifact.created"; taskId: string; artifact: ExternalArtifact }
  | { type: "artifact.updated"; taskId: string; artifact: ExternalArtifact }
  | { type: "input.required"; taskId: string; prompt: ExternalMessage }
  | { type: "auth.required"; taskId: string; prompt: ExternalMessage }
  | { type: "task.completed"; task: ExternalTask }
  | { type: "task.failed"; task: ExternalTask }
  | { type: "task.canceled"; task: ExternalTask };
```

Scout may internally emit many more events. The external event stream should
stay small and stable.

### Get Task

```json
{
  "jsonrpc": "2.0",
  "id": "req-003",
  "method": "GetTask",
  "params": {
    "id": "task-123",
    "historyLength": 20
  }
}
```

Returns the projected task, status, history, artifacts, and metadata.

### List Tasks

```json
{
  "jsonrpc": "2.0",
  "id": "req-004",
  "method": "ListTasks",
  "params": {
    "contextId": "ctx-123",
    "limit": 50
  }
}
```

Useful for a client that has a context but not the current task id.

### Subscribe To Task

Support task subscription over SSE or WebSocket:

```http
GET /v1/a2a/tasks/{taskId}/events
```

The payload should use the same `ExternalTaskEvent` shapes as
`SendStreamingMessage`.

### Provide Input

A task in `TASK_STATE_INPUT_REQUIRED` or `TASK_STATE_AUTH_REQUIRED` should
resume through a normal message in the same context and task:

```json
{
  "jsonrpc": "2.0",
  "id": "req-005",
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "msg-005",
      "contextId": "ctx-123",
      "taskId": "task-123",
      "parts": [{ "text": "Use the staging credentials." }]
    }
  }
}
```

This maps cleanly to Scout questions, unblock requests, operator attention, or
approval flows without exposing those as required external concepts.

### Cancel Task

```json
{
  "jsonrpc": "2.0",
  "id": "req-006",
  "method": "CancelTask",
  "params": {
    "id": "task-123",
    "reason": "No longer needed"
  }
}
```

Rules:

1. If local runtime cancellation is supported, Scout should attempt it.
2. If only broker-level cancellation is possible, Scout should mark future
   delivery/results as canceled and report that active harness cancellation is
   unsupported.
3. If cancellation is impossible, return a clear non-cancellable error and
   preserve the task's current state.

### Push Notifications

For long-running work, support A2A-style push notification configuration:

```text
CreatePushNotificationConfig
GetPushNotificationConfig
ListPushNotificationConfigs
DeletePushNotificationConfig
```

Scout can initially treat this as optional, but the external interface should
leave room for webhook delivery, retries, auth, and audit records.

## Scout-Native Agent Handler Shape

Scout-native agents should be able to implement the same boring contract without
speaking raw JSON-RPC directly.

```ts
interface ScoutExternalAgent {
  card(): ExternalAgentCard | Promise<ExternalAgentCard>;

  onMessage(input: {
    message: ExternalMessage;
    context: ExternalRequestContext;
  }): Promise<ExternalMessage | ExternalTask>;

  onTaskInput?(input: {
    taskId: string;
    message: ExternalMessage;
    context: ExternalRequestContext;
  }): Promise<ExternalTask>;

  onCancel?(input: {
    taskId: string;
    reason?: string;
    context: ExternalRequestContext;
  }): Promise<ExternalTask>;
}

interface ExternalRequestContext {
  caller?: {
    id?: string;
    name?: string;
    kind?: "human" | "agent" | "service";
  };
  contextId?: string;
  auth?: unknown;
  metadata?: Record<string, unknown>;
}
```

For streaming:

```ts
interface ExternalTaskEmitter {
  status(status: ExternalTaskStatus): void | Promise<void>;
  message(message: ExternalMessage): void | Promise<void>;
  artifact(artifact: ExternalArtifact): void | Promise<void>;
  inputRequired(message: ExternalMessage): void | Promise<void>;
  authRequired(message: ExternalMessage): void | Promise<void>;
  complete(task: ExternalTask): void | Promise<void>;
  fail(task: ExternalTask): void | Promise<void>;
}
```

The runtime adapter can translate these calls into Scout invocations, flights,
messages, work updates, and operator attention records.

## Agent Instructions

Agent-facing instructions should prefer this small vocabulary:

- agent
- message
- task
- status
- context
- artifact
- input required
- approval required
- canceled
- failed

Avoid teaching ordinary agents these as required nouns:

- broker
- endpoint
- session
- card
- invocation
- flight
- delivery
- binding
- mesh
- harness transcript

Those terms can appear in advanced diagnostics, debug views, and implementer
docs, but they should not be necessary for normal agent-to-agent work.

## Error Shape

Errors should follow JSON-RPC externally, with useful structured data:

```ts
type ExternalErrorData = {
  code:
    | "unknown-agent"
    | "ambiguous-agent"
    | "auth-required"
    | "permission-denied"
    | "unsupported-operation"
    | "not-cancellable"
    | "runtime-unavailable"
    | "routing-failed"
    | "invalid-message"
    | "internal-error";
  message: string;
  remediation?: {
    summary: string;
    retryable: boolean;
    suggestedAction?: string;
  };
  candidates?: Array<{
    name: string;
    agentCardUrl?: string;
    reason?: string;
  }>;
  scout?: {
    dispatchId?: string;
    brokerNodeId?: string;
    endpointId?: string;
    sessionId?: string;
  };
};
```

The boring external message should be actionable. The Scout-specific metadata
can explain what happened when a human opens a detail panel.

## Idempotency

Scout should support idempotent sends and task creation.

Recommended fields:

```ts
type SendMessageConfiguration = {
  idempotencyKey?: string;
  blocking?: boolean;
  acceptedOutputModes?: string[];
  pushNotificationConfigId?: string;
  metadata?: Record<string, unknown>;
};
```

Rules:

1. Same caller + same idempotency key + same message should return the same
   task/message result.
2. Retried delivery should not duplicate user-visible tasks.
3. Scout can still create multiple internal delivery attempts under one
   external task.

## Scope And Room For Interpretation

This proposal does not require Scout to delete or rename internal records.

It recommends:

1. Keep Scout-native internals where they add value.
2. Make A2A-shaped task/message/card projection the default external contract.
3. Use MCP for tools and resources rather than inventing Scout-specific tool
   plumbing.
4. Use AG-UI-compatible event shapes when streaming to application frontends.
5. Treat chat platforms as adapters, not the canonical work model.
6. Put Scout-specific details in metadata and extensions.

## Desired Implementation Priorities

If Scout did the following, this proposal would consider the external interface
healthy:

1. Serve high-quality A2A-compatible agent cards for the broker and each
   registered agent.
2. Support `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`,
   `CancelTask`, `SubscribeToTask`, and `GetExtendedAgentCard`.
3. Project Scout flights into external tasks without requiring callers to know
   the word "flight".
4. Stream a small stable event set for task status, messages, artifacts, input,
   auth, completion, failure, and cancellation.
5. Support `contextId` and `referenceTaskIds` for follow-ups and refinements.
6. Provide stable artifacts with text, data, file URL, and raw file parts.
7. Use structured errors with remediation and optional Scout diagnostics.
8. Add conformance tests against A2A sample clients and at least one real
   framework such as Mastra.
9. Keep ordinary agent instructions focused on messages, tasks, statuses,
   context, and artifacts.

## Non-Goals

- Do not make Scout a generic agent framework.
- Do not expose every internal broker record as public API.
- Do not require agents to know local session or harness topology.
- Do not bulk-import external harness transcripts as public message history.
- Do not invent a Scout-specific external protocol when an A2A/MCP/AG-UI shape
  fits.
- Do not claim full A2A conformance until streaming, cancellation, push
  notifications, auth, and conformance tests are real.

## References

- A2A Protocol: `https://a2a-protocol.org/latest/`
- A2A Core Concepts: `https://a2a-protocol.org/latest/topics/key-concepts/`
- A2A Life Of A Task: `https://a2a-protocol.org/latest/topics/life-of-a-task/`
- Model Context Protocol: `https://modelcontextprotocol.io/docs/getting-started/intro`
- AG-UI: `https://github.com/ag-ui-protocol/ag-ui`
- Agent Client Protocol: `https://agentclientprotocol.com/get-started/introduction`
- Mastra A2A support: `https://mastra.ai/blog/introducing-agent-to-agent-support`
- Cloudflare Agents: `https://developers.cloudflare.com/agents/`
- Vercel eve: `https://vercel.com/blog/introducing-eve`
- Vercel Chat SDK: `https://vercel.com/blog/chat-sdk-brings-agents-to-your-users`
