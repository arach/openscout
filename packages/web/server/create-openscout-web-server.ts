import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import {
  controlScoutWebPairingService,
  getScoutWebPairingState,
  refreshScoutWebPairingState,
  type ScoutPairingControlAction,
  type ScoutPairingState,
} from "./pairing.ts";
import {
  createCachedSnapshot,
  installScoutApiMiddleware,
  registerScoutWebAssets,
  type ScoutWebAssetMode,
} from "./server-core.ts";
import {
  queryAgents,
  queryActivity,
  queryFlights,
  queryRecentMessages,
} from "./db-queries.ts";
import { sendScoutMessage } from "./core/broker/service.ts";
import { loadOpenScoutWebShellState, type OpenScoutWebShellState } from "./runtime-summary.ts";
import { loadUserConfig, saveUserConfig, resolveOperatorName } from "@openscout/runtime/user-config";

export type { ScoutWebAssetMode } from "./server-core.ts";

export type CreateOpenScoutWebServerOptions = {
  currentDirectory: string;
  shellStateCacheTtlMs?: number;
  assetMode: ScoutWebAssetMode;
  viteDevUrl?: string;
  staticRoot?: string;
};

export type OpenScoutWebServer = {
  app: Hono;
  warmupCaches: () => Promise<void>;
};

function resolveBundledStaticClientRoot(moduleUrl: string | URL = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "client");
}

function resolveSourceStaticClientRoot(moduleUrl: string | URL = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../dist/client");
}

function resolveStaticRoot(staticRoot: string | undefined): string {
  const configured = staticRoot?.trim();
  if (configured) {
    return configured;
  }

  const bundled = resolveBundledStaticClientRoot(import.meta.url);
  if (existsSync(resolve(bundled, "index.html"))) {
    return bundled;
  }

  return resolveSourceStaticClientRoot(import.meta.url);
}

async function loadPairingState(currentDirectory: string, refresh: boolean): Promise<ScoutPairingState> {
  return refresh
    ? refreshScoutWebPairingState(currentDirectory)
    : getScoutWebPairingState(currentDirectory);
}

export function createOpenScoutWebServer(
  options: CreateOpenScoutWebServerOptions,
): OpenScoutWebServer {
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const currentDirectory = options.currentDirectory;
  const app = new Hono();
  const shellStateCache = createCachedSnapshot<OpenScoutWebShellState>(loadOpenScoutWebShellState, shellTtl);

  installScoutApiMiddleware(app, "openscout-web api");

  app.get("/api/pairing-state", async (c) => c.json(await loadPairingState(currentDirectory, false)));
  app.get("/api/pairing-state/refresh", async (c) => c.json(await loadPairingState(currentDirectory, true)));
  app.post("/api/pairing/control", async (c) => {
    const { action } = await c.req.json() as { action: ScoutPairingControlAction };
    const result = await controlScoutWebPairingService(action, currentDirectory);
    shellStateCache.invalidate();
    return c.json(result);
  });

  app.get("/api/shell-state", async (c) => c.json(await shellStateCache.get()));
  app.get("/api/shell-state/refresh", async (c) => c.json(await shellStateCache.refresh()));

  app.get("/api/agents", (c) => c.json(queryAgents()));
  app.get("/api/activity", (c) => c.json(queryActivity()));
  app.get("/api/messages", (c) => c.json(queryRecentMessages()));
  app.get("/api/flights", (c) => {
    const agentId = c.req.query("agentId");
    const conversationId = c.req.query("conversationId");
    const activeOnly = c.req.query("active") !== "false";
    return c.json(queryFlights({
      agentId: agentId || undefined,
      conversationId: conversationId || undefined,
      activeOnly,
    }));
  });

  app.get("/api/user", (c) => {
    return c.json({ name: resolveOperatorName() });
  });

  app.post("/api/user", async (c) => {
    const { name } = await c.req.json() as { name?: string };
    const config = loadUserConfig();
    if (name?.trim()) {
      config.name = name.trim();
    } else {
      delete config.name;
    }
    saveUserConfig(config);
    return c.json({ name: resolveOperatorName() });
  });

  app.post("/api/send", async (c) => {
    const { body, conversationId } = await c.req.json() as { body: string; conversationId?: string };
    if (!body?.trim()) {
      return c.json({ error: "body is required" }, 400);
    }

    // If sending from a DM conversation, extract the agent and ensure @mention
    // so sendScoutMessage routes to the DM instead of channel.shared
    let finalBody = body.trim();
    if (conversationId?.startsWith("dm.operator.")) {
      const agentId = conversationId.slice("dm.operator.".length);
      if (agentId && !finalBody.includes(`@${agentId}`)) {
        finalBody = `@${agentId} ${finalBody}`;
      }
    }

    const result = await sendScoutMessage({
      senderId: resolveOperatorName(),
      body: finalBody,
      currentDirectory,
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }

    return c.json(result);
  });

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
          console.error("[openscout-web api] initial cache warmup failed:", message);
        }
      }
    });

  return { app, warmupCaches };
}
