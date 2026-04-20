import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import {
  controlScoutDesktopPairingService,
  getScoutDesktopPairingState,
  refreshScoutDesktopPairingState,
  type ScoutPairingControlAction,
  type ScoutPairingState,
} from "../app/host/pairing.ts";
import { composeScoutDesktopRelayShellPatch } from "../app/desktop/shell.ts";
import type { ScoutDesktopShellPatch } from "../app/desktop/index.ts";
import {
  createCachedSnapshot,
  installScoutApiMiddleware,
  relayEventStream,
  registerScoutWebAssets,
  type ScoutWebAssetMode,
} from "./server-core.ts";
import {
  queryAgents,
  queryActivity,
  queryFleet,
  queryRecentMessages,
  queryFlights,
  queryWorkItemById,
  queryWorkItems,
} from "./db-queries.ts";
import { sendScoutMessage } from "../core/broker/service.ts";

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

function parseOptionalPositiveInt(value: string | undefined, fallback?: number): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
    ? refreshScoutDesktopPairingState(currentDirectory)
    : getScoutDesktopPairingState(currentDirectory);
}

export function createScoutControlPlaneServer(
  options: CreateScoutControlPlaneServerOptions,
): ScoutControlPlaneServer {
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const currentDirectory = options.currentDirectory;
  const app = new Hono();
  const shellStateCache = createCachedSnapshot(() => loadControlPlaneShellState(currentDirectory), shellTtl);

  installScoutApiMiddleware(app, "control-plane api");

  app.get("/api/health", (c) => c.json({
    ok: true,
    surface: "control-plane",
    currentDirectory,
  }));
  app.get("/api/pairing-state", async (c) => c.json(await loadPairingState(currentDirectory, false)));
  app.get("/api/pairing-state/refresh", async (c) => c.json(await loadPairingState(currentDirectory, true)));
  app.post("/api/pairing/control", async (c) => {
    const { action } = await c.req.json() as { action: ScoutPairingControlAction };
    const result = await controlScoutDesktopPairingService(action, currentDirectory);
    shellStateCache.invalidate();
    return c.json(result);
  });
  app.get("/api/shell-state", async (c) => c.json(await shellStateCache.get()));
  app.get("/api/shell-state/refresh", async (c) => c.json(await shellStateCache.refresh()));

  // Direct SQLite reads — no shell calls, no snapshot rebuilds
  app.get("/api/agents", (c) => c.json(queryAgents()));
  app.get("/api/activity", (c) => c.json(queryActivity()));
  app.get("/api/fleet", (c) =>
    c.json(queryFleet({
      limit: parseOptionalPositiveInt(c.req.query("limit")),
      activityLimit: parseOptionalPositiveInt(c.req.query("activityLimit")),
    })));
  app.get("/api/messages", (c) => c.json(queryRecentMessages()));
  app.get("/api/work", (c) => {
    const agentId = c.req.query("agentId");
    const activeOnly = c.req.query("active") !== "false";
    return c.json(queryWorkItems({
      agentId: agentId || undefined,
      activeOnly,
    }));
  });
  app.get("/api/work/:id", (c) => {
    const detail = queryWorkItemById(c.req.param("id"));
    return detail ? c.json(detail) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/flights", (c) => {
    const agentId = c.req.query("agentId");
    const conversationId = c.req.query("conversationId");
    const collaborationRecordId = c.req.query("collaborationRecordId");
    const activeOnly = c.req.query("active") !== "false";
    return c.json(queryFlights({
      agentId: agentId || undefined,
      conversationId: conversationId || undefined,
      collaborationRecordId: collaborationRecordId || undefined,
      activeOnly,
    }));
  });

  // Send a message to an agent via the broker
  app.post("/api/send", async (c) => {
    const { body } = await c.req.json() as { body: string };
    if (!body?.trim()) return c.json({ error: "body is required" }, 400);
    const result = await sendScoutMessage({
      senderId: "operator",
      body: body.trim(),
      currentDirectory,
    });
    if (!result.usedBroker) return c.json({ error: "broker unreachable" }, 502);
    if (result.unresolvedTargets.length > 0) {
      return c.json({ error: `unresolved targets: ${result.unresolvedTargets.join(", ")}` }, 409);
    }
    return c.json(result);
  });

  // SSE: proxy broker event stream for live updates
  app.get("/api/events", async (c) => {
    const brokerHost = process.env.OPENSCOUT_BROKER_HOST ?? "127.0.0.1";
    const brokerPort = process.env.OPENSCOUT_BROKER_PORT ?? "65535";
    const brokerUrl = process.env.OPENSCOUT_BROKER_URL ?? `http://${brokerHost}:${brokerPort}`;
    try {
      return await relayEventStream(`${brokerUrl}/v1/events/stream`, {
        signal: c.req.raw.signal,
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
