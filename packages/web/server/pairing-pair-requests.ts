// Approval-gated LAN pairing requests.
//
// Initial pairing over the relay is trust-on-first-use: whoever completes the
// Noise handshake in the live relay room is silently trusted. The deliberate
// human gate that keeps that safe is that pair mode only runs when someone
// starts it. To let a phone on the LAN pair with a single tap *without*
// dropping that gate, a tap registers a pending request here, the Mac surfaces
// it ("A device wants to pair — Allow?"), and only an explicit approval starts
// pair mode and hands the phone the payload. Unapproved requests expire.
//
// State is per-MAC, not per-process.
//
// It used to be per-process and in-memory, on the reasoning that the web server
// is a single long-lived process. That assumption does not hold: the pairing
// IDENTITY lives in `~/.openscout` and is shared by every local instance, so two
// servers on one Mac (a second worktree, a demo stack, a dev server beside the
// supervised one) both advertise the SAME fingerprint over Bonjour. mDNS renames
// the duplicate rather than rejecting it, the phone resolves whichever advert it
// likes, and the request lands in that process's memory. Approve it in the app —
// which is talking to the other process — and the approval can never reach the
// request. The phone sits on "waiting for approval" forever, with a request that
// is genuinely approved somewhere the approver cannot see.
//
// So the requests live in one file under the same home the identity does, and any
// instance can list, approve, or deny any of them. Which server received the tap
// stops being something a human has to know.
//
// Losing the file on restart is still the safe outcome (the phone re-requests),
// so this is a shared cache, not a durable record. But it is a cache that two
// processes WRITE, and the whole point is that the two writers are a decision
// ("approved") and a poll ("still here"), racing by construction: the phone
// polls the instance it resolved to while the human approves on the other. A
// bare read-modify-write loses that race about half the time — both writers
// reload the pending row, and the poll publishes its stale copy last, silently
// reverting the approval. So every mutation runs inside a cross-process file
// lock, and the load happens INSIDE the lock. Reads take no lock and write
// nothing at all, which keeps the polling path off the writer set entirely.
//
// Omit `statePath` for a pure in-memory store (tests, ephemeral servers).

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertIsolatedPairingRunStateWrite } from "./pairing-run-state.ts";

export type PairRequestStatus = "pending" | "approved" | "denied";

export interface PairRequest {
  /** Opaque polling token handed to the requesting device. */
  token: string;
  status: PairRequestStatus;
  /** Best-effort requester identity for the approval prompt. */
  requesterIp: string | null;
  requesterLabel: string | null;
  /** Route the phone asked for (lan/tailnet/default) — surfaced for context. */
  route: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

/** Public view of a request, minus nothing sensitive (there is nothing). */
export type PairRequestView = PairRequest;

export interface PendingPairRequestStore {
  /**
   * Register (or reuse) a pending request for a requester. Repeated taps/polls
   * from the same device collapse onto one prompt rather than spamming the Mac.
   */
  create(input: {
    requesterIp?: string | null;
    requesterLabel?: string | null;
    route?: string | null;
  }): PairRequest;
  get(token: string): PairRequest | null;
  /** Extend a still-open request's window (a device is actively polling it). */
  touch(token: string): void;
  list(): PairRequest[];
  /** Apply an approve/deny decision; returns the updated request or null. */
  decide(token: string, decision: "approve" | "deny"): PairRequest | null;
  /** Mark a request fulfilled (payload delivered) and drop it. */
  fulfill(token: string): void;
  dispose(): void;
}

const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes — matches the pairing QR TTL ballpark
const SWEEP_INTERVAL_MS = 30 * 1000;

/**
 * A lock older than this belongs to a process that died holding it.
 *
 * The critical section is a handful of synchronous file operations —
 * microseconds — so anything approaching a second means the holder is gone, not
 * slow. Kept well above that anyway: breaking a lock that is merely slow is how
 * a lock stops being one.
 */
const LOCK_STALE_MS = 5_000;
/**
 * How long we wait for a contended lock before giving up and going ahead
 * unserialized. Pairing must not fail because a lock is busy; the fallback is
 * the old last-writer-wins behaviour, which is bad but not broken. Reaching
 * this at all would mean something is pathologically wrong, since holders are
 * measured in microseconds and dead holders are evicted after LOCK_STALE_MS.
 */
const LOCK_TIMEOUT_MS = 10_000;
/**
 * Retries before we stop hot-spinning and start sleeping between attempts.
 * A holder's critical section is a few file operations, so spinning through it
 * is usually cheaper than the ~1ms floor on any sleep the platform can give us.
 */
const LOCK_SPIN_ATTEMPTS = 64;
const LOCK_BACKOFF_CEILING_MS = 25;

/**
 * Sleep without yielding the loop.
 *
 * Every store operation is synchronous by design (route handlers call in and
 * read the result on the next line), so a contended lock has to be waited on in
 * place. `Atomics.wait` on a private buffer is the portable way to do that
 * without burning the CPU.
 */
const lockWaitSlot = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
  Atomics.wait(lockWaitSlot, 0, 0, ms);
}

interface LockRecord {
  pid: number;
  /** Unique per acquisition, so we only ever release the lock we took. */
  nonce: string;
  /**
   * When we took it. Written for whoever is looking at a wedged Mac, NOT read
   * back for staleness — see `breakStaleLock`, which uses the file's own mtime
   * so that a lock whose body has not been written yet still reads as held.
   */
  at: number;
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the shared requests live, given a config home. One file beside the
 * identity that makes them shareable in the first place.
 */
export function pairRequestStatePath(configHome: string): string {
  return join(configHome, "run", "pair-requests.json");
}

/** The lock that serializes writes to a given state file. */
export function pairRequestLockPath(statePath: string): string {
  return `${statePath}.lock`;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPairRequest(value: unknown): value is PairRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.token === "string" &&
    r.token.length > 0 &&
    (r.status === "pending" || r.status === "approved" || r.status === "denied") &&
    // The file is a trust boundary (another instance wrote it, and a human can
    // hand-edit it). A row with the right shape but a numeric `requesterIp`
    // would survive into `findReusable` and get republished, so check the
    // nullable fields too rather than only the ones we sort and expire on.
    isNullableString(r.requesterIp) &&
    isNullableString(r.requesterLabel) &&
    isNullableString(r.route) &&
    typeof r.createdAt === "number" &&
    typeof r.updatedAt === "number" &&
    typeof r.expiresAt === "number"
  );
}

/**
 * A cheap fingerprint of the published file, so a quiet file costs one `stat`
 * rather than a parse.
 *
 * Deliberately not mtime alone. mtime granularity is filesystem-dependent —
 * whole seconds on HFS+ and some network mounts — so two writes inside one tick
 * are indistinguishable, and the write we would miss is precisely the
 * cross-instance approval this store exists to deliver. `persist()` publishes
 * via a temp file + rename, so every published version lands on a NEW inode;
 * that makes `ino` a near-perfect change detector on its own, with size and
 * mtime folded in as belt and braces.
 */
function fileSignature(path: string): string | null {
  try {
    const stats = statSync(path);
    return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function createPendingPairRequestStore(
  options: { ttlMs?: number; now?: () => number; statePath?: string } = {},
): PendingPairRequestStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const statePath = options.statePath;
  const lockPath = statePath ? pairRequestLockPath(statePath) : null;
  const byToken = new Map<string, PairRequest>();
  /** Signature of the file version we last parsed. */
  let loadedSignature: string | null = null;
  /**
   * Rows whose current local state never reached the shared file, and rows we
   * removed locally but could not remove from it. See `mergeUnpersisted`.
   */
  const unpersistedUpserts = new Set<string>();
  const unpersistedDeletes = new Map<string, number>();
  /** The nonce of the lock we currently hold, if any. */
  let heldLockNonce: string | null = null;
  /**
   * Unique per store, so two stores sharing a path — two servers in one
   * process, or the cross-instance tests — never collide on the temp file and
   * never inherit a stale temp's mode.
   */
  const tempSuffix = `${process.pid}.${crypto.randomUUID().slice(0, 8)}`;

  function readLockRecord(): Partial<LockRecord> | null {
    if (!lockPath) return null;
    const raw = readFileOrNull(lockPath);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Partial<LockRecord>) : null;
    } catch {
      return null;
    }
  }

  /**
   * Evict a lock whose holder is gone. A crash mid-operation must not wedge
   * pairing on this Mac forever, which is the classic reason to prefer no lock
   * at all — so a lock is honoured only while it is recently taken, and a
   * recently-taken one whose named holder has already died is reclaimed on the
   * spot. Age is what breaks the tie rather than liveness alone, the same
   * reasoning as the beacon claim: pids get recycled, and a reassigned pid
   * would otherwise look alive forever.
   *
   * Returns whether it is worth trying to take the lock again immediately.
   */
  function breakStaleLock(): boolean {
    if (!lockPath) return false;
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(lockPath);
    } catch {
      return true; // vanished under us — the lock is free
    }
    // Age comes from the kernel's mtime, never from the body. `wx` is an
    // exclusive CREATE, not an atomic write: for a moment after the file
    // exists it is still empty, and a peer that judged that empty body
    // "unparseable, therefore abandoned" would break a lock taken microseconds
    // ago and put two instances inside the critical section — the exact bug the
    // lock exists to prevent. Measured at roughly one stolen lock per thousand
    // contended operations before this was mtime-based.
    if (Date.now() - stats.mtimeMs < LOCK_STALE_MS) {
      const holder = readLockRecord();
      const holderPid = typeof holder?.pid === "number" ? holder.pid : null;
      // Unreadable while fresh means "being written right now": held.
      if (holderPid === null || isProcessAlive(holderPid)) return false;
      // A fresh lock naming a pid that is already gone is a crash mid-hold;
      // recover on this pass instead of making the Mac wait out the window.
    }
    try {
      // Re-stat immediately before unlinking: if the lock was replaced since we
      // judged it, the replacement is by definition fresh and not ours to take.
      const current = statSync(lockPath);
      if (current.ino !== stats.ino || current.mtimeMs !== stats.mtimeMs) return true;
      rmSync(lockPath, { force: true });
    } catch {
      // Gone, or not ours to remove. Either way: try again.
    }
    return true;
  }

  function lockBackoffMs(attempt: number): number {
    const ceiling = Math.min(
      LOCK_BACKOFF_CEILING_MS,
      2 ** Math.min(5, Math.floor((attempt - LOCK_SPIN_ATTEMPTS) / 8)),
    );
    // Jittered, so two instances in lockstep do not keep colliding in phase.
    return 1 + Math.floor(Math.random() * ceiling);
  }

  /**
   * Take the cross-process lock. Returns false when we could not — an
   * unwritable home, or contention that outlasted the timeout — in which case
   * the caller proceeds anyway rather than failing the pair.
   */
  function acquireLock(): boolean {
    if (!lockPath || !statePath) return false;
    // Before the first byte hits the disk, not after: a test that reaches for
    // the real home must fail loudly instead of leaving a bearer token there.
    assertIsolatedPairingRunStateWrite(lockPath);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (let attempt = 0; ; attempt += 1) {
      const nonce = `${process.pid}.${crypto.randomUUID()}`;
      let created = false;
      try {
        // 0700: the run directory holds bearer tokens (see persist).
        mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
        writeFileSync(
          lockPath,
          JSON.stringify({ pid: process.pid, nonce, at: Date.now() } satisfies LockRecord),
          { flag: "wx", mode: 0o600 },
        );
        created = true;
      } catch (error) {
        // EEXIST is the lock doing its job. Anything else (read-only home)
        // means we cannot lock here at all, and retrying will not change that.
        if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") return false;
      }
      if (created) {
        // O_EXCL made the create atomic, but a peer that judged the previous
        // lock stale could have unlinked ours in the gap. Confirm it is still
        // the one we wrote before trusting it.
        if (readLockRecord()?.nonce === nonce) {
          heldLockNonce = nonce;
          return true;
        }
      } else {
        breakStaleLock();
      }
      if (Date.now() >= deadline) return false;
      if (attempt >= LOCK_SPIN_ATTEMPTS) sleepSync(lockBackoffMs(attempt));
    }
  }

  function releaseLock(): void {
    if (!lockPath || heldLockNonce === null) return;
    const nonce = heldLockNonce;
    heldLockNonce = null;
    // Never remove a lock that is no longer ours: if someone broke it and took
    // over, the file belongs to them and they are mid-operation.
    if (readLockRecord()?.nonce !== nonce) return;
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // A lock we cannot remove ages out after LOCK_STALE_MS.
    }
  }

  /**
   * Run a read-modify-write as one cross-process step.
   *
   * The load has to happen inside this, not before it: reloading outside the
   * lock is precisely the race — both instances read the pending row, one
   * approves, and the other republishes what it read.
   */
  function withStateLock<T>(operation: () => T): T {
    if (!statePath) return operation();
    const locked = acquireLock();
    try {
      return operation();
    } finally {
      if (locked) releaseLock();
    }
  }

  /**
   * Reconcile the file against writes of ours that never reached it.
   *
   * Without this, a degraded instance is strictly worse than the per-process
   * store it replaced: it registers a token it cannot publish, some other
   * instance publishes anything at all, and the wholesale reload drops the
   * token the phone is holding — which answers the next poll with 410 and
   * stops it retrying. Keeping unpublished rows in memory is the floor.
   */
  function mergeUnpersisted(loaded: Map<string, PairRequest>): void {
    for (const token of [...unpersistedUpserts]) {
      const mine = byToken.get(token);
      if (!mine) {
        // Expired out of our own map; there is nothing left to republish.
        unpersistedUpserts.delete(token);
        continue;
      }
      const theirs = loaded.get(token);
      if (!theirs) {
        loaded.set(token, mine);
        continue;
      }
      // Both sides hold the row, so this is not about keeping it alive any
      // more — it is about not losing a human's answer. A decision outranks a
      // non-decision in either direction: a remote approval beats our
      // unpublished poll, and our unpublished approval beats a remote poll. Two
      // rows in the same class fall back to the later `updatedAt`. The window
      // is the max of the two, because extending is always safe and either side
      // extending means somebody is actively polling.
      const mineDecided = mine.status !== "pending";
      const theirsDecided = theirs.status !== "pending";
      const winner =
        mineDecided === theirsDecided
          ? (theirs.updatedAt > mine.updatedAt ? theirs : mine)
          : (theirsDecided ? theirs : mine);
      loaded.set(token, { ...winner, expiresAt: Math.max(theirs.expiresAt, mine.expiresAt) });
    }
    for (const [token, forgetAfter] of unpersistedDeletes) {
      // Tokens are UUIDs, so a row we dropped can never legitimately come
      // back — but the marker is not worth keeping past the point where the
      // row would have expired on its own anyway.
      if (forgetAfter <= now()) {
        unpersistedDeletes.delete(token);
        continue;
      }
      loaded.delete(token);
    }
  }

  /** Pull in anything another instance has written since we last looked. */
  function reload(): void {
    if (!statePath) return;
    const signature = fileSignature(statePath);
    // No file yet (or it was swept away) — whatever we hold is all there is.
    if (signature === null) return;
    if (signature === loadedSignature) return;
    loadedSignature = signature;
    let rows: unknown[];
    try {
      const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));
      rows = Array.isArray((parsed as { requests?: unknown })?.requests)
        ? (parsed as { requests: unknown[] }).requests
        : [];
    } catch {
      // A torn or hand-edited file is not worth failing pairing over; the phone
      // re-requests and we rewrite it on the next mutation.
      return;
    }
    const loaded = new Map<string, PairRequest>();
    for (const row of rows) {
      if (isPairRequest(row)) loaded.set(row.token, row);
    }
    mergeUnpersisted(loaded);
    byToken.clear();
    for (const [token, request] of loaded) byToken.set(token, request);
  }

  /**
   * Publish our view. Temp + rename so a reader never sees half a file.
   *
   * `touched` and `removed` name the rows this operation changed, so a failed
   * write can be retried later without claiming authority over rows we merely
   * happened to be holding — republishing those would resurrect another
   * instance's decisions.
   */
  function persist(touched: readonly string[], removed: readonly string[]): void {
    if (!statePath) return;
    // Nothing changed and nothing is owed: stay off the writer set entirely.
    // Anything outstanding, though, is a write that failed and still has to
    // land, so a home that has become writable again is retried here — on the
    // very next operation, without waiting for one that happens to mutate.
    if (touched.length === 0 && removed.length === 0 && !hasOutstandingWrites()) return;
    // Defence in depth: acquireLock guards the same directory, but a store that
    // could not take the lock still gets here.
    assertIsolatedPairingRunStateWrite(statePath);
    const payload = JSON.stringify({ version: 1, requests: [...byToken.values()] });
    const temp = `${statePath}.${tempSuffix}.tmp`;
    try {
      // 0700: a row carries the pairing token, which is a bearer credential —
      // whoever reads one can complete the pair. The file is 0600, but if we
      // are the ones creating the directory it must not be left world-listable.
      mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
      writeFileSync(temp, payload, { mode: 0o600 });
      renameSync(temp, statePath);
      loadedSignature = fileSignature(statePath);
      // What we just published speaks for everything we hold, including the
      // rows we removed. Nothing of ours is outstanding any more.
      unpersistedUpserts.clear();
      unpersistedDeletes.clear();
    } catch {
      // Read-only home. We degrade to serving this process's own memory, which
      // is the old per-process behaviour: the request still works against THIS
      // instance, it just stops being visible to the others. Failing the pair
      // outright would be strictly worse — and so would forgetting the rows on
      // the next reload, so they are tracked until a write succeeds.
      try {
        rmSync(temp, { force: true });
      } catch {
        // nothing to clean up
      }
      for (const token of touched) {
        if (byToken.has(token)) unpersistedUpserts.add(token);
      }
      const forgetAfter = now() + ttlMs;
      for (const token of removed) unpersistedDeletes.set(token, forgetAfter);
    }
  }

  function isLive(request: PairRequest): boolean {
    return request.expiresAt > now();
  }

  /** Drop expired rows from our map. Only called with the lock held. */
  function pruneExpired(): string[] {
    const t = now();
    const removed: string[] = [];
    for (const [token, request] of byToken) {
      if (request.expiresAt <= t) {
        byToken.delete(token);
        unpersistedUpserts.delete(token);
        removed.push(token);
      }
    }
    return removed;
  }

  /** Lock-held preamble every mutation shares: fresh state, expired rows gone. */
  function beginMutation(): string[] {
    reload();
    return pruneExpired();
  }

  function hasOutstandingWrites(): boolean {
    return unpersistedUpserts.size > 0 || unpersistedDeletes.size > 0;
  }

  function sweep(): void {
    // Look before locking. The common case is nothing to collect, and every
    // instance taking the lock every 30 seconds just to discover that would be
    // contention bought for nothing. Whatever this glance finds is re-checked
    // under the lock, so the glance being stale costs only a wasted pass.
    reload();
    const t = now();
    const collectable = [...byToken.values()].some((request) => request.expiresAt <= t);
    if (!collectable && !hasOutstandingWrites()) return;
    withStateLock(() => {
      const removed = beginMutation();
      persist([], removed);
    });
  }

  // Keep the file from growing unbounded if nobody ever polls a stale request.
  // Reads no longer prune (they must not write), so this is what collects them.
  const sweepTimer = setInterval(() => {
    try {
      sweep();
    } catch {
      // A sweep that cannot run is not worth taking the process down for; the
      // rows it would have dropped are already invisible to readers.
    }
  }, SWEEP_INTERVAL_MS);
  // Don't keep the process alive solely for the sweep.
  (sweepTimer as { unref?: () => void }).unref?.();

  function findReusable(requesterIp: string | null): PairRequest | null {
    if (!requesterIp) return null;
    const t = now();
    for (const req of byToken.values()) {
      if (
        req.requesterIp === requesterIp &&
        req.expiresAt > t &&
        (req.status === "pending" || req.status === "approved")
      ) {
        return req;
      }
    }
    return null;
  }

  return {
    create(input) {
      return withStateLock(() => {
        const removed = beginMutation();
        const requesterIp = input.requesterIp?.trim() || null;
        const existing = findReusable(requesterIp);
        if (existing) {
          // Refresh metadata + extend the window so an actively-polling device
          // doesn't time out mid-approval.
          existing.updatedAt = now();
          existing.expiresAt = now() + ttlMs;
          if (input.route) existing.route = input.route;
          if (input.requesterLabel) existing.requesterLabel = input.requesterLabel.trim();
          persist([existing.token], removed);
          return existing;
        }
        const t = now();
        const req: PairRequest = {
          token: crypto.randomUUID(),
          status: "pending",
          requesterIp,
          requesterLabel: input.requesterLabel?.trim() || null,
          route: input.route ?? null,
          createdAt: t,
          updatedAt: t,
          expiresAt: t + ttlMs,
        };
        byToken.set(req.token, req);
        persist([req.token], removed);
        return req;
      });
    },

    // Reads take no lock and write nothing. The polling device hits this
    // constantly and has no decision to publish, so keeping it out of the
    // writer set removes it from the race entirely — expired rows are filtered
    // out of the answer and collected by the sweep instead of being deleted
    // here, which is what used to let a poll republish stale rows.
    get(token) {
      reload();
      const req = byToken.get(token);
      return req && isLive(req) ? req : null;
    },

    touch(token) {
      withStateLock(() => {
        const removed = beginMutation();
        const req = byToken.get(token);
        const extended = now() + ttlMs;
        // A request that already expired was dropped by beginMutation, so a
        // touch cannot resurrect one. Denied requests are not extended either.
        const extend =
          req !== undefined
          && (req.status === "pending" || req.status === "approved")
          && extended > req.expiresAt;
        if (extend && req) req.expiresAt = extended;
        persist(extend ? [token] : [], removed);
      });
    },

    list() {
      reload();
      return [...byToken.values()].filter(isLive).sort((a, b) => b.createdAt - a.createdAt);
    },

    decide(token, decision) {
      return withStateLock(() => {
        const removed = beginMutation();
        const req = byToken.get(token);
        if (!req) {
          persist([], removed);
          return null;
        }
        req.status = decision === "approve" ? "approved" : "denied";
        req.updatedAt = now();
        // Give an approved request a fresh window to be polled + fulfilled.
        if (decision === "approve") req.expiresAt = now() + ttlMs;
        // Publish immediately: the instance the phone is polling is very often
        // NOT the instance the human just approved on. That is the whole point.
        persist([token], removed);
        return req;
      });
    },

    fulfill(token) {
      withStateLock(() => {
        const removed = beginMutation();
        if (byToken.delete(token)) {
          unpersistedUpserts.delete(token);
          removed.push(token);
        }
        persist([], removed);
      });
    },

    dispose() {
      clearInterval(sweepTimer);
      byToken.clear();
      unpersistedUpserts.clear();
      unpersistedDeletes.clear();
    },
  };
}
