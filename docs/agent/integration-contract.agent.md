# Agent Integration Contract Notes

Source: `docs/agent-integration-contract.md`.

Status: v0 integration guidance. Use this as the current Scout-native target, not as a frozen public API guarantee.

## Minimum Scout-Native Integration

| Requirement | Meaning |
|---|---|
| stable identity | resolves to one exact agent target |
| reachable endpoint | broker knows how to reach the agent |
| message path | can receive tell/update |
| invocation path | can receive ask/work and produce flight result |
| reply context | replies preserve actor and conversation context |
| lifecycle state | reports queued/running/waiting/completed/failed/cancelled as appropriate |
| permission posture | documents approval, sandbox, and wake behavior |
| data boundary | does not import external transcripts as Scout messages |

## Preferred MCP Tools

| Need | Tool |
|---|---|
| identify sender | `whoami` |
| resolve ambiguous target | `agents_resolve` |
| tell/update | `messages_send` |
| work/requested reply | `invocations_ask` |
| inspect flight | `invocations_get` |
| bounded follow-up wait | `invocations_wait` |
| work progress/waiting/review/done | `work_update` |

## Reply Modes

| Mode | Use |
|---|---|
| `none` | fire and forget, durable ids returned |
| `inline` | short bounded wait only |
| `notify` | return quickly, deliver callback-style MCP notification later |

## Routing Rules

- one target -> DM
- group -> explicit channel
- everyone -> shared broadcast
- body text is payload, not routing metadata
- follow-up stays in same DM/channel/work item

## Human Dependency Rules

- Agent question -> question path.
- Action approval -> approval/action state.
- Durable work blocked on a person -> work item `waiting`.
- Host-level permission prompt -> host integration must forward to Scout; MCP server cannot see a prompt intercepted before tool call.
