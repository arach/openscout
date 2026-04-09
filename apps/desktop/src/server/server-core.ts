import type { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";

export type ScoutWebAssetMode = "vite-proxy" | "static";

export function coalesce<T>(fn: () => Promise<T>, ttlMs = 2000): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  let cached: { value: T; expiresAt: number } | null = null;

  return () => {
    if (cached && Date.now() < cached.expiresAt) {
      return Promise.resolve(cached.value);
    }
    if (inflight) {
      return inflight;
    }

    inflight = fn()
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
}

export function createCachedSnapshot<T>(load: () => Promise<T>, ttlMs: number) {
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

export function installScoutApiMiddleware(app: Hono, label = "api"): void {
  app.use("/*", cors());

  app.use("/api/*", async (c, next) => {
    try {
      await next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${label}] ${c.req.method} ${c.req.path} failed:`, message);
      return c.json({ error: message }, 500);
    }
  });
}

export function registerScoutWebAssets(
  app: Hono,
  options: {
    assetMode: ScoutWebAssetMode;
    staticRoot: string;
    viteDevUrl?: string;
    defaultViteUrl: string;
  },
): void {
  const viteUrl = options.viteDevUrl?.trim() || options.defaultViteUrl;

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
    return;
  }

  app.use("/*", serveStatic({ root: options.staticRoot }));
  app.get("/*", serveStatic({
    root: options.staticRoot,
    path: "index.html",
  }));
}
