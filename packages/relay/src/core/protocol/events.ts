import type { ProjectTwinRecord } from "./twins.js";

export type RelayMessageType = "MSG" | "SYS";
export type RelayMessageClass = "agent" | "log" | "system" | "status";

export interface RelaySpeechInstruction {
  text: string;
}

export interface RelayEventBase<K extends string, P> {
  id: string;
  kind: K;
  v: 1;
  ts: number;
  actor: string;
  payload: P;
}

export interface RelayStoredMessage {
  id: string;
  ts: number;
  from: string;
  type: RelayMessageType;
  body: string;
  class?: RelayMessageClass;
  speech?: RelaySpeechInstruction;
  tags?: string[];
  to?: string[];
  channel?: string;
}

export type RelayMessagePostedEvent = RelayEventBase<"message.posted", {
  type: RelayMessageType;
  body: string;
  class?: RelayMessageClass;
  speech?: RelaySpeechInstruction;
  tags?: string[];
  to?: string[];
  channel?: string;
}>;

export type RelayAgentStateSetEvent = RelayEventBase<"agent.state_set", {
  state?: string | null;
}>;

export type RelayAgentSessionRegisteredEvent = RelayEventBase<"agent.session_registered", {
  pane?: string;
  cwd: string;
  project: string;
  sessionId?: string;
  registeredAt: number;
}>;

export type RelayAgentSessionClearedEvent = RelayEventBase<"agent.session_cleared", {
}>;

export type RelayProjectTwinStartedEvent = RelayEventBase<"project_twin.started", {
  record: ProjectTwinRecord;
}>;

export type RelayProjectTwinStoppedEvent = RelayEventBase<"project_twin.stopped", {
  twinId: string;
}>;

export type RelayFlightOpenedEvent = RelayEventBase<"flight.opened", {
  flightId: string;
  to: string;
  message: string;
}>;

export type RelayChannelBindingUpsertedEvent = RelayEventBase<"channel.binding.upserted", {
  bindingId: string;
  platform: string;
  externalChannelId: string;
  externalThreadId?: string;
  conversationId: string;
  mode: "inbound" | "outbound" | "bidirectional";
  metadata?: Record<string, unknown>;
}>;

export type RelayExternalDeliveryRequestedEvent = RelayEventBase<"external.delivery.requested", {
  deliveryId: string;
  bindingId: string;
  conversationId: string;
  text: string;
  replyToEventId?: string;
}>;

export type RelayExternalDeliveryCompletedEvent = RelayEventBase<"external.delivery.completed", {
  deliveryId: string;
  bindingId: string;
  externalMessageId?: string;
}>;

export type RelayEvent =
  | RelayMessagePostedEvent
  | RelayAgentStateSetEvent
  | RelayAgentSessionRegisteredEvent
  | RelayAgentSessionClearedEvent
  | RelayProjectTwinStartedEvent
  | RelayProjectTwinStoppedEvent
  | RelayFlightOpenedEvent
  | RelayChannelBindingUpsertedEvent
  | RelayExternalDeliveryRequestedEvent
  | RelayExternalDeliveryCompletedEvent;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRelayMessageClass(value: unknown): value is RelayMessageClass {
  return value === "agent" || value === "log" || value === "system" || value === "status";
}

function isRelaySpeechInstruction(value: unknown): value is RelaySpeechInstruction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelaySpeechInstruction>;
  return typeof candidate.text === "string";
}

function isProjectTwinRecord(value: unknown): value is ProjectTwinRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectTwinRecord>;

  return (
    typeof candidate.twinId === "string" &&
    candidate.kind === "project" &&
    typeof candidate.runtime === "string" &&
    candidate.protocol === "relay" &&
    typeof candidate.harness === "string" &&
    typeof candidate.sessionAdapter === "string" &&
    typeof candidate.agentEngine === "string" &&
    typeof candidate.project === "string" &&
    typeof candidate.projectRoot === "string" &&
    typeof candidate.tmuxSession === "string" &&
    typeof candidate.cwd === "string" &&
    typeof candidate.startedAt === "number"
  );
}

export function isRelayMessagePostedEvent(value: unknown): value is RelayMessagePostedEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayMessagePostedEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "message.posted" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    (candidate.payload.type === "MSG" || candidate.payload.type === "SYS") &&
    typeof candidate.payload.body === "string" &&
    (candidate.payload.class === undefined || isRelayMessageClass(candidate.payload.class)) &&
    (candidate.payload.speech === undefined || isRelaySpeechInstruction(candidate.payload.speech)) &&
    (candidate.payload.tags === undefined || isStringArray(candidate.payload.tags)) &&
    (candidate.payload.to === undefined || isStringArray(candidate.payload.to)) &&
    (candidate.payload.channel === undefined || typeof candidate.payload.channel === "string")
  );
}

export function isRelayAgentStateSetEvent(value: unknown): value is RelayAgentStateSetEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayAgentStateSetEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "agent.state_set" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    (
      candidate.payload.state === undefined ||
      candidate.payload.state === null ||
      typeof candidate.payload.state === "string"
    )
  );
}

export function isRelayAgentSessionRegisteredEvent(value: unknown): value is RelayAgentSessionRegisteredEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayAgentSessionRegisteredEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "agent.session_registered" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    (candidate.payload.pane === undefined || typeof candidate.payload.pane === "string") &&
    typeof candidate.payload.cwd === "string" &&
    typeof candidate.payload.project === "string" &&
    (candidate.payload.sessionId === undefined || typeof candidate.payload.sessionId === "string") &&
    typeof candidate.payload.registeredAt === "number"
  );
}

export function isRelayAgentSessionClearedEvent(value: unknown): value is RelayAgentSessionClearedEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayAgentSessionClearedEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "agent.session_cleared" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object"
  );
}

export function isRelayProjectTwinStartedEvent(value: unknown): value is RelayProjectTwinStartedEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayProjectTwinStartedEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "project_twin.started" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    isProjectTwinRecord(candidate.payload.record)
  );
}

export function isRelayProjectTwinStoppedEvent(value: unknown): value is RelayProjectTwinStoppedEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayProjectTwinStoppedEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "project_twin.stopped" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    typeof candidate.payload.twinId === "string"
  );
}

export function isRelayFlightOpenedEvent(value: unknown): value is RelayFlightOpenedEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayFlightOpenedEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "flight.opened" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    typeof candidate.payload.flightId === "string" &&
    typeof candidate.payload.to === "string" &&
    typeof candidate.payload.message === "string"
  );
}

export function isRelayChannelBindingUpsertedEvent(value: unknown): value is RelayChannelBindingUpsertedEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayChannelBindingUpsertedEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "channel.binding.upserted" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    typeof candidate.payload.bindingId === "string" &&
    typeof candidate.payload.platform === "string" &&
    typeof candidate.payload.externalChannelId === "string" &&
    typeof candidate.payload.conversationId === "string" &&
    (
      candidate.payload.mode === "inbound" ||
      candidate.payload.mode === "outbound" ||
      candidate.payload.mode === "bidirectional"
    )
  );
}

export function isRelayExternalDeliveryRequestedEvent(value: unknown): value is RelayExternalDeliveryRequestedEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayExternalDeliveryRequestedEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "external.delivery.requested" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    typeof candidate.payload.deliveryId === "string" &&
    typeof candidate.payload.bindingId === "string" &&
    typeof candidate.payload.conversationId === "string" &&
    typeof candidate.payload.text === "string"
  );
}

export function isRelayExternalDeliveryCompletedEvent(value: unknown): value is RelayExternalDeliveryCompletedEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayExternalDeliveryCompletedEvent>;

  return (
    typeof candidate.id === "string" &&
    candidate.kind === "external.delivery.completed" &&
    candidate.v === 1 &&
    typeof candidate.ts === "number" &&
    typeof candidate.actor === "string" &&
    !!candidate.payload &&
    typeof candidate.payload === "object" &&
    typeof candidate.payload.deliveryId === "string" &&
    typeof candidate.payload.bindingId === "string"
  );
}

export function isRelayEvent(value: unknown): value is RelayEvent {
  return (
    isRelayMessagePostedEvent(value) ||
    isRelayAgentStateSetEvent(value) ||
    isRelayAgentSessionRegisteredEvent(value) ||
    isRelayAgentSessionClearedEvent(value) ||
    isRelayProjectTwinStartedEvent(value) ||
    isRelayProjectTwinStoppedEvent(value) ||
    isRelayFlightOpenedEvent(value) ||
    isRelayChannelBindingUpsertedEvent(value) ||
    isRelayExternalDeliveryRequestedEvent(value) ||
    isRelayExternalDeliveryCompletedEvent(value)
  );
}

export function isRelayStoredMessage(value: unknown): value is RelayStoredMessage {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<RelayStoredMessage>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.ts === "number" &&
    typeof candidate.from === "string" &&
    (candidate.type === "MSG" || candidate.type === "SYS") &&
    typeof candidate.body === "string" &&
    (candidate.class === undefined || isRelayMessageClass(candidate.class)) &&
    (candidate.speech === undefined || isRelaySpeechInstruction(candidate.speech))
  );
}

export function relayEventToStoredMessage(event: RelayEvent): RelayStoredMessage | null {
  if (event.kind !== "message.posted") {
    return null;
  }

  return {
    id: event.id,
    ts: event.ts,
    from: event.actor,
    type: event.payload.type,
    body: event.payload.body,
    class: event.payload.class,
    speech: event.payload.speech,
    tags: event.payload.tags,
    to: event.payload.to,
    channel: event.payload.channel,
  };
}

export function relayStoredMessageToEvent(message: RelayStoredMessage): RelayMessagePostedEvent {
  return {
    id: message.id,
    kind: "message.posted",
    v: 1,
    ts: message.ts,
    actor: message.from,
    payload: {
      type: message.type,
      body: message.body,
      class: message.class,
      speech: message.speech,
      tags: message.tags,
      to: message.to,
      channel: message.channel,
    },
  };
}
