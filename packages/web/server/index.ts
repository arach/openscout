import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHost, resolveWebPort } from "@openscout/runtime/local-config";
import { resolveOpenScoutSetupContextRoot } from "@openscout/runtime/setup";
import {
  createOpenScoutWebServer,
} from "./create-openscout-web-server.ts";
import {
  createRelayWebSocketProxy,
  handleRelayUpload,
  type RelayWSData,
} from "./relay.ts";
import {
  startManagedTerminalRelay,
  type ManagedTerminalRelay,
} from "./managed-terminal-relay.ts";

const port = Number.parseInt(
  process.env.OPENSCOUT_WEB_PORT
    ?? process.env.SCOUT_WEB_PORT
    ?? String(resolveWebPort()),
  10,
);
const hostname = process.env.OPENSCOUT_WEB_HOST?.trim()
  || process.env.SCOUT_WEB_HOST?.trim()
  || resolveHost();
const currentDirectory = resolveOpenScoutSetupContextRoot({
  env: process.env,
  fallbackDirectory: process.cwd(),
});
const shellStateCacheTtlMs = Number.parseInt(process.env.OPENSCOUT_WEB_SHELL_CACHE_TTL_MS ?? "15000", 10);
const TERMINAL_RELAY_PATH = process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH?.trim() || "/terminal-relay";
const VITE_HMR_PATH = process.env.OPENSCOUT_WEB_VITE_HMR_PATH?.trim() || "/__vite_hmr";

function resolveStaticRoot(): string | undefined {
  if (process.env.OPENSCOUT_WEB_STATIC_ROOT?.trim()) {
    return process.env.OPENSCOUT_WEB_STATIC_ROOT.trim();
  }
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const siblingClientRoot = join(selfDir, "client");
  if (existsSync(join(siblingClientRoot, "index.html"))) {
    return siblingClientRoot;
  }
  const sourceDistClientRoot = resolve(selfDir, "../dist/client");
  if (existsSync(join(sourceDistClientRoot, "index.html"))) {
    return sourceDistClientRoot;
  }
  return undefined;
}

const staticRoot = resolveStaticRoot();
const viteDevUrl = process.env.OPENSCOUT_WEB_VITE_URL?.trim() || undefined;
const useViteProxy = Boolean(viteDevUrl) || !staticRoot;
const idleTimeoutSeconds = Number.parseInt(
  process.env.OPENSCOUT_WEB_IDLE_TIMEOUT_SECONDS?.trim()
    || (useViteProxy ? "180" : "30"),
  10,
);

function toWebSocketUrl(httpUrl: string, pathname: string, search = ""): string {
  const target = new URL(pathname, httpUrl);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.search = search;
  return target.toString();
}

let terminalRelay: ManagedTerminalRelay | null = null;

try {
  terminalRelay = await startManagedTerminalRelay({
    hostname,
    webPort: port,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[scout] Terminal relay unavailable: ${message}`);
}

const { app, warmupCaches } = await createOpenScoutWebServer({
  currentDirectory,
  shellStateCacheTtlMs,
  assetMode: useViteProxy ? "vite-proxy" : "static",
  viteDevUrl,
  staticRoot,
  runTerminalCommand: terminalRelay?.queueCommand,
});

const honoFetch = app.fetch;
const relayWebSocket = createRelayWebSocketProxy();

let server: ReturnType<typeof Bun.serve<RelayWSData>>;
try {
  server = Bun.serve<RelayWSData>({
    port,
    hostname,
    idleTimeout: idleTimeoutSeconds,

    async fetch(req, server) {
      const url = new URL(req.url);

      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        let upstreamUrl: string | null = null;

        if (url.pathname === TERMINAL_RELAY_PATH) {
          upstreamUrl = terminalRelay?.targetWebSocketUrl ?? null;
          if (!upstreamUrl) {
            return new Response("Terminal relay unavailable", { status: 503 });
          }
        } else if (viteDevUrl && url.pathname === VITE_HMR_PATH) {
          upstreamUrl = toWebSocketUrl(viteDevUrl, url.pathname, url.search);
        } else {
          return new Response("WebSocket endpoint not found", { status: 404 });
        }

        const ok = server.upgrade(req, {
          data: {
            upstream: null,
            pending: [],
            upstreamUrl,
          },
        });
        return ok
          ? (undefined as unknown as Response)
          : new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        const relayOk = terminalRelay ? await terminalRelay.healthcheck() : false;
        return Response.json(
          { ok: relayOk, relay: relayOk ? "up" : "down" },
          { status: relayOk ? 200 : 503 },
        );
      }
      if (req.method === "POST" && (url.pathname === "/api/upload" || url.pathname === "/api/relay/upload")) {
        return handleRelayUpload(req);
      }

      return honoFetch(req, server);
    },

    websocket: relayWebSocket,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EADDRINUSE|address already in use|in use/i.test(message)) {
    console.error(
      `[scout] Port ${port} is already in use on ${hostname}.\n` +
        `        Try: bun dev --port ${port + 100}  (or another free port)`,
    );
  } else {
    console.error(`[scout] Failed to start server on ${hostname}:${port} — ${message}`);
  }
  terminalRelay?.shutdown();
  process.exit(1);
}

// Graceful shutdown
const shutdown = () => {
  console.log("\n[scout] Shutting down terminal relay...");
  terminalRelay?.shutdown();
  server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`OpenScout Web -> http://${hostname}:${server.port}`);
console.log(`Relay WebSocket -> ws://${hostname}:${server.port}`);
void warmupCaches();
