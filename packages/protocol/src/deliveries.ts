import type {
  DeliveryPolicy,
  DeliveryReason,
  DeliveryStatus,
  DeliveryTargetKind,
  DeliveryTransport,
  MetadataMap,
  ScoutId,
} from "./common.js";

export interface DeliveryTarget {
  id: ScoutId;
  kind: DeliveryTargetKind;
  transport: DeliveryTransport;
  address?: string;
  bindingId?: ScoutId;
  metadata?: MetadataMap;
}

export interface DeliveryIntent {
  id: ScoutId;
  messageId?: ScoutId;
  invocationId?: ScoutId;
  targetId: ScoutId;
  targetKind: DeliveryTargetKind;
  transport: DeliveryTransport;
  reason: DeliveryReason;
  policy: DeliveryPolicy;
  status: DeliveryStatus;
  bindingId?: ScoutId;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  metadata?: MetadataMap;
}

export interface DeliveryAttempt {
  id: ScoutId;
  deliveryId: ScoutId;
  attempt: number;
  status: "sent" | "acknowledged" | "failed";
  error?: string;
  externalRef?: string;
  createdAt: number;
  metadata?: MetadataMap;
}
