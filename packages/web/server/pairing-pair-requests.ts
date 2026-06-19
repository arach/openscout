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
// State is per-process and in-memory: the web server is a single long-lived
// process, and a pending request that doesn't survive a restart is the safe
// default (the phone simply re-requests).

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

export function createPendingPairRequestStore(
  options: { ttlMs?: number; now?: () => number } = {},
): PendingPairRequestStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const byToken = new Map<string, PairRequest>();

  function sweep(): void {
    const t = now();
    for (const [token, req] of byToken) {
      if (req.expiresAt <= t) byToken.delete(token);
    }
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
      return req;
    },

    get(token) {
      sweep();
      return byToken.get(token) ?? null;
    },

    touch(token) {
      const req = byToken.get(token);
      if (!req) return;
      if (req.status === "pending" || req.status === "approved") {
        req.expiresAt = now() + ttlMs;
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
      return req;
    },

    fulfill(token) {
      byToken.delete(token);
    },

    dispose() {
      clearInterval(sweepTimer);
      byToken.clear();
    },
  };
}
