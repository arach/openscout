# packages/web

Internal workspace for the Scout web UI: pairing QR, current activity, inbox, and direct messaging. The package builds a Bun/Hono application server plus bundled static client assets, and the public `@openscout/scout` package vendors those build outputs.

## Requirements

- [Node.js](https://nodejs.org) on your `PATH`
- [Bun](https://bun.sh) on your `PATH`

## Run From Source

```bash
bun --cwd packages/web dev
bun --cwd packages/web dev:edge
bun --cwd packages/web dev:server
```

Then open the URL printed in the terminal (default port `3200`).

The Bun/Hono application server binds to `0.0.0.0` by default, treats `scout.local` as the local portal name, and derives the node URL as `<machine>.scout.local` unless the user configures a short alias such as `m1`. The Scout local edge flow is name resolution first, then Caddy, then the application host handler: `scout server edge` publishes/resolves `scout.local` and `<node>.scout.local`, runs Caddy against the active web port, and serves both HTTP on port `80` and HTTPS on port `443`. HTTPS uses one Caddy local CA plus wildcard Scout certs, so browsers only need to trust one local root instead of one certificate per node.

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

To run the app through the local Scout names in one process, use:

```bash
bun --cwd packages/web dev:edge -- --local-name m1
```

`dev:edge` starts the Bun app server, Vite, Bonjour/mDNS name publication for `scout.local` and `<name>.scout.local`, and Caddy reverse proxying on local port `80` plus `443` by default. The Caddyfile is generated with the actual Bun port chosen for that run, so the edge stays correct when the default port is busy or a worktree gets an isolated port band.

Installed CLI users get the Caddy dependency through `scout setup` on macOS via Homebrew. Source-only development still requires `caddy` on PATH or `OPENSCOUT_CADDY_BIN` pointing at a Caddy executable before running `dev:edge`.

The local edge also owns the cold-start screen. If Caddy can resolve the Scout name but the web app health check fails, it serves a small "Start Scout" page from the same origin. The button posts to Caddy's internal `/__openscout/web/start` control path, which proxies to the always-on broker and starts the web server without exposing broker ports to the browser URL.

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

For a local edge proxy, keep Bun as the application server and reverse-proxy to it. The default generated config includes HTTP for zero-cert local browsing, HTTPS with Caddy's local CA, and same-origin control paths for broker-owned startup:

```caddyfile
http://scout.local {
  handle /__openscout/web/start {
    rewrite * /v1/web/start
    reverse_proxy 127.0.0.1:BROKER_PORT
  }

  handle {
    reverse_proxy 127.0.0.1:PORT_NUMBER
  }

  handle_errors {
    respond "Start Scout fallback page" 200
  }
}

http://*.scout.local {
  handle /__openscout/web/start {
    rewrite * /v1/web/start
    reverse_proxy 127.0.0.1:BROKER_PORT
  }

  handle {
    reverse_proxy 127.0.0.1:PORT_NUMBER
  }

  handle_errors {
    respond "Start Scout fallback page" 200
  }
}

scout.local {
  tls internal
  handle {
    reverse_proxy 127.0.0.1:PORT_NUMBER
  }
}

*.scout.local {
  tls internal
  handle {
    reverse_proxy 127.0.0.1:PORT_NUMBER
  }
}
```

Use the port number the Bun app server is listening on. The default is `3200`, or the value passed with `--port` / `OPENSCOUT_WEB_PORT`.

### Cleanup

`bun dev` records each run under `.openscout/dev/web`, and cleanup uses that state first before falling back to a small Scout-only port sweep around the standard dev ports.

To clear stale Scout dev listeners:

```bash
bun run dev:cleanup:ports
```
