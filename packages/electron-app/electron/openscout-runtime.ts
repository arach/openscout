import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  brokerServiceStatus,
  restartBrokerService,
  startBrokerService,
  stopBrokerService,
} from "../../runtime/src/broker-service.js";
import type { RuntimeRegistrySnapshot } from "../../runtime/src/registry.js";
import { relayVoiceBridgeService } from "./voice-bridge-service.js";

import type {
  BrokerControlAction,
  DesktopAppInfo,
  DesktopRuntimeState,
  DesktopShellState,
  RelayDirectThread,
  RelayMessage,
  RelayNavItem,
  RelayState,
  SendRelayMessageInput,
  SessionMetadata,
} from "../src/lib/openscout-desktop.js";

const OPERATOR_ID = "operator";
const SHARED_CHANNEL_ID = "channel.shared";
const VOICE_CHANNEL_ID = "channel.voice";
const SYSTEM_CHANNEL_ID = "channel.system";

type TmuxSession = {
  name: string;
  createdAt: number | null;
};

type BrokerNode = {
  id: string;
};

type ActorRecord = {
  id: string;
  displayName?: string;
  handle?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  kind?: string;
};

type AgentRecord = ActorRecord & {
  agentClass?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
};

type EndpointRecord = {
  id: string;
  agentId: string;
  state?: string;
  transport?: string;
  harness?: string;
  cwd?: string;
  projectRoot?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

type ConversationRecord = {
  id: string;
  kind: string;
  title: string;
  visibility?: string;
  participantIds: string[];
  metadata?: Record<string, unknown>;
};

type MessageRecord = {
  id: string;
  conversationId: string;
  actorId: string;
  originNodeId: string;
  class: string;
  body: string;
  replyToMessageId?: string;
  createdAt: number;
  speech?: {
    text?: string;
    voice?: string;
    interruptible?: boolean;
  };
  audience?: {
    visibleTo?: string[];
    notify?: string[];
    invoke?: string[];
    reason?: string;
  };
  mentions?: Array<{ actorId: string; label?: string }>;
  metadata?: Record<string, unknown>;
};

type FlightRecord = {
  id: string;
  targetAgentId: string;
  state: string;
  summary?: string;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
};

type DirectAgentActivity = {
  state: RelayDirectThread["state"];
  reachable: boolean;
  statusLabel: string;
  statusDetail: string | null;
  activeTask: string | null;
};

function normalizeTimestamp(value: number | null | undefined): number {
  if (!value) return 0;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function isoFromTimestamp(value: number): string {
  return new Date(normalizeTimestamp(value) * 1000).toISOString();
}

function formatTimeLabel(value: number): string {
  const date = new Date(normalizeTimestamp(value) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDayLabel(value: number): string {
  const date = new Date(normalizeTimestamp(value) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(date)
    .toUpperCase();
}

function formatRelativeTime(value: number): string {
  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - normalizeTimestamp(value));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function isReachableEndpointState(state: string | undefined): boolean {
  return state === "active" || state === "idle" || state === "waiting" || state === "degraded";
}

function isWorkingFlightState(state: string | undefined): boolean {
  return state === "queued" || state === "waking" || state === "running" || state === "waiting";
}

function directConversationId(agentId: string): string {
  return `dm.${OPERATOR_ID}.${agentId}`;
}

function flightMetadataString(flight: FlightRecord | null | undefined, key: string): string | null {
  const value = flight?.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function colorForIdentity(identity: string) {
  const palette = ["#3b82f6", "#14b8a6", "#fb923c", "#f43f5e", "#8b5cf6", "#10b981"];
  let seed = 0;
  for (const character of identity) {
    seed += character.charCodeAt(0);
  }
  return palette[seed % palette.length];
}

function readHelperStatus() {
  const statusPath = path.join(homedir(), "Library", "Application Support", "OpenScout", "agent-status.json");
  if (!existsSync(statusPath)) {
    return {
      running: false,
      detail: null,
      heartbeatLabel: null,
    };
  }

  try {
    const raw = JSON.parse(readFileSync(statusPath, "utf8")) as {
      state?: string;
      detail?: string;
      heartbeat?: number;
    };
    const running = raw.state === "running";
    const heartbeatLabel = raw.heartbeat ? formatTimeLabel(raw.heartbeat) : null;
    return {
      running,
      detail: raw.detail ?? null,
      heartbeatLabel,
    };
  } catch {
    return {
      running: false,
      detail: "Helper status unreadable.",
      heartbeatLabel: null,
    };
  }
}

function readTmuxSessions(): TmuxSession[] {
  try {
    const stdout = execFileSync("tmux", ["ls", "-F", "#{session_name}\t#{session_created}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, createdAtRaw] = line.split("\t");
        return {
          name,
          createdAt: createdAtRaw ? Number.parseInt(createdAtRaw, 10) : null,
        };
      });
  } catch {
    return [];
  }
}

async function brokerGet<T>(baseUrl: string, pathname: string): Promise<T | null> {
  try {
    const response = await fetch(new URL(pathname, baseUrl), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function brokerPost<T>(baseUrl: string, pathname: string, body: unknown): Promise<T | null> {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `${pathname} returned ${response.status}`);
  }

  return (await response.json()) as T;
}

async function readSnapshot(baseUrl: string): Promise<RuntimeRegistrySnapshot | null> {
  return brokerGet<RuntimeRegistrySnapshot>(baseUrl, "/v1/snapshot");
}

async function readNode(baseUrl: string): Promise<BrokerNode | null> {
  return brokerGet<BrokerNode>(baseUrl, "/v1/node");
}

function actorDisplayName(snapshot: RuntimeRegistrySnapshot, actorId: string): string {
  const agent = snapshot.agents[actorId] as AgentRecord | undefined;
  if (agent?.displayName) return agent.displayName;
  const actor = snapshot.actors[actorId] as ActorRecord | undefined;
  if (actor?.displayName) return actor.displayName;
  return actorId;
}

function actorRole(snapshot: RuntimeRegistrySnapshot, actorId: string): string | null {
  const agent = snapshot.agents[actorId] as AgentRecord | undefined;
  const role = agent?.metadata?.role;
  return typeof role === "string" ? role : null;
}

function activeEndpoint(snapshot: RuntimeRegistrySnapshot, actorId: string): EndpointRecord | null {
  const candidates = Object.values(snapshot.endpoints as Record<string, EndpointRecord>).filter(
    (endpoint) => endpoint.agentId === actorId,
  );
  const rank = (state: string | undefined) => {
    switch (state) {
      case "active":
        return 0;
      case "idle":
        return 1;
      case "waiting":
        return 2;
      case "degraded":
        return 3;
      case "offline":
        return 5;
      default:
        return 4;
    }
  };

  return [...candidates].sort((lhs, rhs) => rank(lhs.state) - rank(rhs.state))[0] ?? null;
}

function inferRecipients(message: MessageRecord, conversation: ConversationRecord | undefined): string[] {
  const fromAudience = [
    ...(message.audience?.notify ?? []),
    ...(message.audience?.invoke ?? []),
    ...(message.mentions?.map((mention) => mention.actorId) ?? []),
  ];

  if (fromAudience.length > 0) {
    return Array.from(new Set(fromAudience)).filter((recipient) => recipient !== message.actorId);
  }

  if (!conversation) {
    return [];
  }

  return conversation.participantIds.filter((participant) => participant !== message.actorId);
}

function normalizedChannel(conversation: ConversationRecord | undefined): string | null {
  if (!conversation) return null;
  if (conversation.id.startsWith("channel.")) {
    return conversation.id.replace(/^channel\./, "");
  }
  return null;
}

function sanitizeRelayBody(body: string): string {
  return body
    .replace(/\[ask:[^\]]+\]\s*/g, "")
    .replace(/\[speak\]\s*/gi, "")
    .replace(/^(@[\w.-]+\s+)+/g, "")
    .trim();
}

function spokenTextForMessage(message: MessageRecord): string | null {
  const explicitSpeech = message.speech?.text?.trim();
  if (explicitSpeech) {
    return explicitSpeech;
  }

  const taggedSpeech = message.body.match(/^\[speak\]\s*([\s\S]+)$/i)?.[1]?.trim();
  return taggedSpeech || null;
}

function buildMessagesByConversation(snapshot: RuntimeRegistrySnapshot): Map<string, MessageRecord[]> {
  const messagesByConversation = new Map<string, MessageRecord[]>();

  for (const message of Object.values(snapshot.messages as Record<string, MessageRecord>)) {
    if (message.metadata?.transportOnly === "true") {
      continue;
    }

    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  for (const bucket of messagesByConversation.values()) {
    bucket.sort((lhs, rhs) => normalizeTimestamp(lhs.createdAt) - normalizeTimestamp(rhs.createdAt));
  }

  return messagesByConversation;
}

function buildDirectAgentActivity(
  snapshot: RuntimeRegistrySnapshot,
  tmuxSessions: TmuxSession[],
  messagesByConversation: Map<string, MessageRecord[]>,
): Map<string, DirectAgentActivity> {
  const tmuxSet = new Set(tmuxSessions.map((session) => session.name));
  const flights = Object.values(snapshot.flights as Record<string, FlightRecord>);
  const activity = new Map<string, DirectAgentActivity>();

  for (const agent of Object.values(snapshot.agents as Record<string, AgentRecord>)) {
    const endpoint = activeEndpoint(snapshot, agent.id);
    const reachable = Boolean(endpoint && isReachableEndpointState(endpoint.state)) || tmuxSet.has(`relay-${agent.id}`);
    const latestMessage = (messagesByConversation.get(directConversationId(agent.id)) ?? []).at(-1) ?? null;
    const activeFlight =
      flights
        .filter((flight) => flight.targetAgentId === agent.id && isWorkingFlightState(flight.state))
        .sort(
          (lhs, rhs) =>
            normalizeTimestamp(rhs.startedAt ?? rhs.completedAt ?? 0) -
            normalizeTimestamp(lhs.startedAt ?? lhs.completedAt ?? 0),
        )[0] ?? null;

    const activeTask =
      sanitizeRelayBody(
        activeFlight?.summary?.trim()
        || flightMetadataString(activeFlight, "task")
        || "Working on your latest message.",
      ) || null;

    if (activeFlight) {
      activity.set(agent.id, {
        state: "working",
        reachable: true,
        statusLabel: "Working",
        statusDetail: activeTask,
        activeTask,
      });
      continue;
    }

    if (reachable) {
      activity.set(agent.id, {
        state: "available",
        reachable,
        statusLabel: "Available",
        statusDetail: latestMessage ? `Last activity ${formatRelativeTime(latestMessage.createdAt)}` : "Ready for a direct message.",
        activeTask: null,
      });
      continue;
    }

    activity.set(agent.id, {
      state: "offline",
      reachable: false,
      statusLabel: "Offline",
      statusDetail: latestMessage ? `Last activity ${formatRelativeTime(latestMessage.createdAt)}` : "No active endpoint detected.",
      activeTask: null,
    });
  }

  return activity;
}

function buildRelayMessages(snapshot: RuntimeRegistrySnapshot): RelayMessage[] {
  const conversations = snapshot.conversations as Record<string, ConversationRecord>;
  const messages = Object.values(snapshot.messages as Record<string, MessageRecord>)
    .filter((message) => message.metadata?.transportOnly !== "true")
    .sort((lhs, rhs) => normalizeTimestamp(lhs.createdAt) - normalizeTimestamp(rhs.createdAt));

  return messages.map((message) => {
    const conversation = conversations[message.conversationId];
    const channel = normalizedChannel(conversation);
    const recipients = inferRecipients(message, conversation);
    const endpoint = activeEndpoint(snapshot, message.actorId);
    const provenanceParts = [
      endpoint?.transport,
      endpoint?.harness,
      endpoint?.cwd ? path.basename(endpoint.cwd) : null,
    ].filter(Boolean) as string[];

    return {
      id: message.id,
      conversationId: message.conversationId,
      createdAt: message.createdAt,
      replyToMessageId: message.replyToMessageId ?? null,
      authorId: message.actorId,
      authorName: actorDisplayName(snapshot, message.actorId),
      authorRole: actorRole(snapshot, message.actorId),
      body: sanitizeRelayBody(message.body),
      timestampLabel: formatTimeLabel(message.createdAt),
      dayLabel: formatDayLabel(message.createdAt),
      normalizedChannel: channel,
      recipients,
      isDirectConversation: conversation?.kind === "direct" || conversation?.id.startsWith("dm.") === true,
      isSystem: message.class === "system" || channel === "system" || conversation?.kind === "system",
      isVoice: channel === "voice" || Boolean(spokenTextForMessage(message)),
      messageClass: message.class,
      routingSummary: recipients.length > 0 ? `Targets ${recipients.map((id) => actorDisplayName(snapshot, id)).join(", ")}` : null,
      provenanceSummary: provenanceParts.length > 0 ? `via ${provenanceParts.join(" · ")}` : null,
      provenanceDetail: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
      isOperator: message.actorId === OPERATOR_ID,
      avatarLabel: actorDisplayName(snapshot, message.actorId).slice(0, 1).toUpperCase(),
      avatarColor: colorForIdentity(message.actorId),
      receipt: null,
    };
  });
}

function buildRelayDirects(
  snapshot: RuntimeRegistrySnapshot,
  activityByAgent: Map<string, DirectAgentActivity>,
  messagesByConversation: Map<string, MessageRecord[]>,
): RelayDirectThread[] {
  return Object.values(snapshot.agents as Record<string, AgentRecord>)
    .filter((agent) => !["scout", "builder", "reviewer", "research"].includes(agent.id))
    .sort((lhs, rhs) => actorDisplayName(snapshot, lhs.id).localeCompare(actorDisplayName(snapshot, rhs.id)))
    .map((agent) => {
      const directMessages = messagesByConversation.get(directConversationId(agent.id)) ?? [];
      const latestMessage = directMessages.at(-1) ?? null;
      const previewMessage =
        [...directMessages].reverse().find((message) => message.class !== "status" && message.class !== "system")
        ?? latestMessage;
      const subtitle =
        typeof agent.metadata?.role === "string"
          ? String(agent.metadata.role)
          : typeof agent.metadata?.summary === "string"
            ? String(agent.metadata.summary)
            : "Project twin";
      const activity = activityByAgent.get(agent.id) ?? {
        state: "offline" as const,
        reachable: false,
        statusLabel: "Offline",
        statusDetail: "No active endpoint detected.",
        activeTask: null,
      };

      return {
        kind: "direct" as const,
        id: agent.id,
        title: actorDisplayName(snapshot, agent.id),
        subtitle,
        preview: previewMessage ? sanitizeRelayBody(previewMessage.body) : null,
        timestampLabel: latestMessage ? formatTimeLabel(latestMessage.createdAt) : null,
        state: activity.state,
        reachable: activity.reachable,
        statusLabel: activity.statusLabel,
        statusDetail: activity.statusDetail,
        activeTask: activity.activeTask,
      };
    });
}

function attachRelayReceipts(
  snapshot: RuntimeRegistrySnapshot,
  messages: RelayMessage[],
  activityByAgent: Map<string, DirectAgentActivity>,
): RelayMessage[] {
  const latestStatusByReplyTo = new Map<string, { createdAt: number; body: string; targetAgentId: string | null }>();
  const latestReplyByReplyTo = new Map<string, { createdAt: number; authorId: string }>();
  const latestOperatorDirectMessageByAgent = new Map<string, string>();

  for (const message of messages) {
    if (!message.isOperator || !message.isDirectConversation) {
      continue;
    }

    const targetAgentId = message.recipients.find((recipient) => recipient !== OPERATOR_ID);
    if (targetAgentId) {
      latestOperatorDirectMessageByAgent.set(targetAgentId, message.id);
    }
  }

  for (const message of Object.values(snapshot.messages as Record<string, MessageRecord>)) {
    if (message.metadata?.transportOnly === "true" || !message.replyToMessageId) {
      continue;
    }

    if (message.class === "status") {
      const current = latestStatusByReplyTo.get(message.replyToMessageId);
      if (!current || normalizeTimestamp(current.createdAt) < normalizeTimestamp(message.createdAt)) {
        latestStatusByReplyTo.set(message.replyToMessageId, {
          createdAt: message.createdAt,
          body: sanitizeRelayBody(message.body),
          targetAgentId: typeof message.metadata?.targetAgentId === "string" ? message.metadata.targetAgentId : null,
        });
      }
      continue;
    }

    if (message.actorId === OPERATOR_ID) {
      continue;
    }

    const current = latestReplyByReplyTo.get(message.replyToMessageId);
    if (!current || normalizeTimestamp(current.createdAt) < normalizeTimestamp(message.createdAt)) {
      latestReplyByReplyTo.set(message.replyToMessageId, {
        createdAt: message.createdAt,
        authorId: message.actorId,
      });
    }
  }

  return messages.map((message) => {
    if (!message.isOperator || !message.isDirectConversation) {
      return message;
    }

    const targetAgentId = message.recipients.find((recipient) => recipient !== OPERATOR_ID);
    if (!targetAgentId) {
      return message;
    }

    const reply = latestReplyByReplyTo.get(message.id);
    if (reply && reply.authorId === targetAgentId) {
      return {
        ...message,
        receipt: {
          state: "replied",
          label: "Replied",
          detail: formatRelativeTime(reply.createdAt),
        },
      };
    }

    const status = latestStatusByReplyTo.get(message.id);
    if (status && (!status.targetAgentId || status.targetAgentId === targetAgentId)) {
      return {
        ...message,
        receipt: {
          state: "seen",
          label: "Seen",
          detail: status.body,
        },
      };
    }

    const activity = activityByAgent.get(targetAgentId);
    const isLatestForAgent = latestOperatorDirectMessageByAgent.get(targetAgentId) === message.id;
    if (activity?.state === "working" && isLatestForAgent) {
      return {
        ...message,
        receipt: {
          state: "seen",
          label: "Seen",
          detail: activity.activeTask ?? "Working now.",
        },
      };
    }

    if (activity?.reachable) {
      return {
        ...message,
        receipt: {
          state: "delivered",
          label: "Delivered",
          detail: "Agent available.",
        },
      };
    }

    return {
      ...message,
      receipt: {
        state: "sent",
        label: "Sent",
        detail: "Agent offline.",
      },
    };
  });
}

function countMessages(messages: RelayMessage[], predicate: (message: RelayMessage) => boolean) {
  return messages.filter(predicate).length;
}

function buildRelayState(snapshot: RuntimeRegistrySnapshot, tmuxSessions: TmuxSession[]): RelayState {
  const messagesByConversation = buildMessagesByConversation(snapshot);
  const directActivity = buildDirectAgentActivity(snapshot, tmuxSessions, messagesByConversation);
  const messages = attachRelayReceipts(snapshot, buildRelayMessages(snapshot), directActivity);
  const directs = buildRelayDirects(snapshot, directActivity, messagesByConversation);
  const voiceState = relayVoiceBridgeService.getRelayVoiceState();

  const channels: RelayNavItem[] = [
    {
      kind: "channel",
      id: "shared",
      title: "# shared-channel",
      subtitle: "Broadcast updates and shared context.",
      count: countMessages(
        messages,
        (message) =>
          !message.isDirectConversation &&
          !message.isSystem &&
          !message.isVoice &&
          message.messageClass !== "status" &&
          (!message.normalizedChannel || message.normalizedChannel === "shared"),
      ),
    },
    {
      kind: "channel",
      id: "voice",
      title: "# voice",
      subtitle: "Voice-related chat, transcripts, and spoken updates.",
      count: countMessages(messages, (message) => message.isVoice),
    },
    {
      kind: "channel",
      id: "system",
      title: "# system",
      subtitle: "State, lifecycle, and infrastructure events.",
      count: countMessages(messages, (message) => message.isSystem || message.messageClass === "status"),
    },
  ];

  const views: RelayNavItem[] = [
    {
      kind: "filter",
      id: "overview",
      title: "Overview",
      subtitle: "Cross-agent activity and workspace traffic.",
      count: countMessages(messages, (message) => !message.isVoice),
    },
    {
      kind: "filter",
      id: "mentions",
      title: "Mentions",
      subtitle: "Focused view over shared-channel targeted messages.",
      count: countMessages(
        messages,
        (message) =>
          !message.isDirectConversation &&
          !message.isSystem &&
          !message.isVoice &&
          message.messageClass !== "status" &&
          message.recipients.length > 0,
      ),
    },
  ];

  return {
    title: "Relay",
    subtitle: `${messages.length} messages · ${directs.length} agents`,
    transportTitle: "Broker-backed",
    meshTitle: "Local mesh",
    syncLine: "Live sync",
    operatorId: OPERATOR_ID,
    channels,
    views,
    directs,
    messages,
    voice: voiceState,
    lastUpdatedLabel: messages.at(-1) ? formatRelativeTime(normalizeTimestamp((snapshot.messages as Record<string, MessageRecord>)[messages.at(-1)?.id ?? ""]?.createdAt ?? 0)) : null,
  };
}

function buildSessions(snapshot: RuntimeRegistrySnapshot): SessionMetadata[] {
  const conversations = Object.values(snapshot.conversations as Record<string, ConversationRecord>);
  const messagesByConversation = new Map<string, MessageRecord[]>();

  for (const message of Object.values(snapshot.messages as Record<string, MessageRecord>)) {
    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  return conversations
    .map((conversation) => {
      const messages = (messagesByConversation.get(conversation.id) ?? [])
        .sort((lhs, rhs) => normalizeTimestamp(lhs.createdAt) - normalizeTimestamp(rhs.createdAt));
      const latestMessage = messages.at(-1);
      const firstMessage = messages[0];
      const nonOperator = conversation.participantIds.find((participant) => participant !== OPERATOR_ID) ?? OPERATOR_ID;
      const title =
        conversation.kind === "direct"
          ? `Direct · ${actorDisplayName(snapshot, nonOperator)}`
          : conversation.title;
      const project =
        conversation.kind === "direct"
          ? nonOperator
          : normalizedChannel(conversation) ?? "relay";

      return {
        id: conversation.id,
        project,
        agent: actorDisplayName(snapshot, nonOperator),
        title,
        messageCount: messages.length,
        createdAt: isoFromTimestamp(firstMessage?.createdAt ?? Math.floor(Date.now() / 1000)),
        lastModified: isoFromTimestamp(latestMessage?.createdAt ?? Math.floor(Date.now() / 1000)),
        preview: latestMessage?.body ?? conversation.title,
        tags: [conversation.kind, ...(normalizedChannel(conversation) ? [normalizedChannel(conversation) as string] : [])],
        model: typeof (snapshot.agents as Record<string, AgentRecord>)[nonOperator]?.metadata?.source === "string"
          ? String((snapshot.agents as Record<string, AgentRecord>)[nonOperator]?.metadata?.source)
          : undefined,
        tokens: undefined,
      };
    })
    .sort((lhs, rhs) => Date.parse(rhs.lastModified) - Date.parse(lhs.lastModified));
}

function buildRuntimeState(
  snapshot: RuntimeRegistrySnapshot | null,
  tmuxSessions: TmuxSession[],
  latestRelayLabel: string | null,
  helper: ReturnType<typeof readHelperStatus>,
  status: Awaited<ReturnType<typeof brokerServiceStatus>>,
): DesktopRuntimeState {
  return {
    helperRunning: helper.running,
    helperDetail: helper.detail,
    brokerInstalled: status.installed,
    brokerLoaded: status.loaded,
    brokerReachable: status.reachable,
    brokerHealthy: status.health.ok,
    brokerLabel: status.label,
    brokerUrl: status.brokerUrl,
    nodeId: status.health.nodeId ?? null,
    agentCount: snapshot ? Object.keys(snapshot.agents).length : status.health.counts?.agents ?? 0,
    conversationCount: snapshot ? Object.keys(snapshot.conversations).length : status.health.counts?.conversations ?? 0,
    messageCount: snapshot ? Object.keys(snapshot.messages).length : status.health.counts?.messages ?? 0,
    flightCount: snapshot ? Object.keys(snapshot.flights).length : status.health.counts?.flights ?? 0,
    tmuxSessionCount: tmuxSessions.length,
    latestRelayLabel,
    lastHeartbeatLabel: helper.heartbeatLabel,
    updatedAtLabel: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date()),
  };
}

function latestRelayLabelFromSnapshot(snapshot: RuntimeRegistrySnapshot | null): string | null {
  if (!snapshot) return null;
  const latestMessage = Object.values(snapshot.messages as Record<string, MessageRecord>)
    .sort((lhs, rhs) => normalizeTimestamp(rhs.createdAt) - normalizeTimestamp(lhs.createdAt))[0];
  if (!latestMessage) return null;
  return `${actorDisplayName(snapshot, latestMessage.actorId)} · ${formatTimeLabel(latestMessage.createdAt)}`;
}

async function ensureCoreConversation(
  baseUrl: string,
  snapshot: RuntimeRegistrySnapshot,
  nodeId: string,
  conversationId: string,
): Promise<void> {
  if (snapshot.conversations[conversationId]) {
    return;
  }

  const participantIds = Array.from(
    new Set([OPERATOR_ID, ...Object.keys(snapshot.agents)]),
  ).sort();

  const definition =
    conversationId === SHARED_CHANNEL_ID
      ? {
          id: SHARED_CHANNEL_ID,
          kind: "channel",
          title: "shared-channel",
          visibility: "workspace",
          shareMode: "shared",
          authorityNodeId: nodeId,
          participantIds,
          metadata: { surface: "electron" },
        }
      : conversationId === VOICE_CHANNEL_ID
        ? {
            id: VOICE_CHANNEL_ID,
            kind: "channel",
            title: "voice",
            visibility: "workspace",
            shareMode: "local",
            authorityNodeId: nodeId,
            participantIds,
            metadata: { surface: "electron" },
          }
        : {
            id: SYSTEM_CHANNEL_ID,
            kind: "system",
            title: "system",
            visibility: "system",
            shareMode: "local",
            authorityNodeId: nodeId,
            participantIds: [OPERATOR_ID],
            metadata: { surface: "electron" },
          };

  await brokerPost(baseUrl, "/v1/conversations", definition);
}

async function ensureDirectConversation(
  baseUrl: string,
  snapshot: RuntimeRegistrySnapshot,
  nodeId: string,
  agentId: string,
): Promise<string> {
  const conversationId = `dm.${OPERATOR_ID}.${agentId}`;
  if (snapshot.conversations[conversationId]) {
    return conversationId;
  }

  await brokerPost(baseUrl, "/v1/conversations", {
    id: conversationId,
    kind: "direct",
    title: actorDisplayName(snapshot, agentId),
    visibility: "private",
    shareMode: "local",
    authorityNodeId: nodeId,
    participantIds: [OPERATOR_ID, agentId].sort(),
    metadata: { surface: "electron" },
  });

  return conversationId;
}

async function ensureOperatorActor(baseUrl: string): Promise<void> {
  await brokerPost(baseUrl, "/v1/actors", {
    id: OPERATOR_ID,
    kind: "person",
    displayName: "Operator",
    handle: OPERATOR_ID,
    labels: ["operator", "desktop"],
    metadata: { source: "electron-app" },
  });
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function parseMentionTargets(body: string, snapshot: RuntimeRegistrySnapshot): string[] {
  const matches = Array.from(body.matchAll(/(^|\s)@([a-z0-9._-]+)/gi)).map((match) => (match[2] ?? "").toLowerCase());
  if (!matches.length) {
    return [];
  }

  const validAgents = new Set(Object.keys(snapshot.agents));
  const endpointBackedAgents = unique(
    Object.values(snapshot.endpoints as Record<string, EndpointRecord>).map((endpoint) => endpoint.agentId),
  );

  const targets = new Set<string>();
  for (const match of matches) {
    if (match === "all") {
      for (const agentId of endpointBackedAgents) {
        targets.add(agentId);
      }
      continue;
    }

    if (validAgents.has(match)) {
      targets.add(match);
    }
  }

  return Array.from(targets).sort();
}

async function postMessageAndInvocations(
  appInfo: DesktopAppInfo,
  input: SendRelayMessageInput,
): Promise<DesktopShellState> {
  const status = await brokerServiceStatus();
  if (!status.reachable) {
    throw new Error("Broker is not reachable.");
  }

  const [snapshot, node] = await Promise.all([readSnapshot(status.brokerUrl), readNode(status.brokerUrl)]);
  if (!snapshot || !node?.id) {
    throw new Error("Broker snapshot is unavailable.");
  }

  await ensureOperatorActor(status.brokerUrl);
  await ensureCoreConversation(status.brokerUrl, snapshot, node.id, SHARED_CHANNEL_ID);
  await ensureCoreConversation(status.brokerUrl, snapshot, node.id, VOICE_CHANNEL_ID);
  await ensureCoreConversation(status.brokerUrl, snapshot, node.id, SYSTEM_CHANNEL_ID);

  const directTarget = input.destinationKind === "direct" ? input.destinationId : null;
  const mentionTargets = parseMentionTargets(input.body, snapshot);
  const invokeTargets = unique([...(directTarget ? [directTarget] : []), ...mentionTargets]);

  let conversationId = SHARED_CHANNEL_ID;
  let visibility = "workspace";
  let messageClass = "agent";

  if (input.destinationKind === "channel" && input.destinationId === "voice") {
    conversationId = VOICE_CHANNEL_ID;
  } else if (input.destinationKind === "channel" && input.destinationId === "system") {
    conversationId = SYSTEM_CHANNEL_ID;
    visibility = "system";
    messageClass = "system";
  } else if (input.destinationKind === "direct" && directTarget) {
    conversationId = await ensureDirectConversation(status.brokerUrl, snapshot, node.id, directTarget);
    visibility = "private";
  }

  const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await brokerPost(status.brokerUrl, "/v1/messages", {
    id: messageId,
    conversationId,
    actorId: OPERATOR_ID,
    originNodeId: node.id,
    class: messageClass,
    body: input.body.trim(),
    mentions: invokeTargets.map((actorId) => ({ actorId, label: `@${actorId}` })),
    audience: invokeTargets.length > 0
      ? {
          notify: invokeTargets,
          invoke: invokeTargets,
          reason: directTarget ? "direct_message" : "mention",
        }
      : undefined,
    visibility,
    policy: "durable",
    createdAt: Date.now(),
    metadata: {
      source: "electron-app",
      destinationKind: input.destinationKind,
      destinationId: input.destinationId,
    },
  });

  for (const targetAgentId of invokeTargets) {
    await brokerPost(status.brokerUrl, "/v1/invocations", {
      id: `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      requesterId: OPERATOR_ID,
      requesterNodeId: node.id,
      targetAgentId,
      action: "consult",
      task: input.body.trim(),
      conversationId,
      messageId,
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: {
        source: "electron-app",
        destinationKind: input.destinationKind,
      },
    });
  }

  return buildDesktopShellState(appInfo);
}

export async function buildDesktopShellState(appInfo: DesktopAppInfo): Promise<DesktopShellState> {
  const [status, helper] = await Promise.all([brokerServiceStatus(), Promise.resolve(readHelperStatus())]);
  const tmuxSessions = readTmuxSessions();
  const snapshot = status.reachable ? await readSnapshot(status.brokerUrl) : null;
  if (snapshot) {
    relayVoiceBridgeService.syncRelayPlayback(snapshot);
  }
  const latestRelayLabel = latestRelayLabelFromSnapshot(snapshot);

  return {
    appInfo,
    runtime: buildRuntimeState(snapshot, tmuxSessions, latestRelayLabel, helper, status),
    sessions: snapshot ? buildSessions(snapshot) : [],
    relay: snapshot
      ? buildRelayState(snapshot, tmuxSessions)
      : {
          title: "Relay",
          subtitle: "Broker unavailable",
          transportTitle: "Broker-backed",
          meshTitle: "Local mesh",
          syncLine: "Disconnected",
          operatorId: OPERATOR_ID,
          channels: [],
          views: [],
        directs: [],
        messages: [],
          voice: relayVoiceBridgeService.getRelayVoiceState(),
          lastUpdatedLabel: null,
        },
  };
}

export async function controlBroker(appInfo: DesktopAppInfo, action: BrokerControlAction): Promise<DesktopShellState> {
  switch (action) {
    case "start":
      await startBrokerService();
      break;
    case "stop":
      await stopBrokerService();
      break;
    case "restart":
      await restartBrokerService();
      break;
  }

  return buildDesktopShellState(appInfo);
}

export async function sendRelayMessage(appInfo: DesktopAppInfo, input: SendRelayMessageInput): Promise<DesktopShellState> {
  return postMessageAndInvocations(appInfo, input);
}

export async function toggleVoiceCapture(appInfo: DesktopAppInfo): Promise<DesktopShellState> {
  await relayVoiceBridgeService.toggleCapture();
  return buildDesktopShellState(appInfo);
}

export async function setVoiceRepliesEnabled(
  appInfo: DesktopAppInfo,
  enabled: boolean,
): Promise<DesktopShellState> {
  await relayVoiceBridgeService.setRepliesEnabled(enabled);
  return buildDesktopShellState(appInfo);
}
