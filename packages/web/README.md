# @openscout/web

Published package that ships a lightweight standalone Scout web UI: pairing QR, current activity, inbox, and direct messaging. The package builds and ships its own Bun server plus bundled static client assets.

## Requirements

- [Node.js](https://nodejs.org) on your `PATH`
- [Bun](https://bun.sh) on your `PATH`

## Install

```bash
npm i -g @openscout/web
# or
bun add -g @openscout/web
```

## Run

```bash
openscout-web
openscout-web --port 8080 --cwd /path/to/workspace
openscout-web --help
```

Then open the URL printed in the terminal (default port `3200`).

## vs `@openscout/scout`

| | `@openscout/scout` | `@openscout/web` |
|---|-------------------|------------------|
| Command | `scout` (full CLI + bundled current web UI) | `openscout-web` (standalone Bun server + bundled client) |
| Static UI | Vendored next to `main.mjs` in the CLI package | This package’s `dist/client` |
| Server | CLI wrapper around the web package | Web-package-owned |
| Broker / setup | Yes (`scout setup`, etc.) | Uses the same broker/runtime data, but does not boot through the CLI |

## Build (maintainers)

From the repo root:

```bash
npm --prefix packages/web run build
```

This builds:

- `dist/client/` via Vite
- `dist/openscout-web-server.mjs` via `bun build`
- `dist/pair-supervisor.mjs` for the pairing runtime
- `dist/openscout-terminal-relay.mjs` for the Node-hosted PTY relay

When Hudson updates the relay session runtime, refresh the vendored fallback with:

```bash
bun --cwd packages/web relay:sync
```

## Local dev (UI only)

Run the standalone web server and the Vite client together:

```bash
bun --cwd packages/web dev
```

`bun dev` prefers the standard Scout ports in the main checkout and worktree-specific port bands in extra git worktrees. If a preferred port is already taken, it increments until it finds an open one.

If you need to run them separately:

```bash
bun --cwd packages/web dev:client
OPENSCOUT_WEB_VITE_URL=http://127.0.0.1:5180 bun --cwd packages/web dev:server
```

### Dev routing

The public route table stays small and explicit:

- `/api/*` is the Bun API surface
- `/api/health` is the canonical health endpoint
- `/ws/terminal` is the terminal/takeover WebSocket
- `/ws/hmr` is the Vite hot-reload WebSocket in dev
- everything else is client traffic

In the installed package, Bun serves the bundled static client directly. In source/dev mode, Bun remains the public server but forwards client asset requests and `/ws/hmr` to Vite.

### Cleanup

`bun dev` records each run under `.openscout/dev/web`, and cleanup uses that state first before falling back to a small Scout-only port sweep around the standard dev ports.

To clear stale Scout dev listeners:

```bash
bun run dev:cleanup:ports
```
