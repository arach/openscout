import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  BUILT_IN_AGENT_DEFINITION_IDS,
  diagnoseAgentIdentity,
  formatMinimalAgentIdentity,
  parseAgentIdentity,
  type AgentIdentityCandidate,
  type AgentState,
  type ScoutAgentCard,
  type ScoutReplyContext,
} from "@openscout/protocol";
import {
  findNearestProjectRoot,
  loadResolvedRelayAgents,
  type ResolvedRelayAgentConfig,
} from "@openscout/runtime/setup";
import { resolveHost, resolveWebPort } from "@openscout/runtime/local-config";
import * as z from "zod/v4";

import {
  createScoutAgentCard,
  upScoutAgent,
  type ScoutAgentStatus,
} from "../agents/service.ts";
import {
  askScoutAgentById,
  askScoutQuestion,
  askScoutSessionById,
  attachScoutManagedLocalSession,
  listScoutAgents,
  loadScoutFlight,
  loadScoutInvocationLifecycle,
  loadScoutBrokerContext,
  loadScoutMessages,
  readScoutBrokerFeed,
  readScoutLabelFeed,
  readScoutLabelBrief,
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
  sendScoutMessage,
  sendScoutMessageToAgentIds,
  replyToScoutMessage,
  type ScoutManagedLocalSessionAttachment,
  updateScoutWorkItem,
  waitForScoutFlight,
  type ScoutAskByIdResult,
  type ScoutAskResult,
  type ScoutAgentBrokerFeed,
  type ScoutFlightRecord,
  type ScoutInvocationLifecycleRecord,
  type ScoutLabelBrief,
  type ScoutLabelFeed,
  type ScoutBrokerMessageRecord,
  type ScoutMessagePostResult,
  type ScoutReplyPostResult,
  type ScoutTrackedWorkItem,
  type ScoutWorkItemUpdate,
  type ScoutWorkItemInput,
  type ScoutStructuredMessagePostResult,
  type ScoutWhoEntry,
} from "../broker/service.ts";
import {
  scoutAskHandler as defaultScoutAskHandler,
  type ScoutAskHandler,
} from "../broker/ask.ts";
import type {
  ScoutAskReceipt,
} from "../broker/ask-types.ts";
import { SCOUT_APP_VERSION } from "../../shared/product.ts";

const AGENT_STATE_VALUES = [
  "offline",
  "idle",
  "active",
  "waiting",
  "discovered",
] as const;
const REGISTRATION_KIND_VALUES = [
  "broker",
  "configured",
  "discovered",
] as const;
const RESOLVE_KIND_VALUES = ["resolved", "ambiguous", "unresolved"] as const;
const MESSAGE_ROUTE_KIND_VALUES = ["dm", "channel", "broadcast"] as const;
const MESSAGE_ROUTING_ERROR_VALUES = [
  "missing_destination",
  "multi_target_requires_explicit_channel",
] as const;
const REPLY_MODE_VALUES = ["none", "inline", "notify"] as const;
const REPLY_DELIVERY_VALUES = ["none", "inline", "mcp_notification"] as const;
const LOCAL_AGENT_HARNESS_VALUES = ["claude", "codex", "pi"] as const;
const DEFAULT_ASK_ACK_TIMEOUT_SECONDS = 30;
export const SCOUT_MCP_UI_META_KEY = "openscout/ui";

type SearchableAgentState = (typeof AGENT_STATE_VALUES)[number];
type SearchRegistrationKind = (typeof REGISTRATION_KIND_VALUES)[number];

type ScoutMcpToolIconMeta = {
  kind: "semantic";
  name: "agent";
  fallbackGlyph: "@";
};

type ScoutMcpAgentAvatarMeta = {
  kind: "agent-avatar";
  monogramField: "displayName";
  fallbackField: "handle";
  colorSeedField: "agentId";
  fallbackGlyph: "@";
};

export type ScoutMcpAgentPickerFieldMeta = {
  kind: "agent-picker";
  selection: "single" | "multiple";
  sourceTool: "agents_search";
  resolveTool?: "agents_resolve";
  sourceArguments: {
    query: { from: "value" };
    currentDirectory: { fromToolArgument: "currentDirectory" };
  };
  resultPath: ["structuredContent", "candidates"];
  valueField: "label" | "agentId" | "sessionId";
  labelField: "label";
  descriptionField: "displayName";
  badgeFields: ["harness", "model", "workspace", "node"];
  icon: ScoutMcpAgentAvatarMeta;
  search: {
    minQueryLength: 0;
    debounceMs: 100;
    cacheBy: ["currentDirectory"];
  };
};

export type ScoutMcpToolUiMeta = {
  icon: ScoutMcpToolIconMeta;
  fields?: Record<string, ScoutMcpAgentPickerFieldMeta>;
};

type ScoutMcpReplyMode = (typeof REPLY_MODE_VALUES)[number];

type ScoutFollowPreferredView = "tail" | "session" | "chat" | "work";

type ScoutFollowIds = {
  flightId: string | null;
  invocationId: string | null;
  conversationId: string | null;
  workId: string | null;
  sessionId?: string | null;
  targetAgentId: string | null;
};

type ScoutFollowLinks = {
  follow: string | null;
  tail: string | null;
  session: string | null;
  chat: string | null;
  work: string | null;
  agent: string | null;
};

type ScoutReplyNotificationParams = {
  status: "completed" | "failed";
  currentDirectory: string;
  senderId: string;
  targetAgentId: string | null;
  targetLabel: string | null;
  conversationId: string | null;
  messageId: string | null;
  bindingRef?: string | null;
  flightId: string;
  flight: ScoutFlightRecord | null;
  output: string | null;
  error: string | null;
  workItem: ScoutTrackedWorkItem | null;
  workId: string | null;
  workUrl: string | null;
  ids?: ScoutFollowIds;
  links?: ScoutFollowLinks;
  followUrl?: string | null;
};

const scoutAgentToolIconMeta: ScoutMcpToolIconMeta = {
  kind: "semantic",
  name: "agent",
  fallbackGlyph: "@",
};

const scoutAgentAvatarMeta: ScoutMcpAgentAvatarMeta = {
  kind: "agent-avatar",
  monogramField: "displayName",
  fallbackField: "handle",
  colorSeedField: "agentId",
  fallbackGlyph: "@",
};

// Host UIs can use this private extension to power live agent pickers until
// MCP standardizes dynamic completion directly on tool arguments.
function createAgentPickerFieldMeta(input: {
  selection: "single" | "multiple";
  valueField: "label" | "agentId" | "sessionId";
  resolveTool?: "agents_resolve";
}): ScoutMcpAgentPickerFieldMeta {
  return {
    kind: "agent-picker",
    selection: input.selection,
    sourceTool: "agents_search",
    resolveTool: input.resolveTool,
    sourceArguments: {
      query: { from: "value" },
      currentDirectory: { fromToolArgument: "currentDirectory" },
    },
    resultPath: ["structuredContent", "candidates"],
    valueField: input.valueField,
    labelField: "label",
    descriptionField: "displayName",
    badgeFields: ["harness", "model", "workspace", "node"],
    icon: scoutAgentAvatarMeta,
    search: {
      minQueryLength: 0,
      debounceMs: 100,
      cacheBy: ["currentDirectory"],
    },
  };
}

function createToolUiMeta(fields?: Record<string, ScoutMcpAgentPickerFieldMeta>) {
  const value: ScoutMcpToolUiMeta = {
    icon: scoutAgentToolIconMeta,
  };
  if (fields && Object.keys(fields).length > 0) {
    value.fields = fields;
  }
  return {
    [SCOUT_MCP_UI_META_KEY]: value,
  } satisfies Record<string, unknown>;
}

function hasExplicitAgentSender(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.OPENSCOUT_AGENT?.trim());
}

async function resolveMcpSenderId(
  deps: Pick<ScoutMcpDependencies, "resolveSenderId">,
  senderId: string | null | undefined,
  currentDirectory: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return deps.resolveSenderId(
    senderId ?? (hasExplicitAgentSender(env) ? undefined : "operator"),
    currentDirectory,
    env,
  );
}

const targetLabelInputSchema = z
  .string()
  .describe("Scout agent handle to contact, such as @talkie or @talkie#codex?5.5")
  .optional();

const targetAgentIdInputSchema = z
  .string()
  .describe("Exact Scout agent id when already known, such as talkie.master.mini")
  .optional();

const targetSessionIdInputSchema = z
  .string()
  .describe("Exact Scout session id to continue, such as a CODEX_THREAD_ID or attached runtime session id")
  .optional();

const mentionAgentIdsInputSchema = z
  .array(z.string())
  .describe("Exact Scout agent ids to target directly when you already know them")
  .optional();

export type ScoutMcpAgentCandidate = {
  agentId: string;
  label: string;
  defaultLabel: string | null;
  displayName: string;
  handle: string | null;
  selector: string | null;
  defaultSelector: string | null;
  state: SearchableAgentState;
  registrationKind: SearchRegistrationKind;
  routable: boolean;
  harness: string | null;
  model: string | null;
  workspace: string | null;
  node: string | null;
  projectRoot: string | null;
  transport: string | null;
  sessionId?: string | null;
};

export type ScoutMcpResolveResult = {
  kind: (typeof RESOLVE_KIND_VALUES)[number];
  candidate: ScoutMcpAgentCandidate | null;
  candidates: ScoutMcpAgentCandidate[];
};

type InternalAgentDirectoryEntry = {
  agentId: string;
  definitionId: string;
  displayName: string;
  handle: string | null;
  selector: string | null;
  defaultSelector: string | null;
  state: SearchableAgentState;
  registrationKind: SearchRegistrationKind;
  routable: boolean;
  harness: string | null;
  model: string | null;
  workspace: string | null;
  node: string | null;
  projectRoot: string | null;
  transport: string | null;
  sessionId: string | null;
};

type ScoutMcpDependencies = {
  resolveSenderId: (
    senderId: string | null | undefined,
    currentDirectory: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<string>;
  resolveBrokerUrl: () => string;
  loadMessages: (input: {
    channel?: string;
    conversationId?: string;
    participantId?: string;
    inboxOnly?: boolean;
    since?: number;
    limit?: number;
    baseUrl?: string;
  }) => Promise<ScoutBrokerMessageRecord[]>;
  readBrokerFeed: (input: {
    agentId: string;
    since?: number | null;
    limit?: number;
    includeAcknowledged?: boolean;
    baseUrl?: string;
  }) => Promise<ScoutAgentBrokerFeed | null>;
  searchAgents: (input: {
    query?: string;
    currentDirectory: string;
    limit?: number;
  }) => Promise<ScoutMcpAgentCandidate[]>;
  resolveAgent: (input: {
    label: string;
    currentDirectory: string;
  }) => Promise<ScoutMcpResolveResult>;
  createAgentCard: (input: {
    projectPath: string;
    agentName?: string;
    displayName?: string;
    harness?: (typeof LOCAL_AGENT_HARNESS_VALUES)[number];
    model?: string;
    reasoningEffort?: string;
    permissionProfile?: string;
    currentDirectory: string;
    createdById?: string;
    oneTimeUse?: boolean;
    ttlMs?: number;
  }) => Promise<ScoutAgentCard>;
  startAgent: (input: {
    projectPath: string;
    agentName?: string;
    harness?: (typeof LOCAL_AGENT_HARNESS_VALUES)[number];
    model?: string;
    reasoningEffort?: string;
    permissionProfile?: string;
    currentDirectory: string;
  }) => Promise<ScoutAgentStatus>;
  attachCurrentLocalSession: (input: {
    externalSessionId: string;
    transport: "codex_app_server";
    currentDirectory: string;
    projectRoot?: string;
    agentId?: string;
    alias?: string;
    displayName?: string;
  }) => Promise<ScoutManagedLocalSessionAttachment>;
  sendMessage: (input: {
    senderId: string;
    body: string;
    targetLabel?: string;
    channel?: string;
    shouldSpeak?: boolean;
    currentDirectory: string;
    source?: string;
    wake?: boolean;
  }) => Promise<ScoutMessagePostResult>;
  sendMessageToAgentIds: (input: {
    senderId: string;
    body: string;
    targetAgentIds: string[];
    channel?: string;
    shouldSpeak?: boolean;
    currentDirectory: string;
    source?: string;
  }) => Promise<ScoutStructuredMessagePostResult>;
  replyMessage: (input: {
    senderId: string;
    body: string;
    conversationId: string;
    replyToMessageId: string;
    shouldSpeak?: boolean;
    currentDirectory: string;
    source?: string;
  }) => Promise<ScoutReplyPostResult>;
  scoutAskHandler: ScoutAskHandler;
  askQuestion: (input: {
    senderId: string;
    targetLabel: string;
    body: string;
    workItem?: ScoutWorkItemInput;
    channel?: string;
    shouldSpeak?: boolean;
    labels?: string[];
    replyToSessionId?: string;
    currentDirectory: string;
    source?: string;
  }) => Promise<ScoutAskResult>;
  askAgentById: (input: {
    senderId: string;
    targetAgentId: string;
    body: string;
    workItem?: ScoutWorkItemInput;
    channel?: string;
    shouldSpeak?: boolean;
    labels?: string[];
    replyToSessionId?: string;
    currentDirectory: string;
    source?: string;
  }) => Promise<ScoutAskByIdResult>;
  askSessionById: (input: {
    senderId: string;
    targetSessionId: string;
    body: string;
    workItem?: ScoutWorkItemInput;
    channel?: string;
    shouldSpeak?: boolean;
    labels?: string[];
    replyToSessionId?: string;
    currentDirectory: string;
    source?: string;
  }) => Promise<ScoutAskByIdResult>;
  updateWorkItem: (
    input: ScoutWorkItemUpdate,
  ) => Promise<ScoutTrackedWorkItem | null>;
  waitForFlight: (
    baseUrl: string,
    flightId: string,
    options?: {
      timeoutSeconds?: number;
      onUpdate?: (flight: ScoutFlightRecord, detail: string) => void;
    },
  ) => Promise<ScoutFlightRecord>;
  getFlight: (
    baseUrl: string,
    flightId: string,
  ) => Promise<ScoutFlightRecord | null>;
  getInvocationLifecycle?: (
    baseUrl: string,
    invocationId: string,
  ) => Promise<ScoutInvocationLifecycleRecord | null>;
  readLabelBrief: (
    label: string,
    baseUrl: string,
  ) => Promise<ScoutLabelBrief | null>;
  readLabelFeed: (
    label: string,
    baseUrl: string,
    options?: { since?: number | null; limit?: number | null },
  ) => Promise<ScoutLabelFeed | null>;
};

const flightSchema = z.object({
  id: z.string(),
  invocationId: z.string(),
  requesterId: z.string(),
  targetAgentId: z.string(),
  state: z.string(),
  summary: z.string().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  labels: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const invocationLifecycleSchema = z.object({
  invocationId: z.string(),
  flightId: z.string().optional(),
  state: z.string(),
  targetAgentId: z.string().optional(),
  targetEndpointId: z.string().optional(),
  peerNodeId: z.string().optional(),
  peerFlightId: z.string().optional(),
  workId: z.string().optional(),
  actionId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  acknowledgedAt: z.number().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  expiresAt: z.number().optional(),
  lastProgressAt: z.number().optional(),
  terminal: z.object({}).catchall(z.unknown()).optional(),
  deliveries: z.array(z.object({}).catchall(z.unknown())).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).catchall(z.unknown());

const labelBriefFlightSchema = z.object({
  id: z.string(),
  invocationId: z.string(),
  state: z.string(),
  requesterId: z.string(),
  targetAgentId: z.string(),
  summary: z.string().nullable(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  labels: z.array(z.string()),
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
  workId: z.string().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  lastActivityAt: z.number().nullable(),
});

const labelBriefWorkItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: z.string(),
  ownerId: z.string().nullable(),
  nextMoveOwnerId: z.string().nullable(),
  summary: z.string().nullable(),
  labels: z.array(z.string()),
  updatedAt: z.number(),
});

const labelBriefSchema = z.object({
  label: z.string(),
  generatedAt: z.number(),
  lastActivityAt: z.number().nullable(),
  participants: z.array(z.string()),
  counts: z.object({
    flights: z.number(),
    activeFlights: z.number(),
    workItems: z.number(),
  }),
  flightsByState: z.record(z.string(), z.number()),
  activeFlights: z.array(labelBriefFlightSchema),
  recentFlights: z.array(labelBriefFlightSchema),
  workItems: z.array(labelBriefWorkItemSchema),
});

const labelFeedEventSchema = z.object({
  id: z.string(),
  label: z.string(),
  at: z.number(),
  kind: z.enum([
    "message",
    "invocation_created",
    "flight_started",
    "flight_state",
    "flight_completed",
    "flight_failed",
    "flight_cancelled",
    "work_event",
    "work_snapshot",
  ]),
  category: z.enum(["message", "invocation", "flight", "work"]),
  actorId: z.string().nullable(),
  targetAgentId: z.string().nullable(),
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
  invocationId: z.string().nullable(),
  flightId: z.string().nullable(),
  workId: z.string().nullable(),
  state: z.string().nullable(),
  eventKind: z.string().nullable(),
  summary: z.string(),
  labels: z.array(z.string()),
});

const labelFeedSchema = z.object({
  label: z.string(),
  generatedAt: z.number(),
  cursor: z.string().nullable(),
  since: z.number().nullable(),
  counts: z.object({
    events: z.number(),
    messages: z.number(),
    invocations: z.number(),
    flights: z.number(),
    workEvents: z.number(),
  }),
  events: z.array(labelFeedEventSchema),
});

const trackedWorkItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  state: z.enum(["open", "working", "waiting", "review", "done", "cancelled"]),
  acceptanceState: z.enum(["none", "pending", "accepted", "reopened"]),
  ownerId: z.string().nullable(),
  nextMoveOwnerId: z.string().nullable(),
  conversationId: z.string().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).nullable(),
});

const workItemInputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  labels: z.array(z.string()).optional(),
  parentId: z.string().optional(),
  acceptanceState: z
    .enum(["none", "pending", "accepted", "reopened"])
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const waitingOnSchema = z.object({
  kind: z.enum([
    "actor",
    "question",
    "work_item",
    "approval",
    "artifact",
    "condition",
  ]),
  label: z.string().min(1),
  targetId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const progressSchema = z.object({
  completedSteps: z.number().optional(),
  totalSteps: z.number().optional(),
  checkpoint: z.string().optional(),
  summary: z.string().optional(),
  percent: z.number().optional(),
});

const workItemUpdateSchema = z.object({
  workId: z.string().min(1),
  title: z.string().optional(),
  summary: z.string().nullable().optional(),
  state: z
    .enum(["open", "working", "waiting", "review", "done", "cancelled"])
    .optional(),
  acceptanceState: z
    .enum(["none", "pending", "accepted", "reopened"])
    .optional(),
  ownerId: z.string().nullable().optional(),
  nextMoveOwnerId: z.string().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).nullable().optional(),
  labels: z.array(z.string()).optional(),
  waitingOn: waitingOnSchema.nullable().optional(),
  progress: progressSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  eventSummary: z.string().optional(),
});

const agentCandidateSchema = z.object({
  agentId: z.string(),
  label: z.string(),
  defaultLabel: z.string().nullable(),
  displayName: z.string(),
  handle: z.string().nullable(),
  selector: z.string().nullable(),
  defaultSelector: z.string().nullable(),
  state: z.enum(AGENT_STATE_VALUES),
  registrationKind: z.enum(REGISTRATION_KIND_VALUES),
  routable: z.boolean(),
  harness: z.string().nullable(),
  model: z.string().nullable(),
  workspace: z.string().nullable(),
  node: z.string().nullable(),
  projectRoot: z.string().nullable(),
  transport: z.string().nullable(),
  sessionId: z.string().nullable().optional(),
});

const scoutReturnAddressSchema = z.object({
  actorId: z.string(),
  handle: z.string(),
  displayName: z.string().optional(),
  selector: z.string().optional(),
  defaultSelector: z.string().optional(),
  conversationId: z.string().optional(),
  replyToMessageId: z.string().optional(),
  nodeId: z.string().optional(),
  projectRoot: z.string().optional(),
  sessionId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const scoutAgentCardLifecycleSchema = z.object({
  kind: z.enum(["persistent", "one_time"]),
  createdAt: z.number().optional(),
  createdById: z.string().optional(),
  expiresAt: z.number().optional(),
  maxUses: z.number().optional(),
  inboxConversationId: z.string().optional(),
});

const scoutAgentCardSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  definitionId: z.string(),
  displayName: z.string(),
  handle: z.string(),
  selector: z.string().optional(),
  defaultSelector: z.string().optional(),
  projectName: z.string().optional(),
  projectRoot: z.string(),
  currentDirectory: z.string(),
  harness: z.enum(LOCAL_AGENT_HARNESS_VALUES),
  transport: z.string(),
  sessionId: z.string().optional(),
  branch: z.string().optional(),
  createdAt: z.number(),
  createdById: z.string().optional(),
  brokerRegistered: z.boolean(),
  inboxConversationId: z.string().optional(),
  lifecycle: scoutAgentCardLifecycleSchema.optional(),
  returnAddress: scoutReturnAddressSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const localAgentStatusSchema = z.object({
  agentId: z.string(),
  definitionId: z.string(),
  projectName: z.string(),
  projectRoot: z.string(),
  sessionId: z.string(),
  startedAt: z.number(),
  harness: z.enum(LOCAL_AGENT_HARNESS_VALUES),
  transport: z.string(),
  isOnline: z.boolean(),
  source: z.string(),
});

const whoAmISchema = z.object({
  currentDirectory: z.string(),
  brokerUrl: z.string(),
  defaultSenderId: z.string(),
});

const brokerMessageSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    actorId: z.string(),
    originNodeId: z.string(),
    class: z.enum(["agent", "log", "system", "status", "artifact"]),
    body: z.string(),
    replyToMessageId: z.string().optional(),
    threadConversationId: z.string().optional(),
    mentions: z
      .array(
        z.object({
          actorId: z.string(),
          label: z.string().optional(),
        }),
      )
      .optional(),
    attachments: z
      .array(
        z
          .object({
            id: z.string(),
            mediaType: z.string(),
            fileName: z.string().optional(),
            blobKey: z.string().optional(),
            url: z.string().optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
    speech: z
      .object({
        text: z.string(),
        voice: z.string().optional(),
        interruptible: z.boolean().optional(),
      })
      .optional(),
    audience: z
      .object({
        visibleTo: z.array(z.string()).optional(),
        notify: z.array(z.string()).optional(),
        invoke: z.array(z.string()).optional(),
        reason: z.string().optional(),
      })
      .optional(),
    visibility: z.string(),
    policy: z.string(),
    createdAt: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());

const messagesInboxResultSchema = z.object({
  currentDirectory: z.string(),
  brokerUrl: z.string(),
  senderId: z.string(),
  limit: z.number(),
  since: z.number().nullable(),
  messages: z.array(brokerMessageSchema),
});

const messagesChannelResultSchema = z.object({
  currentDirectory: z.string(),
  brokerUrl: z.string(),
  channel: z.string(),
  limit: z.number(),
  since: z.number().nullable(),
  messages: z.array(brokerMessageSchema),
});

const brokerFeedRecordSchema = z.record(z.string(), z.unknown());

const brokerFeedItemSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "message",
    "status",
    "invocation",
    "flight",
    "delivery",
    "delivery_attempt",
    "dispatch",
    "unblock_request",
  ]),
  severity: z.enum(["info", "status", "warning", "error"]),
  at: z.number(),
  title: z.string(),
  summary: z.string(),
  agentId: z.string().optional(),
  actorId: z.string().optional(),
  targetAgentId: z.string().optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  invocationId: z.string().optional(),
  flightId: z.string().optional(),
  deliveryId: z.string().optional(),
  dispatchId: z.string().optional(),
  unblockRequestId: z.string().optional(),
  status: z.string().optional(),
  reason: z.string().optional(),
  source: z.enum(["activity", "snapshot", "delivery", "dispatch", "unblock_request"]),
  message: brokerFeedRecordSchema.optional(),
  invocation: brokerFeedRecordSchema.optional(),
  flight: brokerFeedRecordSchema.optional(),
  delivery: brokerFeedRecordSchema.optional(),
  deliveryAttempt: brokerFeedRecordSchema.optional(),
  dispatch: brokerFeedRecordSchema.optional(),
  unblockRequest: brokerFeedRecordSchema.optional(),
  metadata: brokerFeedRecordSchema.optional(),
}).catchall(z.unknown());

const brokerFeedSchema = z.object({
  currentDirectory: z.string(),
  brokerUrl: z.string(),
  found: z.boolean(),
  agentId: z.string(),
  generatedAt: z.number(),
  since: z.number().nullable(),
  limit: z.number(),
  cursor: z.number().nullable(),
  status: z.object({
    agentId: z.string(),
    displayName: z.string().optional(),
    found: z.boolean(),
    agentState: z.string().optional(),
    endpoints: z.array(z.object({
      id: z.string(),
      nodeId: z.string(),
      harness: z.string(),
      transport: z.string(),
      state: z.string(),
      sessionId: z.string().optional(),
      projectRoot: z.string().optional(),
      cwd: z.string().optional(),
      lastError: z.string().optional(),
      lastFailureStage: z.string().optional(),
      updatedAt: z.number().optional(),
    }).catchall(z.unknown())),
    activeFlightIds: z.array(z.string()),
    pendingDeliveryIds: z.array(z.string()),
    errorCount: z.number(),
    warningCount: z.number(),
    lastError: z.string().optional(),
    lastActivityAt: z.number().optional(),
  }).catchall(z.unknown()),
  counts: z.object({
    items: z.number(),
    messages: z.number(),
    statuses: z.number(),
    invocations: z.number(),
    flights: z.number(),
    deliveries: z.number(),
    deliveryAttempts: z.number(),
    dispatches: z.number(),
    unblockRequests: z.number(),
    errors: z.number(),
    warnings: z.number(),
  }),
  items: z.array(brokerFeedItemSchema),
});

const searchResultSchema = z.object({
  currentDirectory: z.string(),
  query: z.string(),
  candidates: z.array(agentCandidateSchema),
});

const resolveResultSchema = z.object({
  currentDirectory: z.string(),
  label: z.string(),
  kind: z.enum(RESOLVE_KIND_VALUES),
  candidate: agentCandidateSchema.nullable(),
  candidates: z.array(agentCandidateSchema),
});

const startSuggestionSchema = z.object({
  tool: z.literal("agents_start"),
  targetLabel: z.string().nullable(),
  agentName: z.string().nullable(),
  harness: z.enum(LOCAL_AGENT_HARNESS_VALUES).nullable(),
  model: z.string().nullable(),
  projectPath: z.string(),
  currentDirectory: z.string(),
});

const followIdsSchema = z.object({
  flightId: z.string().nullable(),
  invocationId: z.string().nullable(),
  conversationId: z.string().nullable(),
  workId: z.string().nullable(),
  sessionId: z.string().nullable(),
  targetAgentId: z.string().nullable(),
});

const followLinksSchema = z.object({
  follow: z.string().nullable(),
  tail: z.string().nullable(),
  session: z.string().nullable(),
  chat: z.string().nullable(),
  work: z.string().nullable(),
  agent: z.string().nullable(),
});

const sendRoutingAdviceSchema = z.object({
  code: z.enum(MESSAGE_ROUTING_ERROR_VALUES),
  summary: z.string(),
  nextAction: z.string(),
});

const sendResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  mode: z.enum(["body_mentions", "explicit_targets", "target_label"]),
  usedBroker: z.boolean(),
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
  flightId: z.string().nullable().optional(),
  wake: z.boolean().optional(),
  invokedTargetIds: z.array(z.string()),
  unresolvedTargetIds: z.array(z.string()),
  targetDiagnostic: z.object({}).catchall(z.unknown()).nullable(),
  startSuggestion: startSuggestionSchema.nullable().optional(),
  routingAdvice: sendRoutingAdviceSchema.nullable().optional(),
  routeKind: z.enum(MESSAGE_ROUTE_KIND_VALUES).nullable(),
  routingError: z.enum(MESSAGE_ROUTING_ERROR_VALUES).nullable(),
  ids: followIdsSchema.optional(),
  links: followLinksSchema.optional(),
  followUrl: z.string().nullable().optional(),
});

const replyContextSchema = z.object({
  mode: z.literal("broker_reply"),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  replyToMessageId: z.string(),
  replyPath: z.enum(["final_response", "mcp_reply"]),
  action: z.string().optional(),
});

const currentReplyContextResultSchema = z.object({
  active: z.boolean(),
  context: replyContextSchema.nullable(),
});

const replyResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  usedBroker: z.boolean(),
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
  replyToMessageId: z.string().nullable(),
  notifiedActorIds: z.array(z.string()),
  routingError: z
    .enum([
      "missing_reply_context",
      "unknown_conversation",
      "unknown_reply_target",
      "reply_target_conversation_mismatch",
    ])
    .nullable(),
});

const cardCreateResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  card: scoutAgentCardSchema,
});

const agentStartResultSchema = z.object({
  currentDirectory: z.string(),
  requestedLabel: z.string().nullable(),
  agentName: z.string().nullable(),
  projectPath: z.string(),
  harness: z.enum(LOCAL_AGENT_HARNESS_VALUES).nullable(),
  model: z.string().nullable(),
  agent: localAgentStatusSchema,
  exactTargetAgentId: z.string(),
  nextTargetLabel: z.string(),
});

const currentSessionAttachResultSchema = z.object({
  currentDirectory: z.string(),
  externalSessionId: z.string(),
  transport: z.literal("codex_app_server"),
  agentId: z.string(),
  selector: z.string().nullable(),
  endpointId: z.string(),
  sessionId: z.string(),
});

const askResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  targetAgentId: z.string().nullable(),
  targetSessionId: z.string().nullable().optional(),
  targetLabel: z.string().nullable(),
  replyToSessionId: z.string().nullable().optional(),
  usedBroker: z.boolean(),
  awaited: z.boolean(),
  waitStatus: z.enum(["not_requested", "acknowledged", "completed", "terminal", "timeout"]).optional(),
  replyMode: z.enum(REPLY_MODE_VALUES).optional(),
  delivery: z.enum(REPLY_DELIVERY_VALUES).optional(),
  notification: z
    .object({
      method: z.literal("notifications/scout/reply"),
      status: z.enum(["scheduled", "not_scheduled"]),
    })
    .nullable()
    .optional(),
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
  flight: flightSchema.nullable(),
  flightId: z.string().nullable(),
  output: z.string().nullable(),
  unresolvedTargetId: z.string().nullable(),
  unresolvedTargetLabel: z.string().nullable(),
  workItem: trackedWorkItemSchema.nullable(),
  workId: z.string().nullable(),
  workUrl: z.string().nullable(),
  ids: followIdsSchema.optional(),
  links: followLinksSchema.optional(),
  followUrl: z.string().nullable().optional(),
  targetDiagnostic: z.object({}).catchall(z.unknown()).nullable(),
  startSuggestion: startSuggestionSchema.nullable().optional(),
});

const askReceiptSchema = z.object({
  ok: z.boolean(),
  state: z.enum(["queued", "completed", "failed", "ambiguous"]),
  ids: z.object({
    targetAgentId: z.string().optional(),
    invocationId: z.string().optional(),
    flightId: z.string().optional(),
    conversationId: z.string().optional(),
    messageId: z.string().optional(),
    workId: z.string().optional(),
    bindingRef: z.string().optional(),
  }),
  next: z
    .object({
      tool: z.enum(["agents_resolve", "agents_search", "agents_start"]),
      arguments: z.record(z.string(), z.unknown()),
      reason: z.string(),
    })
    .optional(),
  error: z
    .object({
      code: z.enum(["broker_unreachable", "invalid_request"]),
      message: z.string(),
    })
    .optional(),
});

const invocationLookupResultSchema = z.object({
  currentDirectory: z.string(),
  flightId: z.string(),
  found: z.boolean(),
  waitStatus: z.enum(["not_requested", "completed", "terminal", "timeout"]).optional(),
  terminal: z.boolean(),
  flight: flightSchema.nullable(),
  lifecycle: invocationLifecycleSchema.nullable().optional(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  ids: followIdsSchema.optional(),
  links: followLinksSchema.optional(),
  followUrl: z.string().nullable().optional(),
});

const workUpdateResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  usedBroker: z.boolean(),
  workItem: trackedWorkItemSchema.nullable(),
  workId: z.string().nullable(),
  workUrl: z.string().nullable(),
});


function parseScoutReplyContextFromEnv(env: NodeJS.ProcessEnv): ScoutReplyContext | null {
  const contextFile = env.OPENSCOUT_REPLY_CONTEXT_FILE?.trim();
  if (contextFile) {
    try {
      const rawFileJson = readFileSync(contextFile, "utf8").trim();
      if (rawFileJson) {
        const parsed = JSON.parse(rawFileJson) as Partial<ScoutReplyContext>;
        if (isScoutReplyContext(parsed)) {
          return parsed;
        }
      }
    } catch {
      // A missing or partially-written reply context file just means there is no
      // active broker reply turn for this long-lived MCP server right now.
    }
  }

  const rawJson = env.OPENSCOUT_REPLY_CONTEXT?.trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Partial<ScoutReplyContext>;
      if (isScoutReplyContext(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  const mode = env.OPENSCOUT_REPLY_MODE?.trim();
  const fromAgentId = env.OPENSCOUT_REPLY_FROM_AGENT_ID?.trim();
  const toAgentId = env.OPENSCOUT_REPLY_TO_AGENT_ID?.trim();
  const conversationId = env.OPENSCOUT_REPLY_CONVERSATION_ID?.trim();
  const messageId = env.OPENSCOUT_REPLY_MESSAGE_ID?.trim();
  const replyToMessageId = env.OPENSCOUT_REPLY_TO_MESSAGE_ID?.trim() || messageId;
  const replyPath = env.OPENSCOUT_REPLY_PATH?.trim() || "mcp_reply";
  if (mode === "broker_reply" && fromAgentId && toAgentId && conversationId && messageId && replyToMessageId && (replyPath === "final_response" || replyPath === "mcp_reply")) {
    return {
      mode: "broker_reply",
      fromAgentId,
      toAgentId,
      conversationId,
      messageId,
      replyToMessageId,
      replyPath,
      ...(env.OPENSCOUT_REPLY_ACTION?.trim() ? { action: env.OPENSCOUT_REPLY_ACTION.trim() as ScoutReplyContext["action"] } : {}),
    };
  }

  return null;
}

function isScoutReplyContext(value: Partial<ScoutReplyContext>): value is ScoutReplyContext {
  return value.mode === "broker_reply"
    && typeof value.fromAgentId === "string"
    && value.fromAgentId.length > 0
    && typeof value.toAgentId === "string"
    && value.toAgentId.length > 0
    && typeof value.conversationId === "string"
    && value.conversationId.length > 0
    && typeof value.messageId === "string"
    && value.messageId.length > 0
    && typeof value.replyToMessageId === "string"
    && value.replyToMessageId.length > 0
    && (value.replyPath === "final_response" || value.replyPath === "mcp_reply");
}

function createTextContent(value: unknown): [{ type: "text"; text: string }] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

function createPlainTextContent(
  text: string,
): [{ type: "text"; text: string }] {
  return [{ type: "text", text }];
}

type SendRoutingAdvice = z.infer<typeof sendRoutingAdviceSchema>;

function buildSendRoutingAdvice(
  routingError: string | null | undefined,
): SendRoutingAdvice | null {
  if (routingError === "missing_destination") {
    return {
      code: "missing_destination",
      summary: "no destination",
      nextAction:
        "Pass one targetAgentId or targetLabel for a DM, or pass channel for a group update.",
    };
  }
  if (routingError === "multi_target_requires_explicit_channel") {
    return {
      code: "multi_target_requires_explicit_channel",
      summary: "multiple targets need an explicit channel",
      nextAction:
        "Pass channel for group coordination, or send separate one-target DMs.",
    };
  }
  return null;
}

function renderMcpSendSummary(result: {
  usedBroker: boolean;
  conversationId: string | null;
  messageId: string | null;
  invokedTargetIds: string[];
  unresolvedTargetIds: string[];
  routingError: string | null;
  targetDiagnostic?: Record<string, unknown> | null;
  startSuggestion?: ScoutMcpStartSuggestion | null;
  routingAdvice?: SendRoutingAdvice | null;
  flightId?: string | null;
  wake?: boolean;
  followUrl?: string | null;
}): string {
  if (!result.usedBroker) {
    return "Scout broker is not reachable; message was not sent.";
  }
  if (result.routingError) {
    const advice = result.routingAdvice ?? buildSendRoutingAdvice(result.routingError);
    if (advice) {
      return `Message was not sent: ${advice.summary}. ${advice.nextAction}`;
    }
    return `Message was not sent: ${result.routingError}.`;
  }
  if (result.unresolvedTargetIds.length > 0) {
    return renderUnroutedTargetSummary({
      kind: "Message",
      target: result.unresolvedTargetIds.join(", "),
      targetDiagnostic: result.targetDiagnostic,
      startSuggestion: result.startSuggestion,
    });
  }
  const destination = result.invokedTargetIds.length > 0
    ? ` to ${result.invokedTargetIds.join(", ")}`
    : "";
  const route = result.conversationId ? ` in ${result.conversationId}` : "";
  const message = result.messageId ? ` (${result.messageId})` : "";
  const followText = result.followUrl ? ` Follow: ${result.followUrl}` : "";
  const wakeText = result.wake && result.flightId
    ? ` Wake queued as ${result.flightId}.${followText}`
    : result.flightId
    ? ` Dispatch queued as ${result.flightId}.${followText}`
    : "";
  return `Message sent${destination}${route}${message}.${wakeText}`;
}

function renderMcpAskSummary(result: {
  usedBroker: boolean;
  targetAgentId: string | null;
  targetLabel: string | null;
  flightId: string | null;
  workId: string | null;
  unresolvedTargetId: string | null;
  unresolvedTargetLabel: string | null;
  output: string | null;
  delivery?: string;
  waitStatus?: string;
  flight?: ScoutFlightRecord | null;
  followUrl?: string | null;
  targetDiagnostic?: Record<string, unknown> | null;
  startSuggestion?: ScoutMcpStartSuggestion | null;
}): string {
  if (!result.usedBroker) {
    return "Scout broker is not reachable; ask was not sent.";
  }
  const unresolved = result.unresolvedTargetId ?? result.unresolvedTargetLabel;
  if (unresolved) {
    return renderUnroutedTargetSummary({
      kind: "Ask",
      target: unresolved,
      targetDiagnostic: result.targetDiagnostic,
      startSuggestion: result.startSuggestion,
    });
  }
  const target = result.targetAgentId ?? result.targetLabel ?? "target";
  const details = [
    result.flightId ? `flight ${result.flightId}` : null,
    result.workId ? `work ${result.workId}` : null,
  ].filter(Boolean);
  const detailText = details.length > 0 ? `; ${details.join(", ")}` : "";
  const followText = result.followUrl ? ` Follow: ${result.followUrl}` : "";
  if (result.waitStatus === "timeout" && result.flightId) {
    const state = result.flight?.state ? ` ${result.flight.state}` : "";
    return `Ask dispatch is still${state}; use invocations_wait with flightId=${result.flightId}.${followText}`;
  }
  if (result.waitStatus === "acknowledged" && result.flightId) {
    const state = result.flight?.state ? ` ${result.flight.state}` : "";
    return `Ask acknowledged${state}; use invocations_wait with flightId=${result.flightId}.${followText}`;
  }
  if (result.output) {
    return result.output;
  }
  if (result.delivery === "mcp_notification") {
    return `Ask sent to ${target}; reply will be delivered by MCP notification${detailText}.${followText}`;
  }
  return `Ask sent to ${target}${detailText}.${followText}`;
}

function renderMcpAskPrimitiveSummary(receipt: ScoutAskReceipt): string {
  if (receipt.ok) {
    const target = receipt.ids.targetAgentId
      ? ` to ${receipt.ids.targetAgentId}`
      : "";
    const flight = receipt.ids.flightId ? `; flight ${receipt.ids.flightId}` : "";
    const work = receipt.ids.workId ? `; work ${receipt.ids.workId}` : "";
    return `Ask ${receipt.state}${target}${flight}${work}.`;
  }
  if (receipt.next) {
    return `Ask was not sent: ${receipt.next.reason}`;
  }
  if (receipt.error) {
    return `Ask was not sent: ${receipt.error.message}`;
  }
  return "Ask was not sent.";
}

function resolveAskReplyMode(input: {
  awaitReply?: boolean;
  replyMode?: ScoutMcpReplyMode;
}): ScoutMcpReplyMode {
  if (input.replyMode) {
    return input.replyMode;
  }
  return input.awaitReply ? "inline" : "none";
}

function resolveMcpReplyToSessionId(
  explicitSessionId: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  return explicitSessionId?.trim() || env.CODEX_THREAD_ID?.trim() || undefined;
}

function workUrlFor(
  workItem: ScoutTrackedWorkItem | null | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  return workItem
    ? buildScoutPath(resolveScoutWebOrigin(env), `/work/${encodeURIComponent(workItem.id)}`)
    : null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

function resolveScoutWebOrigin(env: NodeJS.ProcessEnv): string {
  const publicOrigin = env.OPENSCOUT_WEB_PUBLIC_ORIGIN?.trim();
  if (publicOrigin) {
    return trimTrailingSlash(publicOrigin);
  }

  const configuredPort = Number.parseInt(
    env.OPENSCOUT_WEB_PORT?.trim() || env.SCOUT_WEB_PORT?.trim() || "",
    10,
  );
  const port = Number.isFinite(configuredPort)
    ? configuredPort
    : resolveWebPort();
  const rawHost =
    env.OPENSCOUT_WEB_HOST?.trim() ||
    env.SCOUT_WEB_HOST?.trim() ||
    resolveHost();
  const host = rawHost === "0.0.0.0" || rawHost === "::"
    ? "127.0.0.1"
    : rawHost;
  return `http://${host}:${port}`;
}

function buildScoutPath(origin: string, path: string): string {
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildFollowPath(
  ids: ScoutFollowIds,
  preferredView: ScoutFollowPreferredView,
): string | null {
  const params = new URLSearchParams();
  params.set("view", preferredView);
  if (ids.flightId) params.set("flightId", ids.flightId);
  if (ids.invocationId) params.set("invocationId", ids.invocationId);
  if (ids.conversationId) params.set("conversationId", ids.conversationId);
  if (ids.workId) params.set("workId", ids.workId);
  if (ids.sessionId) params.set("sessionId", ids.sessionId);
  if (ids.targetAgentId) params.set("targetAgentId", ids.targetAgentId);
  const query = params.toString();
  return query === `view=${preferredView}` ? null : `/follow?${query}`;
}

function buildScoutFollowArtifacts(
  input: {
    flight: ScoutFlightRecord | null;
    conversationId: string | null;
    workItem: ScoutTrackedWorkItem | null;
    targetSessionId?: string | null;
    targetAgentId: string | null;
  },
  env: NodeJS.ProcessEnv,
): { ids: ScoutFollowIds; links: ScoutFollowLinks; followUrl: string | null } {
  const ids: ScoutFollowIds = {
    flightId: input.flight?.id ?? null,
    invocationId: input.flight?.invocationId ?? null,
    conversationId: input.conversationId,
    workId: input.workItem?.id ?? null,
    sessionId: input.targetSessionId ?? null,
    targetAgentId: input.targetAgentId ?? input.flight?.targetAgentId ?? null,
  };
  const origin = resolveScoutWebOrigin(env);
  const followPath =
    buildFollowPath(ids, "tail") ??
    (ids.conversationId ? `/c/${encodeURIComponent(ids.conversationId)}` : null);

  const follow = followPath ? buildScoutPath(origin, followPath) : null;
  const tailPath = buildFollowPath(ids, "tail");
  const sessionPath = buildFollowPath(ids, "session");
  const links: ScoutFollowLinks = {
    follow,
    tail: tailPath ? buildScoutPath(origin, tailPath) : null,
    session: sessionPath ? buildScoutPath(origin, sessionPath) : null,
    chat: ids.conversationId
      ? buildScoutPath(origin, `/c/${encodeURIComponent(ids.conversationId)}`)
      : null,
    work: ids.workId
      ? buildScoutPath(origin, `/work/${encodeURIComponent(ids.workId)}`)
      : null,
    agent: ids.targetAgentId
      ? buildScoutPath(origin, `/agents/${encodeURIComponent(ids.targetAgentId)}?tab=message`)
      : null,
  };

  return { ids, links, followUrl: follow };
}

function isTerminalFlightState(state: string | null | undefined): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

type ScoutMcpFlightWaitStatus =
  | "not_requested"
  | "acknowledged"
  | "completed"
  | "terminal"
  | "timeout";

async function loadInvocationLifecycleForFlight(input: {
  deps: ScoutMcpDependencies;
  brokerUrl: string;
  flight: ScoutFlightRecord | null;
}): Promise<ScoutInvocationLifecycleRecord | null> {
  if (!input.flight?.invocationId || !input.deps.getInvocationLifecycle) {
    return null;
  }
  return await input.deps.getInvocationLifecycle(
    input.brokerUrl,
    input.flight.invocationId,
  );
}

function isAcknowledgedFlightState(state: string | null | undefined): boolean {
  return state === "running" || state === "waiting";
}

async function waitForFlightForMcp(input: {
  deps: ScoutMcpDependencies;
  brokerUrl: string;
  flight: ScoutFlightRecord | null;
  timeoutSeconds?: number;
}): Promise<{ flight: ScoutFlightRecord | null; waitStatus: ScoutMcpFlightWaitStatus }> {
  if (!input.flight) {
    return { flight: null, waitStatus: "not_requested" };
  }

  const deadline =
    typeof input.timeoutSeconds === "number" && input.timeoutSeconds > 0
      ? Date.now() + input.timeoutSeconds * 1000
      : Date.now() + DEFAULT_ASK_ACK_TIMEOUT_SECONDS * 1000;
  let latestFlight = input.flight;

  while (true) {
    if (latestFlight.state === "completed") {
      return { flight: latestFlight, waitStatus: "completed" };
    }
    if (isTerminalFlightState(latestFlight.state)) {
      return { flight: latestFlight, waitStatus: "terminal" };
    }
    if (isAcknowledgedFlightState(latestFlight.state)) {
      return { flight: latestFlight, waitStatus: "acknowledged" };
    }
    if (deadline !== null && Date.now() > deadline) {
      return { flight: latestFlight, waitStatus: "timeout" };
    }
    latestFlight = await input.deps.getFlight(input.brokerUrl, input.flight.id) ?? latestFlight;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function buildInvocationLookupContent(input: {
  currentDirectory: string;
  flightId: string;
  flight: ScoutFlightRecord | null;
  lifecycle?: ScoutInvocationLifecycleRecord | null;
  waitStatus?: "not_requested" | "completed" | "terminal" | "timeout";
  env: NodeJS.ProcessEnv;
}) {
  const followArtifacts = buildScoutFollowArtifacts(
    {
      flight: input.flight,
      conversationId: null,
      workItem: null,
      targetAgentId: input.lifecycle?.targetAgentId ?? input.flight?.targetAgentId ?? null,
    },
    input.env,
  );
  const terminal = isTerminalFlightState(input.flight?.state)
    || Boolean(input.lifecycle?.terminal);
  return {
    currentDirectory: input.currentDirectory,
    flightId: input.flightId,
    found: Boolean(input.flight),
    waitStatus: input.waitStatus,
    terminal,
    flight: input.flight,
    lifecycle: input.lifecycle ?? null,
    output: input.flight?.output
      ?? input.flight?.summary
      ?? input.lifecycle?.terminal?.summary
      ?? null,
    error: input.flight?.error
      ?? input.lifecycle?.terminal?.errorClass
      ?? null,
    ids: followArtifacts.ids,
    links: followArtifacts.links,
    followUrl: followArtifacts.followUrl,
  };
}

function renderInvocationLookupSummary(result: {
  flightId: string;
  found: boolean;
  waitStatus?: string;
  flight: ScoutFlightRecord | null;
  output: string | null;
  error: string | null;
  followUrl?: string | null;
}): string {
  if (!result.found || !result.flight) {
    return `Flight ${result.flightId} was not found.`;
  }
  if (result.flight.state === "completed" && result.output) {
    return result.output;
  }
  if ((result.flight.state === "failed" || result.flight.state === "cancelled") && result.error) {
    return result.error;
  }
  const followText = result.followUrl ? ` Follow: ${result.followUrl}` : "";
  if (result.waitStatus === "timeout") {
    return `Flight ${result.flightId} is still ${result.flight.state}.${followText}`;
  }
  return `Flight ${result.flightId} is ${result.flight.state}.${followText}`;
}

function renderMcpLabelBriefSummary(brief: ScoutLabelBrief & { found: boolean }): string {
  if (!brief.found) {
    return `Label ${brief.label} was not found.`;
  }
  const pieces = [
    `Label ${brief.label}`,
    `${brief.counts.activeFlights} active flights`,
    `${brief.counts.flights} total flights`,
    `${brief.counts.workItems} work items`,
  ];
  const active = brief.activeFlights
    .slice(0, 3)
    .map((flight) => `${flight.id} ${flight.state} -> ${flight.targetAgentId}`)
    .join("; ");
  const recent = active ? ` Active: ${active}.` : "";
  return `${pieces.join("; ")}.${recent}`;
}

function renderMcpLabelFeedSummary(feed: ScoutLabelFeed & { found: boolean }): string {
  if (!feed.found) {
    return `Label ${feed.label} feed is unavailable.`;
  }
  const latest = feed.events.at(-1);
  const latestText = latest
    ? ` Latest: ${latest.kind} from ${latest.actorId ?? "unknown"} - ${latest.summary}`
    : " No events yet.";
  return `Label ${feed.label}; ${feed.counts.events} events; cursor ${feed.cursor ?? "none"}.${latestText}`;
}

function renderMcpBrokerFeedSummary(feed: ScoutAgentBrokerFeed & { found: boolean }): string {
  if (!feed.found) {
    return `Broker feed for ${feed.agentId} is unavailable.`;
  }
  const latest = feed.items[0];
  const latestText = latest
    ? ` Latest: ${latest.kind} ${latest.severity} - ${latest.summary}`
    : " No broker events yet.";
  return `Broker feed for ${feed.agentId}; ${feed.counts.items} items; ${feed.counts.errors} errors; ${feed.counts.warnings} warnings; cursor ${feed.cursor ?? "none"}.${latestText}`;
}

function resolveCurrentCodexThreadId(env: NodeJS.ProcessEnv): string {
  const threadId = env.CODEX_THREAD_ID?.trim();
  if (!threadId) {
    throw new Error(
      "The current host session is not an attachable Codex session. Expected CODEX_THREAD_ID in the environment.",
    );
  }
  return threadId;
}

function sendScoutReplyNotification(
  server: McpServer,
  params: ScoutReplyNotificationParams,
): Promise<void> {
  return server.server.notification({
    method: "notifications/scout/reply",
    params,
  });
}

function scheduleScoutReplyNotification(input: {
  server: McpServer;
  deps: ScoutMcpDependencies;
  brokerUrl: string;
  flight: ScoutFlightRecord;
  timeoutSeconds?: number;
  context: Omit<
    ScoutReplyNotificationParams,
    "status" | "flight" | "output" | "error"
  >;
}): void {
  void (async () => {
    try {
      const completedFlight = await input.deps.waitForFlight(
        input.brokerUrl,
        input.flight.id,
        { timeoutSeconds: input.timeoutSeconds },
      );
      await sendScoutReplyNotification(input.server, {
        ...input.context,
        status: "completed",
        flight: completedFlight,
        output: completedFlight.output ?? completedFlight.summary ?? null,
        error: null,
      });
    } catch (error) {
      await sendScoutReplyNotification(input.server, {
        ...input.context,
        status: "failed",
        flight: null,
        output: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })().catch(() => {
    // The MCP client may have disconnected by the time the flight finishes.
  });
}

function normalizeSearchValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/^@+/, "") ?? "";
}

type ScoutMcpStartSuggestion = z.infer<typeof startSuggestionSchema>;

function parseStartTargetLabel(
  targetLabel: string | null | undefined,
): {
  agentName: string | null;
  harness: (typeof LOCAL_AGENT_HARNESS_VALUES)[number] | null;
  model: string | null;
} {
  const rawLabel = targetLabel?.trim();
  if (!rawLabel) {
    return { agentName: null, harness: null, model: null };
  }

  const label = rawLabel.replace(/^@+/, "");
  const harnessMatch = label.match(/(?:#|harness:)(claude|codex|pi)\b/i);
  const shorthandModelMatch = label.match(/\?([^#\s.]+)/);
  const qualifiedModelMatch = label.match(/(?:^|\.)model:([^#?\s.]+)/i);
  const base = label
    .split("?")[0]
    ?.split("#")[0]
    ?.replace(/\.harness:.*/i, "")
    ?? "";
  const agentName = base.split(".")[0]?.trim() || null;
  const harnessValue = harnessMatch?.[1]?.toLowerCase();
  const harness = LOCAL_AGENT_HARNESS_VALUES.find((value) => value === harnessValue) ?? null;
  const model =
    shorthandModelMatch?.[1]?.trim()
    || qualifiedModelMatch?.[1]?.trim()
    || null;

  return { agentName, harness, model };
}

async function buildStartSuggestionForTarget(
  targetLabel: string | null | undefined,
  currentDirectory: string,
): Promise<ScoutMcpStartSuggestion | null> {
  const trimmedLabel = targetLabel?.trim();
  if (!trimmedLabel) {
    return null;
  }
  const parsed = parseStartTargetLabel(trimmedLabel);
  const projectPath =
    await findNearestProjectRoot(currentDirectory) ?? currentDirectory;
  return {
    tool: "agents_start",
    targetLabel: trimmedLabel,
    agentName: parsed.agentName,
    harness: parsed.harness,
    model: parsed.model,
    projectPath,
    currentDirectory,
  };
}

function normalizeModelConstraint(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function candidateMatchesStartConstraints(
  candidate: ScoutMcpAgentCandidate,
  parsed: ReturnType<typeof parseStartTargetLabel>,
): boolean {
  if (parsed.harness && candidate.harness !== parsed.harness) {
    return false;
  }
  if (parsed.model) {
    const requested = normalizeModelConstraint(parsed.model);
    const candidateModel = normalizeModelConstraint(candidate.model);
    if (!candidateModel || (
      candidateModel !== requested && !candidateModel.includes(requested)
    )) {
      return false;
    }
  }
  return true;
}

async function diagnosePreciseTargetLabel(input: {
  deps: Pick<ScoutMcpDependencies, "resolveAgent">;
  targetLabel: string | null | undefined;
  currentDirectory: string;
}): Promise<{
  blocked: boolean;
  startSuggestion: ScoutMcpStartSuggestion | null;
  diagnostic: Record<string, unknown> | null;
}> {
  const label = input.targetLabel?.trim();
  if (!label) {
    return { blocked: false, startSuggestion: null, diagnostic: null };
  }
  const parsed = parseStartTargetLabel(label);
  if (!parsed.harness && !parsed.model) {
    return { blocked: false, startSuggestion: null, diagnostic: null };
  }

  const resolution = await input.deps.resolveAgent({
    label,
    currentDirectory: input.currentDirectory,
  });
  const matchingCandidates = [
    resolution.candidate,
    ...resolution.candidates,
  ].filter((candidate): candidate is ScoutMcpAgentCandidate => {
    if (!candidate) return false;
    return candidateMatchesStartConstraints(candidate, parsed);
  });
  if (matchingCandidates.length === 1) {
    return { blocked: false, startSuggestion: null, diagnostic: null };
  }

  return {
    blocked: true,
    startSuggestion: await buildStartSuggestionForTarget(
      label,
      input.currentDirectory,
    ),
    diagnostic: {
      kind: resolution.kind === "resolved"
        ? "target_constraint_mismatch"
        : resolution.kind === "ambiguous"
          ? "target_constraint_ambiguous"
          : "target_unresolved",
      label,
      requested: {
        agentName: parsed.agentName,
        harness: parsed.harness,
        model: parsed.model,
      },
      resolvedCandidate: resolution.candidate
        ? {
            agentId: resolution.candidate.agentId,
            harness: resolution.candidate.harness,
            model: resolution.candidate.model,
          }
        : null,
      matchingCandidateIds: matchingCandidates.map((candidate) => candidate.agentId),
    },
  };
}

function renderStartSuggestionText(
  startSuggestion: ScoutMcpStartSuggestion | null | undefined,
): string {
  if (!startSuggestion) {
    return "";
  }
  const args = [
    startSuggestion.agentName
      ? `agentName="${startSuggestion.agentName}"`
      : null,
    startSuggestion.harness ? `harness="${startSuggestion.harness}"` : null,
    startSuggestion.model ? `model="${startSuggestion.model}"` : null,
    `projectPath="${startSuggestion.projectPath}"`,
  ].filter(Boolean);
  return ` If this should be a new session, call agents_start with ${args.join(", ")} and then retry using the returned exactTargetAgentId.`;
}

function renderExactTargetNoStartSuggestionText(
  targetDiagnostic: Record<string, unknown> | null | undefined,
): string {
  const diagnosticKind = typeof targetDiagnostic?.kind === "string"
    ? targetDiagnostic.kind
    : "";
  if (
    diagnosticKind !== "exact_target_id_unresolved" &&
    diagnosticKind !== "exact_target_ids_unresolved"
  ) {
    return "";
  }
  return " Exact targetAgentId paths cannot infer agents_start arguments; use agents_search to pick an existing agent, or call agents_start with a targetLabel/agentName/harness/model and retry with the returned exactTargetAgentId.";
}

function renderUnroutedTargetSummary(input: {
  kind: "Message" | "Ask";
  target: string;
  targetDiagnostic?: Record<string, unknown> | null;
  startSuggestion?: ScoutMcpStartSuggestion | null;
}): string {
  const diagnosticKind = typeof input.targetDiagnostic?.kind === "string"
    ? input.targetDiagnostic.kind
    : "";
  if (diagnosticKind === "target_constraint_mismatch") {
    return `${input.kind} was not sent; target constraints did not match any resolved agent: ${input.target}.${renderStartSuggestionText(input.startSuggestion)}`;
  }
  if (diagnosticKind === "target_constraint_ambiguous") {
    return `${input.kind} was not sent; target constraints matched multiple agents: ${input.target}.${renderStartSuggestionText(input.startSuggestion)}`;
  }
  return `${input.kind} was not sent; unresolved target: ${input.target}.${renderStartSuggestionText(input.startSuggestion)}${renderExactTargetNoStartSuggestionText(input.targetDiagnostic)}`;
}

function buildExactTargetIdsDiagnostic(
  targetAgentIds: string[],
): Record<string, unknown> | null {
  const unresolvedTargetIds = [
    ...new Set(targetAgentIds.map((value) => value.trim()).filter(Boolean)),
  ];
  if (unresolvedTargetIds.length === 0) {
    return null;
  }
  return {
    kind: unresolvedTargetIds.length === 1
      ? "exact_target_id_unresolved"
      : "exact_target_ids_unresolved",
    unresolvedTargetIds,
    startSuggestionAvailable: false,
    detail:
      "Exact targetAgentId routing does not include enough label information to infer safe agents_start arguments.",
  };
}

function isCanonicalOpenScoutProjectRoot(
  projectRoot: string | null | undefined,
): boolean {
  if (!projectRoot) {
    return false;
  }
  return normalizeSearchValue(basename(resolve(projectRoot))) === "openscout";
}

function isSameProjectRoot(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  return resolve(left) === resolve(right);
}

function matchesObviousProjectLocalAlias(
  value: string | null | undefined,
  query: string,
): boolean {
  const normalized = normalizeSearchValue(value);
  if (!normalized || !query) {
    return false;
  }
  return normalized === query
    || normalized.startsWith(`${query}-`)
    || normalized.startsWith(`${query}.`)
    || normalized.startsWith(`${query}_`)
    || normalized.startsWith(`${query} `);
}

function scoreProjectLocalCandidate(
  candidate: ScoutMcpAgentCandidate,
  currentProjectRoot: string,
  query: string,
): number {
  if (!isSameProjectRoot(candidate.projectRoot, currentProjectRoot)) {
    return -1;
  }

  const values = [
    candidate.defaultLabel,
    candidate.label,
    candidate.handle,
    candidate.selector,
    candidate.defaultSelector,
    candidate.displayName,
    candidate.agentId,
  ];
  const matches = values.filter((value) =>
    matchesObviousProjectLocalAlias(value, query),
  );
  if (matches.length === 0) {
    return -1;
  }

  return 1000 + rankState(candidate.state) * 20 + (candidate.routable ? 50 : 0);
}

async function findPreferredProjectLocalCandidate(
  candidates: ScoutMcpAgentCandidate[],
  rawLabel: string,
  currentDirectory: string,
): Promise<ScoutMcpAgentCandidate | null> {
  const query = normalizeSearchValue(rawLabel);
  if (!query) {
    return null;
  }

  const currentProjectRoot =
    await findNearestProjectRoot(currentDirectory) ?? currentDirectory;
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreProjectLocalCandidate(candidate, currentProjectRoot, query),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.candidate.agentId.localeCompare(right.candidate.agentId);
    });

  if (scored.length === 0) {
    return null;
  }
  if (scored.length > 1 && scored[0]?.score === scored[1]?.score) {
    return null;
  }
  return scored[0]?.candidate ?? null;
}

function normalizedStringOrNull(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function metadataStringValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isBuiltInDirectoryAgent(agent: {
  id: string;
  definitionId?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  const definitionId =
    agent.definitionId
    || metadataStringValue(agent.metadata, "definitionId")
    || agent.id;
  return BUILT_IN_AGENT_DEFINITION_IDS.has(definitionId);
}

function rankState(state: SearchableAgentState): number {
  switch (state) {
    case "active":
      return 5;
    case "waiting":
      return 4;
    case "idle":
      return 3;
    case "offline":
      return 2;
    case "discovered":
    default:
      return 1;
  }
}

function isRoutableState(state: SearchableAgentState): boolean {
  return state === "active" || state === "waiting" || state === "idle";
}

function preferredWhoEntry(
  entry: ScoutWhoEntry | undefined,
  fallback: SearchableAgentState,
): { state: SearchableAgentState; registrationKind: SearchRegistrationKind } {
  if (!entry) {
    return {
      state: fallback,
      registrationKind: fallback === "discovered" ? "discovered" : "configured",
    };
  }

  return {
    state: entry.state,
    registrationKind: entry.registrationKind,
  };
}

function choosePreferredEndpoint(
  endpoints: Array<{
    state?: AgentState;
    harness?: string;
    transport?: string;
    projectRoot?: string;
    cwd?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }>,
) {
  const orderedStates: AgentState[] = ["active", "waiting", "idle", "offline"];
  for (const state of orderedStates) {
    const match = endpoints.find((endpoint) => endpoint.state === state);
    if (match) {
      return match;
    }
  }
  return endpoints[0] ?? null;
}

function buildIdentityCandidate(
  entry: InternalAgentDirectoryEntry,
): AgentIdentityCandidate {
  const aliases = [entry.selector, entry.defaultSelector, entry.handle].filter(
    (value): value is string => Boolean(value && value.trim().length > 0),
  );
  if (
    normalizeSearchValue(entry.definitionId) === "openscout"
    || normalizeSearchValue(entry.handle) === "openscout"
    || normalizeSearchValue(entry.defaultSelector) === "openscout"
  ) {
    aliases.push("@scout");
  }

  return {
    agentId: entry.agentId,
    definitionId: entry.definitionId,
    ...(entry.workspace ? { workspaceQualifier: entry.workspace } : {}),
    ...(entry.node ? { nodeQualifier: entry.node } : {}),
    ...(entry.harness ? { harness: entry.harness } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    aliases,
  };
}

function decorateAgentLabels(
  entries: InternalAgentDirectoryEntry[],
): ScoutMcpAgentCandidate[] {
  const identityCandidates = entries.map((entry) =>
    buildIdentityCandidate(entry),
  );

  return entries.map((entry) => {
    const identityCandidate = buildIdentityCandidate(entry);
    const label = formatMinimalAgentIdentity(
      identityCandidate,
      identityCandidates,
    );
    const defaultLabel = entry.defaultSelector
      ? `@${entry.defaultSelector}`
      : null;

    return {
      agentId: entry.agentId,
      label,
      defaultLabel,
      displayName: entry.displayName,
      handle: entry.handle,
      selector: entry.selector,
      defaultSelector: entry.defaultSelector,
      state: entry.state,
      registrationKind: entry.registrationKind,
      routable: entry.routable,
      harness: entry.harness,
      model: entry.model,
      workspace: entry.workspace,
      node: entry.node,
      projectRoot: entry.projectRoot,
      transport: entry.transport,
      sessionId: entry.sessionId,
    };
  });
}

function isOpenScoutNamedCandidate(
  candidate: ScoutMcpAgentCandidate,
): boolean {
  const agentIdHead = normalizeSearchValue(candidate.agentId).split(".")[0] ?? "";
  return [
    candidate.handle,
    candidate.defaultSelector,
    candidate.defaultLabel,
    agentIdHead,
  ].some((value) => normalizeSearchValue(value) === "openscout");
}

function findPreferredStableScoutCandidate(
  candidates: ScoutMcpAgentCandidate[],
): ScoutMcpAgentCandidate | null {
  const scored = candidates
    .filter((candidate) => (
      isCanonicalOpenScoutProjectRoot(candidate.projectRoot)
      && isOpenScoutNamedCandidate(candidate)
    ))
    .map((candidate) => ({
      candidate,
      score: rankState(candidate.state) * 20 + (candidate.routable ? 50 : 0),
    }))
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.candidate.agentId.localeCompare(right.candidate.agentId);
    });

  if (scored.length === 0) {
    return null;
  }
  if (scored.length > 1 && scored[0]?.score === scored[1]?.score) {
    return null;
  }
  return scored[0]?.candidate ?? null;
}

function scoreTextCandidate(
  value: string | null | undefined,
  query: string,
): number {
  const normalizedValue = normalizeSearchValue(value);
  if (!normalizedValue) return -1;

  if (normalizedValue === query) return 900;
  if (normalizedValue.startsWith(query)) return 700;
  if (
    normalizedValue.split(/[\s._:/-]+/).some((part) => part.startsWith(query))
  )
    return 500;
  if (normalizedValue.includes(query)) return 300;
  return -1;
}

function scoreAgentCandidate(
  candidate: ScoutMcpAgentCandidate,
  query: string,
): number {
  const stateBonus =
    rankState(candidate.state) * 20 + (candidate.routable ? 25 : 0);
  if (!query) return stateBonus;

  const haystacks = [
    candidate.label,
    candidate.defaultLabel,
    candidate.displayName,
    candidate.handle,
    candidate.selector,
    candidate.defaultSelector,
    candidate.agentId,
    candidate.harness,
    candidate.model,
    candidate.workspace,
    candidate.node,
    candidate.projectRoot ? basename(candidate.projectRoot) : null,
  ];
  let best = -1;
  for (const value of haystacks) {
    best = Math.max(best, scoreTextCandidate(value, query));
  }
  if (
    (query === "scout" || query === "openscout")
    && isCanonicalOpenScoutProjectRoot(candidate.projectRoot)
  ) {
    best = Math.max(best, 900);
  }
  if (best < 0) return -1;
  return best + stateBonus;
}

function exactCandidateMatches(
  candidate: ScoutMcpAgentCandidate,
  query: string,
): boolean {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return false;

  return [
    candidate.agentId,
    candidate.label,
    candidate.defaultLabel,
    candidate.handle,
    candidate.selector,
    candidate.defaultSelector,
    candidate.model,
  ].some((value) => normalizeSearchValue(value) === normalizedQuery);
}

async function loadScoutAgentDirectory(
  currentDirectory: string,
): Promise<InternalAgentDirectoryEntry[]> {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    throw new Error(
      `Broker is not reachable at ${resolveScoutBrokerUrl()}. Run scout setup first.`,
    );
  }

  const [setup, whoEntries] = await Promise.all([
    loadResolvedRelayAgents({ currentDirectory }),
    listScoutAgents({ currentDirectory }),
  ]);

  const whoByAgentId = new Map(
    whoEntries.map((entry) => [entry.agentId, entry]),
  );
  const directory = new Map<string, InternalAgentDirectoryEntry>();

  const upsert = (entry: InternalAgentDirectoryEntry) => {
    const existing = directory.get(entry.agentId);
    if (!existing) {
      directory.set(entry.agentId, entry);
      return;
    }

    directory.set(entry.agentId, {
      ...existing,
      ...entry,
      displayName: entry.displayName || existing.displayName,
      handle: entry.handle ?? existing.handle,
      selector: entry.selector ?? existing.selector,
      defaultSelector: entry.defaultSelector ?? existing.defaultSelector,
      harness: entry.harness ?? existing.harness,
      model: entry.model ?? existing.model,
      workspace: entry.workspace ?? existing.workspace,
      node: entry.node ?? existing.node,
      projectRoot: entry.projectRoot ?? existing.projectRoot,
      transport: entry.transport ?? existing.transport,
      sessionId: entry.sessionId ?? existing.sessionId,
      state:
        rankState(entry.state) >= rankState(existing.state)
          ? entry.state
          : existing.state,
      registrationKind:
        entry.registrationKind === "broker"
          ? entry.registrationKind
          : existing.registrationKind,
      routable: entry.routable || existing.routable,
    });
  };

  for (const discovered of setup.discoveredAgents) {
    const whoEntry = whoByAgentId.get(discovered.agentId);
    const identity = preferredWhoEntry(
      whoEntry,
      discovered.registrationKind === "discovered" ? "discovered" : "offline",
    );
    upsert({
      agentId: discovered.agentId,
      definitionId: discovered.definitionId,
      displayName: discovered.displayName,
      handle:
        discovered.instance.selector ||
        discovered.instance.defaultSelector ||
        null,
      selector: discovered.instance.selector || null,
      defaultSelector: discovered.instance.defaultSelector || null,
      state: identity.state,
      registrationKind: identity.registrationKind,
      routable: isRoutableState(identity.state),
      harness: discovered.runtime.harness ?? discovered.defaultHarness,
      model: null,
      workspace: discovered.instance.workspaceQualifier || null,
      node: discovered.instance.nodeQualifier || null,
      projectRoot: discovered.projectRoot,
      transport: discovered.runtime.transport ?? null,
      sessionId: null,
    });
  }

  for (const agent of Object.values(broker.snapshot.agents ?? {})) {
    if (agent.id === "operator") continue;
    if (isBuiltInDirectoryAgent(agent)) continue;

    const endpoints = Object.values(broker.snapshot.endpoints ?? {}).filter(
      (endpoint) => endpoint.agentId === agent.id,
    );
    const preferredEndpoint = choosePreferredEndpoint(endpoints);
    const whoEntry = whoByAgentId.get(agent.id);
    const state = (whoEntry?.state ??
      preferredEndpoint?.state ??
      "offline") as SearchableAgentState;

    upsert({
      agentId: agent.id,
      definitionId: agent.definitionId || agent.id,
      displayName: agent.displayName || agent.handle || agent.id,
      handle: normalizedStringOrNull(agent.handle),
      selector: normalizedStringOrNull(agent.selector),
      defaultSelector: normalizedStringOrNull(agent.defaultSelector),
      state,
      registrationKind: whoEntry?.registrationKind ?? "broker",
      routable: isRoutableState(state),
      harness: normalizedStringOrNull(preferredEndpoint?.harness),
      model: normalizedStringOrNull(
        typeof preferredEndpoint?.metadata?.model === "string"
          ? preferredEndpoint.metadata.model
          : typeof agent.metadata?.model === "string"
            ? agent.metadata.model
            : null,
      ),
      workspace: normalizedStringOrNull(agent.workspaceQualifier),
      node: normalizedStringOrNull(agent.nodeQualifier),
      projectRoot: normalizedStringOrNull(
        preferredEndpoint?.projectRoot ?? preferredEndpoint?.cwd,
      ),
      transport: normalizedStringOrNull(preferredEndpoint?.transport),
      sessionId: normalizedStringOrNull(preferredEndpoint?.sessionId),
    });
  }

  return [...directory.values()].sort((left, right) => {
    const stateDelta = rankState(right.state) - rankState(left.state);
    if (stateDelta !== 0) return stateDelta;
    return left.displayName.localeCompare(right.displayName);
  });
}

export async function searchScoutAgentsForMcp(input: {
  query?: string;
  currentDirectory: string;
  limit?: number;
}): Promise<ScoutMcpAgentCandidate[]> {
  const candidates = decorateAgentLabels(
    await loadScoutAgentDirectory(input.currentDirectory),
  );
  const normalizedQuery = normalizeSearchValue(input.query);
  const currentProjectRoot =
    await findNearestProjectRoot(input.currentDirectory) ?? input.currentDirectory;
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));

  return candidates
    .map((candidate) => ({
      candidate,
      score:
        scoreAgentCandidate(candidate, normalizedQuery)
        + Math.max(
          0,
          scoreProjectLocalCandidate(candidate, currentProjectRoot, normalizedQuery),
        ),
    }))
    .filter((entry) => normalizedQuery.length === 0 || entry.score >= 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      const stateDelta =
        rankState(right.candidate.state) - rankState(left.candidate.state);
      if (stateDelta !== 0) return stateDelta;
      return left.candidate.displayName.localeCompare(
        right.candidate.displayName,
      );
    })
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

export async function resolveScoutAgentForMcp(input: {
  label: string;
  currentDirectory: string;
}): Promise<ScoutMcpResolveResult> {
  const rawLabel = input.label.trim();
  if (!rawLabel) {
    return { kind: "unresolved", candidate: null, candidates: [] };
  }

  const entries = await loadScoutAgentDirectory(input.currentDirectory);
  const candidates = decorateAgentLabels(entries);
  const exactMatches = candidates.filter((candidate) =>
    exactCandidateMatches(candidate, rawLabel),
  );
  if (["scout", "openscout"].includes(normalizeSearchValue(rawLabel))) {
    const preferredStableScoutCandidate = findPreferredStableScoutCandidate(candidates);
    if (preferredStableScoutCandidate) {
      return {
        kind: "resolved",
        candidate: preferredStableScoutCandidate,
        candidates: [],
      };
    }
  }

  if (exactMatches.length === 1) {
    return { kind: "resolved", candidate: exactMatches[0], candidates: [] };
  }
  const preferredProjectLocalCandidate = await findPreferredProjectLocalCandidate(
    candidates,
    rawLabel,
    input.currentDirectory,
  );
  if (preferredProjectLocalCandidate) {
    return {
      kind: "resolved",
      candidate: preferredProjectLocalCandidate,
      candidates: [],
    };
  }
  if (exactMatches.length > 1) {
    return { kind: "ambiguous", candidate: null, candidates: exactMatches };
  }

  const selector = parseAgentIdentity(
    rawLabel.startsWith("@") ? rawLabel : `@${rawLabel}`,
  );
  if (!selector) {
    return { kind: "unresolved", candidate: null, candidates: [] };
  }

  const identityCandidates = entries.map((entry) =>
    buildIdentityCandidate(entry),
  );
  const diagnosis = diagnoseAgentIdentity(selector, identityCandidates);

  if (diagnosis.kind === "resolved") {
    const match =
      candidates.find(
        (candidate) => candidate.agentId === diagnosis.match.agentId,
      ) ?? null;
    return {
      kind: match ? "resolved" : "unresolved",
      candidate: match,
      candidates: [],
    };
  }
  if (diagnosis.kind === "ambiguous") {
    const ambiguous = diagnosis.candidates
      .map((candidate) =>
        candidates.find((entry) => entry.agentId === candidate.agentId),
      )
      .filter((candidate): candidate is ScoutMcpAgentCandidate =>
        Boolean(candidate),
      );
    const preferredAmbiguousCandidate = await findPreferredProjectLocalCandidate(
      ambiguous,
      rawLabel,
      input.currentDirectory,
    );
    if (preferredAmbiguousCandidate) {
      return {
        kind: "resolved",
        candidate: preferredAmbiguousCandidate,
        candidates: [],
      };
    }
    return { kind: "ambiguous", candidate: null, candidates: ambiguous };
  }

  return { kind: "unresolved", candidate: null, candidates: [] };
}

function defaultScoutMcpDependencies(
  env: NodeJS.ProcessEnv,
): ScoutMcpDependencies {
  return {
    resolveSenderId: (senderId, currentDirectory, scopedEnv) =>
      resolveScoutSenderId(senderId, currentDirectory, scopedEnv),
    resolveBrokerUrl: () =>
      env.OPENSCOUT_BROKER_URL?.trim() || resolveScoutBrokerUrl(),
    loadMessages: (input) => loadScoutMessages(input),
    readBrokerFeed: (input) => readScoutBrokerFeed(input),
    searchAgents: ({ query, currentDirectory, limit }) =>
      searchScoutAgentsForMcp({ query, currentDirectory, limit }),
    resolveAgent: ({ label, currentDirectory }) =>
      resolveScoutAgentForMcp({ label, currentDirectory }),
    createAgentCard: ({
      projectPath,
      agentName,
      displayName,
      harness,
      model,
      reasoningEffort,
      permissionProfile,
      currentDirectory,
      createdById,
      oneTimeUse,
      ttlMs,
    }) =>
      createScoutAgentCard({
        projectPath,
        agentName,
        displayName,
        harness,
        model,
        reasoningEffort,
        permissionProfile,
        currentDirectory,
        createdById,
        oneTimeUse,
        ttlMs,
      }),
    startAgent: ({
      projectPath,
      agentName,
      harness,
      model,
      reasoningEffort,
      permissionProfile,
      currentDirectory,
    }) =>
      upScoutAgent({
        projectPath,
        agentName,
        harness,
        model,
        reasoningEffort,
        permissionProfile,
        currentDirectory,
      }),
    attachCurrentLocalSession: ({
      externalSessionId,
      transport,
      currentDirectory,
      projectRoot,
      agentId,
      alias,
      displayName,
    }) =>
      attachScoutManagedLocalSession({
        externalSessionId,
        transport,
        currentDirectory,
        projectRoot,
        agentId,
        alias,
        displayName,
      }),
    sendMessage: ({
      senderId,
      body,
      targetLabel,
      channel,
      shouldSpeak,
      currentDirectory,
      source,
      wake,
    }) =>
      sendScoutMessage({
        senderId,
        body,
        targetLabel,
        channel,
        shouldSpeak,
        currentDirectory,
        source,
        wake,
      }),
    sendMessageToAgentIds: ({
      senderId,
      body,
      targetAgentIds,
      channel,
      shouldSpeak,
      currentDirectory,
      source,
    }) =>
      sendScoutMessageToAgentIds({
        senderId,
        body,
        targetAgentIds,
        channel,
        shouldSpeak,
        currentDirectory,
        source,
      }),
    replyMessage: ({
      senderId,
      body,
      conversationId,
      replyToMessageId,
      shouldSpeak,
      currentDirectory,
      source,
    }) =>
      replyToScoutMessage({
        senderId,
        body,
        conversationId,
        replyToMessageId,
        shouldSpeak,
        currentDirectory,
        source,
      }),
    scoutAskHandler: defaultScoutAskHandler,
    askQuestion: ({
      senderId,
      targetLabel,
      body,
      workItem,
      channel,
      shouldSpeak,
      labels,
      replyToSessionId,
      currentDirectory,
      source,
    }) =>
      askScoutQuestion({
        senderId,
        targetLabel,
        body,
        workItem,
        channel,
        shouldSpeak,
        labels,
        replyToSessionId,
        currentDirectory,
        source,
      }),
    askAgentById: ({
      senderId,
      targetAgentId,
      body,
      workItem,
      channel,
      shouldSpeak,
      labels,
      replyToSessionId,
      currentDirectory,
      source,
    }) =>
      askScoutAgentById({
        senderId,
        targetAgentId,
        body,
        workItem,
        channel,
        shouldSpeak,
        labels,
        replyToSessionId,
        currentDirectory,
        source,
      }),
    askSessionById: ({
      senderId,
      targetSessionId,
      body,
      workItem,
      channel,
      shouldSpeak,
      labels,
      replyToSessionId,
      currentDirectory,
      source,
    }) =>
      askScoutSessionById({
        senderId,
        targetSessionId,
        body,
        workItem,
        channel,
        shouldSpeak,
        labels,
        replyToSessionId,
        currentDirectory,
        source,
      }),
    updateWorkItem: (input) => updateScoutWorkItem(input),
    waitForFlight: (baseUrl, flightId, options) =>
      waitForScoutFlight(baseUrl, flightId, options),
    getFlight: (baseUrl, flightId) => loadScoutFlight(baseUrl, flightId),
    getInvocationLifecycle: (baseUrl, invocationId) =>
      loadScoutInvocationLifecycle(baseUrl, invocationId),
    readLabelBrief: (label, baseUrl) => readScoutLabelBrief(label, baseUrl),
    readLabelFeed: (label, baseUrl, options) =>
      readScoutLabelFeed(label, options, baseUrl),
  };
}

function resolveToolCurrentDirectory(
  currentDirectory: string | undefined,
  fallback: string,
): string {
  const trimmed = currentDirectory?.trim();
  return trimmed || fallback;
}

export function createScoutMcpServer(options: {
  defaultCurrentDirectory: string;
  env?: NodeJS.ProcessEnv;
  dependencies?: Partial<ScoutMcpDependencies>;
}): McpServer {
  const env = options.env ?? process.env;
  const deps: ScoutMcpDependencies = {
    ...defaultScoutMcpDependencies(env),
    ...options.dependencies,
  };

  const server = new McpServer({
    name: "openscout",
    version: SCOUT_APP_VERSION,
  });

  server.registerTool(
    "whoami",
    {
      title: "Scout Whoami",
      description:
        "Inspect the default Scout sender identity and broker URL for a working directory. Use this when host or workspace context is unclear; direct ask and messages_send calls can route without a whoami preflight.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
      }),
      outputSchema: whoAmISchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, senderId }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const defaultSenderId = await resolveMcpSenderId(
        deps,
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        brokerUrl: deps.resolveBrokerUrl(),
        defaultSenderId,
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "messages_inbox",
    {
      title: "Read Scout Inbox",
      description:
        "Read recent direct or addressed Scout broker messages for the current sender identity. Use this instead of curling broker HTTP endpoints when an MCP host needs its latest messages.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        since: z.number().optional(),
      }),
      outputSchema: messagesInboxResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, senderId, limit, since }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedSenderId = await resolveMcpSenderId(
        deps,
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const brokerUrl = deps.resolveBrokerUrl();
      const resolvedLimit = limit ?? 20;
      const messages = await deps.loadMessages({
        participantId: resolvedSenderId,
        inboxOnly: true,
        since,
        limit: resolvedLimit,
        baseUrl: brokerUrl,
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        brokerUrl,
        senderId: resolvedSenderId,
        limit: resolvedLimit,
        since: since ?? null,
        messages,
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "messages_channel",
    {
      title: "Read Scout Channel",
      description:
        "Read recent Scout broker messages from a named channel. Use this instead of curling broker HTTP endpoints when an MCP host needs channel history.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        channel: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        since: z.number().optional(),
      }),
      outputSchema: messagesChannelResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, channel, limit, since }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const brokerUrl = deps.resolveBrokerUrl();
      const resolvedChannel = channel?.trim() || "shared";
      const resolvedLimit = limit ?? 20;
      const messages = await deps.loadMessages({
        channel: resolvedChannel,
        since,
        limit: resolvedLimit,
        baseUrl: brokerUrl,
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        brokerUrl,
        channel: resolvedChannel,
        limit: resolvedLimit,
        since: since ?? null,
        messages,
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "broker_feed",
    {
      title: "Read Agent Broker Feed",
      description:
        "Fetch a native broker view of messages, status, delivery, dispatch, unblock, and error records for one agent. Use this instead of stitching together messages, flights, deliveries, and broker errors by hand.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        agentId: z.string().optional(),
        since: z.number().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        includeAcknowledged: z.boolean().optional(),
      }),
      outputSchema: brokerFeedSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, senderId, agentId, since, limit, includeAcknowledged }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedAgentId = agentId?.trim()
        || await resolveMcpSenderId(
          deps,
          senderId,
          resolvedCurrentDirectory,
          env,
        );
      const brokerUrl = deps.resolveBrokerUrl();
      const resolvedLimit = limit ?? 80;
      const feed = await deps.readBrokerFeed({
        agentId: resolvedAgentId,
        since: since ?? null,
        limit: resolvedLimit,
        includeAcknowledged: includeAcknowledged ?? false,
        baseUrl: brokerUrl,
      });
      if (!feed) {
        const empty = {
          currentDirectory: resolvedCurrentDirectory,
          brokerUrl,
          found: false,
          agentId: resolvedAgentId,
          generatedAt: Date.now(),
          since: since ?? null,
          limit: resolvedLimit,
          cursor: null,
          status: {
            agentId: resolvedAgentId,
            found: false,
            endpoints: [],
            activeFlightIds: [],
            pendingDeliveryIds: [],
            errorCount: 0,
            warningCount: 0,
          },
          counts: {
            items: 0,
            messages: 0,
            statuses: 0,
            invocations: 0,
            flights: 0,
            deliveries: 0,
            deliveryAttempts: 0,
            dispatches: 0,
            unblockRequests: 0,
            errors: 0,
            warnings: 0,
          },
          items: [],
        };
        return {
          content: createPlainTextContent(`Scout broker is not reachable; broker feed for ${resolvedAgentId} is unavailable.`),
          structuredContent: empty,
        };
      }
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        brokerUrl,
        found: feed.status.found,
        ...feed,
      };
      return {
        content: createPlainTextContent(renderMcpBrokerFeedSummary(structuredContent)),
        structuredContent,
      };
    },
  );



  server.registerTool(
    "current_reply_context",
    {
      title: "Current Scout Reply Context",
      description:
        "Inspect whether this MCP host has an active Scout broker reply context. Use this to distinguish replying to an inbound Scout ask from sending a new message.",
      inputSchema: z.object({}),
      outputSchema: currentReplyContextResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const context = parseScoutReplyContextFromEnv(env);
      const structuredContent = {
        active: Boolean(context),
        context,
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "messages_reply",
    {
      title: "Reply to Scout Message",
      description:
        "Reply to the active inbound Scout broker ask. If conversationId and replyToMessageId are omitted, this uses the active ScoutReplyContext. If there is no active context, use messages_send for a new message or pass both ids explicitly.",
      inputSchema: z.object({
        body: z.string().min(1),
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        conversationId: z.string().optional(),
        replyToMessageId: z.string().optional(),
        shouldSpeak: z.boolean().optional(),
      }),
      outputSchema: replyResultSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({
      body,
      currentDirectory,
      senderId,
      conversationId,
      replyToMessageId,
      shouldSpeak,
    }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const context = parseScoutReplyContextFromEnv(env);
      const resolvedConversationId = conversationId?.trim() || context?.conversationId || "";
      const resolvedReplyToMessageId = replyToMessageId?.trim() || context?.replyToMessageId || "";
      const resolvedSenderId = await resolveMcpSenderId(
        deps,
        senderId ?? context?.toAgentId,
        resolvedCurrentDirectory,
        env,
      );

      if (!resolvedConversationId || !resolvedReplyToMessageId) {
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          usedBroker: true,
          conversationId: resolvedConversationId || null,
          messageId: null,
          replyToMessageId: resolvedReplyToMessageId || null,
          notifiedActorIds: [],
          routingError: "missing_reply_context" as const,
        };
        return {
          content: createPlainTextContent(
            "No active Scout broker reply context. Use messages_send for a new message, or pass conversationId and replyToMessageId explicitly.",
          ),
          structuredContent,
        };
      }

      const result = await deps.replyMessage({
        senderId: resolvedSenderId,
        body,
        conversationId: resolvedConversationId,
        replyToMessageId: resolvedReplyToMessageId,
        shouldSpeak,
        currentDirectory: resolvedCurrentDirectory,
        source: "scout-mcp",
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        usedBroker: result.usedBroker,
        conversationId: result.conversationId ?? resolvedConversationId,
        messageId: result.messageId ?? null,
        replyToMessageId: result.replyToMessageId ?? resolvedReplyToMessageId,
        notifiedActorIds: result.notifiedActorIds,
        routingError: result.routingError ?? null,
      };
      return {
        content: createPlainTextContent(
          result.routingError
            ? `Reply was not sent: ${result.routingError}.`
            : `Reply sent in ${structuredContent.conversationId}${structuredContent.messageId ? ` (${structuredContent.messageId})` : ""}.`,
        ),
        structuredContent,
      };
    },
  );


  server.registerTool(
    "session_attach_current",
    {
      title: "Attach Current Codex Session",
      description:
        "Attach the current live Codex session to Scout so other agents can route direct messages and asks back to it. This requires a Codex host that exposes CODEX_THREAD_ID; Claude and other hosts do not support this attach path yet.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        projectPath: z.string().optional(),
        agentId: z.string().optional(),
        alias: z.string().optional(),
        displayName: z.string().optional(),
      }),
      outputSchema: currentSessionAttachResultSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, projectPath, agentId, alias, displayName }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const externalSessionId = resolveCurrentCodexThreadId(env);
      const attached = await deps.attachCurrentLocalSession({
        externalSessionId,
        transport: "codex_app_server",
        currentDirectory: resolvedCurrentDirectory,
        projectRoot: projectPath?.trim() ? resolve(projectPath.trim()) : undefined,
        agentId: agentId?.trim() || undefined,
        alias: alias?.trim() || undefined,
        displayName: displayName?.trim() || undefined,
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        externalSessionId,
        transport: "codex_app_server" as const,
        agentId: attached.agentId,
        selector: attached.selector ?? null,
        endpointId: attached.endpointId,
        sessionId: attached.sessionId,
      };
      return {
        content: createPlainTextContent(
          attached.selector
            ? `Current Codex session attached as ${attached.selector}.`
            : `Current Codex session attached as ${attached.agentId}.`,
        ),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "card_create",
    {
      title: "Create Scout Agent Card",
      description:
        "Create a Scout agent card with a reply-ready return address. Agent-created cards default to one-time use so short-lived review/probe identities do not crowd the system; pass oneTimeUse=false for a persistent card. One target stays private by default; group coordination still requires an explicit channel elsewhere.",
      inputSchema: z.object({
        projectPath: z.string().optional(),
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        agentName: z.string().optional(),
        displayName: z.string().optional(),
        harness: z.enum(LOCAL_AGENT_HARNESS_VALUES).optional(),
        model: z.string().optional(),
        reasoningEffort: z.string().optional(),
        permissionProfile: z.string().optional(),
        oneTimeUse: z.boolean().optional(),
        ttlSeconds: z.number().positive().optional(),
      }),
      outputSchema: cardCreateResultSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({
      projectPath,
      currentDirectory,
      senderId,
      agentName,
      displayName,
      harness,
      model,
      reasoningEffort,
      permissionProfile,
      oneTimeUse,
      ttlSeconds,
    }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedSenderId = await resolveMcpSenderId(
        deps,
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const card = await deps.createAgentCard({
        projectPath: resolve(projectPath?.trim() || resolvedCurrentDirectory),
        agentName: agentName?.trim() || undefined,
        displayName: displayName?.trim() || undefined,
        harness,
        model: model?.trim() || undefined,
        reasoningEffort: reasoningEffort?.trim() || undefined,
        permissionProfile: permissionProfile?.trim() || undefined,
        currentDirectory: resolvedCurrentDirectory,
        createdById: resolvedSenderId,
        oneTimeUse: oneTimeUse ?? true,
        ttlMs: ttlSeconds === undefined ? undefined : Math.round(ttlSeconds * 1000),
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        card,
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "agents_start",
    {
      title: "Start Scout Agent",
      description:
        "Start or create a concrete local Scout agent session before routing work to it. Use this when the user asks for a new session, or when a precise label such as @openscout#claude is unresolved. For agent-to-agent work, retry with ask after the session exists.",
      inputSchema: z.object({
        targetLabel: z
          .string()
          .describe(
            "Optional desired Scout label, such as @openscout#claude?sonnet. Explicit fields override values inferred from this label.",
          )
          .optional(),
        agentName: z.string().optional(),
        projectPath: z.string().optional(),
        currentDirectory: z.string().optional(),
        harness: z.enum(LOCAL_AGENT_HARNESS_VALUES).optional(),
        model: z.string().optional(),
        reasoningEffort: z.string().optional(),
        permissionProfile: z.string().optional(),
      }),
      outputSchema: agentStartResultSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({
      targetLabel,
      agentName,
      projectPath,
      currentDirectory,
      harness,
      model,
      reasoningEffort,
      permissionProfile,
    }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const parsedLabel = parseStartTargetLabel(targetLabel);
      const resolvedAgentName =
        agentName?.trim() || parsedLabel.agentName || undefined;
      const resolvedHarness = harness ?? parsedLabel.harness ?? undefined;
      const resolvedModel = model?.trim() || parsedLabel.model || undefined;
      const resolvedProjectPath = resolve(
        projectPath?.trim() || resolvedCurrentDirectory,
      );
      const agent = await deps.startAgent({
        projectPath: resolvedProjectPath,
        agentName: resolvedAgentName,
        harness: resolvedHarness,
        model: resolvedModel,
        reasoningEffort: reasoningEffort?.trim() || undefined,
        permissionProfile: permissionProfile?.trim() || undefined,
        currentDirectory: resolvedCurrentDirectory,
      });
      const nextTargetLabel = resolvedModel
        ? `@${agent.definitionId}#${agent.harness}?${resolvedModel}`
        : `@${agent.definitionId}#${agent.harness}`;
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        requestedLabel: targetLabel?.trim() || null,
        agentName: resolvedAgentName ?? null,
        projectPath: resolvedProjectPath,
        harness: resolvedHarness ?? null,
        model: resolvedModel ?? null,
        agent,
        exactTargetAgentId: agent.agentId,
        nextTargetLabel,
      };
      return {
        content: createPlainTextContent(
          `Started ${agent.agentId} (${agent.harness}) for ${agent.projectRoot}. Use exactTargetAgentId="${agent.agentId}" for the next route.`,
        ),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "agents_search",
    {
      title: "Search Scout Agents",
      description:
        "Search the live Scout broker and discovered agent inventory for routing candidates. Use this when the target is unknown or ambiguous, not as a required preflight for every send.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Partial handle, label, or display name to search for")
          .optional(),
        currentDirectory: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      outputSchema: searchResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: createToolUiMeta(),
    },
    async ({ query, currentDirectory, limit }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const candidates = await deps.searchAgents({
        query,
        currentDirectory: resolvedCurrentDirectory,
        limit,
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        query: query?.trim() ?? "",
        candidates,
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "agents_resolve",
    {
      title: "Resolve Scout Agent",
      description:
        "Resolve one exact Scout agent handle or return ambiguity details. Use this when a short handle may be ambiguous; explicit target sends can let the broker resolve in one call.",
      inputSchema: z.object({
        label: z
          .string()
          .min(1)
          .describe("Scout agent handle or selector, such as @talkie or @talkie#codex?5.5"),
        currentDirectory: z.string().optional(),
      }),
      outputSchema: resolveResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: createToolUiMeta(),
    },
    async ({ label, currentDirectory }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolution = await deps.resolveAgent({
        label,
        currentDirectory: resolvedCurrentDirectory,
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        label,
        kind: resolution.kind,
        candidate: resolution.candidate,
        candidates: resolution.candidates,
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "ask",
    {
      title: "Ask",
      description:
        "Ask another agent to answer, review, try, build, compare, or give feedback. This is the normal agent-to-agent ask primitive: pass who to ask in `to`, or pass `projectPath` when you know the project root and want Scout to choose the concrete agent. Scout resolves, routes, wakes when possible, and returns a compact receipt. Use discovery tools only when you need broker help rather than agent work.",
      inputSchema: z.object({
        to: z
          .string()
          .min(1)
          .optional()
          .describe("Agent id, label, sibling, specialist, or recent collaborator."),
        targetSessionId: targetSessionIdInputSchema,
        projectPath: z
          .string()
          .min(1)
          .optional()
          .describe("Project root to ask; Scout resolves the owning agent."),
        body: z.string().min(1),
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        replyToSessionId: z
          .string()
          .optional()
          .describe(
            "Optional requester session that should receive the eventual reply. When omitted, Codex MCP uses the current CODEX_THREAD_ID when available.",
          ),
        harness: z.enum(LOCAL_AGENT_HARNESS_VALUES).optional(),
        workspace: z.enum(["same", "new_worktree"]).optional(),
        session: z.enum(["reuse", "new"]).optional(),
        wait: z.boolean().optional(),
      }),
      outputSchema: askReceiptSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: createToolUiMeta({
        to: createAgentPickerFieldMeta({
          selection: "single",
          valueField: "label",
          resolveTool: "agents_resolve",
        }),
      }),
    },
    async ({
      to,
      targetSessionId,
      projectPath,
      body,
      currentDirectory,
      senderId,
      replyToSessionId,
      harness,
      workspace,
      session,
      wait,
    }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedSenderId = await resolveMcpSenderId(
        deps,
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const resolvedReplyToSessionId = resolveMcpReplyToSessionId(
        replyToSessionId,
        env,
      );
      const targetSession = targetSessionId?.trim();
      const targetTo = targetSession ? `session:${targetSession}` : to?.trim();
      const targetProjectPath = projectPath?.trim();
      let structuredContent = targetTo && targetProjectPath
        ? {
            ok: false,
            state: "failed" as const,
            ids: {},
            error: {
              code: "invalid_request" as const,
              message: "provide either to or projectPath, not both",
            },
          }
        : await deps.scoutAskHandler({
            senderId: resolvedSenderId,
            ...(targetProjectPath
              ? { projectPath: targetProjectPath }
              : { to: targetTo ?? "" }),
            body,
            ...(harness ? { harness } : {}),
            ...(workspace ? { workspace } : {}),
            ...(session ? { session } : {}),
            ...(resolvedReplyToSessionId ? { replyToSessionId: resolvedReplyToSessionId } : {}),
            currentDirectory: resolvedCurrentDirectory,
            source: "scout-mcp",
          });

      if (wait && structuredContent.ids.flightId) {
        try {
          const flight = await deps.waitForFlight(
            deps.resolveBrokerUrl(),
            structuredContent.ids.flightId,
          );
          structuredContent = {
            ...structuredContent,
            state: flight.state === "completed"
              ? "completed"
              : flight.state === "failed" || flight.state === "cancelled"
                ? "failed"
                : "queued",
            ok: flight.state !== "failed" && flight.state !== "cancelled",
            ids: {
              ...structuredContent.ids,
              targetAgentId: flight.targetAgentId,
              invocationId: flight.invocationId,
              flightId: flight.id,
            },
          };
        } catch {
          // Keep the initial receipt; callers can follow by flight id.
        }
      }

      return {
        content: createPlainTextContent(
          renderMcpAskPrimitiveSummary(structuredContent),
        ),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "messages_send",
    {
      title: "Send Scout Message",
      description:
        "Post a broker-backed Scout tell/update. Use this for heads-up, replies, and status. Pass targets as fields: one explicit target without a channel becomes a DM, group delivery requires an explicit channel, and the body remains payload text. Targeted DMs are dispatched by the broker when the target can be reached; callers should not preflight wake/session mechanics. Use targetAgentId when agents_start returned exactTargetAgentId; this bypasses label resolution. Use channel='shared' only for shared updates. Pass targetLabel for the single-call broker-resolved path; mentionAgentIds remains available for exact-id compatibility. If a requested new or precise target is unresolved or mismatched, call agents_start and retry with the returned exactTargetAgentId instead of substituting a different agent. For agent-to-agent work, use ask instead.",
      inputSchema: z.object({
        body: z.string().min(1),
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        targetAgentId: targetAgentIdInputSchema,
        targetLabel: targetLabelInputSchema,
        channel: z.string().optional(),
        shouldSpeak: z.boolean().optional(),
        mentionAgentIds: mentionAgentIdsInputSchema,
        wake: z
          .boolean()
          .describe(
            "Advanced override: force a visible wake turn after posting. Omit this for normal targeted DMs; the broker dispatches reachable targets automatically.",
          )
          .optional(),
      }),
      outputSchema: sendResultSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: createToolUiMeta({
        targetAgentId: createAgentPickerFieldMeta({
          selection: "single",
          valueField: "agentId",
        }),
        targetLabel: createAgentPickerFieldMeta({
          selection: "single",
          valueField: "label",
          resolveTool: "agents_resolve",
        }),
        mentionAgentIds: createAgentPickerFieldMeta({
          selection: "multiple",
          valueField: "agentId",
        }),
      }),
    },
    async ({
      body,
      currentDirectory,
      senderId,
      targetAgentId,
      targetLabel,
      channel,
      shouldSpeak,
      mentionAgentIds,
      wake,
    }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedSenderId = await resolveMcpSenderId(
        deps,
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const explicitTargetIds = [
        ...new Set(
          [
            targetAgentId,
            ...(mentionAgentIds ?? []),
          ].map((value) => value?.trim()).filter((value): value is string =>
            Boolean(value),
          ),
        ),
      ];

      if (explicitTargetIds.length > 0) {
        if (wake) {
          const results = await Promise.all(
            explicitTargetIds.map((targetAgentId) =>
              deps.askAgentById({
                senderId: resolvedSenderId,
                targetAgentId,
                body,
                channel,
                shouldSpeak,
                currentDirectory: resolvedCurrentDirectory,
                source: "scout-mcp",
              }),
            ),
          );
          const firstResult = results[0];
          const firstFlight = results.find((result) => result.flight)?.flight ?? null;
          const unresolvedTargetIds = results
            .map((result) => result.unresolvedTargetId)
            .filter((value): value is string => Boolean(value));
          const targetDiagnostic =
            firstResult?.targetDiagnostic ??
            buildExactTargetIdsDiagnostic(unresolvedTargetIds);
          const startSuggestion = null;
          const followArtifacts = buildScoutFollowArtifacts(
            {
              flight: firstFlight,
              conversationId: firstResult?.conversationId ?? null,
              workItem: null,
              targetAgentId: firstFlight?.targetAgentId ?? null,
            },
            env,
          );
          const structuredContent = {
            currentDirectory: resolvedCurrentDirectory,
            senderId: resolvedSenderId,
            mode: "explicit_targets" as const,
            usedBroker: results.some((result) => result.usedBroker),
            conversationId: firstResult?.conversationId ?? null,
            messageId: firstResult?.messageId ?? null,
            flightId: firstFlight?.id ?? null,
            wake: true,
            invokedTargetIds: results
              .map((result) => result.flight?.targetAgentId)
              .filter((value): value is string => Boolean(value)),
            unresolvedTargetIds,
            targetDiagnostic,
            startSuggestion,
            routingAdvice: null,
            routeKind: null,
            routingError: null,
            ids: followArtifacts.ids,
            links: followArtifacts.links,
            followUrl: followArtifacts.followUrl,
          };
          return {
            content: createPlainTextContent(
              renderMcpSendSummary(structuredContent),
            ),
            structuredContent,
          };
        }

        const result = await deps.sendMessageToAgentIds({
          senderId: resolvedSenderId,
          body,
          targetAgentIds: explicitTargetIds,
          channel,
          shouldSpeak,
          currentDirectory: resolvedCurrentDirectory,
          source: "scout-mcp",
        });
        const startSuggestion = null;
        const followArtifacts = buildScoutFollowArtifacts(
          {
            flight: result.flight ?? null,
            conversationId: result.conversationId ?? null,
            workItem: null,
            targetAgentId: result.flight?.targetAgentId ?? null,
          },
          env,
        );
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          mode: "explicit_targets" as const,
          usedBroker: result.usedBroker,
          conversationId: result.conversationId ?? null,
          messageId: result.messageId ?? null,
          flightId: result.flight?.id ?? null,
          wake: wake ?? false,
          invokedTargetIds: result.invokedTargetIds,
          unresolvedTargetIds: result.unresolvedTargetIds,
          targetDiagnostic:
            result.targetDiagnostic ??
            buildExactTargetIdsDiagnostic(result.unresolvedTargetIds),
          startSuggestion,
          routingAdvice: buildSendRoutingAdvice(result.routingError ?? null),
          routeKind: result.routeKind ?? null,
          routingError: result.routingError ?? null,
          ids: followArtifacts.ids,
          links: followArtifacts.links,
          followUrl: followArtifacts.followUrl,
        };
        return {
          content: createPlainTextContent(
            renderMcpSendSummary(structuredContent),
          ),
          structuredContent,
        };
      }

      if (targetLabel?.trim()) {
        const targetCheck = await diagnosePreciseTargetLabel({
          deps,
          targetLabel,
          currentDirectory: resolvedCurrentDirectory,
        });
        if (targetCheck.blocked) {
          const structuredContent = {
            currentDirectory: resolvedCurrentDirectory,
            senderId: resolvedSenderId,
            mode: "target_label" as const,
            usedBroker: true,
            conversationId: null,
            messageId: null,
            flightId: null,
            wake: wake ?? false,
            bindingRef: null,
            invokedTargetIds: [],
            unresolvedTargetIds: [targetLabel.trim()],
            targetDiagnostic: targetCheck.diagnostic,
            startSuggestion: targetCheck.startSuggestion,
            routingAdvice: null,
            routeKind: null,
            routingError: null,
          };
          return {
            content: createPlainTextContent(
              renderMcpSendSummary(structuredContent),
            ),
            structuredContent,
          };
        }
        const result = await deps.sendMessage({
          senderId: resolvedSenderId,
          body,
          targetLabel: targetLabel.trim(),
          channel,
          shouldSpeak,
          currentDirectory: resolvedCurrentDirectory,
          source: "scout-mcp",
          wake,
        });
        const startSuggestion = result.unresolvedTargets.length > 0
          ? await buildStartSuggestionForTarget(
            result.unresolvedTargets[0] ?? targetLabel.trim(),
            resolvedCurrentDirectory,
          )
          : null;
        const followArtifacts = buildScoutFollowArtifacts(
          {
            flight: result.flight ?? null,
            conversationId: result.conversationId ?? null,
            workItem: null,
            targetAgentId: result.flight?.targetAgentId ?? null,
          },
          env,
        );
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          mode: "target_label" as const,
          usedBroker: result.usedBroker,
          conversationId: result.conversationId ?? null,
          messageId: result.messageId ?? null,
          flightId: result.flight?.id ?? null,
          wake: wake ?? false,
          bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
          invokedTargetIds: result.invokedTargets,
          unresolvedTargetIds: result.unresolvedTargets,
          targetDiagnostic: result.targetDiagnostic ?? null,
          startSuggestion,
          routingAdvice: buildSendRoutingAdvice(result.routingError ?? null),
          routeKind: result.routeKind ?? null,
          routingError: result.routingError ?? null,
          ids: followArtifacts.ids,
          links: followArtifacts.links,
          followUrl: followArtifacts.followUrl,
        };
        return {
          content: createPlainTextContent(
            renderMcpSendSummary(structuredContent),
          ),
          structuredContent,
        };
      }

      const result = await deps.sendMessage({
        senderId: resolvedSenderId,
        body,
        channel,
        shouldSpeak,
        currentDirectory: resolvedCurrentDirectory,
        source: "scout-mcp",
        wake,
      });
      const startSuggestion = result.unresolvedTargets.length > 0
        ? await buildStartSuggestionForTarget(
          result.unresolvedTargets[0],
          resolvedCurrentDirectory,
        )
        : null;
      const followArtifacts = buildScoutFollowArtifacts(
        {
          flight: result.flight ?? null,
          conversationId: result.conversationId ?? null,
          workItem: null,
          targetAgentId: result.flight?.targetAgentId ?? null,
        },
        env,
      );
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        mode: "body_mentions" as const,
        usedBroker: result.usedBroker,
        conversationId: result.conversationId ?? null,
        messageId: result.messageId ?? null,
        flightId: result.flight?.id ?? null,
        wake: wake ?? false,
        bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
        invokedTargetIds: result.invokedTargets,
        unresolvedTargetIds: result.unresolvedTargets,
        targetDiagnostic: result.targetDiagnostic ?? null,
        startSuggestion,
        routingAdvice: buildSendRoutingAdvice(result.routingError ?? null),
        routeKind: result.routeKind ?? null,
        routingError: result.routingError ?? null,
        ids: followArtifacts.ids,
        links: followArtifacts.links,
        followUrl: followArtifacts.followUrl,
      };
      return {
        content: createPlainTextContent(
          renderMcpSendSummary(structuredContent),
        ),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "invocations_ask",
    {
      title: "Create Scout Invocation",
      description:
        "Low-level broker-backed invocation handoff. For normal agent-to-agent work, use ask. Use this only when you need exact invocation controls such as targetSessionId, targetAgentId, workItem, or replyMode. Pass targetSessionId to continue a specific live session; omit it to let the broker create or choose a fresh lightweight session for the target. Pass targetLabel or targetAgentId as routing fields when you do not have a session id. replyMode='inline' returns once the invocation is acknowledged or already complete; use invocations_wait for a longer follow-up poll. replyMode='notify' returns immediately and emits notifications/scout/reply later; replyMode='none' returns the durable receipt only. awaitReply is kept as a boolean alias for replyMode='inline'.",
      inputSchema: z
        .object({
          body: z.string().min(1),
          currentDirectory: z.string().optional(),
          senderId: z.string().optional(),
          targetSessionId: targetSessionIdInputSchema,
          targetAgentId: targetAgentIdInputSchema,
          targetLabel: targetLabelInputSchema,
          replyToSessionId: z
            .string()
            .describe(
              "Optional requester session that should receive the eventual reply. When omitted, Codex MCP uses the current CODEX_THREAD_ID when available.",
            )
            .optional(),
          labels: z.array(z.string()).optional(),
          workItem: workItemInputSchema.optional(),
          channel: z.string().optional(),
          shouldSpeak: z.boolean().optional(),
          awaitReply: z
            .boolean()
            .describe("Compatibility alias for replyMode='inline'.")
            .optional(),
          replyMode: z
            .enum(REPLY_MODE_VALUES)
            .describe(
              "Reply delivery mode: 'inline' returns a quick acknowledgement or immediate completion, 'notify' returns immediately then emits notifications/scout/reply, and 'none' returns durable ids only. Inline acknowledgement waits default to 30 seconds unless timeoutSeconds is set.",
            )
            .optional(),
          timeoutSeconds: z.number().int().min(1).optional(),
        })
        .refine(
          (value) =>
            Boolean(value.targetSessionId?.trim() || value.targetAgentId?.trim() || value.targetLabel?.trim()),
          {
            message: "Provide targetSessionId, targetAgentId, or targetLabel.",
            path: ["targetSessionId"],
          },
        ),
      outputSchema: askResultSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: createToolUiMeta({
        targetSessionId: createAgentPickerFieldMeta({
          selection: "single",
          valueField: "sessionId",
        }),
        targetAgentId: createAgentPickerFieldMeta({
          selection: "single",
          valueField: "agentId",
        }),
        targetLabel: createAgentPickerFieldMeta({
          selection: "single",
          valueField: "label",
          resolveTool: "agents_resolve",
        }),
      }),
    },
    async ({
      body,
      currentDirectory,
      senderId,
      targetSessionId,
      targetAgentId,
      targetLabel,
      replyToSessionId,
      labels,
      workItem,
      channel,
      shouldSpeak,
      awaitReply,
      replyMode,
      timeoutSeconds,
    }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedSenderId = await resolveMcpSenderId(
        deps,
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const resolvedReplyMode = resolveAskReplyMode({ awaitReply, replyMode });
      const shouldAwait = resolvedReplyMode === "inline";
      const resolvedReplyToSessionId = resolveMcpReplyToSessionId(
        replyToSessionId,
        env,
      );

      if (targetSessionId?.trim()) {
        const trimmedTargetSessionId = targetSessionId.trim();
        const result = await deps.askSessionById({
          senderId: resolvedSenderId,
          targetSessionId: trimmedTargetSessionId,
          body,
          workItem,
          channel,
          shouldSpeak,
          labels,
          replyToSessionId: resolvedReplyToSessionId,
          currentDirectory: resolvedCurrentDirectory,
          source: "scout-mcp",
        });
        const waitResult = shouldAwait
          ? await waitForFlightForMcp({
              deps,
              brokerUrl: deps.resolveBrokerUrl(),
              flight: result.flight ?? null,
              timeoutSeconds,
            })
          : { flight: null, waitStatus: "not_requested" as const };
        const completedFlight = waitResult.flight;
        const trackedWorkItem = result.workItem ?? null;
        const notificationScheduled =
          resolvedReplyMode === "notify" && Boolean(result.flight);
        const followArtifacts = buildScoutFollowArtifacts(
          {
            flight: completedFlight ?? result.flight ?? null,
            conversationId: result.conversationId ?? null,
            workItem: trackedWorkItem,
            targetSessionId: trimmedTargetSessionId,
            targetAgentId: result.flight?.targetAgentId ?? null,
          },
          env,
        );
        if (resolvedReplyMode === "notify" && result.flight) {
          scheduleScoutReplyNotification({
            server,
            deps,
            brokerUrl: deps.resolveBrokerUrl(),
            flight: result.flight,
            timeoutSeconds,
            context: {
              currentDirectory: resolvedCurrentDirectory,
              senderId: resolvedSenderId,
              targetAgentId: result.flight.targetAgentId ?? null,
              targetLabel: null,
              conversationId: result.conversationId ?? null,
              messageId: result.messageId ?? null,
              flightId: result.flight.id,
              workItem: trackedWorkItem,
              workId: trackedWorkItem?.id ?? null,
              workUrl: workUrlFor(trackedWorkItem, env),
              ids: followArtifacts.ids,
              links: followArtifacts.links,
              followUrl: followArtifacts.followUrl,
            },
          });
        }
        const unresolvedTargetId = result.unresolvedTargetId ?? null;
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          targetAgentId: result.flight?.targetAgentId ?? null,
          targetSessionId: trimmedTargetSessionId,
          targetLabel: null,
          replyToSessionId: resolvedReplyToSessionId ?? null,
          usedBroker: result.usedBroker,
          awaited: shouldAwait,
          waitStatus: waitResult.waitStatus,
          replyMode: resolvedReplyMode,
          delivery: notificationScheduled
            ? "mcp_notification" as const
            : shouldAwait
              ? "inline" as const
              : "none" as const,
          notification: resolvedReplyMode === "notify"
            ? {
                method: "notifications/scout/reply" as const,
                status: notificationScheduled ? "scheduled" as const : "not_scheduled" as const,
              }
            : null,
          conversationId: result.conversationId ?? null,
          messageId: result.messageId ?? null,
          flight: completedFlight ?? result.flight ?? null,
          flightId: completedFlight?.id ?? result.flight?.id ?? null,
          output:
            waitResult.waitStatus === "completed" || waitResult.waitStatus === "terminal"
              ? completedFlight?.output ?? completedFlight?.summary ?? null
              : null,
          unresolvedTargetId,
          unresolvedTargetLabel: null,
          workItem: trackedWorkItem,
          workId: trackedWorkItem?.id ?? null,
          workUrl: workUrlFor(trackedWorkItem, env),
          ids: followArtifacts.ids,
          links: followArtifacts.links,
          followUrl: followArtifacts.followUrl,
          targetDiagnostic:
            result.targetDiagnostic ??
            buildExactTargetIdsDiagnostic(unresolvedTargetId ? [unresolvedTargetId] : []),
          startSuggestion: null,
        };
        return {
          content: createPlainTextContent(
            renderMcpAskSummary(structuredContent),
          ),
          structuredContent,
        };
      }

      if (targetAgentId?.trim()) {
        const result = await deps.askAgentById({
          senderId: resolvedSenderId,
          targetAgentId: targetAgentId.trim(),
          body,
          workItem,
          channel,
          shouldSpeak,
          labels,
          replyToSessionId: resolvedReplyToSessionId,
          currentDirectory: resolvedCurrentDirectory,
          source: "scout-mcp",
        });
        const waitResult = shouldAwait
          ? await waitForFlightForMcp({
              deps,
              brokerUrl: deps.resolveBrokerUrl(),
              flight: result.flight ?? null,
              timeoutSeconds,
            })
          : { flight: null, waitStatus: "not_requested" as const };
        const completedFlight = waitResult.flight;
        const trackedWorkItem = result.workItem ?? null;
        const notificationScheduled =
          resolvedReplyMode === "notify" && Boolean(result.flight);
        const followArtifacts = buildScoutFollowArtifacts(
          {
            flight: completedFlight ?? result.flight ?? null,
            conversationId: result.conversationId ?? null,
            workItem: trackedWorkItem,
            targetAgentId: targetAgentId.trim(),
          },
          env,
        );
        if (resolvedReplyMode === "notify" && result.flight) {
          scheduleScoutReplyNotification({
            server,
            deps,
            brokerUrl: deps.resolveBrokerUrl(),
            flight: result.flight,
            timeoutSeconds,
            context: {
              currentDirectory: resolvedCurrentDirectory,
              senderId: resolvedSenderId,
              targetAgentId: targetAgentId.trim(),
              targetLabel: null,
              conversationId: result.conversationId ?? null,
              messageId: result.messageId ?? null,
              flightId: result.flight.id,
              workItem: trackedWorkItem,
              workId: trackedWorkItem?.id ?? null,
              workUrl: workUrlFor(trackedWorkItem, env),
              ids: followArtifacts.ids,
              links: followArtifacts.links,
              followUrl: followArtifacts.followUrl,
            },
          });
        }
        const unresolvedTargetId = result.unresolvedTargetId ?? null;
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          targetAgentId: targetAgentId.trim(),
          targetSessionId: null,
          targetLabel: null,
          replyToSessionId: resolvedReplyToSessionId ?? null,
          usedBroker: result.usedBroker,
          awaited: shouldAwait,
          waitStatus: waitResult.waitStatus,
          replyMode: resolvedReplyMode,
          delivery: notificationScheduled
            ? "mcp_notification" as const
            : shouldAwait
              ? "inline" as const
              : "none" as const,
          notification: resolvedReplyMode === "notify"
            ? {
                method: "notifications/scout/reply" as const,
                status: notificationScheduled ? "scheduled" as const : "not_scheduled" as const,
              }
            : null,
          conversationId: result.conversationId ?? null,
          messageId: result.messageId ?? null,
          flight: completedFlight ?? result.flight ?? null,
          flightId: completedFlight?.id ?? result.flight?.id ?? null,
          output:
            waitResult.waitStatus === "completed" || waitResult.waitStatus === "terminal"
              ? completedFlight?.output ?? completedFlight?.summary ?? null
              : null,
          unresolvedTargetId,
          unresolvedTargetLabel: null,
          workItem: trackedWorkItem,
          workId: trackedWorkItem?.id ?? null,
          workUrl: workUrlFor(trackedWorkItem, env),
          ids: followArtifacts.ids,
          links: followArtifacts.links,
          followUrl: followArtifacts.followUrl,
          targetDiagnostic:
            result.targetDiagnostic ??
            buildExactTargetIdsDiagnostic(unresolvedTargetId ? [unresolvedTargetId] : []),
          startSuggestion: null,
        };
        return {
          content: createPlainTextContent(
            renderMcpAskSummary(structuredContent),
          ),
          structuredContent,
        };
      }

      const targetCheck = await diagnosePreciseTargetLabel({
        deps,
        targetLabel,
        currentDirectory: resolvedCurrentDirectory,
      });
      if (targetCheck.blocked) {
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          targetAgentId: null,
          targetSessionId: null,
          targetLabel: targetLabel!.trim(),
          replyToSessionId: resolvedReplyToSessionId ?? null,
          usedBroker: true,
          awaited: shouldAwait,
          waitStatus: "not_requested" as const,
          replyMode: resolvedReplyMode,
          delivery: "none" as const,
          notification: null,
          conversationId: null,
          messageId: null,
          flight: null,
          flightId: null,
          output: null,
          unresolvedTargetId: null,
          unresolvedTargetLabel: targetLabel!.trim(),
          workItem: null,
          workId: null,
          workUrl: null,
          targetDiagnostic: targetCheck.diagnostic,
          startSuggestion: targetCheck.startSuggestion,
        };
        return {
          content: createPlainTextContent(
            renderMcpAskSummary(structuredContent),
          ),
          structuredContent,
        };
      }

      const result = await deps.askQuestion({
        senderId: resolvedSenderId,
        targetLabel: targetLabel!.trim(),
        body,
        workItem,
        channel,
        shouldSpeak,
        labels,
        replyToSessionId: resolvedReplyToSessionId,
        currentDirectory: resolvedCurrentDirectory,
        source: "scout-mcp",
      });
      const waitResult = shouldAwait
        ? await waitForFlightForMcp({
            deps,
            brokerUrl: deps.resolveBrokerUrl(),
            flight: result.flight ?? null,
            timeoutSeconds,
          })
        : { flight: null, waitStatus: "not_requested" as const };
      const completedFlight = waitResult.flight;
      const trackedWorkItem = result.workItem ?? null;
      const notificationScheduled =
        resolvedReplyMode === "notify" && Boolean(result.flight);
      const followArtifacts = buildScoutFollowArtifacts(
        {
          flight: completedFlight ?? result.flight ?? null,
          conversationId: result.conversationId ?? null,
          workItem: trackedWorkItem,
          targetAgentId: result.flight?.targetAgentId ?? null,
        },
        env,
      );
      if (resolvedReplyMode === "notify" && result.flight) {
        scheduleScoutReplyNotification({
          server,
          deps,
          brokerUrl: deps.resolveBrokerUrl(),
          flight: result.flight,
          timeoutSeconds,
          context: {
            currentDirectory: resolvedCurrentDirectory,
            senderId: resolvedSenderId,
            targetAgentId: result.flight.targetAgentId ?? null,
            targetLabel: targetLabel!.trim(),
            conversationId: result.conversationId ?? null,
            messageId: result.messageId ?? null,
            bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
            flightId: result.flight.id,
            workItem: trackedWorkItem,
            workId: trackedWorkItem?.id ?? null,
            workUrl: workUrlFor(trackedWorkItem, env),
            ids: followArtifacts.ids,
            links: followArtifacts.links,
            followUrl: followArtifacts.followUrl,
          },
        });
      }
      const startSuggestion = result.unresolvedTarget
        ? await buildStartSuggestionForTarget(
            result.unresolvedTarget,
            resolvedCurrentDirectory,
          )
        : null;
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        targetAgentId: result.flight?.targetAgentId ?? null,
        targetSessionId: null,
        targetLabel: targetLabel!.trim(),
        replyToSessionId: resolvedReplyToSessionId ?? null,
        usedBroker: result.usedBroker,
        awaited: shouldAwait,
        waitStatus: waitResult.waitStatus,
        replyMode: resolvedReplyMode,
        delivery: notificationScheduled
          ? "mcp_notification" as const
          : shouldAwait
            ? "inline" as const
            : "none" as const,
        notification: resolvedReplyMode === "notify"
          ? {
              method: "notifications/scout/reply" as const,
              status: notificationScheduled ? "scheduled" as const : "not_scheduled" as const,
            }
          : null,
        conversationId: result.conversationId ?? null,
        messageId: result.messageId ?? null,
        bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
        flight: completedFlight ?? result.flight ?? null,
        flightId: completedFlight?.id ?? result.flight?.id ?? null,
        output:
          waitResult.waitStatus === "completed" || waitResult.waitStatus === "terminal"
            ? completedFlight?.output ?? completedFlight?.summary ?? null
            : null,
        unresolvedTargetId: null,
        unresolvedTargetLabel: result.unresolvedTarget ?? null,
        workItem: trackedWorkItem,
        workId: trackedWorkItem?.id ?? null,
        workUrl: workUrlFor(trackedWorkItem, env),
        ids: followArtifacts.ids,
        links: followArtifacts.links,
        followUrl: followArtifacts.followUrl,
        targetDiagnostic: result.targetDiagnostic ?? null,
        startSuggestion,
      };
      return {
        content: createPlainTextContent(
          renderMcpAskSummary(structuredContent),
        ),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "invocations_get",
    {
      title: "Get Scout Ask",
      description:
        "Fetch the current broker flight state for a previously-created Scout ask or invocation. Use this with a flightId returned by ask to observe long-running work without blocking the original ask call.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        flightId: z.string().min(1),
      }),
      outputSchema: invocationLookupResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, flightId }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const trimmedFlightId = flightId.trim();
      const brokerUrl = deps.resolveBrokerUrl();
      const flight = await deps.getFlight(brokerUrl, trimmedFlightId);
      const lifecycle = await loadInvocationLifecycleForFlight({
        deps,
        brokerUrl,
        flight,
      });
      const structuredContent = buildInvocationLookupContent({
        currentDirectory: resolvedCurrentDirectory,
        flightId: trimmedFlightId,
        flight,
        lifecycle,
        waitStatus: "not_requested",
        env,
      });
      return {
        content: createPlainTextContent(
          renderInvocationLookupSummary(structuredContent),
        ),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "invocations_wait",
    {
      title: "Wait For Scout Ask",
      description:
        "Wait briefly for a previously-created Scout ask flight to finish, then return the latest flight state. This is a bounded follow-up wait, not the long-running ask submission path.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        flightId: z.string().min(1),
        timeoutSeconds: z.number().int().min(1).max(300).default(30),
      }),
      outputSchema: invocationLookupResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, flightId, timeoutSeconds }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const trimmedFlightId = flightId.trim();
      const brokerUrl = deps.resolveBrokerUrl();
      let flight: ScoutFlightRecord | null = null;
      let waitStatus: "completed" | "terminal" | "timeout" = "timeout";

      try {
        flight = await deps.waitForFlight(
          brokerUrl,
          trimmedFlightId,
          { timeoutSeconds },
        );
        waitStatus = "completed";
      } catch (error) {
        flight = await deps.getFlight(brokerUrl, trimmedFlightId);
        if (isTerminalFlightState(flight?.state)) {
          waitStatus = "terminal";
        } else if (
          !(error instanceof Error) ||
          !error.message.includes("Timed out waiting for flight")
        ) {
          throw error;
        }
      }
      const lifecycle = await loadInvocationLifecycleForFlight({
        deps,
        brokerUrl,
        flight,
      });

      const structuredContent = buildInvocationLookupContent({
        currentDirectory: resolvedCurrentDirectory,
        flightId: trimmedFlightId,
        flight,
        lifecycle,
        waitStatus,
        env,
      });
      return {
        content: createPlainTextContent(
          renderInvocationLookupSummary(structuredContent),
        ),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "labels_brief",
    {
      title: "Brief Scout Label",
      description:
        "Fetch a compact, non-chatty brief for records sharing a Scout label. Labels are lightweight coordination metadata: they can mean a goal, release, milestone, incident, or any local convention without creating a lifecycle.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        label: z.string().min(1),
      }),
      outputSchema: labelBriefSchema.extend({
        currentDirectory: z.string(),
        found: z.boolean(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, label }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const trimmedLabel = label.trim();
      const brief = await deps.readLabelBrief(trimmedLabel, deps.resolveBrokerUrl());
      if (!brief) {
        const empty = {
          currentDirectory: resolvedCurrentDirectory,
          found: false,
          label: trimmedLabel,
          generatedAt: Date.now(),
          lastActivityAt: null,
          participants: [],
          counts: {
            flights: 0,
            activeFlights: 0,
            workItems: 0,
          },
          flightsByState: {},
          activeFlights: [],
          recentFlights: [],
          workItems: [],
        };
        return {
          content: createPlainTextContent("Scout broker is not reachable; label brief is unavailable."),
          structuredContent: empty,
        };
      }
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        found: true,
        ...brief,
      };
      return {
        content: createPlainTextContent(renderMcpLabelBriefSummary(structuredContent)),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "labels_feed",
    {
      title: "Read Scout Label Feed",
      description:
        "Fetch a normalized firehose-style event backlog for records sharing a Scout label. Use this to see whether label-scoped work is moving without parsing harness-native session files.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        label: z.string().min(1),
        since: z.number().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
      outputSchema: labelFeedSchema.extend({
        currentDirectory: z.string(),
        found: z.boolean(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, label, since, limit }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const trimmedLabel = label.trim();
      const feed = await deps.readLabelFeed(trimmedLabel, deps.resolveBrokerUrl(), {
        since: since ?? null,
        limit: limit ?? 80,
      });
      if (!feed) {
        const empty = {
          currentDirectory: resolvedCurrentDirectory,
          found: false,
          label: trimmedLabel,
          generatedAt: Date.now(),
          cursor: null,
          since: since ?? null,
          counts: {
            events: 0,
            messages: 0,
            invocations: 0,
            flights: 0,
            workEvents: 0,
          },
          events: [],
        };
        return {
          content: createPlainTextContent("Scout broker is not reachable; label feed is unavailable."),
          structuredContent: empty,
        };
      }
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        found: true,
        ...feed,
      };
      return {
        content: createPlainTextContent(renderMcpLabelFeedSummary(structuredContent)),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "work_update",
    {
      title: "Update Scout Work",
      description:
        "Update a durable Scout work item and append a matching collaboration event. Use this for progress, waiting, review, and done transitions instead of sending a second ad hoc status message.",
      inputSchema: z.object({
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        work: workItemUpdateSchema,
      }),
      outputSchema: workUpdateResultSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ currentDirectory, senderId, work }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedSenderId = await resolveMcpSenderId(
        deps,
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const workItem = await deps.updateWorkItem({
        ...work,
        actorId: resolvedSenderId,
        source: "scout-mcp",
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        usedBroker: workItem !== null,
        workItem,
        workId: workItem?.id ?? null,
        workUrl: workUrlFor(workItem, env),
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  return server;
}

export async function runScoutMcpServer(options: {
  defaultCurrentDirectory: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const server = createScoutMcpServer({
    defaultCurrentDirectory: options.defaultCurrentDirectory,
    env: options.env,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
