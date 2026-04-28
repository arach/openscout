import type { ConversationDefinition } from "./conversations.js";
import type { MetadataMap, ScoutId } from "./common.js";
import type { FlightRecord, InvocationExecutionPreference } from "./invocations.js";
import type { MessageRecord } from "./messages.js";
import type { ScoutDispatchRecord } from "./scout-dispatch.js";

export type ScoutDeliverIntent = "tell" | "consult";

export type ScoutDeliverRouteKind = "dm" | "channel" | "broadcast";

export type ScoutDeliverRejectReason =
  | "unknown_target"
  | "ambiguous_target"
  | "invalid_target"
  | "missing_target";

export interface ScoutDeliverRequest {
  id: ScoutId;
  requesterId: ScoutId;
  requesterNodeId: ScoutId;
  body: string;
  intent: ScoutDeliverIntent;
  targetLabel?: string;
  targetAgentId?: ScoutId;
  channel?: string;
  replyToMessageId?: ScoutId;
  speechText?: string;
  ensureAwake?: boolean;
  execution?: InvocationExecutionPreference;
  createdAt: number;
  collaborationRecordId?: ScoutId;
  messageMetadata?: MetadataMap;
  invocationMetadata?: MetadataMap;
}

export interface ScoutDeliverAcceptedResponse {
  kind: "delivery";
  accepted: true;
  routeKind: ScoutDeliverRouteKind;
  conversation: ConversationDefinition;
  message: MessageRecord;
  targetAgentId?: ScoutId;
  flight?: FlightRecord;
}

export interface ScoutDeliverQuestionResponse {
  kind: "question";
  accepted: false;
  question: ScoutDispatchRecord;
}

export interface ScoutDeliverRejectedResponse {
  kind: "rejected";
  accepted: false;
  reason: ScoutDeliverRejectReason;
  rejection: ScoutDispatchRecord;
}

export type ScoutDeliverResponse =
  | ScoutDeliverAcceptedResponse
  | ScoutDeliverQuestionResponse
  | ScoutDeliverRejectedResponse;
