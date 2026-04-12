import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import {
  controlScoutElectronPairingService,
  getScoutElectronPairingState,
  refreshScoutElectronPairingState,
  type ScoutPairingControlAction,
  type ScoutPairingState,
} from "../app/host/pairing.ts";
import { composeScoutDesktopRelayShellPatch } from "../app/desktop/shell.ts";
import type { ScoutDesktopShellPatch } from "../app/desktop/index.ts";
import {
  createCachedSnapshot,
  installScoutApiMiddleware,
  registerScoutWebAssets,
  type ScoutWebAssetMode,
} from "./server-core.ts";
import {
  queryAgents,
  queryActivity,
  queryRecentMessages,
} from "./db-queries.ts";

export type { ScoutWebAssetMode } from "./server-core.ts";

export type CreateScoutControlPlaneServerOptions = {
  currentDirectory: string;
  shellStateCacheTtlMs?: number;
  assetMode: ScoutWebAssetMode;
  viteDevUrl?: string;
  staticRoot?: string;
};

export type ScoutControlPlaneServer = {
  app: Hono;
  warmupCaches: () => Promise<void>;
};

function defaultMonorepoControlPlaneStaticClientRoot(moduleUrl: string | URL = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../../../../packages/web/dist/client");
}

function resolveBundledControlPlaneStaticClientRoot(moduleUrl: string | URL = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "control-plane-client");
}

function resolveStaticRoot(staticRoot: string | undefined): string {
  const configured = staticRoot?.trim();
  if (configured) {
    return configured;
  }

  const bundled = resolveBundledControlPlaneStaticClientRoot(import.meta.url);
  if (existsSync(resolve(bundled, "index.html"))) {
    return bundled;
  }

  return defaultMonorepoControlPlaneStaticClientRoot(import.meta.url);
}

async function loadControlPlaneShellState(currentDirectory: string): Promise<ScoutDesktopShellPatch> {
  return composeScoutDesktopRelayShellPatch({ currentDirectory });
}

async function loadPairingState(currentDirectory: string, refresh: boolean): Promise<ScoutPairingState> {
  return refresh
    ? refreshScoutElectronPairingState(currentDirectory)
    : getScoutElectronPairingState(currentDirectory);
}

export function createScoutControlPlaneServer(
  options: CreateScoutControlPlaneServerOptions,
): ScoutControlPlaneServer {
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const currentDirectory = options.currentDirectory;
  const app = new Hono();
  const shellStateCache = createCachedSnapshot(() => loadControlPlaneShellState(currentDirectory), shellTtl);

  installScoutApiMiddleware(app, "control-plane api");

  app.get("/api/pairing-state", async (c) => c.json(await loadPairingState(currentDirectory, false)));
  app.get("/api/pairing-state/refresh", async (c) => c.json(await loadPairingState(currentDirectory, true)));
  app.post("/api/pairing/control", async (c) => {
    const { action } = await c.req.json() as { action: ScoutPairingControlAction };
    const result = await controlScoutElectronPairingService(action, currentDirectory);
    shellStateCache.invalidate();
    return c.json(result);
  });
  app.get("/api/shell-state", async (c) => c.json(await shellStateCache.get()));
  app.get("/api/shell-state/refresh", async (c) => c.json(await shellStateCache.refresh()));

  // Direct SQLite reads — no shell calls, no snapshot rebuilds
  app.get("/api/agents", (c) => c.json(queryAgents()));
  app.get("/api/activity", (c) => c.json(queryActivity()));
  app.get("/api/messages", (c) => c.json(queryRecentMessages()));

  // SSE: proxy broker event stream for live updates
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
    staticRoot: resolveStaticRoot(options.staticRoot),
    viteDevUrl: options.viteDevUrl,
    defaultViteUrl: "http://127.0.0.1:5180",
  });

  const warmupCaches = () =>
    Promise.allSettled([
      shellStateCache.refresh(),
      loadPairingState(currentDirectory, true),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          console.error("[control-plane api] initial cache warmup failed:", message);
        }
      }
    });

  return { app, warmupCaches };
}
