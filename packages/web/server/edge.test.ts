import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  resolveWebWorkerCount,
  resolveWebWorkerPortBase,
  resolveEdgeForwardedFor,
  routeRequiresPrimaryWorker,
  selectWebEdgeWorker,
  startWebWorkerParentWatchdog,
  type WebEdgeWorker,
} from "./edge.ts";

function worker(
  index: number,
  overrides: Partial<WebEdgeWorker> = {},
): WebEdgeWorker {
  return {
    index,
    port: 44_120 + index,
    activeRequests: 0,
    ready: true,
    consecutiveHealthFailures: 0,
    lastSelectedAt: index,
    child: {} as ChildProcess,
    restartTimer: null,
    restartCount: 0,
    startedAt: 0,
    everReady: true,
    healthCheckInFlight: false,
    ...overrides,
  };
}

describe("OpenScout web edge", () => {
  test("uses a bounded CPU-aware worker default and honors configuration", () => {
    expect(resolveWebWorkerCount({}, 1)).toBe(2);
    expect(resolveWebWorkerCount({}, 8)).toBe(4);
    expect(resolveWebWorkerCount({ OPENSCOUT_WEB_WORKERS: "6" }, 2)).toBe(6);
    expect(resolveWebWorkerCount({ OPENSCOUT_WEB_WORKERS: "999" }, 2)).toBe(8);
  });

  test("allocates private worker ports away from the public and relay ports", () => {
    expect(resolveWebWorkerPortBase(43_120, 4, {})).toBe(46_120);
    expect(resolveWebWorkerPortBase(43_120, 4, {
      OPENSCOUT_WEB_WORKER_PORT_BASE: "45000",
    })).toBe(45_000);
    expect(() => resolveWebWorkerPortBase(43_120, 4, {
      OPENSCOUT_WEB_WORKER_PORT_BASE: "43121",
    })).toThrow("Invalid Scout web worker port base");
    expect(() => resolveWebWorkerPortBase(43_120, 4, {
      OPENSCOUT_WEB_WORKER_PORT_BASE: "43118",
    })).toThrow("Invalid Scout web worker port base");
    expect(() => resolveWebWorkerPortBase(43_120, 4, {
      OPENSCOUT_WEB_WORKER_PORT_BASE: "45000",
      OPENSCOUT_WEB_TERMINAL_RELAY_PORT: "45002",
    })).toThrow("Invalid Scout web worker port base");
    expect(resolveWebWorkerPortBase(43_120, 1, {
      OPENSCOUT_WEB_WORKER_PORT_BASE: "65535",
      OPENSCOUT_WEB_TERMINAL_RELAY_PORT: "43121",
    })).toBe(65_535);
  });

  test("pins in-memory singleton routes to worker zero", () => {
    expect(routeRequiresPrimaryWorker("/pair")).toBe(true);
    expect(routeRequiresPrimaryWorker("/api/pairing/requests")).toBe(true);
    expect(routeRequiresPrimaryWorker("/api/scoutbot/threads")).toBe(true);
    expect(routeRequiresPrimaryWorker("/api/voice/health")).toBe(true);
    expect(routeRequiresPrimaryWorker("/api/notifications")).toBe(true);
    expect(routeRequiresPrimaryWorker("/api/broadcast/recent")).toBe(true);
    expect(routeRequiresPrimaryWorker("/api/broadcast/stream")).toBe(true);
    expect(routeRequiresPrimaryWorker("/api/session/chn-123")).toBe(false);

    expect(selectWebEdgeWorker([worker(0, { activeRequests: 8 }), worker(1)], "/api/scoutbot/threads")?.index)
      .toBe(0);
    expect(selectWebEdgeWorker([worker(0, { ready: false }), worker(1)], "/api/scoutbot/threads"))
      .toBeNull();
  });

  test("worker parent watchdog ignores the expected parent and exits after reparenting", async () => {
    let parentPid = 123;
    let exits = 0;
    const timer = startWebWorkerParentWatchdog(
      { OPENSCOUT_WEB_EDGE_PID: "123" },
      {
        intervalMs: 5,
        parentPid: () => parentPid,
        exit: () => { exits += 1; },
      },
    );
    expect(timer).not.toBeNull();
    await Bun.sleep(15);
    expect(exits).toBe(0);
    parentPid = 1;
    await Bun.sleep(15);
    expect(exits).toBeGreaterThan(0);
    if (timer) clearInterval(timer);
  });

  test("preserves Caddy client forwarding only from a loopback peer on a trusted host", () => {
    const proxied = new Request("http://scout.local/api/health", {
      headers: { "x-forwarded-for": "192.168.1.44" },
    });
    expect(resolveEdgeForwardedFor(proxied, "127.0.0.1", ["scout.local"]))
      .toBe("192.168.1.44");
    expect(resolveEdgeForwardedFor(proxied, "10.0.0.8", ["scout.local"]))
      .toBe("10.0.0.8");
    expect(resolveEdgeForwardedFor(proxied, "127.0.0.1", ["other.local"]))
      .toBe("127.0.0.1");
  });

  test("sends ordinary requests to the least busy ready worker", () => {
    const selected = selectWebEdgeWorker([
      worker(0, { activeRequests: 0 }),
      worker(1, { activeRequests: 1, lastSelectedAt: 20 }),
      worker(2, { activeRequests: 1, lastSelectedAt: 10 }),
      worker(3, { activeRequests: 0, ready: false }),
    ], "/api/session/chn-123");
    expect(selected?.index).toBe(2);
  });

  test("keeps the singleton worker out of the general pool while request workers are ready", () => {
    expect(selectWebEdgeWorker([
      worker(0, { activeRequests: 0 }),
      worker(1, { activeRequests: 4 }),
    ], "/api/session/chn-123")?.index).toBe(1);
  });

  test("does not route beyond the configured per-worker concurrency bound", () => {
    expect(selectWebEdgeWorker([
      worker(0, { activeRequests: 64 }),
      worker(1, { activeRequests: 64 }),
      worker(2, { activeRequests: 63 }),
    ], "/api/session/chn-123", 64)?.index).toBe(2);
    expect(selectWebEdgeWorker([
      worker(0, { activeRequests: 0 }),
      worker(1, { activeRequests: 64 }),
    ], "/api/session/chn-123", 64)).toBeNull();
    expect(selectWebEdgeWorker([
      worker(0, { activeRequests: 64 }),
      worker(1),
    ], "/api/voice/health", 64)).toBeNull();
  });

  test("uses worker zero only when no general request worker is healthy", () => {
    expect(selectWebEdgeWorker([
      worker(0, { activeRequests: 0 }),
      worker(1, { activeRequests: 64 }),
      worker(2, { activeRequests: 64 }),
    ], "/api/session/chn-123", 64)).toBeNull();
    expect(selectWebEdgeWorker([
      worker(0, { activeRequests: 0 }),
      worker(1, { ready: false }),
    ], "/api/session/chn-123", 64)?.index).toBe(0);
  });

  test("passes the isolated process integration suite", async () => {
    const script = fileURLToPath(new URL("./edge.integration.ts", import.meta.url));
    const child = Bun.spawn([process.execPath, script], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 20_000);
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearTimeout(timeout);
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  }, 25_000);
});
