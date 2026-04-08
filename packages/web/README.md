# @openscout/web

Published package that ships a **minimal Scout web UI** (Vite + React in this package): pairing QR and the current activity stream. It starts by delegating to **`scout server control-plane start`** from [`@openscout/scout`](https://www.npmjs.com/package/@openscout/scout). This tarball does **not** bundle the Hono server or `@openscout/runtime`; that code runs inside the CLI you invoke.

## Requirements

- **`scout`** from `@openscout/scout` on your `PATH`, **or** install `@openscout/scout` next to this package so `node_modules/@openscout/scout/bin/scout.mjs` exists, **or** set `OPENSCOUT_SCOUT_BIN` to that `scout.mjs` path (or a `scout` executable).
- [Bun](https://bun.sh) on your `PATH` (the CLI runs the API server with Bun, same as `scout server control-plane start`).

## Install

```bash
npm i -g @openscout/scout @openscout/web
# or
bun add -g @openscout/scout @openscout/web
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
| Command | `scout` (full CLI + bundled `scout-web-server.mjs`) | `openscout-web` → spawns `scout server control-plane start --static --static-root …` |
| Static UI | Vendored next to `main.mjs` in the CLI package (full desktop UI) | This package’s `dist/client` (minimal pairing + activity) |
| Broker / setup | Yes (`scout setup`, etc.) | Same — use `scout` |

## Build (maintainers)

From the repo root:

```bash
npm --prefix packages/web run build
```

This runs `vite build` for `packages/web/client` into `dist/client/`. No server bundle is emitted here.

## Local dev (UI only)

With `scout server control-plane start --vite-url http://127.0.0.1:5180` already running on port 3200:

```bash
npm --prefix packages/web run dev
```

Vite serves on port 5180 and proxies `/api` to `http://127.0.0.1:3200`.
