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

## Local dev (UI only)

Run the standalone web server and the Vite client together:

```bash
bun --cwd packages/web dev
```

From extra git worktrees, `bun dev` automatically picks an isolated port set so it does not collide with the main checkout. You can still override any port explicitly with `--port`, `--vite-port`, and `--pairing-port`.

If you need to run them separately:

```bash
bun --cwd packages/web dev:client
OPENSCOUT_WEB_VITE_URL=http://127.0.0.1:5180 bun --cwd packages/web dev:server
```

### Dev routing

The dev boundary is route-based:

- `/api/*` and `/health` stay on the Bun server
- `/terminal-relay` is the terminal/takeover WebSocket
- `/__vite_hmr` is the Vite hot-reload WebSocket in dev
- everything else is client traffic

That means Bun is the public app server in dev, while Vite only serves client assets and HMR. When you open Vite directly, it proxies `/api/*`, `/health`, and `/terminal-relay` back to Bun so both entrypoints stay usable.
