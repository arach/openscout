import type { AgentState, DeliveryTransport, MetadataMap, ScoutId } from "./common.js";
import type { DeliveryAttempt, DeliveryIntent } from "./deliveries.js";
import type { FlightRecord, InvocationRequest } from "./invocations.js";
import type { MessageRecord } from "./messages.js";
import type { ScoutDispatchRecord } from "./scout-dispatch.js";
import type { UnblockRequestRecord } from "./unblock-requests.js";

export type AgentBrokerFeedItemKind =
  | "message"
  | "status"
  | "invocation"
  | "flight"
  | "delivery"
  | "delivery_attempt"
  | "dispatch"
  | "unblock_request";

export type AgentBrokerFeedSeverity = "info" | "status" | "warning" | "error";

export type AgentBrokerFeedSource =
  | "activity"
  | "snapshot"
  | "delivery"
  | "dispatch"
  | "unblock_request";

export interface AgentBrokerFeedEndpointStatus {
  id: ScoutId;
  nodeId: ScoutId;
  harness: string;
  transport: DeliveryTransport | string;
  state: AgentState | string;
  sessionId?: string;
  projectRoot?: string;
  cwd?: string;
  lastError?: string;
  lastFailureStage?: string;
  updatedAt?: number;
}

export interface AgentBrokerFeedStatus {
  agentId: ScoutId;
  displayName?: string;
  found: boolean;
  agentState?: AgentState | string;
  endpoints: AgentBrokerFeedEndpointStatus[];
  activeFlightIds: ScoutId[];
  pendingDeliveryIds: ScoutId[];
  errorCount: number;
  warningCount: number;
  lastError?: string;
  lastActivityAt?: number;
}

export interface AgentBrokerFeedItem {
  id: string;
  kind: AgentBrokerFeedItemKind;
  severity: AgentBrokerFeedSeverity;
  at: number;
  title: string;
  summary: string;
  agentId?: ScoutId;
  actorId?: ScoutId;
  targetAgentId?: ScoutId;
  conversationId?: ScoutId;
  messageId?: ScoutId;
  invocationId?: ScoutId;
  flightId?: ScoutId;
  deliveryId?: ScoutId;
  dispatchId?: ScoutId;
  unblockRequestId?: ScoutId;
  status?: string;
  reason?: string;
  source: AgentBrokerFeedSource;
  message?: MessageRecord;
  invocation?: InvocationRequest;
  flight?: FlightRecord;
  delivery?: DeliveryIntent;
  deliveryAttempt?: DeliveryAttempt;
  dispatch?: ScoutDispatchRecord;
  unblockRequest?: UnblockRequestRecord;
  metadata?: MetadataMap;
}

export interface AgentBrokerFeedCounts {
  items: number;
  messages: number;
  statuses: number;
  invocations: number;
  flights: number;
  deliveries: number;
  deliveryAttempts: number;
  dispatches: number;
  unblockRequests: number;
  errors: number;
  warnings: number;
}

export interface AgentBrokerFeed {
  agentId: ScoutId;
  generatedAt: number;
  since: number | null;
  limit: number;
  cursor: number | null;
  status: AgentBrokerFeedStatus;
  counts: AgentBrokerFeedCounts;
  items: AgentBrokerFeedItem[];
}
