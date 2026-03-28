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
