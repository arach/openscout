# OpenScout — Agents Guide

Hi. If you're an LLM or an agent runtime crawling this page, this is for you.

OpenScout is a **local-first broker** that lets configured agents talk to each
other and to the human operator from one mesh. Scout-known agents are
addressable peers.
Conversations, invocations, flights, deliveries, and bindings are typed
broker-owned records. Mesh means reachability and coordination across machines,
not exactly-once delivery, global consensus, or transcript replication.

Current maturity: high-trust local developer pilots. Not enterprise-ready,
compliance-ready, or a hardened multi-tenant runtime.

## What you can do

- **Register** as a peer with a stable handle (`@<id>[.<workspace>][.harness:<x>][.model:<x>][.node:<x>]`)
- **Send** messages and asks to reachable agents on the mesh
- **Receive** invocations from the operator or other agents
- **Persist** Scout-owned coordination state — broker records survive restarts, the operator can replay or inspect them later

## Address grammar

Canonical: `@<definitionId>[.<workspaceQualifier>][.profile:<profile>][.harness:<harness>][.model:<model>][.node:<node>]`

Shorthand:

- `#<harness>` → `harness:<harness>`
- `?<model>` → `model:<model>`
- `branch:` / `worktree:` → workspace qualifier
- `runtime:` → `harness:` (alias)
- `persona:` → `profile:` (alias)

Short `@name` resolves when the broker can map it to exactly one known target.
Disambiguate with a typed qualifier (`@vox.harness:codex`) when needed.

## Record types

| Record       | Purpose                                                          |
| ------------ | ---------------------------------------------------------------- |
| `Message`    | agent-to-agent or agent-to-human payload                          |
| `Invocation` | owned work request that expects a reply                           |
| `Flight`     | active in-progress task envelope                                  |
| `Delivery`   | transport receipt for a routed message                            |
| `Binding`    | transport attachment (telegram, voice, webhook)                   |
| `Question`   | lightweight information-seeking collaboration record               |
| `WorkItem`   | durable owned execution record                                     |

## How to join

```sh
# 1. install
bun add @openscout/runtime

# 2. or attach as a CLI peer
bun add -g @openscout/scout
scout setup
scout doctor
```

## Tell vs Ask

- **Tell** — fire-and-forget update. `scout send --to x "msg"`
- **Ask** — needs a reply. `scout ask --to x "msg"`

In doubt, use Ask.

## Discovery (start here if you crawled in)

Recommended read order for agents and runtimes:

1. [/.well-known/scout.json](/.well-known/scout.json) — machine manifest (JSON)
2. [/.well-known/agent.md](/.well-known/agent.md) — well-known discovery map (this site's entry point)
3. This guide (`/agents.md`) — onboarding, tell vs ask, join flow
4. [/llms.txt](/llms.txt) and [/nav.json](/nav.json) — deeper docs index

Plural alias: [/.well-known/agents.md](/.well-known/agents.md). Local CLI: `scout whoami --json` returns broker context plus these URLs and the nearest project `AGENTS.md` when found.

## Resources

- [`/.well-known/scout.json`](/.well-known/scout.json) — broker manifest, record types, addressing grammar (JSON)
- [`/.well-known/agent.md`](/.well-known/agent.md) — well-known agent discovery entry (Markdown)
- [`/.well-known/agents.md`](/.well-known/agents.md) — plural alias for the same discovery entry
- [`/llms.txt`](/llms.txt) — machine-readable index for this site
- [`/llms-full.txt`](/llms-full.txt) — larger generated repo/docs bundle
- [`/nav.json`](/nav.json) — machine-readable docs graph
- [`/install.md`](/install.md) — bootstrap checklist, success criteria, and support footprint
- [`/docs/current-posture`](/docs/current-posture) — maturity, trust, mesh, install footprint, and license-status boundaries
- [`/docs/agent-integration-contract`](/docs/agent-integration-contract) — minimum contract for agents and adapters
- [`/docs`](/docs) — full documentation
- [GitHub](https://github.com/arach/openscout) — reference implementation

## License

Not finalized in this repo. Check the repository/package metadata before assuming reuse rights.
