import type { MetadataMap, ScoutId } from "./common.js";

export type CollaborationKind = "question" | "work_item";

export type CollaborationPriority = "low" | "normal" | "high" | "urgent";

export type CollaborationAcceptanceState =
  | "none"
  | "pending"
  | "accepted"
  | "reopened";

export type QuestionState =
  | "open"
  | "answered"
  | "closed"
  | "declined";

export type WorkItemState =
  | "open"
  | "working"
  | "waiting"
  | "review"
  | "done"
  | "cancelled";

export type CollaborationRelationKind =
  | "blocks"
  | "spawns"
  | "relates_to"
  | "references";

export interface CollaborationRelation {
  kind: CollaborationRelationKind;
  targetId: ScoutId;
  metadata?: MetadataMap;
}

export interface CollaborationWaitingOn {
  kind: "actor" | "question" | "work_item" | "approval" | "artifact" | "condition";
  label: string;
  targetId?: ScoutId;
  metadata?: MetadataMap;
}

export interface CollaborationProgress {
  completedSteps?: number;
  totalSteps?: number;
  checkpoint?: string;
  summary?: string;
  percent?: number;
}

export interface CollaborationRecordBase {
  id: ScoutId;
  kind: CollaborationKind;
  title: string;
  summary?: string;
  createdById: ScoutId;
  ownerId?: ScoutId;
  nextMoveOwnerId?: ScoutId;
  conversationId?: ScoutId;
  parentId?: ScoutId;
  priority?: CollaborationPriority;
  labels?: string[];
  relations?: CollaborationRelation[];
  createdAt: number;
  updatedAt: number;
  metadata?: MetadataMap;
}

export interface QuestionRecord extends CollaborationRecordBase {
  kind: "question";
  state: QuestionState;
  acceptanceState: CollaborationAcceptanceState;
  askedById?: ScoutId;
  askedOfId?: ScoutId;
  answerMessageId?: ScoutId;
  spawnedWorkItemId?: ScoutId;
  closedAt?: number;
}

export interface WorkItemRecord extends CollaborationRecordBase {
  kind: "work_item";
  state: WorkItemState;
  acceptanceState: CollaborationAcceptanceState;
  requestedById?: ScoutId;
  waitingOn?: CollaborationWaitingOn;
  progress?: CollaborationProgress;
  startedAt?: number;
  reviewRequestedAt?: number;
  completedAt?: number;
}

export type CollaborationRecord = QuestionRecord | WorkItemRecord;

export type CollaborationEventKind =
  | "created"
  | "claimed"
  | "answered"
  | "accepted"
  | "reopened"
  | "waiting"
  | "progressed"
  | "handoff"
  | "review_requested"
  | "done"
  | "declined"
  | "cancelled";

export interface CollaborationEvent {
  id: ScoutId;
  recordId: ScoutId;
  recordKind: CollaborationKind;
  kind: CollaborationEventKind;
  actorId: ScoutId;
  at: number;
  summary?: string;
  metadata?: MetadataMap;
}

export function isQuestionTerminalState(state: QuestionState): boolean {
  return state === "closed" || state === "declined";
}

export function isWorkItemTerminalState(state: WorkItemState): boolean {
  return state === "done" || state === "cancelled";
}

export function collaborationRequiresNextMoveOwner(record: CollaborationRecord): boolean {
  if (record.kind === "question") {
    return !isQuestionTerminalState(record.state);
  }

  return !isWorkItemTerminalState(record.state);
}

export function collaborationRequiresOwner(record: CollaborationRecord): boolean {
  return record.kind === "work_item" && !isWorkItemTerminalState(record.state);
}

export function collaborationRequiresWaitingOn(record: CollaborationRecord): boolean {
  return record.kind === "work_item" && record.state === "waiting";
}

export function collaborationRequiresAcceptance(record: CollaborationRecord): boolean {
  if (record.acceptanceState === "none") {
    return false;
  }

  if (record.kind === "question") {
    return Boolean(record.askedById && record.askedOfId);
  }

  return Boolean(record.requestedById);
}

export function validateCollaborationRecord(record: CollaborationRecord): string[] {
  const errors: string[] = [];

  if (!record.id.trim()) {
    errors.push("collaboration record id is required");
  }

  if (!record.title.trim()) {
    errors.push("collaboration title is required");
  }

  if (!record.createdById.trim()) {
    errors.push("createdById is required");
  }

  if (record.parentId && record.parentId === record.id) {
    errors.push("parentId cannot reference the record itself");
  }

  if (record.createdAt > record.updatedAt) {
    errors.push("updatedAt must be greater than or equal to createdAt");
  }

  if (collaborationRequiresOwner(record) && !record.ownerId) {
    errors.push("non-terminal work items require ownerId");
  }

  if (collaborationRequiresNextMoveOwner(record) && !record.nextMoveOwnerId) {
    errors.push("non-terminal collaboration records require nextMoveOwnerId");
  }

  if (record.kind === "work_item" && collaborationRequiresWaitingOn(record) && !record.waitingOn) {
    errors.push("waiting work items require waitingOn");
  }

  if (record.kind === "question") {
    if (record.spawnedWorkItemId && record.spawnedWorkItemId === record.id) {
      errors.push("question spawnedWorkItemId cannot reference the question itself");
    }
  } else if (record.waitingOn?.targetId && record.waitingOn.targetId === record.id) {
    errors.push("waitingOn.targetId cannot reference the work item itself");
  }

  if (record.acceptanceState !== "none" && !collaborationRequiresAcceptance(record)) {
    errors.push("acceptanceState requires the corresponding requester and reviewer identities");
  }

  return errors;
}

export function assertValidCollaborationRecord(record: CollaborationRecord): void {
  const errors = validateCollaborationRecord(record);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

export function validateCollaborationEvent(
  event: CollaborationEvent,
  record?: CollaborationRecord,
): string[] {
  const errors: string[] = [];

  if (!event.id.trim()) {
    errors.push("collaboration event id is required");
  }

  if (!event.recordId.trim()) {
    errors.push("collaboration event recordId is required");
  }

  if (!event.actorId.trim()) {
    errors.push("collaboration event actorId is required");
  }

  if (record) {
    if (record.id !== event.recordId) {
      errors.push("collaboration event recordId does not match the target record");
    }
    if (record.kind !== event.recordKind) {
      errors.push("collaboration event recordKind does not match the target record");
    }
  }

  if (event.kind === "answered" && event.recordKind !== "question") {
    errors.push("answered events only apply to questions");
  }

  if (event.kind === "declined" && event.recordKind !== "question") {
    errors.push("declined events only apply to questions");
  }

  if (
    (event.kind === "waiting"
      || event.kind === "progressed"
      || event.kind === "review_requested"
      || event.kind === "done"
      || event.kind === "cancelled")
    && event.recordKind !== "work_item"
  ) {
    errors.push(`${event.kind} events only apply to work items`);
  }

  return errors;
}

export function assertValidCollaborationEvent(
  event: CollaborationEvent,
  record?: CollaborationRecord,
): void {
  const errors = validateCollaborationEvent(event, record);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}
