import type {
  RelayChannelBinding,
  RelayExternalDelivery,
} from "../../core/index.js";

export interface ChatBridgeInboundMessage {
  platform: string;
  externalChannelId: string;
  externalThreadId?: string;
  externalMessageId?: string;
  senderId: string;
  senderDisplayName?: string;
  text: string;
  receivedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ChatBridgeDeliveryResult {
  deliveryId: string;
  ok: boolean;
  externalMessageId?: string;
  error?: string;
}

export interface ChatBridgeAdapter {
  platform: string;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  ingestInboundMessage(message: ChatBridgeInboundMessage): Promise<void>;
  deliver(binding: RelayChannelBinding, delivery: RelayExternalDelivery): Promise<ChatBridgeDeliveryResult>;
}

export interface ChatBridgeRuntime {
  registerAdapter(adapter: ChatBridgeAdapter): void;
  adapter(platform: string): ChatBridgeAdapter | null;
  adapters(): ChatBridgeAdapter[];
}

export class MemoryChatBridgeRuntime implements ChatBridgeRuntime {
  private readonly registry = new Map<string, ChatBridgeAdapter>();

  registerAdapter(adapter: ChatBridgeAdapter): void {
    this.registry.set(adapter.platform, adapter);
  }

  adapter(platform: string): ChatBridgeAdapter | null {
    return this.registry.get(platform) ?? null;
  }

  adapters(): ChatBridgeAdapter[] {
    return [...this.registry.values()];
  }
}

export function createMemoryChatBridgeRuntime(): ChatBridgeRuntime {
  return new MemoryChatBridgeRuntime();
}
