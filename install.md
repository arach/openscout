# Install OpenScout

This is the machine-readable install guide for agents and humans. It describes the current local developer pilot path, not an enterprise deployment path.

For maturity, trust, and license expectations, read [docs/current-posture.md](./docs/current-posture.md) before presenting OpenScout to a new evaluator.

## Prerequisites

- Bun 1.3 or newer
- macOS for the full desktop/service bootstrap path
- Homebrew on macOS if `scout setup` needs to install Caddy
- A trusted local developer machine

OpenScout is not currently a silent managed install, hardened multi-tenant runtime, or compliance-ready service.

## Install From The Published CLI Package

```bash
bun add -g @openscout/scout
scout setup
scout doctor
```

`scout setup` bootstraps local settings, discovers known projects, writes project metadata when needed, installs or updates the local launch agent, starts the broker service, and ensures the local web edge can run.

`scout doctor` verifies that the local broker is installed, reachable, and writing expected support files.

## Install From This Repo

```bash
bun install
npm --prefix packages/cli run build
(cd packages/cli && bun link)
scout --help
scout setup
scout doctor
```

To run the desktop development surface from the repo:

```bash
bun run dev
```

## Success Criteria

A healthy local pilot install has these properties:

- `scout --help` prints the CLI help.
- `scout doctor` reports the broker as reachable.
- Local support files exist under `~/Library/Application Support/OpenScout`.
- `scout whoami` reports the sender identity for the current directory.
- `scout who` can list known, configured, or recently active agents.
- `bun run dev` starts the local desktop shell when working from the repo.

## Support Footprint

The local bootstrap can create or use:

- `~/Library/Application Support/OpenScout/settings.json`
- `~/Library/Application Support/OpenScout/relay-agents.json`
- `~/Library/Application Support/OpenScout/logs`
- `~/Library/Application Support/OpenScout/runtime`
- a macOS launch agent for the local broker/service path
- optional Caddy files for the local web edge
- optional mesh or pairing configuration for multi-machine reachability

That footprint is appropriate for a trusted developer pilot. It should be disclosed before asking someone else to install Scout.

## Common First Commands

```bash
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

## Troubleshooting Pointers

- If the broker is not reachable, run `scout doctor` and follow the command it prints for the local service.
- If the CLI is missing, rebuild and relink `packages/cli`.
- If an agent name is ambiguous, run `scout who` or use the full resolved selector.
- If a long-running ask would block the caller, use callback-style semantics through `replyMode: "notify"` when using MCP.
- If a permission or approval prompt is trapped in one host UI, the host integration needs to forward that prompt into Scout; an MCP server cannot see prompts intercepted before the tool call.

## Related Docs

- [docs/quickstart.md](./docs/quickstart.md)
- [docs/current-posture.md](./docs/current-posture.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/agent-integration-contract.md](./docs/agent-integration-contract.md)
- [docs/operator-attention-and-unblock.md](./docs/operator-attention-and-unblock.md)
