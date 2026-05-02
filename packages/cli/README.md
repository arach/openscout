# scout

> **Requires [Bun](https://bun.sh).** Scout uses Bun as its runtime. If you don't have it: `brew install bun`

Install:

```bash
bun add -g @openscout/scout
scout --help
```

`@openscout/scout` is the public package name. It installs the `scout` command and carries the bundled broker/runtime and web UI. Installing it does not start services; commands such as `scout setup`, `scout up`, and `scout server start` activate them explicitly.

## Canonical Flow

```bash
scout setup
scout doctor
scout whoami
scout who
scout latest
scout runtimes
scout ask --to dewey "can you review our docs?"
```

`scout setup` is the canonical onboarding entry point. It creates or updates:

- `~/Library/Application Support/OpenScout/settings.json`
- `~/Library/Application Support/OpenScout/relay-agents.json` for compatibility with the existing machine-local agent registry
- `.openscout/project.json` for the current repo when needed

It also discovers local and project-backed agents from your configured workspace roots, installs the broker service, and attempts to start it.

`scout init` writes `~/.openscout/config.json` with the broker, web, and pairing ports that every Scout component reads. Run it once after install, or with `--force` to overwrite.

When the input is not a known subcommand and includes exactly one `@agent` mention, Scout treats it as an implicit `ask` and waits for the reply. For example:

```bash
scout @dewey can you review our docs?
scout hey @hudson please inspect the failing test
scout --as vox --timeout 900 @talkie take another pass on the keyboard port
```

## One Routing Model

The routing rules do not change by harness, UI, or host:

- one target -> DM
- group coordination -> explicit channel
- everyone -> `scout broadcast`
- tell / update -> `scout send`
- owned work / requested reply -> `scout ask`
- follow-up stays in the same DM or explicit channel

When sender, target, or recent activity is unclear, the shortest orientation loop is:

```bash
scout whoami
scout who
scout latest
```

### Sender identity

`scout send`, `scout ask`, and `scout broadcast` all use the
same default sender identity. Most of the time you should let Scout infer it
from your current context. For agent-to-agent delegation, check `scout whoami`
first and use `--as` whenever the acting project agent must be preserved
explicitly across shells, hosts, or bridges.

`scout watch` follows a conversation or channel; it does not choose a sender.

Inspect the current default once:

```bash
scout whoami
```

Default sender resolution is:

1. `--as <agent>` for that command
2. `OPENSCOUT_AGENT` when the current session already has a bound agent
3. the current project-scoped sender inferred from your working directory
4. your operator name when you're outside a project context

That keeps ordinary collaboration simple:

```bash
scout send --to vox "heads up: I’m on the runtime side"
scout ask --to vox "can you confirm the broker fix?"
```

Known on-demand or offline agents are supposed to wake on first delivery. `scout send` and `scout ask` should be the default path; `scout up` is for explicit prewarming or for creating/registering a target the broker does not know yet.

Prefer `scout send --to <agent> "message"` for tells. Legacy
`scout send "@agent message"` remains for compatibility, but it makes the
message body participate in route discovery. With `--to`, quoted handles inside
the text stay text.

### File-backed input

Use a file when the primary prompt or message is too large or too structured to
belong in shell argv.

Nomenclature:

- **Prompt file**: the primary work prompt for `scout ask`; pass it with `--prompt-file <path>`.
- **Message file**: the message body for `scout send`, `scout broadcast`, or `scout speak`; pass it with `--message-file <path>`.
- **Body file**: shared alias for either command family; `--body-file <path>` reads the same UTF-8 text into the broker `body` field.

Examples:

```bash
scout ask --to hudson --prompt-file ./handoff.md
scout @hudson --prompt-file ./review-request.md
scout send --channel triage --message-file ./status-update.md
scout broadcast --message-file ./maintenance-window.md
```

The file is read locally before dispatch. The local broker still receives one
structured request containing the target, body, sender, routing fields, and
metadata, so the rest of the broker and mesh path can choose the right transport
without depending on shell argument size.

### One-to-one delegation

When one project agent is delegating concrete work to one other agent, treat it
as a private handoff:

- keep it in a DM, not `channel.shared`
- preserve the acting project agent as the sender
- keep progress and completion in that same DM

Today the best CLI surface for that handoff is `scout ask`, because it opens a
DM by default when no explicit channel is pinned:

```bash
scout whoami
scout ask --to hudson "Build the editable CodeViewer and report back with the integration-ready surface."
```

If the invoking shell or host path might not already be bound to the acting
project agent, make it explicit:

```bash
scout ask --as premotion.master.mini --to hudson "Build the editable CodeViewer and report back with the integration-ready surface."
```

Use `channel.shared` only when the work is genuinely for a group, not for a
single owner.

### Addressing specific agents

Agent identity has six dimensions: `definitionId`, workspace qualifier, `profile`, `harness`, `model`, `node`. Canonical form:

```
@<definitionId>[.<workspaceQualifier>][.profile:<profile>][.harness:<harness>][.model:<model>][.node:<node>]
```

Short `@name` only resolves when exactly one matching agent is available from the current context. If multiple agents share a name (e.g. one Codex-backed, one Claude-backed), pin the dimension you care about with a typed qualifier:

```bash
scout send --to vox.harness:codex "message from hudson: please retry the build"
scout ask --to vox.harness:claude "what did the reviewer flag?"
scout ask --to arc.profile:reviewer "take another pass"
scout ask --to vox.harness:codex.node:mini "run locally on mini"
scout ask --to lattices#codex?5.5 "take task A"
scout ask --to lattices#claude?sonnet "take task B"
```

Aliases: `runtime:` = `harness:`, `persona:` = `profile:`, `branch:` / `worktree:` = workspace qualifier. Shorthand `#codex` maps to `harness:codex`; `?sonnet` or `?5.5` maps to `model:<model>`. Dimensions combine in any order.

If direct send/ask still comes back unresolved, treat that as a routing problem, not a mere "target is offline" problem. The right follow-up is to disambiguate the target, inspect broker context with `scout who` / `scout latest`, or create/register the missing identity. Do not default to pushing the bring-up step back onto the operator for a known target.

By default, a label handoff such as `@openscout.harness:claude` should mean
"use the OpenScout identity on the Claude harness in a fresh session/context."
Reusing an existing session is an explicit continuity choice, not the default.
The broker should keep the stable agent name as the address and record the
concrete session binding in the delivery receipt/history.

Session refs are separate route targets for continuing a concrete bound
session. Use the bare `ref:<suffix>` form in receipts/history, and pass the
suffix with `--ref`; do not encode refs into `@agent#harness?model` identity
syntax.

```bash
scout ask --ref 7f3a9c21 "continue from that handoff"
scout send --ref 7f3a9c21 "status for that same session"
```

Receipts should name both layers, for example:

```text
sent to @openscout#claude via DM (ref:7f3a9c21)
```

## Current Commands

```bash
scout --help
scout version
scout doctor
scout setup
scout runtimes
scout whoami
scout send
scout speak
scout ask
scout watch
scout who
scout latest
scout enroll
scout broadcast
scout up
scout down
scout ps
scout restart
scout menu
scout pair
scout server start
scout server open
scout tui
```

### Menu Bar App (`scout menu`)

On macOS, `scout menu` is the quick launcher for the native menu bar app.

```bash
scout menu
scout menu status
scout menu restart
scout menu quit
```

If you run it from an OpenScout repo checkout, Scout prefers the repo helper at
`apps/macos/bin/openscout-menu.ts`, so it can auto-build and launch the app bundle for you.
Outside the repo, it opens an installed `OpenScout Menu` app when available.

### Web UI (`scout server start`, `scout server open`)

Runs the current OpenScout web UI used by the repo’s `bun run dev` entry. **Bun must be on your PATH.** Published CLI builds ship `dist/scout-control-plane-web.mjs` and `dist/client/` (Vite build); when `dist/client/index.html` is present, **`scout server start` defaults to static assets** unless you pass `--vite-url` to proxy a dev server.

```bash
scout whoami
scout who
scout latest
scout server open
scout server start
scout server start --port 3200
scout server open --path /agents/arc-codex-2.master.mini
scout server start --public-origin https://scout.local
scout server edge --local-name m1
scout server start --vite-url http://127.0.0.1:43173   # SPA dev server
scout server start --static --static-root /custom/client
```

`scout server open` reuses an already-running matching Scout server on that port, or starts one in the background and opens the browser for you. Use `scout server` or `scout server help` for full flags.

The application server binds to `0.0.0.0` by default, treats `scout.local` as the local portal name, and derives the node URL as `<machine>.scout.local` unless the user configures a short alias such as `m1`. `scout server edge` publishes `scout.local` plus the node host with Bonjour/mDNS and runs Caddy against the active web port. The managed edge serves HTTP on port `80` for zero-cert local browsing and HTTPS on port `443` with Caddy's local CA; the HTTPS path needs the local CA trusted once by browsers that enforce their own trust store.

`packages/web` remains the internal web workspace. Published installs get that same server and client through `@openscout/scout`.
