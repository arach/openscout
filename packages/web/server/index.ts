import {
  createOpenScoutWebServer,
} from "./create-openscout-web-server.ts";
import {
  relayWebSocket,
  handleRelayUpload,
  destroyAllRelaySessions,
  type RelayWSData,
} from "./relay.ts";

const port = Number(
  process.env.OPENSCOUT_WEB_PORT
    ?? process.env.SCOUT_WEB_PORT
    ?? "3200",
);
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();
const shellStateCacheTtlMs = Number.parseInt(process.env.OPENSCOUT_WEB_SHELL_CACHE_TTL_MS ?? "15000", 10);
const staticRoot = process.env.OPENSCOUT_WEB_STATIC_ROOT?.trim() || undefined;
const dev = process.env.NODE_ENV !== "production" && !staticRoot;
const idleTimeoutSeconds = Number.parseInt(
  process.env.OPENSCOUT_WEB_IDLE_TIMEOUT_SECONDS?.trim() || (dev ? "180" : "30"),
  10,
);

const { app, warmupCaches } = await createOpenScoutWebServer({
  currentDirectory,
  shellStateCacheTtlMs,
  assetMode: dev ? "vite-dev" : "static",
  staticRoot,
});

const honoFetch = app.fetch;

const server = Bun.serve<RelayWSData>({
  port,
  idleTimeout: idleTimeoutSeconds,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade — relay protocol
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const ok = server.upgrade(req, { data: { sessionId: null } });
      return ok
        ? (undefined as unknown as Response)
        : new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Relay HTTP routes
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
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
  console.log("\n[scout] Shutting down relay sessions...");
  destroyAllRelaySessions();
  server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`OpenScout Web -> http://localhost:${server.port}`);
console.log(`Relay WebSocket -> ws://localhost:${server.port}`);
void warmupCaches();
