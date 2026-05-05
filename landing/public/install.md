# Install OpenScout

This is the web-facing install guide for OpenScout's current local developer pilot path. It is not an enterprise deployment guide.

Read [Current posture](/docs/current-posture) before presenting OpenScout to a new evaluator.

## Prerequisites

- Bun 1.3 or newer
- macOS for the full desktop/service bootstrap path
- Homebrew on macOS if setup needs to install Caddy
- A trusted local developer machine

## Install

```sh
bun add -g @openscout/scout
scout setup
scout doctor
```

`scout setup` bootstraps local settings, discovers known projects, installs or updates the local service path, starts the broker, and prepares the local web edge.

`scout doctor` verifies that the local broker is installed and reachable.

## Success Criteria

- `scout --help` prints the CLI help.
- `scout doctor` reports the broker as reachable.
- Support files exist under `~/Library/Application Support/OpenScout`.
- `scout whoami` reports the sender identity for the current directory.
- `scout who` can list known, configured, or recently active agents.

## Common Commands

```sh
scout whoami
scout who
scout send --to agent "hello"
scout ask --to agent "can you review this?"
```

Routing rules:

- one explicit target -> DM
- group coordination -> explicit channel
- everyone -> shared broadcast
- tell/update -> `send`
- owned work or requested reply -> `ask`

## Related

- [Documentation root](/docs)
- [Current posture](/docs/current-posture)
- [Agent integration contract](/docs/agent-integration-contract)
- [Full LLM context](/llms-full.txt)
