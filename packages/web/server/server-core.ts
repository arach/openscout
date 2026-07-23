import type { Context, Hono } from "hono";
import { getConnInfo, serveStatic } from "hono/bun";

export type ScoutWebAssetMode = "vite-proxy" | "static";

const LOOPBACK_IPV4_HOST_PATTERN = /^127(?:\.\d{1,3}){3}$/;

export type ScoutApiTrustOptions = {
  trustedHosts?: string[];
  trustedOrigins?: string[];
  /**
   * Resolve the peer (socket) address of the request. The Host header is
   * client-controlled and cannot be used to prove a request is local; the socket
   * peer address can. Overridable for tests; defaults to the Bun connection info
   * and returns undefined when the peer is unavailable (e.g. the Hono test
   * harness, which has no socket).
   */
  resolvePeerAddress?: (c: Context) => string | undefined;
};

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isTrustedLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "0.0.0.0"
    || normalized === "::1"
    || LOOPBACK_IPV4_HOST_PATTERN.test(normalized);
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return null;
  }
}

function trustedHostSet(options: ScoutApiTrustOptions): Set<string> {
  return new Set(
    (options.trustedHosts ?? [])
      .map(normalizeHostname)
      .filter(Boolean),
  );
}

function trustedOriginSet(options: ScoutApiTrustOptions): Set<string> {
  return new Set(
    (options.trustedOrigins ?? [])
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  );
}

function isTrustedApiHostname(hostname: string, options: ScoutApiTrustOptions): boolean {
  return isTrustedLoopbackHostname(hostname) || trustedHostSet(options).has(normalizeHostname(hostname));
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized === "::1" || normalized === "localhost") {
    return true;
  }
  // Unwrap IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1).
  const mapped = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  return LOOPBACK_IPV4_HOST_PATTERN.test(mapped);
}

function defaultPeerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

export function isTrustedScoutApiRequest(
  request: Request,
  options: ScoutApiTrustOptions = {},
  peerAddress?: string,
): boolean {
  const requestUrl = new URL(request.url);
  const hostname = normalizeHostname(requestUrl.hostname);
  const hostIsLoopbackName = isTrustedLoopbackHostname(hostname);
  const hostIsTrustedName = trustedHostSet(options).has(hostname);
  if (!hostIsLoopbackName && !hostIsTrustedName) {
    return false;
  }

  // A request presenting a loopback Host (localhost / 127.x / 0.0.0.0) is only
  // trusted when it actually originates from a loopback peer. Otherwise a LAN
  // client can send `Host: localhost` to a 0.0.0.0-bound port and pass this gate
  // with no Origin / Sec-Fetch-Site headers. The socket peer address is
  // authoritative because the client cannot forge it. When the peer is unknown
  // (the Hono test harness has no socket) we fall back to the header check;
  // production requests always carry a peer address.
  if (hostIsLoopbackName && !hostIsTrustedName) {
    const peer = peerAddress;
    if (peer !== undefined && !isLoopbackAddress(peer)) {
      return false;
    }
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (
        !isTrustedApiHostname(originUrl.hostname, options)
        || (
          originUrl.origin !== requestUrl.origin
          && !trustedOriginSet(options).has(originUrl.origin.toLowerCase())
        )
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return false;
  }

  return true;
}

/**
 * Whether a WebSocket upgrade may be accepted, given its Origin and the request
 * host. Browsers always send Origin on WS handshakes, so this blocks a malicious
 * page (drive-by) from opening privileged proxy sockets (terminal / tail /
 * events) in the user's browser. Non-browser clients send no Origin and are
 * allowed through — the WS transport itself is not same-origin-protected by the
 * browser, so this is the drive-by defense, not a network-position gate.
 */
export function isTrustedWebSocketOrigin(
  origin: string | null | undefined,
  requestHost: string,
  options: ScoutApiTrustOptions = {},
): boolean {
  if (!origin) {
    return true;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.host.toLowerCase() === requestHost.toLowerCase()) {
    return true;
  }
  return (
    isTrustedApiHostname(originUrl.hostname, options)
    || trustedOriginSet(options).has(originUrl.origin.toLowerCase())
  );
}

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

export function installScoutApiMiddleware(
  app: Hono,
  label = "api",
  options: ScoutApiTrustOptions = {},
): void {
  app.use("/api/*", async (c, next) => {
    const peerAddress = (options.resolvePeerAddress ?? defaultPeerAddress)(c);
    if (!isTrustedScoutApiRequest(c.req.raw, options, peerAddress)) {
      return c.json({ error: "forbidden" }, 403);
    }

    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("X-Content-Type-Options", "nosniff");

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
    viteDevUrl?: string;
    defaultViteUrl: string;
  },
): Promise<void> {
  const viteUrl = options.viteDevUrl?.trim() || options.defaultViteUrl;

  if (options.assetMode === "vite-proxy") {
    app.all("/*", async (c) => {
      const target = new URL(c.req.path, viteUrl);
      target.search = new URL(c.req.url).search;
      const headers = new Headers(c.req.header());
      headers.delete("host");
      try {
        const response = await fetch(target.toString(), {
          method: c.req.method,
          headers,
          body:
            c.req.method !== "GET" && c.req.method !== "HEAD"
              ? c.req.raw.body
              : undefined,
        });
        return new Response(response.body, {
          status: response.status,
          headers: response.headers,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[openscout-web] vite proxy failed for ${target.toString()}: ${message}`);
        return c.text("Vite dev server unavailable", 502);
      }
    });
    return;
  }

  app.use("/*", serveStatic({ root: options.staticRoot }));
  app.get("/assets/*", (c) => c.notFound());
  app.get("/*", serveStatic({
    root: options.staticRoot,
    path: "index.html",
    onFound: (_path, c) => {
      c.header("cache-control", "no-store");
    },
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
