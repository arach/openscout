import { describe, expect, test } from "bun:test";

import type {
  ConversationDefinition,
  MessageRecord,
} from "@openscout/protocol";

import {
  BrokerOperatorAttentionService,
  type OperatorDeliveryIssueInput,
} from "./broker-operator-attention-service.js";
import type {
  MobilePushAlert,
  MobilePushBroadcastResult,
} from "./mobile-push.js";

function testConversation(input: Partial<ConversationDefinition> = {}): ConversationDefinition {
  return {
    id: "channel.system",
    kind: "system",
    title: "System",
    visibility: "workspace",
    shareMode: "local",
    authorityNodeId: "node-1",
    participantIds: ["operator", "scout.system"],
    metadata: {},
    ...input,
  };
}

function broadcastResult(input: Partial<MobilePushBroadcastResult> = {}): MobilePushBroadcastResult {
  return {
    attemptedCount: 0,
    deliveredCount: 0,
    skippedCount: 0,
    failedCount: 0,
    configMissing: false,
    failures: [],
    ...input,
  };
}

function issue(input: Partial<OperatorDeliveryIssueInput> = {}): OperatorDeliveryIssueInput {
  return {
    kind: "rejected",
    requestId: "deliver-1",
    requesterId: "remote-agent",
    requesterNodeId: "remote-node",
    targetLabel: "@missing",
    detail: "Could not route @missing",
    ...input,
  };
}

function createHarness(input: {
  broadcastResult?: MobilePushBroadcastResult;
  conversation?: ConversationDefinition;
} = {}) {
  const ensuredActors: string[] = [];
  const conversationRequests: Array<{ requesterId: string; targetAgentId?: string; channel?: string }> = [];
  const messages: MessageRecord[] = [];
  const alerts: MobilePushAlert[] = [];
  const warnings: string[] = [];
  const service = new BrokerOperatorAttentionService({
    nodeId: "node-1",
    systemActorId: "scout.system",
    operatorActorId: "operator",
    createId: () => "msg-1",
    async ensureBrokerActorForDelivery(actorId) {
      ensuredActors.push(actorId);
    },
    async ensureBrokerDeliveryConversation(request) {
      conversationRequests.push(request);
      return input.conversation ?? testConversation();
    },
    messageVisibilityForConversation: (conversation) => conversation?.visibility ?? "workspace",
    async postConversationMessage(message) {
      messages.push(message);
      return { ok: true };
    },
    async broadcastApnsAlertToActiveMobileDevices(alert) {
      alerts.push(alert);
      return input.broadcastResult ?? broadcastResult();
    },
    warn: (message) => warnings.push(message),
    now: () => 10_000,
  });

  return {
    alerts,
    conversationRequests,
    ensuredActors,
    messages,
    service,
    warnings,
  };
}

describe("BrokerOperatorAttentionService", () => {
  test("records a system message and mobile alert for delivery issues", async () => {
    const harness = createHarness();

    await harness.service.recordDeliveryIssue(issue());

    expect(harness.ensuredActors).toEqual(["operator"]);
    expect(harness.conversationRequests).toEqual([
      { requesterId: "scout.system", channel: "system" },
    ]);
    expect(harness.messages).toEqual([
      expect.objectContaining({
        id: "msg-1",
        conversationId: "channel.system",
        actorId: "scout.system",
        originNodeId: "node-1",
        class: "system",
        body: "Could not route @missing",
        audience: {
          notify: ["operator"],
          reason: "mention",
        },
        visibility: "workspace",
        createdAt: 10_000,
        metadata: expect.objectContaining({
          source: "broker",
          operatorAttention: "delivery_issue",
          deliveryIssueKind: "rejected",
          requestId: "deliver-1",
          requesterId: "remote-agent",
          requesterNodeId: "remote-node",
          targetLabel: "@missing",
          itemId: "delivery:deliver-1",
        }),
      }),
    ]);
    expect(harness.alerts).toEqual([
      expect.objectContaining({
      title: "Scout delivery needs attention",
      body: "Open Scout for details.",
      sound: "default",
      urgency: "interrupt",
        threadId: "scout.delivery",
        payload: expect.objectContaining({
          destination: "inbox",
          itemId: "delivery:deliver-1",
          kind: "delivery_issue",
          messageId: "msg-1",
          conversationId: "channel.system",
          requestId: "deliver-1",
          requesterId: "remote-agent",
          requesterNodeId: "remote-node",
          targetLabel: "@missing",
          reason: "rejected",
        }),
      }),
    ]);
  });

  test("does not queue operator self-notifications", async () => {
    const harness = createHarness();

    harness.service.queueDeliveryIssue(issue({ requesterId: "operator" }));
    await Promise.resolve();

    expect(harness.messages).toEqual([]);
    expect(harness.alerts).toEqual([]);
    expect(harness.warnings).toEqual([]);
  });

  test("pushes a generic non-blocking alert for an agent-authored operator signal", async () => {
    const harness = createHarness();

    await harness.service.sendOperatorSignalAlert({
      signal: {
        kind: "consult",
        blocking: false,
        replyExpectation: "optional",
        defaultAction: "Keep the restrained HUD animation.",
      },
      messageId: "msg-consult",
      conversationId: "dm.agent.operator",
      requesterId: "agent-1",
      requesterNodeId: "node-1",
    });

    expect(harness.messages).toEqual([]);
    expect(harness.alerts).toEqual([{
      title: "An agent would value your input",
      body: "Open Scout for details.",
      sound: null,
      urgency: "silent",
      threadId: "scout.agent-signal",
      payload: {
        destination: "inbox",
        itemId: "msg-consult",
        kind: "operator_signal",
        signalKind: "consult",
        messageId: "msg-consult",
        conversationId: "dm.agent.operator",
        requesterId: "agent-1",
        requesterNodeId: "node-1",
      },
    }]);
  });

  test("warns once for missing credentials and reports rate limits and failures", async () => {
    const harness = createHarness({
      broadcastResult: broadcastResult({
        configMissing: true,
        rateLimited: true,
        retryAfterSeconds: 12,
        rateLimitWindow: "minute",
        failures: [{
          deviceId: "device-1",
          tokenSuffix: "abcd",
          status: 500,
          reason: null,
        }],
      }),
    });

    await harness.service.recordDeliveryIssue(issue({ requestId: "deliver-1" }));
    await harness.service.recordDeliveryIssue(issue({ requestId: "deliver-2" }));

    expect(harness.warnings).toEqual([
      "[openscout-runtime] mobile push credentials are missing; operator attention was recorded without APNS.",
      "[openscout-runtime] push relay rate-limited (minute); retry in 12s.",
      "[openscout-runtime] failed to send operator delivery issue push to device-1 (abcd): 500",
      "[openscout-runtime] push relay rate-limited (minute); retry in 12s.",
      "[openscout-runtime] failed to send operator delivery issue push to device-1 (abcd): 500",
    ]);
  });
});
