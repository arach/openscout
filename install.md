# Install OpenScout

This is the machine-readable install guide for agents and humans. It describes the current local developer pilot path, not an enterprise deployment path.

For maturity, trust, and license expectations, read [docs/current-posture.md](./docs/current-posture.md) before presenting OpenScout to a new evaluator.

Related first-read docs:

- [README.md](./README.md) for the repo overview
- [docs/README.md](./docs/README.md) for the docs map
- [docs/quickstart.md](./docs/quickstart.md) for the first healthy local run
- [docs/integrations.md](./docs/integrations.md) for companion host packages

## Prerequisites

- Bun 1.3 or newer
- macOS for the full desktop/service bootstrap path
- Homebrew on macOS if `scout setup` needs to install Caddy
- A trusted local developer machine

OpenScout is not currently a silent managed install, hardened multi-tenant runtime, or compliance-ready service.

## Choose An Install Path

Use the published CLI package when you are evaluating Scout as a local pilot or
installing it onto a developer machine.

Use the repo-local path when you are contributing to this repository, testing
runtime changes, or building a host integration against the current checkout.

## Install From The Published CLI Package

```bash
bun add -g @openscout/scout
scout setup
scout doctor
```

`scout setup` bootstraps local settings, discovers known projects, writes project metadata when needed, installs or updates the local launch agent, starts the broker service, and ensures the local web edge can run.

`scout doctor` verifies that the local broker is installed, reachable, and writing expected support files.

## Companion Host Integrations

The OpenScout CLI and broker are the shared base layer. Host-specific packages
can then add native commands or MCP surfaces inside the agent tools where you
already work.

| Host | Package | Install |
| --- | --- | --- |
| pi | [Pi Scout](https://github.com/arach/pi-scout) | `pi install git:github.com/arach/pi-scout` |
| Claude Code | [Claude Scout](https://github.com/arach/claude-scout) | `/plugin marketplace add arach/claude-scout` |
| Codex | [Codex Scout](https://github.com/arach/codex-scout) | `/plugin marketplace add arach/codex-scout` |

Install these after `scout setup` and `scout doctor` pass. Each companion
package should use the installed `scout` CLI or the local broker rather than
vendoring OpenScout internals.

See [docs/integrations.md](./docs/integrations.md) for the current integration
map, repository links, and sibling-checkout guidance.

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

## First-Run Health Ladder

Use this as a stop/go sequence. Do not continue to routing until the earlier
checks pass.

1. `scout --help`
   If this fails, install the published CLI package or rebuild and relink
   `packages/cli` from this repo.
2. `scout setup`
   If this fails, fix the printed prerequisite or permission problem first.
   Setup owns local settings, project discovery, service installation, and the
   local web edge.
3. `scout doctor`
   If this fails, follow the service repair command it prints. A broker that is
   not reachable is not ready for `send`, `ask`, or the app surfaces.
4. `scout whoami`
   If this fails or reports the wrong sender, rerun setup from the intended
   project directory and inspect local project metadata.
5. `scout who`
   Use this only when you need a specific existing target. If you know the
   project and capability instead, skip naming and ask by project/harness.
6. `scout ask --project /path/to/repo --harness claude "can you review this?"`
   Scout should resolve or create a compatible worker and return durable
   follow-up handles. Use `scout send --to <agent-from-scout-who> "hello"`
   when the first test is a specific known agent.

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
scout send --to <agent-from-scout-who> "hello"
scout ask --project /path/to/repo --harness claude "can you review this?"
scout ask --to <agent-from-scout-who> "can you review this?" # when you mean that exact target
```

Routing rules:

- one explicit target -> DM
- group coordination -> explicit channel
- everyone -> shared broadcast
- tell/update -> `send`
- owned work or requested reply -> `ask`
- capability request -> `ask --project <path> --harness <runtime>`; do not guess generic names like `claude.main`
- continuity request -> use the returned `ref`, flight, conversation, work, or session handle

For long-running work, prefer callback-style semantics where the surface
supports it. MCP callers should use `replyMode: "notify"` when they want the
broker to return quickly and report back later.

## Troubleshooting Pointers

- If the broker is not reachable, run `scout doctor` and follow the command it prints for the local service.
- If the CLI is missing, rebuild and relink `packages/cli`.
- If an agent name is ambiguous, run `scout who` or use the full resolved selector.
- If `scout who` is empty, install the companion package for the host you use or
  start/register an agent before sending work.
- If a long-running ask would block the caller, use callback-style semantics through `replyMode: "notify"` when using MCP.
- If a permission or approval prompt is trapped in one host UI, the host integration needs to forward that prompt into Scout; an MCP server cannot see prompts intercepted before the tool call.

## Related Docs

- [docs/quickstart.md](./docs/quickstart.md)
- [docs/current-posture.md](./docs/current-posture.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/agent-integration-contract.md](./docs/agent-integration-contract.md)
- [docs/operator-attention-and-unblock.md](./docs/operator-attention-and-unblock.md)
