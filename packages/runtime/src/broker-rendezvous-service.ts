import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  SCOUT_RENDEZVOUS_MAX_WAIT_MS,
  normalizeScoutRendezvousTopic,
  validateScoutRendezvousTopic,
  type ScoutRendezvousMatchedResponse,
  type ScoutRendezvousRequest,
  type ScoutRendezvousResponse,
  type ScoutRendezvousWaitingResponse,
} from "@openscout/protocol";

const DEFAULT_PRESENCE_TTL_MS = 45_000;
const DEFAULT_MATCH_TTL_MS = 120_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 1_000;

type RendezvousPresence = {
  participantId: string;
  projectRoot: string;
  topic: string;
  joinedAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

type RendezvousMatch = {
  id: string;
  projectRoot: string;
  topic: string;
  participantIds: [string, string];
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

type RendezvousWaiter = {
  participantId: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: ScoutRendezvousResponse) => void;
};

export type BrokerRendezvousServiceOptions = {
  now?: () => number;
  createMatchId?: () => string;
  presenceTtlMs?: number;
  matchTtlMs?: number;
  cleanupIntervalMs?: number;
};

export class BrokerRendezvousService {
  private readonly now: () => number;
  private readonly createMatchId: () => string;
  private readonly presenceTtlMs: number;
  private readonly matchTtlMs: number;
  private readonly presences = new Map<string, RendezvousPresence>();
  private readonly matches = new Map<string, RendezvousMatch>();
  private readonly waiters = new Map<string, Set<RendezvousWaiter>>();
  private readonly cleanupTimer: ReturnType<typeof setInterval> | null;

  constructor(options: BrokerRendezvousServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createMatchId = options.createMatchId ?? (() => `match_${randomUUID()}`);
    this.presenceTtlMs = positiveDuration(
      options.presenceTtlMs,
      DEFAULT_PRESENCE_TTL_MS,
      "presenceTtlMs",
    );
    this.matchTtlMs = positiveDuration(
      options.matchTtlMs,
      DEFAULT_MATCH_TTL_MS,
      "matchTtlMs",
    );
    const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.cleanupTimer = cleanupIntervalMs > 0
      ? setInterval(() => this.cleanupExpired(), cleanupIntervalMs)
      : null;
    this.cleanupTimer?.unref?.();
  }

  async match(request: ScoutRendezvousRequest): Promise<ScoutRendezvousResponse> {
    const input = validateRequest(request);
    this.cleanupExpired();
    const key = rendezvousKey(input.projectRoot, input.normalizedTopic);
    const now = this.now();
    const activeMatch = this.matches.get(key);

    if (activeMatch) {
      if (!activeMatch.participantIds.includes(input.participantId)) {
        return {
          status: "topic_busy",
          topic: activeMatch.topic,
          projectRoot: activeMatch.projectRoot,
          participantId: input.participantId,
          participantCount: activeMatch.participantIds.length,
          expiresAt: activeMatch.expiresAt,
          suggestion: "choose_another_topic",
        };
      }
      activeMatch.lastSeenAt = now;
      activeMatch.expiresAt = now + this.matchTtlMs;
      return matchedResponse(activeMatch, input.participantId);
    }

    const presence = this.presences.get(key);
    if (presence && presence.participantId !== input.participantId) {
      const match: RendezvousMatch = {
        id: this.createMatchId(),
        projectRoot: presence.projectRoot,
        topic: presence.topic,
        participantIds: [presence.participantId, input.participantId],
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + this.matchTtlMs,
      };
      this.presences.delete(key);
      this.matches.set(key, match);
      this.resolveMatchedWaiters(key, match);
      return matchedResponse(match, input.participantId);
    }

    const nextPresence: RendezvousPresence = presence ?? {
      participantId: input.participantId,
      projectRoot: input.projectRoot,
      topic: input.topic,
      joinedAt: now,
      lastSeenAt: now,
      expiresAt: now + this.presenceTtlMs,
    };
    nextPresence.lastSeenAt = now;
    nextPresence.expiresAt = now + this.presenceTtlMs;
    this.presences.set(key, nextPresence);

    if (input.waitMs === 0) {
      return waitingResponse(nextPresence);
    }
    return await this.waitForMatch(key, nextPresence, input.waitMs);
  }

  cleanupExpired(): void {
    const now = this.now();
    for (const [key, presence] of this.presences) {
      if (presence.expiresAt > now) continue;
      this.presences.delete(key);
      this.resolveWaitingWaiters(key, presence);
    }
    for (const [key, match] of this.matches) {
      if (match.expiresAt > now) continue;
      this.matches.delete(key);
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    for (const [key, presence] of this.presences) {
      this.resolveWaitingWaiters(key, presence);
    }
    this.presences.clear();
    this.matches.clear();
  }

  private waitForMatch(
    key: string,
    presence: RendezvousPresence,
    waitMs: number,
  ): Promise<ScoutRendezvousResponse> {
    return new Promise((resolveWait) => {
      const waiter: RendezvousWaiter = {
        participantId: presence.participantId,
        resolve: resolveWait,
        timer: setTimeout(() => {
          this.removeWaiter(key, waiter);
          resolveWait(waitingResponse(this.presences.get(key) ?? presence));
        }, waitMs),
      };
      waiter.timer.unref?.();
      const keyedWaiters = this.waiters.get(key) ?? new Set<RendezvousWaiter>();
      keyedWaiters.add(waiter);
      this.waiters.set(key, keyedWaiters);
    });
  }

  private resolveMatchedWaiters(key: string, match: RendezvousMatch): void {
    const keyedWaiters = this.waiters.get(key);
    if (!keyedWaiters) return;
    this.waiters.delete(key);
    for (const waiter of keyedWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(matchedResponse(match, waiter.participantId));
    }
  }

  private resolveWaitingWaiters(key: string, presence: RendezvousPresence): void {
    const keyedWaiters = this.waiters.get(key);
    if (!keyedWaiters) return;
    this.waiters.delete(key);
    for (const waiter of keyedWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(waitingResponse(presence));
    }
  }

  private removeWaiter(key: string, waiter: RendezvousWaiter): void {
    const keyedWaiters = this.waiters.get(key);
    if (!keyedWaiters) return;
    keyedWaiters.delete(waiter);
    if (keyedWaiters.size === 0) {
      this.waiters.delete(key);
    }
  }
}

function validateRequest(request: ScoutRendezvousRequest): {
  topic: string;
  normalizedTopic: string;
  projectRoot: string;
  participantId: string;
  waitMs: number;
} {
  if (!request || typeof request !== "object") {
    throw new Error("rendezvous request must be an object");
  }
  const topic = validateScoutRendezvousTopic(request.topic);
  const participantId = requiredField(request.participantId, "participantId");
  const rawProjectRoot = requiredField(request.projectRoot, "projectRoot");
  if (rawProjectRoot.includes("\0")) {
    throw new Error("projectRoot must not contain NUL");
  }
  const waitMs = request.waitMs ?? SCOUT_RENDEZVOUS_MAX_WAIT_MS;
  if (
    !Number.isInteger(waitMs)
    || waitMs < 0
    || waitMs > SCOUT_RENDEZVOUS_MAX_WAIT_MS
  ) {
    throw new Error(
      `waitMs must be an integer between 0 and ${SCOUT_RENDEZVOUS_MAX_WAIT_MS}`,
    );
  }
  return {
    topic,
    normalizedTopic: normalizeScoutRendezvousTopic(topic),
    projectRoot: resolve(rawProjectRoot),
    participantId,
    waitMs,
  };
}

function requiredField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`${field} must not contain control characters`);
  }
  return value.trim();
}

function positiveDuration(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  const duration = value ?? fallback;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${field} must be positive`);
  }
  return duration;
}

function rendezvousKey(projectRoot: string, normalizedTopic: string): string {
  return createHash("sha256")
    .update(projectRoot)
    .update("\0")
    .update(normalizedTopic)
    .digest("hex");
}

function waitingResponse(presence: RendezvousPresence): ScoutRendezvousWaitingResponse {
  return {
    status: "waiting",
    topic: presence.topic,
    projectRoot: presence.projectRoot,
    participantId: presence.participantId,
    joinedAt: presence.joinedAt,
    expiresAt: presence.expiresAt,
  };
}

function matchedResponse(
  match: RendezvousMatch,
  participantId: string,
): ScoutRendezvousMatchedResponse {
  return {
    status: "matched",
    matchId: match.id,
    topic: match.topic,
    projectRoot: match.projectRoot,
    participantId,
    participantIds: match.participantIds,
    peerParticipantIds: match.participantIds.filter((id) => id !== participantId),
    createdAt: match.createdAt,
    expiresAt: match.expiresAt,
  };
}
