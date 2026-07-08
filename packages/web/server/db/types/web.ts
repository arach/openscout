/**
 * Types served to the web UI by `db-queries.ts`.
 *
 * Mobile-specific shapes live in `./mobile.ts`; cross-surface shapes in
 * `./common.ts`. SQL helper types stay in `../internal/sql-helpers.ts`.
 */

import type { AgentRun } from "@openscout/protocol";

import type { AgentSummaryState, WorkAttention } from "./common.ts";

export type WebTerminalSurfaceDescriptor = {
  backend: "tmux" | "zellij";
  sessionName: string;
  paneId: string | null;
  socketDir: string | null;
};

export type WebAgent = {
  id: string;
  definitionId: string;
  name: string;
  handle: string | null;
  agentClass: string;
  harness: string | null;
  state: string | null;
  /** The pending question / approval / handoff text when state is needs_attention. */
  pendingAsk?: string | null;
  projectRoot: string | null;
  cwd: string | null;
  updatedAt: number | null;
  createdAt: number | null;
  transport: string | null;
  selector: string | null;
  defaultSelector: string | null;
  nodeQualifier: string | null;
  workspaceQualifier: string | null;
  wakePolicy: string | null;
  capabilities: string[];
  project: string | null;
  branch: string | null;
  role: string | null;
  model: string | null;
  harnessSessionId: string | null;
  terminalSurface: WebTerminalSurfaceDescriptor | null;
  harnessLogPath: string | null;
  conversationId: string | null;
  authorityNodeId: string | null;
  authorityNodeName: string | null;
  homeNodeId: string | null;
  homeNodeName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerHandle: string | null;
  staleLocalRegistration: boolean;
  retiredFromFleet: boolean;
  replacedByAgentId: string | null;
  providerName?: string | null;
  providerUrl?: string | null;
  protocol?: string | null;
  skills?: string[];
};

export type WebActivityItem = {
  id: string;
  kind: string;
  ts: number;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
  agentId: string | null;
  agentName: string | null;
  flightId: string | null;
  invocationId: string | null;
  sessionId: string | null;
  messageId: string | null;
  recordId: string | null;
};

export type WebMessage = {
  id: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  body: string;
  createdAt: number;
  class: string;
  metadata: Record<string, unknown> | null;
  replyToMessageId: string | null;
  threadConversationId: string | null;
  threadSummary?: {
    count: number;
    participants: string[];
    lastActiveAt: number;
  };
};

export type WebBrokerRouteAttempt = {
  id: string;
  kind: "success" | "failed_query" | "failed_delivery" | "delivery_attempt";
  status: string;
  ts: number;
  actorName: string | null;
  target: string | null;
  route: string | null;
  detail: string;
  conversationId: string | null;
  messageId: string | null;
  deliveryId: string | null;
  invocationId: string | null;
  metadata: Record<string, unknown> | null;
};

export type WebBrokerDialogueItem = {
  id: string;
  ts: number;
  actorName: string | null;
  conversationId: string;
  body: string;
  class: string;
};

export type WebBrokerHistoryKey = "attempts" | "failedQueries" | "failedDeliveries" | "dialogue";

export type WebBrokerDiagnostics = {
  generatedAt: number;
  windowMs: number;
  ledger: {
    mode: "latest";
    limit: number;
    cursor: string | null;
    cursors: Record<WebBrokerHistoryKey, string | null>;
    hasMore: Record<WebBrokerHistoryKey, boolean>;
  };
  totals: {
    successfulDispatches: number;
    failedQueries: number;
    failedDeliveries: number;
    deliveryAttempts: number;
    failedDeliveryAttempts: number;
    dialogueMessages: number;
  };
  rates: {
    messagesPerHour: number;
    failedQueriesPerHour: number;
    failedDeliveriesPerHour: number;
    failureRate: number;
  };
  attempts: WebBrokerRouteAttempt[];
  failedQueries: WebBrokerRouteAttempt[];
  failedDeliveries: WebBrokerRouteAttempt[];
  dialogue: WebBrokerDialogueItem[];
};

export type WebWorkItem = {
  id: string;
  title: string;
  summary: string | null;
  ownerId: string | null;
  ownerName: string | null;
  nextMoveOwnerId: string | null;
  nextMoveOwnerName: string | null;
  conversationId: string | null;
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  parentTitle: string | null;
  state: string;
  acceptanceState: string;
  priority: string | null;
  currentPhase: string;
  attention: WorkAttention;
  activeChildWorkCount: number;
  activeFlightCount: number;
  lastMeaningfulAt: number;
  lastMeaningfulSummary: string | null;
};

export type WebFlight = {
  id: string;
  invocationId: string;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  collaborationRecordId: string | null;
  state: string;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
  dispatchOutcome?: {
    status: string;
    reason: string | null;
    checkedAt: number | null;
  } | null;
};

export type WebWorkInvocation = {
  invocationId: string;
  flightId: string | null;
  action: string;
  task: string;
  source: string | null;
  requestedHarness: string | null;
  requestedModel: string | null;
  requestedPermissionProfile: string | null;
  targetSessionId: string | null;
  requesterId: string | null;
  requesterName: string | null;
  targetAgentId: string | null;
  targetAgentName: string | null;
  resolvedHarness: string | null;
  resolvedTransport: string | null;
  resolvedSessionId: string | null;
  conversationId: string | null;
  workId: string | null;
  state: string | null;
  summary: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type WebAgentRun = AgentRun & {
  agentName: string | null;
};

export type WebFollowTarget = {
  flightId: string | null;
  invocationId: string | null;
  conversationId: string | null;
  workId: string | null;
  sessionId: string | null;
  targetAgentId: string | null;
};

export type WebWorkTimelineKind =
  | "collaboration_event"
  | "flight_started"
  | "flight_completed"
  | "message";

export type WebWorkTimelineItem = {
  id: string;
  kind: WebWorkTimelineKind;
  at: number;
  actorId: string | null;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  /** Discriminator: event sub-kind, flight state, or message class. */
  detailKind: string | null;
  flightId: string | null;
  messageId: string | null;
  conversationId: string | null;
};

export type WebWorkDetail = WebWorkItem & {
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  parentTitle: string | null;
  childWork: WebWorkItem[];
  activeFlights: WebFlight[];
  timeline: WebWorkTimelineItem[];
  primaryInvocation: WebWorkInvocation | null;
  allFlights: WebFlight[];
};

export type WebFleetActivity = WebActivityItem & {
  actorId: string | null;
  agentId: string | null;
  flightId: string | null;
  invocationId: string | null;
  messageId: string | null;
  recordId: string | null;
  sessionId: string | null;
};

export type WebFleetAskStatus =
  | "queued"
  | "working"
  | "needs_attention"
  | "completed"
  | "failed";

export type WebFleetAsk = {
  invocationId: string;
  flightId: string | null;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  collaborationRecordId: string | null;
  task: string;
  status: WebFleetAskStatus;
  statusLabel: string;
  acknowledgedAt: number | null;
  attention: WorkAttention;
  agentState: AgentSummaryState;
  harness: string | null;
  transport: string | null;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
};

export type WebFleetAttentionItem = {
  kind: "work_item" | "question";
  recordId: string;
  title: string;
  summary: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  state: string;
  acceptanceState: string;
  updatedAt: number;
};

export type WebFleetState = {
  generatedAt: number;
  totals: {
    active: number;
    recentCompleted: number;
    needsAttention: number;
    activity: number;
  };
  activeAsks: WebFleetAsk[];
  recentCompleted: WebFleetAsk[];
  needsAttention: WebFleetAttentionItem[];
  activity: WebFleetActivity[];
};
