import { describe, expect, test } from "bun:test";
import { createPendingPairRequestStore } from "./pairing-pair-requests.ts";

function fixedClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("pending pair request store", () => {
  test("create registers a pending request with a token", () => {
    const store = createPendingPairRequestStore();
    const req = store.create({ requesterIp: "192.168.1.5", requesterLabel: "iPhone" });
    expect(req.status).toBe("pending");
    expect(req.token).toBeTruthy();
    expect(req.requesterLabel).toBe("iPhone");
    expect(store.get(req.token)?.token).toBe(req.token);
    store.dispose();
  });

  test("repeated requests from the same IP collapse onto one prompt", () => {
    const store = createPendingPairRequestStore();
    const a = store.create({ requesterIp: "192.168.1.5" });
    const b = store.create({ requesterIp: "192.168.1.5" });
    expect(b.token).toBe(a.token);
    expect(store.list()).toHaveLength(1);
    // A different IP gets its own request.
    const c = store.create({ requesterIp: "192.168.1.9" });
    expect(c.token).not.toBe(a.token);
    expect(store.list()).toHaveLength(2);
    store.dispose();
  });

  test("requests with no IP are not collapsed together", () => {
    const store = createPendingPairRequestStore();
    const a = store.create({ requesterIp: null });
    const b = store.create({ requesterIp: null });
    expect(b.token).not.toBe(a.token);
    store.dispose();
  });

  test("approve flips status; deny flips status", () => {
    const store = createPendingPairRequestStore();
    const a = store.create({ requesterIp: "10.0.0.2" });
    expect(store.decide(a.token, "approve")?.status).toBe("approved");
    const b = store.create({ requesterIp: "10.0.0.3" });
    expect(store.decide(b.token, "deny")?.status).toBe("denied");
    expect(store.decide("nope", "approve")).toBeNull();
    store.dispose();
  });

  test("requests expire after the TTL", () => {
    const clock = fixedClock();
    const store = createPendingPairRequestStore({ ttlMs: 1000, now: clock.now });
    const a = store.create({ requesterIp: "10.0.0.4" });
    clock.advance(1001);
    expect(store.get(a.token)).toBeNull();
    expect(store.list()).toHaveLength(0);
    store.dispose();
  });

  test("touch extends an actively-polled request", () => {
    const clock = fixedClock();
    const store = createPendingPairRequestStore({ ttlMs: 1000, now: clock.now });
    const a = store.create({ requesterIp: "10.0.0.5" });
    clock.advance(800);
    store.touch(a.token);
    clock.advance(800); // 1600 since create, but only 800 since touch
    expect(store.get(a.token)?.token).toBe(a.token);
    store.dispose();
  });

  test("touch does not resurrect a denied request", () => {
    const clock = fixedClock();
    const store = createPendingPairRequestStore({ ttlMs: 1000, now: clock.now });
    const a = store.create({ requesterIp: "10.0.0.6" });
    store.decide(a.token, "deny");
    clock.advance(800);
    store.touch(a.token); // no-op for denied
    clock.advance(300); // 1100 since create
    expect(store.get(a.token)).toBeNull();
    store.dispose();
  });

  test("fulfill drops a request", () => {
    const store = createPendingPairRequestStore();
    const a = store.create({ requesterIp: "10.0.0.7" });
    store.fulfill(a.token);
    expect(store.get(a.token)).toBeNull();
    store.dispose();
  });
});
