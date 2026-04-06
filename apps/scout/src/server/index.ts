import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";

import { createScoutElectronIpcServices } from "../app/electron/ipc.ts";
import { createScoutDesktopAppInfo } from "../app/desktop/index.ts";
import type { ScoutElectronIpcServices } from "../app/electron/ipc.ts";
import {
  createScoutSession,
  getScoutMobileAgents,
  getScoutMobileHome,
  getScoutMobileSessionSnapshot,
  getScoutMobileSessions,
  getScoutMobileWorkspaces,
  sendScoutMobileMessage,
} from "../core/mobile/service.ts";

const port = Number(process.env.SCOUT_WEB_PORT ?? "3200");
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();
const SHELL_STATE_CACHE_TTL_MS = Number.parseInt(process.env.SCOUT_WEB_SHELL_CACHE_TTL_MS ?? "15000", 10);
const SERVICES_STATE_CACHE_TTL_MS = Number.parseInt(process.env.SCOUT_WEB_SERVICES_CACHE_TTL_MS ?? "3000", 10);
const HOME_STATE_CACHE_TTL_MS = Number.parseInt(process.env.SCOUT_WEB_HOME_CACHE_TTL_MS ?? "5000", 10);
const REQUEST_IDLE_TIMEOUT_SECONDS = Number.parseInt(process.env.SCOUT_WEB_IDLE_TIMEOUT_SECONDS ?? "30", 10);

const appInfo = createScoutDesktopAppInfo({ platform: process.platform });
const services: ScoutElectronIpcServices = createScoutElectronIpcServices({
  currentDirectory,
  appInfo,
  host: {
    pickDirectory: async () => null,
  },
});

function coalesce<T>(fn: () => Promise<T>, ttlMs = 2000): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  let cached: { value: T; expiresAt: number } | null = null;
  return () => {
    if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);
    if (inflight) return inflight;
    inflight = fn().then((value) => {
      cached = { value, expiresAt: Date.now() + ttlMs };
      inflight = null;
      return value;
    }).catch((err) => {
      inflight = null;
      throw err;
    });
    return inflight;
  };
}

const getAppSettings = coalesce(() => services.getAppSettings());
const getBrokerInspector = coalesce(() => services.getBrokerInspector());

function createCachedSnapshot<T>(load: () => Promise<T>, ttlMs: number) {
  let inflight: Promise<T> | null = null;
  let cached: { value: T; expiresAt: number } | null = null;

  const refresh = async () => {
    if (inflight) {
      return inflight;
    }

    inflight = load()
      .then((value) => {
        cached = { value, expiresAt: Date.now() + ttlMs };
        inflight = null;
        return value;
      })
      .catch((error) => {
        inflight = null;
        throw error;
      });

    return inflight;
  };

  const get = async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    if (!force && cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    if (!force && cached && inflight) {
      return cached.value;
    }

    if (!force && inflight) {
      return inflight;
    }

    return refresh();
  };

  const invalidate = () => {
    cached = null;
  };

  return {
    get,
    refresh,
    invalidate,
    peek: () => cached?.value ?? null,
  };
}

const shellStateCache = createCachedSnapshot(() => services.getShellState(), SHELL_STATE_CACHE_TTL_MS);
const servicesStateCache = createCachedSnapshot(() => services.getServicesState(), SERVICES_STATE_CACHE_TTL_MS);
const homeStateCache = createCachedSnapshot(() => services.getHomeState(), HOME_STATE_CACHE_TTL_MS);

async function refreshShellStateCache() {
  return shellStateCache.refresh();
}

async function getShellStateCached() {
  return shellStateCache.get();
}

function invalidateShellStateCache() {
  shellStateCache.invalidate();
}

async function getServicesStateCached() {
  return servicesStateCache.get();
}

function invalidateServicesStateCache() {
  servicesStateCache.invalidate();
}

async function getHomeStateCached() {
  return homeStateCache.get();
}

function invalidateHomeStateCache() {
  homeStateCache.invalidate();
}

function parseOptionalPositiveInt(value: string | undefined, fallback?: number): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const app = new Hono();

app.use("/*", cors());

// Request timeout + error logging middleware
app.use("/api/*", async (c, next) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    await next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[api] ${c.req.method} ${c.req.path} failed:`, message);
    return c.json({ error: message }, 500);
  } finally {
    clearTimeout(timeout);
  }
});

// --- API routes (mirrors ScoutElectronIpcServices) ---

app.get("/api/app", async (c) => c.json(await services.getAppInfo()));
app.get("/api/app-info", async (c) => c.json(await services.getAppInfo()));
app.get("/api/services", async (c) => c.json(await getServicesStateCached()));
app.get("/api/home", async (c) => c.json(await getHomeStateCached()));
app.get("/api/shell-state", async (c) => c.json(await getShellStateCached()));
app.get("/api/shell-state/refresh", async (c) => c.json(await refreshShellStateCache()));
app.get("/api/app-settings", async (c) => c.json(await getAppSettings()));
app.post("/api/app-settings", async (c) => {
  const result = await services.updateAppSettings(await c.req.json());
  invalidateShellStateCache();
  invalidateHomeStateCache();
  return c.json(result);
});
app.post("/api/retire-project", async (c) => {
  const { projectRoot } = await c.req.json();
  const result = await services.retireProject(projectRoot);
  invalidateShellStateCache();
  invalidateHomeStateCache();
  return c.json(result);
});
app.post("/api/restore-project", async (c) => {
  const { projectRoot } = await c.req.json();
  const result = await services.restoreProject(projectRoot);
  invalidateShellStateCache();
  invalidateHomeStateCache();
  return c.json(result);
});
app.post("/api/onboarding/run", async (c) => c.json(await services.runOnboardingCommand(await c.req.json())));
app.post("/api/onboarding/skip", async (c) => c.json(await services.skipOnboarding()));
app.post("/api/onboarding/restart", async (c) => c.json(await services.restartOnboarding()));
app.get("/api/agent-config/:agentId", async (c) => c.json(await services.getAgentConfig(c.req.param("agentId"))));
app.post("/api/agent-config", async (c) => c.json(await services.updateAgentConfig(await c.req.json())));
app.post("/api/agent/create", async (c) => {
  const result = await services.createAgent(await c.req.json());
  invalidateShellStateCache();
  invalidateHomeStateCache();
  return c.json(result);
});
app.get("/api/phone-preparation", async (c) => c.json(await services.getPhonePreparation()));
app.post("/api/phone-preparation", async (c) => c.json(await services.updatePhonePreparation(await c.req.json())));
app.get("/api/pairing-state", async (c) => c.json(await services.getPairingState()));
app.get("/api/pairing-state/refresh", async (c) => c.json(await services.refreshPairingState()));
app.post("/api/pairing/control", async (c) => {
  const { action } = await c.req.json();
  const result = await services.controlPairingService(action);
  invalidateShellStateCache();
  invalidateServicesStateCache();
  return c.json(result);
});
app.post("/api/pairing/config", async (c) => c.json(await services.updatePairingConfig(await c.req.json())));
app.post("/api/agent/restart", async (c) => {
  const result = await services.restartAgent(await c.req.json());
  invalidateShellStateCache();
  invalidateHomeStateCache();
  return c.json(result);
});
app.post("/api/relay/send", async (c) => {
  const result = await services.sendRelayMessage(await c.req.json());
  invalidateShellStateCache();
  invalidateHomeStateCache();
  return c.json(result);
});
app.post("/api/broker/control", async (c) => {
  const { action } = await c.req.json();
  const result = await services.controlBroker(action);
  invalidateShellStateCache();
  invalidateServicesStateCache();
  invalidateHomeStateCache();
  return c.json(result);
});
app.get("/api/keep-alive", async (c) => c.json(await services.getKeepAliveState()));
app.post("/api/keep-alive/acquire", async (c) => c.json(await services.acquireKeepAliveLease(await c.req.json())));
app.post("/api/keep-alive/release", async (c) => c.json(await services.releaseKeepAliveLease(await c.req.json())));
app.get("/api/agent-session/:agentId", async (c) => c.json(await services.getAgentSession(c.req.param("agentId"))));
app.post("/api/agent-session/:agentId/open", async (c) => c.json(await services.openAgentSession(c.req.param("agentId"))));
app.post("/api/voice/toggle-capture", async (c) => c.json(await services.toggleVoiceCapture()));
app.post("/api/voice/replies", async (c) => {
  const { enabled } = await c.req.json();
  return c.json(await services.setVoiceRepliesEnabled(enabled));
});
app.get("/api/log-catalog", async (c) => c.json(await services.getLogCatalog()));
app.get("/api/broker-inspector", async (c) => c.json(await getBrokerInspector()));
app.post("/api/log-source", async (c) => c.json(await services.readLogSource(await c.req.json())));
app.get("/api/mobile/home", async (c) => c.json(await getScoutMobileHome({
  currentDirectory,
  workspaceLimit: parseOptionalPositiveInt(c.req.query("workspaceLimit"), 6),
  agentLimit: parseOptionalPositiveInt(c.req.query("agentLimit"), 6),
  sessionLimit: parseOptionalPositiveInt(c.req.query("sessionLimit"), 6),
})));
app.get("/api/mobile/workspaces", async (c) => c.json(await getScoutMobileWorkspaces({
  query: c.req.query("query"),
  limit: parseOptionalPositiveInt(c.req.query("limit")),
}, currentDirectory)));
app.get("/api/mobile/agents", async (c) => c.json(await getScoutMobileAgents({
  query: c.req.query("query"),
  limit: parseOptionalPositiveInt(c.req.query("limit")),
}, currentDirectory)));
app.get("/api/mobile/sessions", async (c) => c.json(await getScoutMobileSessions({
  query: c.req.query("query"),
  limit: parseOptionalPositiveInt(c.req.query("limit")),
}, currentDirectory)));
app.get("/api/mobile/session/:conversationId", async (c) => c.json(
  await getScoutMobileSessionSnapshot(
    c.req.param("conversationId"),
    {
      beforeTurnId: c.req.query("beforeTurnId"),
      limit: parseOptionalPositiveInt(c.req.query("limit")),
    },
    currentDirectory,
  ),
));
app.post("/api/mobile/session/create", async (c) => c.json(await createScoutSession(await c.req.json(), currentDirectory)));
app.post("/api/mobile/message/send", async (c) => c.json(await sendScoutMobileMessage(await c.req.json(), currentDirectory)));

// --- Proxy non-API requests to Vite dev server or serve static build ---
const viteUrl = process.env.SCOUT_VITE_URL?.trim() || "http://127.0.0.1:43173";
const useViteProxy = process.env.SCOUT_STATIC !== "1";

if (useViteProxy) {
  app.all("/*", async (c) => {
    const target = new URL(c.req.path, viteUrl);
    target.search = new URL(c.req.url).search;
    const headers = new Headers(c.req.header());
    headers.delete("host");
    const res = await fetch(target.toString(), {
      method: c.req.method,
      headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
    });
    return new Response(res.body, {
      status: res.status,
      headers: res.headers,
    });
  });
} else {
  app.use(
    "/*",
    serveStatic({ root: "../../packages/electron-app/dist/client" }),
  );
  app.get("/*", serveStatic({
    root: "../../packages/electron-app/dist/client",
    path: "index.html",
  }));
}

export default {
  port,
  idleTimeout: REQUEST_IDLE_TIMEOUT_SECONDS,
  fetch: app.fetch,
};

console.log(`Scout web → http://localhost:${port}`);
void Promise.allSettled([
  refreshShellStateCache(),
  servicesStateCache.refresh(),
  homeStateCache.refresh(),
]).then((results) => {
  for (const result of results) {
    if (result.status === "rejected") {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error("[api] initial cache warmup failed:", message);
    }
  }
});
