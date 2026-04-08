import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";

import { createScoutElectronIpcServices } from "../app/electron/ipc.ts";
import { createScoutDesktopAppInfo } from "../app/desktop/index.ts";
import type { ScoutElectronIpcServices } from "../app/electron/ipc.ts";
import type { ScoutElectronHostServices } from "../app/electron/host.ts";
import type { ScoutSurfaceCapabilities } from "../shared/surface-capabilities.ts";
import {
  createScoutSession,
  getScoutMobileAgents,
  getScoutMobileHome,
  getScoutMobileSessionSnapshot,
  getScoutMobileSessions,
  getScoutMobileWorkspaces,
  sendScoutMobileMessage,
} from "../core/mobile/service.ts";

/** How non-`/api` traffic is served: dev proxy to Vite or static files. */
export type ScoutWebAssetMode = "vite-proxy" | "static";

export type CreateScoutWebServerOptions = {
  /** Workspace / project root Scout should use (defaults are applied by callers). */
  currentDirectory: string;
  platform?: NodeJS.Platform;
  shellStateCacheTtlMs?: number;
  servicesStateCacheTtlMs?: number;
  homeStateCacheTtlMs?: number;
  assetMode: ScoutWebAssetMode;
  /** Vite origin when `assetMode` is `vite-proxy` (e.g. `http://127.0.0.1:43173`). */
  viteDevUrl?: string;
  /**
   * Directory containing built `index.html` + assets when `assetMode` is `static`.
   * If omitted, uses `defaultMonorepoStaticClientRoot()` (monorepo dev / local installs).
   */
  staticRoot?: string;
  /** Overrides for headless web (default: no native directory picker). */
  host?: ScoutElectronHostServices;
};

export type ScoutWebServer = {
  app: Hono;
  services: ScoutElectronIpcServices;
  warmupCaches: () => Promise<void>;
};

/**
 * Default static client path when developing inside the OpenScout monorepo
 * (`packages/electron-app` Vite `dist/client`).
 */
export function defaultMonorepoStaticClientRoot(moduleUrl: string | URL = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../../../../packages/electron-app/dist/client");
}

function coalesce<T>(fn: () => Promise<T>, ttlMs = 2000): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  let cached: { value: T; expiresAt: number } | null = null;
  return () => {
    if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);
    if (inflight) return inflight;
    inflight = fn()
      .then((value) => {
        cached = { value, expiresAt: Date.now() + ttlMs };
        inflight = null;
        return value;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
    return inflight;
  };
}

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

function parseOptionalPositiveInt(value: string | undefined, fallback?: number): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveStaticRoot(options: CreateScoutWebServerOptions): string {
  if (options.staticRoot?.trim()) {
    return options.staticRoot.trim();
  }
  return defaultMonorepoStaticClientRoot(import.meta.url);
}

function capabilityError(
  capability: keyof ScoutSurfaceCapabilities,
  message: string,
): { error: string; capability: keyof ScoutSurfaceCapabilities } {
  return { error: message, capability };
}

/**
 * Hono app + Scout desktop IPC services (same stack as Electron), HTTP API, and UI asset handling.
 * Use from Bun’s server entry or any host that can call `app.fetch`.
 */
export function createScoutWebServer(options: CreateScoutWebServerOptions): ScoutWebServer {
  const platform = options.platform ?? process.platform;
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const servicesTtl = options.servicesStateCacheTtlMs ?? 3000;
  const homeTtl = options.homeStateCacheTtlMs ?? 5000;

  const appInfo = createScoutDesktopAppInfo({ platform, surface: "web" });
  const caps = appInfo.capabilities;
  const services = createScoutElectronIpcServices({
    currentDirectory: options.currentDirectory,
    appInfo,
    host: options.host ?? {
      pickDirectory: async () => null,
    },
  });

  const getAppSettings = coalesce(() => services.getAppSettings());
  const getBrokerInspector = coalesce(() => services.getBrokerInspector());

  const shellStateCache = createCachedSnapshot(() => services.getShellState(), shellTtl);
  const servicesStateCache = createCachedSnapshot(() => services.getServicesState(), servicesTtl);
  const homeStateCache = createCachedSnapshot(() => services.getHomeState(), homeTtl);

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

  const currentDirectory = options.currentDirectory;
  const app = new Hono();

  app.use("/*", cors());

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

  app.get("/api/app", async (c) => c.json(await services.getAppInfo()));
  app.get("/api/app-info", async (c) => c.json(await services.getAppInfo()));
  app.get("/api/services", async (c) => c.json(await getServicesStateCached()));
  app.get("/api/home", async (c) => c.json(await getHomeStateCached()));
  app.get("/api/shell-state", async (c) => c.json(await getShellStateCached()));
  app.get("/api/shell-state/refresh", async (c) => c.json(await refreshShellStateCache()));
  app.get("/api/app-settings", async (c) => c.json(await getAppSettings()));
  app.get("/api/app-settings/refresh", async (c) => {
    const result = await services.refreshSettingsInventory();
    invalidateShellStateCache();
    invalidateHomeStateCache();
    return c.json(result);
  });
  app.post("/api/app-settings", async (c) => {
    const result = await services.updateAppSettings(await c.req.json());
    invalidateShellStateCache();
    invalidateHomeStateCache();
    return c.json(result);
  });
  app.post("/api/retire-project", async (c) => {
    if (!caps.canEditFilesystem) {
      return c.json(
        capabilityError(
          "canEditFilesystem",
          "Project retirement is not available on the web host. Use the Scout desktop app or CLI.",
        ),
        403,
      );
    }
    const { projectRoot } = await c.req.json();
    const result = await services.retireProject(projectRoot);
    invalidateShellStateCache();
    invalidateHomeStateCache();
    return c.json(result);
  });
  app.post("/api/restore-project", async (c) => {
    if (!caps.canEditFilesystem) {
      return c.json(
        capabilityError(
          "canEditFilesystem",
          "Project restore is not available on the web host. Use the Scout desktop app or CLI.",
        ),
        403,
      );
    }
    const { projectRoot } = await c.req.json();
    const result = await services.restoreProject(projectRoot);
    invalidateShellStateCache();
    invalidateHomeStateCache();
    return c.json(result);
  });
  app.post("/api/onboarding/run", async (c) => {
    if (!caps.canProvisionRuntime) {
      return c.json(
        capabilityError(
          "canProvisionRuntime",
          "Onboarding commands (setup, doctor, etc.) cannot be run from the web host. Use the Scout CLI on this machine.",
        ),
        403,
      );
    }
    return c.json(await services.runOnboardingCommand(await c.req.json()));
  });
  app.post("/api/onboarding/skip", async (c) => {
    if (!caps.canProvisionRuntime) {
      return c.json(
        capabilityError("canProvisionRuntime", "Skipping onboarding is not available on the web host."),
        403,
      );
    }
    return c.json(await services.skipOnboarding());
  });
  app.post("/api/onboarding/restart", async (c) => {
    if (!caps.canProvisionRuntime) {
      return c.json(
        capabilityError("canProvisionRuntime", "Restarting onboarding is not available on the web host."),
        403,
      );
    }
    return c.json(await services.restartOnboarding());
  });
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
    if (!caps.canManageBroker) {
      return c.json(
        capabilityError(
          "canManageBroker",
          "Broker service control is not available on the web host. Use the Scout desktop app or CLI.",
        ),
        403,
      );
    }
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
  app.get("/api/feedback-bundle", async (c) => c.json(await services.getFeedbackBundle()));
  app.post("/api/feedback-report", async (c) => c.json(await services.submitFeedbackReport(await c.req.json())));
  app.post("/api/log-source", async (c) => c.json(await services.readLogSource(await c.req.json())));
  app.get("/api/mobile/home", async (c) =>
    c.json(
      await getScoutMobileHome({
        currentDirectory,
        workspaceLimit: parseOptionalPositiveInt(c.req.query("workspaceLimit"), 6),
        agentLimit: parseOptionalPositiveInt(c.req.query("agentLimit"), 6),
        sessionLimit: parseOptionalPositiveInt(c.req.query("sessionLimit"), 6),
      }),
    ));
  app.get("/api/mobile/workspaces", async (c) =>
    c.json(
      await getScoutMobileWorkspaces(
        {
          query: c.req.query("query"),
          limit: parseOptionalPositiveInt(c.req.query("limit")),
        },
        currentDirectory,
      ),
    ));
  app.get("/api/mobile/agents", async (c) =>
    c.json(
      await getScoutMobileAgents(
        {
          query: c.req.query("query"),
          limit: parseOptionalPositiveInt(c.req.query("limit")),
        },
        currentDirectory,
      ),
    ));
  app.get("/api/mobile/sessions", async (c) =>
    c.json(
      await getScoutMobileSessions(
        {
          query: c.req.query("query"),
          limit: parseOptionalPositiveInt(c.req.query("limit")),
        },
        currentDirectory,
      ),
    ));
  app.get("/api/mobile/session/:conversationId", async (c) =>
    c.json(
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

  const viteUrl = options.viteDevUrl?.trim() || "http://127.0.0.1:43173";

  if (options.assetMode === "vite-proxy") {
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
    const root = resolveStaticRoot(options);
    app.use("/*", serveStatic({ root }));
    app.get("/*", serveStatic({
      root,
      path: "index.html",
    }));
  }

  const warmupCaches = () =>
    Promise.allSettled([refreshShellStateCache(), servicesStateCache.refresh(), homeStateCache.refresh()]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          console.error("[api] initial cache warmup failed:", message);
        }
      }
    });

  return { app, services, warmupCaches };
}
