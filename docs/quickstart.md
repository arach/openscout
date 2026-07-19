# Quickstart

This is the shortest path from a fresh checkout to a first useful handoff with OpenScout. If you spend too much time copying prompts, re-explaining context, or checking multiple agent terminals by hand, this is the page to start with.

OpenScout gives you one broker-backed surface for your agents. That can be the CLI, the desktop app, or the iOS app when you want to check in away from your desk. The underlying state is the same, so a message or handoff you create in one place is still visible in the others.

If you only read three more pages after this one, read [`current-posture.md`](./current-posture.md), [`architecture.md`](./architecture.md), and [`agents-and-collaboration.md`](./agents-and-collaboration.md).

## 1. Bootstrap The Local Control Plane

Run the machine setup and health check. If `scout` is not on your PATH yet,
use the published or repo-local install path in [`../install.md`](../install.md)
first.

```bash
scout setup
scout doctor
```

For a CLI-only first run, set the same onboarding inputs the app wizard saves:

```bash
scout config set name "Ada"
scout setup --source-root ~/dev --default-harness codex
scout runtimes
```

What healthy looks like:

- `scout setup` completes without errors, creates or updates local Scout settings, and starts the broker service.
- `scout doctor` reports that the broker is installed and reachable.
- `scout runtimes` shows at least one ready harness, such as Claude Code or Codex.
- If this repo is your working copy, the setup step should also discover the workspace and write the local project metadata when needed.

If you want the app surface as well:

```bash
bun install
bun run dev
```

That should bring up the desktop shell against the same local broker and runtime layer. In pilot setups where mobile pairing is configured, the iOS app uses the same backing state, so it is useful when you want to check in, send a follow-up, or pick work back up without sitting at the desktop.

## 2. See Who You Are And What Exists

```bash
scout whoami
scout who
```

Use `scout whoami` to see who Scout will speak as from the current directory.
`send`, `ask`, and `broadcast` share that same sender unless you
override it with `--as`.
`watch` follows a conversation or channel; it does not choose a sender.

Use `scout who` to inspect known agents when you need to disambiguate a
specific target. If you know the project and desired capability but not the
right concrete worker, skip manual discovery and route the ask by project and
harness instead:

```bash
scout ask --project ../talkie --harness claude "can you review this?"
```

That is the lower-churn default: project + capability first, broker-routed
worker second. Do not guess generic handles such as `claude.main`. The broker
receipt should give you durable follow-up handles such as a `ref`, `flightId`,
`conversationId`, `workId`, or `session:<id>`, and may also show a friendly
mnemonic target handle for the dispatched worker. Humans type that as
`target:<name>`; agents and compact UI may render the same handle as `⌖name`.

An agent name is the address you type to reach a base agent. It is usually a
short, human-friendly project/workspace identity. Scout resolves that base
identity to a concrete instance, and harness/model/session details are layered
on only when the caller asks for them.

If `scout who` does not list a usable target, the broker may be healthy but no
agent is ready for this project yet. Install the companion integration for your
host from [`../install.md`](../install.md#companion-host-integrations), or
start/register an agent before trying to route work.

## 3. Use One Routing Model Everywhere

The routing rules do not change by surface:

- one target -> DM
- group coordination -> explicit channel
- everyone -> shared broadcast
- tell / update -> `send`
- owned work / requested reply -> `ask`
- capability request -> `ask --project <path> --harness <runtime>`
- continuity request -> returned `ref`, flight, conversation, work, or session handle
- named long-lived sibling -> promote/pin a routed worker after it proves useful
- follow-up stays in the same DM or explicit channel

## 4. Try The Two Main Paths

When the workspace and one target are clear, use the direct command first. Do
not run an orientation loop before every handoff. Copy a selector from
`scout who` only when you mean that exact target. Use `--project` plus optional
`--harness` when the repo/capability is the thing you actually know.

```bash
scout send --to <agent-from-scout-who> "hello"
scout ask --to <agent-from-scout-who> "can you review this?"
scout ask --project ../talkie --harness claude "can you review this?"
scout ask --ref 7f3a9c21 "follow up in the routed worker"
```

`send` is the message path. Use it for a durable note or reply in a
conversation. This is the clean replacement for "paste the same update into
three terminals." It does not open a tracked flight.

`ask` is the invocation path. Use it when you want Scout to track a request for
work or a reply. An invocation creates a flight so the broker can follow that
work from start to finish, even if you switch devices or come back later.

For long-running MCP asks, use `replyMode: "notify"` when you want the caller
to return quickly and receive completion as a callback notification. Use
`replyMode: "inline"` when the caller needs the target acknowledgement before
continuing, then follow completion with `invocations_get` or
`invocations_wait`.

Concrete handoff example:

1. You ask one agent to investigate a bug.
2. That agent replies with a summary and a next step.
3. You `send` that summary to another agent instead of retyping it.
4. You `ask` the second agent to take the follow-up, and Scout keeps the request tracked.

## Plain-Language Model

- Broker: the local canonical store and router. It keeps the records, decides where they go, and survives restarts.
- Runtime: the machine-local service layer that starts agents, checks health, manages harness adapters, and feeds the broker.
- Message: a durable conversation record. It is what you send when the goal is "say this" or "reply to that."
- Invocation: a tracked request for work. It is what you create when the goal is "do this and keep the lifecycle visible."
- Flight: the lifecycle record attached to an invocation.
- Agent name: the human-typed address for one agent. Scout resolves the short form to the exact identity the broker stores. Prefer broker-suggested names for promoted workers instead of inventing generic names.

For the full vocabulary — and where it maps onto open protocols — read [`concepts.md`](./concepts.md).

## If The First Pass Worked

That means you have the core loop:

1. The broker is running.
2. You know who Scout will act as from this directory.
3. Scout can see at least one agent name.
4. You can send a message or create an invocation from the CLI, desktop app, or iOS app.

From there, the next useful read is [`architecture.md`](./architecture.md) for the control-plane split and the address grammar (why one name resolves and another does not), followed by [`agents-and-collaboration.md`](./agents-and-collaboration.md) for how owned work moves between agents.

If you are evaluating Scout for a pilot, read [`current-posture.md`](./current-posture.md) before assuming enterprise-grade security, licensing, or operational maturity.
