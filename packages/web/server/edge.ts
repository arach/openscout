import { spawn, type ChildProcess } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { createRelayWebSocketProxy, type RelayWSData } from "./relay.ts";
import { startProcessParentWatchdog } from "./process-parent-watchdog.ts";
import { resolveOpenScoutWebApplicationServerIdentity } from "./app-server-origin.ts";
import {
  isTrustedScoutApiRequest,
  isTrustedWebSocketOrigin,
} from "./server-core.ts";

const DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS = 15_000;
const DEFAULT_HEALTH_INTERVAL_MS = 2_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 750;
const DEFAULT_UNHEALTHY_THRESHOLD = 5;
const DEFAULT_WORKER_STARTUP_GRACE_MS = 30_000;
const DEFAULT_MAX_REQUESTS_PER_WORKER = 64;
const MAX_WORKERS = 8;
const DEFAULT_EDGE_FETCH = globalThis.fetch.bind(globalThis);

export type WebEdgeWorker = {
  index: number;
  port: number;
  activeRequests: number;
  ready: boolean;
  consecutiveHealthFailures: number;
  lastSelectedAt: number;
  child: ChildProcess | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  restartCount: number;
  startedAt: number;
  everReady: boolean;
  healthCheckInFlight: boolean;
};

type WebEdgeSocketData = RelayWSData & { workerIndex: number };

export function resolveWebWorkerCount(
  env: NodeJS.ProcessEnv = process.env,
  parallelism = availableParallelism(),
): number {
  const configured = Number.parseInt(env.OPENSCOUT_WEB_WORKERS?.trim() ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(MAX_WORKERS, configured);
  }
  return Math.min(MAX_WORKERS, Math.max(2, Math.min(4, Math.ceil(parallelism / 2))));
}

export function resolveWebWorkerPortBase(
  publicPort: number,
  workerCount: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const configured = Number.parseInt(env.OPENSCOUT_WEB_WORKER_PORT_BASE?.trim() ?? "", 10);
  const fallback = 46_000 + (publicPort % 1_000);
  const base = Number.isFinite(configured) && configured > 0 ? configured : fallback;
  const last = base + workerCount - 1;
  const relayPort = Number.parseInt(
    env.OPENSCOUT_WEB_TERMINAL_RELAY_PORT?.trim() || String(publicPort + 1),
    10,
  );
  const overlaps = (candidate: number) => candidate >= base && candidate <= last;
  if (
    workerCount < 1
    || last > 65_535
    || overlaps(publicPort)
    || (Number.isFinite(relayPort) && overlaps(relayPort))
  ) {
    throw new Error(`Invalid Scout web worker port base ${base} for ${workerCount} workers.`);
  }
  return base;
}

export function routeRequiresPrimaryWorker(pathname: string): boolean {
  return pathname === "/pair"
    || pathname.startsWith("/api/pairing-state")
    || pathname.startsWith("/api/pairing/")
    || pathname.startsWith("/api/scoutbot/")
    || pathname.startsWith("/api/voice/")
    || pathname === "/api/notifications"
    || pathname.startsWith("/api/broadcast/");
}

export function startWebWorkerParentWatchdog(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    intervalMs?: number;
    parentPid?: () => number;
    exit?: () => void;
  } = {},
): ReturnType<typeof setInterval> | null {
  return startProcessParentWatchdog(env.OPENSCOUT_WEB_EDGE_PID, {
    intervalMs: options.intervalMs,
    parentPid: options.parentPid,
    onOrphan: options.exit,
  });
}

function normalizeEdgeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

export function resolveEdgeForwardedFor(
  request: Request,
  peerAddress: string | undefined,
  trustedProxyHosts: readonly string[],
): string | undefined {
  if (!peerAddress) return undefined;
  const hostname = normalizeEdgeHostname(new URL(request.url).hostname);
  const trustedHost = trustedProxyHosts.some(
    (candidate) => normalizeEdgeHostname(candidate) === hostname,
  );
  const normalizedPeer = normalizeEdgeHostname(peerAddress).replace(/^::ffff:/, "");
  const peerIsLoopback = normalizedPeer === "::1"
    || normalizedPeer === "localhost"
    || /^127(?:\.\d{1,3}){3}$/.test(normalizedPeer);
  if (peerIsLoopback && trustedHost) {
    const forwardedFor = request.headers.get("x-forwarded-for")?.trim();
    if (forwardedFor) return forwardedFor;
  }
  return peerAddress;
}

export function selectWebEdgeWorker(
  workers: readonly WebEdgeWorker[],
  pathname: string,
  maxActiveRequests = Number.POSITIVE_INFINITY,
): WebEdgeWorker | null {
  const ready = workers.filter((worker) => worker.ready && worker.child !== null);
  if (ready.length === 0) return null;
  if (routeRequiresPrimaryWorker(pathname)) {
    const primary = ready.find((worker) => worker.index === 0) ?? null;
    return primary && primary.activeRequests < maxActiveRequests ? primary : null;
  }
  const requestWorkers = ready.filter((worker) => worker.index !== 0);
  const pool = requestWorkers.length > 0 ? requestWorkers : ready;
  const candidates = pool.filter((worker) => worker.activeRequests < maxActiveRequests);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => {
    if (candidate.activeRequests !== best.activeRequests) {
      return candidate.activeRequests < best.activeRequests ? candidate : best;
    }
    return candidate.lastSelectedAt < best.lastSelectedAt ? candidate : best;
  });
}

function workerHttpUrl(worker: WebEdgeWorker, requestUrl: URL): string {
  return `http://127.0.0.1:${worker.port}${requestUrl.pathname}${requestUrl.search}`;
}

function workerWebSocketUrl(worker: WebEdgeWorker, requestUrl: URL): string {
  return `ws://127.0.0.1:${worker.port}${requestUrl.pathname}${requestUrl.search}`;
}

function copyProxyHeaders(
  request: Request,
  target: URL,
  forwardedFor?: string,
): Headers {
  const headers = new Headers(request.headers);
  headers.delete("connection");
  headers.delete("proxy-connection");
  headers.delete("keep-alive");
  headers.delete("te");
  headers.delete("trailer");
  headers.delete("transfer-encoding");
  headers.delete("upgrade");
  headers.set("x-forwarded-host", new URL(request.url).host);
  headers.set("x-forwarded-proto", new URL(request.url).protocol.slice(0, -1));
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  else headers.delete("x-forwarded-for");
  // Keep the public Host header so Hono's origin/trust checks see the URL the
  // client actually addressed, while fetch still connects to the private port.
  if (!headers.has("host")) headers.set("host", target.host);
  return headers;
}

function proxyResponse(
  response: Response,
  worker: WebEdgeWorker,
  release: () => void,
): Response {
  const headers = new Headers(response.headers);
  headers.delete("connection");
  headers.delete("keep-alive");
  headers.delete("transfer-encoding");
  headers.set("x-openscout-edge", "1");
  headers.set("x-openscout-worker", String(worker.index));
  if (!response.body) {
    release();
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  // Bun fetch transparently decodes compressed upstream bodies. The payload we
  // stream is therefore not described by the upstream encoding or byte count.
  headers.delete("content-encoding");
  headers.delete("content-length");
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          release();
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function edgeUnavailable(status: 502 | 503 | 504, message: string): Response {
  return Response.json(
    { error: message, surface: "openscout-web-edge" },
    { status, headers: { "cache-control": "no-store", "x-openscout-edge": "1" } },
  );
}

export type OpenScoutWebEdgeOptions = {
  hostname?: string;
  port?: number;
  workerCount?: number;
  workerPortBase?: number;
  workerEntry?: string;
  upstreamHeaderTimeoutMs?: number;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  unhealthyThreshold?: number;
  workerStartupGraceMs?: number;
  maxRequestsPerWorker?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

export async function startOpenScoutWebEdge(options: OpenScoutWebEdgeOptions = {}) {
  const env = options.env ?? process.env;
  const port = options.port ?? Number.parseInt(
    env.OPENSCOUT_WEB_PORT ?? env.SCOUT_WEB_PORT ?? "43120",
    10,
  );
  const hostname = options.hostname ?? (env.OPENSCOUT_WEB_HOST?.trim() || "0.0.0.0");
  const workerCount = options.workerCount ?? resolveWebWorkerCount(env);
  const workerPortBase = options.workerPortBase ?? resolveWebWorkerPortBase(port, workerCount, env);
  const workerEntry = options.workerEntry ?? fileURLToPath(import.meta.url);
  const upstreamHeaderTimeoutMs = options.upstreamHeaderTimeoutMs ?? DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS;
  const healthIntervalMs = options.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
  const healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const unhealthyThreshold = options.unhealthyThreshold ?? DEFAULT_UNHEALTHY_THRESHOLD;
  const workerStartupGraceMs = options.workerStartupGraceMs ?? DEFAULT_WORKER_STARTUP_GRACE_MS;
  const configuredMaxRequests = Number.parseInt(
    env.OPENSCOUT_WEB_MAX_REQUESTS_PER_WORKER?.trim() ?? "",
    10,
  );
  const maxRequestsPerWorker = options.maxRequestsPerWorker
    ?? (Number.isFinite(configuredMaxRequests) && configuredMaxRequests > 0
      ? Math.min(1_024, configuredMaxRequests)
      : DEFAULT_MAX_REQUESTS_PER_WORKER);
  const terminalRelayPort = env.OPENSCOUT_WEB_TERMINAL_RELAY_PORT?.trim() || String(port + 1);
  const fetchImpl = options.fetchImpl ?? DEFAULT_EDGE_FETCH;
  const applicationServerIdentity = resolveOpenScoutWebApplicationServerIdentity(env);
  const workers: WebEdgeWorker[] = Array.from({ length: workerCount }, (_, index) => ({
    index,
    port: workerPortBase + index,
    activeRequests: 0,
    ready: false,
    consecutiveHealthFailures: 0,
    lastSelectedAt: 0,
    child: null,
    restartTimer: null,
    restartCount: 0,
    startedAt: 0,
    everReady: false,
    healthCheckInFlight: false,
  }));
  let stopping = false;

  const spawnWorker = (worker: WebEdgeWorker) => {
    if (stopping || worker.child) return;
    worker.ready = false;
    worker.consecutiveHealthFailures = 0;
    worker.startedAt = Date.now();
    worker.everReady = false;
    worker.healthCheckInFlight = false;
    const child = spawn(process.execPath, [workerEntry], {
      env: {
        ...env,
        OPENSCOUT_WEB_PROCESS_ROLE: "worker",
        OPENSCOUT_WEB_EDGE_PID: String(process.pid),
        OPENSCOUT_WEB_WORKER_INDEX: String(worker.index),
        OPENSCOUT_WEB_WORKER_COUNT: String(workerCount),
        OPENSCOUT_WEB_PUBLIC_PORT: String(port),
        OPENSCOUT_WEB_PORT: String(worker.port),
        OPENSCOUT_WEB_HOST: "127.0.0.1",
        OPENSCOUT_WEB_TERMINAL_RELAY_PORT: terminalRelayPort,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    worker.child = child;
    child.once("exit", (code, signal) => {
      if (worker.child !== child) return;
      worker.child = null;
      worker.ready = false;
      if (stopping) return;
      worker.restartCount += 1;
      const delayMs = Math.min(5_000, 250 * worker.restartCount);
      console.error(`[openscout-edge] worker ${worker.index} exited (${signal ?? code}); restarting in ${delayMs}ms`);
      worker.restartTimer = setTimeout(() => {
        worker.restartTimer = null;
        spawnWorker(worker);
      }, delayMs);
    });
    child.once("error", (error) => {
      console.error(`[openscout-edge] worker ${worker.index} spawn failed:`, error);
    });
  };

  const recycleWorker = (worker: WebEdgeWorker, reason: string) => {
    const child = worker.child;
    if (!child) return;
    worker.ready = false;
    worker.child = null;
    console.error(`[openscout-edge] recycling worker ${worker.index}: ${reason}`);
    child.kill("SIGTERM");
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 3_000);
    force.unref?.();
    worker.restartCount += 1;
    worker.restartTimer = setTimeout(() => {
      worker.restartTimer = null;
      spawnWorker(worker);
    }, Math.max(3_250, Math.min(5_000, 250 * worker.restartCount)));
  };

  const checkWorker = async (worker: WebEdgeWorker) => {
    if (!worker.child || worker.healthCheckInFlight) return;
    worker.healthCheckInFlight = true;
    try {
      const response = await fetchImpl(`http://127.0.0.1:${worker.port}/api/health`, {
        headers: { accept: "application/json", host: `127.0.0.1:${port}` },
        signal: AbortSignal.timeout(healthTimeoutMs),
      });
      const body = response.ok ? await response.json().catch(() => null) as { ok?: boolean } | null : null;
      if (!body?.ok) throw new Error(`health returned ${response.status}`);
      worker.ready = true;
      worker.everReady = true;
      worker.consecutiveHealthFailures = 0;
      worker.restartCount = 0;
    } catch {
      worker.consecutiveHealthFailures += 1;
      const startupGraceElapsed = Date.now() - worker.startedAt >= workerStartupGraceMs;
      if (startupGraceElapsed && worker.consecutiveHealthFailures >= unhealthyThreshold) {
        worker.ready = false;
        recycleWorker(worker, `${worker.consecutiveHealthFailures} consecutive health timeouts`);
      } else if (!worker.everReady) {
        worker.ready = false;
      }
    } finally {
      worker.healthCheckInFlight = false;
    }
  };

  for (const worker of workers) spawnWorker(worker);
  const healthTimer = setInterval(() => {
    for (const worker of workers) void checkWorker(worker);
  }, healthIntervalMs);
  healthTimer.unref?.();
  setTimeout(() => {
    for (const worker of workers) void checkWorker(worker);
  }, 50).unref?.();

  const relayWebSocket = createRelayWebSocketProxy();
  let server: ReturnType<typeof Bun.serve<WebEdgeSocketData>>;

  const proxyHttp = async (
    request: Request,
    worker: WebEdgeWorker,
    peerAddress?: string,
  ): Promise<Response> => {
    const requestUrl = new URL(request.url);
    const targetUrl = new URL(workerHttpUrl(worker, requestUrl));
    const controller = new AbortController();
    const onClientAbort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", onClientAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("upstream header timeout")), upstreamHeaderTimeoutMs);
    worker.activeRequests += 1;
    worker.lastSelectedAt = Date.now();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      worker.activeRequests = Math.max(0, worker.activeRequests - 1);
    };
    try {
      const response = await fetchImpl(targetUrl, {
        method: request.method,
        headers: copyProxyHeaders(
          request,
          targetUrl,
          resolveEdgeForwardedFor(request, peerAddress, applicationServerIdentity.trustedHosts),
        ),
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
        signal: controller.signal,
      });
      return proxyResponse(response, worker, release);
    } catch (error) {
      release();
      throw error;
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onClientAbort);
    }
  };

  server = Bun.serve<WebEdgeSocketData>({
    hostname,
    port,
    idleTimeout: 30,
    async fetch(request, bunServer) {
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname === "/api/health") {
        const readyWorkers = workers.filter((worker) => worker.ready).length;
        return Response.json({
          ok: !stopping && readyWorkers > 0,
          surface: "openscout-web",
          edge: true,
          stopping,
          workers: { ready: readyWorkers, total: workers.length },
        }, {
          status: !stopping && readyWorkers > 0 ? 200 : 503,
          headers: { "cache-control": "no-store", "x-openscout-edge": "1" },
        });
      }
      if (stopping) {
        return edgeUnavailable(503, "The Scout web edge is restarting.");
      }
      const peerAddress = bunServer.requestIP(request)?.address;
      if (
        requestUrl.pathname.startsWith("/api/")
        && !isTrustedScoutApiRequest(request, {
          trustedHosts: applicationServerIdentity.trustedHosts,
          trustedOrigins: applicationServerIdentity.trustedOrigins,
        }, peerAddress)
      ) {
        return Response.json({ error: "forbidden" }, {
          status: 403,
          headers: { "x-openscout-edge": "1" },
        });
      }

      const worker = selectWebEdgeWorker(
        workers,
        requestUrl.pathname,
        maxRequestsPerWorker,
      );
      if (!worker) {
        const readyWorkers = workers.filter((candidate) => candidate.ready && candidate.child !== null);
        const targetReady = routeRequiresPrimaryWorker(requestUrl.pathname)
          ? readyWorkers.some((candidate) => candidate.index === 0)
          : readyWorkers.length > 0;
        return edgeUnavailable(503, targetReady
          ? "Scout request workers are at capacity."
          : routeRequiresPrimaryWorker(requestUrl.pathname)
            ? "The primary Scout request worker is unavailable."
            : "No Scout request worker is ready.");
      }

      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        if (!isTrustedWebSocketOrigin(request.headers.get("origin"), requestUrl.host, {
          trustedHosts: applicationServerIdentity.trustedHosts,
          trustedOrigins: applicationServerIdentity.trustedOrigins,
        })) {
          return new Response("Forbidden", { status: 403 });
        }
        const upgraded = bunServer.upgrade(request, {
          data: {
            upstream: null,
            pending: [],
            upstreamProtocol: request.headers.get("sec-websocket-protocol"),
            upstreamUrl: workerWebSocketUrl(worker, requestUrl),
            workerIndex: worker.index,
          },
        });
        return upgraded
          ? (undefined as unknown as Response)
          : edgeUnavailable(502, "WebSocket upgrade failed at the Scout edge.");
      }

      try {
        return await proxyHttp(request, worker, peerAddress);
      } catch (error) {
        const timedOut = error instanceof Error && /abort|timeout/i.test(error.message);
        return edgeUnavailable(timedOut ? 504 : 502, timedOut
          ? `Scout request worker ${worker.index} exceeded the response-header deadline.`
          : `Scout request worker ${worker.index} is unavailable.`);
      }
    },
    websocket: {
      open(socket) {
        const worker = workers[socket.data.workerIndex];
        if (worker) worker.activeRequests += 1;
        relayWebSocket.open(socket);
      },
      message(socket, message) {
        relayWebSocket.message(socket, message);
      },
      close(socket) {
        const worker = workers[socket.data.workerIndex];
        if (worker) worker.activeRequests = Math.max(0, worker.activeRequests - 1);
        relayWebSocket.close(socket);
      },
    },
  });

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(healthTimer);
    const children = workers.flatMap((worker) => worker.child ? [worker.child] : []);
    for (const worker of workers) {
      if (worker.restartTimer) clearTimeout(worker.restartTimer);
      worker.restartTimer = null;
      worker.child?.kill("SIGTERM");
    }
    await Promise.race([
      Promise.all(children.map((child) => new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once("exit", () => resolve());
      }))),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    for (const worker of workers) worker.ready = false;
    await server.stop(true);
  };

  console.log(`OpenScout edge -> http://${hostname}:${server.port} (${workerCount} workers)`);
  return { server, workers, stop };
}

if (import.meta.main) {
  if (process.env.OPENSCOUT_WEB_PROCESS_ROLE === "worker") {
    startWebWorkerParentWatchdog();
    await import("./index.ts");
  } else {
    process.title = "scout-web-edge";
    const edge = await startOpenScoutWebEdge();
    let stopping = false;
    const shutdown = (signal: NodeJS.Signals) => {
      if (stopping) process.exit(1);
      stopping = true;
      console.log(`[openscout-edge] ${signal} received; stopping edge and workers.`);
      void edge.stop().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}
