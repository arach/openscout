# scout

> **Requires [Bun](https://bun.sh).** Scout uses Bun as its runtime. If you don't have it: `brew install bun`

Install:

```bash
bun add -g @openscout/scout
scout --help
```

`@openscout/scout` is the published package name. It installs the `scout` command and depends on `@openscout/runtime` for the local broker service.

## Canonical Flow

```bash
scout setup
scout doctor
scout runtimes
scout @dewey can you review our docs?
```

`scout setup` is the canonical onboarding entry point. It creates or updates:

- `~/Library/Application Support/OpenScout/settings.json`
- `~/Library/Application Support/OpenScout/relay-agents.json`
- `.openscout/project.json` for the current repo when needed

It also discovers relay agents from your configured workspace roots, installs the broker service, and attempts to start it.

`scout init` writes `~/.openscout/config.json` with the broker, web, and pairing ports that every Scout component reads. Run it once after install, or with `--force` to overwrite.

When the input is not a known subcommand and includes exactly one `@agent` mention, Scout treats it as an implicit `ask` and waits for the reply. For example:

```bash
scout @dewey can you review our docs?
scout hey @hudson please inspect the failing test
scout --as vox --timeout 900 @talkie take another pass on the keyboard port
```

### Addressing specific agents

Agent identity has five dimensions: `definitionId`, workspace qualifier, `profile`, `harness`, `node`. Canonical form:

```
@<definitionId>[.<workspaceQualifier>][.profile:<profile>][.harness:<harness>][.node:<node>]
```

Short `@name` only resolves when exactly one live agent matches. If multiple agents share a name (e.g. one Codex-backed, one Claude-backed), pin the dimension you care about with a typed qualifier:

```bash
scout @vox.harness:codex relay from hudson: please retry the build
scout ask --to vox.harness:claude "what did the reviewer flag?"
scout @arc.profile:reviewer take another pass
scout @vox.harness:codex.node:mini run locally on mini
```

Aliases: `runtime:` = `harness:`, `persona:` = `profile:`, `branch:` / `worktree:` = workspace qualifier. Dimensions combine in any order.

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

Runs the same Scout desktop web stack as the repo’s `bun run web` entry (Hono + shared IPC services). **Bun must be on your PATH.** Publish builds ship `dist/scout-web-server.mjs` and `dist/client/` (Vite build); when `dist/client/index.html` is present, **`scout server start` defaults to static assets** unless you pass `--vite-url` to proxy a dev server.

```bash
scout whoami
scout who
scout latest
scout server open
scout server start
scout server start --port 3200
scout server open --path /agents/arc-codex-2.master.mini
scout server start --vite-url http://127.0.0.1:43173   # SPA dev server
scout server start --static --static-root /custom/client
```

`scout server open` reuses an already-running matching Scout server on that port, or starts one in the background and opens the browser for you. Use `scout server` or `scout server help` for full flags.

For a standalone **lightweight** web UI, see **`@openscout/web`** (`openscout-web`): it ships its own `dist/client`, bundled Bun server, and pairing supervisor. The full desktop UI remains vendored with the CLI build; the lightweight web package no longer boots through `scout server control-plane start`.
