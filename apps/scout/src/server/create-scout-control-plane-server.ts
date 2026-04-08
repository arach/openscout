import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";

import {
  controlScoutElectronPairingService,
  getScoutElectronPairingState,
  refreshScoutElectronPairingState,
  type ScoutPairingControlAction,
  type ScoutPairingState,
} from "../app/electron/pairing.ts";
import { composeScoutDesktopRelayShellPatch } from "../app/desktop/shell.ts";
import type { ScoutDesktopShellPatch } from "../app/desktop/index.ts";

export type ScoutWebAssetMode = "vite-proxy" | "static";

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

  const get = async () => {
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }
    if (cached && inflight) {
      return cached.value;
    }
    if (inflight) {
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
  };
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

  app.use("/*", cors());

  app.use("/api/*", async (c, next) => {
    try {
      await next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[control-plane api] ${c.req.method} ${c.req.path} failed:`, message);
      return c.json({ error: message }, 500);
    }
  });

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

  const viteUrl = options.viteDevUrl?.trim() || "http://127.0.0.1:5180";
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
    const root = resolveStaticRoot(options.staticRoot);
    app.use("/*", serveStatic({ root }));
    app.get("/*", serveStatic({
      root,
      path: "index.html",
    }));
  }

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
