import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ActorIdentity,
  ConversationBinding,
  ConversationDefinition,
  DeliveryAttempt,
  DeliveryIntent,
  MessageRecord,
} from "@openscout/protocol";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createTelegramAdapter,
  type TelegramAdapter,
  type TelegramAdapterMode,
} from "@chat-adapter/telegram";
import { Chat, type Message, type Thread } from "chat";

import { brokerServiceStatus } from "../../runtime/src/broker-service.js";
import { ensureLocalAgentBindingOnline } from "../../runtime/src/local-agents.js";
import type { RuntimeRegistrySnapshot } from "../../runtime/src/registry.js";
import {
  ensureScoutRelayAgentConfigured,
  primaryDirectConversationIdForAgent,
  readOpenScoutSettings,
  SCOUT_AGENT_ID,
  SCOUT_PRIMARY_CONVERSATION_ID,
} from "../../runtime/src/setup.js";
import { resolveOpenScoutSupportPaths } from "../../runtime/src/support-paths.js";

const OPERATOR_ID = "operator";
const SHARED_CHANNEL_ID = "channel.shared";
const VOICE_CHANNEL_ID = "channel.voice";
const SYSTEM_CHANNEL_ID = "channel.system";
const DELIVERY_POLL_MS = 1_000;
const BROKER_POST_RETRY_ATTEMPTS = 4;
const BROKER_POST_RETRY_DELAY_MS = 150;
const TELEGRAM_DELIVERY_MAX_ATTEMPTS = 4;
const TELEGRAM_DELIVERY_RETRY_BASE_MS = 1_500;
const SYSTEM_ACTOR_ID = "system";

type BrokerNode = {
  id: string;
};

type TelegramBridgeLockRecord = {
  pid: number;
  createdAt: number;
};

export type TelegramBridgeRuntimeState = {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  mode: TelegramAdapterMode;
  runtimeMode: "webhook" | "polling" | null;
  detail: string;
  lastError: string | null;
  bindingCount: number;
  pendingDeliveries: number;
};

type InboundTelegramMessage = {
  externalChannelId: string;
  externalThreadId: string;
  externalMessageId: string;
  senderId: string;
  senderDisplayName: string;
  senderUserName: string;
  text: string;
  receivedAt: number;
  isDirectMessage: boolean;
};

type TelegramBridgeConfig = {
  enabled: boolean;
  configured: boolean;
  mode: TelegramAdapterMode;
  botToken: string;
  secretToken: string;
  apiBaseUrl: string;
  userName: string;
  defaultConversationId: string;
  ownerNodeId: string;
};

const OWNER_HEARTBEAT_TTL_MS = 5 * 60 * 1000;

function compactTelegramId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "telegram";
}

function messageBodyFromTelegram(message: InboundTelegramMessage): string {
  const text = message.text.trim();
  return text || "[telegram sent an attachment]";
}

function stableTelegramActorId(message: InboundTelegramMessage): string {
  return `tg.user.${compactTelegramId(message.senderId)}`;
}

function stableTelegramBindingId(threadId: string): string {
  return `binding.telegram.${compactTelegramId(threadId)}`;
}

function stableTelegramMessageId(message: InboundTelegramMessage): string {
  return `msg.telegram.${compactTelegramId(message.externalThreadId)}.${compactTelegramId(message.externalMessageId)}`;
}

function stableTelegramInvocationId(message: InboundTelegramMessage, targetAgentId: string): string {
  return `inv.telegram.${compactTelegramId(message.externalThreadId)}.${compactTelegramId(message.externalMessageId)}.${compactTelegramId(targetAgentId)}`;
}

function telegramAllowedActorIds(binding: ConversationBinding): string[] {
  return Array.isArray(binding.metadata?.allowedActorIds)
    ? binding.metadata.allowedActorIds.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
}

function desiredTelegramBindingMetadata(conversationId: string): Record<string, unknown> {
  if (conversationId === SCOUT_PRIMARY_CONVERSATION_ID) {
    return {
      outboundMode: "allowlist",
      operatorId: OPERATOR_ID,
      allowedActorIds: [OPERATOR_ID, SCOUT_AGENT_ID, SYSTEM_ACTOR_ID],
    };
  }

  return {
    outboundMode: "operator_only",
    operatorId: OPERATOR_ID,
  };
}

function shouldDeliverTelegramMessage(
  binding: ConversationBinding,
  message: MessageRecord,
): boolean {
  const source = typeof message.metadata?.source === "string"
    ? String(message.metadata.source)
    : "";
  if (source === "telegram") {
    return false;
  }

  const outboundMode = typeof binding.metadata?.outboundMode === "string"
    ? String(binding.metadata.outboundMode)
    : "operator_only";
  const operatorId = typeof binding.metadata?.operatorId === "string"
    ? String(binding.metadata.operatorId)
    : OPERATOR_ID;
  const allowedActorIds = telegramAllowedActorIds(binding);

  if (outboundMode === "all") {
    return true;
  }

  if (outboundMode === "allowlist") {
    return allowedActorIds.includes(message.actorId);
  }

  return message.actorId === operatorId;
}

function shouldEmitTelegramTypingSignal(
  binding: ConversationBinding,
  message: MessageRecord,
): boolean {
  if (binding.conversationId !== SCOUT_PRIMARY_CONVERSATION_ID) {
    return false;
  }

  if (message.class !== "status" || message.actorId !== SYSTEM_ACTOR_ID) {
    return false;
  }

  const source = typeof message.metadata?.source === "string"
    ? String(message.metadata.source)
    : "";
  if (source !== "broker") {
    return false;
  }

  return /is working\.?$/i.test(message.body.trim());
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
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < BROKER_POST_RETRY_ATTEMPTS; attempt += 1) {
    const response = await fetch(new URL(pathname, baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    const detail = await response.text().catch(() => "");
    const error = new Error(detail || `${pathname} returned ${response.status}`);
    if (!isBrokerLockError(detail) || attempt === BROKER_POST_RETRY_ATTEMPTS - 1) {
      throw error;
    }

    lastError = error;
    await wait(BROKER_POST_RETRY_DELAY_MS * (attempt + 1));
  }

  throw lastError ?? new Error(`${pathname} failed`);
}

function isBrokerLockError(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return normalized.includes("database is locked") || normalized.includes("sqlite_busy");
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function readDeliveryMetadataNumber(
  delivery: DeliveryIntent,
  key: string,
): number {
  const value = delivery.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRetryableTelegramError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  return (
    normalized.includes("network error")
    || normalized.includes("timed out")
    || normalized.includes("timeout")
    || normalized.includes("econnreset")
    || normalized.includes("econnrefused")
    || normalized.includes("etimedout")
    || normalized.includes("socket hang up")
    || normalized.includes("fetch failed")
  );
}

async function readLiveBrokerState() {
  const status = await brokerServiceStatus();
  const [snapshot, node] = await Promise.all([
    brokerGet<RuntimeRegistrySnapshot>(status.brokerUrl, "/v1/snapshot"),
    brokerGet<BrokerNode>(status.brokerUrl, "/v1/node"),
  ]);
  return { status, snapshot, node };
}

function normalizeTimestamp(value: number | null | undefined): number {
  if (!value) return 0;
  return value > 10_000_000_000 ? value : value * 1000;
}

function resolveTelegramOwnerNodeId(
  config: TelegramBridgeConfig,
  snapshot: RuntimeRegistrySnapshot | null,
  localNodeId: string | undefined,
): string | null {
  const explicitOwner = config.ownerNodeId.trim();
  if (explicitOwner) {
    return explicitOwner;
  }

  if (!snapshot || !localNodeId) {
    return localNodeId ?? null;
  }

  const now = Date.now();
  const candidates = Object.values(snapshot.nodes)
    .filter((node) => {
      if (node.id === localNodeId) {
        return true;
      }

      const seenAt = normalizeTimestamp(node.lastSeenAt ?? node.registeredAt);
      return seenAt > 0 && now - seenAt <= OWNER_HEARTBEAT_TTL_MS;
    })
    .map((node) => node.id)
    .sort((lhs, rhs) => lhs.localeCompare(rhs));

  return candidates[0] ?? localNodeId;
}

function baseTelegramState(): TelegramBridgeRuntimeState {
  return {
    enabled: false,
    configured: false,
    running: false,
    mode: "polling",
    runtimeMode: null,
    detail: "Telegram bridge disabled.",
    lastError: null,
    bindingCount: 0,
    pendingDeliveries: 0,
  };
}

class TelegramBridgeService {
  private telegram: TelegramAdapter | null = null;
  private bot: Chat<{ telegram: TelegramAdapter }> | null = null;
  private deliveryTimer: ReturnType<typeof setInterval> | null = null;
  private inflightDeliveries = new Set<string>();
  private configKey: string | null = null;
  private state: TelegramBridgeRuntimeState = baseTelegramState();
  private lockHeld = false;

  private lockPath() {
    return join(resolveOpenScoutSupportPaths().runtimeDirectory, "telegram-bridge.lock");
  }

  private setState(patch: Partial<TelegramBridgeRuntimeState>) {
    this.state = {
      ...this.state,
      ...patch,
    };
  }

  private async readConfig(): Promise<TelegramBridgeConfig> {
    const settings = await readOpenScoutSettings({ currentDirectory: process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd() });
    const telegram = settings.bridges.telegram;
    const botToken = telegram.botToken.trim();
    const normalizedDefaultConversationId =
      !telegram.defaultConversationId.trim() || telegram.defaultConversationId.trim() === SHARED_CHANNEL_ID
        ? SCOUT_PRIMARY_CONVERSATION_ID
        : telegram.defaultConversationId.trim();
    return {
      enabled: telegram.enabled,
      configured: Boolean(botToken),
      mode: telegram.mode,
      botToken,
      secretToken: telegram.secretToken.trim(),
      apiBaseUrl: telegram.apiBaseUrl.trim(),
      userName: telegram.userName.trim(),
      defaultConversationId: normalizedDefaultConversationId,
      ownerNodeId: telegram.ownerNodeId.trim(),
    };
  }

  getRuntimeState(): TelegramBridgeRuntimeState {
    return { ...this.state };
  }

  async refreshConfiguration(): Promise<void> {
    try {
      const config = await this.readConfig();
      const nextKey = JSON.stringify(config);
      const liveBroker = await readLiveBrokerState();
      const localNodeId = liveBroker.node?.id;
      const ownerNodeId = resolveTelegramOwnerNodeId(config, liveBroker.snapshot, localNodeId);

      if (!config.enabled || !config.configured) {
        await this.stop();
        this.configKey = null;
        this.state = {
          ...baseTelegramState(),
          enabled: config.enabled,
          configured: config.configured,
          mode: config.mode,
          detail: !config.enabled
            ? "Telegram bridge disabled in settings."
            : "Telegram bridge is enabled, but the bot token is missing.",
        };
        return;
      }

      if (!liveBroker.status.reachable || !liveBroker.snapshot || !localNodeId) {
        await this.stop();
        this.configKey = nextKey;
        this.state = {
          ...baseTelegramState(),
          enabled: true,
          configured: true,
          mode: config.mode,
          detail: "Telegram bridge is waiting for the local Relay broker.",
        };
        return;
      }

      if (ownerNodeId && ownerNodeId !== localNodeId) {
        await this.stop();
        this.configKey = nextKey;
        this.state = {
          ...baseTelegramState(),
          enabled: true,
          configured: true,
          mode: config.mode,
          detail: config.ownerNodeId
            ? `Telegram bridge standby. External comms are pinned to ${ownerNodeId}.`
            : `Telegram bridge standby. Automatic mesh owner is ${ownerNodeId}.`,
        };
        await this.refreshMetrics();
        return;
      }

      await this.ensureConversationTargetReady(
        liveBroker.status.brokerUrl,
        liveBroker.snapshot,
        localNodeId,
        config.defaultConversationId,
      );
      await this.ensureConversation(
        liveBroker.status.brokerUrl,
        liveBroker.snapshot,
        localNodeId,
        config.defaultConversationId,
      );
      await this.normalizeExistingBindings(
        liveBroker.status.brokerUrl,
        liveBroker.snapshot,
        localNodeId,
        config,
      );

      if (this.bot && this.telegram && this.configKey === nextKey) {
        await this.refreshMetrics();
        return;
      }

      await this.stop();
      this.configKey = nextKey;
      await this.acquireLock();

      const adapter = createTelegramAdapter({
        apiBaseUrl: config.apiBaseUrl || undefined,
        botToken: config.botToken,
        mode: config.mode,
        secretToken: config.secretToken || undefined,
        userName: config.userName || undefined,
      });
      const bot = new Chat({
        userName: config.userName || "openscout",
        adapters: { telegram: adapter },
        state: createMemoryState(),
        logger: "silent",
      });

      bot.onNewMention(async (thread, message) => {
        await this.handleThreadMessage(thread, message, true, config);
      });

      bot.onSubscribedMessage(async (thread, message) => {
        await this.handleThreadMessage(thread, message, false, config);
      });

      bot.onNewMessage(/[\s\S]+/, async (thread, message) => {
        if (!thread.isDM) return;
        await this.handleThreadMessage(thread, message, true, config);
      });

      await bot.initialize();

      this.telegram = adapter;
      this.bot = bot;
      this.deliveryTimer = setInterval(() => {
        void this.pumpPendingDeliveries().catch((error) => {
          this.setState({
            lastError: error instanceof Error ? error.message : String(error),
            detail: "Telegram bridge failed while pumping outbound deliveries.",
          });
        });
      }, DELIVERY_POLL_MS);

      this.state = {
        enabled: true,
        configured: true,
        running: true,
        mode: config.mode,
        runtimeMode: adapter.runtimeMode,
        detail: `Telegram bridge active in ${adapter.runtimeMode} mode.`,
        lastError: null,
        bindingCount: 0,
        pendingDeliveries: 0,
      };

      await this.refreshMetrics();
      void this.pumpPendingDeliveries().catch((error) => {
        this.setState({
          lastError: error instanceof Error ? error.message : String(error),
          detail: "Telegram bridge failed while pumping outbound deliveries.",
        });
      });
    } catch (error) {
      await this.stop();
      this.configKey = null;
      this.state = {
        ...baseTelegramState(),
        enabled: true,
        configured: true,
        mode: "polling",
        detail: "Telegram bridge failed to start.",
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async normalizeExistingBindings(
    baseUrl: string,
    snapshot: RuntimeRegistrySnapshot,
    nodeId: string,
    config: TelegramBridgeConfig,
  ): Promise<void> {
    const telegramBindings = Object.values(snapshot.bindings)
      .filter((binding) => binding.platform === "telegram");

    for (const binding of telegramBindings) {
      const isDirectMessage = Boolean(binding.metadata?.isDirectMessage);
      let nextBinding = binding;

      if (
        isDirectMessage
        && config.defaultConversationId === SCOUT_PRIMARY_CONVERSATION_ID
        && binding.conversationId === SHARED_CHANNEL_ID
      ) {
        await this.ensureConversationTargetReady(baseUrl, snapshot, nodeId, SCOUT_PRIMARY_CONVERSATION_ID);
        const conversation = await this.ensureConversation(baseUrl, snapshot, nodeId, SCOUT_PRIMARY_CONVERSATION_ID);
        nextBinding = {
          ...binding,
          conversationId: conversation.id,
          metadata: {
            ...(binding.metadata ?? {}),
            migratedFromConversationId: binding.conversationId,
          },
        };
        await brokerPost(baseUrl, "/v1/bindings", nextBinding);
        snapshot.bindings[nextBinding.id] = nextBinding;
      }

      nextBinding = await this.ensureTelegramBindingPolicy(baseUrl, snapshot, nextBinding);
      snapshot.bindings[nextBinding.id] = nextBinding;
    }
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  private async stop(): Promise<void> {
    if (this.deliveryTimer) {
      clearInterval(this.deliveryTimer);
      this.deliveryTimer = null;
    }

    if (this.bot) {
      await this.bot.shutdown();
    }

    this.inflightDeliveries.clear();
    this.bot = null;
    this.telegram = null;
    await this.releaseLock();
    this.setState({
      running: false,
      runtimeMode: null,
    });
  }

  private processAlive(pid: number | null | undefined): boolean {
    if (!pid || !Number.isFinite(pid)) {
      return false;
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async readExistingLock(): Promise<TelegramBridgeLockRecord | null> {
    try {
      const raw = await readFile(this.lockPath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<TelegramBridgeLockRecord>;
      if (typeof parsed.pid === "number" && typeof parsed.createdAt === "number") {
        return { pid: parsed.pid, createdAt: parsed.createdAt };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async acquireLock(): Promise<void> {
    if (this.lockHeld) {
      return;
    }

    const lockPath = this.lockPath();
    await mkdir(resolveOpenScoutSupportPaths().runtimeDirectory, { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(lockPath, JSON.stringify({
          pid: process.pid,
          createdAt: Date.now(),
        } satisfies TelegramBridgeLockRecord), {
          encoding: "utf8",
          flag: "wx",
        });
        this.lockHeld = true;
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          throw error;
        }

        const existing = await this.readExistingLock();
        if (existing?.pid === process.pid) {
          this.lockHeld = true;
          return;
        }
        if (existing && this.processAlive(existing.pid)) {
          throw new Error(`Telegram bridge already owned by local pid ${existing.pid}.`);
        }

        await rm(lockPath, { force: true });
      }
    }

    throw new Error("Unable to acquire Telegram bridge lock.");
  }

  private async releaseLock(): Promise<void> {
    if (!this.lockHeld) {
      return;
    }

    this.lockHeld = false;
    await rm(this.lockPath(), { force: true }).catch(() => undefined);
  }

  private async refreshMetrics(): Promise<void> {
    const { status, snapshot } = await readLiveBrokerState();
    const pendingDeliveries = status.reachable
      ? (await brokerGet<DeliveryIntent[]>(
        status.brokerUrl,
        "/v1/deliveries?transport=telegram&status=pending&limit=500",
      ))?.length ?? 0
      : 0;
    const bindingCount = Object.values(snapshot?.bindings ?? {})
      .filter((binding) => binding.platform === "telegram")
      .length;

    this.setState({
      bindingCount,
      pendingDeliveries,
    });
  }

  private async handleThreadMessage(
    thread: Thread,
    message: Message,
    subscribeOnFirstMessage: boolean,
    config: TelegramBridgeConfig,
  ): Promise<void> {
    try {
      if (subscribeOnFirstMessage && !(await thread.isSubscribed())) {
        await thread.subscribe();
      }

      await this.ingestInboundMessage({
        externalChannelId: thread.channelId,
        externalThreadId: thread.id,
        externalMessageId: message.id,
        senderId: message.author.userId,
        senderDisplayName: message.author.fullName || message.author.userName || message.author.userId,
        senderUserName: message.author.userName || "",
        text: message.text,
        receivedAt: message.metadata.dateSent.getTime(),
        isDirectMessage: thread.isDM,
      }, config);
      this.setState({ lastError: null });
    } catch (error) {
      this.setState({
        lastError: error instanceof Error ? error.message : String(error),
        detail: "Telegram bridge failed to ingest an inbound message.",
      });
    }
  }

  private async ingestInboundMessage(
    message: InboundTelegramMessage,
    config: TelegramBridgeConfig,
  ): Promise<void> {
    const { status, snapshot, node } = await readLiveBrokerState();
    if (!status.reachable || !snapshot || !node?.id) {
      this.setState({
        detail: "Relay broker is unavailable, so Telegram traffic cannot be bridged yet.",
      });
      return;
    }

    await this.ensureOperatorActor(status.brokerUrl);
    await this.ensureConversationTargetReady(status.brokerUrl, snapshot, node.id, config.defaultConversationId);
    const existingBinding = this.findBinding(snapshot, message);
    const binding = existingBinding
      ? await this.ensureTelegramBindingPolicy(
        status.brokerUrl,
        snapshot,
        await this.ensureBindingConversation(
          status.brokerUrl,
          snapshot,
          node.id,
          existingBinding,
          message,
          config.defaultConversationId,
        ),
      )
      : await this.createOrUpdateBinding(status.brokerUrl, snapshot, node.id, message, config.defaultConversationId);
    const conversation = await this.ensureConversation(
      status.brokerUrl,
      snapshot,
      node.id,
      binding.conversationId,
    );

    const actor: ActorIdentity = {
      id: stableTelegramActorId(message),
      kind: "person",
      displayName: message.senderDisplayName || message.senderUserName || `Telegram ${message.senderId}`,
      handle: message.senderUserName ? `@${message.senderUserName}` : undefined,
      labels: ["telegram", "external"],
      metadata: {
        source: "telegram",
        senderId: message.senderId,
        userName: message.senderUserName || undefined,
      },
    };
    await brokerPost(status.brokerUrl, "/v1/actors", actor);

    const messageId = stableTelegramMessageId(message);
    if (snapshot.messages[messageId]) {
      return;
    }

    const messageBody = messageBodyFromTelegram(message);
    await brokerPost(status.brokerUrl, "/v1/messages", {
      id: messageId,
      conversationId: conversation.id,
      actorId: actor.id,
      originNodeId: node.id,
      class: "agent",
      body: messageBody,
      visibility: conversation.visibility,
      policy: "durable",
      createdAt: message.receivedAt,
      metadata: {
        source: "telegram",
        externalChannelId: message.externalChannelId,
        externalThreadId: message.externalThreadId,
        externalMessageId: message.externalMessageId,
        isDirectMessage: message.isDirectMessage,
      },
    } satisfies MessageRecord);

    await this.maybeInvokeConversationTarget(
      status.brokerUrl,
      snapshot,
      node.id,
      conversation,
      actor.id,
      message,
      messageId,
      messageBody,
    );

    await this.refreshMetrics();
  }

  private findBinding(
    snapshot: RuntimeRegistrySnapshot,
    message: InboundTelegramMessage,
  ): ConversationBinding | null {
    return Object.values(snapshot.bindings).find((binding) => (
      binding.platform === "telegram"
      && (
        binding.externalThreadId === message.externalThreadId
        || binding.externalChannelId === message.externalChannelId
      )
    )) ?? null;
  }

  private async createOrUpdateBinding(
    baseUrl: string,
    snapshot: RuntimeRegistrySnapshot,
    nodeId: string,
    message: InboundTelegramMessage,
    conversationId: string,
  ): Promise<ConversationBinding> {
    const conversation = await this.ensureConversation(baseUrl, snapshot, nodeId, conversationId);
    const binding: ConversationBinding = {
      id: stableTelegramBindingId(message.externalThreadId),
      conversationId: conversation.id,
      platform: "telegram",
      mode: "bidirectional",
      externalChannelId: message.externalChannelId,
      externalThreadId: message.externalThreadId,
      metadata: {
        source: "telegram",
        isDirectMessage: message.isDirectMessage,
        senderId: message.senderId,
        senderDisplayName: message.senderDisplayName,
        userName: message.senderUserName || undefined,
        ...desiredTelegramBindingMetadata(conversation.id),
      },
    };

    await brokerPost(baseUrl, "/v1/bindings", binding);
    snapshot.bindings[binding.id] = binding;
    return binding;
  }

  private async ensureTelegramBindingPolicy(
    baseUrl: string,
    snapshot: RuntimeRegistrySnapshot,
    binding: ConversationBinding,
  ): Promise<ConversationBinding> {
    const outboundMode = typeof binding.metadata?.outboundMode === "string"
      ? String(binding.metadata.outboundMode)
      : "";
    const operatorId = typeof binding.metadata?.operatorId === "string"
      ? String(binding.metadata.operatorId)
      : "";
    const allowedActorIds = telegramAllowedActorIds(binding);
    const desiredMetadata = desiredTelegramBindingMetadata(binding.conversationId);
    const desiredOutboundMode = String(desiredMetadata.outboundMode ?? "operator_only");
    const desiredOperatorId = String(desiredMetadata.operatorId ?? OPERATOR_ID);
    const desiredAllowedActorIds = Array.isArray(desiredMetadata.allowedActorIds)
      ? desiredMetadata.allowedActorIds.map((entry) => String(entry).trim()).filter(Boolean)
      : [];

    if (
      outboundMode === desiredOutboundMode
      && operatorId === desiredOperatorId
      && JSON.stringify(allowedActorIds) === JSON.stringify(desiredAllowedActorIds)
    ) {
      return binding;
    }

    const nextBinding: ConversationBinding = {
      ...binding,
      metadata: {
        ...(binding.metadata ?? {}),
        ...desiredMetadata,
      },
    };
    await brokerPost(baseUrl, "/v1/bindings", nextBinding);
    snapshot.bindings[nextBinding.id] = nextBinding;
    return nextBinding;
  }

  private async ensureBindingConversation(
    baseUrl: string,
    snapshot: RuntimeRegistrySnapshot,
    nodeId: string,
    binding: ConversationBinding,
    message: InboundTelegramMessage,
    desiredConversationId: string,
  ): Promise<ConversationBinding> {
    const shouldMigrateToScout =
      message.isDirectMessage
      && desiredConversationId === SCOUT_PRIMARY_CONVERSATION_ID
      && binding.conversationId === SHARED_CHANNEL_ID;

    if (!shouldMigrateToScout) {
      return binding;
    }

    await this.ensureConversationTargetReady(baseUrl, snapshot, nodeId, desiredConversationId);
    const conversation = await this.ensureConversation(baseUrl, snapshot, nodeId, desiredConversationId);
    const nextBinding: ConversationBinding = {
      ...binding,
      conversationId: conversation.id,
      metadata: {
        ...(binding.metadata ?? {}),
        migratedFromConversationId: binding.conversationId,
      },
    };

    await brokerPost(baseUrl, "/v1/bindings", nextBinding);
    snapshot.bindings[nextBinding.id] = nextBinding;
    return nextBinding;
  }

  private async ensureOperatorActor(baseUrl: string): Promise<void> {
    const settings = await readOpenScoutSettings({ currentDirectory: process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd() });
    await brokerPost(baseUrl, "/v1/actors", {
      id: OPERATOR_ID,
      kind: "person",
      displayName: settings.profile.operatorName.trim() || "Operator",
      handle: OPERATOR_ID,
      labels: ["operator", "desktop"],
      metadata: { source: "telegram-bridge" },
    } satisfies ActorIdentity);
  }

  private async ensureConversation(
    baseUrl: string,
    snapshot: RuntimeRegistrySnapshot,
    nodeId: string,
    conversationId: string,
  ): Promise<ConversationDefinition> {
    const existing = snapshot.conversations[conversationId];
    if (existing) {
      return existing;
    }

    const participantIds = Array.from(
      new Set([OPERATOR_ID, ...Object.keys(snapshot.agents)]),
    ).sort();

    const definition: ConversationDefinition | null =
      conversationId === SHARED_CHANNEL_ID
        ? {
            id: SHARED_CHANNEL_ID,
            kind: "channel",
            title: "shared-channel",
            visibility: "workspace",
            shareMode: "shared",
            authorityNodeId: nodeId,
            participantIds,
            metadata: { surface: "telegram-bridge" },
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
              metadata: { surface: "telegram-bridge" },
            }
          : conversationId === SYSTEM_CHANNEL_ID
            ? {
                id: SYSTEM_CHANNEL_ID,
            kind: "system",
            title: "system",
            visibility: "system",
            shareMode: "local",
            authorityNodeId: nodeId,
            participantIds: [OPERATOR_ID],
            metadata: { surface: "telegram-bridge" },
              }
            : conversationId === SCOUT_PRIMARY_CONVERSATION_ID
              ? {
                  id: SCOUT_PRIMARY_CONVERSATION_ID,
                  kind: "direct",
                  title: "Scout",
                  visibility: "private",
                  shareMode:
                    snapshot.agents[SCOUT_AGENT_ID]?.authorityNodeId
                    && snapshot.agents[SCOUT_AGENT_ID]?.authorityNodeId !== nodeId
                      ? "shared"
                      : "local",
                  authorityNodeId: nodeId,
                  participantIds: [OPERATOR_ID, SCOUT_AGENT_ID].sort(),
                  metadata: {
                    surface: "telegram-bridge",
                    role: "partner",
                    targetAgentId: SCOUT_AGENT_ID,
                  },
                }
            : null;

    if (!definition) {
      throw new Error(`Telegram bridge target conversation ${conversationId} does not exist.`);
    }

    await brokerPost(baseUrl, "/v1/conversations", definition);
    snapshot.conversations[definition.id] = definition;
    return definition;
  }

  private async ensureConversationTargetReady(
    baseUrl: string,
    snapshot: RuntimeRegistrySnapshot,
    nodeId: string,
    conversationId: string,
  ): Promise<void> {
    if (conversationId !== primaryDirectConversationIdForAgent(SCOUT_AGENT_ID)) {
      return;
    }

    await ensureScoutRelayAgentConfigured({
      currentDirectory: process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd(),
    });

    const binding = await ensureLocalAgentBindingOnline(SCOUT_AGENT_ID, nodeId, {
      currentDirectory: process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd(),
    });
    if (!binding) {
      throw new Error("Scout is not configured as a runnable local agent.");
    }

    await brokerPost(baseUrl, "/v1/actors", binding.actor);
    await brokerPost(baseUrl, "/v1/agents", binding.agent);
    await brokerPost(baseUrl, "/v1/endpoints", binding.endpoint);
    snapshot.actors[binding.actor.id] = binding.actor;
    snapshot.agents[binding.agent.id] = binding.agent;
    snapshot.endpoints[binding.endpoint.id] = binding.endpoint;
  }

  private resolveConversationTargetAgentId(
    conversation: ConversationDefinition,
    snapshot: RuntimeRegistrySnapshot,
  ): string | null {
    if (conversation.kind !== "direct") {
      return null;
    }

    return conversation.participantIds.find((participantId) => (
      participantId !== OPERATOR_ID && Boolean(snapshot.agents[participantId])
    )) ?? null;
  }

  private async maybeInvokeConversationTarget(
    baseUrl: string,
    snapshot: RuntimeRegistrySnapshot,
    nodeId: string,
    conversation: ConversationDefinition,
    requesterId: string,
    message: InboundTelegramMessage,
    messageId: string,
    task: string,
  ): Promise<void> {
    const targetAgentId = this.resolveConversationTargetAgentId(conversation, snapshot);
    if (!targetAgentId) {
      return;
    }

    await brokerPost(baseUrl, "/v1/invocations", {
      id: stableTelegramInvocationId(message, targetAgentId),
      requesterId,
      requesterNodeId: nodeId,
      targetAgentId,
      action: "consult",
      task,
      conversationId: conversation.id,
      messageId,
      ensureAwake: true,
      stream: false,
      createdAt: message.receivedAt,
      metadata: {
        source: "telegram-bridge",
        externalChannelId: message.externalChannelId,
        externalThreadId: message.externalThreadId,
        externalMessageId: message.externalMessageId,
      },
    });
  }

  private async pumpPendingDeliveries(): Promise<number> {
    const telegram = this.telegram;
    if (!telegram) {
      return 0;
    }

    const { status, snapshot } = await readLiveBrokerState();
    if (!status.reachable || !snapshot) {
      return 0;
    }

    const deliveries = await brokerGet<DeliveryIntent[]>(
      status.brokerUrl,
      "/v1/deliveries?transport=telegram&status=pending&limit=100",
    ) ?? [];
    let completed = 0;

    for (const delivery of deliveries) {
      if (this.inflightDeliveries.has(delivery.id)) {
        continue;
      }

      const nextAttemptAt = readDeliveryMetadataNumber(delivery, "nextAttemptAt");
      if (nextAttemptAt > Date.now()) {
        continue;
      }

      this.inflightDeliveries.add(delivery.id);
      try {
        const binding = delivery.bindingId ? snapshot.bindings[delivery.bindingId] : undefined;
        const message = delivery.messageId ? snapshot.messages[delivery.messageId] : undefined;
        const threadId = binding?.externalThreadId ?? binding?.externalChannelId;

        if (!binding || binding.platform !== "telegram" || !threadId || !message) {
          await this.failDelivery(status.brokerUrl, delivery.id, "Delivery is missing its Telegram binding or message.");
          continue;
        }

        if (!shouldDeliverTelegramMessage(binding, message)) {
          await brokerPost(status.brokerUrl, "/v1/deliveries/status", {
            deliveryId: delivery.id,
            status: "cancelled",
            metadata: {
              cancelledAt: Date.now(),
              reason: "telegram_outbound_filter",
            },
          });
          continue;
        }

        const attemptNumber = (await brokerGet<DeliveryAttempt[]>(
          status.brokerUrl,
          `/v1/delivery-attempts?deliveryId=${encodeURIComponent(delivery.id)}`,
        ))?.at(-1)?.attempt ?? 0;

        if (shouldEmitTelegramTypingSignal(binding, message)) {
          await telegram.startTyping(threadId);
          await brokerPost(status.brokerUrl, "/v1/delivery-attempts", {
            id: `datt-${randomUUID()}`,
            deliveryId: delivery.id,
            attempt: attemptNumber + 1,
            status: "acknowledged",
            externalRef: "typing",
            createdAt: Date.now(),
            metadata: {
              bindingId: binding.id,
              externalThreadId: threadId,
              signal: "typing",
            },
          } satisfies DeliveryAttempt);
          await brokerPost(status.brokerUrl, "/v1/deliveries/status", {
            deliveryId: delivery.id,
            status: "acknowledged",
            metadata: {
              acknowledgedAt: Date.now(),
              signal: "typing",
            },
          });
          completed += 1;
          continue;
        }

        const posted = await telegram.postMessage(threadId, message.body.trim() || "[telegram delivery]");
        await brokerPost(status.brokerUrl, "/v1/delivery-attempts", {
          id: `datt-${randomUUID()}`,
          deliveryId: delivery.id,
          attempt: attemptNumber + 1,
          status: "acknowledged",
          externalRef: posted.id,
          createdAt: Date.now(),
          metadata: {
            bindingId: binding.id,
            externalThreadId: threadId,
          },
        } satisfies DeliveryAttempt);
        await brokerPost(status.brokerUrl, "/v1/deliveries/status", {
          deliveryId: delivery.id,
          status: "acknowledged",
          metadata: {
            acknowledgedAt: Date.now(),
            externalMessageId: posted.id,
          },
        });
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attemptNumber = (await brokerGet<DeliveryAttempt[]>(
          status.brokerUrl,
          `/v1/delivery-attempts?deliveryId=${encodeURIComponent(delivery.id)}`,
        ))?.at(-1)?.attempt ?? 0;
        if (isRetryableTelegramError(message) && attemptNumber < TELEGRAM_DELIVERY_MAX_ATTEMPTS) {
          const retryAt = Date.now() + (TELEGRAM_DELIVERY_RETRY_BASE_MS * (attemptNumber + 1));
          await brokerPost(status.brokerUrl, "/v1/delivery-attempts", {
            id: `datt-${randomUUID()}`,
            deliveryId: delivery.id,
            attempt: attemptNumber + 1,
            status: "failed",
            error: message,
            createdAt: Date.now(),
            metadata: {
              retryAt,
              transient: true,
            },
          } satisfies DeliveryAttempt);
          await brokerPost(status.brokerUrl, "/v1/deliveries/status", {
            deliveryId: delivery.id,
            status: "pending",
            metadata: {
              lastError: message,
              lastAttemptAt: Date.now(),
              nextAttemptAt: retryAt,
              retryable: true,
            },
          });
          continue;
        }

        await this.failDelivery(
          status.brokerUrl,
          delivery.id,
          message,
        );
        this.setState({
          lastError: message,
          detail: "Telegram bridge failed while posting an outbound delivery.",
        });
      } finally {
        this.inflightDeliveries.delete(delivery.id);
      }
    }

    await this.refreshMetrics();
    return completed;
  }

  private async failDelivery(baseUrl: string, deliveryId: string, error: string) {
    const attemptNumber = (await brokerGet<DeliveryAttempt[]>(
      baseUrl,
      `/v1/delivery-attempts?deliveryId=${encodeURIComponent(deliveryId)}`,
    ))?.at(-1)?.attempt ?? 0;
    await brokerPost(baseUrl, "/v1/delivery-attempts", {
      id: `datt-${randomUUID()}`,
      deliveryId,
      attempt: attemptNumber + 1,
      status: "failed",
      error,
      createdAt: Date.now(),
    } satisfies DeliveryAttempt);
    await brokerPost(baseUrl, "/v1/deliveries/status", {
      deliveryId,
      status: "failed",
      metadata: {
        lastError: error,
        failedAt: Date.now(),
      },
    });
  }
}

export const telegramBridgeService = new TelegramBridgeService();
