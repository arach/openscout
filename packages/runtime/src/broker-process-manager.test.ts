import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDefaultBrokerUrl,
  buildLocalBrokerControlUrl,
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  DEFAULT_BROKER_URL,
  resolveBundledRuntimeDirFromModuleDir,
  resolveScoutdCommand,
  runScoutdServiceCommand,
  selectLastRelevantLogLine,
  type BrokerServiceConfig,
} from "./broker-process-manager";

const config: BrokerServiceConfig = {
  label: "dev.openscout",
  mode: "dev",
  uid: 501,
  domainTarget: "gui/501",
  serviceTarget: "gui/501/dev.openscout",
  launchAgentPath: "/Users/arach/Library/LaunchAgents/dev.openscout.plist",
  supportDirectory: "/Users/arach/Library/Application Support/OpenScout",
  runtimeDirectory: "/Users/arach/Library/Application Support/OpenScout/runtime",
  logsDirectory: "/Users/arach/Library/Application Support/OpenScout/logs/broker",
  stdoutLogPath: "/Users/arach/Library/Application Support/OpenScout/logs/broker/stdout.log",
  stderrLogPath: "/Users/arach/Library/Application Support/OpenScout/logs/broker/stderr.log",
  controlHome: "/Users/arach/.openscout/control-plane",
  runtimePackageDir: "/Users/arach/dev/openscout/packages/runtime",
  bunExecutable: "/Users/arach/.bun/bin/bun",
  brokerHost: DEFAULT_BROKER_HOST,
  brokerPort: DEFAULT_BROKER_PORT,
  brokerUrl: DEFAULT_BROKER_URL,
  brokerSocketPath: "/Users/arach/Library/Application Support/OpenScout/runtime/broker.sock",
  advertiseScope: "local",
  coreAgents: [],
};

function writeExecutable(path: string, contents = "#!/bin/sh\nexit 0\n"): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
  return path;
}

let envQueue: Promise<unknown> = Promise.resolve();

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(patch)) {
      previous.set(key, process.env[key]);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    try {
      return await fn();
    } finally {
      restore(previous);
    }
  };

  const next = envQueue.then(run, run);
  envQueue = next.catch(() => undefined);
  return await next;
}

function restore(previous: Map<string, string | undefined>): void {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("broker service scoutd adapter", () => {
  test("builds local broker control URLs from wildcard bind hosts", () => {
    expect(buildLocalBrokerControlUrl("0.0.0.0", 65535)).toBe("http://127.0.0.1:65535");
    expect(buildLocalBrokerControlUrl("::", 65535)).toBe("http://127.0.0.1:65535");
    expect(buildLocalBrokerControlUrl("192.168.1.12", 65535)).toBe("http://192.168.1.12:65535");
  });

  test("resolves the package root from a bundled scout dist runtime module", () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-runtime-package-"));
    const packageRoot = join(root, "scout");
    const moduleDir = join(packageRoot, "dist", "runtime");

    mkdirSync(join(packageRoot, "bin"), { recursive: true });
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), "{}");
    writeFileSync(join(packageRoot, "bin", "openscout-runtime.mjs"), "");

    expect(resolveBundledRuntimeDirFromModuleDir(moduleDir)).toBe(packageRoot);
  });

  test("resolves packaged scoutd from the bundled package bin directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-packaged-scoutd-"));
    const packageRoot = join(root, "scout");
    const scoutd = writeExecutable(join(packageRoot, "bin", "scoutd"));
    writeExecutable(join(root, "path", "scoutd"));

    const packagedConfig: BrokerServiceConfig = {
      ...config,
      runtimePackageDir: packageRoot,
    };

    const resolved = await withEnv({
      OPENSCOUT_SCOUTD_BIN: undefined,
      PATH: join(root, "path"),
    }, () => resolveScoutdCommand(packagedConfig));

    expect(resolved).toEqual({ path: scoutd, source: "package" });
  });

  test("resolves packaged scoutd from the monorepo CLI package before workspace builds", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-monorepo-scoutd-"));
    mkdirSync(join(root, "crates", "scoutd"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
    writeFileSync(join(root, "crates", "scoutd", "Cargo.toml"), "[package]\nname = \"scoutd\"\n");
    const scoutd = writeExecutable(join(root, "packages", "cli", "bin", "scoutd"));
    writeExecutable(join(root, "target", "debug", "scoutd"));
    writeExecutable(join(root, "path", "scoutd"));
    const workspaceConfig: BrokerServiceConfig = {
      ...config,
      runtimePackageDir: join(root, "packages", "runtime"),
    };

    const resolved = await withEnv({
      OPENSCOUT_SCOUTD_BIN: undefined,
      OPENSCOUT_ALLOW_WORKSPACE_SCOUTD: undefined,
      PATH: join(root, "path"),
    }, () => resolveScoutdCommand(workspaceConfig));

    expect(resolved).toEqual({ path: scoutd, source: "package" });
  });

  test("resolves scoutd from an explicit environment override", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-scoutd-env-"));
    const scoutd = writeExecutable(join(root, "custom-scoutd"));

    const resolved = await withEnv({
      OPENSCOUT_SCOUTD_BIN: scoutd,
      PATH: "",
    }, () => resolveScoutdCommand(config));

    expect(resolved).toEqual({ path: scoutd, source: "env" });
  });

  test("does not resolve workspace-built scoutd without an explicit opt-in", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-scoutd-workspace-"));
    mkdirSync(join(root, "crates", "scoutd"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
    writeFileSync(join(root, "crates", "scoutd", "Cargo.toml"), "[package]\nname = \"scoutd\"\n");
    writeExecutable(join(root, "target", "debug", "scoutd"));
    const scoutd = writeExecutable(join(root, "bin", "scoutd"));
    const workspaceConfig: BrokerServiceConfig = {
      ...config,
      runtimePackageDir: join(root, "packages", "runtime"),
    };

    const resolved = await withEnv({
      OPENSCOUT_SCOUTD_BIN: undefined,
      OPENSCOUT_ALLOW_WORKSPACE_SCOUTD: undefined,
      PATH: join(root, "bin"),
    }, () => resolveScoutdCommand(workspaceConfig));

    expect(resolved).toEqual({ path: scoutd, source: "path" });
  });

  test("resolves a workspace-built scoutd binary after opt-in", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-scoutd-workspace-opt-in-"));
    mkdirSync(join(root, "crates", "scoutd"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
    writeFileSync(join(root, "crates", "scoutd", "Cargo.toml"), "[package]\nname = \"scoutd\"\n");
    const debugScoutd = writeExecutable(join(root, "target", "debug", "scoutd"));
    const releaseScoutd = writeExecutable(join(root, "target", "release", "scoutd"));
    const workspaceConfig: BrokerServiceConfig = {
      ...config,
      runtimePackageDir: join(root, "packages", "runtime"),
    };

    const resolved = await withEnv({
      OPENSCOUT_SCOUTD_BIN: undefined,
      OPENSCOUT_ALLOW_WORKSPACE_SCOUTD: "1",
      PATH: "",
    }, () => resolveScoutdCommand(workspaceConfig));

    expect(debugScoutd).toContain("target/debug/scoutd");
    expect(resolved).toEqual({ path: releaseScoutd, source: "workspace" });
  });

  test("prefers informative runtime log lines over package script banners", () => {
    expect(
      selectLastRelevantLogLine([
        "$ bun run src/broker-daemon.ts",
        `[openscout-runtime] broker listening on ${DEFAULT_BROKER_URL}`,
      ]),
    ).toBe(`[openscout-runtime] broker listening on ${DEFAULT_BROKER_URL}`);

    expect(
      selectLastRelevantLogLine([
        "$ npm run broker",
      ]),
    ).toBe("$ npm run broker");

    expect(
      selectLastRelevantLogLine([
        "$ bun run src/broker-daemon.ts",
      ]),
    ).toBe("$ bun run src/broker-daemon.ts");
  });
});

describe("runScoutdServiceCommand shell-out", () => {
  function writeFakeScoutd(contents: string): string {
    const root = mkdtempSync(join(tmpdir(), "openscout-fake-scoutd-"));
    return writeExecutable(join(root, "scoutd"), contents);
  }

  test("parses scoutd JSON into the normalized status shape", async () => {
    const status = {
      label: "dev.openscout",
      mode: "dev",
      installed: true,
      loaded: true,
      pid: 4242,
      launchdState: "running",
      lastExitStatus: 0,
      health: {
        reachable: true,
        ok: true,
        checkedAt: 1700000000,
        transport: "unix_socket",
        nodeId: "node-1",
        meshId: "mesh-1",
        counts: {
          nodes: 1,
          actors: 2,
          agents: 3,
          conversations: 4,
          messages: 5,
          flights: 6,
          collaborationRecords: 7,
        },
        build: {
          packageName: "@openscout/runtime",
          version: "0.test",
          mode: "dev",
        },
        services: {
          web: {
            managed: true,
            managedBy: "broker",
            state: "running",
            pid: 111,
          },
        },
      },
    };
    const scoutd = writeFakeScoutd("#!/bin/sh\nprintf '%s' \"$SCOUTD_STATUS_JSON\"\n");
    const result = await withEnv({
      OPENSCOUT_SCOUTD_BIN: scoutd,
      SCOUTD_STATUS_JSON: JSON.stringify(status),
    }, () =>
      runScoutdServiceCommand("status", config),
    );

    expect(result.label).toBe("dev.openscout");
    expect(result.mode).toBe("dev");
    expect(result.installed).toBe(true);
    expect(result.loaded).toBe(true);
    expect(result.pid).toBe(4242);
    expect(result.launchdState).toBe("running");
    expect(result.lastExitStatus).toBe(0);
    expect(result.reachable).toBe(true);
    expect(result.health.ok).toBe(true);
    expect(result.health.reachable).toBe(true);
    expect(result.health.checkedAt).toBe(1700000000);
    expect(result.health.transport).toBe("unix_socket");
    expect(result.health.nodeId).toBe("node-1");
    expect(result.health.meshId).toBe("mesh-1");
    expect(result.health.counts?.collaborationRecords).toBe(7);
    expect(result.health.build?.version).toBe("0.test");
    expect(result.health.services?.web?.pid).toBe(111);
  });

  test("rejects with a meaningful error on malformed JSON", async () => {
    const scoutd = writeFakeScoutd("#!/bin/sh\nprintf '%s' \"$SCOUTD_STATUS_JSON\"\n");
    await expect(
      withEnv({
        OPENSCOUT_SCOUTD_BIN: scoutd,
        SCOUTD_STATUS_JSON: "not json at all",
      }, () => runScoutdServiceCommand("status", config)),
    ).rejects.toThrow(/returned non-JSON stdout/);
  });

  test("rejects with stderr detail on non-zero exit", async () => {
    const scoutd = writeFakeScoutd("#!/bin/sh\necho 'broken scoutd' >&2\nexit 2\n");
    await expect(
      withEnv({ OPENSCOUT_SCOUTD_BIN: scoutd }, () => runScoutdServiceCommand("start", config)),
    ).rejects.toThrow(/scoutd start failed:/);
  });

  test("rejects a runaway child without hanging", async () => {
    const scoutd = writeFakeScoutd("#!/bin/sh\nwhile :; do printf y; done\n");
    const started = Date.now();
    await expect(
      withEnv({ OPENSCOUT_SCOUTD_BIN: scoutd }, () =>
        runScoutdServiceCommand("start", config, 2_000),
      ),
    ).rejects.toThrow(/scoutd start (exceeded output limit|timed out after 2000ms)/);
    // Must reject promptly, not let a runaway child pin the caller.
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});
