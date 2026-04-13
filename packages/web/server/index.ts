import {
  createOpenScoutWebServer,
  type ScoutWebAssetMode,
} from "./create-openscout-web-server.ts";

const port = Number(
  process.env.OPENSCOUT_WEB_PORT
    ?? process.env.SCOUT_WEB_PORT
    ?? "3200",
);
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();
const shellStateCacheTtlMs = Number.parseInt(process.env.OPENSCOUT_WEB_SHELL_CACHE_TTL_MS ?? "15000", 10);
const viteDevUrl = process.env.OPENSCOUT_WEB_VITE_URL?.trim() || undefined;
const staticRoot = process.env.OPENSCOUT_WEB_STATIC_ROOT?.trim() || undefined;
const assetMode: ScoutWebAssetMode = viteDevUrl ? "vite-proxy" : "static";
const defaultIdleTimeoutSeconds = assetMode === "static" ? "30" : "180";
const idleTimeoutSeconds = Number.parseInt(
  process.env.OPENSCOUT_WEB_IDLE_TIMEOUT_SECONDS?.trim() || defaultIdleTimeoutSeconds,
  10,
);

const { app, warmupCaches } = createOpenScoutWebServer({
  currentDirectory,
  shellStateCacheTtlMs,
  assetMode,
  viteDevUrl,
  staticRoot,
});

export default {
  port,
  idleTimeout: idleTimeoutSeconds,
  fetch: app.fetch,
};

console.log(`OpenScout Web -> http://localhost:${port}`);
void warmupCaches();
