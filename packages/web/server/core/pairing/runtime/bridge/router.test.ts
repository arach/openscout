import { describe, expect, test } from "bun:test";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Bridge } from "./bridge.ts";
import { bridgeRouter } from "./router.ts";

function createBridgeStub() {
  const replayCalls: string[] = [];
  const currentSeqCalls: string[] = [];
  const oldestBufferedSeqCalls: string[] = [];

  const bridge = {
    getSessionSummaries() {
      return [
        {
          sessionId: "older-session",
          name: "Older",
          adapterType: "codex",
          status: "active",
          turnCount: 1,
          currentTurnStatus: null,
          startedAt: 100,
          lastActivityAt: 100,
        },
        {
          sessionId: "latest-session",
          name: "Latest",
          adapterType: "codex",
          status: "active",
          turnCount: 2,
          currentTurnStatus: null,
          startedAt: 200,
          lastActivityAt: 200,
        },
      ];
    },
    listSessions() {
      return [{ sessionId: "older-session" }, { sessionId: "latest-session" }];
    },
    replay(sessionId: string, afterSeq: number) {
      replayCalls.push(sessionId);
      return [{ seq: afterSeq + 1, event: { event: `replay:${sessionId}` }, timestamp: 1_000 }] as const;
    },
    currentSeq(sessionId: string) {
      currentSeqCalls.push(sessionId);
      return sessionId === "latest-session" ? 42 : 7;
    },
    oldestBufferedSeq(sessionId: string) {
      oldestBufferedSeqCalls.push(sessionId);
      return sessionId === "latest-session" ? 9 : 3;
    },
  } as unknown as Bridge;

  return {
    bridge,
    replayCalls,
    currentSeqCalls,
    oldestBufferedSeqCalls,
  };
}

function createCaller(
  bridge: Bridge,
  context: {
    deviceId?: string;
    secureTransport?: boolean;
    trustedPeer?: boolean;
  } = {},
) {
  return bridgeRouter.createCaller({
    bridge,
    cwd: "/tmp/openscout",
    deviceId: context.deviceId,
    secureTransport: context.secureTransport,
    trustedPeer: context.trustedPeer,
  });
}

describe("bridgeRouter sync compatibility", () => {
  test("mobile.endpoints requires the protected encrypted trusted mobile transport", async () => {
    const stub = createBridgeStub();

    await expect(createCaller(stub.bridge).mobile.endpoints()).rejects.toThrow(
      "Endpoint discovery requires an encrypted trusted mobile transport",
    );
  });

  test("mobile.endpoints returns current service coordinates on the protected transport", async () => {
    const previousHome = process.env.OPENSCOUT_HOME;
    process.env.OPENSCOUT_HOME = mkdtempSync(join(tmpdir(), "openscout-router-test-"));
    try {
      const stub = createBridgeStub();

      const result = await createCaller(stub.bridge, {
        deviceId: "device-1",
        secureTransport: true,
        trustedPeer: true,
      }).mobile.endpoints();

      expect(result.version).toBe(1);
      expect(result.protected).toBe(true);
      expect(result.transport.deviceId).toBe("device-1");
      expect(result.ports.broker).toBe(43110);
      expect(result.ports.web).toBe(43120);
      expect(result.ports.pairingBridge).toBe(43130);
      expect(result.endpoints.brokerUrl).toBe("http://127.0.0.1:43110");
      expect(result.endpoints.webUrl).toBe("http://127.0.0.1:43120");
      expect(result.endpoints.pairingBridgeUrl).toBe("ws://127.0.0.1:43130");
    } finally {
      if (previousHome === undefined) {
        delete process.env.OPENSCOUT_HOME;
      } else {
        process.env.OPENSCOUT_HOME = previousHome;
      }
    }
  });

  test("sync.status falls back to the most recent session when sessionId is omitted", async () => {
    const stub = createBridgeStub();

    const result = await createCaller(stub.bridge).sync.status();

    expect(result).toEqual({
      currentSeq: 42,
      oldestBufferedSeq: 9,
      sessionCount: 2,
    });
    expect(stub.currentSeqCalls).toEqual(["latest-session"]);
    expect(stub.oldestBufferedSeqCalls).toEqual(["latest-session"]);
  });

  test("sync.status returns empty counters when there are no sessions", async () => {
    const bridge = {
      getSessionSummaries() {
        return [];
      },
      listSessions() {
        return [];
      },
    } as unknown as Bridge;

    const result = await createCaller(bridge).sync.status();

    expect(result).toEqual({
      currentSeq: 0,
      oldestBufferedSeq: 0,
      sessionCount: 0,
    });
  });

  test("sync.replay falls back to the most recent session when sessionId is omitted", async () => {
    const stub = createBridgeStub();

    const result = await createCaller(stub.bridge).sync.replay({ lastSeq: 11 });

    expect(result.events).toEqual([
      { seq: 12, event: { event: "replay:latest-session" }, timestamp: 1_000 },
    ]);
    expect(stub.replayCalls).toEqual(["latest-session"]);
  });
});
