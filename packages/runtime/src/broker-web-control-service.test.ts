import { describe, expect, test } from "bun:test";

import type { ChildProcess, SpawnOptions } from "node:child_process";

import {
  appendCsvValues,
  BrokerWebControlService,
  normalizeTrustedWebHost,
  scoutWebControlCorsHeaders,
  webStartContextFromRequest,
} from "./broker-web-control-service.js";

function fakeRequest(headers: Record<string, string | string[] | undefined>) {
  return { headers };
}

function fakeChild(pid = 1234): ChildProcess {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    pid,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill(this: ChildProcess) {
      (this as unknown as { killed: boolean }).killed = true;
      return true;
    },
    once(this: ChildProcess, event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, listener);
      return this;
    },
    unref(this: ChildProcess) {
      return this;
    },
  } as unknown as ChildProcess;
}

describe("BrokerWebControlService", () => {
  test("normalizes trusted hosts and CORS headers", () => {
    const trustedHosts = new Set(["mesh.example.test"]);

    expect(normalizeTrustedWebHost("https://Scout.Local/path", trustedHosts)).toBe("scout.local");
    expect(normalizeTrustedWebHost("demo.scout.local", trustedHosts)).toBe("demo.scout.local");
    expect(normalizeTrustedWebHost("mesh.example.test", trustedHosts)).toBe("mesh.example.test");
    expect(normalizeTrustedWebHost("evil.example.test", trustedHosts)).toBeNull();

    expect(scoutWebControlCorsHeaders(fakeRequest({
      origin: "https://mesh.example.test",
    }), trustedHosts)).toEqual(expect.objectContaining({
      "access-control-allow-origin": "https://mesh.example.test",
      vary: "Origin",
    }));
    expect(scoutWebControlCorsHeaders(fakeRequest({
      origin: "https://evil.example.test",
    }), trustedHosts)).toEqual({});
  });

  test("derives web start context from forwarded headers", () => {
    const context = webStartContextFromRequest(fakeRequest({
      "x-forwarded-host": "mesh.example.test",
      "x-forwarded-proto": "https",
    }), new Set(["mesh.example.test"]));

    expect(context).toEqual({
      publicOrigin: "https://mesh.example.test",
      trustedHost: "mesh.example.test",
    });
    expect(webStartContextFromRequest(fakeRequest({
      "x-forwarded-host": "evil.example.test",
      "x-forwarded-proto": "https",
    }), new Set(["mesh.example.test"]))).toEqual({});
  });

  test("merges trusted host CSV values without duplicate casing", () => {
    expect(appendCsvValues("scout.local, Mesh.Example.Test", [
      "mesh.example.test",
      "tailnet.example.test",
      "",
    ])).toBe("scout.local,Mesh.Example.Test,tailnet.example.test");
  });

  test("reports child service snapshots without probing web health", () => {
    const service = new BrokerWebControlService({
      brokerControlUrl: "http://127.0.0.1:4321",
      env: { OPENSCOUT_WEB_PORT: "4321" },
      healthCheck: async () => false,
      resolveWebPort: () => 4321,
    });

    expect(service.readChildServiceSnapshots().web).toEqual(expect.objectContaining({
      managedBy: "broker",
      state: "stopped",
      pid: null,
      port: 4321,
      healthy: null,
    }));
  });

  test("refuses to restart a healthy web server the broker does not own", async () => {
    const service = new BrokerWebControlService({
      brokerControlUrl: "http://127.0.0.1:4321",
      env: { OPENSCOUT_WEB_PORT: "4321" },
      healthCheck: async () => true,
      resolveWebPort: () => 4321,
    });

    const status = await service.restartIfManaged();
    expect(status).toEqual(expect.objectContaining({
      ok: false,
      running: true,
      managed: false,
      pid: null,
    }));
    expect(status.error).toContain("outside broker management");
  });

  test("deduplicates concurrent starts and passes broker web environment", async () => {
    const child = fakeChild(2468);
    const spawns: Array<{ command: string; args: string[]; options: SpawnOptions }> = [];
    let healthChecks = 0;
    const service = new BrokerWebControlService({
      brokerControlUrl: "http://127.0.0.1:4321",
      tailnetWebHosts: ["tailnet.example.test"],
      env: {
        OPENSCOUT_WEB_PORT: "4321",
        OPENSCOUT_SETUP_CWD: "/repo",
        OPENSCOUT_WEB_TRUSTED_HOSTS: "scout.local",
      },
      healthCheck: async () => {
        healthChecks += 1;
        return healthChecks >= 2;
      },
      spawnProcess(command, args, options) {
        spawns.push({ command, args, options });
        return child;
      },
      resolveEntry: () => "/repo/packages/web/server/index.ts",
      resolveBun: () => ({ path: "/usr/local/bin/bun" }),
      resolveLogPath: () => "/dev/null",
      startPollTimeoutMs: 1_000,
      startPollIntervalMs: 1,
      log() {},
    });

    const [first, second] = await Promise.all([
      service.startIfNeeded({ publicOrigin: "https://mesh.example.test", trustedHost: "mesh.example.test" }),
      service.startIfNeeded({ publicOrigin: "https://mesh.example.test", trustedHost: "mesh.example.test" }),
    ]);

    expect(spawns).toHaveLength(1);
    expect(first.running).toBe(true);
    expect(second.running).toBe(true);
    expect(first.pid).toBe(2468);
    expect(spawns[0]?.command).toBe("/usr/local/bin/bun");
    expect(spawns[0]?.args).toEqual(["run", "/repo/packages/web/server/index.ts"]);
    expect(spawns[0]?.options.argv0).toBe("scout-web");
    expect(spawns[0]?.options.env).toEqual(expect.objectContaining({
      OPENSCOUT_WEB_HOST: "0.0.0.0",
      OPENSCOUT_WEB_PORT: "4321",
      OPENSCOUT_WEB_BUN_URL: "http://127.0.0.1:4321",
      OPENSCOUT_BROKER_INTERNAL_URL: "http://127.0.0.1:4321",
      OPENSCOUT_WEB_PUBLIC_ORIGIN: "https://mesh.example.test",
      OPENSCOUT_WEB_ADVERTISED_HOST: "mesh.example.test",
      OPENSCOUT_WEB_TRUSTED_HOSTS: "scout.local,tailnet.example.test,mesh.example.test",
      OPENSCOUT_SETUP_CWD: "/repo",
    }));

    service.stop();
    expect(child.killed).toBe(true);
  });
});
