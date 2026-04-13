import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  buildRelayReturnAddress,
  type ActorIdentity,
  type AgentDefinition,
  type AgentEndpoint,
  extractAgentSelectors,
  type FlightRecord,
  type NodeDefinition,
  resolveAgentSelector,
  type AgentHarness,
  type AgentSelector,
  type AgentSelectorCandidate,
  type AgentState,
  type ConversationBinding,
  type ConversationDefinition,
  type ControlEvent,
  type CollaborationRecord,
  type MessageRecord,
  type RelayReturnAddress,
} from "@openscout/protocol";
import {
  ensureRelayAgentConfigured,
  loadResolvedRelayAgents,
  resolveRelayAgentConfig,
  SCOUT_AGENT_ID,
  type ResolvedRelayAgentConfig,
} from "@openscout/runtime/setup";
import {
  inferLocalAgentBinding,
  SUPPORTED_LOCAL_AGENT_HARNESSES,
  type LocalAgentBinding,
} from "@openscout/runtime/local-agents";
import type { RuntimeRegistrySnapshot } from "@openscout/runtime/registry";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";
import { resolveOperatorName } from "@openscout/runtime/user-config";

import {
  openAiAudioSpeechUrl,
  scoutBrokerMessagesListPath,
  scoutBrokerPaths,
} from "./paths.ts";

export type ScoutBrokerActorRecord = ActorIdentity;
export type ScoutBrokerAgentRecord = AgentDefinition;
export type ScoutBrokerEndpointRecord = AgentEndpoint;
export type ScoutBrokerConversationRecord = ConversationDefinition;
export type ScoutBrokerMessageRecord = MessageRecord;
export type ScoutBrokerNodeRecord = NodeDefinition;
export type ScoutBrokerFlightRecord = FlightRecord;
export type ScoutBrokerConversationBindingRecord = ConversationBinding;
export type ScoutBrokerCollaborationRecord = CollaborationRecord;
export type ScoutBrokerSnapshot = RuntimeRegistrySnapshot;

export type ScoutBrokerContext = {
  baseUrl: string;
  node: ScoutBrokerNodeRecord;
  snapshot: ScoutBrokerSnapshot;
};

export type ScoutBrokerHealthState = {
  baseUrl: string;
  reachable: boolean;
  ok: boolean;
  nodeId: string | null;
  meshId: string | null;
  counts: {
    nodes: number;
    actors: number;
    agents: number;
    conversations: number;
    messages: number;
    flights: number;
  } | null;
  error: string | null;
};

export type ScoutBrokerHomeAgentRecord = {
  id: string;
  title: string;
  role: string | null;
  summary: string | null;
  projectRoot: string | null;
  state: "offline" | "available" | "working";
  reachable: boolean;
  statusLabel: string;
  statusDetail: string | null;
  activeTask: string | null;
  lastSeenAt: number | null;
};

export type ScoutBrokerHomeActivityRecord = {
  id: string;
  kind: "message" | "system";
  actorId: string;
  actorName: string;
  title: string;
  detail: string | null;
  conversationId: string | null;
  channel: string | null;
  timestamp: number;
};

export type ScoutBrokerHomePayload = {
  updatedAt: number;
  agents: ScoutBrokerHomeAgentRecord[];
  activity: ScoutBrokerHomeActivityRecord[];
};

export type ScoutMentionTarget = {
  agentId: string;
  label: string;
  selector: AgentSelector;
};

export type ScoutMessagePostResult = {
  usedBroker: boolean;
  invokedTargets: string[];
  unresolvedTargets: string[];
};

export type ScoutFlightRecord = {
  id: string;
  invocationId: string;
  requesterId: string;
  targetAgentId: string;
  state: string;
  summary?: string;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
};

export type ScoutAskResult = {
  usedBroker: boolean;
  flight?: ScoutFlightRecord;
  conversationId?: string;
  messageId?: string;
  unresolvedTarget?: string;
  targetDiagnostic?: ScoutAskTargetDiagnostic;
};

export type ScoutAskTargetDiagnostic = {
  agentId: string;
  state: AgentState | "discovered" | "unknown";
  registrationKind: ScoutWhoRegistrationKind | null;
  projectRoot: string | null;
};

export type ScoutDirectSessionResult = {
  agent: ScoutBrokerAgentRecord;
  conversation: ScoutBrokerConversationRecord;
  existed: boolean;
};

export type ScoutPeerSessionResult = ScoutDirectSessionResult & {
  sourceId: string;
  targetId: string;
};

export type ScoutLocalAgentBindingSyncResult = {
  binding: LocalAgentBinding;
  brokerRegistered: boolean;
};

export type ScoutDirectMessageResult = {
  conversationId: string;
  messageId: string;
  flight?: ScoutFlightRecord;
};

export type ScoutWatchOptions = {
  agentId?: string;
  channel?: string;
  signal?: AbortSignal;
  onMessage: (message: ScoutBrokerMessageRecord) => void;
};

export type ScoutWhoRegistrationKind = "broker" | "configured" | "discovered";

export type ScoutWhoEntry = {
  agentId: string;
  state: AgentState | "discovered";
  messages: number;
  lastSeen: number | null;
  registrationKind: ScoutWhoRegistrationKind;
};

type RelayConfig = {
  channels?: Record<string, { audio: boolean; voice?: string }>;
  defaultVoice?: string;
  pronunciations?: Record<string, string>;
  openaiApiKey?: string;
};

const BROKER_SHARED_CHANNEL_ID = "channel.shared";
const BROKER_VOICE_CHANNEL_ID = "channel.voice";
const BROKER_SYSTEM_CHANNEL_ID = "channel.system";
const OPERATOR_ID = "operator";
const DEFAULT_BROKER_HOST = "127.0.0.1";
const DEFAULT_BROKER_PORT = 65535;

function buildScoutBrokerUrlFromEnv(): string {
  const host = process.env.OPENSCOUT_BROKER_HOST ?? DEFAULT_BROKER_HOST;
  const port = Number.parseInt(process.env.OPENSCOUT_BROKER_PORT ?? String(DEFAULT_BROKER_PORT), 10);
  const fromEnv = process.env.OPENSCOUT_BROKER_URL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return `http://${host}:${port}`;
}

function relayHubDirectory(): string {
  return resolveOpenScoutSupportPaths().relayHubDirectory;
}

export function resolveScoutBrokerUrl(): string {
  return buildScoutBrokerUrlFromEnv();
}

export function resolveScoutAgentName(agentName?: string | null): string {
  const trimmed = agentName?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (process.env.OPENSCOUT_AGENT?.trim()) {
    return process.env.OPENSCOUT_AGENT.trim();
  }
  return resolveOperatorName();
}

export async function resolveScoutSenderId(agentName: string | null | undefined, currentDirectory: string): Promise<string> {
  if (agentName?.trim()) {
    return agentName.trim();
  }
  if (process.env.OPENSCOUT_AGENT?.trim()) {
    return process.env.OPENSCOUT_AGENT.trim();
  }
  const { findNearestProjectRoot } = await import("@openscout/runtime/setup");
  const { resolveLocalAgentByName } = await import("@openscout/runtime/local-agents");
  const projectRoot = await findNearestProjectRoot(currentDirectory) ?? currentDirectory;
  const projectName = basename(projectRoot);
  const agent = await resolveLocalAgentByName(projectName);
  return agent?.agentId ?? projectName;
}

export function parseScoutHarness(value?: string | null): AgentHarness | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (SUPPORTED_LOCAL_AGENT_HARNESSES.includes(trimmed as AgentHarness)) {
    return trimmed as AgentHarness;
  }
  throw new Error(`Unsupported harness "${trimmed}". Use one of: ${SUPPORTED_LOCAL_AGENT_HARNESSES.join(", ")}`);
}

export function normalizeUnixTimestamp(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function maxDefined(values: Array<number | null | undefined>): number | null {
  let maxValue: number | null = null;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    maxValue = maxValue === null ? value : Math.max(maxValue, value);
  }
  return maxValue;
}

function titleCaseName(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function displayNameForBrokerActor(snapshot: ScoutBrokerSnapshot, actorId: string): string {
  return snapshot.agents[actorId]?.displayName
    ?? snapshot.actors[actorId]?.displayName
    ?? titleCaseName(metadataString(snapshot.agents[actorId]?.metadata, "definitionId") || actorId);
}

function firstEndpointForActor(
  snapshot: ScoutBrokerSnapshot,
  actorId: string,
): ScoutBrokerEndpointRecord | undefined {
  return Object.values(snapshot.endpoints)
    .filter((endpoint) => endpoint.agentId === actorId)
    .sort((lhs, rhs) => lhs.id.localeCompare(rhs.id))[0];
}

function buildScoutReturnAddress(
  snapshot: ScoutBrokerSnapshot,
  actorId: string,
  options: {
    conversationId?: string;
    replyToMessageId?: string;
  } = {},
): RelayReturnAddress {
  const agent = snapshot.agents[actorId];
  const actor = snapshot.actors[actorId];
  const endpoint = firstEndpointForActor(snapshot, actorId);
  const selector = agent?.selector?.trim()
    || metadataString(agent?.metadata, "selector")
    || metadataString(actor?.metadata, "selector");
  const defaultSelector = agent?.defaultSelector?.trim()
    || metadataString(agent?.metadata, "defaultSelector")
    || metadataString(actor?.metadata, "defaultSelector");
  const projectRoot = endpoint?.projectRoot
    ?? endpoint?.cwd
    ?? metadataString(agent?.metadata, "projectRoot")
    ?? metadataString(actor?.metadata, "projectRoot");

  return buildRelayReturnAddress({
    actorId,
    handle: agent?.handle?.trim() || actor?.handle?.trim() || actorId,
    displayName: agent?.displayName || actor?.displayName,
    selector,
    defaultSelector,
    conversationId: options.conversationId,
    replyToMessageId: options.replyToMessageId,
    nodeId: endpoint?.nodeId || agent?.authorityNodeId || agent?.homeNodeId,
    projectRoot,
    sessionId: endpoint?.sessionId,
  });
}

function sanitizeConversationSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "shared";
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function metadataBoolean(metadata: Record<string, unknown> | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

function isSupersededBrokerAgent(snapshot: ScoutBrokerSnapshot, agentId: string): boolean {
  const agent = snapshot.agents[agentId];
  if (!agent) {
    return false;
  }
  if (!metadataBoolean(agent.metadata, "staleLocalRegistration")) {
    return false;
  }
  const replacementAgentId = metadataString(agent.metadata, "replacedByAgentId");
  return Boolean(replacementAgentId && snapshot.agents[replacementAgentId]);
}

async function brokerReadJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function brokerPostJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export async function readScoutBrokerHealth(baseUrl = resolveScoutBrokerUrl()): Promise<ScoutBrokerHealthState> {
  try {
    const health = await brokerReadJson<{
      ok?: boolean;
      nodeId?: string;
      meshId?: string;
      counts?: {
        nodes?: number;
        actors?: number;
        agents?: number;
        conversations?: number;
        messages?: number;
        flights?: number;
      };
    }>(baseUrl, scoutBrokerPaths.health);

    return {
      baseUrl,
      reachable: true,
      ok: Boolean(health.ok),
      nodeId: health.nodeId ?? null,
      meshId: health.meshId ?? null,
      counts: health.counts
        ? {
            nodes: health.counts.nodes ?? 0,
            actors: health.counts.actors ?? 0,
            agents: health.counts.agents ?? 0,
            conversations: health.counts.conversations ?? 0,
            messages: health.counts.messages ?? 0,
            flights: health.counts.flights ?? 0,
          }
        : null,
      error: null,
    };
  } catch (error) {
    return {
      baseUrl,
      reachable: false,
      ok: false,
      nodeId: null,
      meshId: null,
      counts: null,
      error: error instanceof Error ? error.message : null,
    };
  }
}

export async function readScoutBrokerHome(baseUrl = resolveScoutBrokerUrl()): Promise<ScoutBrokerHomePayload | null> {
  try {
    return await brokerReadJson<ScoutBrokerHomePayload>(baseUrl, scoutBrokerPaths.v1.home);
  } catch {
    return null;
  }
}

export async function readScoutBrokerSnapshot(baseUrl = resolveScoutBrokerUrl()): Promise<ScoutBrokerSnapshot | null> {
  try {
    return await brokerReadJson<ScoutBrokerSnapshot>(baseUrl, scoutBrokerPaths.v1.snapshot);
  } catch {
    return null;
  }
}

export async function loadScoutBrokerContext(baseUrl = resolveScoutBrokerUrl()): Promise<ScoutBrokerContext | null> {
  const health = await readScoutBrokerHealth(baseUrl);
  if (!health.reachable || !health.ok) {
    return null;
  }

  try {
    const [node, snapshot] = await Promise.all([
      brokerReadJson<ScoutBrokerNodeRecord>(baseUrl, scoutBrokerPaths.v1.node),
      brokerReadJson<ScoutBrokerSnapshot>(baseUrl, scoutBrokerPaths.v1.snapshot),
    ]);
    if (!node.id) {
      return null;
    }
    return { baseUrl, node, snapshot };
  } catch {
    return null;
  }
}

export async function requireScoutBrokerContext(baseUrl = resolveScoutBrokerUrl()): Promise<ScoutBrokerContext> {
  const context = await loadScoutBrokerContext(baseUrl);
  if (!context) {
    throw new Error(`Broker is not reachable at ${baseUrl}. Run scout setup first.`);
  }
  return context;
}

export function scoutConversationIdForChannel(channel?: string): string {
  const normalizedChannel = channel?.trim() || "shared";
  if (normalizedChannel === "voice") return BROKER_VOICE_CHANNEL_ID;
  if (normalizedChannel === "system") return BROKER_SYSTEM_CHANNEL_ID;
  if (normalizedChannel === "shared") return BROKER_SHARED_CHANNEL_ID;
  return `channel.${sanitizeConversationSegment(normalizedChannel)}`;
}

async function resolveMentionTargets(
  snapshot: ScoutBrokerSnapshot,
  text: string,
  currentDirectory: string,
): Promise<{ resolved: ScoutMentionTarget[]; unresolved: string[] }> {
  const selectors = extractAgentSelectors(text);
  const resolved = new Map<string, ScoutMentionTarget>();
  const unresolved: string[] = [];
  const candidateMap = new Map<string, AgentSelectorCandidate>();
  const endpointBackedAgentIds = [...new Set(
    Object.values(snapshot.endpoints).map((endpoint) => endpoint.agentId).filter((agentId) => agentId && agentId !== OPERATOR_ID),
  )];

  for (const agent of Object.values(snapshot.agents)) {
    if (isSupersededBrokerAgent(snapshot, agent.id)) {
      continue;
    }
    candidateMap.set(agent.id, {
      agentId: agent.id,
      definitionId: metadataString(agent.metadata, "definitionId") || agent.id,
      nodeQualifier: metadataString(agent.metadata, "nodeQualifier"),
      workspaceQualifier: metadataString(agent.metadata, "workspaceQualifier"),
      aliases: [
        metadataString(agent.metadata, "selector"),
        metadataString(agent.metadata, "defaultSelector"),
      ].filter(Boolean) as string[],
    });
  }

  for (const selector of selectors) {
    if (selector.definitionId === "system") continue;

    const discovered = await resolveRelayAgentConfig(selector, { currentDirectory });
    if (discovered && !candidateMap.has(discovered.agentId)) {
      candidateMap.set(discovered.agentId, {
        agentId: discovered.agentId,
        definitionId: discovered.definitionId,
        nodeQualifier: discovered.instance.nodeQualifier,
        workspaceQualifier: discovered.instance.workspaceQualifier,
        aliases: [discovered.instance.selector, discovered.instance.defaultSelector],
      });
    }

    const candidates = Array.from(candidateMap.values());
    if (selector.definitionId === "all") {
      const targetAgentIds = endpointBackedAgentIds.length > 0 ? endpointBackedAgentIds : candidates.map((candidate) => candidate.agentId);
      for (const agentId of targetAgentIds) {
        resolved.set(agentId, { agentId, label: selector.label, selector });
      }
      continue;
    }

    const match = resolveAgentSelector(selector, candidates);
    if (!match) {
      unresolved.push(selector.label);
      continue;
    }
    resolved.set(match.agentId, { agentId: match.agentId, label: selector.label, selector });
  }

  return {
    resolved: Array.from(resolved.values()).sort((lhs, rhs) => lhs.agentId.localeCompare(rhs.agentId)),
    unresolved: Array.from(new Set(unresolved)).sort(),
  };
}

async function resolveSingleBrokerTarget(
  snapshot: ScoutBrokerSnapshot,
  label: string,
  currentDirectory: string,
): Promise<ScoutMentionTarget | null> {
  const normalized = label.trim();
  if (!normalized) {
    return null;
  }
  const resolution = await resolveMentionTargets(
    snapshot,
    normalized.startsWith("@") ? normalized : `@${normalized}`,
    currentDirectory,
  );
  return resolution.resolved[0] ?? null;
}

async function describeScoutTargetAvailability(
  snapshot: ScoutBrokerSnapshot,
  target: ScoutMentionTarget,
  currentDirectory: string,
): Promise<ScoutAskTargetDiagnostic> {
  const resolvedConfig = await resolveRelayAgentConfig(target.selector, {
    currentDirectory,
  });
  const registrationKind = resolvedConfig?.registrationKind ?? null;
  const endpoints = Object.values(snapshot.endpoints ?? {}).filter((endpoint) => endpoint.agentId === target.agentId);

  if (endpoints.length > 0) {
    return {
      agentId: target.agentId,
      state: whoEntryState(endpoints, registrationKind ?? "broker"),
      registrationKind,
      projectRoot: resolvedConfig?.projectRoot ?? null,
    };
  }

  if (registrationKind === "discovered") {
    return {
      agentId: target.agentId,
      state: "discovered",
      registrationKind,
      projectRoot: resolvedConfig?.projectRoot ?? null,
    };
  }

  return {
    agentId: target.agentId,
    state: snapshot.agents[target.agentId] || registrationKind === "configured" ? "offline" : "unknown",
    registrationKind,
    projectRoot: resolvedConfig?.projectRoot ?? null,
  };
}

function resolveConversationShareMode(
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  participantIds: string[],
  fallback: "local" | "shared",
): "local" | "shared" {
  if (fallback === "shared") return "shared";
  const hasRemoteParticipant = participantIds.some((participantId) => {
    const participant = snapshot.agents[participantId];
    return Boolean(participant?.authorityNodeId && participant.authorityNodeId !== nodeId);
  });
  return hasRemoteParticipant ? "shared" : fallback;
}

export function stripScoutAgentSelectorLabels(text: string): string {
  return extractAgentSelectors(text).reduce((next, selector) => (
    next.replaceAll(selector.label, "").replace(/\s{2,}/g, " ").trim()
  ), text).trim();
}

async function ensureBrokerActor(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  actorId: string,
  displayName?: string,
): Promise<void> {
  if (snapshot.actors[actorId] || snapshot.agents[actorId]) {
    return;
  }
  const actor: ScoutBrokerActorRecord = {
    id: actorId,
    kind: actorId === OPERATOR_ID ? "person" : "agent",
    displayName: displayName?.trim() || titleCaseName(actorId),
    handle: actorId,
    labels: ["scout"],
    metadata: { source: "scout-cli" },
  };
  await brokerPostJson(baseUrl, scoutBrokerPaths.v1.actors, actor);
  snapshot.actors[actorId] = actor;
}

async function syncBrokerBinding(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  binding: Awaited<ReturnType<typeof inferLocalAgentBinding>>,
  options: { includeEndpoint?: boolean } = {},
): Promise<void> {
  if (!binding) return;
  await brokerPostJson(baseUrl, scoutBrokerPaths.v1.actors, binding.actor);
  await brokerPostJson(baseUrl, scoutBrokerPaths.v1.agents, binding.agent);
  snapshot.actors[binding.actor.id] = binding.actor;
  snapshot.agents[binding.agent.id] = binding.agent;
  if (options.includeEndpoint ?? true) {
    await brokerPostJson(baseUrl, scoutBrokerPaths.v1.endpoints, binding.endpoint);
    snapshot.endpoints[binding.endpoint.id] = binding.endpoint;
  }
}

function scoutBrokerAgentRegistrationFromConfig(
  config: ResolvedRelayAgentConfig,
  nodeId: string,
): { actor: ScoutBrokerActorRecord; agent: ScoutBrokerAgentRecord } {
  const source = config.source === "inferred" ? "project-inferred" : "relay-agent-registry";
  const metadata = {
    source,
    project: config.projectName,
    projectRoot: config.projectRoot,
    tmuxSession: config.runtime.sessionId,
    definitionId: config.definitionId,
    instanceId: config.instance.id,
    selector: config.instance.selector,
    defaultSelector: config.instance.defaultSelector,
    nodeQualifier: config.instance.nodeQualifier,
    workspaceQualifier: config.instance.workspaceQualifier,
    branch: config.instance.branch,
  };

  return {
    actor: {
      id: config.agentId,
      kind: "agent",
      displayName: config.displayName,
      handle: config.definitionId,
      labels: ["relay", "project", "agent", "local-agent"],
      metadata,
    },
    agent: {
      id: config.agentId,
      kind: "agent",
      definitionId: config.definitionId,
      nodeQualifier: config.instance.nodeQualifier,
      workspaceQualifier: config.instance.workspaceQualifier,
      selector: config.instance.selector,
      defaultSelector: config.instance.defaultSelector,
      displayName: config.displayName,
      handle: config.definitionId,
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        ...metadata,
        summary: `${config.displayName} relay agent for ${config.projectName}.`,
        role: "Relay agent",
      },
      agentClass: "general",
      capabilities: config.capabilities,
      wakePolicy: "on_demand",
      homeNodeId: nodeId,
      authorityNodeId: nodeId,
      advertiseScope: "local",
    },
  };
}

async function syncBrokerAgentRegistration(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  registration: { actor: ScoutBrokerActorRecord; agent: ScoutBrokerAgentRecord },
): Promise<void> {
  await brokerPostJson(baseUrl, scoutBrokerPaths.v1.actors, registration.actor);
  await brokerPostJson(baseUrl, scoutBrokerPaths.v1.agents, registration.agent);
  snapshot.actors[registration.actor.id] = registration.actor;
  snapshot.agents[registration.agent.id] = registration.agent;
}

export async function registerScoutLocalAgentBinding(input: {
  agentId: string;
  broker?: ScoutBrokerContext | null;
}): Promise<ScoutLocalAgentBindingSyncResult | null> {
  const broker = input.broker ?? await loadScoutBrokerContext();
  const nodeId = broker?.node.id ?? process.env.OPENSCOUT_NODE_ID ?? "local";
  const binding = await inferLocalAgentBinding(input.agentId, nodeId);
  if (!binding) {
    return null;
  }
  if (broker) {
    await syncBrokerBinding(broker.baseUrl, broker.snapshot, binding);
  }
  return {
    binding,
    brokerRegistered: Boolean(broker),
  };
}

async function resolveConversationActorId(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  actorId: string,
  currentDirectory: string,
  displayName?: string,
): Promise<string> {
  const normalized = actorId.trim() || OPERATOR_ID;
  if (snapshot.agents[normalized] || snapshot.actors[normalized]) {
    return normalized;
  }
  if (normalized === OPERATOR_ID) {
    await ensureBrokerActor(baseUrl, snapshot, normalized, displayName);
    return normalized;
  }

  const configured = await ensureRelayAgentConfigured(normalized, {
    currentDirectory,
    ensureCurrentProjectConfig: true,
  });
  if (!configured) {
    await ensureBrokerActor(baseUrl, snapshot, normalized, displayName);
    return normalized;
  }

  const binding = await inferLocalAgentBinding(configured.agentId, nodeId);
  if (binding) {
    await syncBrokerBinding(baseUrl, snapshot, binding);
    return binding.actor.id;
  }

  return configured.agentId;
}

async function ensureTargetRelayAgentRegistered(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  agentId: string,
  currentDirectory: string,
): Promise<boolean> {
  if (snapshot.agents[agentId]) return true;
  const configured = await ensureRelayAgentConfigured(agentId, {
    currentDirectory,
    syncLegacyMirror: true,
  });
  if (!configured) {
    return false;
  }

  const binding = await inferLocalAgentBinding(configured.agentId, nodeId);
  if (!binding) {
    await syncBrokerAgentRegistration(
      baseUrl,
      snapshot,
      scoutBrokerAgentRegistrationFromConfig(configured, nodeId),
    );
    return true;
  }

  await syncBrokerBinding(baseUrl, snapshot, binding, {
    includeEndpoint: binding.endpoint.state !== "waiting",
  });
  return Boolean(binding);
}

export async function syncScoutBrokerBindings(input: {
  currentDirectory: string;
  operatorId?: string;
  operatorName?: string;
}): Promise<boolean> {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    return false;
  }

  const operatorId = input.operatorId?.trim() || OPERATOR_ID;
  await ensureBrokerActor(
    broker.baseUrl,
    broker.snapshot,
    operatorId,
    input.operatorName,
  );

  const setup = await loadResolvedRelayAgents({
    currentDirectory: input.currentDirectory,
  });

  for (const agent of setup.discoveredAgents) {
    await ensureTargetRelayAgentRegistered(
      broker.baseUrl,
      broker.snapshot,
      broker.node.id,
      agent.agentId,
      input.currentDirectory,
    );
  }

  return true;
}

function conversationDefinition(
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  channel: string | undefined,
  senderId: string,
  targetParticipantIds: string[] = [],
): ScoutBrokerConversationRecord {
  const normalizedChannel = channel?.trim() || "shared";
  const sharedParticipants = [...new Set([OPERATOR_ID, senderId, ...Object.keys(snapshot.agents)])].sort();
  const scopedParticipants = [...new Set([OPERATOR_ID, senderId, ...targetParticipantIds])].sort();

  if (normalizedChannel === "voice") {
    return {
      id: BROKER_VOICE_CHANNEL_ID,
      kind: "channel",
      title: "voice",
      visibility: "workspace",
      shareMode: resolveConversationShareMode(snapshot, nodeId, scopedParticipants, "local"),
      authorityNodeId: nodeId,
      participantIds: scopedParticipants,
      metadata: { surface: "scout-cli", channel: "voice" },
    };
  }
  if (normalizedChannel === "system") {
    return {
      id: BROKER_SYSTEM_CHANNEL_ID,
      kind: "system",
      title: "system",
      visibility: "system",
      shareMode: "local",
      authorityNodeId: nodeId,
      participantIds: [OPERATOR_ID, senderId].sort(),
      metadata: { surface: "scout-cli", channel: "system" },
    };
  }
  if (normalizedChannel === "shared") {
    return {
      id: BROKER_SHARED_CHANNEL_ID,
      kind: "channel",
      title: "shared-channel",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: nodeId,
      participantIds: sharedParticipants,
      metadata: { surface: "scout-cli", channel: "shared" },
    };
  }
  return {
    id: `channel.${sanitizeConversationSegment(normalizedChannel)}`,
    kind: "channel",
    title: normalizedChannel,
    visibility: "workspace",
    shareMode: resolveConversationShareMode(snapshot, nodeId, scopedParticipants, "local"),
    authorityNodeId: nodeId,
    participantIds: scopedParticipants,
    metadata: { surface: "scout-cli", channel: normalizedChannel },
  };
}

async function ensureBrokerConversation(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  channel: string | undefined,
  senderId: string,
  targetParticipantIds: string[] = [],
): Promise<ScoutBrokerConversationRecord> {
  const definition = conversationDefinition(snapshot, nodeId, channel, senderId, targetParticipantIds);
  const existing = snapshot.conversations[definition.id];
  const nextParticipants = [...new Set([...(existing?.participantIds ?? []), ...definition.participantIds])].sort();

  if (
    !existing ||
    existing.kind !== definition.kind ||
    existing.visibility !== definition.visibility ||
    existing.shareMode !== definition.shareMode ||
    nextParticipants.length !== existing.participantIds.length
  ) {
    const nextConversation: ScoutBrokerConversationRecord = {
      ...definition,
      participantIds: nextParticipants,
    };
    await brokerPostJson(baseUrl, scoutBrokerPaths.v1.conversations, nextConversation);
    snapshot.conversations[nextConversation.id] = nextConversation;
    return nextConversation;
  }

  return existing;
}

function directConversationIdForActors(sourceId: string, targetId: string): string {
  if (sourceId === targetId) {
    return `dm.${sourceId}.${targetId}`;
  }
  if (sourceId === OPERATOR_ID || targetId === OPERATOR_ID) {
    const peerId = sourceId === OPERATOR_ID ? targetId : sourceId;
    return `dm.${OPERATOR_ID}.${peerId}`;
  }
  return `dm.${[sourceId, targetId].sort().join(".")}`;
}

async function ensureBrokerDirectConversationBetween(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  sourceId: string,
  targetId: string,
): Promise<ScoutDirectSessionResult> {
  const conversationId = targetId === SCOUT_AGENT_ID && sourceId === OPERATOR_ID
    ? BROKER_SHARED_CHANNEL_ID
    : directConversationIdForActors(sourceId, targetId);
  const participantIds = [...new Set([sourceId, targetId])].sort();
  const nextShareMode = resolveConversationShareMode(
    snapshot,
    nodeId,
    participantIds,
    "local",
  );
  const existing = snapshot.conversations[conversationId];
  const alreadyMatches = existing
    && existing.kind === "direct"
    && existing.shareMode === nextShareMode
    && existing.visibility === "private"
    && existing.participantIds.join("\u0000") === participantIds.join("\u0000");

  if (alreadyMatches) {
    const preferredTargetId = targetId === OPERATOR_ID ? sourceId : targetId;
    return {
      agent: snapshot.agents[preferredTargetId] ?? snapshot.agents[sourceId],
      conversation: existing,
      existed: true,
    };
  }

  const nonOperatorParticipants = participantIds.filter((participantId) => participantId !== OPERATOR_ID);
  const conversationTitle = sourceId === OPERATOR_ID || targetId === OPERATOR_ID
    ? displayNameForBrokerActor(snapshot, nonOperatorParticipants[0] ?? targetId)
    : `${displayNameForBrokerActor(snapshot, sourceId)} <> ${displayNameForBrokerActor(snapshot, targetId)}`;

  const definition: ScoutBrokerConversationRecord = {
    id: conversationId,
    kind: "direct",
    title: targetId === SCOUT_AGENT_ID && sourceId === OPERATOR_ID ? "Scout" : conversationTitle,
    visibility: "private",
    shareMode: nextShareMode,
    authorityNodeId: nodeId,
    participantIds,
    metadata: {
      surface: "scout",
      ...(targetId === SCOUT_AGENT_ID && sourceId === OPERATOR_ID ? { role: "partner" } : {}),
    },
  };

  await brokerPostJson(baseUrl, scoutBrokerPaths.v1.conversations, definition);
  snapshot.conversations[definition.id] = definition;

  return {
    agent: snapshot.agents[targetId] ?? snapshot.agents[sourceId],
    conversation: definition,
    existed: Boolean(existing),
  };
}

export async function sendScoutMessage(input: {
  senderId: string;
  body: string;
  channel?: string;
  shouldSpeak?: boolean;
  createdAtMs?: number;
  executionHarness?: AgentHarness;
  currentDirectory?: string;
}): Promise<ScoutMessagePostResult> {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    return { usedBroker: false, invokedTargets: [], unresolvedTargets: [] };
  }

  const currentDirectory = input.currentDirectory ?? process.cwd();
  const createdAtMs = input.createdAtMs ?? Date.now();
  const mentionResolution = await resolveMentionTargets(broker.snapshot, input.body, currentDirectory);
  const senderId = await resolveConversationActorId(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.senderId,
    currentDirectory,
  );
  const availableTargets = (
    await Promise.all(
      mentionResolution.resolved.map(async (target) => (
        await ensureTargetRelayAgentRegistered(
          broker.baseUrl,
          broker.snapshot,
          broker.node.id,
          target.agentId,
          currentDirectory,
        )
          ? target
          : null
      )),
    )
  ).filter((target): target is ScoutMentionTarget => Boolean(target));

  const conversation = await ensureBrokerConversation(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.channel,
    senderId,
    availableTargets.map((target) => target.agentId),
  );

  const validTargets = [...new Set(
    availableTargets
      .map((target) => target.agentId)
      .filter((target) => target !== senderId && Boolean(broker.snapshot.agents[target])),
  )].sort();
  const unresolvedTargets = mentionResolution.resolved
    .filter((target) => !validTargets.includes(target.agentId))
    .map((target) => target.label)
    .concat(mentionResolution.unresolved);
  const messageId = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const speechText = input.shouldSpeak ? stripScoutAgentSelectorLabels(input.body) : "";
  const returnAddress = buildScoutReturnAddress(broker.snapshot, senderId, {
    conversationId: conversation.id,
    replyToMessageId: messageId,
  });

  await brokerPostJson(broker.baseUrl, scoutBrokerPaths.v1.messages, {
    id: messageId,
    conversationId: conversation.id,
    actorId: senderId,
    originNodeId: broker.node.id,
    class: conversation.kind === "system" ? "system" : "agent",
    body: input.body,
    mentions: mentionResolution.resolved
      .filter((target) => validTargets.includes(target.agentId))
      .map((target) => ({ actorId: target.agentId, label: target.label })),
    speech: speechText ? { text: speechText } : undefined,
    audience: validTargets.length > 0 ? { notify: validTargets, reason: "mention" } : undefined,
    visibility: conversation.visibility,
    policy: "durable",
    createdAt: createdAtMs,
    metadata: {
      source: "scout-cli",
      relayChannel: input.channel ?? "shared",
      relayMessageId: messageId,
      returnAddress,
    },
  });

  for (const targetAgentId of validTargets) {
    await brokerPostJson(broker.baseUrl, scoutBrokerPaths.v1.invocations, {
      id: `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      requesterId: senderId,
      requesterNodeId: broker.node.id,
      targetAgentId,
      action: "consult",
      task: input.body,
      conversationId: conversation.id,
      messageId,
      execution: input.executionHarness ? { harness: input.executionHarness } : undefined,
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: {
        source: "scout-cli",
        relayChannel: input.channel ?? "shared",
        returnAddress,
      },
    });
  }

  return { usedBroker: true, invokedTargets: validTargets, unresolvedTargets };
}

export async function openScoutDirectSession(input: {
  agentId: string;
  currentDirectory?: string;
  operatorName?: string;
}): Promise<ScoutDirectSessionResult> {
  const session = await openScoutPeerSession({
    sourceId: OPERATOR_ID,
    targetId: input.agentId,
    currentDirectory: input.currentDirectory,
    sourceName: input.operatorName,
  });
  return {
    agent: session.agent,
    conversation: session.conversation,
    existed: session.existed,
  };
}

export async function openScoutPeerSession(input: {
  sourceId: string;
  targetId: string;
  currentDirectory?: string;
  sourceName?: string;
  targetName?: string;
}): Promise<ScoutPeerSessionResult> {
  const broker = await requireScoutBrokerContext();
  const currentDirectory = input.currentDirectory ?? process.cwd();
  const sourceId = await resolveConversationActorId(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.sourceId,
    currentDirectory,
    input.sourceName,
  );
  const targetId = await resolveConversationActorId(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.targetId,
    currentDirectory,
    input.targetName,
  );

  if (broker.snapshot.agents[targetId]) {
    const targetReady = await ensureTargetRelayAgentRegistered(
      broker.baseUrl,
      broker.snapshot,
      broker.node.id,
      targetId,
      currentDirectory,
    );
    if (!targetReady) {
      throw new Error(`Agent ${input.targetId} is not available.`);
    }
  }

  const session = await ensureBrokerDirectConversationBetween(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    sourceId,
    targetId,
  );

  return {
    ...session,
    sourceId,
    targetId,
  };
}

export async function sendScoutDirectMessage(input: {
  agentId: string;
  body: string;
  currentDirectory?: string;
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
  referenceMessageIds?: string[];
  executionHarness?: AgentHarness;
  source?: string;
  deviceId?: string;
}): Promise<ScoutDirectMessageResult> {
  const currentDirectory = input.currentDirectory ?? process.cwd();
  const directSession = await openScoutPeerSession({
    sourceId: OPERATOR_ID,
    targetId: input.agentId,
    currentDirectory,
  });
  const broker = await requireScoutBrokerContext();
  const createdAt = Date.now();
  const messageId = `msg-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const source = input.source?.trim() || "scout-mobile";
  const targetAgentId = directSession.targetId;
  const targetAgent = broker.snapshot.agents[targetAgentId]
    ?? ("agent" in directSession ? directSession.agent : undefined);
  const targetLabel = `@${targetAgent?.handle?.trim() || targetAgent?.displayName?.trim() || targetAgentId}`;
  const returnAddress = buildScoutReturnAddress(broker.snapshot, OPERATOR_ID, {
    conversationId: directSession.conversation.id,
    replyToMessageId: messageId,
  });

  await brokerPostJson(broker.baseUrl, scoutBrokerPaths.v1.messages, {
    id: messageId,
    conversationId: directSession.conversation.id,
    replyToMessageId: input.replyToMessageId ?? undefined,
    actorId: OPERATOR_ID,
    originNodeId: broker.node.id,
    class: "agent",
    body: input.body.trim(),
    mentions: [{ actorId: targetAgentId, label: targetLabel }],
    audience: {
      notify: [targetAgentId],
      reason: "direct_message",
    },
    visibility: "private",
    policy: "durable",
    createdAt,
    metadata: {
      source,
      destinationKind: "direct",
      destinationId: targetAgentId,
      referenceMessageIds: input.referenceMessageIds ?? [],
      clientMessageId: input.clientMessageId ?? null,
      returnAddress,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    },
  });

  const invocationResponse = await brokerPostJson<{ ok: boolean; flight: ScoutFlightRecord }>(
    broker.baseUrl,
    scoutBrokerPaths.v1.invocations,
    {
      id: `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      requesterId: OPERATOR_ID,
      requesterNodeId: broker.node.id,
      targetAgentId,
      action: "consult",
      task: input.body.trim(),
      conversationId: directSession.conversation.id,
      messageId,
      execution: input.executionHarness ? { harness: input.executionHarness } : undefined,
      ensureAwake: true,
      stream: false,
      createdAt,
      metadata: {
        source,
        destinationKind: "direct",
        destinationId: targetAgentId,
        returnAddress,
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      },
    },
  );

  return {
    conversationId: directSession.conversation.id,
    messageId,
    flight: invocationResponse.flight,
  };
}

export async function askScoutQuestion(input: {
  senderId: string;
  targetLabel: string;
  body: string;
  channel?: string;
  shouldSpeak?: boolean;
  createdAtMs?: number;
  executionHarness?: AgentHarness;
  currentDirectory?: string;
}): Promise<ScoutAskResult> {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    return { usedBroker: false, unresolvedTarget: input.targetLabel };
  }
  const currentDirectory = input.currentDirectory ?? process.cwd();
  const senderId = await resolveConversationActorId(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.senderId,
    currentDirectory,
  );

  const target = await resolveSingleBrokerTarget(broker.snapshot, input.targetLabel, currentDirectory);
  if (!target) {
    return { usedBroker: true, unresolvedTarget: input.targetLabel };
  }
  const targetReady = await ensureTargetRelayAgentRegistered(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    target.agentId,
    currentDirectory,
  );
  if (!targetReady) {
    return {
      usedBroker: true,
      unresolvedTarget: input.targetLabel,
      targetDiagnostic: await describeScoutTargetAvailability(broker.snapshot, target, currentDirectory),
    };
  }

  const conversation = await ensureBrokerConversation(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.channel,
    senderId,
    [target.agentId],
  );
  const messageId = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const messageBody = input.body.trim().startsWith(target.label) ? input.body.trim() : `${target.label} ${input.body.trim()}`;
  const speechText = input.shouldSpeak ? stripScoutAgentSelectorLabels(messageBody) : "";
  const returnAddress = buildScoutReturnAddress(broker.snapshot, senderId, {
    conversationId: conversation.id,
    replyToMessageId: messageId,
  });

  await brokerPostJson(broker.baseUrl, scoutBrokerPaths.v1.messages, {
    id: messageId,
    conversationId: conversation.id,
    actorId: senderId,
    originNodeId: broker.node.id,
    class: conversation.kind === "system" ? "system" : "agent",
    body: messageBody,
    mentions: [{ actorId: target.agentId, label: target.label }],
    speech: speechText ? { text: speechText } : undefined,
    audience: { notify: [target.agentId], reason: "mention" },
    visibility: conversation.visibility,
    policy: "durable",
    createdAt: input.createdAtMs ?? Date.now(),
    metadata: {
      source: "scout-cli",
      relayChannel: input.channel ?? "shared",
      relayTarget: target.agentId,
      returnAddress,
    },
  });

  const invocationResponse = await brokerPostJson<{ ok: boolean; flight: ScoutFlightRecord }>(broker.baseUrl, scoutBrokerPaths.v1.invocations, {
    id: `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    requesterId: senderId,
    requesterNodeId: broker.node.id,
    targetAgentId: target.agentId,
    action: "consult",
    task: messageBody,
    conversationId: conversation.id,
    messageId,
    execution: input.executionHarness ? { harness: input.executionHarness } : undefined,
    ensureAwake: true,
    stream: false,
    createdAt: Date.now(),
    metadata: {
      source: "scout-cli",
      relayChannel: input.channel ?? "shared",
      relayTarget: target.agentId,
      returnAddress,
    },
  });

  return {
    usedBroker: true,
    flight: invocationResponse.flight,
    conversationId: conversation.id,
    messageId,
  };
}

async function loadBrokerFlight(baseUrl: string, flightId: string): Promise<ScoutFlightRecord | null> {
  const snapshot = await brokerReadJson<{ flights?: Record<string, ScoutFlightRecord> }>(baseUrl, scoutBrokerPaths.v1.snapshot);
  return snapshot.flights?.[flightId] ?? null;
}

export async function waitForScoutFlight(
  baseUrl: string,
  flightId: string,
  options: {
    timeoutSeconds?: number;
    onUpdate?: (flight: ScoutFlightRecord, detail: string) => void;
  } = {},
): Promise<ScoutFlightRecord> {
  const deadline = typeof options.timeoutSeconds === "number" && options.timeoutSeconds > 0
    ? Date.now() + options.timeoutSeconds * 1000
    : null;
  let lastState = "";
  let lastSummary = "";

  while (true) {
    const flight = await loadBrokerFlight(baseUrl, flightId);
    if (!flight) {
      throw new Error(`Flight ${flightId} is no longer available.`);
    }

    if (flight.state !== lastState || (flight.summary ?? "") !== lastSummary) {
      const detail = [flight.state, flight.summary].filter(Boolean).join(" - ");
      if (detail) {
        options.onUpdate?.(flight, detail);
      }
      lastState = flight.state;
      lastSummary = flight.summary ?? "";
    }

    if (flight.state === "completed") return flight;
    if (flight.state === "failed" || flight.state === "cancelled") {
      throw new Error(flight.error || flight.summary || `Flight ${flight.id} failed.`);
    }
    if (deadline !== null && Date.now() > deadline) {
      throw new Error(`Timed out waiting for flight ${flight.id}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function loadScoutMessages(options: {
  channel?: string;
  since?: number;
  limit?: number;
  baseUrl?: string;
} = {}): Promise<ScoutBrokerMessageRecord[]> {
  const search = new URLSearchParams();
  search.set("conversationId", scoutConversationIdForChannel(options.channel));
  if (typeof options.since === "number" && Number.isFinite(options.since) && options.since > 0) {
    search.set("since", String(options.since));
  }
  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
    search.set("limit", String(options.limit));
  }
  return brokerReadJson<ScoutBrokerMessageRecord[]>(
    options.baseUrl ?? resolveScoutBrokerUrl(),
    scoutBrokerMessagesListPath(search),
  );
}

export type ScoutActivityItem = {
  id: string;
  kind: string;
  ts: number;
  conversationId?: string;
  messageId?: string;
  invocationId?: string;
  flightId?: string;
  recordId?: string;
  actorId?: string;
  counterpartId?: string;
  agentId?: string;
  workspaceRoot?: string;
  sessionId?: string;
  title?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

export async function loadScoutActivityItems(options: {
  agentId?: string;
  actorId?: string;
  conversationId?: string;
  limit?: number;
  baseUrl?: string;
} = {}): Promise<ScoutActivityItem[]> {
  const search = new URLSearchParams();
  if (options.agentId) search.set("agentId", options.agentId);
  if (options.actorId) search.set("actorId", options.actorId);
  if (options.conversationId) search.set("conversationId", options.conversationId);
  if (typeof options.limit === "number" && options.limit > 0) search.set("limit", String(options.limit));
  const q = search.toString();
  const path = q ? `${scoutBrokerPaths.v1.activity}?${q}` : scoutBrokerPaths.v1.activity;
  return brokerReadJson<ScoutActivityItem[]>(options.baseUrl ?? resolveScoutBrokerUrl(), path);
}

export async function watchScoutMessages(options: ScoutWatchOptions): Promise<void> {
  const broker = await requireScoutBrokerContext();
  const conversationId = scoutConversationIdForChannel(options.channel);
  const controller = new AbortController();
  const abort = () => controller.abort();

  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", abort, { once: true });
  }

  try {
    const response = await fetch(new URL(scoutBrokerPaths.v1.eventsStream, broker.baseUrl), {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`${scoutBrokerPaths.v1.eventsStream} returned ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleBlock = (block: string) => {
      const trimmed = block.trim();
      if (!trimmed) return;
      let eventName = "";
      const dataLines: string[] = [];
      for (const line of trimmed.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
      }
      if (eventName !== "message.posted" || dataLines.length === 0) return;
      let event: ControlEvent;
      try {
        event = JSON.parse(dataLines.join("\n")) as ControlEvent;
      } catch {
        return;
      }
      const message = (event as Extract<ControlEvent, { kind: "message.posted" }>).payload?.message as ScoutBrokerMessageRecord | undefined;
      if (!message || message.conversationId !== conversationId || message.actorId === options.agentId) return;
      options.onMessage(message);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const delimiterIndex = buffer.indexOf("\n\n");
        if (delimiterIndex === -1) break;
        const block = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);
        handleBlock(block);
      }
    }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    if (!isAbort) throw error;
  } finally {
    if (options.signal) {
      options.signal.removeEventListener("abort", abort);
    }
  }
}

function whoStateRank(state: AgentState | "discovered"): number {
  switch (state) {
    case "active": return 5;
    case "waiting": return 4;
    case "idle": return 2;
    case "offline": return 1;
    case "discovered":
    default:
      return 0;
  }
}

function whoEndpointActivity(endpoint: ScoutBrokerEndpointRecord): number | null {
  return maxDefined([
    normalizeUnixTimestamp(endpoint.metadata?.lastCompletedAt),
    normalizeUnixTimestamp(endpoint.metadata?.lastStartedAt),
    normalizeUnixTimestamp(endpoint.metadata?.lastFailedAt),
    normalizeUnixTimestamp(endpoint.metadata?.startedAt),
  ]);
}

function whoEntryState(endpoints: ScoutBrokerEndpointRecord[], registrationKind: ScoutWhoRegistrationKind): AgentState | "discovered" {
  if (endpoints.length === 0) return registrationKind === "discovered" ? "discovered" : "offline";
  return endpoints.reduce<AgentState>((bestState, endpoint) => {
    const nextState = endpoint.state ?? "offline";
    return whoStateRank(nextState) > whoStateRank(bestState) ? nextState : bestState;
  }, "offline");
}

async function loadDiscoveredAgentMap(currentDirectory: string): Promise<Map<string, ResolvedRelayAgentConfig>> {
  try {
    const setup = await loadResolvedRelayAgents({ currentDirectory });
    return new Map(setup.discoveredAgents.map((agent) => [agent.agentId, agent]));
  } catch {
    return new Map();
  }
}

export async function listScoutAgents(options: { currentDirectory?: string } = {}): Promise<ScoutWhoEntry[]> {
  const broker = await requireScoutBrokerContext();
  const discoveredAgents = await loadDiscoveredAgentMap(options.currentDirectory ?? process.cwd());
  const endpointsByAgent = new Map<string, ScoutBrokerEndpointRecord[]>();
  const messageStats = new Map<string, { messages: number; lastSeen: number | null }>();

  for (const endpoint of Object.values(broker.snapshot.endpoints ?? {})) {
    if (!endpoint.agentId || endpoint.agentId === OPERATOR_ID) continue;
    if (isSupersededBrokerAgent(broker.snapshot, endpoint.agentId)) continue;
    const existing = endpointsByAgent.get(endpoint.agentId) ?? [];
    existing.push(endpoint);
    endpointsByAgent.set(endpoint.agentId, existing);
  }
  for (const message of Object.values(broker.snapshot.messages ?? {})) {
    if (!message.actorId || message.actorId === OPERATOR_ID) continue;
    if (isSupersededBrokerAgent(broker.snapshot, message.actorId)) continue;
    const current = messageStats.get(message.actorId) ?? { messages: 0, lastSeen: null };
    current.messages += 1;
    current.lastSeen = maxDefined([current.lastSeen, normalizeUnixTimestamp(message.createdAt)]);
    messageStats.set(message.actorId, current);
  }

  return [...new Set([
    ...Object.keys(broker.snapshot.agents ?? {}),
    ...Array.from(endpointsByAgent.keys()),
    ...Array.from(messageStats.keys()),
    ...Array.from(discoveredAgents.keys()),
  ])]
    .filter((agentId) => agentId && agentId !== OPERATOR_ID)
    .filter((agentId) => !isSupersededBrokerAgent(broker.snapshot, agentId))
    .map((agentId): ScoutWhoEntry => {
      const endpoints = endpointsByAgent.get(agentId) ?? [];
      const brokerMessages = messageStats.get(agentId);
      const registrationKind = discoveredAgents.get(agentId)?.registrationKind ?? "broker";
      const state = whoEntryState(endpoints, registrationKind);
      const lastSeen = maxDefined([
        brokerMessages?.lastSeen,
        ...endpoints.map((endpoint) => whoEndpointActivity(endpoint)),
      ]);
      const messages = brokerMessages?.messages ?? 0;
      return { agentId, state, messages, lastSeen, registrationKind };
    })
    .sort((lhs, rhs) => {
      const stateDelta = whoStateRank(rhs.state) - whoStateRank(lhs.state);
      if (stateDelta !== 0) return stateDelta;
      const lastSeenDelta = (rhs.lastSeen ?? -1) - (lhs.lastSeen ?? -1);
      if (lastSeenDelta !== 0) return lastSeenDelta;
      return lhs.agentId.localeCompare(rhs.agentId);
    });
}

export async function loadScoutRelayConfig(): Promise<RelayConfig> {
  try {
    const raw = await readFile(join(relayHubDirectory(), "config.json"), "utf8");
    return JSON.parse(raw) as RelayConfig;
  } catch {
    return {};
  }
}

export function getScoutVoiceForChannel(config: RelayConfig, channel?: string): string {
  const entry = channel ? config.channels?.[channel] : undefined;
  return entry?.voice || config.defaultVoice || "nova";
}

function applyPronunciations(text: string, pronunciations?: Record<string, string>): string {
  if (!pronunciations) return text;
  let result = text;
  for (const [word, phonetic] of Object.entries(pronunciations)) {
    result = result.replace(new RegExp(`\\b${word}\\b`, "gi"), phonetic);
  }
  return result;
}

export async function acquireScoutOnAir(agent: string, timeoutMs = 30_000): Promise<void> {
  const hub = relayHubDirectory();
  await mkdir(hub, { recursive: true });
  const lockPath = join(hub, "on-air.lock");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(lockPath, "utf8");
      const lock = JSON.parse(raw) as { ts?: number };
      if (Date.now() - Number(lock.ts ?? 0) > 30_000) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } catch {
      break;
    }
  }
  await writeFile(lockPath, JSON.stringify({ agent, ts: Date.now() }) + "\n");
}

export async function releaseScoutOnAir(): Promise<void> {
  try {
    await unlink(join(relayHubDirectory(), "on-air.lock"));
  } catch {
    // Ignore missing locks.
  }
}

export async function speakScoutText(text: string, voice: string): Promise<void> {
  const config = await loadScoutRelayConfig();
  const apiKey = process.env.OPENAI_API_KEY || config.openaiApiKey || null;
  const clean = applyPronunciations(text.trim(), config.pronunciations);
  if (!apiKey || !clean) return;

  const { spawn } = await import("node:child_process");
  const response = await fetch(openAiAudioSpeechUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice,
      input: clean,
      response_format: "pcm",
      speed: 1.1,
    }),
  });
  if (!response.ok || !response.body) return;

  const player = spawn("ffplay", [
    "-nodisp", "-autoexit", "-loglevel", "quiet",
    "-f", "s16le", "-ar", "24000", "-ch_layout", "mono", "-",
  ], { stdio: ["pipe", "ignore", "ignore"] });

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    player.stdin.write(value);
  }
  player.stdin.end();
  await new Promise<void>((resolve) => player.on("close", () => resolve()));
}

export function buildScoutEnrollmentPrompt(input: {
  agentId: string;
  task?: string;
  cliCommand?: string;
}): string {
  const relayLogPath = join(relayHubDirectory(), "channel.log");
  const cliCommand = input.cliCommand?.trim() || "scout";
  const task = input.task?.trim();
  return [
    `You are ${input.agentId}.`,
    "",
    `There is a global Scout activity channel at ${relayLogPath} that other agents are watching.`,
    "Use it to coordinate with other agents working on related packages.",
    "",
    "Scout commands:",
    `  ${cliCommand} send --as ${input.agentId} "your message"`,
    `  ${cliCommand} watch`,
    `  ${cliCommand} who`,
    "",
    "Rules:",
    "  - Check recent messages before starting work",
    "  - Send a message when you complete something other agents need to know about",
    "  - Be specific: include file paths, version numbers, and what changed",
    "  - Keep messages under 200 chars",
    task ? "" : undefined,
    task ? `Your task: ${task}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function defaultScoutAgentNameForPath(projectPath: string): string {
  return basename(projectPath);
}
