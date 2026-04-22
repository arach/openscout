import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const { app, warmupCaches } = await createOpenScoutWebServer({
  currentDirectory,
  shellStateCacheTtlMs,
  assetMode: useViteProxy ? "vite-proxy" : "static",
  viteDevUrl,
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
