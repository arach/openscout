import type { MetadataMap, ScoutId } from "./common.js";

// First implementation slice. Add work_item/question/approval only after ask
// and message_delivery semantics prove out against real paths.
export type DurableActionKind = "ask" | "message_delivery";

export type DurableActionState =
  | "pending"
  | "leased"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type DurableAttemptState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface DurableAction {
  id: ScoutId;
  kind: DurableActionKind;
  subjectId: ScoutId;
  authorityCellId: ScoutId;
  state: DurableActionState;
  idempotencyKey?: string;
  leaseOwner?: string;
  leaseGeneration: number;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: MetadataMap;
}

export interface DurableAttempt {
  id: ScoutId;
  actionId: ScoutId;
  attempt: number;
  state: DurableAttemptState;
  leaseGeneration: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: MetadataMap;
}

export interface DurableCheckpoint {
  actionId: ScoutId;
  name: string;
  payload?: unknown;
  ownerAttemptId?: ScoutId;
  createdAt: number;
}

export interface DurableSignal {
  actionId: ScoutId;
  name: string;
  payload?: unknown;
  emittedAt: number;
}

export interface DurableActionCreateInput {
  id: ScoutId;
  kind: DurableActionKind;
  subjectId: ScoutId;
  authorityCellId: ScoutId;
  idempotencyKey?: string;
  createdAt: number;
  metadata?: MetadataMap;
}

export interface DurableActionClaimInput {
  actionId: ScoutId;
  owner: string;
  leaseMs: number;
  claimedAt: number;
}

export interface DurableActionLease {
  owner: string;
  generation: number;
  expiresAt: number;
}

export interface DurableActionCommandReceipt {
  accepted: boolean;
  duplicate?: boolean;
  action: DurableAction;
  lease?: DurableActionLease;
  events: string[];
}
