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

import { createScoutAgentCard } from "../agents/service.ts";
import {
  askScoutAgentById,
  askScoutQuestion,
  attachScoutManagedLocalSession,
  listScoutAgents,
  loadScoutBrokerContext,
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
  type ScoutFlightRecord,
  type ScoutMessagePostResult,
  type ScoutReplyPostResult,
  type ScoutTrackedWorkItem,
  type ScoutWorkItemUpdate,
  type ScoutWorkItemInput,
  type ScoutStructuredMessagePostResult,
  type ScoutWhoEntry,
} from "../broker/service.ts";
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
const LOCAL_AGENT_HARNESS_VALUES = ["claude", "codex"] as const;
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
  valueField: "label" | "agentId";
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
  sessionId: string | null;
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
  valueField: "label" | "agentId";
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

const targetLabelInputSchema = z
  .string()
  .describe("Scout agent handle to contact, such as @talkie or @talkie#codex?5.5")
  .optional();

const targetAgentIdInputSchema = z
  .string()
  .describe("Exact Scout agent id when already known, such as talkie.master.mini")
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
};

type ScoutMcpDependencies = {
  resolveSenderId: (
    senderId: string | null | undefined,
    currentDirectory: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<string>;
  resolveBrokerUrl: () => string;
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
    currentDirectory: string;
    createdById?: string;
  }) => Promise<ScoutAgentCard>;
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
  askQuestion: (input: {
    senderId: string;
    targetLabel: string;
    body: string;
    workItem?: ScoutWorkItemInput;
    channel?: string;
    shouldSpeak?: boolean;
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
  metadata: z.record(z.string(), z.unknown()).optional(),
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
  returnAddress: scoutReturnAddressSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const whoAmISchema = z.object({
  currentDirectory: z.string(),
  brokerUrl: z.string(),
  defaultSenderId: z.string(),
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

const sendResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  mode: z.enum(["body_mentions", "explicit_targets", "target_label"]),
  usedBroker: z.boolean(),
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
  invokedTargetIds: z.array(z.string()),
  unresolvedTargetIds: z.array(z.string()),
  targetDiagnostic: z.object({}).catchall(z.unknown()).nullable(),
  routeKind: z.enum(MESSAGE_ROUTE_KIND_VALUES).nullable(),
  routingError: z.enum(MESSAGE_ROUTING_ERROR_VALUES).nullable(),
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

const currentSessionAttachResultSchema = z.object({
  currentDirectory: z.string(),
  externalSessionId: z.string(),
  transport: z.literal("codex_app_server"),
  agentId: z.string(),
  selector: z.string().nullable(),
  endpointId: z.string(),
  sessionId: z.string(),
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

const askResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  targetAgentId: z.string().nullable(),
  targetLabel: z.string().nullable(),
  usedBroker: z.boolean(),
  awaited: z.boolean(),
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

function renderMcpSendSummary(result: {
  usedBroker: boolean;
  conversationId: string | null;
  messageId: string | null;
  invokedTargetIds: string[];
  unresolvedTargetIds: string[];
  routingError: string | null;
}): string {
  if (!result.usedBroker) {
    return "Scout broker is not reachable; message was not sent.";
  }
  if (result.routingError) {
    return `Message was not sent: ${result.routingError}.`;
  }
  if (result.unresolvedTargetIds.length > 0) {
    return `Message was not sent; unresolved target(s): ${result.unresolvedTargetIds.join(", ")}.`;
  }
  const destination = result.invokedTargetIds.length > 0
    ? ` to ${result.invokedTargetIds.join(", ")}`
    : "";
  const route = result.conversationId ? ` in ${result.conversationId}` : "";
  const message = result.messageId ? ` (${result.messageId})` : "";
  return `Message sent${destination}${route}${message}.`;
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
  followUrl?: string | null;
}): string {
  if (!result.usedBroker) {
    return "Scout broker is not reachable; ask was not sent.";
  }
  const unresolved = result.unresolvedTargetId ?? result.unresolvedTargetLabel;
  if (unresolved) {
    return `Ask was not sent; unresolved target: ${unresolved}.`;
  }
  const target = result.targetAgentId ?? result.targetLabel ?? "target";
  const details = [
    result.flightId ? `flight ${result.flightId}` : null,
    result.workId ? `work ${result.workId}` : null,
  ].filter(Boolean);
  const detailText = details.length > 0 ? `; ${details.join(", ")}` : "";
  const followText = result.followUrl ? ` Follow: ${result.followUrl}` : "";
  if (result.output) {
    return result.output;
  }
  if (result.delivery === "mcp_notification") {
    return `Ask sent to ${target}; reply will be delivered by MCP notification${detailText}.${followText}`;
  }
  return `Ask sent to ${target}${detailText}.${followText}`;
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

function workUrlFor(workItem: ScoutTrackedWorkItem | null | undefined): string | null {
  return workItem ? `/api/work/${encodeURIComponent(workItem.id)}` : null;
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
    targetAgentId: string | null;
  },
  env: NodeJS.ProcessEnv,
): { ids: ScoutFollowIds; links: ScoutFollowLinks; followUrl: string | null } {
  const ids: ScoutFollowIds = {
    flightId: input.flight?.id ?? null,
    invocationId: input.flight?.invocationId ?? null,
    conversationId: input.conversationId,
    workId: input.workItem?.id ?? null,
    sessionId: null,
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
      currentDirectory,
      createdById,
    }) =>
      createScoutAgentCard({
        projectPath,
        agentName,
        displayName,
        harness,
        model,
        currentDirectory,
        createdById,
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
    }) =>
      sendScoutMessage({
        senderId,
        body,
        targetLabel,
        channel,
        shouldSpeak,
        currentDirectory,
        source,
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
    askQuestion: ({
      senderId,
      targetLabel,
      body,
      workItem,
      channel,
      shouldSpeak,
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
        currentDirectory,
        source,
      }),
    updateWorkItem: (input) => updateScoutWorkItem(input),
    waitForFlight: (baseUrl, flightId, options) =>
      waitForScoutFlight(baseUrl, flightId, options),
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
        "Inspect the default Scout sender identity and broker URL for a working directory. Use this when host or workspace context is unclear; direct explicit-target sends can call messages_send or invocations_ask without a whoami preflight.",
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
      const defaultSenderId = await deps.resolveSenderId(
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
      const resolvedSenderId = await deps.resolveSenderId(
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
        "Create a dedicated Scout agent card with a reply-ready return address. Use this when another agent should get back to you on a fresh project-scoped inbox or worktree-scoped alias. One target stays private by default; group coordination still requires an explicit channel elsewhere.",
      inputSchema: z.object({
        projectPath: z.string().optional(),
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        agentName: z.string().optional(),
        displayName: z.string().optional(),
        harness: z.enum(LOCAL_AGENT_HARNESS_VALUES).optional(),
        model: z.string().optional(),
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
    }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedSenderId = await deps.resolveSenderId(
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
        currentDirectory: resolvedCurrentDirectory,
        createdById: resolvedSenderId,
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
    "messages_send",
    {
      title: "Send Scout Message",
      description:
        "Post a broker-backed Scout tell/update. Use this for heads-up, replies, and status. Pass targets as fields: one explicit target without a channel becomes a DM, group delivery requires an explicit channel, and the body remains payload text. Use channel='shared' only for shared updates. Pass targetLabel for the single-call broker-resolved path; mentionAgentIds remains available for exact-id compatibility. For owned work or a reply lifecycle, use invocations_ask instead.",
      inputSchema: z.object({
        body: z.string().min(1),
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        targetLabel: targetLabelInputSchema,
        channel: z.string().optional(),
        shouldSpeak: z.boolean().optional(),
        mentionAgentIds: mentionAgentIdsInputSchema,
      }),
      outputSchema: sendResultSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: createToolUiMeta({
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
      targetLabel,
      channel,
      shouldSpeak,
      mentionAgentIds,
    }) => {
      const resolvedCurrentDirectory = resolveToolCurrentDirectory(
        currentDirectory,
        options.defaultCurrentDirectory,
      );
      const resolvedSenderId = await deps.resolveSenderId(
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const explicitTargetIds = [
        ...new Set(
          (mentionAgentIds ?? []).map((value) => value.trim()).filter(Boolean),
        ),
      ];

      if (explicitTargetIds.length > 0) {
        const result = await deps.sendMessageToAgentIds({
          senderId: resolvedSenderId,
          body,
          targetAgentIds: explicitTargetIds,
          channel,
          shouldSpeak,
          currentDirectory: resolvedCurrentDirectory,
          source: "scout-mcp",
        });
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          mode: "explicit_targets" as const,
          usedBroker: result.usedBroker,
          conversationId: result.conversationId ?? null,
          messageId: result.messageId ?? null,
          invokedTargetIds: result.invokedTargetIds,
          unresolvedTargetIds: result.unresolvedTargetIds,
          targetDiagnostic: result.targetDiagnostic ?? null,
          routeKind: result.routeKind ?? null,
          routingError: result.routingError ?? null,
        };
        return {
          content: createPlainTextContent(
            renderMcpSendSummary(structuredContent),
          ),
          structuredContent,
        };
      }

      if (targetLabel?.trim()) {
        const result = await deps.sendMessage({
          senderId: resolvedSenderId,
          body,
          targetLabel: targetLabel.trim(),
          channel,
          shouldSpeak,
          currentDirectory: resolvedCurrentDirectory,
          source: "scout-mcp",
        });
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          mode: "target_label" as const,
          usedBroker: result.usedBroker,
          conversationId: result.conversationId ?? null,
          messageId: result.messageId ?? null,
          bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
          invokedTargetIds: result.invokedTargets,
          unresolvedTargetIds: result.unresolvedTargets,
          targetDiagnostic: result.targetDiagnostic ?? null,
          routeKind: result.routeKind ?? null,
          routingError: result.routingError ?? null,
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
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        mode: "body_mentions" as const,
        usedBroker: result.usedBroker,
        conversationId: result.conversationId ?? null,
        messageId: result.messageId ?? null,
        bindingRef: result.bindingRef ? `ref:${result.bindingRef}` : null,
        invokedTargetIds: result.invokedTargets,
        unresolvedTargetIds: result.unresolvedTargets,
        targetDiagnostic: result.targetDiagnostic ?? null,
        routeKind: result.routeKind ?? null,
        routingError: result.routingError ?? null,
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
      title: "Ask Scout Agent",
      description:
        "Create a broker-backed Scout ask/work handoff. This is the durable path for 'do this and get back to me.' Pass targetLabel or targetAgentId as routing fields; one target without a channel becomes a DM and the body remains payload text. Provide workItem to mint a durable workId beyond the message and flight ids. Use replyMode='inline' for short blocking waits, replyMode='notify' for callback-style MCP notifications, and replyMode='none' for fire-and-forget. awaitReply is kept as a boolean alias for replyMode='inline'.",
      inputSchema: z
        .object({
          body: z.string().min(1),
          currentDirectory: z.string().optional(),
          senderId: z.string().optional(),
          targetAgentId: targetAgentIdInputSchema,
          targetLabel: targetLabelInputSchema,
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
              "Reply delivery mode: 'none' returns durable ids only, 'inline' blocks until the flight completes, and 'notify' returns immediately then emits notifications/scout/reply.",
            )
            .optional(),
          timeoutSeconds: z.number().int().min(1).optional(),
        })
        .refine(
          (value) =>
            Boolean(value.targetAgentId?.trim() || value.targetLabel?.trim()),
          {
            message: "Provide either targetAgentId or targetLabel.",
            path: ["targetAgentId"],
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
      targetAgentId,
      targetLabel,
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
      const resolvedSenderId = await deps.resolveSenderId(
        senderId,
        resolvedCurrentDirectory,
        env,
      );
      const resolvedReplyMode = resolveAskReplyMode({ awaitReply, replyMode });
      const shouldAwait = resolvedReplyMode === "inline";

      if (targetAgentId?.trim()) {
        const result = await deps.askAgentById({
          senderId: resolvedSenderId,
          targetAgentId: targetAgentId.trim(),
          body,
          workItem,
          channel,
          shouldSpeak,
          currentDirectory: resolvedCurrentDirectory,
          source: "scout-mcp",
        });
        const completedFlight =
          shouldAwait && result.flight
            ? await deps.waitForFlight(
                deps.resolveBrokerUrl(),
                result.flight.id,
                { timeoutSeconds },
              )
            : null;
        const trackedWorkItem = result.workItem ?? null;
        const notificationScheduled =
          resolvedReplyMode === "notify" && Boolean(result.flight);
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
              workUrl: workUrlFor(trackedWorkItem),
            },
          });
        }
        const followArtifacts = buildScoutFollowArtifacts(
          {
            flight: completedFlight ?? result.flight ?? null,
            conversationId: result.conversationId ?? null,
            workItem: trackedWorkItem,
            targetAgentId: targetAgentId.trim(),
          },
          env,
        );
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          targetAgentId: targetAgentId.trim(),
          targetLabel: null,
          usedBroker: result.usedBroker,
          awaited: shouldAwait,
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
          output: completedFlight?.output ?? completedFlight?.summary ?? null,
          unresolvedTargetId: result.unresolvedTargetId ?? null,
          unresolvedTargetLabel: null,
          workItem: trackedWorkItem,
          workId: trackedWorkItem?.id ?? null,
          workUrl: workUrlFor(trackedWorkItem),
          ids: followArtifacts.ids,
          links: followArtifacts.links,
          followUrl: followArtifacts.followUrl,
          targetDiagnostic: result.targetDiagnostic ?? null,
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
        currentDirectory: resolvedCurrentDirectory,
        source: "scout-mcp",
      });
      const completedFlight =
        shouldAwait && result.flight
          ? await deps.waitForFlight(
              deps.resolveBrokerUrl(),
              result.flight.id,
              { timeoutSeconds },
            )
          : null;
      const trackedWorkItem = result.workItem ?? null;
      const notificationScheduled =
        resolvedReplyMode === "notify" && Boolean(result.flight);
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
            workUrl: workUrlFor(trackedWorkItem),
          },
        });
      }
      const followArtifacts = buildScoutFollowArtifacts(
        {
          flight: completedFlight ?? result.flight ?? null,
          conversationId: result.conversationId ?? null,
          workItem: trackedWorkItem,
          targetAgentId: result.flight?.targetAgentId ?? null,
        },
        env,
      );
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        targetAgentId: result.flight?.targetAgentId ?? null,
        targetLabel: targetLabel!.trim(),
        usedBroker: result.usedBroker,
        awaited: shouldAwait,
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
        output: completedFlight?.output ?? completedFlight?.summary ?? null,
        unresolvedTargetId: null,
        unresolvedTargetLabel: result.unresolvedTarget ?? null,
        workItem: trackedWorkItem,
        workId: trackedWorkItem?.id ?? null,
        workUrl: workUrlFor(trackedWorkItem),
        ids: followArtifacts.ids,
        links: followArtifacts.links,
        followUrl: followArtifacts.followUrl,
        targetDiagnostic: result.targetDiagnostic ?? null,
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
      const resolvedSenderId = await deps.resolveSenderId(
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
        workUrl: workItem
          ? `/api/work/${encodeURIComponent(workItem.id)}`
          : null,
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
