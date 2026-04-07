import {
  createScoutWebServer,
  type ScoutWebAssetMode,
} from "./create-scout-web-server.ts";

const port = Number(process.env.SCOUT_WEB_PORT ?? "3200");
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();
const REQUEST_IDLE_TIMEOUT_SECONDS = Number.parseInt(process.env.SCOUT_WEB_IDLE_TIMEOUT_SECONDS ?? "30", 10);

const shellStateCacheTtlMs = Number.parseInt(process.env.SCOUT_WEB_SHELL_CACHE_TTL_MS ?? "15000", 10);
const servicesStateCacheTtlMs = Number.parseInt(process.env.SCOUT_WEB_SERVICES_CACHE_TTL_MS ?? "3000", 10);
const homeStateCacheTtlMs = Number.parseInt(process.env.SCOUT_WEB_HOME_CACHE_TTL_MS ?? "5000", 10);

const useStaticAssets = process.env.SCOUT_STATIC === "1";
const assetMode: ScoutWebAssetMode = useStaticAssets ? "static" : "vite-proxy";
const staticRoot = process.env.SCOUT_STATIC_ROOT?.trim() || undefined;
const viteDevUrl = process.env.SCOUT_VITE_URL?.trim() || undefined;

const { app, warmupCaches } = createScoutWebServer({
  currentDirectory,
  shellStateCacheTtlMs: shellStateCacheTtlMs,
  servicesStateCacheTtlMs: servicesStateCacheTtlMs,
  homeStateCacheTtlMs: homeStateCacheTtlMs,
  assetMode,
  viteDevUrl,
  staticRoot,
});

export default {
  port,
  idleTimeout: REQUEST_IDLE_TIMEOUT_SECONDS,
  fetch: app.fetch,
};

console.log(`Scout web → http://localhost:${port}`);
void warmupCaches();
