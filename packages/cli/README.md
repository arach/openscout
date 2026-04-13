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

`scout init` is still accepted as a deprecated compatibility alias for `scout setup`.

When the input is not a known subcommand and includes exactly one `@agent` mention, Scout treats it as an implicit `ask` and waits for the reply. For example:

```bash
scout @dewey can you review our docs?
scout hey @hudson please inspect the failing test
scout --as vox --timeout 900 @talkie take another pass on the keyboard port
```

## Current Commands

```bash
scout --help
scout version
scout doctor
scout setup
scout runtimes
scout send
scout speak
scout ask
scout watch
scout who
scout enroll
scout broadcast
scout up
scout down
scout ps
scout restart
scout pair
scout server start
scout tui
```

### Web UI (`scout server start`)

Runs the same Scout desktop web stack as the repo’s `bun run web` entry (Hono + shared IPC services). **Bun must be on your PATH.** Publish builds ship `dist/scout-web-server.mjs` and `dist/client/` (Vite build); when `dist/client/index.html` is present, **`scout server start` defaults to static assets** unless you pass `--vite-url` to proxy a dev server.

```bash
scout server start
scout server start --port 3200
scout server start --vite-url http://127.0.0.1:43173   # SPA dev server
scout server start --static --static-root /custom/client
```

Use `scout server` or `scout server help` for full flags.

For a standalone **lightweight** web UI, see **`@openscout/web`** (`openscout-web`): it ships its own `dist/client`, bundled Bun server, and pairing supervisor. The full desktop UI remains vendored with the CLI build; the lightweight web package no longer boots through `scout server control-plane start`.
