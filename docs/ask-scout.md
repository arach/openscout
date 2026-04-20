# Ask Scout

Scout manages your coding agents. You tell it what you want to work on once, and it helps you move that work between agents without copying context around.

The same broker-backed substrate that makes agent-to-agent coordination reliable also gives you a human-facing app surface. That means you can check in on the same agents from the CLI, the desktop app, or the iOS app when you are away from your machine.

## How it works

You open Scout and say:

> "Move the auth bug from one agent to another"

Scout finds the right project, starts or reuses the right agent session, and keeps the handoff visible. If there is already work in flight, you can continue it instead of reconstructing the context in a fresh terminal.

That is the point: one place to dispatch work, review progress, and keep track of what each agent is doing.

Most of the time, you should not need to micromanage sender IDs, harnesses, or
fully qualified agent handles. Scout should infer the current sender from your
working context, resolve the obvious target, and only interrupt you when the
remaining ambiguity would materially change the outcome.

## A Simple Handoff

You have one agent investigating a bug and another agent ready to implement the fix.

1. You ask the first agent to investigate the bug.
2. It returns the root cause and a short summary.
3. You send that summary to the second agent instead of retyping it.
4. You ask the second agent to make the change and keep the request tracked.

That replaces a manual loop of copying the summary, finding the right terminal, and re-establishing context by hand.

## Examples

**Start something new**
> "Refactor the auth middleware in openscout"

Scout creates a new branch, starts an agent on it, and gives you a session. Your main branch is untouched.

**Check on something**
> "Is the billing agent done?"

Scout checks: "Finished 5 minutes ago. 8 files changed, tests passing. Want to review?"

**Switch context**
> "Go back to the API work"

Scout finds your most recent API session and switches to it.

**Multitask**
> "Start a codex agent on the frontend while I keep working here"

Scout spins it up in the background. You get a notification when it is ready.

## From your phone

Scout works on your phone too. Same agents, same state, same work in flight. If you are away from your desk, you can check status, send a follow-up, or start the next handoff from the iOS app.

## Voice

Long-press the mic to talk to Scout directly, even while you're in the middle of a session with an agent. Scout handles the meta - creating, switching, checking status - so you stay in flow.

## What Scout Handles For You

- **Which sender** - reuses the current agent or project context when it can, and lets you override it when you need to
- **Which project** - matches your description to your workspaces
- **Which agent runtime** - picks Claude Code, Codex, or whatever fits
- **Which branch** - creates a new one if needed, reuses existing if it makes sense
- **Which model** - uses sensible defaults, lets you override if you want
- **Isolation** - each agent gets its own working copy so they don't step on each other

## What You Handle

- Telling it what you want to work on
- Reviewing what agents did
- Deciding when to merge
