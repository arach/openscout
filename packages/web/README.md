# @openscout/web

Published package that ships a lightweight standalone Scout web UI: pairing QR, current activity, inbox, and direct messaging. The package builds and ships its own Bun server plus bundled static client assets.

## Requirements

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
| Command | `scout` (full CLI + bundled desktop web UI) | `openscout-web` (standalone Bun server + bundled client) |
| Static UI | Vendored next to `main.mjs` in the CLI package | This package’s `dist/client` |
| Server | CLI-owned | Web-package-owned |
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

## Local dev (UI only)

Run the standalone web server and the Vite client together:

```bash
npm --prefix packages/web run dev
```

If you need to run them separately:

```bash
npm --prefix packages/web run dev:client
OPENSCOUT_WEB_VITE_URL=http://127.0.0.1:5180 npm --prefix packages/web run dev:server
```

Vite serves on `http://127.0.0.1:5180`, and the Bun server proxies non-API routes there while continuing to serve `/api` locally on port `3200`.
