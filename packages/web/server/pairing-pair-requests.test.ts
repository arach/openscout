import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createPendingPairRequestStore,
  pairRequestLockPath,
  pairRequestStatePath,
} from "./pairing-pair-requests.ts";

// Every store below writes real files. The store refuses to write shared
// pairing state under a test runner unless OPENSCOUT_HOME points somewhere
// disposable, so point it at a throwaway home for this process: an unisolated
// test once left a live pending pair token in the operator's real
// ~/.openscout/run/pair-requests.json.
const isolatedHome = mkdtempSync(join(tmpdir(), "openscout-pair-requests-home-"));
process.env.OPENSCOUT_HOME = isolatedHome;

/** Rows the store writes are bearer credentials; nothing here may run as root. */
const runsAsRoot = process.getuid?.() === 0;

/**
 * Age a lock file past the point where it can be honoured. Lock staleness is
 * measured on the kernel's mtime, so the body cannot fake it.
 */
function backdate(path: string): void {
  const longAgo = new Date(Date.now() - 60_000);
  utimesSync(path, longAgo, longAgo);
}

const tempHomes: string[] = [];

/** A throwaway stand-in for `~/.openscout`, shared by "instances" in a test. */
function tempConfigHome(): string {
  const home = mkdtempSync(join(tmpdir(), "openscout-pair-requests-"));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  while (tempHomes.length > 0) {
    const home = tempHomes.pop() as string;
    // A degraded-persist test leaves a directory it cannot write to behind.
    try {
      chmodSync(join(home, "run"), 0o700);
    } catch {
      // No run directory, or it is already writable.
    }
    rmSync(home, { recursive: true, force: true });
  }
});

afterAll(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
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
    // B stops offering it...
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

// Two stores in one process cannot show what this store is for. JavaScript is
// single-threaded, so an in-process "concurrent" test is a sequential one: a
// read-modify-write there can never interleave with another. The production
// case is two OS processes racing over one file — the phone polling instance A
// while the human decides on instance B — so these spawn two real processes
// and count what the race costs. Against the unserialized store they lose
// roughly half the decisions; the bar here is zero.
describe("pending pair request store under multi-process contention", () => {
  const RACE_ROUNDS = 2_000;
  const RACE_TIMEOUT_MS = 120_000;

  interface RaceResult {
    decider: { lost: number; resurrected: number; rounds: number };
    poller: { touched: number };
  }

  async function race(scenario: "approve" | "deny" | "expire"): Promise<RaceResult> {
    const home = tempConfigHome();
    const statePath = pairRequestStatePath(home);
    const signals = join(home, "signals");
    mkdirSync(signals, { recursive: true });
    const worker = join(import.meta.dir, "pairing-pair-requests.concurrency-worker.ts");

    const spawnRole = (role: "decider" | "poller") =>
      Bun.spawn({
        cmd: [
          process.execPath,
          worker,
          `--role=${role}`,
          `--scenario=${scenario}`,
          `--rounds=${RACE_ROUNDS}`,
          `--state=${statePath}`,
          `--signals=${signals}`,
        ],
        // The workers write real files, so they get the same isolated home the
        // guard demands of this process.
        env: { ...process.env, OPENSCOUT_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      });

    const decider = spawnRole("decider");
    const poller = spawnRole("poller");
    const [deciderOut, deciderErr, pollerOut, pollerErr] = await Promise.all([
      new Response(decider.stdout).text(),
      new Response(decider.stderr).text(),
      new Response(poller.stdout).text(),
      new Response(poller.stderr).text(),
    ]);
    const [deciderCode, pollerCode] = await Promise.all([decider.exited, poller.exited]);
    if (deciderCode !== 0 || pollerCode !== 0) {
      throw new Error(
        `race workers failed (decider ${deciderCode}, poller ${pollerCode}):\n${deciderErr}\n${pollerErr}`,
      );
    }
    return {
      decider: JSON.parse(deciderOut) as RaceResult["decider"],
      poller: JSON.parse(pollerOut) as RaceResult["poller"],
    };
  }

  test(
    "an approval is never reverted by a device polling the other instance",
    async () => {
      const result = await race("approve");
      expect(result.decider.rounds).toBe(RACE_ROUNDS);
      expect(result.poller.touched).toBe(RACE_ROUNDS);
      expect(result.decider.lost).toBe(0);
    },
    RACE_TIMEOUT_MS,
  );

  test(
    "a denial is never reverted by a device polling the other instance",
    async () => {
      const result = await race("deny");
      expect(result.decider.rounds).toBe(RACE_ROUNDS);
      expect(result.poller.touched).toBe(RACE_ROUNDS);
      expect(result.decider.lost).toBe(0);
    },
    RACE_TIMEOUT_MS,
  );

  test(
    "a poll never resurrects a request that expired on the other instance",
    async () => {
      const result = await race("expire");
      expect(result.decider.rounds).toBe(RACE_ROUNDS);
      expect(result.poller.touched).toBe(RACE_ROUNDS);
      expect(result.decider.resurrected).toBe(0);
    },
    RACE_TIMEOUT_MS,
  );
});

// The lock is only worth having if it cannot become the new failure. A pairing
// Mac that goes silent because a crashed process left a lock behind would be a
// worse bug than the one the lock fixes.
describe("pending pair request store write lock", () => {
  test("a lock left behind by a dead process is taken over", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const lockPath = pairRequestLockPath(statePath);
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    // macOS wraps pids well below this, so it is reliably ESRCH.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999_999, nonce: "dead", at: Date.now() }),
    );

    const store = createPendingPairRequestStore({ statePath });
    const req = store.create({ requesterIp: "192.168.1.54" });

    expect(store.get(req.token)?.token).toBe(req.token);
    // Ours went away with the operation; the dead one is not still sitting there.
    expect(existsSync(lockPath)).toBe(false);
    store.dispose();
  });

  test("a lock whose holder stopped refreshing is taken over even if the pid lives", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const lockPath = pairRequestLockPath(statePath);
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    // Pids get recycled: a dead holder's pid can be reassigned to something
    // that looks alive forever, so staleness is what actually breaks the tie.
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, nonce: "stale", at: 0 }));
    backdate(lockPath);

    const store = createPendingPairRequestStore({ statePath });
    const req = store.create({ requesterIp: "192.168.1.55" });

    expect(store.get(req.token)?.token).toBe(req.token);
    expect(existsSync(lockPath)).toBe(false);
    store.dispose();
  });

  test("a lock left half-written by a crash does not wedge pairing", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const lockPath = pairRequestLockPath(statePath);
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    // An exclusive create is not an atomic write: a lock exists for a moment
    // before its body does. A FRESH empty lock therefore has to be read as
    // "held, being written" — which is what stops two instances entering the
    // critical section, and is what the multi-process races above measure. An
    // OLD empty one is a crash between the create and the write, and must not
    // be honoured forever.
    writeFileSync(lockPath, "");
    backdate(lockPath);

    const store = createPendingPairRequestStore({ statePath });
    const req = store.create({ requesterIp: "192.168.1.64" });

    expect(store.get(req.token)?.token).toBe(req.token);
    expect(existsSync(lockPath)).toBe(false);
    store.dispose();
  });

  test("an operation leaves no lock behind", () => {
    const statePath = pairRequestStatePath(tempConfigHome());
    const store = createPendingPairRequestStore({ statePath });
    const req = store.create({ requesterIp: "192.168.1.56" });
    store.touch(req.token);
    store.decide(req.token, "approve");
    store.fulfill(req.token);

    expect(existsSync(pairRequestLockPath(statePath))).toBe(false);
    store.dispose();
  });

  test.skipIf(runsAsRoot)("an unlockable home degrades immediately rather than stalling", () => {
    // A read-only `~/.openscout` cannot hold a lock either. That has to fail
    // fast: waiting out the contention timeout on every request would turn a
    // degraded instance into an unresponsive one.
    const home = tempConfigHome();
    const statePath = pairRequestStatePath(home);
    mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(statePath), 0o500);

    const store = createPendingPairRequestStore({ statePath });
    const startedAt = Date.now();
    const req = store.create({ requesterIp: "192.168.1.57" });
    const elapsed = Date.now() - startedAt;

    expect(req.status).toBe("pending");
    expect(existsSync(pairRequestLockPath(statePath))).toBe(false);
    expect(elapsed).toBeLessThan(1_000);
    store.dispose();
  });
});

// The floor for a degraded instance is the per-process store this replaced: it
// kept a request it could not share. Dropping it is worse than not having the
// shared file at all, because the phone gets 410 and stops polling.
describe("pending pair request store with an unwritable home", () => {
  test.skipIf(runsAsRoot)(
    "keeps serving a request it could not publish when another instance publishes",
    () => {
      const home = tempConfigHome();
      const statePath = pairRequestStatePath(home);
      const runDirectory = dirname(statePath);
      mkdirSync(runDirectory, { recursive: true, mode: 0o700 });

      const degraded = createPendingPairRequestStore({ statePath });
      chmodSync(runDirectory, 0o500); // ~/.openscout on a read-only volume
      const stranded = degraded.create({ requesterIp: "192.168.1.58", requesterLabel: "iPhone" });

      // It really did fail to publish — otherwise this test proves nothing.
      expect(existsSync(statePath)).toBe(false);
      expect(degraded.get(stranded.token)?.token).toBe(stranded.token);

      chmodSync(runDirectory, 0o700);
      const writable = createPendingPairRequestStore({ statePath });
      const unrelated = writable.create({ requesterIp: "192.168.1.59" });
      expect(existsSync(statePath)).toBe(true);

      // The other instance's publication must not evict the token this instance
      // is the only holder of.
      expect(degraded.get(stranded.token)?.token).toBe(stranded.token);
      expect(degraded.list().map((r) => r.token).sort())
        .toEqual([stranded.token, unrelated.token].sort());

      degraded.dispose();
      writable.dispose();
    },
  );

  test.skipIf(runsAsRoot)("republishes a stranded request once the home is writable", () => {
    const home = tempConfigHome();
    const statePath = pairRequestStatePath(home);
    const runDirectory = dirname(statePath);
    mkdirSync(runDirectory, { recursive: true, mode: 0o700 });

    const degraded = createPendingPairRequestStore({ statePath });
    chmodSync(runDirectory, 0o500);
    const stranded = degraded.create({ requesterIp: "192.168.1.60" });
    chmodSync(runDirectory, 0o700);

    // The device is still polling, which is the next mutation this instance
    // makes — and the retry rides along on it.
    degraded.touch(stranded.token);

    const other = createPendingPairRequestStore({ statePath });
    expect(other.get(stranded.token)?.token).toBe(stranded.token);

    degraded.dispose();
    other.dispose();
  });

  test.skipIf(runsAsRoot)("an approval on the shared file beats an unpublished poll", () => {
    const home = tempConfigHome();
    const statePath = pairRequestStatePath(home);
    const runDirectory = dirname(statePath);
    mkdirSync(runDirectory, { recursive: true, mode: 0o700 });

    const writable = createPendingPairRequestStore({ statePath });
    const req = writable.create({ requesterIp: "192.168.1.61" });

    const degraded = createPendingPairRequestStore({ statePath });
    expect(degraded.get(req.token)?.status).toBe("pending");
    chmodSync(runDirectory, 0o500);
    degraded.touch(req.token); // held only in this instance's memory

    chmodSync(runDirectory, 0o700);
    writable.decide(req.token, "approve");

    // Merging back an unpublished row must not undo a decision that reached the
    // shared file; only a poll went missing, and a poll carries no decision.
    expect(degraded.get(req.token)?.status).toBe("approved");

    degraded.dispose();
    writable.dispose();
  });

  test.skipIf(runsAsRoot)("an unpublished approval survives another instance's poll", () => {
    const home = tempConfigHome();
    const statePath = pairRequestStatePath(home);
    const runDirectory = dirname(statePath);
    mkdirSync(runDirectory, { recursive: true, mode: 0o700 });

    const writable = createPendingPairRequestStore({ statePath });
    const req = writable.create({ requesterIp: "192.168.1.65" });

    const degraded = createPendingPairRequestStore({ statePath });
    expect(degraded.get(req.token)?.status).toBe("pending");
    chmodSync(runDirectory, 0o500);
    // The human approved on the instance whose home happens to be read-only.
    expect(degraded.decide(req.token, "approve")?.status).toBe("approved");

    chmodSync(runDirectory, 0o700);
    writable.touch(req.token); // the phone is still polling the other instance

    // The other way round from the test above: a poll republishing the row must
    // not silently revert an answer this instance could not publish. The
    // per-process store kept it, so this one has to as well.
    expect(degraded.get(req.token)?.status).toBe("approved");

    degraded.dispose();
    writable.dispose();
  });
});

// A pair-request row is a bearer credential: whoever reads one can complete the
// pair. The guard exists because a web-server test once wrote a live pending
// token into the runner's real ~/.openscout/run/pair-requests.json.
describe("pending pair request store test isolation", () => {
  const realHomeStatePath = pairRequestStatePath(join(homedir(), ".openscout"));

  test("refuses to write shared state without an isolated OPENSCOUT_HOME", () => {
    const saved = process.env.OPENSCOUT_HOME;
    delete process.env.OPENSCOUT_HOME;
    try {
      const store = createPendingPairRequestStore({ statePath: realHomeStatePath });
      expect(() => store.create({ requesterIp: "192.168.1.62" })).toThrow(/OPENSCOUT_HOME/);
      store.dispose();
    } finally {
      process.env.OPENSCOUT_HOME = saved;
    }
  });

  test("an isolated OPENSCOUT_HOME does not license writing to the real one", () => {
    // Set, but pointing somewhere else: the destination is checked too, so a
    // hard-coded real-home path cannot ride in on someone else's isolation.
    expect(process.env.OPENSCOUT_HOME).toBe(isolatedHome);
    const store = createPendingPairRequestStore({ statePath: realHomeStatePath });
    expect(() => store.create({ requesterIp: "192.168.1.63" })).toThrow(/inside the real/);
    store.dispose();
  });

  test("reading is unaffected — only writes are refused", () => {
    // The guard must not turn a real home into an exception on the read path,
    // or a server whose home is fine would fail for the wrong reason.
    const store = createPendingPairRequestStore({ statePath: realHomeStatePath });
    expect(() => store.get("nope")).not.toThrow();
    expect(() => store.list()).not.toThrow();
    store.dispose();
  });
});
