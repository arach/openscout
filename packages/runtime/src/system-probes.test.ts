import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
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
const originalGitBin = process.env.OPENSCOUT_GIT_BIN;
const originalTestGitMode = process.env.OPENSCOUT_TEST_GIT_MODE;
const repositoryRoot = join(import.meta.dir, "../../..");
let scoutdBinaryPromise: Promise<string> | null = null;

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

async function startScoutdProbeServer(socketPath: string, handler: (request: any) => any | Promise<any>): Promise<Server> {
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
        Promise.resolve(handler(request)).then((response) => {
          socket.end(`${JSON.stringify(response)}\n`);
        }, (error) => {
          socket.end(JSON.stringify({
            schema: "openscout.probe.error/v1",
            error: {
              code: "test_error",
              message: error instanceof Error ? error.message : String(error),
            },
            daemonVersion: "test",
          }));
        });
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

async function requestProbeSocket(socketPath: string, payload: Record<string, unknown>, timeoutMs = 5_000): Promise<any> {
  return await new Promise<any>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let raw = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`socket request timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();

    function finish(error: Error | null, value?: any): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk) => {
      raw += chunk;
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      try {
        finish(null, JSON.parse(raw.trim()));
      } catch (error) {
        finish(new Error(`socket response was not JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    socket.on("close", () => {
      if (!settled && raw.length > 0) {
        try {
          finish(null, JSON.parse(raw.trim()));
        } catch (error) {
          finish(new Error(`socket response was not JSON: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    });
  });
}

async function waitForSocket(socketPath: string, stderr: () => string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(socketPath)) {
      try {
        await requestProbeSocket(socketPath, { schema: "openscout.probe.capabilities/v1" }, 250);
        return;
      } catch {
        // Keep polling until the server accepts connections.
      }
    }
    await sleep(25);
  }
  throw new Error(`scoutd probe server did not become ready at ${socketPath}: ${stderr()}`);
}

async function ensureScoutdBinary(): Promise<string> {
  if (!scoutdBinaryPromise) {
    scoutdBinaryPromise = Promise.resolve().then(() => {
      execFileSync("bash", [
        join(repositoryRoot, "scripts/cargo.sh"),
        "build",
        "--manifest-path",
        join(repositoryRoot, "crates/scoutd/Cargo.toml"),
      ], {
        cwd: repositoryRoot,
        stdio: "inherit",
      });
      return join(repositoryRoot, "target/debug/scoutd");
    });
  }
  return await scoutdBinaryPromise;
}

async function startRealScoutdProbeServer(input: {
  socketPath: string;
  env: Record<string, string | undefined>;
}): Promise<{ stop: () => Promise<void>; stderr: () => string }> {
  const scoutd = await ensureScoutdBinary();
  let stderr = "";
  const child = spawn(scoutd, ["probes", "serve"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      OPENSCOUT_PROBES_SOCKET: input.socketPath,
      ...input.env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.once("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      stderr += `\nscoutd exited with ${code}`;
    } else if (signal) {
      stderr += `\nscoutd exited with ${signal}`;
    }
  });
  await waitForSocket(input.socketPath, () => stderr);
  return {
    stderr: () => stderr,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        sleep(1_000).then(() => {
          child.kill("SIGKILL");
        }),
      ]);
    },
  };
}

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(directory);
  return directory;
}

let shortTempCounter = 0;
function shortTempDir(prefix: string): string {
  shortTempCounter += 1;
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 12);
  const directory = join("/tmp", `${safePrefix}-${process.pid}-${shortTempCounter}`);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
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
  if (originalGitBin === undefined) {
    delete process.env.OPENSCOUT_GIT_BIN;
  } else {
    process.env.OPENSCOUT_GIT_BIN = originalGitBin;
  }
  if (originalTestGitMode === undefined) {
    delete process.env.OPENSCOUT_TEST_GIT_MODE;
  } else {
    process.env.OPENSCOUT_TEST_GIT_MODE = originalTestGitMode;
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

  test("fresh reruns when an in-flight read was invalidated by a side effect", async () => {
    let runs = 0;
    const firstRun = deferred<number>();
    const secondRun = deferred<number>();
    const probe = defineProbe<number>({
      id: "test.invalidateInFlight",
      ttlMs: 1_000,
      timeoutMs: 1_000,
      run: async () => {
        runs += 1;
        return await (runs === 1 ? firstRun.promise : secondRun.promise);
      },
    });

    const cold = probe.read();
    expect(cold.status).toBe("empty");
    await sleep(10);
    expect(runs).toBe(1);

    probe.invalidate("test.side-effect");
    const fresh = probe.fresh({ maxAgeMs: 0 });
    firstRun.resolve(1);
    await sleep(10);

    expect(runs).toBe(2);
    secondRun.resolve(2);
    expect((await fresh).value).toBe(2);
    expect(probe.metrics().runCount).toBe(2);
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
    rmSync(socketPath, { force: true });
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

  test("falls back locally instead of sending a request when a probe schema version differs", async () => {
    const directory = tempDir("openscout-scoutd-schema-skew-");
    const socketPath = join(directory, "probes.sock");
    const fixture = join(directory, "tailscale.json");
    writeFileSync(fixture, JSON.stringify({
      BackendState: "Running",
      Health: [],
      Self: {
        ID: "local-self",
        HostName: "schema-local",
        TailscaleIPs: ["100.64.0.9"],
        Online: true,
      },
      Peer: {},
    }), "utf8");
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON = fixture;
    process.env.OPENSCOUT_PROBES_SOCKET = socketPath;
    resetScoutdProbeClientForTests();
    const requests: any[] = [];

    const server = await startScoutdProbeServer(socketPath, (request) => {
      requests.push(request);
      if (request.schema === "openscout.probe.capabilities/v1") {
        return {
          schema: "openscout.probe.capabilities/v1",
          daemonVersion: "skewed-daemon",
          families: [
            { probeId: "tailscale.status", schemaVersion: 2, ttlMs: 30_000 },
          ],
        };
      }
      throw new Error("probe request should not be sent when schema versions differ");
    });

    try {
      tailscaleStatusProbe.invalidate("test.schema-skew");
      const snapshot = await tailscaleStatusProbe.fresh({ maxAgeMs: 0 });

      expect(snapshot.backend).toBe("local-fallback");
      expect(snapshot.fallbackReason).toContain("schema v2");
      expect(snapshot.value?.self?.hostName).toBe("schema-local");
      expect(requests).toEqual([{ schema: "openscout.probe.capabilities/v1" }]);
    } finally {
      await closeServer(server);
    }
  });

  test("keeps the socket timeout above the probe operation timeout to avoid duplicate local exec", async () => {
    const directory = tempDir("openscout-scoutd-timeout-hierarchy-");
    const socketPath = join(directory, "probes.sock");
    process.env.OPENSCOUT_PROBES_SOCKET = socketPath;
    resetScoutdProbeClientForTests();
    let localRuns = 0;
    const tailscale = join(directory, "tailscale");
    writeFileSync(tailscale, `#!/bin/sh
printf x >> ${JSON.stringify(join(directory, "local-count"))}
exit 64
`, "utf8");
    chmodSync(tailscale, 0o755);
    process.env.OPENSCOUT_TAILSCALE_BIN = tailscale;

    const server = await startScoutdProbeServer(socketPath, async (request) => {
      if (request.schema === "openscout.probe.capabilities/v1") return capabilities();
      localRuns += 1;
      await sleep(950);
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
            id: "slow-daemon",
            name: "slow-daemon",
            addresses: ["100.64.0.4"],
            online: true,
            hostName: "slow-daemon",
          },
        },
        error: null,
        daemonVersion: "test-daemon",
      };
    });

    try {
      tailscaleStatusProbe.invalidate("test.timeout-hierarchy");
      const snapshot = await tailscaleStatusProbe.fresh({ maxAgeMs: 0 });

      expect(snapshot.backend).toBe("scoutd");
      expect(snapshot.value?.self?.hostName).toBe("slow-daemon");
      expect(localRuns).toBe(1);
      expect(existsSync(join(directory, "local-count"))).toBe(false);
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

describe("scoutd conformance diff harness", () => {
  type GitFixtureMode = "success" | "missing-binary" | "timeout" | "output_cap";

  function writeGitFixture(directory: string): string {
    const script = join(directory, "git-fixture.sh");
    writeFileSync(script, `#!/bin/sh
if [ "$1" = "-C" ]; then
  shift 2
fi
mode="\${OPENSCOUT_TEST_GIT_MODE:-success}"
if [ "$1" = "rev-parse" ] && [ "$2" = "--short" ]; then
  printf 'abc123\\n'
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then
  printf 'main\\n'
  exit 0
fi
if [ "$1" = "status" ] && [ "$2" = "--porcelain" ]; then
  case "$mode" in
    timeout)
      sleep 3
      printf 'late\\n'
      exit 0
      ;;
    output_cap)
      dd if=/dev/zero bs=300000 count=1 2>/dev/null | tr '\\000' x
      exit 0
      ;;
    *)
      exit 0
      ;;
  esac
fi
exit 1
`, "utf8");
    chmodSync(script, 0o755);
    return script;
  }

  function normalizeGitSnapshot(value: any): any {
    if (!value || typeof value !== "object") return value ?? null;
    return {
      ...value,
      metadataAt: 0,
      statusAt: value.statusAt === null ? null : 0,
    };
  }

  function normalizeProbeError(error: any): any {
    if (!error) return null;
    return {
      code: String(error.code ?? "error"),
      timedOut: error.timedOut === true || error.timed_out === true || error.code === "timeout",
    };
  }

  function normalizeLocalSnapshot(snapshot: Awaited<ReturnType<ReturnType<typeof gitBuildInfoProbe.for>["fresh"]>>): any {
    if (snapshot.status === "failed") {
      return {
        status: "failed",
        value: null,
        error: normalizeProbeError(snapshot.error),
      };
    }
    return {
      status: snapshot.status,
      value: normalizeGitSnapshot(snapshot.value),
      error: null,
    };
  }

  function normalizeDaemonSnapshot(response: any): any {
    if (response.error) {
      return {
        status: "failed",
        value: null,
        error: normalizeProbeError(response.error),
      };
    }
    return {
      status: "fresh",
      value: normalizeGitSnapshot(response.value),
      error: null,
    };
  }

  async function runLocalGitFixture(repoRoot: string, gitBin: string): Promise<any> {
    process.env.OPENSCOUT_PROBES_SOCKET = join(repoRoot, "missing-probes.sock");
    process.env.OPENSCOUT_GIT_BIN = gitBin;
    resetScoutdProbeClientForTests();
    resetGitBuildInfoProbeForTests();
    gitBuildInfoProbe.invalidate(repoRoot, "test.conformance.local");
    const snapshot = await gitBuildInfoProbe.for(repoRoot).fresh({ maxAgeMs: 0 });
    return normalizeLocalSnapshot(snapshot);
  }

  async function runDaemonGitFixture(input: {
    repoRoot: string;
    gitBin: string;
    mode: GitFixtureMode;
    directory: string;
  }): Promise<any> {
    const socketPath = join(input.directory, `scoutd-${input.mode}.sock`);
    const server = await startRealScoutdProbeServer({
      socketPath,
      env: {
        OPENSCOUT_HOME: input.directory,
        OPENSCOUT_GIT_BIN: input.gitBin,
        OPENSCOUT_TEST_GIT_MODE: input.mode,
      },
    });
    try {
      const response = await requestProbeSocket(socketPath, {
        schema: "openscout.probe.request/v1",
        schemaVersion: 1,
        probeId: "git.buildInfo",
        key: input.repoRoot,
        maxAgeMs: 0,
      }, 6_000);
      return normalizeDaemonSnapshot(response);
    } finally {
      await server.stop();
    }
  }

  for (const mode of ["success", "missing-binary", "timeout", "output_cap"] as const) {
    test(`git.buildInfo ${mode} fixture matches between scoutd and the TS local twin`, async () => {
      const directory = shortTempDir(`oscd-${mode}`);
      const repoRoot = join(directory, "repo");
      const gitFixture = writeGitFixture(directory);
      writeFileSync(join(directory, "repo-placeholder"), "x", "utf8");
      const gitBin = mode === "missing-binary" ? join(directory, "missing-git") : gitFixture;
      mkdirSync(repoRoot);

      process.env.OPENSCOUT_TEST_GIT_MODE = mode;
      const [daemon, local] = await Promise.all([
        runDaemonGitFixture({ repoRoot, gitBin, mode, directory }),
        runLocalGitFixture(repoRoot, gitBin),
      ]);

      expect(daemon).toEqual(local);
      if (mode === "timeout") {
        expect(daemon.error).toEqual({ code: "timeout", timedOut: true });
      }
      if (mode === "output_cap") {
        expect(daemon.error).toEqual({ code: "output_cap", timedOut: false });
      }
      if (mode === "missing-binary") {
        expect(daemon).toMatchObject({
          status: "fresh",
          value: {
            commit: null,
            bootBranch: null,
            branch: null,
            dirty: null,
          },
          error: null,
        });
      }
    }, 15_000);
  }
});
