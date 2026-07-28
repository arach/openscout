// One half of a two-process race over a single shared pair-request file.
//
// Test fixture for `pairing-pair-requests.test.ts`, which spawns this twice —
// once as `decider`, once as `poller` — against one state file. Two stores in
// one process cannot reproduce the bug this store exists to prevent: JavaScript
// is single-threaded, so a read-modify-write can never interleave with another
// one and a "concurrent" test in-process is really a sequential test. The
// production case is two OS processes, and only two OS processes exercise the
// lock that makes them safe.
//
// The shape of the race is the real one: the phone polls (touch) the instance
// mDNS handed it while the human decides (approve/deny) on the other, or an
// expired row is being collected on one instance while the other is polling it.
// Both sides rendezvous on a wall-clock instant carried in the `go` signal so
// they act as close to simultaneously as two processes can.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPendingPairRequestStore } from "./pairing-pair-requests.ts";

type Role = "decider" | "poller";
type Scenario = "approve" | "deny" | "expire";

interface GoSignal {
  round: number;
  token: string;
  /** Wall-clock instant both sides act on. */
  actAt: number;
}

interface DoneSignal {
  round: number;
}

/** Long enough for the peer to notice the signal, short enough to stay cheap. */
const RENDEZVOUS_MS = 1;
const SIGNAL_TIMEOUT_MS = 30_000;

function requiredArg(name: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  if (!found) throw new Error(`missing --${name}`);
  return found.slice(prefix.length);
}

function publish(path: string, value: GoSignal | DoneSignal): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, path);
}

function readSignal<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // Absent, or caught mid-rename on a filesystem without atomic rename
    // semantics. Either way: spin again.
    return null;
  }
}

function awaitSignal<T extends { round: number }>(path: string, round: number): T {
  const deadline = Date.now() + SIGNAL_TIMEOUT_MS;
  for (;;) {
    const signal = readSignal<T>(path);
    if (signal && signal.round === round) return signal;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for round ${round} signal at ${path}`);
    }
  }
}

function spinUntil(instant: number): void {
  while (Date.now() < instant) {
    // Deliberately a busy spin: a sleep would round up past the rendezvous and
    // hand the race to whichever process woke first.
  }
}

const role = requiredArg("role") as Role;
const scenario = requiredArg("scenario") as Scenario;
const rounds = Number(requiredArg("rounds"));
const statePath = requiredArg("state");
const signalDir = requiredArg("signals");
const goPath = join(signalDir, "go.json");
const donePath = join(signalDir, "done.json");

// The expire scenario needs rows that are already expired by the rendezvous;
// every other scenario needs rows that comfortably outlive the round.
const ttlMs = scenario === "expire" ? 1 : 60_000;
const store = createPendingPairRequestStore({ statePath, ttlMs });

if (role === "decider") {
  let lost = 0;
  let resurrected = 0;
  for (let round = 0; round < rounds; round += 1) {
    const request = store.create({
      requesterIp: `10.0.0.${round % 250 + 1}`,
      requesterLabel: "iPhone",
    });
    const actAt = Date.now() + RENDEZVOUS_MS + (scenario === "expire" ? 1 : 0);
    publish(goPath, { round, token: request.token, actAt } satisfies GoSignal);

    spinUntil(actAt);
    if (scenario === "expire") {
      // The instance the human is looking at refreshing its list, which is what
      // used to collect expired rows out of the shared file.
      store.list();
    } else {
      store.decide(request.token, scenario === "approve" ? "approve" : "deny");
    }

    awaitSignal<DoneSignal>(donePath, round);

    const settled = store.get(request.token);
    if (scenario === "expire") {
      // A poll must never bring an expired request back to life.
      if (settled !== null) resurrected += 1;
    } else if (settled?.status !== (scenario === "approve" ? "approved" : "denied")) {
      // The decision was made and then silently reverted by the poll.
      lost += 1;
    }

    store.fulfill(request.token);
  }
  process.stdout.write(`${JSON.stringify({ role, scenario, rounds, lost, resurrected })}\n`);
} else {
  let touched = 0;
  for (let round = 0; round < rounds; round += 1) {
    const go = awaitSignal<GoSignal>(goPath, round);
    spinUntil(go.actAt);
    store.touch(go.token);
    touched += 1;
    publish(donePath, { round } satisfies DoneSignal);
  }
  process.stdout.write(`${JSON.stringify({ role, scenario, rounds, touched })}\n`);
}

store.dispose();
