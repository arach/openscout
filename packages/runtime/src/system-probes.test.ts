import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defineProbe,
  defineProbeFamily,
  gitBuildInfoProbe,
  resetGitBuildInfoProbeForTests,
  tailscaleStatusProbe
} from "./system-probes/index";

const tempDirectories = new Set<string>();
const originalTailscaleBin = process.env.OPENSCOUT_TAILSCALE_BIN;
const originalTailscaleFixture = process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;

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

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(directory);
  return directory;
}

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
  tailscaleStatusProbe.invalidate("test.reset");
  resetGitBuildInfoProbeForTests();
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
      ttlMs: 5,
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
    await sleep(12);

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
