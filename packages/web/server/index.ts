import {
  createOpenScoutWebServer,
} from "./create-openscout-web-server.ts";

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

export default {
  port,
  idleTimeout: idleTimeoutSeconds,
  fetch: app.fetch,
};

console.log(`OpenScout Web -> http://localhost:${port}`);
void warmupCaches();
