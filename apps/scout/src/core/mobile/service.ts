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
import {
  loadScoutBrokerContext,
  openScoutPeerSession,
  registerScoutLocalAgentBinding,
  sendScoutDirectMessage,
  type ScoutBrokerSnapshot,
  type ScoutDirectMessageResult,
} from "../broker/service.ts";

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

export type CreateScoutMobileSessionInput = {
  workspaceId: string;
  harness?: AgentHarness;
  agentName?: string;
  worktree?: string | null;
  profile?: string | null;
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
  return Object.values(snapshot.endpoints).find((endpoint) => endpoint.agentId === agentId) ?? null;
}

function buildMobileAgentSummary(
  snapshot: ScoutBrokerSnapshot,
  agent: AgentDefinition,
): ScoutMobileAgentSummary {
  const endpoint = endpointForAgent(snapshot, agent.id);
  const flights = Object.values(snapshot.flights as Record<string, FlightRecord>).filter((flight) => flight.targetAgentId === agent.id);
  const hasWorkingFlight = flights.some((flight) => !["completed", "failed", "cancelled"].includes(flight.state));
  const lastAuthoredMessageAt = Object.values(snapshot.messages)
    .filter((message) => message.actorId === agent.id)
    .reduce<number | null>((latest, message) => {
      const createdAt = normalizeTimestamp(message.createdAt);
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
    statusLabel: hasWorkingFlight ? "Working" : endpoint?.state === "active" ? "Available" : endpoint?.state ?? "Offline",
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
      if (!directAgentId || !agent || messages.length === 0) {
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
        lastMessageAt: normalizeTimestamp(latestMessage?.createdAt),
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
      && !["completed", "failed", "cancelled"].includes(flight.state)
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
  if (!conversation) {
    throw new Error(`Unknown mobile session "${conversationId}".`);
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
      const createdAt = normalizeTimestamp(message.createdAt);
      return typeof createdAt === "number" && (!latest || createdAt > latest) ? createdAt : latest;
    }, null);
  const shouldShowWorkingTurn = Boolean(
    activeFlight
    && ((normalizeTimestamp(activeFlight.startedAt) ?? 0) > (lastAgentMessageAt ?? 0)),
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

export async function createScoutMobileSession(
  input: CreateScoutMobileSessionInput,
  currentDirectory?: string,
  deviceId?: string,
): Promise<ScoutMobileSessionHandle> {
  const workspaces = await loadMobileWorkspaceInventory(currentDirectory);
  const workspace = workspaces.find((entry) => entry.id === input.workspaceId || entry.root === input.workspaceId);
  if (!workspace) {
    throw new Error(`Unknown workspace "${input.workspaceId}".`);
  }

  const localAgent = await upScoutAgent({
    projectPath: workspace.root,
    agentName: workspace.projectName,
    harness: input.harness,
    currentDirectory: currentDirectory ?? workspace.root,
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
      ...(input.worktree ? ["worktree" as const] : []),
      ...(input.profile ? ["profile" as const] : []),
    ],
  };
}

export async function sendScoutMobileMessage(
  input: SendScoutMobileMessageInput,
  currentDirectory?: string,
  deviceId?: string,
): Promise<ScoutDirectMessageResult> {
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

async function requireMobileRelayContext() {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    throw new Error("Relay is not reachable.");
  }
  return broker;
}
