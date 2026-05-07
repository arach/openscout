import type { DeliveryIntent } from "./deliveries.js";
import type { InvocationRequest } from "./invocations.js";
import type { MessageRecord } from "./messages.js";
import type { DeliveryReason, DeliveryStatus, MetadataMap, ScoutId } from "./common.js";

export type InboxItemKind = "message" | "invocation";

export interface InboxItem {
  id: ScoutId;
  kind: InboxItemKind;
  targetId: ScoutId;
  targetNodeId?: ScoutId;
  conversationId?: ScoutId;
  messageId?: ScoutId;
  invocationId?: ScoutId;
  reason: DeliveryReason;
  status: DeliveryStatus;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  delivery: DeliveryIntent;
  message?: MessageRecord;
  invocation?: InvocationRequest;
  metadata?: MetadataMap;
}

export interface InboxClaimRequest {
  targetId: ScoutId;
  itemId?: ScoutId;
  messageId?: ScoutId;
  reasons?: DeliveryReason[];
  leaseOwner?: string;
  leaseMs?: number;
}

export interface InboxClaimResponse {
  ok: true;
  claimed: InboxItem | null;
}

export interface InboxAckRequest {
  itemId: ScoutId;
  leaseOwner?: string | null;
  metadata?: MetadataMap;
}

export interface InboxNackRequest {
  itemId: ScoutId;
  leaseOwner?: string | null;
  retryAfterMs?: number;
  reason?: string;
  metadata?: MetadataMap;
}
