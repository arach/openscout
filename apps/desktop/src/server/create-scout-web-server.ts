import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import { createScoutDesktopAppInfo } from "../app/desktop/index.ts";
import {
  createScoutHostServices,
  type ScoutHostServices,
} from "../app/host/scout-host-services.ts";
import type { ScoutHostNativeServices } from "../app/host/native-host.ts";
import type { ScoutSurfaceCapabilities } from "../shared/surface-capabilities.ts";
import {
  createScoutSession,
  getScoutMobileAgents,
  getScoutFleet,
  getScoutMobileHome,
  getScoutMobileSessionSnapshot,
  getScoutMobileSessions,
  getScoutMobileWorkspaces,
  sendScoutMobileMessage,
} from "../core/mobile/service.ts";
import {
  coalesce,
  createCachedSnapshot,
  installScoutApiMiddleware,
  registerScoutWebAssets,
  type ScoutWebAssetMode,
} from "./server-core.ts";
import { queryFleet } from "./db-queries.ts";

export type { ScoutWebAssetMode } from "./server-core.ts";

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
  host?: ScoutHostNativeServices;
};

export type ScoutWebServer = {
  app: Hono;
  services: ScoutHostServices;
  warmupCaches: () => Promise<void>;
};

/**
 * Default static client path when developing inside the OpenScout monorepo.
 */
export function defaultMonorepoStaticClientRoot(moduleUrl: string | URL = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../../dist/client");
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
 * Hono app + shared Scout host services, HTTP API, and UI asset handling.
 * Use from Bun’s server entry or any host that can call `app.fetch`.
 */
export function createScoutWebServer(options: CreateScoutWebServerOptions): ScoutWebServer {
  const platform = options.platform ?? process.platform;
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const servicesTtl = options.servicesStateCacheTtlMs ?? 3000;
  const homeTtl = options.homeStateCacheTtlMs ?? 5000;

  const appInfo = createScoutDesktopAppInfo({ platform, surface: "web" });
  const caps = appInfo.capabilities;
  const services = createScoutHostServices({
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

  async function refreshRelayShellPatch() {
    return services.refreshRelayShellPatch();
  }

  const currentDirectory = options.currentDirectory;
  const app = new Hono();

  installScoutApiMiddleware(app, "api");

  app.get("/api/app", async (c) => c.json(await services.getAppInfo()));
  app.get("/api/app-info", async (c) => c.json(await services.getAppInfo()));
  app.get("/api/services", async (c) => c.json(await getServicesStateCached()));
  app.get("/api/home", async (c) => c.json(await getHomeStateCached()));
  app.get("/api/messages-workspace", async (c) => c.json(await services.getMessagesWorkspaceState()));
  app.get("/api/relay-shell-patch", async (c) => c.json(await services.getRelayShellPatch()));
  app.get("/api/relay-shell-patch/refresh", async (c) => c.json(await refreshRelayShellPatch()));
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
  app.post("/api/pairing/question-answer", async (c) => c.json(await services.answerPairingQuestion(await c.req.json())));
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
  app.post("/api/agent-session/question-answer", async (c) => c.json(await services.answerAgentSessionQuestion(await c.req.json())));
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
  app.get("/api/fleet", (c) =>
    c.json(queryFleet({
      limit: parseOptionalPositiveInt(c.req.query("limit")),
      activityLimit: parseOptionalPositiveInt(c.req.query("activityLimit")),
    })));
  app.get("/api/mobile/fleet", async (c) =>
    c.json(await getScoutFleet({
      limit: parseOptionalPositiveInt(c.req.query("limit")),
      activityLimit: parseOptionalPositiveInt(c.req.query("activityLimit")),
    })));
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
  app.get("/api/events", async (c) => {
    const brokerHost = process.env.OPENSCOUT_BROKER_HOST ?? "127.0.0.1";
    const brokerPort = process.env.OPENSCOUT_BROKER_PORT ?? "65535";
    const brokerUrl = process.env.OPENSCOUT_BROKER_URL ?? `http://${brokerHost}:${brokerPort}`;
    try {
      const upstream = await fetch(`${brokerUrl}/v1/events/stream`);
      if (!upstream.ok || !upstream.body) {
        return c.text("Broker event stream unavailable", 502);
      }
      return new Response(upstream.body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    } catch {
      return c.text("Broker unreachable", 502);
    }
  });

  registerScoutWebAssets(app, {
    assetMode: options.assetMode,
    staticRoot: resolveStaticRoot(options),
    viteDevUrl: options.viteDevUrl,
    defaultViteUrl: "http://127.0.0.1:43173",
  });

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
