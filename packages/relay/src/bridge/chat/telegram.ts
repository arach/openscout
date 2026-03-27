import { Chat, type Message, type Thread } from "chat";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTelegramAdapter,
  type TelegramAdapter,
  type TelegramAdapterMode,
} from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";

import {
  appendRelayMessage,
  readProjectedRelayChannelBindings,
  readProjectedRelayExternalDeliveries,
  type RelayChannelBinding,
  type RelayExternalDelivery,
} from "../../core/index.js";
import { deliverRelayMessageToTarget } from "../../hosts/delivery.js";
import type {
  ChatBridgeAdapter,
  ChatBridgeDeliveryResult,
  ChatBridgeInboundMessage,
} from "./protocol.js";
import {
  completeRelayExternalDelivery,
  findRelayChannelBindingByExternalThread,
  formatRelayExternalBindingChannel,
  upsertRelayChannelBinding,
} from "./relay.js";

export interface TelegramRelayBridgeOptions {
  apiBaseUrl?: string;
  botToken?: string;
  hub: string;
  actor?: string;
  defaultTarget?: string;
  deliveryPollMs?: number;
  mode?: TelegramAdapterMode;
  secretToken?: string;
  userName?: string;
}

function readEnvFileValue(filePath: string, key: string): string {
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      if (!normalized.startsWith(`${key}=`)) continue;

      let value = normalized.slice(key.length + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    return "";
  }

  return "";
}

function resolveTelegramConfigValue(
  key: string,
  explicitValue?: string,
): string | undefined {
  if (explicitValue) return explicitValue;

  const envValue = process.env[key];
  if (envValue) return envValue;

  const cwdEnv = readEnvFileValue(join(process.cwd(), ".env.local"), key);
  if (cwdEnv) return cwdEnv;

  const home = process.env.HOME || "";
  if (!home) return undefined;

  const homeEnv = readEnvFileValue(join(home, ".env.local"), key);
  return homeEnv || undefined;
}

function normalizeBridgeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "telegram";
}

function relayActorFromTelegramMessage(message: ChatBridgeInboundMessage): string {
  const display = message.senderDisplayName?.trim();
  if (display) return `tg.${normalizeBridgeName(display)}`;
  return `tg.user.${normalizeBridgeName(message.senderId)}`;
}

function relayBodyFromTelegramMessage(message: ChatBridgeInboundMessage): string {
  const text = message.text.trim();
  return text || "[telegram sent an attachment]";
}

export class TelegramRelayBridge implements ChatBridgeAdapter {
  readonly platform = "telegram";

  private readonly hub: string;
  private readonly actor: string;
  private readonly defaultTarget?: string;
  private readonly deliveryPollMs: number;
  private readonly telegram: TelegramAdapter;
  private readonly bot: Chat<{ telegram: TelegramAdapter }>;
  private readonly inflightDeliveries = new Set<string>();
  private deliveryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TelegramRelayBridgeOptions) {
    this.hub = options.hub;
    this.actor = options.actor ?? "bridge.telegram";
    this.defaultTarget = options.defaultTarget;
    this.deliveryPollMs = options.deliveryPollMs ?? 1000;
    const botToken = resolveTelegramConfigValue(
      "TELEGRAM_BOT_TOKEN",
      options.botToken,
    );
    const secretToken = resolveTelegramConfigValue(
      "TELEGRAM_WEBHOOK_SECRET_TOKEN",
      options.secretToken,
    );
    const apiBaseUrl = resolveTelegramConfigValue(
      "TELEGRAM_API_BASE_URL",
      options.apiBaseUrl,
    );
    const userName = resolveTelegramConfigValue(
      "TELEGRAM_BOT_USERNAME",
      options.userName,
    );

    this.telegram = createTelegramAdapter({
      apiBaseUrl,
      botToken,
      mode: options.mode ?? "auto",
      secretToken,
      userName,
    });

    this.bot = new Chat({
      userName: userName ?? "openscout",
      adapters: { telegram: this.telegram },
      state: createMemoryState(),
      logger: "silent",
    });

    this.bot.onNewMention(async (thread, message) => {
      await this.handleThreadMessage(thread, message, true);
    });

    this.bot.onSubscribedMessage(async (thread, message) => {
      await this.handleThreadMessage(thread, message, false);
    });

    this.bot.onNewMessage(/[\s\S]+/, async (thread, message) => {
      if (!thread.isDM) return;
      await this.handleThreadMessage(thread, message, true);
    });
  }

  get runtimeMode(): string {
    return this.telegram.runtimeMode;
  }

  async start(): Promise<void> {
    await this.bot.initialize();

    if (!this.deliveryTimer) {
      this.deliveryTimer = setInterval(() => {
        void this.pumpPendingDeliveries();
      }, this.deliveryPollMs);
    }
  }

  async stop(): Promise<void> {
    if (this.deliveryTimer) {
      clearInterval(this.deliveryTimer);
      this.deliveryTimer = null;
    }

    await this.bot.shutdown();
  }

  async ingestInboundMessage(message: ChatBridgeInboundMessage): Promise<void> {
    const existing = await findRelayChannelBindingByExternalThread(
      this.hub,
      this.platform,
      message.externalThreadId ?? message.externalChannelId,
    );
    const target = existing?.conversationId ?? this.defaultTarget;
    if (!target) return;

    const binding = await upsertRelayChannelBinding(this.hub, {
      actor: this.actor,
      platform: this.platform,
      externalChannelId: message.externalChannelId,
      externalThreadId: message.externalThreadId ?? message.externalChannelId,
      conversationId: target,
      metadata: {
        senderId: message.senderId,
        senderDisplayName: message.senderDisplayName,
        source: "telegram",
        ...message.metadata,
      },
    });

    const relayActor = relayActorFromTelegramMessage(message);
    const relayBody = relayBodyFromTelegramMessage(message);
    const channel = formatRelayExternalBindingChannel(
      this.platform,
      binding.bindingId,
    );
    const entry = await appendRelayMessage(this.hub, {
      ts: message.receivedAt,
      from: relayActor,
      type: "MSG",
      body: relayBody,
      channel,
      tags: ["external", this.platform, `binding:${binding.bindingId}`],
      to: [target],
    });

    await deliverRelayMessageToTarget(
      this.hub,
      target,
      relayActor,
      relayBody,
      channel,
      entry.id,
    );
  }

  async deliver(
    binding: RelayChannelBinding,
    delivery: RelayExternalDelivery,
  ): Promise<ChatBridgeDeliveryResult> {
    try {
      const threadId = binding.externalThreadId ?? binding.externalChannelId;
      const posted = await this.telegram.postMessage(threadId, delivery.text);
      return {
        deliveryId: delivery.deliveryId,
        ok: true,
        externalMessageId: posted.id,
      };
    } catch (error) {
      return {
        deliveryId: delivery.deliveryId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async pumpPendingDeliveries(): Promise<number> {
    const bindings = await readProjectedRelayChannelBindings(this.hub);
    const deliveries = await readProjectedRelayExternalDeliveries(this.hub);
    const pending = Object.values(deliveries)
      .filter((delivery) => delivery.status === "pending")
      .sort((a, b) => a.requestedAt - b.requestedAt);

    let completed = 0;

    for (const delivery of pending) {
      if (this.inflightDeliveries.has(delivery.deliveryId)) continue;

      const binding = bindings[delivery.bindingId];
      if (!binding || binding.platform !== this.platform) continue;

      this.inflightDeliveries.add(delivery.deliveryId);
      try {
        const result = await this.deliver(binding, delivery);
        if (!result.ok) {
          console.error(`[relay bridge telegram] delivery failed: ${result.error ?? "unknown error"}`);
          continue;
        }

        await completeRelayExternalDelivery(this.hub, {
          actor: this.actor,
          deliveryId: delivery.deliveryId,
          bindingId: binding.bindingId,
          externalMessageId: result.externalMessageId,
        });
        completed += 1;
      } finally {
        this.inflightDeliveries.delete(delivery.deliveryId);
      }
    }

    return completed;
  }

  private async handleThreadMessage(
    thread: Thread,
    message: Message,
    subscribeOnFirstMessage: boolean,
  ): Promise<void> {
    if (subscribeOnFirstMessage && !(await thread.isSubscribed())) {
      await thread.subscribe();
    }

    await this.ingestInboundMessage({
      platform: this.platform,
      externalChannelId: thread.channelId,
      externalThreadId: thread.id,
      externalMessageId: message.id,
      senderId: message.author.userId,
      senderDisplayName: message.author.fullName,
      text: message.text,
      receivedAt: Math.floor(message.metadata.dateSent.getTime() / 1000),
      metadata: {
        isDM: thread.isDM,
        messageId: message.id,
        userName: message.author.userName,
      },
    });
  }
}

export function createTelegramRelayBridge(
  options: TelegramRelayBridgeOptions,
): TelegramRelayBridge {
  return new TelegramRelayBridge(options);
}
