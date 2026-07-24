import { describe, expect, test } from "bun:test";

import { BrokerRendezvousService } from "./broker-rendezvous-service.js";

function createHarness() {
  let now = 1_000;
  let id = 0;
  const service = new BrokerRendezvousService({
    now: () => now,
    createMatchId: () => `match-${++id}`,
    presenceTtlMs: 100,
    matchTtlMs: 200,
    cleanupIntervalMs: 0,
  });
  return {
    service,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("BrokerRendezvousService", () => {
  test("releases the first waiter when a normalized peer arrives", async () => {
    const harness = createHarness();
    const first = harness.service.match({
      topic: " Review   Parser ",
      projectRoot: "/repo",
      participantId: "agent.one",
      waitMs: 30_000,
    });
    const second = await harness.service.match({
      topic: "review parser",
      projectRoot: "/repo",
      participantId: "agent.two",
      waitMs: 0,
    });
    const released = await first;

    expect(second.status).toBe("matched");
    expect(released.status).toBe("matched");
    if (second.status !== "matched" || released.status !== "matched") return;
    expect(second.matchId).toBe("match-1");
    expect(released.matchId).toBe("match-1");
    expect(released.peerParticipantIds).toEqual(["agent.two"]);
    expect(second.peerParticipantIds).toEqual(["agent.one"]);
    harness.advance(50);
    const refreshed = await harness.service.match({
      topic: "review parser",
      projectRoot: "/repo",
      participantId: "agent.one",
      waitMs: 0,
    });
    expect(refreshed).toMatchObject({
      status: "matched",
      matchId: "match-1",
      expiresAt: 1_250,
    });
    harness.service.dispose();
  });

  test("keeps projects isolated and never self-matches", async () => {
    const harness = createHarness();
    const first = await harness.service.match({
      topic: "handoff",
      projectRoot: "/repo-a",
      participantId: "agent.one",
      waitMs: 0,
    });
    const repeated = await harness.service.match({
      topic: "handoff",
      projectRoot: "/repo-a",
      participantId: "agent.one",
      waitMs: 0,
    });
    const otherProject = await harness.service.match({
      topic: "handoff",
      projectRoot: "/repo-b",
      participantId: "agent.two",
      waitMs: 0,
    });

    expect(first.status).toBe("waiting");
    expect(repeated.status).toBe("waiting");
    expect(otherProject.status).toBe("waiting");
    if (first.status === "waiting" && repeated.status === "waiting") {
      expect(repeated.joinedAt).toBe(first.joinedAt);
      expect(repeated.expiresAt).toBeGreaterThanOrEqual(first.expiresAt);
    }
    harness.service.dispose();
  });

  test("fails closed for a third participant without exposing member identities", async () => {
    const harness = createHarness();
    await harness.service.match({
      topic: "pair",
      projectRoot: "/repo",
      participantId: "agent.one",
      waitMs: 0,
    });
    await harness.service.match({
      topic: "pair",
      projectRoot: "/repo",
      participantId: "agent.two",
      waitMs: 0,
    });
    const third = await harness.service.match({
      topic: "pair",
      projectRoot: "/repo",
      participantId: "agent.three",
      waitMs: 0,
    });

    expect(third).toMatchObject({
      status: "topic_busy",
      participantCount: 2,
      suggestion: "choose_another_topic",
    });
    expect(third).not.toHaveProperty("participantIds");
    harness.service.dispose();
  });

  test("expires stale presence and completed matches", async () => {
    const harness = createHarness();
    await harness.service.match({
      topic: "pair",
      projectRoot: "/repo",
      participantId: "agent.one",
      waitMs: 0,
    });
    harness.advance(101);
    harness.service.cleanupExpired();
    const afterPresenceExpiry = await harness.service.match({
      topic: "pair",
      projectRoot: "/repo",
      participantId: "agent.two",
      waitMs: 0,
    });
    expect(afterPresenceExpiry.status).toBe("waiting");

    const matched = await harness.service.match({
      topic: "pair",
      projectRoot: "/repo",
      participantId: "agent.one",
      waitMs: 0,
    });
    expect(matched.status).toBe("matched");
    harness.advance(201);
    harness.service.cleanupExpired();
    const afterMatchExpiry = await harness.service.match({
      topic: "pair",
      projectRoot: "/repo",
      participantId: "agent.three",
      waitMs: 0,
    });
    expect(afterMatchExpiry.status).toBe("waiting");
    harness.service.dispose();
  });

  test("rejects invalid wait bounds and fields", async () => {
    const harness = createHarness();
    await expect(harness.service.match({
      topic: "pair",
      projectRoot: "/repo",
      participantId: "agent.one",
      waitMs: 30_001,
    })).rejects.toThrow("waitMs");
    await expect(harness.service.match({
      topic: "",
      projectRoot: "/repo",
      participantId: "agent.one",
      waitMs: 0,
    })).rejects.toThrow("blank");
    harness.service.dispose();
  });
});
