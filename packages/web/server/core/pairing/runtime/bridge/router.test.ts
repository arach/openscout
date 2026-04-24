import { describe, expect, test } from "bun:test";

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

function createCaller(bridge: Bridge) {
  return bridgeRouter.createCaller({
    bridge,
    cwd: "/tmp/openscout",
    deviceId: undefined,
  });
}

describe("bridgeRouter sync compatibility", () => {
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
