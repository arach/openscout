import type { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";

export type ScoutWebAssetMode = "vite-dev" | "static";

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

export async function registerScoutWebAssets(
  app: Hono,
  options: {
    assetMode: ScoutWebAssetMode;
    staticRoot: string;
    viteConfigPath?: string;
  },
): Promise<void> {
  if (options.assetMode === "vite-dev") {
    const { createServer } = await import("vite");
    const fs = await import("node:fs");
    const path = await import("node:path");

    const vite = await createServer({
      configFile: options.viteConfigPath,
      server: { middlewareMode: true, hmr: { port: 5183 } },
      appType: "custom",
    });

    const viteRoot = (vite.config.root ?? process.cwd()).replace(/\/$/, "");

    const proxyToVite = (req: Request, url: URL): Promise<Response> => {
      return new Promise<Response>((resolve) => {
        const http = require("node:http");
        const { Duplex } = require("node:stream");

        const socket = new Duplex({
          read() {},
          write(_chunk: unknown, _encoding: string, cb: () => void) { cb(); },
        });

        const nodeReq = new http.IncomingMessage(socket);
        nodeReq.method = req.method;
        nodeReq.url = url.pathname + url.search;
        nodeReq.headers = {};
        for (const [key, value] of req.headers.entries()) {
          nodeReq.headers[key.toLowerCase()] = value;
        }

        const nodeRes = new http.ServerResponse(nodeReq);
        const chunks: Buffer[] = [];

        nodeRes.write = function (chunk: unknown) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
          return true;
        };

        const originalEnd = nodeRes.end.bind(nodeRes);
        nodeRes.end = function (chunk?: unknown) {
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
          }
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, val] of Object.entries(nodeRes.getHeaders())) {
            if (val == null) continue;
            if (Array.isArray(val)) {
              for (const v of val) headers.append(key, v);
            } else {
              headers.set(key, String(val));
            }
          }
          resolve(new Response(body.length > 0 ? body : null, {
            status: nodeRes.statusCode,
            headers,
          }));
          return originalEnd();
        } as typeof nodeRes.end;

        vite.middlewares.handle(nodeReq, nodeRes, async () => {
          // Vite didn't handle it — serve index.html as SPA fallback
          try {
            const indexPath = path.join(viteRoot, "index.html");
            let html = fs.readFileSync(indexPath, "utf-8");
            html = await vite.transformIndexHtml(url.pathname, html);
            resolve(new Response(html, {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            }));
          } catch {
            resolve(new Response("Not Found", { status: 404 }));
          }
        });
      });
    };

    app.all("/*", async (c) => {
      const url = new URL(c.req.url);
      return proxyToVite(c.req.raw, url);
    });
    return;
  }

  app.use("/*", serveStatic({ root: options.staticRoot }));
  app.get("/*", serveStatic({
    root: options.staticRoot,
    path: "index.html",
  }));
}

export async function relayEventStream(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const requestHeaders = new Headers(init?.headers);
  if (!requestHeaders.has("accept")) {
    requestHeaders.set("accept", "text/event-stream");
  }

  const upstream = await fetch(url, {
    ...init,
    headers: requestHeaders,
  });

  if (!upstream.ok || !upstream.body) {
    const contentType = upstream.headers.get("content-type") ?? "text/plain; charset=utf-8";
    const message = await upstream.text().catch(() => "Event stream unavailable");
    return new Response(message || "Event stream unavailable", {
      status: upstream.status || 502,
      statusText: upstream.statusText,
      headers: {
        "content-type": contentType,
        "cache-control": "no-cache, no-transform",
      },
    });
  }

  const responseHeaders = new Headers();
  responseHeaders.set("content-type", upstream.headers.get("content-type") ?? "text/event-stream");
  responseHeaders.set("cache-control", upstream.headers.get("cache-control") ?? "no-cache, no-transform");
  responseHeaders.set("connection", "keep-alive");
  responseHeaders.set("x-accel-buffering", "no");

  const reader = upstream.body.getReader();
  const clientSignal = init?.signal;
  const abortUpstream = () => {
    void reader.cancel().catch(() => {});
  };
  clientSignal?.addEventListener("abort", abortUpstream, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            controller.close();
            return;
          }
          controller.error(error);
        } finally {
          clientSignal?.removeEventListener("abort", abortUpstream);
          try {
            reader.releaseLock();
          } catch {
            // Reader may already be released after cancellation.
          }
        }
      };

      void pump();
    },
    cancel(reason) {
      clientSignal?.removeEventListener("abort", abortUpstream);
      return reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(stream, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
