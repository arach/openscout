import {
  createScoutControlPlaneServer,
  type ScoutWebAssetMode,
} from "./create-scout-control-plane-server.ts";

const port = Number(process.env.SCOUT_WEB_PORT ?? "3200");
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();

const shellStateCacheTtlMs = Number.parseInt(process.env.SCOUT_WEB_SHELL_CACHE_TTL_MS ?? "15000", 10);
const useStaticAssets = process.env.SCOUT_STATIC === "1";
const defaultWebIdleTimeoutSeconds = useStaticAssets ? "30" : "180";
const REQUEST_IDLE_TIMEOUT_SECONDS = Number.parseInt(
  process.env.SCOUT_WEB_IDLE_TIMEOUT_SECONDS?.trim() || defaultWebIdleTimeoutSeconds,
  10,
);
const assetMode: ScoutWebAssetMode = useStaticAssets ? "static" : "vite-proxy";
const staticRoot = process.env.SCOUT_STATIC_ROOT?.trim() || undefined;
const viteDevUrl = process.env.SCOUT_VITE_URL?.trim() || undefined;

const { app, warmupCaches } = createScoutControlPlaneServer({
  currentDirectory,
  shellStateCacheTtlMs: shellStateCacheTtlMs,
  assetMode,
  viteDevUrl,
  staticRoot,
});

export default {
  port,
  idleTimeout: REQUEST_IDLE_TIMEOUT_SECONDS,
  fetch: app.fetch,
};

console.log(`OpenScout control-plane web → http://localhost:${port}`);
void warmupCaches();
