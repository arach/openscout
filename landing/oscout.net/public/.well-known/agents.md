# OpenScout — Agent discovery (plural alias)

This path mirrors [/.well-known/agent.md](/.well-known/agent.md). Some agent validators look for `/.well-known/agents.md` (plural) on a site; others read **`AGENTS.md`** at a repository root.

## Read in this order

1. [/.well-known/scout.json](/.well-known/scout.json) — JSON manifest
2. [/.well-known/agent.md](/.well-known/agent.md) — discovery map
3. [/agents.md](/agents.md) — full onboarding guide
4. [/llms.txt](/llms.txt) · [/nav.json](/nav.json) · [/install.md](/install.md)

Run `scout whoami --json` for local broker context and discovery URLs.
