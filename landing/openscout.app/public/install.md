# Install OpenScout

This is the web-facing install guide for OpenScout's current local developer pilot path. It is not an enterprise deployment guide.

Read [Current posture](/docs/current-posture) before presenting OpenScout to a new evaluator.

## Prerequisites

- Bun 1.3 or newer
- macOS for the full desktop/service bootstrap path
- Homebrew on macOS if setup needs to install Caddy
- A trusted local developer machine

## Install

Use this published CLI path when you are evaluating Scout as a local pilot or
installing it onto a developer machine. Contributors working from the repository
should use the repo-local install path in the GitHub README.

One-liner (installs the CLI with bun, falling back to npm, and prints the next
steps):

```sh
curl -fsSL https://openscout.app/install | sh
```

Or the same path by hand:

```sh
bun add -g @openscout/scout
scout setup
scout doctor
```

`scout setup` bootstraps local settings, discovers known projects, installs or updates the local service path, starts the broker, and prepares the local web edge.

`scout doctor` verifies that the local broker is installed and reachable.

## Companion Host Integrations

Install OpenScout first, then add the host package for the tool you use:

| Host | Package | Install |
| --- | --- | --- |
| pi | [Pi Scout](https://github.com/arach/pi-scout) | `pi install git:github.com/arach/pi-scout` |
| Claude Code | [Claude Scout](https://github.com/arach/claude-scout) | `/plugin marketplace add arach/claude-scout` |
| Codex | [Codex Scout](https://github.com/arach/codex-scout) | `/plugin marketplace add arach/codex-scout` |
| Cursor | [Cursor Scout](https://github.com/arach/cursor-scout) | See the host-specific installer. |
| Hermes Agent | [Hermes Scout](https://github.com/arach/hermes-scout) | Install the Hermes plugin after Scout is healthy. |
| Herdr | [Herdr](https://github.com/ogulcancelik/herdr) | Install Herdr integrations for the agent hosts you use. |

These packages stay installable on their own while sharing the same Scout CLI,
broker, and protocol surface.

Some companion hosts are also Scout harnesses, and some are not. Hermes and
Herdr are first-class compatibility targets in the host integration layer, but
they are not valid `--harness` values unless a future adapter explicitly makes
them execution backends.

## Success Criteria

- `scout --help` prints the CLI help.
- `scout doctor` reports the broker as reachable.
- Support files exist under `~/Library/Application Support/OpenScout`.
- `scout whoami` reports the sender identity for the current directory.
- `scout who` can list known, configured, or recently active agents.

## First-Run Health Ladder

Use this as a stop/go sequence:

1. `scout --help`
2. `scout setup`
3. `scout doctor`
4. `scout whoami`
5. `scout who`
6. `scout send --to <agent-from-scout-who> "hello"`

If `scout who` lists no usable target, install the companion package for the
host you use or start/register an agent before sending work. If routing is
ambiguous, copy the fuller selector shown by `scout who`.

## Common Commands

```sh
scout whoami
scout who
scout send --to <agent-from-scout-who> "hello"
scout ask --to <agent-from-scout-who> "can you review this?"
```

Routing rules:

- one explicit target -> DM
- group coordination -> explicit channel
- everyone -> shared broadcast
- tell/update -> `send`
- owned work or requested reply -> `ask`

For long-running work, use callback-style semantics where the surface supports
it. MCP callers should use `replyMode: "notify"` when they want Scout to return
quickly and report back later.

## Related

- [Documentation root](/docs)
- [Host integrations](/docs/integrations)
- [Current posture](/docs/current-posture)
- [Agent integration contract](/docs/agent-integration-contract)
- [Full LLM context](/llms-full.txt)
