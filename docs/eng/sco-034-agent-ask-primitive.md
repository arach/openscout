# SCO-034: Agent Ask Primitive

## Status

Accepted. V0 is implemented in the desktop broker service, HTTP route, CLI,
and MCP surface.

## Decision

Add `ask` as the core agent-to-agent primitive.

Use `ask` when one agent wants another agent to answer, review, try, build,
compare, or give feedback.

Broker help should stay explicit through primitives such as `resolve`, `search`,
`start`, and `follow`, rather than overloading `ask` with router diagnostics.

## Shape

```ts
ask({
  to?: string;
  projectPath?: string;
  body: string;
  harness?: "codex" | "claude" | "pi";
  workspace?: "same" | "new_worktree";
  session?: "reuse" | "new";
  wait?: boolean;
})
```

Field meaning:

- `to`: agent id (`id:<agentId>`), label, project, sibling, specialist, or
  recent collaborator.
- `projectPath`: project root to route by project rather than by agent
  identity. Use this when the caller knows the repo/workspace but wants the
  broker to choose the concrete agent/session. This is a typed route target,
  not a search hint.
- `body`: the ask payload. Keep routing metadata out of it.
- `harness`: use a specific harness when requested.
- `workspace`: use the same working environment or an isolated worktree.
- `session`: reuse an existing session or start a new one.
- `wait`: wait inline for a result. Default is false.

Branch names are implementation details. `workspace: "new_worktree"` is the
user intent; Scout can derive branch/worktree names.

Provide exactly one of `to` or `projectPath`.

## Sender Context

Scout may attach small sender context automatically when available.

```ts
sender: {
  agentId?: string;
  project?: string;
  cwd?: string;
  worktree?: "same" | "isolated" | "unknown";
  lastTargetId?: string;
}
```

Rules:

- attach it automatically when available;
- omit it when unavailable;
- keep it inspectable;
- do not include transcript text;
- do not include hidden reasoning.

This is enough for phrases like "my sibling", "Talkie", "same worktree", and
"new worktree" to resolve more often on the first call.

## Behavior

1. Caller sends `ask`.
2. Scout attaches sender context when available.
3. Scout resolves either `to` or `projectPath`.
4. Scout starts a local runtime only when `harness`, `workspace`, or `session`
   require it and Scout has enough information.
5. Scout records message, invocation, flight, and optional work item using the
   existing broker model.
6. Scout returns a compact receipt.
7. If Scout cannot resolve or start safely, it returns one required next call.

## HTTP Boundary

The control-plane HTTP path is `POST /api/ask`.

Server routing should stay thin:

- `routes/ask.ts` owns Hono wiring, JSON reads, sender identity resolution,
  and the single call into the core ask primitive.
- `routes/ask-contract.ts` owns pure ask parsing, validation, receipt
  status mapping, and construction of `ScoutAskCommand`.
- `core/broker/ask.ts` owns ask behavior and must not import web
  framework types.

## Receipt

```ts
{
  ok: boolean;
  state: "queued" | "completed" | "failed" | "ambiguous";
  ids: {
    targetAgentId?: string;
    invocationId?: string;
    flightId?: string;
    conversationId?: string;
    messageId?: string;
    workId?: string;
    bindingRef?: string;
  };
  next?: {
    tool: string;
    arguments: Record<string, unknown>;
    reason: string;
  };
  error?: {
    code: "broker_unreachable" | "invalid_request";
    message: string;
  };
}
```

Default responses should stay this small. `error` is only for failures that a
follow-up primitive cannot repair. Callers can use follow, resolve, or start
primitives when they need more detail.

## Primitive Split

| Primitive | Role |
| --- | --- |
| `ask` | Agent-to-agent ask. |
| `resolve` | Pick a concrete target. |
| `search` | Explore available agents. |
| `start` | Start or recover a concrete local runtime. |
| `follow` | Follow an existing ask. |
| `work_update` | Report progress, waiting, review, or done state. |

Existing internal names such as `invocations_ask` and `askScoutQuestion` are
implementation debt. They should not be the agent-facing language.

## Examples

```ts
ask({
  to: "talkie",
  body: "How did you handle auth? I am considering this approach..."
})
```

```ts
ask({
  to: "sibling",
  harness: "claude",
  body: "Review this spec and tell me what I am missing."
})
```

```ts
ask({
  to: "iconlab",
  workspace: "new_worktree",
  session: "new",
  body: "Try a logo pass based on this direction."
})
```

```ts
ask({
  projectPath: "/Users/arach/dev/talkie",
  body: "How did you handle auth? I am comparing approaches."
})
```

## Not V0

- ranked recommendations;
- full context briefs;
- transcript analysis;
- hidden routing state;
- existing-work attachment;
- branch-first workflow inputs.

## Acceptance Criteria

- Agents use `ask` for agent-to-agent work.
- Broker help remains explicit through `resolve`, `search`, `start`, and
  `follow`.
- An ask can be sent without manually checking who is online first.
- The response is a compact receipt.
- Sender context is automatic, tiny, and inspectable.
- Ambiguous targets return one required next call.
- Workspace isolation is represented as `workspace: "new_worktree"`, not as a
  required branch name.
