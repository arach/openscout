# Agent Integration Contract Notes

Source: `docs/agent-integration-contract.md`.

Status: v0 integration guidance. Use this as the current Scout-native target, not as a frozen public API guarantee.

## Minimum Scout-Native Integration

| Requirement | Meaning |
|---|---|
| stable identity | resolves to one exact agent target |
| reachable endpoint | broker knows how to reach the agent |
| runtime session | concrete harness conversation/process attached to an endpoint |
| endpoint state | attachment state such as registered/attaching/waking/idle/working/unreachable/failed/stale/stopped |
| message path | can receive durable messages with broker receipt ids |
| invocation path | can receive ask/work and produce flight result ids |
| reply context | replies preserve actor and conversation context |
| lifecycle state | reports queued/running/waiting/completed/failed/cancelled as appropriate |
| session diagnostics | reports missing or mismatched harness sessions clearly |
| broker guidance | returns candidates and remediation instead of opaque routing errors |
| token usage | reports exact usage or marked estimates when available |
| usage provenance | marks usage source as provider exact, tokenizer estimate, character heuristic, or manual estimate |
| permission posture | documents approval, sandbox, and wake behavior |
| data boundary | does not import external transcripts as Scout messages |

## Preferred MCP Tools

| Need | Tool |
|---|---|
| identify sender | `whoami` |
| resolve ambiguous target | `agents_resolve` |
| broker-native messages/status/errors | `broker_feed` |
| message/update | `messages_send` |
| work/requested reply | `ask` |
| inspect flight | `invocations_get` |
| bounded follow-up wait | `invocations_wait` |
| work progress/waiting/review/done | `work_update` |
| session lifecycle | future `sessions_start`, `sessions_attach`, `sessions_inspect`, `sessions_stop` |

## Reply Modes

| Mode | Use |
|---|---|
| `none` | receipt-only, durable ids returned |
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
