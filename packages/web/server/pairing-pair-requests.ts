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
// So the requests live under the same home the identity does, and any instance
// can list, approve, or deny any of them. Which server received the tap stops
// being something a human has to know.
//
// Losing the state on restart is still the safe outcome (the phone re-requests),
// so this is a shared cache, not a durable record. But it is a cache that two
// processes WRITE, and the whole point is that the two writers are a decision
// ("approved") and a poll ("still here"), racing by construction: the phone
// polls the instance it resolved to while the human approves on the other. A
// bare read-modify-write loses that race about half the time — both writers
// reload the pending row, and the poll publishes its stale copy last, silently
// reverting the approval.
//
// What serializes them is a compare-and-swap, not a lock.
//
// The state is generational. A writer loads generation N, applies its change,
// writes the result to a temp file, and publishes it by hard-linking that temp
// to the *name* of generation N+1. `link(2)` fails with EEXIST if anybody got
// there first, so "nothing has been published since I loaded" is the
// precondition of every write, enforced by the kernel rather than by agreement.
// A writer that loses reloads what the winner published, re-applies its change
// on top of THAT, and tries the next generation. Every mutation here is a state
// transition keyed by a token — create, touch, approve, deny, fulfil, sweep — so
// re-applying is the exactly-right thing to do rather than a heuristic.
//
// This was a file lock first, and a lock cannot be made correct here. Any lock a
// crash can leave behind needs a staleness rule to break it, and no staleness
// rule can distinguish a dead holder from a slow one. A holder that is merely
// descheduled — a suspended process, a machine under load, a laptop that slept —
// gets evicted, wakes up inside what it still believes is its critical section,
// and republishes the pending row over the approval that landed while it was
// away. Under a compare-and-swap that same suspended writer simply loses its
// link, reloads, sees the approval, re-applies its poll on top of it and
// publishes that. Nothing about correctness depends on anyone's clock, and there
// is no timeout to fall back from: a writer that cannot win the swap has not
// written anything.
//
// Reads take no part in any of it. They resolve the newest generation and parse
// it, and write nothing at all, which keeps the polling device — which has no
// decision to publish — out of the writer set entirely.
//
// Omit `statePath` for a pure in-memory store (tests, ephemeral servers).

import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
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
 * How many generations a losing writer will chase before keeping its change in
 * memory instead.
 *
 * This is a fairness bound, not a correctness one: every attempt that fails
 * fails because somebody else's write succeeded, so the state is moving
 * forward, and a change that never lands is retained and merged exactly like
 * one an unwritable home rejected. With the two writers this store exists for,
 * exhausting it would mean the peer published thirty-two generations inside our
 * load-apply-link window.
 */
const MAX_PUBLISH_ATTEMPTS = 32;
/** Retries taken back-to-back before we start yielding between them. */
const PUBLISH_SPIN_ATTEMPTS = 8;
const PUBLISH_BACKOFF_CEILING_MS = 8;
/**
 * Generations kept behind the newest.
 *
 * Locating the newest generation and reading it are two steps, and collecting
 * everything but the newest would let a writer that gets two publications ahead
 * remove the file in the gap between them — correct, since the reader retries,
 * but it would make the retry the common case rather than the rare one. One
 * generation of slack costs a few hundred bytes.
 */
const RETAINED_GENERATIONS = 1;

/**
 * Sleep without yielding the loop.
 *
 * Every store operation is synchronous by design (route handlers call in and
 * read the result on the next line), so backing off between swap attempts has
 * to happen in place. `Atomics.wait` on a private buffer is the portable way to
 * do that without burning the CPU.
 */
const publishWaitSlot = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
  Atomics.wait(publishWaitSlot, 0, 0, ms);
}

/**
 * Where the shared requests live, given a config home. Beside the identity that
 * makes them shareable in the first place.
 */
export function pairRequestStatePath(configHome: string): string {
  return join(configHome, "run", "pair-requests.json");
}

function generationStem(statePath: string): string {
  return statePath.endsWith(".json") ? statePath.slice(0, -".json".length) : statePath;
}

/**
 * The file a given generation of the state is published as.
 *
 * Generation 0 IS the historical single-file path, so state written by the
 * pre-swap store is picked up as the starting generation on upgrade and then
 * collected like any other once it has been superseded.
 */
export function pairRequestGenerationPath(statePath: string, generation: number): string {
  return generation <= 0 ? statePath : `${generationStem(statePath)}.${generation}.json`;
}

/**
 * The newest generation published to a given state path, or null when nothing
 * has been. Reads the directory, so it always tells the truth about a store
 * some other process is writing.
 */
export function latestPairRequestGeneration(statePath: string): number | null {
  const directory = dirname(statePath);
  const name = basename(statePath);
  const stem = basename(generationStem(statePath));
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return null;
  }
  let latest: number | null = null;
  for (const entry of entries) {
    let generation: number;
    if (entry === name) {
      generation = 0;
    } else {
      if (!entry.startsWith(`${stem}.`) || !entry.endsWith(".json")) continue;
      const middle = entry.slice(stem.length + 1, entry.length - ".json".length);
      // Digits only: the temp files this store links from are siblings, and a
      // half-written one must never be mistaken for published state.
      if (!/^\d+$/.test(middle)) continue;
      generation = Number(middle);
    }
    if (latest === null || generation > latest) latest = generation;
  }
  return latest;
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
 * A cheap fingerprint of a published generation.
 *
 * A generation is write-once — it is created by a `link` that would have failed
 * had the name existed — so its number alone is normally enough to know whether
 * we have already parsed it. The exception is generation 0, the file the
 * pre-swap store rewrote in place, which an older instance running beside us
 * still might; folding in the inode (every publication lands on a new one) and
 * size keeps a reader honest there without costing anything.
 */
function fileSignature(path: string): string | null {
  try {
    const stats = statSync(path);
    return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

function inodeOf(path: string): number | null {
  try {
    return statSync(path).ino;
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
  const byToken = new Map<string, PairRequest>();
  /** The generation our map was loaded from, and its fingerprint. */
  let loadedGeneration: number | null = null;
  let loadedSignature: string | null = null;
  /**
   * Rows whose current local state never reached the shared file, and rows we
   * removed locally but could not remove from it. See `mergeUnpersisted`.
   */
  const unpersistedUpserts = new Set<string>();
  const unpersistedDeletes = new Map<string, number>();
  /**
   * Unique per store, so two stores sharing a path — two servers in one
   * process, or the cross-instance tests — never collide on the temp file and
   * never inherit a stale temp's mode. A publication links this into place, so
   * a name nobody else can guess is also what makes it impossible to publish
   * through a file somebody else prepared.
   */
  const tempPath = statePath
    ? `${statePath}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`
    : null;

  function generationPath(generation: number): string {
    return pairRequestGenerationPath(statePath as string, generation);
  }

  function exists(path: string): boolean {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The newest generation on disk, read from the directory every time.
   *
   * Probing forward from the generation we last read would be one stat instead
   * of a scan, and would be wrong: the collector leaves gaps below the newest
   * generation, so "the next number does not exist" does not mean "nothing is
   * newer". A reader that concluded otherwise would sit on a stale approval,
   * which is the failure this whole file is about. The directory is four
   * entries; the scan is not worth being clever about.
   */
  function latestGeneration(): number | null {
    return statePath ? latestPairRequestGeneration(statePath) : null;
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

  function adopt(rows: PairRequest[]): void {
    const loaded = new Map<string, PairRequest>();
    for (const row of rows) loaded.set(row.token, row);
    mergeUnpersisted(loaded);
    byToken.clear();
    for (const [token, request] of loaded) byToken.set(token, request);
  }

  /**
   * Pull in the newest generation another instance has published.
   *
   * Writes nothing, which is what keeps the polling device off the writer set.
   * A generation can be collected between being located and being read — the
   * writer that collected it published something newer — so a miss re-locates
   * rather than giving up.
   */
  function reload(): void {
    if (!statePath) return;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const generation = latestGeneration();
      if (generation === null) {
        // Nothing published yet, or the run directory was cleared out from
        // under us: whatever we hold is all there is, and the next write starts
        // the chain again from generation one.
        loadedGeneration = null;
        loadedSignature = null;
        return;
      }
      const path = generationPath(generation);
      const signature = fileSignature(path);
      if (signature === null) {
        loadedGeneration = null;
        continue;
      }
      if (generation === loadedGeneration && signature === loadedSignature) return;
      const raw = readFileOrNull(path);
      if (raw === null) {
        loadedGeneration = null;
        continue;
      }
      loadedGeneration = generation;
      loadedSignature = signature;
      let rows: unknown[];
      try {
        const parsed: unknown = JSON.parse(raw);
        rows = Array.isArray((parsed as { requests?: unknown })?.requests)
          ? (parsed as { requests: unknown[] }).requests
          : [];
      } catch {
        // A hand-edited file is not worth failing pairing over, and it must not
        // cost us the rows we are holding either: keep them and republish on
        // the next mutation, which supersedes the damage.
        return;
      }
      adopt(rows.filter(isPairRequest));
      return;
    }
  }

  type PublishOutcome = "won" | "lost" | "failed";

  function discardTemp(): void {
    if (!tempPath) return;
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // A temp we cannot remove is inert: it is not a generation, so nobody
      // will ever read it.
    }
  }

  /**
   * Publish our view as the next generation, if nobody else has.
   *
   * `touched` and `removed` name the rows this operation changed, so a write
   * that cannot land can be retried later without claiming authority over rows
   * we merely happened to be holding — republishing those would resurrect
   * another instance's decisions.
   */
  function publish(touched: readonly string[], removed: readonly string[]): PublishOutcome {
    if (!statePath || !tempPath) return "won";
    // Nothing changed and nothing is owed: stay off the writer set entirely.
    // Anything outstanding, though, is a write that failed and still has to
    // land, so a home that has become writable again is retried here — on the
    // very next operation, without waiting for one that happens to mutate.
    if (touched.length === 0 && removed.length === 0 && !hasOutstandingWrites()) return "won";
    // Publishing is only allowed onto the state we actually read, and only
    // while that is still the newest state there is.
    //
    // The link alone is not enough for the second half. Superseded generations
    // are collected, so their names come free again, and an instance that was
    // suspended long enough for its target name to be collected would link
    // successfully into the PAST — its write invisible behind newer
    // generations, and worse, believed to have landed. Reproduced by suspending
    // an instance across five publications. So the frontier is read first and
    // has to agree with what we loaded; the link then settles who gets there
    // first among everyone who agrees.
    if ((latestGeneration() ?? -1) !== (loadedGeneration ?? -1)) return "lost";
    const next = (loadedGeneration ?? 0) + 1;
    const target = generationPath(next);
    // Before the first byte hits the disk, not after: a test that reaches for
    // the real home must fail loudly instead of leaving a bearer token there.
    assertIsolatedPairingRunStateWrite(target);
    assertIsolatedPairingRunStateWrite(tempPath);
    // `version` describes the row schema, which has not changed; which
    // generation a file is lives in its name.
    const payload = JSON.stringify({ version: 1, requests: [...byToken.values()] });
    try {
      // 0700: a row carries the pairing token, which is a bearer credential —
      // whoever reads one can complete the pair. The files are 0600, but if we
      // are the ones creating the directory it must not be left world-listable.
      mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
      writeFileSync(tempPath, payload, { mode: 0o600 });
    } catch {
      discardTemp();
      return "failed";
    }
    try {
      linkSync(tempPath, target);
    } catch (error) {
      discardTemp();
      // EEXIST is the swap doing its job: somebody published this generation
      // while we were preparing ours, and what they published is state we have
      // not seen. Anything else is a home we cannot write to.
      return (error as NodeJS.ErrnoException | null)?.code === "EEXIST" ? "lost" : "failed";
    }
    // `link` reports EEXIST rather than replacing, which is the whole
    // guarantee — but confirming that the name really is our inode costs one
    // stat and keeps that guarantee from resting on a single syscall's
    // exclusivity on filesystems (network homes in particular) that have been
    // known to report success for a link they did not make.
    const ours = inodeOf(tempPath);
    const signature = fileSignature(target);
    const landed = ours !== null && ours === inodeOf(target);
    discardTemp();
    if (!landed || signature === null) return "lost";
    // Winning the name is not the same as winning the swap. Collected
    // generations give their names back, so an instance suspended between
    // reading the frontier and linking can land in a hole beneath it: the link
    // succeeds and the write is invisible, sitting behind newer generations
    // that nobody derived from it. The frontier is therefore checked once more,
    // and only a link that IS the frontier counts as published.
    //
    // A peer that legitimately publishes on top of ours in the moment between
    // the link and this check reads as a loss too. That is harmless: our write
    // is inside the generation they derived from it, and re-applying a
    // transition that already landed is the same transition.
    if (latestGeneration() !== next) {
      // A generation nobody derived from is nobody's parent. Leaving it behind
      // would only mislead a store that later found it as the newest thing in a
      // half-cleared directory.
      try {
        if (inodeOf(target) === ours) unlinkSync(target);
      } catch {
        // Already gone, or not ours to remove.
      }
      return "lost";
    }
    loadedGeneration = next;
    loadedSignature = signature;
    // What we just published speaks for everything we hold, including the rows
    // we removed. Nothing of ours is outstanding any more.
    unpersistedUpserts.clear();
    unpersistedDeletes.clear();
    collectSuperseded(next);
    return "won";
  }

  /**
   * Unlink generations nobody needs. Walks down from the newest and stops at
   * the first gap, so it is two stats in the steady state and cannot wander off
   * into a directory it does not own.
   */
  function collectSuperseded(published: number): void {
    for (let generation = published - 1 - RETAINED_GENERATIONS; generation >= 0; generation -= 1) {
      const path = generationPath(generation);
      if (!exists(path)) return;
      try {
        unlinkSync(path);
      } catch {
        // Not ours to remove, or already gone. Either way there is nothing
        // below it worth walking to.
        return;
      }
    }
  }

  function recordOutstanding(touched: readonly string[], removed: readonly string[]): void {
    for (const token of touched) {
      if (byToken.has(token)) unpersistedUpserts.add(token);
    }
    const forgetAfter = now() + ttlMs;
    for (const token of removed) unpersistedDeletes.set(token, forgetAfter);
  }

  function isLive(request: PairRequest): boolean {
    return request.expiresAt > now();
  }

  /** Drop expired rows from our map, reporting what went. */
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

  function hasOutstandingWrites(): boolean {
    return unpersistedUpserts.size > 0 || unpersistedDeletes.size > 0;
  }

  interface Applied<T> {
    value: T;
    /** Rows this application changed, for the degraded-write bookkeeping. */
    touched: readonly string[];
  }

  /**
   * Apply a mutation and publish it as the next generation, re-applying it
   * against whatever a peer published if they got there first.
   *
   * `apply` must be re-runnable: it is handed freshly-loaded state, and it can
   * be handed newer state and run again. Every mutation in this store is a
   * transition keyed by a token, so re-running one on top of a state that moved
   * is not a compromise — it is what "extend the window of the request that is
   * now approved" means. `apply` may push into `removed` to report rows it
   * dropped.
   */
  function commit<T>(apply: (removed: string[]) => Applied<T>): T {
    if (!statePath) return apply(pruneExpired()).value;
    for (let attempt = 1; ; attempt += 1) {
      reload();
      const removed = pruneExpired();
      const { value, touched } = apply(removed);
      const outcome = publish(touched, removed);
      if (outcome === "won") return value;
      if (outcome === "failed" || attempt >= MAX_PUBLISH_ATTEMPTS) {
        // A read-only home, or a peer we cannot get a word in edgeways with.
        // Either way this instance keeps serving the change out of its own
        // memory — the per-process behaviour this store replaced — and retries
        // it on the next operation.
        recordOutstanding(touched, removed);
        return value;
      }
      if (attempt > PUBLISH_SPIN_ATTEMPTS) {
        // Jittered, so two instances in lockstep do not keep colliding in phase.
        sleepSync(1 + Math.floor(Math.random() * PUBLISH_BACKOFF_CEILING_MS));
      }
    }
  }

  function sweep(): void {
    // Look before writing. The common case is nothing to collect, and every
    // instance publishing a generation every 30 seconds just to discover that
    // would be churn bought for nothing.
    reload();
    const t = now();
    const collectable = [...byToken.values()].some((request) => request.expiresAt <= t);
    if (!collectable && !hasOutstandingWrites()) return;
    commit(() => ({ value: undefined, touched: [] }));
  }

  // Keep the state from growing unbounded if nobody ever polls a stale request.
  // Reads do not prune (they must not write), so this is what collects them.
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
      const requesterIp = input.requesterIp?.trim() || null;
      const label = input.requesterLabel?.trim() || null;
      // Minted once, outside the retry loop: a swap we lose must not cost the
      // Mac a second row for one tap.
      const token = crypto.randomUUID();
      return commit(() => {
        // Re-evaluated per attempt, so a peer that registered this device while
        // we were losing the swap collapses the prompt rather than duplicating
        // it — which is the same reasoning as reusing within one instance.
        const existing = findReusable(requesterIp);
        if (existing) {
          // Refresh metadata + extend the window so an actively-polling device
          // doesn't time out mid-approval.
          existing.updatedAt = now();
          existing.expiresAt = now() + ttlMs;
          if (input.route) existing.route = input.route;
          if (label) existing.requesterLabel = label;
          return { value: existing, touched: [existing.token] };
        }
        const t = now();
        const request: PairRequest = {
          token,
          status: "pending",
          requesterIp,
          requesterLabel: label,
          route: input.route ?? null,
          createdAt: t,
          updatedAt: t,
          expiresAt: t + ttlMs,
        };
        byToken.set(token, request);
        return { value: request, touched: [token] };
      });
    },

    // Reads write nothing. The polling device hits this constantly and has no
    // decision to publish, so keeping it out of the writer set removes it from
    // the race entirely — expired rows are filtered out of the answer and
    // collected by the sweep instead of being deleted here, which is what used
    // to let a poll republish stale rows.
    get(token) {
      reload();
      const req = byToken.get(token);
      return req && isLive(req) ? req : null;
    },

    touch(token) {
      commit(() => {
        const req = byToken.get(token);
        const extended = now() + ttlMs;
        // A request that already expired was dropped by pruneExpired, so a
        // touch cannot resurrect one. Denied requests are not extended either.
        const extend =
          req !== undefined
          && (req.status === "pending" || req.status === "approved")
          && extended > req.expiresAt;
        if (extend && req) req.expiresAt = extended;
        return { value: undefined, touched: extend ? [token] : [] };
      });
    },

    list() {
      reload();
      return [...byToken.values()].filter(isLive).sort((a, b) => b.createdAt - a.createdAt);
    },

    decide(token, decision) {
      return commit(() => {
        const req = byToken.get(token);
        if (!req) return { value: null, touched: [] };
        req.status = decision === "approve" ? "approved" : "denied";
        req.updatedAt = now();
        // Give an approved request a fresh window to be polled + fulfilled.
        if (decision === "approve") req.expiresAt = now() + ttlMs;
        // Published immediately: the instance the phone is polling is very
        // often NOT the instance the human just approved on. That is the whole
        // point.
        return { value: req, touched: [token] };
      });
    },

    fulfill(token) {
      commit((removed) => {
        if (byToken.delete(token)) {
          unpersistedUpserts.delete(token);
          removed.push(token);
        }
        return { value: undefined, touched: [] };
      });
    },

    dispose() {
      clearInterval(sweepTimer);
      discardTemp();
      byToken.clear();
      unpersistedUpserts.clear();
      unpersistedDeletes.clear();
    },
  };
}
