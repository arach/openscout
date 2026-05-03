---
name: scout
description: Use the Scout CLI for agent-to-agent chat via the broker. Trigger this whenever an agent needs to tell, ask, or fan out a message to another agent from the shell, including any `/scout` request with one or more `@agent` mentions.
metadata:
  short-description: Use the scout command from the shell
---

# Scout CLI

Use Scout when you need shared coordination state, not just message delivery.

Baseline agent-to-agent communication should be one command:

```bash
scout send --to x "msg"    # tell/update; no reply needed
scout ask --to x "msg"     # work/question; reply needed
```

When the workspace is known and there is one intended recipient, use that direct path first. Do not run `whoami`, `who`, or `latest` unless the sender is unclear, the target is ambiguous, or the command fails.

Scout can answer four questions when the route is not already obvious:

1. Who am I here?
2. Who is around?
3. What is the latest?
4. Do I need the full live UI?

Treat that as an orientation loop, not a mandatory preflight.

## Resolve the CLI only when needed

If `scout` is missing from `PATH`, locate the binary:

```bash
scout env --json
```

If `scout` is not on `PATH`, or the installed `scout` on `PATH` is stale for this checkout, use:

```bash
bun /Users/arach/dev/openscout/packages/cli/bin/scout.mjs env --json
```

## Fast path

When the workspace is known and there is one intended recipient, do not burn extra commands on orientation first.

- CLI tell: `scout send --to x "msg"`
- CLI ask: `scout ask --to x "msg"`
- Known offline / on-demand agents are supposed to wake on first delivery. Do not ask the operator to bring up a known target just to send the first message.

The broker/runtime should return durable ids such as `conversationId`, `messageId`, `flightId`, or `workId`. Use those handles for follow-up. Only fall back to orientation when the route is ambiguous or the sender context is wrong.

Use `scout send --to ...` instead of placing the route inside the message body. Legacy `scout send "@x msg"` exists for compatibility, but body mention parsing can turn quoted agent names into route candidates. With `--to`, text such as `@codex` inside the body remains payload.

## Orientation loop

Run the smallest command that answers the uncertainty:

```bash
scout whoami       # sender unclear
scout who          # target unknown or ambiguous
scout latest       # recent activity needed
scout server open  # full UI needed
```

Interpret them like this:

- `scout whoami` answers identity and default routing context from the current workspace.
- `scout who` answers who is online, discovered, or recently active.
- `scout latest` answers recent broker activity without making you tail raw logs.
- `scout server open` opens the full UI and will start the server if it is not already running.

Use the web UI when you need conversation history, multiple agents at once, or spatial context.

## One true paths by surface

The semantics do not change by host. Only the verbs change:

| Meaning | CLI | MCP | Venue rule |
| ------- | --- | --- | ---------- |
| Resolve who you are | `scout whoami` | `whoami` | use when sender context is unclear |
| Find or confirm a target | `scout who`, `scout latest`, `scout @x...` disambiguation | `agents_search`, `agents_resolve` | use when direct routing is ambiguous |
| Tell / status / reply | `scout send --to x "msg"` | `messages_send` with explicit target fields | one target -> DM |
| Owned work / requested reply | `scout ask --to x "msg"` | `invocations_ask` with explicit target fields | one target -> DM |
| Progress / waiting / review / done | same DM, plus work handle when available | `work_update` | stay in the same DM or channel |
| Fresh reply-ready identity | `scout card create` | `card_create` | project-scoped inbox |
| Everybody on this broker | `scout broadcast` | `messages_send` with `channel="shared"` | shared broadcast only |

Do not invent a second routing model for Claude, Codex, the CLI, MCP, or the UI. The same rules apply everywhere:

- one target -> DM
- group coordination -> explicit channel
- everyone -> shared broadcast
- tell/update -> send
- owned work / requested reply -> ask
- follow-up stays in the same DM or explicit channel
- message body text is payload, not routing metadata

## Frequent questions

Map common operator/agent questions to one command:

| Question                        | Command                                             |
| ------------------------------- | --------------------------------------------------- |
| "Who am I?"                     | `scout whoami`                                      |
| "Who's around?"                 | `scout who`                                         |
| "What's the latest?"            | `scout latest`                                      |
| "Open Scout"                    | `scout server open`                                 |
| "Open a specific page in Scout" | `scout server open --path /agents/<agent-or-route>` |

Do not make agents rediscover these patterns from scratch. Teach them as the default Scout muscle memory.

## Routing is decided by addressee count, not verb

Scout has three destinations: **DM**, **named channel**, **shared broadcast**. Pick by who the message is for:

| Situation                            | Destination             | Command                                           |
| ------------------------------------ | ----------------------- | ------------------------------------------------- |
| You're addressing one specific agent | DM (two-party, private) | `scout send --to x "msg"` or `scout ask --to x "msg"` |
| You're posting into a named channel  | that channel            | `scout send --channel foo "msg"`                  |
| You want every agent to see it       | `channel.shared`        | `scout broadcast "msg"`                           |

`channel.shared` is a broadcast surface, not a default. A pointed `@x` message is a DM. Do **not** rely on implicit fallback to `channel.shared`; if you do not name an addressee, or you name several addressees without an explicit channel, the command is wrong.

## One-to-one work handoff

When one project agent is asking one other agent to do concrete work, the correct default is:

1. Keep the exchange in a DM
2. Preserve the acting agent identity
3. Keep progress, review, and completion in that same DM
4. Resolve the acting sender with `scout whoami` only if the host cannot preserve it from the current workspace

This is the common failure mode to avoid:

- the work is really from Premotion to Hudson
- but the broker record looks like it came from the human operator
- or the metadata makes it look shared/public even though the route was actually private

Use this pattern instead:

```bash
scout ask --to hudson "Build the editable CodeViewer and report back with the integration-ready surface."
```

If the shell or host path might not preserve the acting agent identity automatically, make it explicit:

```bash
scout ask --as premotion.master.mini --to hudson "Build the editable CodeViewer and report back with the integration-ready surface."
```

Until Scout has a first-class work-handoff CLI surface, use a DM `ask` for one-to-one delegation and phrase the task as owned work, not as a public channel update.

If the ask returns a `workItem` / `workId`, treat that as the durable handle for the delegated work:

- keep the conversation in the same DM
- update the same work item when the state materially changes
- append meaningful progress, waiting, review, or done transitions instead of minting a second record

When the Scout MCP tools are available, use `work_update` to keep that handle current.

## Broker reply mode

When a turn contains `SCOUT BROKER REPLY MODE`, a `ScoutReplyContext` block,
or an active Scout MCP reply context, you are answering an inbound broker ask.
This is a reply lifecycle, not a new outbound message.

Default behavior for direct broker-invoked asks:

- your final assistant response is the broker-visible reply
- do not call `scout send`, `messages_send`, or `invocations_ask` to answer the requester
- only use Scout tools if you need to ask or delegate to another agent while solving the request
- return only the reply intended for the requester

If the active reply context says `replyPath: mcp_reply`, use the provided
reply tool (for example `messages_reply` or `scout_reply`) instead of relying
on final-response capture. If there is no active reply context, use normal
Scout routing: `messages_send`/`scout send` for tells and
`invocations_ask`/`scout ask` for asks.

## Tell vs Ask

Scout has two coordination modes. Choose intentionally.

### Tell

Use **Tell** when no reply is needed.

Phrasing:

- "tell @x ..."
- "let @x know ..."
- "@x done with X"
- status updates

Command:

```bash
scout send --to x "msg"
```

This is inline, fire-and-forget, and lands in the `@x` DM.

### Ask

Use **Ask** when a reply, judgment, or investigation is needed.

Phrasing:

- "ask @x ..."
- "@x can you check ...?"
- anything ending in `?`
- slow targets
- multi-turn follow-up

Command:

```bash
scout ask --to x "msg"
```

If your host has a background worker or subagent primitive, **run Ask there instead of blocking the parent**. The parent should keep working and surface the reply when the background task completes.

Prompt shape for the background worker:

```text
Run: scout ask --to hudson "<your question>"
Return the reply text only.
```

Inline `scout ask` is acceptable only when your host cannot delegate background work.

## Fan-out and broadcast

### Fan-out

If the user's message contains multiple `@name` mentions, do not send one ambiguous multi-target post without an explicit channel.

Choose one of these on purpose:

- send one Scout action per target and keep those DMs separate
- or create/use a named channel if the user explicitly wants group coordination
- or use `scout broadcast` if the message is truly for everyone

### Broadcast

For true broadcasts use `scout broadcast`:

```bash
scout broadcast "shipping 0.3.0 in 15min, pause long flights"
```

Confirm with the user before broadcasting to more than 4 targets.

## Addressing

Agent identity has six dimensions: `definitionId`, `workspaceQualifier`, `profile`, `harness`, `model`, `node`. Canonical form:

```
@<definitionId>[.<workspaceQualifier>][.profile:<profile>][.harness:<harness>][.model:<model>][.node:<node>]
```

When a short `@name` could match multiple live agents, pin the dimension you care about with a typed qualifier:

- `@vox.harness:codex` — the Codex-backed Vox
- `@vox.harness:claude` — the Claude-backed Vox
- `@lattices#codex?5.5` — shorthand for the Codex-backed Lattices on a 5.5 model
- `@lattices#claude?sonnet` — shorthand for the Claude-backed Lattices on Sonnet
- `@arc.profile:reviewer` — the reviewer profile of Arc
- `@vox.harness:codex.node:mini` — fully qualified across machines

Aliases:

- `runtime:` = `harness:`
- `persona:` = `profile:`
- `branch:` / `worktree:` = workspace qualifier
- `#<harness>` = `harness:<harness>`
- `?<model>` = `model:<model>`

Use typed qualifiers or shorthand any time the user's request implies a specific harness, model, or profile. Do not rely on short-name resolution to guess right.

Product handles are reserved. Do not treat `@scout` or `@openscout` as aliases for a normal orchestration persona. For the local product inbox, use `scout send --to scout "..."`; the broker owns any legacy/internal aliasing. Use `@ranger` only when the user specifically needs Ranger-style orchestration.

## Resolution rule

Short `@name` should resolve when the broker can map it to **exactly one known target**.

Offline / on-demand is still routable. The broker should register the target if needed and wake it on first send / ask.

If `scout send --to x "..."` or `scout ask --to x ...` returns `unresolved`, treat that as **route unclear or target unknown in the current broker context**, not as proof the target is merely offline.

If the CLI reports multiple candidates, re-run with a typed qualifier. If the route still fails, options are:

- Inspect the route: `scout who`, `scout latest`, or `scout server open`
- Disambiguate with a typed qualifier: `@x.harness:codex`
- Use the full FQN: `@x.host.x-main-abc123`
- Create a fresh project-scoped identity when needed: `scout card create`
- Use `scout up` only when you are explicitly prewarming a target or registering one the broker truly does not know yet
- Tell the user the route is ambiguous or the target is unknown; do not ask them to manually bring up a known target just to deliver a message

## Decision rule

Use **Ask** by default when the next sentence is effectively:

- "Do this and get back to me."
- "Investigate this and tell me what you found."
- "Take ownership of the next step."
- "Review this and return a judgment."

Use **Tell** when the next sentence is effectively:

- "Heads up."
- "I am working on this now."
- "Please note this constraint."
- "You can ignore the earlier path."

When in doubt, use Ask.

## Dedicated agent cards

Use `scout card create` when you need a project-scoped relay identity with its own inbox and return address.

Use it when:

- you are in a worktree and want the agent bound to that exact path and branch
- you need a dedicated alias instead of reusing a shared project agent
- you want to hand another agent a clean reply target immediately

Examples:

```bash
scout card create
scout card create ~/dev/openscout-worktrees/shell-fix --name shellfix --harness claude
```

After creating the card, prefer the friendly handle such as `@shellfix`.

## Compatibility notes

- `scout relay ask` and `scout relay send` are accepted as namespace aliases. Do not use them in new prompts.
- `scout` is the canonical CLI binary. Do not use `openscout` in new prompts or examples.
- Legacy `scout send "@x msg"` is accepted as body-mention shorthand. Do not use it in new prompts when a structured target field is available.
- For agent-to-agent delegation, rely on the current workspace identity by default. Check `scout whoami` and use `--as <agent>` only when the acting project agent might not be preserved by the host, shell, or bridge.

## When not to use Scout

- Do not use Scout for work inside the same agent when no cross-agent communication is needed.
- Do not invent ad hoc retry loops in prompts when the background worker already gives you tracked waiting.
- Do not read the broker's internal storage directly. Go through the `scout` CLI or Scout web UI.
