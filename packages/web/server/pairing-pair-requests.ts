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
// so this is a shared cache, not a durable record: it is read before every
// operation and written atomically after every mutation. Approval is human-paced
// and the file holds a handful of short-lived rows, so last-writer-wins on a
// concurrent read-modify-write is an acceptable trade for having no lock to
// leak. Omit `statePath` for a pure in-memory store (tests, ephemeral servers).

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
 * Where the shared requests live, given a config home. One file beside the
 * identity that makes them shareable in the first place.
 */
export function pairRequestStatePath(configHome: string): string {
  return join(configHome, "run", "pair-requests.json");
}

function isPairRequest(value: unknown): value is PairRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.token === "string" &&
    (r.status === "pending" || r.status === "approved" || r.status === "denied") &&
    typeof r.createdAt === "number" &&
    typeof r.updatedAt === "number" &&
    typeof r.expiresAt === "number"
  );
}

export function createPendingPairRequestStore(
  options: { ttlMs?: number; now?: () => number; statePath?: string } = {},
): PendingPairRequestStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const statePath = options.statePath;
  const byToken = new Map<string, PairRequest>();
  /** Last mtime we loaded, so a quiet file costs one stat, not a parse. */
  let loadedMtimeMs = -1;

  /** Pull in anything another instance has written since we last looked. */
  function reload(): void {
    if (!statePath) return;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(statePath).mtimeMs;
    } catch {
      // No file yet (or it was swept away) — whatever we hold is all there is.
      return;
    }
    if (mtimeMs === loadedMtimeMs) return;
    loadedMtimeMs = mtimeMs;
    try {
      const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));
      const rows = Array.isArray((parsed as { requests?: unknown })?.requests)
        ? (parsed as { requests: unknown[] }).requests
        : [];
      byToken.clear();
      for (const row of rows) {
        if (isPairRequest(row)) byToken.set(row.token, row);
      }
    } catch {
      // A torn or hand-edited file is not worth failing pairing over; the phone
      // re-requests and we rewrite it on the next mutation.
    }
  }

  /** Publish our view. Temp + rename so a reader never sees half a file. */
  function persist(): void {
    if (!statePath) return;
    const payload = JSON.stringify({ version: 1, requests: [...byToken.values()] });
    const temp = `${statePath}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(temp, payload, { mode: 0o600 });
      renameSync(temp, statePath);
      loadedMtimeMs = statSync(statePath).mtimeMs;
    } catch {
      // Read-only home, or a racing writer won. In-memory state stays correct
      // for this process, which is exactly the old behaviour.
      try {
        rmSync(temp, { force: true });
      } catch {
        // nothing to clean up
      }
    }
  }

  function sweep(): void {
    reload();
    const t = now();
    let dropped = false;
    for (const [token, req] of byToken) {
      if (req.expiresAt <= t) {
        byToken.delete(token);
        dropped = true;
      }
    }
    if (dropped) persist();
  }

  // Keep the map from growing unbounded if nobody ever polls a stale request.
  const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
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
      sweep();
      const requesterIp = input.requesterIp?.trim() || null;
      const existing = findReusable(requesterIp);
      if (existing) {
        // Refresh metadata + extend the window so an actively-polling device
        // doesn't time out mid-approval.
        existing.updatedAt = now();
        existing.expiresAt = now() + ttlMs;
        if (input.route) existing.route = input.route;
        if (input.requesterLabel) existing.requesterLabel = input.requesterLabel.trim();
        persist();
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
      persist();
      return req;
    },

    get(token) {
      sweep();
      return byToken.get(token) ?? null;
    },

    touch(token) {
      reload();
      const req = byToken.get(token);
      if (!req) return;
      if (req.status === "pending" || req.status === "approved") {
        req.expiresAt = now() + ttlMs;
        persist();
      }
    },

    list() {
      sweep();
      return [...byToken.values()].sort((a, b) => b.createdAt - a.createdAt);
    },

    decide(token, decision) {
      sweep();
      const req = byToken.get(token);
      if (!req) return null;
      req.status = decision === "approve" ? "approved" : "denied";
      req.updatedAt = now();
      // Give an approved request a fresh window to be polled + fulfilled.
      if (decision === "approve") req.expiresAt = now() + ttlMs;
      // Publish immediately: the instance the phone is polling is very often
      // NOT the instance the human just approved on. That is the whole point.
      persist();
      return req;
    },

    fulfill(token) {
      reload();
      if (byToken.delete(token)) persist();
    },

    dispose() {
      clearInterval(sweepTimer);
      byToken.clear();
    },
  };
}
