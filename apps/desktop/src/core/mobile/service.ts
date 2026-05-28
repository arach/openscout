import { basename, resolve } from "node:path";

import type {
  AgentDefinition,
  AgentEndpoint,
  AgentHarness,
  FlightRecord,
  MessageRecord,
} from "@openscout/protocol";
import { loadHarnessCatalogSnapshot } from "@openscout/runtime/harness-catalog";
import {
  type ProjectInventoryEntry,
  loadResolvedRelayAgents,
} from "@openscout/runtime/setup";

import { upScoutAgent } from "../agents/service.ts";
import { queryFleet } from "../../server/db-queries.ts";
import {
  loadScoutBrokerContext,
  loadScoutActivityItems,
  openScoutPeerSession,
  registerScoutLocalAgentBinding,
  sendScoutDirectMessage,
  type ScoutActivityItem,
  type ScoutBrokerSnapshot,
  type ScoutDirectMessageResult,
} from "../broker/service.ts";

const SCOUTBOT_AGENT_ID = "scoutbot";
const SCOUTBOT_DEFAULT_THREAD_ID = "thr-default";
const SCOUTBOT_DEFAULT_CONVERSATION_ID = "dm.operator.scoutbot.default";
const SCOUTBOT_LEGACY_CONVERSATION_ID = "dm.operator.scoutbot";

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
  nodeId: string | null;
  nodeName: string | null;
  workspaceRoot: string | null;
  harness: string | null;
  transport: string | null;
  state: "offline" | "available" | "working";
  statusLabel: string;
  sessionId: string | null;
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
};

export type ScoutMobileSessionHandle = {
  workspace: ScoutMobileWorkspaceSummary;
  agent: ScoutMobileAgentSummary;
  session: {
    conversationId: string;
    title: string;
    existed: boolean;
  };
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
        message?: string;
      };
      status: "streaming" | "completed";
    }>;
    startedAt: number;
    endedAt?: number;
    isUserTurn?: boolean;
  }>;
  currentTurnId: string | null;
};

const DEFAULT_MOBILE_RECENT_TURN_LIMIT = 24;
const DEFAULT_MOBILE_HISTORY_PAGE_LIMIT = 40;

export type SendScoutMobileMessageInput = {
  agentId: string;
  body: string;
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
  referenceMessageIds?: string[];
  harness?: AgentHarness;
};

function normalizeTimestamp(value: number | null | undefined): number | null {
  if (!value) return null;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function normalizeTimestampMs(value: number | null | undefined): number | null {
  if (!value) return null;
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
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
    messages.sort((left, right) => (normalizeTimestamp(left.createdAt) ?? 0) - (normalizeTimestamp(right.createdAt) ?? 0));
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

function endpointForAgent(snapshot: ScoutBrokerSnapshot, agentId: string): AgentEndpoint | null {
  return Object.values(snapshot.endpoints).find((endpoint) => (
    endpoint.agentId === agentId && !isInactiveEndpoint(snapshot, endpoint)
  )) ?? null;
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
    nodeId: endpoint?.nodeId ?? agent.authorityNodeId ?? agent.homeNodeId ?? null,
    nodeName: (endpoint?.nodeId ? snapshot.nodes[endpoint.nodeId]?.name : null)
      ?? snapshot.nodes[agent.authorityNodeId]?.name
      ?? snapshot.nodes[agent.homeNodeId]?.name
      ?? null,
    workspaceRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
    harness: endpoint?.harness ?? null,
    transport: endpoint?.transport ?? null,
    state,
    statusLabel: state === "working" ? "Working" : state === "available" ? "Available" : "Offline",
    sessionId: endpoint?.sessionId ?? null,
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
        title: conversation.kind === "direct" && directAgentId
          ? agentDisplayName(snapshot, directAgentId)
          : conversation.title,
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
    .sort((left, right) => (normalizeTimestamp(left.createdAt) ?? 0) - (normalizeTimestamp(right.createdAt) ?? 0));
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
  const conversation = snapshot.conversations[conversationId];

  // The conversation may not exist yet — the iOS app navigates to
  // dm.operator.{agentId} before any messages are sent.  Return an
  // empty session instead of throwing so the UI can render the chat
  // composer.
  if (!conversation) {
    const inferredAgentId = conversationId.startsWith("dm.operator.")
      ? conversationId.slice("dm.operator.".length)
      : null;
    const agent = inferredAgentId ? snapshot.agents[inferredAgentId] : null;
    const endpoint = inferredAgentId ? endpointForAgent(snapshot, inferredAgentId) : null;
    const agentName = agent
      ? agentDisplayName(snapshot, inferredAgentId!)
      : inferredAgentId ?? conversationId;
    return {
      session: {
        id: conversationId,
        name: agentName,
        adapterType: endpoint?.harness ?? "relay",
        status: endpoint?.state === "offline" ? "idle" : "active",
        cwd: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
        model: typeof endpoint?.metadata?.model === "string" ? endpoint.metadata.model : null,
        providerMeta: {
          conversationId,
          conversationKind: "direct",
          agentId: inferredAgentId,
          workspaceRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
          harness: endpoint?.harness ?? null,
          selector: agent?.selector ?? null,
          defaultSelector: agent?.defaultSelector ?? null,
          project: agentName,
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
      history: { hasOlder: false, oldestTurnId: null, newestTurnId: null },
      turns: [],
      currentTurnId: null,
    };
  }

  const directAgentId = conversation.kind === "direct"
    ? conversation.participantIds.find((participantId) => participantId !== "operator") ?? null
    : null;
  const endpoint = directAgentId ? endpointForAgent(snapshot, directAgentId) : null;
  const agent = directAgentId ? snapshot.agents[directAgentId] : null;
  const messagePage = pageMessagesForConversation(snapshot, conversationId, options);
  const messages = messagePage.messages;
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
    }],
    startedAt: normalizeTimestampMs(message.createdAt) ?? Date.now(),
    endedAt: normalizeTimestampMs(message.createdAt) ?? Date.now(),
    isUserTurn: message.actorId === "operator",
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
      name: conversation.title,
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
        project: directAgentId ? agentDisplayName(snapshot, directAgentId) : conversation.title,
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
    nodeId: brokerEndpoint?.nodeId ?? brokerAgent?.authorityNodeId ?? brokerAgent?.homeNodeId ?? null,
    nodeName: snapshot
      ? (brokerEndpoint?.nodeId ? snapshot.nodes[brokerEndpoint.nodeId]?.name : null)
        ?? (brokerAgent?.authorityNodeId ? snapshot.nodes[brokerAgent.authorityNodeId]?.name : null)
        ?? (brokerAgent?.homeNodeId ? snapshot.nodes[brokerAgent.homeNodeId]?.name : null)
        ?? null
      : null,
    workspaceRoot: brokerEndpoint?.projectRoot ?? brokerEndpoint?.cwd ?? workspace.root,
    harness: brokerEndpoint?.harness ?? localAgent.harness,
    transport: localAgent.transport,
    state: brokerEndpoint?.state === "offline" ? "offline" : "available",
    statusLabel: brokerEndpoint?.state === "offline" ? "Offline" : "Available",
    sessionId: localAgent.sessionId,
    lastActiveAt: null,
  };

  return {
    workspace,
    agent: agentSummary,
    session: {
      conversationId: directSession.conversation.id,
      title: agentTitle,
      existed: directSession.existed,
    },
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
    return sendScoutbotMobileThreadMessage(input, currentDirectory, deviceId);
  }

  return sendScoutDirectMessage({
    agentId: input.agentId,
    body: input.body,
    currentDirectory,
    clientMessageId: input.clientMessageId,
    replyToMessageId: input.replyToMessageId,
    referenceMessageIds: input.referenceMessageIds,
    executionHarness: input.harness,
    source: "scout-mobile",
    deviceId,
  });
}

async function sendScoutbotMobileThreadMessage(
  input: SendScoutMobileMessageInput,
  currentDirectory?: string,
  deviceId?: string,
): Promise<ScoutDirectMessageResult> {
  void currentDirectory;
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    throw new Error("Scoutbot is not available.");
  }

  const conversationId = broker.snapshot.conversations[SCOUTBOT_LEGACY_CONVERSATION_ID]
    ? SCOUTBOT_LEGACY_CONVERSATION_ID
    : SCOUTBOT_DEFAULT_CONVERSATION_ID;
  const conversation = broker.snapshot.conversations[conversationId] ?? {
    id: conversationId,
    kind: "direct",
    title: conversationId === SCOUTBOT_LEGACY_CONVERSATION_ID ? "Scout" : "Scout · default",
    visibility: "private",
    shareMode: "local",
    authorityNodeId: broker.node.id,
    participantIds: ["operator", SCOUTBOT_AGENT_ID].sort(),
    metadata: {
      surface: "scoutbot",
      scoutbotThreadId: SCOUTBOT_DEFAULT_THREAD_ID,
    },
  };
  if (!broker.snapshot.conversations[conversationId]) {
    await postMobileBrokerJson(broker.baseUrl, "/v1/conversations", conversation);
  }

  const now = Date.now();
  const messageId = createMobileBrokerEntityId("msg", now);
  const transportSessionId = scoutbotTransportSessionId(broker.snapshot);
  await postMobileBrokerJson(broker.baseUrl, "/v1/messages", {
    id: messageId,
    conversationId,
    actorId: "operator",
    originNodeId: broker.node.id,
    class: "agent",
    body: input.body.trim(),
    replyToMessageId: input.replyToMessageId ?? undefined,
    mentions: [{ actorId: SCOUTBOT_AGENT_ID, label: "@scoutbot" }],
    audience: { notify: [SCOUTBOT_AGENT_ID], reason: "direct_message" },
    visibility: "private",
    policy: "durable",
    createdAt: now,
    metadata: {
      source: "scout-mobile",
      destinationKind: "scoutbot_thread",
      destinationId: SCOUTBOT_DEFAULT_THREAD_ID,
      scoutbotThreadId: SCOUTBOT_DEFAULT_THREAD_ID,
      ...(transportSessionId ? { targetSessionId: transportSessionId } : {}),
      referenceMessageIds: input.referenceMessageIds ?? [],
      clientMessageId: input.clientMessageId ?? null,
      ...(deviceId ? { deviceId } : {}),
      relayMessageId: messageId,
      returnAddress: {
        actorId: "operator",
        conversationId,
        replyToMessageId: messageId,
        ...(transportSessionId ? { sessionId: transportSessionId } : {}),
      },
    },
  });

  return {
    conversationId,
    messageId,
  };
}

function scoutbotTransportSessionId(snapshot: ScoutBrokerSnapshot): string | null {
  const endpoint = Object.values(snapshot.endpoints ?? {}).find((candidate) => (
    candidate.agentId === SCOUTBOT_AGENT_ID
      && candidate.transport === "codex_app_server"
      && !isInactiveEndpoint(snapshot, candidate)
  ));
  if (!endpoint) return null;
  return metadataString(endpoint.metadata, "threadId")
    ?? metadataString(endpoint.metadata, "externalSessionId")
    ?? endpoint.sessionId?.trim()
    ?? null;
}

async function postMobileBrokerJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Broker ${path} failed (${response.status}): ${text || response.statusText}`);
  }
  return await response.json() as T;
}

function createMobileBrokerEntityId(prefix: string, createdAtMs: number): string {
  return `${prefix}-${createdAtMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Derive a human-readable agent name for a new session.
 *
 * Strategy: project-branch-harness, incrementing if taken.
 * Examples:
 *   openscout + main + claude-code  → "openscout"        (first, default harness)
 *   openscout + feat/trpc + claude  → "openscout-trpc"   (branch suffix)
 *   openscout + main + codex        → "openscout-codex"  (non-default harness)
 *   openscout + main + claude-code  → "openscout-2"      (second session, same config)
 */
async function deriveNewAgentName(
  projectName: string,
  branch?: string,
  harness?: string,
): Promise<string> {
  const parts = [projectName.toLowerCase()];

  // Add shortened branch — take last segment, strip common prefixes
  if (branch) {
    const branchPart = branch
      .split("/").pop()!
      .replace(/^(feat|fix|chore|release|hotfix)[/-]?/i, "")
      .slice(0, 20);
    if (branchPart && branchPart !== "main" && branchPart !== "master") {
      parts.push(branchPart);
    }
  }

  // Add harness only if not the default
  if (harness && harness !== "claude-code" && harness !== "claude") {
    parts.push(harness);
  }

  const base = parts.join("-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");

  // Check existing agents in the broker to find the next available number
  const broker = await loadScoutBrokerContext();
  if (broker) {
    const existingIds = Object.keys(broker.snapshot.agents);
    const matchingCount = existingIds.filter((id) =>
      id.startsWith(base) || id.includes(`.${base}.`) || id.includes(`.${base}-`)
    ).length;
    if (matchingCount > 0) {
      return `${base}-${matchingCount + 1}`;
    }
  }

  return base;
}

/**
 * Create a git worktree for an agent session.
 *
 * Creates a new branch `scout/<agentName>` and a worktree at
 * `<projectRoot>/.scout-worktrees/<agentName>`.
 *
 * Returns the worktree path, or null if the project isn't a git repo.
 */
async function createGitWorktree(
  projectRoot: string,
  agentName: string,
  requestedBranch?: string,
): Promise<{ path: string; branch: string } | null> {
  const { execFileSync } = await import("child_process");
  const { join } = await import("path");
  const { mkdirSync, existsSync } = await import("fs");

  // Check if this is a git repo
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: projectRoot, stdio: "pipe" });
  } catch {
    return null;
  }

  const normalizedRequestedBranch = requestedBranch?.trim();
  const branchName = normalizedRequestedBranch || `scout/${agentName}`;
  const worktreeDir = join(projectRoot, ".scout-worktrees");
  const worktreePath = join(worktreeDir, agentName);

  // If worktree already exists, reuse it
  if (existsSync(worktreePath)) {
    return { path: worktreePath, branch: branchName };
  }

  mkdirSync(worktreeDir, { recursive: true });

  try {
    // Create worktree with a new branch based on current HEAD
    execFileSync("git", ["worktree", "add", "-b", branchName, worktreePath], { cwd: projectRoot, stdio: "pipe" });
    return { path: worktreePath, branch: branchName };
  } catch (error) {
    // Branch might already exist — try without -b
    try {
      execFileSync("git", ["worktree", "add", worktreePath, branchName], { cwd: projectRoot, stdio: "pipe" });
      return { path: worktreePath, branch: branchName };
    } catch {
      // If both fail, fall back to no worktree
      return null;
    }
  }
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
): Promise<ScoutActivityItem[]> {
  return loadScoutActivityItems({
    agentId: filters.agentId,
    actorId: filters.actorId,
    conversationId: filters.conversationId,
    limit: filters.limit ?? 100,
  });
}
