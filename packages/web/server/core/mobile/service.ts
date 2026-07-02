import { basename, resolve } from "node:path";

import type {
  AgentDefinition,
  AgentEndpoint,
  AgentHarness,
  FlightRecord,
  MessageRecord,
} from "@openscout/protocol";
import {
  channelNaturalKeyFromMetadata,
  directChannelNaturalKey,
  epochMs,
} from "@openscout/protocol";
import { loadHarnessCatalogSnapshot } from "@openscout/runtime/harness-catalog";
import {
  collectOccupiedDefinitionIdsFromBrokerSnapshot,
  resolveProjectProvisionalAgentName,
} from "@openscout/runtime";
import {
  type ProjectInventoryEntry,
  loadResolvedRelayAgents,
} from "@openscout/runtime/setup";
import { createAgentWorkspace } from "@openscout/runtime/agent-workspace";

import { upScoutAgent } from "../agents/service.ts";
import { queryFleet } from "../../db-queries.ts";
import {
  loadScoutBrokerContext,
  readScoutBrokerHome,
  openScoutPeerSession,
  recordScoutBrokerReadCursor,
  registerScoutLocalAgentBinding,
  sendScoutConversationMessage,
  sendScoutDirectMessage,
  sendScoutMessage,
  type OutgoingAttachmentInput,
  type ScoutBrokerConversationRecord,
  type ScoutBrokerHomeActivityRecord,
  type ScoutBrokerSnapshot,
  type ScoutDirectMessageResult,
} from "../broker/service.ts";
import { resolveOperatorName } from "@openscout/runtime/user-config";
import { postScoutbotOperatorMessage } from "../../scoutbot/runner.ts";
import { SCOUTBOT_AGENT_ID } from "../../scoutbot/role.ts";

export type ScoutMobileListFilters = {
  query?: string;
  limit?: number;
};

export type ScoutMobileWorkspaceSummary = {
  id: string;
  title: string;
  projectName: string;
  root: string;
  sourceRoot: string;
  relativePath: string;
  registrationKind: ProjectInventoryEntry["registrationKind"];
  defaultHarness: string;
  harnesses: Array<{
    harness: string;
    source: "manifest" | "marker" | "default";
    detail: string;
    readinessState: "ready" | "configured" | "installed" | "missing" | null;
    readinessDetail: string | null;
  }>;
};

export type ScoutMobileAgentSummary = {
  id: string;
  title: string;
  selector: string | null;
  defaultSelector: string | null;
  workspaceRoot: string | null;
  harness: string | null;
  transport: string | null;
  state: "offline" | "available" | "working";
  statusLabel: string;
  sessionId: string | null;
  /// The broker chat the phone should open for this agent. It is an existing
  /// opaque chat id, or null when no chat has been created yet.
  conversationId: string | null;
  lastActiveAt: number | null;
};

export type ScoutMobileSessionSummary = {
  id: string;
  kind: string;
  title: string;
  participantIds: string[];
  agentId: string | null;
  agentName: string | null;
  harness: string | null;
  currentBranch: string | null;
  preview: string | null;
  messageCount: number;
  lastMessageAt: number | null;
  workspaceRoot: string | null;
};

export type ScoutMobileHomeState = {
  workspaces: ScoutMobileWorkspaceSummary[];
  agents: ScoutMobileAgentSummary[];
  sessions: ScoutMobileSessionSummary[];
  totals: {
    workspaces: number;
    agents: number;
    sessions: number;
  };
};

export type CreateScoutSessionInput = {
  workspaceId: string;
  harness?: AgentHarness;
  agentName?: string;
  worktree?: string | null;
  profile?: string | null;
  branch?: string;
  model?: string;
  forceNew?: boolean;
  seed?: {
    instructions?: string | null;
    fromMessageId?: string | null;
    fromConversationId?: string | null;
    attachments?: OutgoingAttachmentInput[];
  } | null;
};

export type ScoutMobileSessionHandle = {
  workspace: ScoutMobileWorkspaceSummary;
  agent: ScoutMobileAgentSummary;
  session: {
    conversationId: string;
    title: string;
    existed: boolean;
  };
  messageId?: string | null;
  flightId?: string | null;
  unsupported: Array<"worktree" | "profile">;
};

export type ScoutMobileSessionSnapshot = {
  session: {
    id: string;
    name: string;
    adapterType: string;
    status: "connecting" | "active" | "idle" | "error" | "closed";
    cwd: string | null;
    model: string | null;
    providerMeta?: Record<string, unknown>;
  };
  history: {
    hasOlder: boolean;
    oldestTurnId: string | null;
    newestTurnId: string | null;
  };
  turns: Array<{
    id: string;
    status: "streaming" | "completed" | "interrupted" | "error";
    blocks: Array<{
      block: {
        id: string;
        turnId: string;
        type: "text" | "reasoning" | "action" | "file" | "error";
        status: "started" | "streaming" | "completed" | "failed";
        index: number;
        text?: string;
        mimeType?: string;
        name?: string;
        data?: string;
        url?: string;
        message?: string;
      };
      status: "streaming" | "completed";
    }>;
    startedAt: number;
    endedAt?: number;
    isUserTurn?: boolean;
    clientMessageId?: string | null;
  }>;
  currentTurnId: string | null;
};

const DEFAULT_MOBILE_RECENT_TURN_LIMIT = 24;
const DEFAULT_MOBILE_HISTORY_PAGE_LIMIT = 40;

export type SendScoutMobileMessageInput = {
  agentId: string;
  body: string;
  attachments?: OutgoingAttachmentInput[];
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
  referenceMessageIds?: string[];
  harness?: AgentHarness;
};

export type ScoutMobileSendLifecycleState =
  | "queued"
  | "dispatching"
  | "acknowledged"
  | "working"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type ScoutMobileSendResult = {
  conversationId: string;
  messageId: string;
  flightId?: string | null;
  invocationId?: string | null;
  targetAgentId?: string | null;
  lifecycleState?: ScoutMobileSendLifecycleState | null;
  summary?: string | null;
  error?: string | null;
};

function mobileLifecycleStateForFlight(flight: { state?: string } | null | undefined): ScoutMobileSendLifecycleState | null {
  switch (flight?.state) {
    case "queued": return "queued";
    case "waking": return "dispatching";
    case "running": return "working";
    case "waiting": return "waiting";
    case "completed": return "completed";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    default: return null;
  }
}

function mobileSendResultFromDirect(result: ScoutDirectMessageResult): ScoutMobileSendResult {
  return {
    conversationId: result.conversationId,
    messageId: result.messageId,
    flightId: result.flight?.id ?? null,
    invocationId: result.flight?.invocationId ?? null,
    targetAgentId: result.flight?.targetAgentId ?? null,
    lifecycleState: mobileLifecycleStateForFlight(result.flight) ?? (result.flight ? "dispatching" : null),
    summary: result.flight?.summary ?? null,
    error: result.flight?.error ?? null,
  };
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  const ms = epochMs(value);
  return ms === null ? null : Math.floor(ms / 1000);
}

function normalizeTimestampMs(value: number | null | undefined): number | null {
  return epochMs(value);
}

function requireTimestampMs(value: number | null | undefined): number {
  return normalizeTimestampMs(value) ?? 0;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function metadataBoolean(metadata: Record<string, unknown> | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

function isBrokerRequesterWaitTimeoutStatusMessage(message: MessageRecord): boolean {
  if (message.class !== "status" || metadataString(message.metadata, "source") !== "broker") {
    return false;
  }
  return message.body.includes("Scout stopped waiting for a synchronous result")
    || message.body.includes("the requester stopped waiting after");
}

function isRequesterWaitTimeoutFlight(flight: FlightRecord): boolean {
  return metadataBoolean(flight.metadata, "requesterTimedOut")
    || metadataString(flight.metadata, "timeoutScope") === "requester_wait"
    || Boolean(flight.summary?.includes("Scout stopped waiting for a synchronous result"));
}

function isInactiveAgent(agent: AgentDefinition | null | undefined): boolean {
  return metadataBoolean(agent?.metadata, "retiredFromFleet")
    || metadataBoolean(agent?.metadata, "staleLocalRegistration");
}

function isInactiveEndpoint(snapshot: ScoutBrokerSnapshot, endpoint: AgentEndpoint | null | undefined): boolean {
  if (!endpoint) {
    return true;
  }
  return metadataBoolean(endpoint.metadata, "retiredFromFleet")
    || metadataBoolean(endpoint.metadata, "staleLocalRegistration")
    || isInactiveAgent(snapshot.agents[endpoint.agentId]);
}

function titleCaseToken(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function humanizeWorkspaceName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const base = trimmed.split("/").at(-1)?.trim() || trimmed;
  if (!base) return null;
  return base
    .split(/[-_]+/g)
    .filter((token) => token.length > 0)
    .map(titleCaseToken)
    .join(" ");
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function withQueryAndLimit<T>(
  values: T[],
  filters: ScoutMobileListFilters | undefined,
  match: (value: T, query: string) => boolean,
): T[] {
  const query = normalizeQuery(filters?.query);
  const limited = query ? values.filter((value) => match(value, query)) : values;
  const limit = typeof filters?.limit === "number" && filters.limit > 0 ? Math.floor(filters.limit) : null;
  return limit ? limited.slice(0, limit) : limited;
}

function harnessReadinessMap(snapshot: Awaited<ReturnType<typeof loadHarnessCatalogSnapshot>>) {
  return new Map(snapshot.entries.map((entry) => [entry.harness, entry.readinessReport] as const));
}

async function loadMobileWorkspaceInventory(currentDirectory?: string): Promise<ScoutMobileWorkspaceSummary[]> {
  const [setup, catalog] = await Promise.all([
    loadResolvedRelayAgents({ currentDirectory }),
    loadHarnessCatalogSnapshot(),
  ]);
  const readinessByHarness = harnessReadinessMap(catalog);

  return setup.projectInventory
    .map((project) => ({
      id: project.projectRoot,
      title: project.displayName,
      projectName: project.projectName,
      root: project.projectRoot,
      sourceRoot: project.sourceRoot,
      relativePath: project.relativePath,
      registrationKind: project.registrationKind,
      defaultHarness: project.defaultHarness,
      harnesses: project.harnesses.map((harness) => {
        const readiness = readinessByHarness.get(harness.harness);
        return {
          harness: harness.harness,
          source: harness.source,
          detail: harness.detail,
          readinessState: readiness?.state ?? null,
          readinessDetail: readiness?.detail ?? null,
        };
      }),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.title.localeCompare(right.title));
}

function latestMessageByConversation(snapshot: ScoutBrokerSnapshot): Map<string, MessageRecord[]> {
  const buckets = new Map<string, MessageRecord[]>();
  for (const message of Object.values(snapshot.messages)) {
    if (isBrokerRequesterWaitTimeoutStatusMessage(message)) {
      continue;
    }
    const next = buckets.get(message.conversationId) ?? [];
    next.push(message);
    buckets.set(message.conversationId, next);
  }
  for (const messages of buckets.values()) {
    messages.sort((left, right) => requireTimestampMs(left.createdAt) - requireTimestampMs(right.createdAt));
  }
  return buckets;
}

function agentDisplayName(snapshot: ScoutBrokerSnapshot, agentId: string): string {
  const endpoint = endpointForAgent(snapshot, agentId);
  const workspaceTitle = humanizeWorkspaceName(endpoint?.projectRoot ?? endpoint?.cwd ?? null);
  if (workspaceTitle) {
    return workspaceTitle;
  }
  return snapshot.agents[agentId]?.displayName
    ?? snapshot.actors[agentId]?.displayName
    ?? agentId;
}

function rawConversationTitle(conversation: ScoutBrokerConversationRecord): string | null {
  const title = typeof conversation.title === "string" ? conversation.title.trim() : "";
  return title.length > 0 ? title : null;
}

function mobileConversationTitle(
  snapshot: ScoutBrokerSnapshot,
  conversation: ScoutBrokerConversationRecord,
  directAgentId: string | null = null,
): string {
  if (conversation.kind === "direct" && directAgentId) {
    return agentDisplayName(snapshot, directAgentId);
  }
  return rawConversationTitle(conversation) ?? conversation.id;
}

function endpointForAgent(snapshot: ScoutBrokerSnapshot, agentId: string): AgentEndpoint | null {
  return Object.values(snapshot.endpoints).find((endpoint) => (
    endpoint.agentId === agentId && !isInactiveEndpoint(snapshot, endpoint)
  )) ?? null;
}

/// The conversation id the phone should route an agent tap to. It is always an
/// existing broker chat id. When no chat exists yet, callers get null and must
/// create one explicitly.
function mobileAgentConversationId(snapshot: ScoutBrokerSnapshot, agentId: string): string | null {
  return resolveMobileConversation(snapshot, agentId)?.id ?? null;
}

function buildMobileAgentSummary(
  snapshot: ScoutBrokerSnapshot,
  agent: AgentDefinition,
): ScoutMobileAgentSummary {
  const endpoint = endpointForAgent(snapshot, agent.id);
  const flights = Object.values(snapshot.flights as Record<string, FlightRecord>).filter((flight) => flight.targetAgentId === agent.id);
  const hasWorkingFlight = flights.some((flight) => flight.state === "running");
  const lastAuthoredMessageAt = Object.values(snapshot.messages)
    .filter((message) => message.actorId === agent.id)
    .reduce<number | null>((latest, message) => {
      const createdAt = normalizeTimestampMs(message.createdAt);
      return typeof createdAt === "number" && (!latest || createdAt > latest) ? createdAt : latest;
    }, null);

  const state = hasWorkingFlight
    ? "working"
    : endpoint && endpoint.state !== "offline"
      ? "available"
      : "offline";

  return {
    id: agent.id,
    title: agent.displayName,
    selector: agent.selector ?? null,
    defaultSelector: agent.defaultSelector ?? null,
    workspaceRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
    harness: endpoint?.harness ?? null,
    transport: endpoint?.transport ?? null,
    state,
    statusLabel: state === "working" ? "Working" : state === "available" ? "Available" : "Offline",
    sessionId: endpoint?.sessionId ?? null,
    conversationId: mobileAgentConversationId(snapshot, agent.id),
    lastActiveAt: lastAuthoredMessageAt,
  };
}

function buildMobileSessionSummaries(snapshot: ScoutBrokerSnapshot): ScoutMobileSessionSummary[] {
  const messagesByConversation = latestMessageByConversation(snapshot);
  const summaries: ScoutMobileSessionSummary[] = Object.values(snapshot.conversations)
    .filter((conversation) => conversation.kind === "direct")
    .flatMap((conversation) => {
      const messages = messagesByConversation.get(conversation.id) ?? [];
      const latestMessage = messages.at(-1) ?? null;
      const directAgentId = conversation.kind === "direct"
        ? conversation.participantIds.find((participantId) => participantId !== "operator") ?? null
        : null;
      const agent = directAgentId ? snapshot.agents[directAgentId] ?? null : null;
      if (!directAgentId || !agent || isInactiveAgent(agent) || messages.length === 0) {
        return [];
      }
      const endpoint = endpointForAgent(snapshot, directAgentId);
      if (!endpoint || endpoint.state === "offline") {
        return [];
      }
      return [{
        id: conversation.id,
        kind: conversation.kind,
        title: mobileConversationTitle(snapshot, conversation, directAgentId),
        participantIds: [...conversation.participantIds],
        agentId: directAgentId,
        agentName: directAgentId ? agentDisplayName(snapshot, directAgentId) : null,
        harness: endpoint?.harness ?? null,
        currentBranch:
          metadataString(endpoint?.metadata, "branch")
          ?? metadataString(endpoint?.metadata, "workspaceQualifier")
          ?? metadataString(agent?.metadata, "branch")
          ?? metadataString(agent?.metadata, "workspaceQualifier"),
        preview: latestMessage?.body ?? null,
        messageCount: messages.length,
        lastMessageAt: normalizeTimestampMs(latestMessage?.createdAt),
        workspaceRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
      }];
    });

  const deduped = new Map<string, ScoutMobileSessionSummary>();
  for (const summary of summaries) {
    const agent = summary.agentId ? snapshot.agents[summary.agentId] : null;
    const endpoint = summary.agentId ? endpointForAgent(snapshot, summary.agentId) : null;
    const branchQualifier =
      metadataString(endpoint?.metadata, "branch")
      ?? metadataString(endpoint?.metadata, "workspaceQualifier")
      ?? metadataString(agent?.metadata, "branch")
      ?? metadataString(agent?.metadata, "workspaceQualifier");
    const identityKey = [
      endpoint?.projectRoot?.trim().toLowerCase(),
      endpoint?.cwd?.trim().toLowerCase(),
      branchQualifier?.trim().toLowerCase(),
      endpoint?.harness?.trim().toLowerCase(),
      summary.agentName?.trim().toLowerCase(),
    ].filter((value): value is string => Boolean(value)).join("|") || summary.id;
    const existing = deduped.get(identityKey);
    if (!existing || (summary.lastMessageAt ?? 0) >= (existing.lastMessageAt ?? 0)) {
      deduped.set(identityKey, summary);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0));
}

function messagesForConversation(
  snapshot: ScoutBrokerSnapshot,
  conversationId: string,
): MessageRecord[] {
  return Object.values(snapshot.messages)
    .filter((message) => !isBrokerRequesterWaitTimeoutStatusMessage(message))
    .filter((message) => message.conversationId === conversationId)
    .sort((left, right) => requireTimestampMs(left.createdAt) - requireTimestampMs(right.createdAt));
}

function pageMessagesForConversation(
  snapshot: ScoutBrokerSnapshot,
  conversationId: string,
  options: {
    beforeTurnId?: string | null;
    limit?: number | null;
  } = {},
): {
  messages: MessageRecord[];
  hasOlder: boolean;
  oldestTurnId: string | null;
  newestTurnId: string | null;
} {
  const allMessages = messagesForConversation(snapshot, conversationId);
  const normalizedLimit = Math.max(
    1,
    Math.floor(options.limit ?? (options.beforeTurnId ? DEFAULT_MOBILE_HISTORY_PAGE_LIMIT : DEFAULT_MOBILE_RECENT_TURN_LIMIT)),
  );

  if (allMessages.length === 0) {
    return {
      messages: [],
      hasOlder: false,
      oldestTurnId: null,
      newestTurnId: null,
    };
  }

  if (options.beforeTurnId) {
    const beforeIndex = allMessages.findIndex((message) => message.id === options.beforeTurnId);
    const endExclusive = beforeIndex >= 0 ? beforeIndex : allMessages.length;
    const start = Math.max(0, endExclusive - normalizedLimit);
    const messages = allMessages.slice(start, endExclusive);
    return {
      messages,
      hasOlder: start > 0,
      oldestTurnId: messages[0]?.id ?? null,
      newestTurnId: messages.at(-1)?.id ?? null,
    };
  }

  const start = Math.max(0, allMessages.length - normalizedLimit);
  const messages = allMessages.slice(start);
  return {
    messages,
    hasOlder: start > 0,
    oldestTurnId: messages[0]?.id ?? null,
    newestTurnId: messages.at(-1)?.id ?? null,
  };
}

function latestActiveFlightForAgent(
  snapshot: ScoutBrokerSnapshot,
  agentId: string | null,
): FlightRecord | null {
  if (!agentId) return null;
  return Object.values(snapshot.flights as Record<string, FlightRecord>)
    .filter((flight) => (
      flight.targetAgentId === agentId
      && (flight.state === "running" || flight.state === "waiting")
      && !isRequesterWaitTimeoutFlight(flight)
    ))
    .sort((left, right) => (normalizeTimestamp(right.startedAt) ?? 0) - (normalizeTimestamp(left.startedAt) ?? 0))[0] ?? null;
}

async function loadMobileRelayState(): Promise<{
  agents: ScoutMobileAgentSummary[];
  sessions: ScoutMobileSessionSummary[];
}> {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    return { agents: [], sessions: [] };
  }

  const snapshot = broker.snapshot;
  const agents = Object.values(snapshot.agents)
    .filter((agent) => !isInactiveAgent(agent))
    .filter((agent) => {
      const endpoints = Object.values(snapshot.endpoints)
        .filter((endpoint) => endpoint.agentId === agent.id);
      return endpoints.length === 0 || endpoints.some((endpoint) => !isInactiveEndpoint(snapshot, endpoint));
    })
    .map((agent) => buildMobileAgentSummary(snapshot, agent))
    .sort((left, right) => (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0) || left.title.localeCompare(right.title));

  return {
    agents,
    sessions: buildMobileSessionSummaries(snapshot),
  };
}

function matchesWorkspace(workspace: ScoutMobileWorkspaceSummary, query: string): boolean {
  return [
    workspace.title,
    workspace.projectName,
    workspace.root,
    workspace.relativePath,
    workspace.defaultHarness,
  ].some((value) => value.toLowerCase().includes(query));
}

function matchesAgent(agent: ScoutMobileAgentSummary, query: string): boolean {
  return [
    agent.title,
    agent.id,
    agent.selector ?? "",
    agent.defaultSelector ?? "",
    agent.workspaceRoot ?? "",
    agent.harness ?? "",
  ].some((value) => value.toLowerCase().includes(query));
}

function matchesSession(session: ScoutMobileSessionSummary, query: string): boolean {
  return [
    session.title,
    session.id,
    session.agentName ?? "",
    session.workspaceRoot ?? "",
    session.preview ?? "",
  ].some((value) => value.toLowerCase().includes(query));
}

export async function getScoutMobileHome(input: {
  currentDirectory?: string;
  workspaceLimit?: number;
  agentLimit?: number;
  sessionLimit?: number;
} = {}): Promise<ScoutMobileHomeState> {
  const [workspaces, relay] = await Promise.all([
    loadMobileWorkspaceInventory(input.currentDirectory),
    loadMobileRelayState(),
  ]);

  const workspaceLimit = input.workspaceLimit ?? 6;
  const agentLimit = input.agentLimit ?? 6;
  const sessionLimit = input.sessionLimit ?? 6;

  return {
    workspaces: workspaces.slice(0, workspaceLimit),
    agents: relay.agents.slice(0, agentLimit),
    sessions: relay.sessions.slice(0, sessionLimit),
    totals: {
      workspaces: workspaces.length,
      agents: relay.agents.length,
      sessions: relay.sessions.length,
    },
  };
}

export async function getScoutMobileWorkspaces(
  filters: ScoutMobileListFilters = {},
  currentDirectory?: string,
): Promise<ScoutMobileWorkspaceSummary[]> {
  const workspaces = await loadMobileWorkspaceInventory(currentDirectory);
  return withQueryAndLimit(workspaces, filters, matchesWorkspace);
}

export async function getScoutMobileAgents(
  filters: ScoutMobileListFilters = {},
  currentDirectory?: string,
): Promise<ScoutMobileAgentSummary[]> {
  void currentDirectory;
  const relay = await loadMobileRelayState();
  return withQueryAndLimit(relay.agents, filters, matchesAgent);
}

export async function getScoutMobileSessions(
  filters: ScoutMobileListFilters = {},
  currentDirectory?: string,
): Promise<ScoutMobileSessionSummary[]> {
  void currentDirectory;
  const relay = await loadMobileRelayState();
  return withQueryAndLimit(relay.sessions, filters, matchesSession);
}

export async function getScoutFleet(
  options?: Parameters<typeof queryFleet>[0],
): Promise<ReturnType<typeof queryFleet>> {
  return queryFleet(options);
}

/**
 * Resolve whatever id the phone routed with onto a real broker conversation.
 * The phone may send a chat id directly or a bare agent id from the Agents tab.
 * Bare agent ids resolve to an existing direct chat by natural key, then to the
 * most-recent conversation the agent actually participates in.
 */
function resolveMobileConversation(
  snapshot: ScoutBrokerSnapshot,
  rawId: string,
): ScoutBrokerConversationRecord | null {
  const direct = snapshot.conversations[rawId];
  if (direct) return direct;

  const directNaturalKey = directChannelNaturalKey(["operator", rawId]);
  const directByNaturalKey = Object.values(snapshot.conversations).find(
    (conversation) =>
      channelNaturalKeyFromMetadata(conversation.metadata) === directNaturalKey,
  );
  if (directByNaturalKey) return directByNaturalKey;

  const participating = Object.values(snapshot.conversations).filter(
    (conversation) => conversation.participantIds?.includes(rawId),
  );
  if (participating.length === 0) return null;

  const lastActivityMs = (conversationId: string): number =>
    Object.values(snapshot.messages).reduce((latest, message) => {
      if (message.conversationId !== conversationId) return latest;
      return Math.max(latest, normalizeTimestampMs(message.createdAt) ?? 0);
    }, 0);

  return participating
    .slice()
    .sort((a, b) => lastActivityMs(b.id) - lastActivityMs(a.id))[0] ?? null;
}

export async function getScoutMobileSessionSnapshot(
  conversationId: string,
  options: {
    beforeTurnId?: string | null;
    limit?: number | null;
  } = {},
  currentDirectory?: string,
): Promise<ScoutMobileSessionSnapshot> {
  void currentDirectory;
  const broker = await requireMobileRelayContext();
  const { snapshot } = broker;
  const conversation = resolveMobileConversation(snapshot, conversationId);
  if (!conversation) {
    throw new Error(`Unknown mobile session "${conversationId}".`);
  }

  const directAgentId = conversation.kind === "direct"
    ? conversation.participantIds.find((participantId) => participantId !== "operator") ?? null
    : null;
  const endpoint = directAgentId ? endpointForAgent(snapshot, directAgentId) : null;
  const agent = directAgentId ? snapshot.agents[directAgentId] : null;
  const messagePage = pageMessagesForConversation(snapshot, conversation.id, options);
  const messages = messagePage.messages;
  const title = mobileConversationTitle(snapshot, conversation, directAgentId);
  const activeFlight = latestActiveFlightForAgent(snapshot, directAgentId);
  const lastAgentMessageAt = messages
    .filter((message) => message.actorId === directAgentId)
    .reduce<number | null>((latest, message) => {
      const createdAt = normalizeTimestampMs(message.createdAt);
      return typeof createdAt === "number" && (!latest || createdAt > latest) ? createdAt : latest;
    }, null);
  const shouldShowWorkingTurn = Boolean(
    activeFlight
    && ((normalizeTimestampMs(activeFlight.startedAt) ?? 0) > (lastAgentMessageAt ?? 0)),
  );

  const turns: ScoutMobileSessionSnapshot["turns"] = messages.map((message) => ({
    id: message.id,
    status: "completed",
    blocks: [{
      block: {
        id: `${message.id}:body`,
        turnId: message.id,
        type: message.class === "system" ? "reasoning" : "text",
        status: "completed",
        index: 0,
        text: message.body,
      },
      status: "completed",
    }, ...((message.attachments ?? []).map((attachment, index) => ({
      block: {
        id: `${message.id}:attachment:${attachment.id}`,
        turnId: message.id,
        type: "file" as const,
        status: "completed" as const,
        index: index + 1,
        mimeType: attachment.mediaType,
        name: attachment.fileName ?? attachment.url ?? attachment.id,
        url: attachment.url,
      },
      status: "completed" as const,
    })))],
    startedAt: normalizeTimestampMs(message.createdAt) ?? Date.now(),
    endedAt: normalizeTimestampMs(message.createdAt) ?? Date.now(),
    isUserTurn: message.actorId === "operator",
    clientMessageId: metadataString(message.metadata, "clientMessageId"),
  }));

  if (!options.beforeTurnId && shouldShowWorkingTurn && activeFlight) {
    turns.push({
      id: `flight:${activeFlight.id}`,
      status: "streaming",
      blocks: [{
        block: {
          id: `flight:${activeFlight.id}:status`,
          turnId: `flight:${activeFlight.id}`,
          type: "reasoning",
          status: "streaming",
          index: 0,
          text: activeFlight.summary?.trim() || "Working…",
        },
        status: "streaming",
      }],
      startedAt: normalizeTimestampMs(activeFlight.startedAt) ?? Date.now(),
      isUserTurn: false,
    });
  }

  return {
    session: {
      id: conversation.id,
      name: title,
      adapterType: endpoint?.harness ?? "relay",
      status: shouldShowWorkingTurn ? "active" : endpoint?.state === "offline" ? "idle" : "active",
      cwd: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
      model: typeof endpoint?.metadata?.model === "string" ? endpoint.metadata.model : null,
      providerMeta: {
        conversationId: conversation.id,
        conversationKind: conversation.kind,
        agentId: directAgentId,
        workspaceRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
        harness: endpoint?.harness ?? null,
        selector: agent?.selector ?? null,
        defaultSelector: agent?.defaultSelector ?? null,
        project: directAgentId ? agentDisplayName(snapshot, directAgentId) : title,
        currentBranch:
          metadataString(endpoint?.metadata, "branch")
          ?? metadataString(endpoint?.metadata, "workspaceQualifier")
          ?? metadataString(agent?.metadata, "branch")
          ?? metadataString(agent?.metadata, "workspaceQualifier"),
        workspaceQualifier:
          metadataString(endpoint?.metadata, "workspaceQualifier")
          ?? metadataString(agent?.metadata, "workspaceQualifier"),
      },
    },
    history: {
      hasOlder: messagePage.hasOlder,
      oldestTurnId: messagePage.oldestTurnId,
      newestTurnId: messagePage.newestTurnId,
    },
    turns,
    currentTurnId: shouldShowWorkingTurn && activeFlight ? `flight:${activeFlight.id}` : null,
  };
}

export async function createScoutSession(
  input: CreateScoutSessionInput,
  currentDirectory?: string,
  deviceId?: string,
): Promise<ScoutMobileSessionHandle> {
  // The mobile client passes a projectRoot path as workspaceId (see
  // queryMobileWorkspaces in db-queries.ts). We skip the 4s filesystem inventory
  // walk here and build a minimal workspace summary directly — createSession is
  // a hot RPC on every mobile session creation and the downstream code only
  // needs `root`, `projectName`, and the passthrough fields.
  const rawWorkspaceId = input.workspaceId?.trim();
  if (!rawWorkspaceId) {
    throw new Error(`Invalid workspaceId.`);
  }
  const workspaceRoot = resolve(rawWorkspaceId);
  const projectName = basename(workspaceRoot) || workspaceRoot;
  const workspace: ScoutMobileWorkspaceSummary = {
    id: workspaceRoot,
    title: projectName,
    projectName,
    root: workspaceRoot,
    sourceRoot: workspaceRoot,
    relativePath: workspaceRoot.replace(`${process.env.HOME ?? ""}/`, ""),
    registrationKind: "configured",
    defaultHarness: input.harness ?? "claude",
    harnesses: [],
  };

  // When forceNew is true, generate a unique agent name so it gets
  // a fresh agent ID and conversation (the broker derives conversation ID
  // deterministically from the agent ID).
  const agentName = input.forceNew
    ? await deriveNewAgentName(workspace.projectName, input.branch, input.harness)
    : workspace.projectName;

  // If worktree requested, create a git worktree so the agent works in isolation.
  let agentCwd = workspace.root;
  let worktreeCreated = false;
  if (input.worktree) {
    const worktreeResult = await createGitWorktree(workspace.root, agentName, input.branch);
    if (worktreeResult) {
      agentCwd = worktreeResult.path;
      worktreeCreated = true;
    }
  }

  // projectPath = original root (for agent config resolution)
  // cwdOverride = worktree path (agent works here instead of project root)
  const localAgent = await upScoutAgent({
    projectPath: workspace.root,
    agentName,
    harness: input.harness,
    currentDirectory: currentDirectory ?? workspace.root,
    cwdOverride: agentCwd !== workspace.root ? agentCwd : undefined,
    model: input.model,
    permissionProfile: input.profile?.trim() || undefined,
    branch: input.branch,
  });

  const broker = await loadScoutBrokerContext();
  const bindingSync = await registerScoutLocalAgentBinding({
    agentId: localAgent.agentId,
    broker,
  });
  const resolvedAgentId = bindingSync?.binding.agent.id ?? localAgent.agentId;

  const directSession = await openScoutPeerSession({
    sourceId: "operator",
    targetId: resolvedAgentId,
    currentDirectory: currentDirectory ?? workspace.root,
  });

  const snapshot = broker?.snapshot;
  const targetAgentId = directSession.targetId;
  const brokerAgent = snapshot?.agents[targetAgentId] ?? null;
  const brokerEndpoint = snapshot ? endpointForAgent(snapshot, targetAgentId) : null;
  const agentTitle = brokerAgent && snapshot
    ? agentDisplayName(snapshot, brokerAgent.id)
    : localAgent.projectName;

  const agentSummary: ScoutMobileAgentSummary = {
    id: targetAgentId,
    title: agentTitle,
    selector: brokerAgent?.selector ?? null,
    defaultSelector: brokerAgent?.defaultSelector ?? null,
    workspaceRoot: brokerEndpoint?.projectRoot ?? brokerEndpoint?.cwd ?? workspace.root,
    harness: brokerEndpoint?.harness ?? localAgent.harness,
    transport: localAgent.transport,
    state: brokerEndpoint?.state === "offline" ? "offline" : "available",
    statusLabel: brokerEndpoint?.state === "offline" ? "Offline" : "Available",
    sessionId: localAgent.sessionId,
    conversationId: directSession.conversation.id,
    lastActiveAt: null,
  };

  const seedInstructions = input.seed?.instructions?.trim() ?? "";
  const seedAttachments = input.seed?.attachments;
  const seedDelivery = seedInstructions || seedAttachments?.length
    ? await sendScoutDirectMessage({
        agentId: targetAgentId,
        body: seedInstructions,
        attachments: seedAttachments,
        currentDirectory: currentDirectory ?? workspace.root,
        executionHarness: input.harness,
        source: "scout-mobile",
        deviceId,
      })
    : null;

  return {
    workspace,
    agent: agentSummary,
    session: {
      conversationId: seedDelivery?.conversationId ?? directSession.conversation.id,
      title: agentTitle,
      existed: directSession.existed,
    },
    messageId: seedDelivery?.messageId ?? null,
    flightId: seedDelivery?.flight?.id ?? null,
    unsupported: [
      ...(input.worktree && !worktreeCreated ? ["worktree" as const] : []),
    ],
  };
}

export async function sendScoutMobileMessage(
  input: SendScoutMobileMessageInput,
  currentDirectory?: string,
  deviceId?: string,
): Promise<ScoutDirectMessageResult> {
  if (input.agentId === SCOUTBOT_AGENT_ID) {
    const result = await postScoutbotOperatorMessage({
      currentDirectory: currentDirectory ?? process.cwd(),
      body: input.body,
      attachments: input.attachments,
      source: "scout-mobile",
      clientMessageId: input.clientMessageId,
      replyToMessageId: input.replyToMessageId,
      referenceMessageIds: input.referenceMessageIds,
      deviceId,
    });
    if (!result.usedBroker || !result.conversationId || !result.messageId) {
      throw new Error("Scoutbot is not available.");
    }
    return {
      conversationId: result.conversationId,
      messageId: result.messageId,
    };
  }

  return sendScoutDirectMessage({
    agentId: input.agentId,
    body: input.body,
    attachments: input.attachments,
    currentDirectory,
    clientMessageId: input.clientMessageId,
    replyToMessageId: input.replyToMessageId,
    referenceMessageIds: input.referenceMessageIds,
    executionHarness: input.harness,
    source: "scout-mobile",
    deviceId,
  });
}

/** Mint a collision-free provisional agent name from the curated rotation pool. */
async function deriveNewAgentName(
  projectName: string,
  branch?: string,
  harness?: string,
): Promise<string> {
  const broker = await loadScoutBrokerContext();
  const occupied = broker
    ? collectOccupiedDefinitionIdsFromBrokerSnapshot(broker.snapshot)
    : new Set<string>();
  return resolveProjectProvisionalAgentName({
    occupied,
    seedParts: [
      "mobile-new-project-agent",
      projectName,
      branch ?? "",
      harness ?? "",
    ],
  });
}

/**
 * Create an isolated git worktree for an agent session.
 *
 * Delegates to the shared runtime helper (createAgentWorkspace), which
 * materializes a `git worktree` on branch `scout/<agentName>` under
 * `<projectRoot>/.scout-worktrees/<agentName>`. Kept as a thin wrapper so
 * callers retain the historical `createGitWorktree` name and `{ path, branch }`
 * shape.
 *
 * Returns the worktree path + branch, or null if the project isn't a git repo.
 */
async function createGitWorktree(
  projectRoot: string,
  agentName: string,
  requestedBranch?: string,
): Promise<{ path: string; branch: string } | null> {
  const result = await createAgentWorkspace(projectRoot, agentName, requestedBranch);
  if (!result) return null;
  return { path: result.path, branch: result.branch };
}

async function requireMobileRelayContext() {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    throw new Error("Relay is not reachable.");
  }
  return broker;
}

// -- Activity Feed --------------------------------------------------------

export type ScoutMobileActivityFilters = {
  agentId?: string;
  actorId?: string;
  conversationId?: string;
  limit?: number;
};

export async function getScoutMobileActivity(
  filters: ScoutMobileActivityFilters = {},
): Promise<ScoutBrokerHomeActivityRecord[]> {
  // Home is an orientation surface, so it reads the broker's *curated* home
  // activity — one row per message, named actors, always thread-linked — not the
  // raw `/v1/activity` lifecycle firehose (ask_opened / flight_updated / …),
  // which is an ops feed and stays on the Tail tab. See project_home_purpose.
  const home = await readScoutBrokerHome();
  return (home?.activity ?? []).slice(0, filters.limit ?? 100);
}

// -- Comms (channels + DMs) ----------------------------------------------
//
// The phone's mesh-comms surface. Reads channels/DMs straight from the broker
// snapshot (conversations + messages + actors, all in memory) and flattens them
// for the phone — participants and authors pre-resolved to display labels so the
// client never joins against the actor table. Posting routes by conversation
// kind: channels via `sendScoutMessage`, DMs via the existing direct-message path.

const MOBILE_OPERATOR_ID = "operator";

/// Actor ids that represent "you" (the phone operator): the canonical "operator"
/// plus the configured operator name/handle. Older DMs and read cursors can be
/// authored under the configured identity (e.g. "dm.arach.hudson…" by "arach"),
/// so a single hard-coded id would mislabel the counterpart and miscount unread.
function operatorActorIds(): Set<string> {
  const ids = new Set<string>([MOBILE_OPERATOR_ID]);
  const name = resolveOperatorName().trim();
  if (name) {
    ids.add(name);
    ids.add(name.toLowerCase());
  }
  return ids;
}

export type ScoutMobileCommsConversation = {
  id: string;
  kind: "channel" | "direct" | "group" | "thread" | "system" | "unknown";
  title: string;
  participants: string[];
  topic: string | null;
  lastMessagePreview: string | null;
  lastMessageAuthor: string | null;
  lastMessageAt: number | null;
  messageCount: number;
  unreadCount: number;
};

export type ScoutMobileCommsMessage = {
  id: string;
  conversationId: string;
  actorId: string;
  authorLabel: string;
  authorKind: "person" | "agent" | "system";
  body: string;
  createdAt: number;
  replyToMessageId: string | null;
  isOperator: boolean;
  clientMessageId: string | null;
  attachments: Array<{
    id: string;
    mediaType: string;
    fileName?: string;
    blobKey?: string;
    url?: string;
  }>;
};

function commsActorLabel(
  snapshot: ScoutBrokerSnapshot,
  actorId: string,
  selfIds: Set<string>,
): string {
  if (selfIds.has(actorId)) return "You";
  return snapshot.agents[actorId]?.displayName
    ?? snapshot.actors[actorId]?.displayName
    ?? actorId;
}

function commsAuthorKind(
  snapshot: ScoutBrokerSnapshot,
  actorId: string,
  selfIds: Set<string>,
): "person" | "agent" | "system" {
  if (selfIds.has(actorId)) return "person";
  if (snapshot.agents[actorId]) return "agent";
  const kind = snapshot.actors[actorId]?.kind;
  if (kind === "person") return "person";
  if (kind === "agent") return "agent";
  return "system";
}

function commsMobileKind(kind: string): ScoutMobileCommsConversation["kind"] {
  switch (kind) {
    case "channel": return "channel";
    case "direct": return "direct";
    case "group_direct": return "group";
    case "thread": return "thread";
    case "system": return "system";
    default: return "unknown";
  }
}

export async function getScoutMobileConversations(
  filters: { kind?: string; limit?: number } = {},
): Promise<ScoutMobileCommsConversation[]> {
  const broker = await loadScoutBrokerContext();
  if (!broker) return [];
  const { snapshot } = broker;
  const selfIds = operatorActorIds();

  const byConversation = new Map<string, MessageRecord[]>();
  for (const message of Object.values(snapshot.messages ?? {})) {
    const bucket = byConversation.get(message.conversationId);
    if (bucket) bucket.push(message);
    else byConversation.set(message.conversationId, [message]);
  }

  const operatorReadAt = new Map<string, number>();
  for (const cursor of Object.values(snapshot.readCursors ?? {})) {
    if (selfIds.has(cursor.actorId)) {
      const prev = operatorReadAt.get(cursor.conversationId) ?? 0;
      operatorReadAt.set(cursor.conversationId, Math.max(prev, normalizeTimestampMs(cursor.lastReadAt) ?? 0));
    }
  }

  const includeKinds = new Set(["channel", "direct", "group_direct", "thread"]);
  const rows: ScoutMobileCommsConversation[] = [];
  for (const conv of Object.values(snapshot.conversations ?? {})) {
    if (!includeKinds.has(conv.kind)) continue;
    const mobileKind = commsMobileKind(conv.kind);
    if (filters.kind && filters.kind !== mobileKind) continue;

    const messages = (byConversation.get(conv.id) ?? [])
      .sort((a, b) => requireTimestampMs(a.createdAt) - requireTimestampMs(b.createdAt));
    const last = messages[messages.length - 1];
    const readAt = operatorReadAt.get(conv.id);
    const unread = readAt != null
      ? messages.filter((m) => requireTimestampMs(m.createdAt) > readAt && !selfIds.has(m.actorId)).length
      : 0;
    const directAgentId = conv.kind === "direct"
      ? conv.participantIds.find((participantId) => !selfIds.has(participantId)) ?? null
      : null;

    rows.push({
      id: conv.id,
      kind: mobileKind,
      title: mobileConversationTitle(snapshot, conv, directAgentId),
      participants: conv.participantIds
        .filter((p) => !selfIds.has(p))
        .map((p) => commsActorLabel(snapshot, p, selfIds)),
      topic: conv.topic ?? null,
      lastMessagePreview: last ? last.body.replace(/\s+/g, " ").trim().slice(0, 140) : null,
      lastMessageAuthor: last ? commsActorLabel(snapshot, last.actorId, selfIds) : null,
      lastMessageAt: last ? normalizeTimestampMs(last.createdAt) : null,
      messageCount: messages.length,
      unreadCount: unread,
    });
  }

  rows.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  const limit = filters.limit && filters.limit > 0 ? filters.limit : 100;
  return rows.slice(0, limit);
}

export async function getScoutMobileConversationMessages(
  conversationId: string,
  limit = 200,
): Promise<ScoutMobileCommsMessage[]> {
  const broker = await loadScoutBrokerContext();
  if (!broker) return [];
  const { snapshot } = broker;
  const selfIds = operatorActorIds();

  const messages = Object.values(snapshot.messages ?? {})
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => requireTimestampMs(a.createdAt) - requireTimestampMs(b.createdAt));
  const trimmed = limit > 0 && messages.length > limit
    ? messages.slice(messages.length - limit)
    : messages;

  return trimmed.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    actorId: m.actorId,
    authorLabel: commsActorLabel(snapshot, m.actorId, selfIds),
    authorKind: commsAuthorKind(snapshot, m.actorId, selfIds),
    body: m.body,
    createdAt: requireTimestampMs(m.createdAt),
    replyToMessageId: m.replyToMessageId ?? null,
    isOperator: selfIds.has(m.actorId),
    clientMessageId: metadataString(m.metadata, "clientMessageId"),
    attachments: (m.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      mediaType: attachment.mediaType,
      ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
      ...(attachment.blobKey ? { blobKey: attachment.blobKey } : {}),
      ...(attachment.url ? { url: attachment.url } : {}),
    })),
  }));
}

export async function sendScoutMobileComms(
  input: {
    conversationId: string;
    body: string;
    attachments?: OutgoingAttachmentInput[];
    replyToMessageId?: string | null;
    clientMessageId?: string | null;
  },
  currentDirectory?: string,
  deviceId?: string,
): Promise<ScoutMobileSendResult> {
  const broker = await loadScoutBrokerContext();
  if (!broker) throw new Error("Relay is not reachable.");
  const conv = broker.snapshot.conversations?.[input.conversationId];
  if (!conv) {
    throw new Error(`Unknown conversation: ${input.conversationId}`);
  }
  const selfIds = operatorActorIds();

  // 1:1 DMs route through the direct-message path, addressed to the single
  // non-self participant (it resolves to this same conversation).
  if (conv.kind === "direct") {
    const targetAgentId = conv.participantIds.find((p) => !selfIds.has(p));
    if (!targetAgentId) throw new Error("Conversation has no agent participant to address.");
    const result = await sendScoutMobileMessage(
      {
        agentId: targetAgentId,
        body: input.body,
        attachments: input.attachments,
        clientMessageId: input.clientMessageId,
        replyToMessageId: input.replyToMessageId,
      },
      currentDirectory,
      deviceId,
    );
    return mobileSendResultFromDirect(result);
  }

  // Groups and threads must post to THIS conversation — collapsing to a 1:1 DM
  // with the first participant would land the message in the wrong room.
  if (conv.kind === "group_direct" || conv.kind === "thread") {
    const result = await sendScoutConversationMessage({
      conversationId: input.conversationId,
      senderId: MOBILE_OPERATOR_ID,
      body: input.body,
      attachments: input.attachments,
      replyToMessageId: input.replyToMessageId,
      clientMessageId: input.clientMessageId,
      source: "scout-mobile",
      currentDirectory,
    });
    return {
      conversationId: result.conversationId ?? input.conversationId,
      messageId: result.messageId ?? `local-${Date.now().toString(36)}`,
      flightId: null,
      invocationId: null,
      targetAgentId: null,
      lifecycleState: null,
      summary: null,
      error: null,
    };
  }

  // Channels: post as the operator to the channel name carried in metadata.
  const channel = typeof conv.metadata?.channel === "string" && conv.metadata.channel.trim()
    ? conv.metadata.channel.trim()
    : conv.title;
  const result = await sendScoutMessage({
    senderId: MOBILE_OPERATOR_ID,
    body: input.body,
    channel,
    attachments: input.attachments,
    clientMessageId: input.clientMessageId,
    currentDirectory,
  });
  return {
    conversationId: result.conversationId ?? input.conversationId,
    messageId: result.messageId ?? `local-${Date.now().toString(36)}`,
    flightId: result.flight?.id ?? null,
    invocationId: result.flight?.invocationId ?? null,
    targetAgentId: result.flight?.targetAgentId ?? null,
    lifecycleState: mobileLifecycleStateForFlight(result.flight),
    summary: result.flight?.summary ?? null,
    error: result.flight?.error ?? null,
  };
}

/// Mark a conversation read for the phone operator — advances the operator's
/// read cursor so `getScoutMobileConversations` stops counting these messages as
/// unread. The cursor is attributed to `MOBILE_OPERATOR_ID`, which is one of the
/// `operatorActorIds()` the unread tally recognizes. With no `lastReadMessageId`
/// the broker marks read through the latest message, so the badge clears to 0.
export async function markScoutMobileConversationRead(input: {
  conversationId: string;
  lastReadMessageId?: string | null;
}): Promise<{ conversationId: string; unreadCount: number }> {
  const broker = await loadScoutBrokerContext();
  if (!broker) throw new Error("Relay is not reachable.");
  if (!broker.snapshot.conversations?.[input.conversationId]) {
    throw new Error(`Unknown conversation: ${input.conversationId}`);
  }

  // Anchor the cursor on a CONCRETE message id, not broker inference. If we let
  // the broker infer (no message id), it auto-fills `lastReadSeq = latestThreadSeq`
  // — a small integer — and `resolveReadCursor`'s monotonic guard ranks that
  // against existing cursors, which rank by message `createdAt` (a ~1e12 ms
  // timestamp). The small seq always loses, so the guard reverts the write and
  // `lastReadAt` never advances (the badge never clears). Passing an explicit
  // `lastReadMessageId` makes the broker rank by that message's createdAt, which
  // is newer than the prior cursor ⇒ it advances. See SCO-061 read-cursor flow.
  let lastReadMessageId = input.lastReadMessageId ?? undefined;
  if (!lastReadMessageId) {
    let latest: { id: string; createdAt: number } | undefined;
    for (const m of Object.values(broker.snapshot.messages ?? {})) {
      if (m.conversationId !== input.conversationId) continue;
      const createdAt = requireTimestampMs(m.createdAt);
      if (!latest || createdAt > latest.createdAt) latest = { id: m.id, createdAt };
    }
    lastReadMessageId = latest?.id;
  }

  await recordScoutBrokerReadCursor(
    {
      conversationId: input.conversationId,
      actorId: MOBILE_OPERATOR_ID,
      lastReadMessageId,
    },
    broker.baseUrl,
  );
  // Read through the latest message ⇒ caught up. The next list pull reconciles
  // if a new inbound message landed in the same instant.
  return { conversationId: input.conversationId, unreadCount: 0 };
}
