# SCO-020: Background Ask Observation

## Status

Accepted for implementation.

## Proposal ID

`sco-020`

## Context

Scout asks are durable broker flights. The MCP `ask` tool returns `flightId`,
`conversationId`, optional `workId`, and follow links when it does not wait
inline.

The problem is that completion retrieval must not be overloaded onto ask submission:

- `replyMode: "none"` returns immediately, so the caller needs a direct MCP tool
  to check completion later.
- `replyMode: "inline"` waits for target acknowledgement or immediate terminal
  state, but it is still the submission call.
- `replyMode: "notify"` returns immediately, but depends on the MCP host keeping
  the server alive and surfacing custom notifications.

Long-running agent work should not require one open MCP request.

## Decision

Scout MCP asks should use a submit/observe/retrieve pattern.

`ask` creates the flight and returns durable handles. Follow-up MCP tools read
or briefly wait on that flight:

- `invocations_get({ flightId })` fetches the current broker flight state.
- `invocations_wait({ flightId, timeoutSeconds })` performs a caller-bounded
  wait and returns the latest state instead of making ask submission block
  indefinitely. The wait budget protects the caller connection; it does not
  cancel the broker flight or define ask success.

This preserves the existing broker model and keeps `replyMode: "inline"` as an
acknowledgement path, not the recommended completion path for long tasks.

## Goals

- Make long-running asks observable without blocking the original tool call.
- Give MCP hosts a reliable fetch-later path even when custom notifications are
  not surfaced.
- Keep the broker flight as the source of truth.
- Keep the first implementation independent of experimental MCP Tasks support.

## Non-goals

- Replacing broker flights with MCP Tasks.
- Requiring MCP clients to support custom notifications.
- Streaming every target agent token through the ask tool result.
- Changing broker routing semantics for ask delivery.

## V1 API

### `ask`

For long work, callers should use:

```json
{
  "to": "@hudson",
  "body": "Review the auth module.",
  "replyMode": "none"
}
```

The result includes durable identifiers:

```json
{
  "flightId": "flight-...",
  "conversationId": "dm...",
  "workId": "work-...",
  "followUrl": "http://127.0.0.1:..."
}
```

### `invocations_get`

Fetches current state:

```json
{
  "flightId": "flight-..."
}
```

Returns:

```json
{
  "found": true,
  "terminal": false,
  "flight": {
    "id": "flight-...",
    "state": "running",
    "summary": "Reviewing auth module"
  },
  "output": "Reviewing auth module"
}
```

### `invocations_wait`

Performs a bounded wait:

```json
{
  "flightId": "flight-...",
  "timeoutSeconds": 30
}
```

If the flight is still running when the caller wait budget elapses, the tool
returns the latest flight state with `waitStatus: "pending"` instead of failing
the whole tool call.

## Future Direction

Once MCP Tasks are stable enough across the hosts Scout cares about, the same
broker flight can be exposed as an MCP task:

- task id maps to `flightId`
- task status maps to flight state
- task result maps to `flight.output`
- task polling reads the broker snapshot or a broker flight endpoint

That should be an adapter layer over Scout flights, not a replacement for broker
flight state.

## Acceptance Criteria

- `ask` still returns durable `flightId` data for non-inline asks.
- `invocations_get` can fetch the latest state for a returned `flightId`.
- `invocations_wait` is bounded and returns latest state when the caller wait budget elapses.
- Inline ask remains available for acknowledgement and immediate completions.
- Tests cover non-blocking get and bounded wait behavior.
