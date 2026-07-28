import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createPendingPairRequestStore,
  pairRequestStatePath,
} from "./pairing-pair-requests.ts";

const tempHomes: string[] = [];

/** A throwaway stand-in for `~/.openscout`, shared by "instances" in a test. */
function tempConfigHome(): string {
  const home = mkdtempSync(join(tmpdir(), "openscout-pair-requests-"));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  while (tempHomes.length > 0) {
    rmSync(tempHomes.pop() as string, { recursive: true, force: true });
  }
});

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

// The bug these cover: two OpenScout instances on one Mac share the pairing
// identity, so both advertise the same Bonjour fingerprint. The phone lands on
// whichever process mDNS hands it, the human approves on the other one, and
// with a per-process store the approval can never reach the request — the phone
// waits forever on a request that was genuinely approved somewhere it cannot
// see. Each test below drives TWO stores over ONE state file, which is exactly
// two instances over one `~/.openscout`.
describe("pending pair request store shared across instances", () => {
  test("a request created on one instance is approved on another and seen by the first", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const phoneFacing = createPendingPairRequestStore({ statePath });
    const humanFacing = createPendingPairRequestStore({ statePath });

    // The phone taps instance A.
    const req = phoneFacing.create({ requesterIp: "192.168.1.40", requesterLabel: "iPhone" });
    expect(req.status).toBe("pending");

    // The human is looking at instance B, which must see the request at all.
    const visible = humanFacing.list();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.token).toBe(req.token);
    expect(visible[0]?.requesterLabel).toBe("iPhone");

    // ...and approving there must reach the instance the phone is polling.
    expect(humanFacing.decide(req.token, "approve")?.status).toBe("approved");
    expect(phoneFacing.get(req.token)?.status).toBe("approved");

    phoneFacing.dispose();
    humanFacing.dispose();
  });

  test("a denial on one instance reaches the other", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const a = createPendingPairRequestStore({ statePath });
    const b = createPendingPairRequestStore({ statePath });

    const req = a.create({ requesterIp: "192.168.1.41" });
    expect(b.decide(req.token, "deny")?.status).toBe("denied");
    expect(a.get(req.token)?.status).toBe("denied");

    a.dispose();
    b.dispose();
  });

  test("fulfilling on one instance drops the request everywhere", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const a = createPendingPairRequestStore({ statePath });
    const b = createPendingPairRequestStore({ statePath });

    const req = a.create({ requesterIp: "192.168.1.42" });
    b.decide(req.token, "approve");
    // The payload gets served by whichever instance the phone came back to.
    b.fulfill(req.token);
    expect(a.get(req.token)).toBeNull();
    expect(a.list()).toHaveLength(0);

    a.dispose();
    b.dispose();
  });

  test("concurrent instances do not clobber each other's requests", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const a = createPendingPairRequestStore({ statePath });
    const b = createPendingPairRequestStore({ statePath });

    // Each instance writes the whole file, so a write that skipped the reload
    // would silently drop the other instance's row.
    const first = a.create({ requesterIp: "192.168.1.43" });
    const second = b.create({ requesterIp: "192.168.1.44" });

    const tokensFromA = a.list().map((r) => r.token).sort();
    const tokensFromB = b.list().map((r) => r.token).sort();
    const expected = [first.token, second.token].sort();
    expect(tokensFromA).toEqual(expected);
    expect(tokensFromB).toEqual(expected);

    a.dispose();
    b.dispose();
  });

  test("the same device tapping two instances collapses onto one prompt", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const a = createPendingPairRequestStore({ statePath });
    const b = createPendingPairRequestStore({ statePath });

    // mDNS can hand the phone a different instance on a retry; the human should
    // still be prompted once, not once per server.
    const first = a.create({ requesterIp: "192.168.1.45" });
    const retry = b.create({ requesterIp: "192.168.1.45" });
    expect(retry.token).toBe(first.token);
    expect(a.list()).toHaveLength(1);

    a.dispose();
    b.dispose();
  });

  test("TTL expiry propagates across instances", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const clock = fixedClock();
    const a = createPendingPairRequestStore({ statePath, ttlMs: 1000, now: clock.now });
    const b = createPendingPairRequestStore({ statePath, ttlMs: 1000, now: clock.now });

    const req = a.create({ requesterIp: "192.168.1.46" });
    expect(b.get(req.token)?.token).toBe(req.token);

    clock.advance(1001);
    // B sweeps it out of the shared file...
    expect(b.list()).toHaveLength(0);
    // ...and A must not resurrect it from its own memory.
    expect(a.get(req.token)).toBeNull();
    expect(a.list()).toHaveLength(0);

    a.dispose();
    b.dispose();
  });

  test("a touch on one instance keeps the request alive for the other", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const clock = fixedClock();
    const a = createPendingPairRequestStore({ statePath, ttlMs: 1000, now: clock.now });
    const b = createPendingPairRequestStore({ statePath, ttlMs: 1000, now: clock.now });

    const req = a.create({ requesterIp: "192.168.1.47" });
    clock.advance(800);
    // The phone is polling instance A while the human dithers on B.
    a.touch(req.token);
    clock.advance(800);
    expect(b.get(req.token)?.token).toBe(req.token);

    a.dispose();
    b.dispose();
  });

  test("state survives an instance restarting", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const first = createPendingPairRequestStore({ statePath });
    const req = first.create({ requesterIp: "192.168.1.48", requesterLabel: "iPad" });
    first.dispose();

    // A fresh process reads the same home and picks the request back up.
    const restarted = createPendingPairRequestStore({ statePath });
    expect(restarted.get(req.token)?.requesterLabel).toBe("iPad");
    restarted.dispose();
  });

  test("the state file and its directory are not world-readable", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const store = createPendingPairRequestStore({ statePath });
    store.create({ requesterIp: "192.168.1.49" });

    // A token is a bearer credential for completing the pair.
    expect(statSync(statePath).mode & 0o077).toBe(0);
    expect(statSync(dirname(statePath)).mode & 0o077).toBe(0);

    store.dispose();
  });

  test("a corrupt state file does not break pairing", () => {
    const home = tempConfigHome();
    const statePath = pairRequestStatePath(home);
    const seed = createPendingPairRequestStore({ statePath });
    seed.create({ requesterIp: "192.168.1.50" });
    seed.dispose();

    writeFileSync(statePath, "{ this is not json");

    const store = createPendingPairRequestStore({ statePath });
    const req = store.create({ requesterIp: "192.168.1.51" });
    expect(req.status).toBe("pending");
    expect(store.get(req.token)?.token).toBe(req.token);
    store.dispose();
  });

  test("rows that are not well-formed requests are dropped on load", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const seed = createPendingPairRequestStore({ statePath });
    const good = seed.create({ requesterIp: "192.168.1.52" });
    seed.dispose();

    // Re-read what the store wrote so the good row stays byte-accurate.
    const rows = JSON.parse(readFileSync(statePath, "utf8")) as { requests: unknown[] };
    const template = rows.requests[0] as Record<string, unknown>;
    rows.requests.push({ token: 42, status: "pending" });
    rows.requests.push({ ...template, token: "bad-ip", requesterIp: 9000 });
    rows.requests.push({ ...template, token: "bad-status", status: "maybe" });
    writeFileSync(statePath, JSON.stringify(rows));

    const store = createPendingPairRequestStore({ statePath });
    const tokens = store.list().map((r) => r.token);
    expect(tokens).toEqual([good.token]);
    store.dispose();
  });

  test("omitting statePath keeps the store purely in-memory", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const shared = createPendingPairRequestStore({ statePath });
    const isolated = createPendingPairRequestStore();

    isolated.create({ requesterIp: "192.168.1.53" });
    expect(shared.list()).toHaveLength(0);

    shared.dispose();
    isolated.dispose();
  });
});
