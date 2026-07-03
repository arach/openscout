import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defineProbe,
  defineProbeFamily,
  gitBuildInfoProbe,
  resetScoutdProbeClientForTests,
  resetGitBuildInfoProbeForTests,
  tailscaleStatusProbe
} from "./system-probes/index";

const tempDirectories = new Set<string>();
const originalTailscaleBin = process.env.OPENSCOUT_TAILSCALE_BIN;
const originalTailscaleFixture = process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
const originalProbesSocket = process.env.OPENSCOUT_PROBES_SOCKET;
const originalOpenScoutHome = process.env.OPENSCOUT_HOME;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 250);
    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function startScoutdProbeServer(socketPath: string, handler: (request: any) => any): Promise<Server> {
  rmSync(socketPath, { force: true });
  const server = createServer((socket: Socket) => {
    let raw = "";
    let handled = false;
    const respond = () => {
      if (handled) return;
      handled = true;
      const body = raw.trim();
      try {
        const request = JSON.parse(body);
        socket.end(`${JSON.stringify(handler(request))}\n`);
      } catch (error) {
        socket.end(JSON.stringify({
          schema: "openscout.probe.error/v1",
          error: {
            code: "test_error",
            message: error instanceof Error ? error.message : String(error),
          },
          daemonVersion: "test",
        }));
      }
    };
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      raw += chunk;
      if (raw.includes("\n")) {
        respond();
      }
    });
    socket.on("end", respond);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(directory);
  return directory;
}

beforeEach(() => {
  const directory = tempDir("openscout-probes-disabled-");
  process.env.OPENSCOUT_PROBES_SOCKET = join(directory, "missing.sock");
  resetScoutdProbeClientForTests();
});

afterEach(() => {
  if (originalTailscaleBin === undefined) {
    delete process.env.OPENSCOUT_TAILSCALE_BIN;
  } else {
    process.env.OPENSCOUT_TAILSCALE_BIN = originalTailscaleBin;
  }
  if (originalTailscaleFixture === undefined) {
    delete process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  } else {
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON = originalTailscaleFixture;
  }
  if (originalProbesSocket === undefined) {
    delete process.env.OPENSCOUT_PROBES_SOCKET;
  } else {
    process.env.OPENSCOUT_PROBES_SOCKET = originalProbesSocket;
  }
  if (originalOpenScoutHome === undefined) {
    delete process.env.OPENSCOUT_HOME;
  } else {
    process.env.OPENSCOUT_HOME = originalOpenScoutHome;
  }
  tailscaleStatusProbe.invalidate("test.reset");
  gitBuildInfoProbe.for(process.cwd()).invalidate("test.reset");
  resetGitBuildInfoProbeForTests();
  resetScoutdProbeClientForTests();
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories.clear();
});

describe("system probe registry", () => {
  test("deduplicates concurrent fresh readers with a single-flight run", async () => {
    let runs = 0;
    const gate = deferred<number>();
    const probe = defineProbe<number>({
      id: "test.singleFlight",
      ttlMs: 1_000,
      timeoutMs: 1_000,
      run: async () => {
        runs += 1;
        return await gate.promise;
      },
    });

    const readers = Array.from({ length: 8 }, () => probe.fresh());
    await sleep(10);
    expect(runs).toBe(1);
    gate.resolve(42);

    const snapshots = await Promise.all(readers);
    expect(snapshots.map((snapshot) => snapshot.value)).toEqual(Array(8).fill(42));
    expect(probe.metrics().runCount).toBe(1);
  });

  test("serves stale snapshots while revalidating in the background", async () => {
    let runs = 0;
    const secondRun = deferred<number>();
    const probe = defineProbe<number>({
      id: "test.staleWhileRevalidate",
      ttlMs: 50,
      timeoutMs: 1_000,
      maxStaleMs: 1_000,
      run: async () => {
        runs += 1;
        if (runs === 1) {
          return 1;
        }
        return await secondRun.promise;
      },
    });

    expect((await probe.fresh()).value).toBe(1);
    await sleep(75);

    const stale = probe.read();
    expect(stale.status).toBe("stale");
    expect(stale.value).toBe(1);
    expect(stale.refreshing).toBe(true);
    expect(runs).toBe(2);

    secondRun.resolve(2);
    await probe.fresh();
    expect(probe.snapshot().value).toBe(2);
    expect(probe.snapshot().status).toBe("fresh");
  });

  test("marks snapshots failed after maxStaleMs", async () => {
    const probe = defineProbe<number>({
      id: "test.maxStale",
      ttlMs: 5,
      timeoutMs: 1_000,
      maxStaleMs: 20,
      run: async () => 7,
    });

    expect((await probe.fresh()).status).toBe("fresh");
    await sleep(35);

    const snapshot = probe.snapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.value).toBeNull();
    expect(snapshot.error?.code).toBe("max_stale_exceeded");
  });

  test("evicts keyed family entries by LRU", async () => {
    const family = defineProbeFamily<string, string>({
      id: "test.family",
      ttlMs: 1_000,
      timeoutMs: 1_000,
      maxKeys: 2,
      idleKeyTtlMs: 60_000,
      maxConcurrentKeys: 1,
      normalizeKey: (key) => key.toLowerCase(),
      run: async (key) => key,
    });

    family.for("A").snapshot();
    await sleep(2);
    family.for("B").snapshot();
    await sleep(2);
    family.for("C").snapshot();

    expect(family.keys().sort()).toEqual(["b", "c"]);
    expect(family.metrics().keyCount).toBe(2);
  });
});

describe("tailscale.status probe", () => {
  test("single-flights concurrent readers and caches for the 30s ttl", async () => {
    const directory = tempDir("openscout-tailscale-probe-");
    const counter = join(directory, "count");
    const tailscale = join(directory, "tailscale");
    writeFileSync(tailscale, `#!/bin/sh
if [ "$1" = "status" ]; then
  count=$(cat ${JSON.stringify(counter)} 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > ${JSON.stringify(counter)}
  sleep 0.05
  cat <<'JSON'
{"BackendState":"Running","Health":[],"Self":{"ID":"self-node","HostName":"workstation","DNSName":"workstation.tailnet.ts.net.","TailscaleIPs":["100.64.0.10"],"Online":true},"Peer":{}}
JSON
  exit 0
fi
exit 64
`, "utf8");
    chmodSync(tailscale, 0o755);
    delete process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
    process.env.OPENSCOUT_TAILSCALE_BIN = tailscale;
    tailscaleStatusProbe.invalidate("test.concurrent");

    const snapshots = await Promise.all(
      Array.from({ length: 10 }, () => tailscaleStatusProbe.fresh({ maxAgeMs: 0 })),
    );

    expect(snapshots.every((snapshot) => snapshot.value?.running === true)).toBe(true);
    expect(readFileSync(counter, "utf8").trim()).toBe("1");

    for (let i = 0; i < 10; i += 1) {
      expect(tailscaleStatusProbe.read().value?.self?.hostName).toBe("workstation");
    }
    expect(readFileSync(counter, "utf8").trim()).toBe("1");
  });
});

describe("scoutd probe backend", () => {
  function capabilities() {
    return {
      schema: "openscout.probe.capabilities/v1",
      daemonVersion: "test-daemon",
      families: [
        { probeId: "tailscale.status", schemaVersion: 1, ttlMs: 30_000 },
        { probeId: "git.buildInfo", schemaVersion: 1, ttlMs: 60_000 },
      ],
    };
  }

  test("routes supported tailscale and git probes over the scoutd socket", async () => {
    const directory = mkdtempSync("/tmp/openscout-scoutd-probe-");
    tempDirectories.add(directory);
    const socketPath = join(directory, "probes.sock");
    process.env.OPENSCOUT_PROBES_SOCKET = socketPath;
    resetScoutdProbeClientForTests();

    const server = await startScoutdProbeServer(socketPath, (request) => {
      if (request.schema === "openscout.probe.capabilities/v1") {
        return capabilities();
      }
      if (request.probeId === "tailscale.status") {
        return {
          schema: "openscout.probe.snapshot/v1",
          probeId: "tailscale.status",
          key: null,
          generatedAt: Date.now(),
          ttlMs: 30_000,
          value: {
            backendState: "Running",
            running: true,
            health: [],
            peers: [],
            self: {
              id: "daemon-self",
              name: "daemon",
              addresses: ["100.64.0.1"],
              online: true,
              hostName: "daemon",
            },
          },
          error: null,
          daemonVersion: "test-daemon",
        };
      }
      if (request.probeId === "git.buildInfo") {
        return {
          schema: "openscout.probe.snapshot/v1",
          probeId: "git.buildInfo",
          key: request.key,
          generatedAt: Date.now(),
          ttlMs: 60_000,
          value: {
            repoRoot: request.key,
            commit: "abc123",
            bootBranch: "main",
            branch: "main",
            dirty: false,
            metadataAt: 123,
            statusAt: 456,
          },
          error: null,
          daemonVersion: "test-daemon",
        };
      }
      throw new Error(`unexpected probe ${request.probeId}`);
    });

    try {
      tailscaleStatusProbe.invalidate("test.scoutd");
      const tailscale = await tailscaleStatusProbe.fresh({ maxAgeMs: 0 });
      expect(tailscale.backend).toBe("scoutd");
      expect(tailscale.value?.self?.hostName).toBe("daemon");

      const git = await gitBuildInfoProbe.for(process.cwd()).fresh({ maxAgeMs: 0 });
      expect(git.backend).toBe("scoutd");
      expect(git.value?.commit).toBe("abc123");
    } finally {
      await closeServer(server);
    }
  });

  test("falls back visibly when a previously observed scoutd socket fails and re-adopts it later", async () => {
    const directory = mkdtempSync("/tmp/openscout-scoutd-fallback-");
    tempDirectories.add(directory);
    const socketPath = join(directory, "probes.sock");
    const fixture = join(directory, "tailscale.json");
    writeFileSync(fixture, JSON.stringify({
      BackendState: "Running",
      Health: [],
      Self: {
        ID: "local-self",
        HostName: "local",
        TailscaleIPs: ["100.64.0.2"],
        Online: true,
      },
      Peer: {},
    }), "utf8");
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON = fixture;
    process.env.OPENSCOUT_PROBES_SOCKET = socketPath;
    resetScoutdProbeClientForTests();

    const makeServer = (hostName: string) => startScoutdProbeServer(socketPath, (request) => {
      if (request.schema === "openscout.probe.capabilities/v1") {
        return capabilities();
      }
      return {
        schema: "openscout.probe.snapshot/v1",
        probeId: "tailscale.status",
        key: null,
        generatedAt: Date.now(),
        ttlMs: 30_000,
        value: {
          backendState: "Running",
          running: true,
          health: [],
          peers: [],
          self: {
            id: `${hostName}-self`,
            name: hostName,
            addresses: ["100.64.0.3"],
            online: true,
            hostName,
          },
        },
        error: null,
        daemonVersion: "test-daemon",
      };
    });

    let server = await makeServer("daemon-a");
    tailscaleStatusProbe.invalidate("test.initial-scoutd");
    const first = await tailscaleStatusProbe.fresh({ maxAgeMs: 0 });
    expect(first.backend).toBe("scoutd");
    expect(first.value?.self?.hostName).toBe("daemon-a");
    await closeServer(server);
    writeFileSync(socketPath, "stale socket placeholder", "utf8");

    tailscaleStatusProbe.invalidate("test.socket-failed");
    const fallback = await tailscaleStatusProbe.fresh({ maxAgeMs: 0 });
    expect(fallback.backend).toBe("local-fallback");
    expect(typeof fallback.fallbackSince).toBe("number");
    expect(fallback.fallbackReason?.length).toBeGreaterThan(0);
    expect(fallback.value?.self?.hostName).toBe("local");

    rmSync(socketPath, { force: true });
    server = await makeServer("daemon-b");
    try {
      tailscaleStatusProbe.invalidate("test.re-adopt");
      const readopted = await tailscaleStatusProbe.fresh({ maxAgeMs: 0 });
      expect(readopted.backend).toBe("scoutd");
      expect(readopted.value?.self?.hostName).toBe("daemon-b");
    } finally {
      await closeServer(server);
    }
  });
});

describe("git.buildInfo probe", () => {
  function git(cwd: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  test("caches build metadata and refreshes branch/dirty by repo key", async () => {
    const repo = tempDir("openscout-git-probe-");
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "probe@example.com"]);
    git(repo, ["config", "user.name", "Probe Test"]);
    writeFileSync(join(repo, "README.md"), "hello\n", "utf8");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "initial"]);

    const first = await gitBuildInfoProbe.for(join(repo, ".")).fresh({ maxAgeMs: 0 });
    expect(first.value?.repoRoot).toBe(realpathSync(repo));
    expect(first.value?.branch).toBe("main");
    expect(first.value?.commit).toBe(git(repo, ["rev-parse", "--short", "HEAD"]));
    expect(first.value?.dirty).toBe(false);

    writeFileSync(join(repo, "dirty.txt"), "dirty\n", "utf8");
    gitBuildInfoProbe.for(repo).invalidate("test.dirty");
    const second = await gitBuildInfoProbe.for(repo).fresh({ maxAgeMs: 0 });
    expect(second.value?.dirty).toBe(true);
    expect(second.value?.commit).toBe(first.value?.commit);
  });
});
