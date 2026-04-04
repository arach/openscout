import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  extractAgentSelectors,
  normalizeAgentSelectorSegment,
  resolveAgentSelector,
  type AgentHarness,
  type AgentSelector,
  type AgentSelectorCandidate,
  type AgentState,
  type ControlEvent,
  type MessageRecord,
} from "@openscout/protocol";

import {
  ensureRelayAgentConfigured,
  loadResolvedRelayAgents,
  resolveRelayAgentConfig,
  type ResolvedRelayAgentConfig,
} from "./setup.js";
import {
  ensureLocalAgentBindingOnline,
  inferLocalAgentBinding,
  SUPPORTED_LOCAL_AGENT_HARNESSES,
} from "./local-agents.js";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";
import { resolveBrokerServiceConfig } from "./broker-service.js";

export type ScoutBrokerActorRecord = {
  id: string;
  kind?: string;
  displayName?: string;
  handle?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
};

export type ScoutBrokerAgentRecord = ScoutBrokerActorRecord & {
  homeNodeId?: string;
  authorityNodeId?: string;
};

export type ScoutBrokerEndpointRecord = {
  id: string;
  agentId: string;
  nodeId?: string;
  harness?: string;
  transport?: string;
  state?: AgentState;
  address?: string;
  sessionId?: string;
  cwd?: string;
  projectRoot?: string;
  metadata?: Record<string, unknown>;
};

export type ScoutBrokerConversationRecord = {
  id: string;
  kind: string;
  title: string;
  visibility: string;
  shareMode?: string;
  authorityNodeId: string;
  participantIds: string[];
  metadata?: Record<string, unknown>;
};

export type ScoutBrokerMessageRecord = MessageRecord;

export type ScoutBrokerSnapshot = {
  actors: Record<string, ScoutBrokerActorRecord>;
  agents: Record<string, ScoutBrokerAgentRecord>;
  endpoints: Record<string, ScoutBrokerEndpointRecord>;
  conversations: Record<string, ScoutBrokerConversationRecord>;
  messages: Record<string, ScoutBrokerMessageRecord>;
};

export type ScoutBrokerNodeRecord = {
  id: string;
  brokerUrl?: string;
};

export type ScoutBrokerContext = {
  baseUrl: string;
  node: ScoutBrokerNodeRecord;
  snapshot: ScoutBrokerSnapshot;
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

function relayHubDirectory(): string {
  return resolveOpenScoutSupportPaths().relayHubDirectory;
}

export function resolveScoutBrokerUrl(): string {
  return resolveBrokerServiceConfig().brokerUrl;
}

export function resolveScoutAgentName(agentName?: string | null): string {
  const trimmed = agentName?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (process.env.OPENSCOUT_AGENT?.trim()) {
    return process.env.OPENSCOUT_AGENT.trim();
  }
  return OPERATOR_ID;
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

export function formatScoutTimestamp(timestamp: number): string {
  const value = new Date(timestamp * 1000);
  const hh = String(value.getHours()).padStart(2, "0");
  const mm = String(value.getMinutes()).padStart(2, "0");
  const ss = String(value.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatScoutMessageLine(message: ScoutBrokerMessageRecord): string {
  const timestamp = normalizeUnixTimestamp(message.createdAt) ?? Math.floor(Date.now() / 1000);
  const body = message.body;
  const type = message.class === "system" || message.class === "status" ? "SYS" : "MSG";
  if (type === "SYS") {
    return `${formatScoutTimestamp(timestamp)} · ${body}`;
  }
  return `${formatScoutTimestamp(timestamp)} ${message.actorId}  ${body}`;
}

function generateMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function titleCaseName(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function sanitizeConversationSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "shared";
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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

export async function loadScoutBrokerContext(baseUrl = resolveScoutBrokerUrl()): Promise<ScoutBrokerContext | null> {
  try {
    const health = await brokerReadJson<{ ok?: boolean }>(baseUrl, "/health");
    if (!health.ok) {
      return null;
    }

    const [node, snapshot] = await Promise.all([
      brokerReadJson<ScoutBrokerNodeRecord>(baseUrl, "/v1/node"),
      brokerReadJson<ScoutBrokerSnapshot>(baseUrl, "/v1/snapshot"),
    ]);

    if (!node.id) {
      return null;
    }

    return {
      baseUrl,
      node,
      snapshot,
    };
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
  if (normalizedChannel === "voice") {
    return BROKER_VOICE_CHANNEL_ID;
  }
  if (normalizedChannel === "system") {
    return BROKER_SYSTEM_CHANNEL_ID;
  }
  if (normalizedChannel === "shared") {
    return BROKER_SHARED_CHANNEL_ID;
  }
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
  const endpointBackedAgentIds = unique(
    Object.values(snapshot.endpoints)
      .map((endpoint) => endpoint.agentId)
      .filter((agentId) => agentId && agentId !== OPERATOR_ID),
  );

  for (const agent of Object.values(snapshot.agents)) {
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
    if (selector.definitionId === "system") {
      continue;
    }

    const discovered = await resolveRelayAgentConfig(selector, {
      currentDirectory,
    });
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
      const targetAgentIds = endpointBackedAgentIds.length > 0
        ? endpointBackedAgentIds
        : candidates.map((candidate) => candidate.agentId);
      for (const agentId of targetAgentIds) {
        resolved.set(agentId, {
          agentId,
          label: selector.label,
          selector,
        });
      }
      continue;
    }

    const match = resolveAgentSelector(selector, candidates);
    if (!match) {
      unresolved.push(selector.label);
      continue;
    }

    resolved.set(match.agentId, {
      agentId: match.agentId,
      label: selector.label,
      selector,
    });
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

function resolveConversationShareMode(
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  participantIds: string[],
  fallback: "local" | "shared",
): "local" | "shared" {
  if (fallback === "shared") {
    return "shared";
  }

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
): Promise<void> {
  if (snapshot.actors[actorId] || snapshot.agents[actorId]) {
    return;
  }

  const actor: ScoutBrokerActorRecord = {
    id: actorId,
    kind: actorId === OPERATOR_ID ? "person" : "agent",
    displayName: titleCaseName(actorId),
    handle: actorId,
    labels: ["scout"],
    metadata: { source: "scout-cli" },
  };

  await brokerPostJson(baseUrl, "/v1/actors", actor);
  snapshot.actors[actorId] = actor;
}

async function syncBrokerBinding(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  binding: Awaited<ReturnType<typeof inferLocalAgentBinding>>,
): Promise<void> {
  if (!binding) {
    return;
  }

  await brokerPostJson(baseUrl, "/v1/actors", binding.actor);
  await brokerPostJson(baseUrl, "/v1/agents", binding.agent);
  await brokerPostJson(baseUrl, "/v1/endpoints", binding.endpoint);
  snapshot.actors[binding.actor.id] = binding.actor;
  snapshot.agents[binding.agent.id] = binding.agent;
  snapshot.endpoints[binding.endpoint.id] = binding.endpoint;
}

async function ensureSenderRelayAgent(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  senderId: string,
  currentDirectory: string,
): Promise<void> {
  if (snapshot.agents[senderId]) {
    return;
  }

  const configured = await ensureRelayAgentConfigured(senderId, {
    currentDirectory,
    ensureCurrentProjectConfig: true,
  });
  if (!configured) {
    return;
  }

  await syncBrokerBinding(baseUrl, snapshot, await inferLocalAgentBinding(configured.agentId, nodeId));
}

async function ensureTargetRelayAgent(
  baseUrl: string,
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  agentId: string,
  currentDirectory: string,
): Promise<boolean> {
  if (snapshot.agents[agentId]) {
    return true;
  }

  const binding = await ensureLocalAgentBindingOnline(agentId, nodeId, {
    includeDiscovered: true,
    currentDirectory,
  });
  await syncBrokerBinding(baseUrl, snapshot, binding);
  return Boolean(binding);
}

function conversationDefinition(
  snapshot: ScoutBrokerSnapshot,
  nodeId: string,
  channel: string | undefined,
  senderId: string,
  targetParticipantIds: string[] = [],
): ScoutBrokerConversationRecord {
  const normalizedChannel = channel?.trim() || "shared";
  const sharedParticipants = unique([
    OPERATOR_ID,
    senderId,
    ...Object.keys(snapshot.agents),
  ]).sort();
  const scopedParticipants = unique([
    OPERATOR_ID,
    senderId,
    ...targetParticipantIds,
  ]).sort();

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
      participantIds: unique([OPERATOR_ID, senderId]).sort(),
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
  const nextParticipants = unique([
    ...(existing?.participantIds ?? []),
    ...definition.participantIds,
  ]).sort();

  if (
    !existing
    || existing.kind !== definition.kind
    || existing.visibility !== definition.visibility
    || existing.shareMode !== definition.shareMode
    || nextParticipants.length !== existing.participantIds.length
  ) {
    const nextConversation: ScoutBrokerConversationRecord = {
      ...definition,
      participantIds: nextParticipants,
    };
    await brokerPostJson(baseUrl, "/v1/conversations", nextConversation);
    snapshot.conversations[nextConversation.id] = nextConversation;
    return nextConversation;
  }

  return existing;
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
    return {
      usedBroker: false,
      invokedTargets: [],
      unresolvedTargets: [],
    };
  }

  const currentDirectory = input.currentDirectory ?? process.cwd();
  const createdAtMs = input.createdAtMs ?? Date.now();
  const mentionResolution = await resolveMentionTargets(broker.snapshot, input.body, currentDirectory);

  await ensureSenderRelayAgent(broker.baseUrl, broker.snapshot, broker.node.id, input.senderId, currentDirectory);
  await ensureBrokerActor(broker.baseUrl, broker.snapshot, input.senderId);
  const availableTargets = (
    await Promise.all(
      mentionResolution.resolved.map(async (target) => (
        await ensureTargetRelayAgent(broker.baseUrl, broker.snapshot, broker.node.id, target.agentId, currentDirectory)
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
    input.senderId,
    availableTargets.map((target) => target.agentId),
  );

  const validTargets = unique(
    availableTargets
      .map((target) => target.agentId)
      .filter((target) => target !== input.senderId && Boolean(broker.snapshot.agents[target])),
  ).sort();
  const unresolvedTargets = mentionResolution.resolved
    .filter((target) => !validTargets.includes(target.agentId))
    .map((target) => target.label)
    .concat(mentionResolution.unresolved);
  const messageId = generateMessageId();
  const speechText = input.shouldSpeak
    ? stripScoutAgentSelectorLabels(input.body)
    : "";

  await brokerPostJson(broker.baseUrl, "/v1/messages", {
    id: messageId,
    conversationId: conversation.id,
    actorId: input.senderId,
    originNodeId: broker.node.id,
    class: conversation.kind === "system" ? "system" : "agent",
    body: input.body,
    mentions: mentionResolution.resolved
      .filter((target) => validTargets.includes(target.agentId))
      .map((target) => ({ actorId: target.agentId, label: target.label })),
    speech: speechText ? { text: speechText } : undefined,
    audience: validTargets.length > 0
      ? {
          notify: validTargets,
          reason: "mention",
        }
      : undefined,
    visibility: conversation.visibility,
    policy: "durable",
    createdAt: createdAtMs,
    metadata: {
      source: "scout-cli",
      relayChannel: input.channel ?? "shared",
      relayMessageId: messageId,
    },
  });

  for (const targetAgentId of validTargets) {
    await brokerPostJson(broker.baseUrl, "/v1/invocations", {
      id: `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      requesterId: input.senderId,
      requesterNodeId: broker.node.id,
      targetAgentId,
      action: "consult",
      task: input.body,
      conversationId: conversation.id,
      messageId,
      execution: input.executionHarness
        ? {
            harness: input.executionHarness,
          }
        : undefined,
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: {
        source: "scout-cli",
        relayChannel: input.channel ?? "shared",
      },
    });
  }

  return {
    usedBroker: true,
    invokedTargets: validTargets,
    unresolvedTargets,
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
    return {
      usedBroker: false,
      unresolvedTarget: input.targetLabel,
    };
  }

  const currentDirectory = input.currentDirectory ?? process.cwd();
  await ensureBrokerActor(broker.baseUrl, broker.snapshot, input.senderId);
  if (input.senderId !== OPERATOR_ID) {
    await ensureSenderRelayAgent(broker.baseUrl, broker.snapshot, broker.node.id, input.senderId, currentDirectory);
  }

  const target = await resolveSingleBrokerTarget(broker.snapshot, input.targetLabel, currentDirectory);
  if (!target) {
    return {
      usedBroker: true,
      unresolvedTarget: input.targetLabel,
    };
  }

  const targetReady = await ensureTargetRelayAgent(
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
    };
  }

  const conversation = await ensureBrokerConversation(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.channel,
    input.senderId,
    [target.agentId],
  );
  const messageId = generateMessageId();
  const messageBody = input.body.trim().startsWith(target.label)
    ? input.body.trim()
    : `${target.label} ${input.body.trim()}`;
  const speechText = input.shouldSpeak ? stripScoutAgentSelectorLabels(messageBody) : "";

  await brokerPostJson(broker.baseUrl, "/v1/messages", {
    id: messageId,
    conversationId: conversation.id,
    actorId: input.senderId,
    originNodeId: broker.node.id,
    class: conversation.kind === "system" ? "system" : "agent",
    body: messageBody,
    mentions: [{ actorId: target.agentId, label: target.label }],
    speech: speechText ? { text: speechText } : undefined,
    audience: {
      notify: [target.agentId],
      reason: "mention",
    },
    visibility: conversation.visibility,
    policy: "durable",
    createdAt: input.createdAtMs ?? Date.now(),
    metadata: {
      source: "scout-cli",
      relayChannel: input.channel ?? "shared",
      relayTarget: target.agentId,
    },
  });

  const invocationId = `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const invocationResponse = await brokerPostJson<{
    ok: boolean;
    flight: ScoutFlightRecord;
  }>(broker.baseUrl, "/v1/invocations", {
    id: invocationId,
    requesterId: input.senderId,
    requesterNodeId: broker.node.id,
    targetAgentId: target.agentId,
    action: "consult",
    task: messageBody,
    conversationId: conversation.id,
    messageId,
    execution: input.executionHarness
      ? {
          harness: input.executionHarness,
        }
      : undefined,
    ensureAwake: true,
    stream: false,
    createdAt: Date.now(),
    metadata: {
      source: "scout-cli",
      relayChannel: input.channel ?? "shared",
      relayTarget: target.agentId,
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
  const snapshot = await brokerReadJson<{
    flights?: Record<string, ScoutFlightRecord>;
  }>(baseUrl, "/v1/snapshot");
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

    if (flight.state === "completed") {
      return flight;
    }

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
  const conversationId = scoutConversationIdForChannel(options.channel);
  if (conversationId) {
    search.set("conversationId", conversationId);
  }
  if (typeof options.since === "number" && Number.isFinite(options.since) && options.since > 0) {
    search.set("since", String(options.since));
  }
  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
    search.set("limit", String(options.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return brokerReadJson<ScoutBrokerMessageRecord[]>(options.baseUrl ?? resolveScoutBrokerUrl(), `/v1/messages${suffix}`);
}

export async function watchScoutMessages(options: ScoutWatchOptions): Promise<void> {
  const broker = await requireScoutBrokerContext();
  const conversationId = scoutConversationIdForChannel(options.channel);
  const controller = new AbortController();
  const abort = () => controller.abort();

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", abort, { once: true });
    }
  }

  try {
    const response = await fetch(new URL("/v1/events/stream", broker.baseUrl), {
      headers: {
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`/v1/events/stream returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleBlock = (block: string) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return;
      }

      let eventName = "";
      const dataLines: string[] = [];
      for (const line of trimmed.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }

      if (eventName !== "message.posted" || dataLines.length === 0) {
        return;
      }

      let event: ControlEvent;
      try {
        event = JSON.parse(dataLines.join("\n")) as ControlEvent;
      } catch {
        return;
      }

      const message = (event as Extract<ControlEvent, { kind: "message.posted" }>).payload?.message as ScoutBrokerMessageRecord | undefined;
      if (!message || message.conversationId !== conversationId || message.actorId === options.agentId) {
        return;
      }

      options.onMessage(message);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const delimiterIndex = buffer.indexOf("\n\n");
        if (delimiterIndex === -1) {
          break;
        }
        const block = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);
        handleBlock(block);
      }
    }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    if (!isAbort) {
      throw error;
    }
  } finally {
    if (options.signal) {
      options.signal.removeEventListener("abort", abort);
    }
  }
}

function whoStateRank(state: AgentState | "discovered"): number {
  switch (state) {
    case "active":
      return 5;
    case "waiting":
      return 4;
    case "degraded":
      return 3;
    case "idle":
      return 2;
    case "offline":
      return 1;
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

function whoEntryState(
  endpoints: ScoutBrokerEndpointRecord[],
  registrationKind: ScoutWhoRegistrationKind,
): AgentState | "discovered" {
  if (endpoints.length === 0) {
    return registrationKind === "discovered" ? "discovered" : "offline";
  }

  return endpoints.reduce<AgentState>((bestState, endpoint) => {
    const nextState = endpoint.state ?? "offline";
    return whoStateRank(nextState) > whoStateRank(bestState) ? nextState : bestState;
  }, "offline");
}

async function loadDiscoveredAgentMap(currentDirectory: string): Promise<Map<string, ResolvedRelayAgentConfig>> {
  try {
    const setup = await loadResolvedRelayAgents({
      currentDirectory,
    });
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
    if (!endpoint.agentId || endpoint.agentId === OPERATOR_ID) {
      continue;
    }
    const existing = endpointsByAgent.get(endpoint.agentId) ?? [];
    existing.push(endpoint);
    endpointsByAgent.set(endpoint.agentId, existing);
  }

  for (const message of Object.values(broker.snapshot.messages ?? {})) {
    if (!message.actorId || message.actorId === OPERATOR_ID) {
      continue;
    }
    const current = messageStats.get(message.actorId) ?? { messages: 0, lastSeen: null };
    current.messages += 1;
    current.lastSeen = maxDefined([
      current.lastSeen,
      normalizeUnixTimestamp(message.createdAt),
    ]);
    messageStats.set(message.actorId, current);
  }

  return unique([
    ...Object.keys(broker.snapshot.agents ?? {}),
    ...Array.from(endpointsByAgent.keys()),
    ...Array.from(messageStats.keys()),
    ...Array.from(discoveredAgents.keys()),
  ])
    .filter((agentId) => agentId && agentId !== OPERATOR_ID)
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

      return {
        agentId,
        state,
        messages,
        lastSeen,
        registrationKind,
      };
    })
    .sort((lhs, rhs) => {
      const stateDelta = whoStateRank(rhs.state) - whoStateRank(lhs.state);
      if (stateDelta !== 0) {
        return stateDelta;
      }

      const lastSeenDelta = (rhs.lastSeen ?? -1) - (lhs.lastSeen ?? -1);
      if (lastSeenDelta !== 0) {
        return lastSeenDelta;
      }

      return lhs.agentId.localeCompare(rhs.agentId);
    });
}

export async function loadScoutRelayConfig(): Promise<RelayConfig> {
  const hub = relayHubDirectory();
  try {
    const raw = await readFile(join(hub, "config.json"), "utf8");
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
  if (!pronunciations) {
    return text;
  }
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
      if (Date.now() - Number(lock.ts ?? 0) > 30_000) {
        break;
      }
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
  if (!apiKey || !clean) {
    return;
  }

  const { spawn } = await import("node:child_process");

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
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
  if (!response.ok || !response.body) {
    return;
  }

  const player = spawn("ffplay", [
    "-nodisp",
    "-autoexit",
    "-loglevel",
    "quiet",
    "-f",
    "s16le",
    "-ar",
    "24000",
    "-ch_layout",
    "mono",
    "-",
  ], { stdio: ["pipe", "ignore", "ignore"] });

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
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
    `  ${cliCommand} read`,
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
