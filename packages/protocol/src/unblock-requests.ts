import type { MetadataMap, ScoutId } from "./common.js";

export type UnblockRequestKind =
  | "approval"
  | "permission"
  | "question"
  | "work_item"
  | "flight"
  | "session"
  | "configuration";

export type UnblockRequestState =
  | "open"
  | "snoozed"
  | "resolved"
  | "dismissed"
  | "expired"
  | "denied";

export type UnblockRequestSeverity = "critical" | "warning" | "info";

export type UnblockRequestActionKind =
  | "approve"
  | "deny"
  | "answer"
  | "open"
  | "configure"
  | "copy"
  | "dismiss"
  | "snooze";

export interface UnblockRequestAction {
  kind: UnblockRequestActionKind;
  label: string;
  value?: string;
  route?: Record<string, string | undefined>;
  metadata?: MetadataMap;
}

export interface UnblockRequestRecord {
  id: ScoutId;
  kind: UnblockRequestKind;
  state: UnblockRequestState;
  source: string;
  sourceRef: string;
  sourceLabel?: string;
  title: string;
  summary?: string;
  detail?: string;
  ownerId: ScoutId;
  createdById: ScoutId;
  agentId?: ScoutId;
  conversationId?: ScoutId;
  sessionId?: ScoutId;
  flightId?: ScoutId;
  collaborationRecordId?: ScoutId;
  severity?: UnblockRequestSeverity;
  actions?: UnblockRequestAction[];
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  resolvedAt?: number;
  resolution?: string;
  metadata?: MetadataMap;
}

export type UnblockRequestEventKind =
  | "created"
  | "updated"
  | "resolved"
  | "dismissed"
  | "expired"
  | "denied"
  | "snoozed";

export interface UnblockRequestEvent {
  id: ScoutId;
  requestId: ScoutId;
  kind: UnblockRequestEventKind;
  actorId: ScoutId;
  at: number;
  summary?: string;
  metadata?: MetadataMap;
}

export function isUnblockRequestTerminalState(state: UnblockRequestState): boolean {
  return (
    state === "resolved"
    || state === "dismissed"
    || state === "expired"
    || state === "denied"
  );
}

export function isActiveUnblockRequest(record: UnblockRequestRecord): boolean {
  return !isUnblockRequestTerminalState(record.state);
}

export function validateUnblockRequestRecord(record: UnblockRequestRecord): string[] {
  const errors: string[] = [];

  if (!record.id.trim()) {
    errors.push("unblock request id is required");
  }
  if (!record.source.trim()) {
    errors.push("unblock request source is required");
  }
  if (!record.sourceRef.trim()) {
    errors.push("unblock request sourceRef is required");
  }
  if (!record.title.trim()) {
    errors.push("unblock request title is required");
  }
  if (!record.ownerId.trim()) {
    errors.push("unblock request ownerId is required");
  }
  if (!record.createdById.trim()) {
    errors.push("unblock request createdById is required");
  }
  if (record.createdAt > record.updatedAt) {
    errors.push("unblock request updatedAt must be greater than or equal to createdAt");
  }
  if (record.resolvedAt !== undefined && record.resolvedAt < record.createdAt) {
    errors.push("unblock request resolvedAt must be greater than or equal to createdAt");
  }
  if (isActiveUnblockRequest(record) && (!record.actions || record.actions.length === 0)) {
    errors.push("active unblock requests require at least one action");
  }
  if (isUnblockRequestTerminalState(record.state) && record.resolvedAt === undefined) {
    errors.push("terminal unblock requests require resolvedAt");
  }

  for (const action of record.actions ?? []) {
    if (!action.label.trim()) {
      errors.push("unblock request actions require labels");
    }
  }

  return errors;
}

export function assertValidUnblockRequestRecord(record: UnblockRequestRecord): void {
  const errors = validateUnblockRequestRecord(record);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

export function validateUnblockRequestEvent(
  event: UnblockRequestEvent,
  record?: UnblockRequestRecord,
): string[] {
  const errors: string[] = [];

  if (!event.id.trim()) {
    errors.push("unblock request event id is required");
  }
  if (!event.requestId.trim()) {
    errors.push("unblock request event requestId is required");
  }
  if (!event.actorId.trim()) {
    errors.push("unblock request event actorId is required");
  }
  if (record && record.id !== event.requestId) {
    errors.push("unblock request event requestId does not match the target request");
  }

  return errors;
}

export function assertValidUnblockRequestEvent(
  event: UnblockRequestEvent,
  record?: UnblockRequestRecord,
): void {
  const errors = validateUnblockRequestEvent(event, record);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}
