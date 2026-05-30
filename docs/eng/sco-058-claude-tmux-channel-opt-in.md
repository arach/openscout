# SCO-058: Claude Tmux Channel Opt-In

## Status

Accepted.

## Proposal ID

`sco-058`

## Intent

Record how Scout-managed Claude Code tmux agents opt in to Claude Code
Channels for live broker message delivery.

The motivating case is a long-running Claude Code session in tmux. A different
agent posts a Scout message to that agent while the session is already open.
Without a native push path, the operator has to rely on polling, terminal nudges,
or manual inbox checks. Claude Code Channels give Scout a host-supported way to
push that broker message into the live session.

## Decision

Scout SHOULD support a Claude channel endpoint for Scout-managed Claude tmux
agents, but it MUST be explicitly enabled per runtime profile.

The enabling knob is:

```json
{
  "agent": {
    "runtime": {
      "profiles": {
        "claude": {
          "channelEnabled": true
        }
      }
    }
  }
}
```

The same setting can be applied through agent startup/update flows such as
`scout up <agent-or-path> --channel-enabled`.

When `channelEnabled` is true for the active Claude tmux profile, Scout injects
a bare `scout-channel` MCP server into the Claude launch command and enables it
with the research-preview development-channel flag:

```bash
claude --mcp-config '<scout-channel config>' \
  --dangerously-load-development-channels server:scout-channel
```

When `channelEnabled` is absent or false, Scout still starts the normal
tmux-backed Claude Code session and still pre-approves the ordinary Scout MCP
coordination tools, but it does not attach the channel server.

## Boundaries

This decision applies only to Scout-managed, interactive Claude Code sessions
using the tmux transport.

It does not apply to `claude_stream_json`. The stream-json path remains a
non-interactive runtime where Scout captures the final assistant response
through the adapter rather than pushing live broker messages into a human-facing
Claude Code UI.

It also does not make the channel endpoint canonical state. The broker remains
the canonical writer for Scout-owned messages, deliveries, invocations, flights,
bindings, work items, and endpoint registrations. The Claude channel is a live
delivery and attention endpoint.

## Rationale

Channels are useful but still research preview infrastructure. They carry prompt
injection risk because external broker messages are pushed directly into a live
Claude Code session. OpenScout's current posture is high-trust local developer
pilots, but even in that posture, a channel should be an explicit runtime choice
instead of a hidden default on every Claude session.

Per-profile opt-in keeps the behavior tied to the runtime that can actually use
it: Claude Code over tmux. It also lets a project run one Claude profile with
channels enabled and another harness or profile without channels.

The channel is configured as a bare MCP server named `scout-channel`, not as the
full `scout` MCP server. This avoids name collisions with the normal Scout MCP
tool server and keeps the Claude channel contract narrow: receive broker
messages, expose `scout_reply`, and expose `scout_send`.

## Delivery Model

When the channel server starts inside Claude Code, it resolves the current Scout
agent id, registers a `claude_channel` endpoint with the broker, subscribes to
the broker inbox stream, claims matching delivery items, emits
`notifications/claude/channel`, and acknowledges the delivery after the
notification is written to the stdio transport.

That acknowledgement means "written to the Claude Code channel transport." It
does not mean Claude has visibly processed the message. Claude Code's channel
notification API does not provide that host-level processing acknowledgement.

The channel server deduplicates by Scout message id inside the process so a
single message that is visible through multiple delivery paths does not produce
duplicate channel notifications in the same session.

## Research Preview Handling

During Claude Code Channels research preview, custom channels need the
development-channel flag. Scout therefore injects:

```bash
--dangerously-load-development-channels server:scout-channel
```

This is not a trust bypass for arbitrary code. It only bypasses Claude Code's
channel allowlist for the locally configured `scout-channel` server. Team and
Enterprise organization channel policy can still block the feature.

If the channel becomes allowlisted or Claude Code changes the preview mechanics,
Scout can change the launch activation while preserving the `channelEnabled`
profile setting.

## Acceptance

A conforming implementation should satisfy these checks:

- A Claude tmux launch with no `channelEnabled` setting does not include
  `scout-channel` MCP config or channel activation flags.
- A Claude tmux launch with `channelEnabled: true` includes the `scout-channel`
  MCP config and `server:scout-channel` activation.
- Repeated normalization does not duplicate the MCP config or channel activation.
- `claude_stream_json` launch arguments remain unchanged.
- The broker snapshot can show a separate live `claude_channel` endpoint for an
  enabled session.
- Broker message deliveries to that agent can be claimed by the channel server
  and pushed as Claude channel notifications.

## Related

- [SCO-030: Claude Code Tmux For Personal Dev Agents](./sco-030-claude-code-tmux-personal-dev-transport.md)
- [Harness MCP And Reply Delivery](./harness-mcp-reply-delivery.md)
- [SCO-039: Durable Invocation And Delivery Lifecycle](./sco-039-durable-invocation-and-delivery-lifecycle.md)
- [SCO-044: Operator Attention Policy And Progress Monitoring](./sco-044-operator-attention-policy-and-progress-monitoring.md)
