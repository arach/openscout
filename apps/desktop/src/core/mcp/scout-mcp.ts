import { basename, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  diagnoseAgentIdentity,
  formatMinimalAgentIdentity,
  parseAgentIdentity,
  type AgentIdentityCandidate,
  type AgentState,
  type ScoutAgentCard,
} from "@openscout/protocol";
import {
  findNearestProjectRoot,
  loadResolvedRelayAgents,
  type ResolvedRelayAgentConfig,
} from "@openscout/runtime/setup";
import * as z from "zod/v4";

import { createScoutAgentCard } from "../agents/service.ts";
import {
  askScoutAgentById,
  askScoutQuestion,
  listScoutAgents,
  loadScoutBrokerContext,
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
  sendScoutMessage,
  sendScoutMessageToAgentIds,
  updateScoutWorkItem,
  waitForScoutFlight,
  type ScoutAskByIdResult,
  type ScoutAskResult,
  type ScoutFlightRecord,
  type ScoutMessagePostResult,
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
const LOCAL_AGENT_HARNESS_VALUES = ["claude", "codex"] as const;

type SearchableAgentState = (typeof AGENT_STATE_VALUES)[number];
type SearchRegistrationKind = (typeof REGISTRATION_KIND_VALUES)[number];

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
    currentDirectory: string;
    createdById?: string;
  }) => Promise<ScoutAgentCard>;
  sendMessage: (input: {
    senderId: string;
    body: string;
    channel?: string;
    shouldSpeak?: boolean;
    currentDirectory: string;
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
  askQuestion: (input: {
    senderId: string;
    targetLabel: string;
    body: string;
    workItem?: ScoutWorkItemInput;
    channel?: string;
    shouldSpeak?: boolean;
    currentDirectory: string;
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
  mode: z.enum(["body_mentions", "explicit_targets"]),
  usedBroker: z.boolean(),
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
  invokedTargetIds: z.array(z.string()),
  unresolvedTargetIds: z.array(z.string()),
  routeKind: z.enum(MESSAGE_ROUTE_KIND_VALUES).nullable(),
  routingError: z.enum(MESSAGE_ROUTING_ERROR_VALUES).nullable(),
});

const cardCreateResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  card: scoutAgentCardSchema,
});

const askResultSchema = z.object({
  currentDirectory: z.string(),
  senderId: z.string(),
  targetAgentId: z.string().nullable(),
  targetLabel: z.string().nullable(),
  usedBroker: z.boolean(),
  awaited: z.boolean(),
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

function createTextContent(value: unknown): [{ type: "text"; text: string }] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

function normalizeSearchValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/^@+/, "") ?? "";
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
  return {
    agentId: entry.agentId,
    definitionId: entry.definitionId,
    ...(entry.workspace ? { workspaceQualifier: entry.workspace } : {}),
    ...(entry.node ? { nodeQualifier: entry.node } : {}),
    ...(entry.harness ? { harness: entry.harness } : {}),
    aliases: [entry.selector, entry.defaultSelector, entry.handle].filter(
      (value): value is string => Boolean(value && value.trim().length > 0),
    ),
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
      workspace: entry.workspace,
      node: entry.node,
      projectRoot: entry.projectRoot,
      transport: entry.transport,
    };
  });
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
    candidate.workspace,
    candidate.node,
    candidate.projectRoot ? basename(candidate.projectRoot) : null,
  ];
  let best = -1;
  for (const value of haystacks) {
    best = Math.max(best, scoreTextCandidate(value, query));
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
      workspace: discovered.instance.workspaceQualifier || null,
      node: discovered.instance.nodeQualifier || null,
      projectRoot: discovered.projectRoot,
      transport: discovered.runtime.transport ?? null,
    });
  }

  for (const agent of Object.values(broker.snapshot.agents ?? {})) {
    if (agent.id === "operator") continue;

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
      currentDirectory,
      createdById,
    }) =>
      createScoutAgentCard({
        projectPath,
        agentName,
        displayName,
        harness,
        currentDirectory,
        createdById,
      }),
    sendMessage: ({ senderId, body, channel, shouldSpeak, currentDirectory }) =>
      sendScoutMessage({
        senderId,
        body,
        channel,
        shouldSpeak,
        currentDirectory,
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
    askQuestion: ({
      senderId,
      targetLabel,
      body,
      workItem,
      channel,
      shouldSpeak,
      currentDirectory,
    }) =>
      askScoutQuestion({
        senderId,
        targetLabel,
        body,
        workItem,
        channel,
        shouldSpeak,
        currentDirectory,
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
        "Start here. Resolve the default Scout sender identity and broker URL for a working directory before creating cards, sending messages, or handing off work.",
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
        "Search the live Scout broker and discovered agent inventory for @mention candidates. Use this after whoami when you know roughly who you need but do not yet have an exact handle.",
      inputSchema: z.object({
        query: z.string().optional(),
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
        "Resolve one exact Scout agent handle or return ambiguity details. Use this before send or ask when a short handle may be ambiguous.",
      inputSchema: z.object({
        label: z.string().min(1),
        currentDirectory: z.string().optional(),
      }),
      outputSchema: resolveResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
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
        "Post a broker-backed Scout tell/update. Use this for heads-up, replies, and status. One explicit target without a channel becomes a DM. Group delivery requires an explicit channel. Use broadcast or channel='shared' for shared updates. For owned work or a reply lifecycle, use invocations_ask instead. Prefer mentionAgentIds for first-class targeting.",
      inputSchema: z.object({
        body: z.string().min(1),
        currentDirectory: z.string().optional(),
        senderId: z.string().optional(),
        channel: z.string().optional(),
        shouldSpeak: z.boolean().optional(),
        mentionAgentIds: z.array(z.string()).optional(),
      }),
      outputSchema: sendResultSchema,
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
          routeKind: result.routeKind ?? null,
          routingError: result.routingError ?? null,
        };
        return {
          content: createTextContent(structuredContent),
          structuredContent,
        };
      }

      const result = await deps.sendMessage({
        senderId: resolvedSenderId,
        body,
        channel,
        shouldSpeak,
        currentDirectory: resolvedCurrentDirectory,
      });
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        mode: "body_mentions" as const,
        usedBroker: result.usedBroker,
        conversationId: result.conversationId ?? null,
        messageId: result.messageId ?? null,
        invokedTargetIds: result.invokedTargets,
        unresolvedTargetIds: result.unresolvedTargets,
        routeKind: result.routeKind ?? null,
        routingError: result.routingError ?? null,
      };
      return {
        content: createTextContent(structuredContent),
        structuredContent,
      };
    },
  );

  server.registerTool(
    "invocations_ask",
    {
      title: "Ask Scout Agent",
      description:
        "Create a broker-backed Scout ask/work handoff. This is the durable path for 'do this and get back to me.' One target without a channel becomes a DM. Provide workItem to mint a durable workId beyond the message and flight ids. Use awaitReply only when the host cannot delegate background waiting.",
      inputSchema: z
        .object({
          body: z.string().min(1),
          currentDirectory: z.string().optional(),
          senderId: z.string().optional(),
          targetAgentId: z.string().optional(),
          targetLabel: z.string().optional(),
          workItem: workItemInputSchema.optional(),
          channel: z.string().optional(),
          shouldSpeak: z.boolean().optional(),
          awaitReply: z.boolean().optional(),
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
      const shouldAwait = Boolean(awaitReply);

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
        const structuredContent = {
          currentDirectory: resolvedCurrentDirectory,
          senderId: resolvedSenderId,
          targetAgentId: targetAgentId.trim(),
          targetLabel: null,
          usedBroker: result.usedBroker,
          awaited: shouldAwait,
          conversationId: result.conversationId ?? null,
          messageId: result.messageId ?? null,
          flight: completedFlight ?? result.flight ?? null,
          flightId: completedFlight?.id ?? result.flight?.id ?? null,
          output: completedFlight?.output ?? completedFlight?.summary ?? null,
          unresolvedTargetId: result.unresolvedTargetId ?? null,
          unresolvedTargetLabel: null,
          workItem: result.workItem ?? null,
          workId: result.workItem?.id ?? null,
          workUrl: result.workItem
            ? `/api/work/${encodeURIComponent(result.workItem.id)}`
            : null,
          targetDiagnostic: result.targetDiagnostic ?? null,
        };
        return {
          content: createTextContent(structuredContent),
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
      });
      const completedFlight =
        shouldAwait && result.flight
          ? await deps.waitForFlight(
              deps.resolveBrokerUrl(),
              result.flight.id,
              { timeoutSeconds },
            )
          : null;
      const structuredContent = {
        currentDirectory: resolvedCurrentDirectory,
        senderId: resolvedSenderId,
        targetAgentId: result.flight?.targetAgentId ?? null,
        targetLabel: targetLabel!.trim(),
        usedBroker: result.usedBroker,
        awaited: shouldAwait,
        conversationId: result.conversationId ?? null,
        messageId: result.messageId ?? null,
        flight: completedFlight ?? result.flight ?? null,
        flightId: completedFlight?.id ?? result.flight?.id ?? null,
        output: completedFlight?.output ?? completedFlight?.summary ?? null,
        unresolvedTargetId: null,
        unresolvedTargetLabel: result.unresolvedTarget ?? null,
        workItem: result.workItem ?? null,
        workId: result.workItem?.id ?? null,
        workUrl: result.workItem
          ? `/api/work/${encodeURIComponent(result.workItem.id)}`
          : null,
        targetDiagnostic: result.targetDiagnostic ?? null,
      };
      return {
        content: createTextContent(structuredContent),
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
