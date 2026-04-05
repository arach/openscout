import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";

import { createScoutElectronIpcServices } from "../app/electron/ipc.ts";
import { createScoutDesktopAppInfo } from "../app/desktop/index.ts";
import type { ScoutElectronIpcServices } from "../app/electron/ipc.ts";
import {
  createScoutMobileSession,
  getScoutMobileAgents,
  getScoutMobileHome,
  getScoutMobileSessionSnapshot,
  getScoutMobileSessions,
  getScoutMobileWorkspaces,
  sendScoutMobileMessage,
} from "../core/mobile/service.ts";

const port = Number(process.env.SCOUT_WEB_PORT ?? "3200");
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();

const appInfo = createScoutDesktopAppInfo({ platform: process.platform });
const services: ScoutElectronIpcServices = createScoutElectronIpcServices({
  currentDirectory,
  appInfo,
  host: {
    pickDirectory: async () => null,
  },
});

// Coalesce concurrent calls to the same async function so that spawnSync-heavy
// service methods (brokerServiceStatus → launchctl) don't serialize and starve
// the event loop.  Concurrent callers share one in-flight promise; the result
// is cached for `ttlMs` so the next burst is also instant.
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

const getShellState = coalesce(() => services.getShellState());
const getAppSettings = coalesce(() => services.getAppSettings());
const getBrokerInspector = coalesce(() => services.getBrokerInspector());

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

app.get("/api/app-info", async (c) => c.json(await services.getAppInfo()));
app.get("/api/shell-state", async (c) => c.json(await getShellState()));
app.get("/api/shell-state/refresh", async (c) => c.json(await getShellState()));
app.get("/api/app-settings", async (c) => c.json(await getAppSettings()));
app.post("/api/app-settings", async (c) => c.json(await services.updateAppSettings(await c.req.json())));
app.post("/api/retire-project", async (c) => {
  const { projectRoot } = await c.req.json();
  return c.json(await services.retireProject(projectRoot));
});
app.post("/api/restore-project", async (c) => {
  const { projectRoot } = await c.req.json();
  return c.json(await services.restoreProject(projectRoot));
});
app.post("/api/onboarding/run", async (c) => c.json(await services.runOnboardingCommand(await c.req.json())));
app.post("/api/onboarding/skip", async (c) => c.json(await services.skipOnboarding()));
app.post("/api/onboarding/restart", async (c) => c.json(await services.restartOnboarding()));
app.get("/api/agent-config/:agentId", async (c) => c.json(await services.getAgentConfig(c.req.param("agentId"))));
app.post("/api/agent-config", async (c) => c.json(await services.updateAgentConfig(await c.req.json())));
app.get("/api/phone-preparation", async (c) => c.json(await services.getPhonePreparation()));
app.post("/api/phone-preparation", async (c) => c.json(await services.updatePhonePreparation(await c.req.json())));
app.get("/api/pairing-state", async (c) => c.json(await services.getPairingState()));
app.get("/api/pairing-state/refresh", async (c) => c.json(await services.refreshPairingState()));
app.post("/api/pairing/control", async (c) => {
  const { action } = await c.req.json();
  return c.json(await services.controlPairingService(action));
});
app.post("/api/pairing/config", async (c) => c.json(await services.updatePairingConfig(await c.req.json())));
app.post("/api/agent/restart", async (c) => c.json(await services.restartAgent(await c.req.json())));
app.post("/api/relay/send", async (c) => c.json(await services.sendRelayMessage(await c.req.json())));
app.post("/api/broker/control", async (c) => {
  const { action } = await c.req.json();
  return c.json(await services.controlBroker(action));
});
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
app.post("/api/mobile/session/create", async (c) => c.json(await createScoutMobileSession(await c.req.json(), currentDirectory)));
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
  fetch: app.fetch,
};

console.log(`Scout web → http://localhost:${port}`);
