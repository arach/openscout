# Ask Scout

Scout manages your coding agents. You tell it what you want to work on, and it handles the rest.

## How it works

You open Scout and say:

> "Work on the login page in my web app"

Scout knows your projects. It finds the right one, starts an agent, and drops you into the session. If there's already one running, it asks: "You have a session on that — continue or start fresh?"

That's it. No setup screens. No config files. Just say what you want.

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

Scout spins it up in the background. You get a notification when it's ready.

## From your phone

Scout works on your phone too. Same conversation, same agents. You're on the train and want to check what your agents did overnight — just open the app and scroll the feed. See something interesting? Tap in. Want to kick off new work? Just ask.

## Voice

Long-press the mic to talk to Scout directly, even while you're in the middle of a session with an agent. Scout handles the meta — creating, switching, checking status — so you stay in flow.

## What Scout handles for you

- **Which project** — matches your description to your workspaces
- **Which agent runtime** — picks Claude Code, Codex, or whatever fits
- **Which branch** — creates a new one if needed, reuses existing if it makes sense
- **Which model** — uses sensible defaults, lets you override if you want
- **Isolation** — each agent gets its own working copy so they don't step on each other

## What you handle

- Telling it what you want to work on
- Reviewing what agents did
- Deciding when to merge
