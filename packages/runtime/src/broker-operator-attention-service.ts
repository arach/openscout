import type {
  ConversationDefinition,
  MessageRecord,
  ScoutOperatorSignal,
} from "@openscout/protocol";

import type {
  MobilePushAlert,
  MobilePushBroadcastResult,
} from "./mobile-push.js";

export type OperatorDeliveryIssueKind = "unassigned_scout" | "rejected" | "unavailable";

export type OperatorDeliveryIssueInput = {
  kind: OperatorDeliveryIssueKind;
  requestId: string;
  requesterId: string;
  requesterNodeId: string;
  targetLabel: string;
  detail: string;
};

export type OperatorSignalInput = {
  signal: ScoutOperatorSignal;
  messageId: string;
  conversationId: string;
  requesterId: string;
  requesterNodeId: string;
};

export type BrokerOperatorAttentionServiceOptions = {
  nodeId: string;
  systemActorId: string;
  operatorActorId: string;
  createId: (prefix: string) => string;
  ensureBrokerActorForDelivery: (actorId: string) => Promise<void>;
  ensureBrokerDeliveryConversation: (input: {
    requesterId: string;
    targetAgentId?: string;
    channel?: string;
  }) => Promise<ConversationDefinition>;
  messageVisibilityForConversation: (conversation?: ConversationDefinition) => MessageRecord["visibility"];
  postConversationMessage: (message: MessageRecord) => Promise<unknown>;
  broadcastApnsAlertToActiveMobileDevices: (
    alert: MobilePushAlert,
  ) => Promise<MobilePushBroadcastResult>;
  warn?: (message: string) => void;
  now?: () => number;
};

export class BrokerOperatorAttentionService {
  private loggedMissingOperatorApnsCredentials = false;

  constructor(private readonly options: BrokerOperatorAttentionServiceOptions) {}

  queueDeliveryIssue(input: OperatorDeliveryIssueInput): void {
    if (input.requesterId === this.options.operatorActorId) {
      return;
    }

    void this.recordDeliveryIssue(input).catch((error) => {
      this.options.warn?.(
        `[openscout-runtime] failed to notify operator about delivery issue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  queueOperatorSignal(input: OperatorSignalInput): void {
    if (input.requesterId === this.options.operatorActorId) {
      return;
    }

    void this.sendOperatorSignalAlert(input).catch((error) => {
      this.options.warn?.(
        `[openscout-runtime] failed to notify operator about agent signal: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  async sendOperatorSignalAlert(input: OperatorSignalInput): Promise<void> {
    const isConsult = input.signal.kind === "consult";
    const result = await this.options.broadcastApnsAlertToActiveMobileDevices({
      title: isConsult ? "An agent would value your input" : "Agent update",
      body: "Open Scout for details.",
      sound: null,
      urgency: "silent",
      threadId: "scout.agent-signal",
      payload: {
        destination: "inbox",
        itemId: input.messageId,
        kind: "operator_signal",
        signalKind: input.signal.kind,
        messageId: input.messageId,
        conversationId: input.conversationId,
        requesterId: input.requesterId,
        requesterNodeId: input.requesterNodeId,
      },
    });

    this.warnForBroadcastResult(result);
  }

  async recordDeliveryIssue(input: OperatorDeliveryIssueInput): Promise<void> {
    await this.options.ensureBrokerActorForDelivery(this.options.operatorActorId);
    const conversation = await this.options.ensureBrokerDeliveryConversation({
      requesterId: this.options.systemActorId,
      channel: "system",
    });
    const itemId = `delivery:${input.requestId}`;
    const targetLabel = input.targetLabel.trim() || "Scout";
    const detail = input.detail.trim();

    await this.options.postConversationMessage({
      id: this.options.createId("msg"),
      conversationId: conversation.id,
      actorId: this.options.systemActorId,
      originNodeId: this.options.nodeId,
      class: "system",
      body: detail,
      audience: {
        notify: [this.options.operatorActorId],
        reason: "mention",
      },
      visibility: this.options.messageVisibilityForConversation(conversation),
      policy: "durable",
      createdAt: this.now(),
      metadata: {
        source: "broker",
        operatorAttention: "delivery_issue",
        deliveryIssueKind: input.kind,
        requestId: input.requestId,
        requesterId: input.requesterId,
        requesterNodeId: input.requesterNodeId,
        targetLabel,
        itemId,
      },
    });

    const result = await this.options.broadcastApnsAlertToActiveMobileDevices({
      title: "Scout delivery needs attention",
      body: "Open Scout for details.",
      sound: "default",
      urgency: "interrupt",
      threadId: "scout.delivery",
      payload: {
        destination: "inbox",
        itemId,
        kind: "delivery_issue",
        requestId: input.requestId,
        requesterId: input.requesterId,
        requesterNodeId: input.requesterNodeId,
        targetLabel,
        reason: input.kind,
      },
    });

    this.warnForBroadcastResult(result);
  }

  private warnForBroadcastResult(result: MobilePushBroadcastResult): void {
    if (result.configMissing && !this.loggedMissingOperatorApnsCredentials) {
      this.loggedMissingOperatorApnsCredentials = true;
      this.options.warn?.("[openscout-runtime] mobile push credentials are missing; operator attention was recorded without APNS.");
    }
    if (result.rateLimited) {
      this.options.warn?.(
        `[openscout-runtime] push relay rate-limited (${result.rateLimitWindow ?? "unknown"}); retry in ${result.retryAfterSeconds ?? "?"}s.`,
      );
    }
    for (const failure of result.failures) {
      this.options.warn?.(
        `[openscout-runtime] failed to send operator delivery issue push to ${failure.deviceId} (${failure.tokenSuffix}): ${failure.reason ?? failure.status ?? "unknown"}`,
      );
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
