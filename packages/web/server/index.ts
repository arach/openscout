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
const relayWebSocket = terminalRelay
  ? createRelayWebSocketProxy(terminalRelay.targetWebSocketUrl)
  : {
      open(ws: {
        readyState: number;
        close(code?: number, reason?: string): void;
      }) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1013, "Terminal relay unavailable");
        }
      },
      message() {},
      close() {},
    };

const server = Bun.serve<RelayWSData>({
  port,
  hostname,
  idleTimeout: idleTimeoutSeconds,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade — relay protocol
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const ok = server.upgrade(req, { data: { upstream: null, pending: [] } });
      return ok
        ? (undefined as unknown as Response)
        : new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Relay HTTP routes
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

    // Everything else → Hono
    return honoFetch(req, server);
  },

  websocket: relayWebSocket,
});

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
