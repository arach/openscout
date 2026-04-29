# Quickstart

This is the shortest path from a fresh checkout to a first useful handoff with OpenScout. If you spend too much time copying prompts, re-explaining context, or checking multiple agent terminals by hand, this is the page to start with.

OpenScout gives you one broker-backed surface for your agents. That can be the CLI, the desktop app, or the iOS app when you want to check in away from your desk. The underlying state is the same, so a message or handoff you create in one place is still visible in the others.

If you only read two more pages after this one, read [`architecture.md`](./architecture.md) and [`agent-identity.md`](./agent-identity.md).

## 1. Bootstrap The Local Control Plane

Run the machine setup and health check:

```bash
scout setup
scout doctor
```

What healthy looks like:

- `scout setup` completes without errors, creates or updates local Scout settings, and starts the broker service.
- `scout doctor` reports that the broker is installed and reachable.
- If this repo is your working copy, the setup step should also discover the workspace and write the local project metadata when needed.

If you want the app surface as well:

```bash
bun install
bun run dev
```

That should bring up the desktop shell against the same local broker and runtime layer. The iOS app uses the same backing state, so it is useful when you want to check in, send a follow-up, or pick work back up without sitting at the desktop.

## 2. See Who You Are And What Exists

```bash
scout whoami
scout who
```

Use `scout whoami` to see who Scout will speak as from the current directory.
`send`, `ask`, and `broadcast` share that same sender unless you
override it with `--as`.
`watch` follows a conversation or channel; it does not choose a sender.

Use `scout who` to find an agent name you can actually address. If you do not
know a name yet, start here instead of guessing.

An agent name is the address you type to reach one agent. It is usually a short, human-friendly form, but it resolves to one exact identity before Scout sends anything.

## 2b. Use One Routing Model Everywhere

The routing rules do not change by surface:

- one target -> DM
- group coordination -> explicit channel
- everyone -> shared broadcast
- tell / update -> `send`
- owned work / requested reply -> `ask`
- follow-up stays in the same DM or explicit channel

## 3. Try The Two Main Paths

When the workspace and one target are clear, use the direct command first. Do
not run an orientation loop before every handoff.

```bash
scout send --to agent "hello"
scout ask --to agent "can you review this?"
```

`send` is the message path. Use it for a durable note or reply in a
conversation. This is the clean replacement for "paste the same update into
three terminals." It does not open a tracked flight.

`ask` is the invocation path. Use it when you want Scout to track a request for
work or a reply. An invocation creates a flight so the broker can follow that
work from start to finish, even if you switch devices or come back later.

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
- Agent name: the human-typed address for one agent. Scout resolves the short form to the exact identity the broker stores.

## If The First Pass Worked

That means you have the core loop:

1. The broker is running.
2. You know who Scout will act as from this directory.
3. Scout can see at least one agent name.
4. You can send a message or create an invocation from the CLI, desktop app, or iOS app.

From there, the next useful read is [`architecture.md`](./architecture.md) for the control-plane split, followed by [`agent-identity.md`](./agent-identity.md) when you want to understand why one name resolves and another does not.
