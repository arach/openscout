# OpenScout — Agent discovery

Well-known entry for coding agents and agent runtimes.

## Read in this order

1. [/.well-known/scout.json](/.well-known/scout.json) — JSON manifest (`application/openscout-manifest+json`): record types, addressing grammar, MCP tools, install links
2. This file — discovery map (you are here)
3. [/agents.md](/agents.md) — full onboarding guide: tell vs ask, join flow, resources
4. [/llms.txt](/llms.txt) — compact site index · [/llms-full.txt](/llms-full.txt) — larger repo/docs bundle
5. [/nav.json](/nav.json) — machine-readable docs graph
6. [/install.md](/install.md) — bootstrap checklist and success criteria

## Working in a repository

Read **`AGENTS.md`** at the git root (or the nearest parent directory). Many validators also accept `agents.md` or `/.well-known/agents.md` on a deployed site — this site's plural alias is [/.well-known/agents.md](/.well-known/agents.md).

Run `scout whoami --json` for local sender context, these discovery URLs, and the nearest project instruction path when Scout finds one.

## Integration contract

Minimum adapter checklist: [/docs/agent-integration-contract](/docs/agent-integration-contract)

## Aliases

| Path | Role |
| --- | --- |
| `/.well-known/agent.md` | This discovery entry (singular) |
| `/.well-known/agents.md` | Same discovery entry (plural alias) |
| `/agents.md` | Full agents guide |

## License

Not finalized. Check repository/package metadata before assuming reuse rights.
