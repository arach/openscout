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

Then open the URL printed in the terminal (default port `43120`).

The public Bun edge binds to `0.0.0.0` by default, treats `scout.local` as the local portal name, and derives the node URL as `<machine>.scout.local` unless the user configures a short alias such as `m1`. The edge owns the public web port and reverse-proxies to a pool of loopback-only Bun/Hono request workers. It performs no SQLite reads, broker snapshots, or terminal discovery itself, so health and overload responses remain available when an application worker stalls. The pool uses Bun and platform APIs already required by Scout; it adds no npm package or system-service dependency.

`OPENSCOUT_WEB_WORKERS` sets the pool size. The default is CPU-aware (two to four workers, capped at eight). Worker zero owns singleton background services and in-memory pairing/Scoutbot/voice routes; general requests are least-busy balanced across the remaining workers. `OPENSCOUT_WEB_MAX_REQUESTS_PER_WORKER` sets the bounded in-flight request capacity (default 64), so overload is rejected instead of creating an unbounded worker queue. `OPENSCOUT_WEB_WORKER_PORT_BASE` can override the private port band, whose default is derived in `46000-46999`.

## Load smoke test

The default load smoke test starts an isolated edge with synthetic workers. Its mock stream is MiniMax-shaped test data only: it uses no credentials, provider calls, agent messages, or existing sessions.

```bash
bun --cwd packages/web load:edge
```

Maintainers can point the same harness at an already-running isolated production bundle for a read-only mixed workload over agent summaries, session/SQLite reads, tail snapshots, and repository diff/filesystem work:

```bash
OPENSCOUT_LOAD_ORIGIN=http://127.0.0.1:45320 \
OPENSCOUT_LOAD_WORKTREE=/path/to/worktree \
OPENSCOUT_LOAD_SESSION=optional-chat-id \
bun --cwd packages/web load:edge
```

The real mode performs no mutations, agent messages, or LLM/provider calls.

The Scout local named-edge flow is name resolution first, then Caddy, then the Bun edge: `scout server edge` publishes/resolves `scout.local` and `<node>.scout.local`, runs Caddy against the active public web port, and serves HTTP on port `80` for zero-cert local browsing. HTTPS is available only when explicitly requested with `--edge-scheme https` or `--edge-scheme both` plus `scout server trust`.

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
- `dist/pairing-runtime-controller.mjs` for the pairing runtime
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

### HudsonKit source

Source builds use a sibling Hudson checkout automatically when
`../hudson/packages/web/hudsonkit` exists. That lets Scout pick up current
HudsonKit UI primitives without waiting for an npm publish. To force the
published package instead:

```bash
OPENSCOUT_WEB_HUDSONKIT_SOURCE=package bun --cwd packages/web dev
```

Set `HUDSON_SDK_PATH=/path/to/hudson/packages/web/hudsonkit` to point at a
non-sibling checkout.

To run the app through the local Scout names in one process, use:

```bash
bun --cwd packages/web dev:edge -- --local-name m1
```

`dev:edge` starts the Bun app server, Vite, Bonjour/mDNS name publication for `scout.local` and `<name>.scout.local`, and Caddy reverse proxying on local port `80` plus `443` by default. The Caddyfile is generated with the actual Bun port chosen for that run, so the edge stays correct when the default port is busy or a worktree gets an isolated port band.

Installed CLI users get the Caddy dependency through `scout setup` on macOS via Homebrew. The base Scout LaunchAgent supervises the normal local edge after setup; source-only development still requires `caddy` on PATH or `OPENSCOUT_CADDY_BIN` pointing at a Caddy executable before running `dev:edge`.

The local edge also owns the cold-start screen. If Caddy can resolve the Scout name but the web app health check fails, it serves a small "Start Scout" page from the same origin. The button posts to Caddy's internal `/__openscout/web/start` control path, which proxies to the always-on broker and starts the web server without exposing broker ports to the browser URL.

If you need to run them separately:

```bash
bun --cwd packages/web dev:client
OPENSCOUT_WEB_VITE_URL=http://127.0.0.1:43122 bun --cwd packages/web dev:server
```

### Dev routing

The public route table stays small and explicit:

- `/api/*` is the Bun API surface
- `/api/health` is answered directly by the thin edge and reports ready/total workers
- `/ws/terminal` is the terminal/takeover WebSocket
- `/ws/hmr` is the Vite hot-reload WebSocket in dev
- everything else is client traffic

In the installed package, Bun serves the bundled static client directly. In source/dev mode, Bun remains the public server but forwards client asset requests and `/ws/hmr` to Vite.

For a local edge proxy, keep Bun as the application server and reverse-proxy to it. The default generated config includes HTTP for zero-cert local browsing and same-origin control paths for broker-owned startup:

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
```

Use the port number the Bun app server is listening on. The default is `43120`, or the value passed with `--port` / `OPENSCOUT_WEB_PORT`.

### Cleanup

`bun dev` records each run under `.openscout/dev/web`, and cleanup uses that state first before falling back to a small Scout-only sweep around the local Scout port block.

To clear stale Scout dev listeners:

```bash
bun run dev:cleanup:ports
```
