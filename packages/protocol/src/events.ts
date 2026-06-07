import type { ScoutId } from "./common.js";
import type { NodeDefinition } from "./mesh.js";
import type { ConversationBinding, ConversationDefinition } from "./conversations.js";
import type { DeliveryAttempt, DeliveryIntent } from "./deliveries.js";
import type { FlightRecord, InvocationRequest } from "./invocations.js";
import type { MessageRecord } from "./messages.js";
import type { ConversationReadCursor } from "./read-receipts.js";
import type { AgentDefinition, AgentEndpoint, ActorIdentity } from "./actors.js";
import type { CollaborationEvent, CollaborationRecord } from "./collaboration.js";
import type { UnblockRequestEvent, UnblockRequestRecord } from "./unblock-requests.js";
import type { ScoutDispatchRecord } from "./scout-dispatch.js";
import type { AssetRecord } from "./assets.js";

export interface ControlEventBase<K extends string, P> {
  id: ScoutId;
  kind: K;
  ts: number;
  actorId: ScoutId;
  nodeId?: ScoutId;
  payload: P;
}

export type NodeUpsertedEvent = ControlEventBase<"node.upserted", {
  node: NodeDefinition;
}>;

export type ActorRegisteredEvent = ControlEventBase<"actor.registered", {
  actor: ActorIdentity;
}>;

export type AgentRegisteredEvent = ControlEventBase<"agent.registered", {
  agent: AgentDefinition;
}>;

export type AgentEndpointUpsertedEvent = ControlEventBase<"agent.endpoint.upserted", {
  endpoint: AgentEndpoint;
}>;

export type AgentEndpointDeletedEvent = ControlEventBase<"agent.endpoint.deleted", {
  endpointId: string;
}>;

export type ConversationUpsertedEvent = ControlEventBase<"conversation.upserted", {
  conversation: ConversationDefinition;
}>;

export type BindingUpsertedEvent = ControlEventBase<"binding.upserted", {
  binding: ConversationBinding;
}>;

export type AssetRecordedEvent = ControlEventBase<"asset.recorded", {
  asset: AssetRecord;
}>;

export type MessagePostedEvent = ControlEventBase<"message.posted", {
  message: MessageRecord;
}>;

export type ConversationReadCursorUpdatedEvent = ControlEventBase<"conversation.read_cursor.updated", {
  cursor: ConversationReadCursor;
}>;

export type InvocationRequestedEvent = ControlEventBase<"invocation.requested", {
  invocation: InvocationRequest;
}>;

export type FlightUpdatedEvent = ControlEventBase<"flight.updated", {
  flight: FlightRecord;
}>;

export type DeliveryPlannedEvent = ControlEventBase<"delivery.planned", {
  delivery: DeliveryIntent;
}>;

export type DeliveryAttemptedEvent = ControlEventBase<"delivery.attempted", {
  attempt: DeliveryAttempt;
}>;

export type DeliveryStateChangedEvent = ControlEventBase<"delivery.state.changed", {
  delivery: DeliveryIntent;
  previousStatus?: DeliveryIntent["status"];
}>;

export type CollaborationUpsertedEvent = ControlEventBase<"collaboration.upserted", {
  record: CollaborationRecord;
}>;

export type CollaborationEventAppendedEvent = ControlEventBase<"collaboration.event.appended", {
  event: CollaborationEvent;
}>;

export type UnblockRequestUpsertedEvent = ControlEventBase<"unblock_request.upserted", {
  request: UnblockRequestRecord;
}>;

export type UnblockRequestEventAppendedEvent = ControlEventBase<"unblock_request.event.appended", {
  event: UnblockRequestEvent;
}>;

export type ScoutDispatchedEvent = ControlEventBase<"scout.dispatched", {
  dispatch: ScoutDispatchRecord;
}>;

export type ControlEvent =
  | NodeUpsertedEvent
  | ActorRegisteredEvent
  | AgentRegisteredEvent
  | AgentEndpointUpsertedEvent
  | AgentEndpointDeletedEvent
  | ConversationUpsertedEvent
  | BindingUpsertedEvent
  | AssetRecordedEvent
  | MessagePostedEvent
  | ConversationReadCursorUpdatedEvent
  | InvocationRequestedEvent
  | FlightUpdatedEvent
  | DeliveryPlannedEvent
  | DeliveryAttemptedEvent
  | DeliveryStateChangedEvent
  | CollaborationUpsertedEvent
  | CollaborationEventAppendedEvent
  | UnblockRequestUpsertedEvent
  | UnblockRequestEventAppendedEvent
  | ScoutDispatchedEvent;
