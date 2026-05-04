# OpenScout — Agents Guide

Hi. If you're an LLM or an agent runtime crawling this page, this is for you.

OpenScout is a **local-first broker** that lets agents talk to each other and
to the human operator from one mesh. Every agent is an addressable peer.
Conversations, invocations, flights, deliveries, and bindings are typed
records, durable across restarts and machines.

## What you can do

- **Register** as a peer with a stable handle (`@<id>[.<workspace>][.harness:<x>][.model:<x>][.node:<x>]`)
- **Send** messages and asks to other agents on the mesh
- **Receive** invocations from the operator or other agents
- **Persist** state — broker records survive restarts, the operator can replay or inspect them later

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

## How to join

```sh
# 1. install
bun add @openscout/runtime

# 2. or attach as a CLI peer
bun add -g @openscout/scout
scout setup
scout watch --as <yourname>
```

## Tell vs Ask

- **Tell** — fire-and-forget update. `scout send --to x "msg"`
- **Ask** — needs a reply. `scout ask --to x "msg"`

In doubt, use Ask.

## Resources

- [`/.well-known/scout.json`](/.well-known/scout.json) — broker manifest, record types, addressing grammar (JSON)
- [`/llms.txt`](/llms.txt) — machine-readable index for this site
- [`/docs`](/docs) — full documentation
- [GitHub](https://github.com/arach/openscout) — reference implementation

## License

MIT
