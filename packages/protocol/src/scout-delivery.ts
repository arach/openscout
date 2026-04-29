import type { ConversationDefinition } from "./conversations.js";
import type { MetadataMap, ScoutId } from "./common.js";
import type { FlightRecord, InvocationExecutionPreference } from "./invocations.js";
import type { MessageRecord } from "./messages.js";
import type {
  ScoutCallerContext,
  ScoutDispatchRecord,
  ScoutRoutePolicy,
  ScoutRouteTarget,
} from "./scout-dispatch.js";

export type ScoutDeliverIntent = "tell" | "consult";

export type ScoutDeliverRouteKind = "dm" | "channel" | "broadcast";

export type ScoutDeliveryRemediationKind =
  | "choose_target"
  | "register_target"
  | "wake_target"
  | "retry_later";

export type ScoutDeliverRejectReason =
  | "unknown_target"
  | "ambiguous_target"
  | "invalid_target"
  | "missing_target";

export interface ScoutDeliverRequest {
  id?: ScoutId;
  caller?: ScoutCallerContext;
  requesterId?: ScoutId;
  requesterNodeId?: ScoutId;
  body: string;
  intent: ScoutDeliverIntent;
  target?: ScoutRouteTarget;
  targetLabel?: string;
  targetAgentId?: ScoutId;
  routePolicy?: ScoutRoutePolicy;
  channel?: string;
  replyToMessageId?: ScoutId;
  speechText?: string;
  ensureAwake?: boolean;
  execution?: InvocationExecutionPreference;
  createdAt?: number;
  collaborationRecordId?: ScoutId;
  messageMetadata?: MetadataMap;
  invocationMetadata?: MetadataMap;
}

export interface ScoutDeliveryReceipt {
  requestId: ScoutId;
  routeKind: ScoutDeliverRouteKind;
  requesterId: ScoutId;
  requesterNodeId: ScoutId;
  targetAgentId?: ScoutId;
  targetLabel?: string;
  conversationId: ScoutId;
  messageId: ScoutId;
  flightId?: ScoutId;
  acceptedAt: number;
}

export interface ScoutDeliveryRemediationAction {
  kind: ScoutDeliveryRemediationKind;
  detail: string;
  targetAgentId?: ScoutId;
  targetLabel?: string;
  dispatchId?: ScoutId;
}

export interface ScoutDeliverAcceptedResponse {
  kind: "delivery";
  accepted: true;
  routeKind: ScoutDeliverRouteKind;
  receipt: ScoutDeliveryReceipt;
  conversation: ConversationDefinition;
  message: MessageRecord;
  targetAgentId?: ScoutId;
  flight?: FlightRecord;
}

export interface ScoutDeliverQuestionResponse {
  kind: "question";
  accepted: false;
  question: ScoutDispatchRecord;
  remediation?: ScoutDeliveryRemediationAction;
}

export interface ScoutDeliverRejectedResponse {
  kind: "rejected";
  accepted: false;
  reason: ScoutDeliverRejectReason;
  rejection: ScoutDispatchRecord;
  remediation?: ScoutDeliveryRemediationAction;
}

export type ScoutDeliverResponse =
  | ScoutDeliverAcceptedResponse
  | ScoutDeliverQuestionResponse
  | ScoutDeliverRejectedResponse;
