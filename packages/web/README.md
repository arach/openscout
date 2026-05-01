# packages/web

Internal workspace for the Scout web UI: pairing QR, current activity, inbox, and direct messaging. The package builds a Bun/Hono application server plus bundled static client assets, and the public `@openscout/scout` package vendors those build outputs.

## Requirements

- [Node.js](https://nodejs.org) on your `PATH`
- [Bun](https://bun.sh) on your `PATH`

## Run From Source

```bash
bun --cwd packages/web dev
bun --cwd packages/web dev:server
```

Then open the URL printed in the terminal (default port `3200`).

The Bun/Hono application server derives `scout.<machine>.local` as its default LAN-facing name. When placing Caddy in front of it, set `--public-origin https://scout.<machine>.local` (or `OPENSCOUT_WEB_PUBLIC_ORIGIN`) so API requests from the proxied browser origin are trusted intentionally.

## Public Package

The standalone npm release surface is `@openscout/scout`. It includes the `scout` CLI, the local broker/runtime, and this web application server/client. Keep this package modular internally, but avoid adding a separate public npm package unless there is a clear external integration story.

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

For a local edge proxy, keep Bun as the application server and reverse-proxy to it:

```caddyfile
https://scout.my-mac.local {
  tls internal
  reverse_proxy 127.0.0.1:PORT_NUMBER
}
```

Use the port number the Bun app server is listening on. The default is `3200`, or the value passed with `--port` / `OPENSCOUT_WEB_PORT`.

### Cleanup

`bun dev` records each run under `.openscout/dev/web`, and cleanup uses that state first before falling back to a small Scout-only port sweep around the standard dev ports.

To clear stale Scout dev listeners:

```bash
bun run dev:cleanup:ports
```
