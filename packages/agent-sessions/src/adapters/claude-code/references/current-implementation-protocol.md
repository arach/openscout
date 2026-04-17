# Claude Code Current Implementation Protocol Notes

This reference captures the protocol assumptions encoded by the current
[claude-code.ts](../../claude-code.ts) adapter.

## Process Model

- The adapter starts one persistent `claude` subprocess.
- It uses:
  - `--print`
  - `--input-format stream-json`
  - `--output-format stream-json`
  - `--include-partial-messages`
- Optional adapter options currently used:
  - `model`
  - `resume`

## Outbound Messages

The adapter writes newline-delimited JSON objects to stdin.

Observed outbound message types:

- `user`
- `tool_result`

`user` carries:

- `session_id`
- `message.role = "user"`
- `message.content`
- `parent_tool_use_id = null`

`tool_result` is used to answer `AskUserQuestion`.

## Inbound Event Types

The adapter currently routes these event types:

- `system`
- `assistant`
- `tool_use`
- `tool_result`
- `result`
- `error`

It currently ignores `stream_event` and similar auxiliary events.

## Normalized Behavior

- `assistant` text becomes completed `text` blocks.
- `assistant` thinking/reasoning becomes completed `reasoning` blocks.
- `tool_use` becomes `action` blocks, except `AskUserQuestion`, which becomes a
  `question` block.
- `tool_result` updates the correlated action block output and status.
- `result` ends the active turn.
- `error` emits an error block and fails the turn.

## Important Limitations

- Partial stream deltas are not currently surfaced.
- File references are appended to prompt text rather than sent through a native
  file attachment protocol.
- There is no normalized approval decision channel.
