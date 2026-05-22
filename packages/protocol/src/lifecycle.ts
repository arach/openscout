import type { DeliveryIntent, DeliveryAttempt } from "./deliveries.js";
import type { FlightRecord, InvocationRequest } from "./invocations.js";
import type { DeliveryTransport, MetadataMap, ScoutId } from "./common.js";

export type ScoutInvocationState =
  | "queued"
  | "dispatching"
  | "acknowledged"
  | "working"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type ScoutDeliveryState =
  | "pending"
  | "leased"
  | "sent"
  | "retrying"
  | "dead_lettered"
  | "dispatched_to_peer"
  | "suppressed"
  | "cancelled";

export type ScoutLifecycleSubjectKind =
  | "message"
  | "invocation"
  | "work_item";

export type ScoutWaitingOnKind =
  | "human"
  | "peer"
  | "approval"
  | "artifact"
  | "condition"
  | "agent"
  | "unknown";

export interface ScoutWaitingOn {
  kind: ScoutWaitingOnKind;
  label?: string;
  targetId?: ScoutId;
  metadata?: MetadataMap;
}

export interface ScoutTerminalResult {
  state: "completed" | "failed" | "cancelled" | "expired";
  /** Broker-generated compact summary. Do not store raw harness output here. */
  summary?: string;
  errorClass?: string;
  exitCode?: number;
  completedAt: number;
  sourceRecordId?: ScoutId;
  metadata?: MetadataMap;
}

export interface ScoutDeliveryError {
  reason?: string;
  detail?: string;
  retryable?: boolean;
  code?: string;
  status?: number;
}

export interface ScoutOutcomeDelivery {
  deliveryId: ScoutId;
  subjectKind: ScoutLifecycleSubjectKind;
  subjectId: ScoutId;
  transport: DeliveryTransport | "broker" | "mesh" | "desktop" | "mobile_push" | "web" | "cli";
  state: ScoutDeliveryState;
  peerNodeId?: ScoutId;
  peerFlightId?: ScoutId;
  attemptCount: number;
  nextAttemptAt?: number;
  lastError?: ScoutDeliveryError;
  lastAttemptAt?: number;
  deliveredAt?: number;
  metadata?: MetadataMap;
}

export interface ScoutInvocationLifecycle {
  invocationId: ScoutId;
  flightId?: ScoutId;
  state: ScoutInvocationState;
  targetAgentId?: ScoutId;
  targetEndpointId?: ScoutId;
  peerNodeId?: ScoutId;
  peerFlightId?: ScoutId;
  workId?: ScoutId;
  actionId?: ScoutId;
  idempotencyKey?: string;
  acknowledgedAt?: number;
  startedAt?: number;
  completedAt?: number;
  expiresAt?: number;
  lastProgressAt?: number;
  waitingOn?: ScoutWaitingOn;
  terminal?: ScoutTerminalResult;
  deliveries?: ScoutOutcomeDelivery[];
  metadata?: MetadataMap;
}

export interface ProjectInvocationLifecycleInput {
  invocation: InvocationRequest;
  flight?: FlightRecord;
  deliveries?: DeliveryIntent[];
  deliveryAttempts?: Record<ScoutId, DeliveryAttempt[]>;
  now?: number;
  expiresAt?: number;
  waitingOn?: ScoutWaitingOn;
}

const TERMINAL_INVOCATION_STATES = new Set<ScoutInvocationState>([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

const MAX_TERMINAL_SUMMARY_LENGTH = 256;

export function projectInvocationLifecycle(
  input: ProjectInvocationLifecycleInput,
): ScoutInvocationLifecycle {
  const deliveries = (input.deliveries ?? []).map((delivery) =>
    projectOutcomeDelivery(delivery, input.deliveryAttempts?.[delivery.id] ?? [])
  );
  const peerDelivery = deliveries.find((delivery) => delivery.state === "dispatched_to_peer");
  const expiresAt = input.expiresAt ?? expiresAtForInvocation(input.invocation);
  const state = projectInvocationState({
    invocation: input.invocation,
    flight: input.flight,
    deliveries,
    now: input.now,
    expiresAt,
  });
  const terminal = projectTerminalResult({
    state,
    flight: input.flight,
    now: input.now,
  });

  const lifecycle: ScoutInvocationLifecycle = {
    invocationId: input.invocation.id,
    state,
  };

  addOptional(lifecycle, "flightId", input.flight?.id);
  addOptional(lifecycle, "targetAgentId", input.flight?.targetAgentId ?? input.invocation.targetAgentId);
  addOptional(lifecycle, "targetEndpointId", stringMetadata(input.flight?.metadata, "targetEndpointId"));
  addOptional(lifecycle, "peerNodeId", peerDelivery?.peerNodeId ?? input.invocation.targetNodeId);
  addOptional(lifecycle, "peerFlightId", peerDelivery?.peerFlightId);
  addOptional(lifecycle, "workId", inferWorkId(input.invocation));
  addOptional(lifecycle, "actionId", stringMetadata(input.invocation.metadata, "actionId"));
  addOptional(lifecycle, "idempotencyKey", stringMetadata(input.invocation.metadata, "idempotencyKey"));
  addOptional(lifecycle, "acknowledgedAt", dispatchAcknowledgedAt(input.flight?.metadata) ?? peerDelivery?.deliveredAt);
  addOptional(lifecycle, "startedAt", input.flight?.startedAt);
  addOptional(lifecycle, "completedAt", input.flight?.completedAt ?? terminal?.completedAt);
  addOptional(lifecycle, "expiresAt", expiresAt);
  addOptional(lifecycle, "lastProgressAt", lastProgressAt(input.flight, deliveries));
  addOptional(lifecycle, "waitingOn", input.waitingOn ?? waitingOnFromMetadata(input.flight?.metadata));
  addOptional(lifecycle, "terminal", terminal);
  addOptional(lifecycle, "deliveries", deliveries.length > 0 ? deliveries : undefined);
  addOptional(lifecycle, "metadata", lifecycleMetadata(input.invocation, input.flight));

  return lifecycle;
}

export function projectInvocationState(input: {
  invocation: InvocationRequest;
  flight?: FlightRecord;
  deliveries?: ScoutOutcomeDelivery[];
  now?: number;
  expiresAt?: number;
}): ScoutInvocationState {
  const flightState = input.flight?.state;
  if (flightState === "completed" || flightState === "failed" || flightState === "cancelled") {
    return flightState;
  }

  if (input.expiresAt !== undefined && input.now !== undefined && input.expiresAt <= input.now) {
    return "expired";
  }

  if (input.deliveries?.some((delivery) => delivery.state === "dispatched_to_peer")) {
    return "acknowledged";
  }

  if (flightState === "waiting") {
    return "waiting";
  }
  if (flightState === "running") {
    return "working";
  }
  if (flightState === "waking") {
    return "dispatching";
  }
  if (flightState === "queued") {
    return "queued";
  }

  return input.invocation.ensureAwake ? "dispatching" : "queued";
}

export function projectOutcomeDelivery(
  delivery: DeliveryIntent,
  attempts: DeliveryAttempt[] = [],
): ScoutOutcomeDelivery {
  const sortedAttempts = [...attempts].sort((left, right) => left.createdAt - right.createdAt);
  const lastAttempt = sortedAttempts[sortedAttempts.length - 1];
  const latestFailedAttempt = [...sortedAttempts]
    .reverse()
    .find((attempt) => attempt.status === "failed");
  const state = projectDeliveryState(delivery);
  const deliveredAt = deliveredAtForDelivery(delivery, sortedAttempts);
  const subject = deliverySubject(delivery);

  const outcome: ScoutOutcomeDelivery = {
    deliveryId: delivery.id,
    subjectKind: subject.kind,
    subjectId: subject.id,
    transport: delivery.transport,
    state,
    attemptCount: sortedAttempts.length,
  };

  addOptional(outcome, "peerNodeId", peerNodeId(delivery));
  addOptional(outcome, "peerFlightId", stringMetadata(delivery.metadata, "peerFlightId"));
  addOptional(outcome, "nextAttemptAt", numberMetadata(delivery.metadata, "nextAttemptAt"));
  addOptional(outcome, "lastError", deliveryError(delivery, latestFailedAttempt));
  addOptional(outcome, "lastAttemptAt", lastAttempt?.createdAt);
  addOptional(outcome, "deliveredAt", deliveredAt);
  addOptional(outcome, "metadata", delivery.metadata);

  return outcome;
}

export function projectDeliveryState(delivery: DeliveryIntent): ScoutDeliveryState {
  switch (delivery.status) {
    case "accepted":
    case "pending":
      return "pending";
    case "leased":
      return "leased";
    case "peer_acked":
      return "dispatched_to_peer";
    case "sent":
    case "acknowledged":
    case "running":
    case "completed":
      return "sent";
    case "deferred":
      return "retrying";
    case "failed":
      return "dead_lettered";
    case "cancelled":
      return isSuppressedDelivery(delivery) ? "suppressed" : "cancelled";
    default:
      return "pending";
  }
}

export function isTerminalInvocationState(
  state: ScoutInvocationState,
): state is ScoutTerminalResult["state"] {
  return TERMINAL_INVOCATION_STATES.has(state);
}

function projectTerminalResult(input: {
  state: ScoutInvocationState;
  flight?: FlightRecord;
  now?: number;
}): ScoutTerminalResult | undefined {
  if (!isTerminalInvocationState(input.state)) {
    return undefined;
  }

  const state = input.state;
  const completedAt = input.flight?.completedAt ?? input.now;
  if (completedAt === undefined) {
    return undefined;
  }

  const terminal: ScoutTerminalResult = {
    state,
    completedAt,
  };

  addOptional(terminal, "summary", compactTerminalSummary(input.flight));
  addOptional(terminal, "errorClass", stringMetadata(input.flight?.metadata, "errorClass"));
  addOptional(terminal, "exitCode", numberMetadata(input.flight?.metadata, "exitCode"));
  addOptional(terminal, "sourceRecordId", input.flight?.id);
  addOptional(terminal, "metadata", terminalMetadata(input.flight));

  return terminal;
}

function compactTerminalSummary(flight: FlightRecord | undefined): string | undefined {
  const summary = flight?.state === "failed"
    ? flight.error ?? flight.summary
    : flight?.summary;
  if (!summary?.trim()) {
    return undefined;
  }
  const compacted = summary.replace(/\s+/g, " ").trim();
  return compacted.length <= MAX_TERMINAL_SUMMARY_LENGTH
    ? compacted
    : `${compacted.slice(0, MAX_TERMINAL_SUMMARY_LENGTH - 3).trimEnd()}...`;
}

function terminalMetadata(flight: FlightRecord | undefined): MetadataMap | undefined {
  if (!flight?.metadata) {
    return undefined;
  }
  const metadata: MetadataMap = {};
  addOptional(metadata, "failureStage", stringMetadata(flight.metadata, "failureStage"));
  addOptional(metadata, "failureReason", stringMetadata(flight.metadata, "failureReason"));
  addOptional(metadata, "cancelledBy", stringMetadata(flight.metadata, "cancelledBy"));
  addOptional(metadata, "expiredAt", numberMetadata(flight.metadata, "expiredAt"));
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function deliverySubject(delivery: DeliveryIntent): { kind: ScoutLifecycleSubjectKind; id: ScoutId } {
  const workId = stringMetadata(delivery.metadata, "workId")
    ?? stringMetadata(delivery.metadata, "collaborationRecordId");
  if (workId) {
    return { kind: "work_item", id: workId };
  }
  if (delivery.invocationId) {
    return { kind: "invocation", id: delivery.invocationId };
  }
  if (delivery.messageId) {
    return { kind: "message", id: delivery.messageId };
  }
  return { kind: "message", id: delivery.id };
}

function deliveredAtForDelivery(
  delivery: DeliveryIntent,
  attempts: DeliveryAttempt[],
): number | undefined {
  return numberMetadata(delivery.metadata, "deliveredAt")
    ?? numberMetadata(delivery.metadata, "peerAckedAt")
    ?? lastSuccessfulAttemptAt(attempts);
}

function lastSuccessfulAttemptAt(attempts: DeliveryAttempt[]): number | undefined {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt?.status === "acknowledged" || attempt?.status === "sent") {
      return attempt.createdAt;
    }
  }
  return undefined;
}

function deliveryError(
  delivery: DeliveryIntent,
  latestFailedAttempt: DeliveryAttempt | undefined,
): ScoutDeliveryError | undefined {
  const reason = stringMetadata(delivery.metadata, "failureReason");
  const detail = stringMetadata(delivery.metadata, "failureDetail")
    ?? stringMetadata(delivery.metadata, "lastError")
    ?? latestFailedAttempt?.error;
  const code = stringMetadata(delivery.metadata, "errorCode");
  const status = numberMetadata(delivery.metadata, "httpStatus");
  if (!reason && !detail && !code && status === undefined) {
    return undefined;
  }

  const error: ScoutDeliveryError = {};
  addOptional(error, "reason", reason);
  addOptional(error, "detail", detail);
  addOptional(error, "retryable", booleanMetadata(delivery.metadata, "retryable"));
  addOptional(error, "code", code);
  addOptional(error, "status", status);
  return error;
}

function isSuppressedDelivery(delivery: DeliveryIntent): boolean {
  return booleanMetadata(delivery.metadata, "suppressed")
    || booleanMetadata(delivery.metadata, "policySuppressed")
    || booleanMetadata(delivery.metadata, "suppressedByPolicy")
    || stringMetadata(delivery.metadata, "suppressionReason") !== undefined
    || stringMetadata(delivery.metadata, "failureReason") === "suppressed";
}

function peerNodeId(delivery: DeliveryIntent): ScoutId | undefined {
  return stringMetadata(delivery.metadata, "peerNodeId") ?? delivery.targetNodeId;
}

function dispatchAcknowledgedAt(metadata: MetadataMap | undefined): number | undefined {
  const dispatchAck = metadataObject(metadata, "dispatchAck");
  return numberMetadata(dispatchAck, "acknowledgedAt");
}

function lastProgressAt(
  flight: FlightRecord | undefined,
  deliveries: ScoutOutcomeDelivery[],
): number | undefined {
  const deliveryAt = deliveries
    .map((delivery) => delivery.lastAttemptAt ?? delivery.deliveredAt)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => right - left)[0];
  return Math.max(
    flight?.completedAt ?? 0,
    flight?.startedAt ?? 0,
    deliveryAt ?? 0,
  ) || undefined;
}

function lifecycleMetadata(
  invocation: InvocationRequest,
  flight: FlightRecord | undefined,
): MetadataMap | undefined {
  const metadata: MetadataMap = {};
  addOptional(metadata, "invocationMetadata", invocation.metadata);
  addOptional(metadata, "flightMetadata", flight?.metadata);
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function waitingOnFromMetadata(metadata: MetadataMap | undefined): ScoutWaitingOn | undefined {
  const waitingOn = metadataObject(metadata, "waitingOn");
  if (!waitingOn) {
    return undefined;
  }
  const kind = stringMetadata(waitingOn, "kind");
  const projected: ScoutWaitingOn = {
    kind: isWaitingOnKind(kind) ? kind : "unknown",
  };
  addOptional(projected, "label", stringMetadata(waitingOn, "label"));
  addOptional(projected, "targetId", stringMetadata(waitingOn, "targetId"));
  addOptional(projected, "metadata", metadataObject(waitingOn, "metadata"));
  return projected;
}

function isWaitingOnKind(value: string | undefined): value is ScoutWaitingOnKind {
  return value === "human"
    || value === "peer"
    || value === "approval"
    || value === "artifact"
    || value === "condition"
    || value === "agent"
    || value === "unknown";
}

function inferWorkId(invocation: InvocationRequest): ScoutId | undefined {
  return stringMetadata(invocation.metadata, "workId")
    ?? stringMetadata(invocation.context, "workId")
    ?? stringMetadata(metadataObject(invocation.context, "collaboration"), "recordId");
}

function expiresAtForInvocation(invocation: InvocationRequest): number | undefined {
  const metadataExpiresAt = numberMetadata(invocation.metadata, "expiresAt");
  if (metadataExpiresAt !== undefined) {
    return metadataExpiresAt;
  }
  return invocation.timeoutMs && Number.isFinite(invocation.timeoutMs)
    ? invocation.createdAt + invocation.timeoutMs
    : undefined;
}

function metadataObject<T extends MetadataMap = MetadataMap>(
  metadata: MetadataMap | undefined,
  key: string,
): T | undefined {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as T
    : undefined;
}

function stringMetadata(metadata: MetadataMap | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberMetadata(metadata: MetadataMap | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanMetadata(metadata: MetadataMap | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

function addOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
