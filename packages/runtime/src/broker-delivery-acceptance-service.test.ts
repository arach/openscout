import { describe, expect, test } from "bun:test";

import {
  buildScoutReturnAddress,
  type AgentDefinition,
  type AgentEndpoint,
  type ConversationDefinition,
  type FlightRecord,
  type InvocationRequest,
  type MessageRecord,
  type ScoutDeliverRequest,
  type ScoutDispatchEnvelope,
  type ScoutDispatchRecord,
} from "@openscout/protocol";

import { BrokerDeliveryAcceptanceService } from "./broker-delivery-acceptance-service.js";
import type { InvocationResolution } from "./broker-delivery-routing.js";
import type { RuntimeSnapshot } from "./scout-dispatcher.js";

function testAgent(input: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agent-1",
    kind: "agent",
    definitionId: "agent-1",
    displayName: "Agent One",
    handle: "agent-one",
    labels: ["agent"],
    metadata: {},
    selector: "@agent-one",
    defaultSelector: "@agent-one",
    agentClass: "general",
    capabilities: ["chat", "invoke", "deliver"],
    wakePolicy: "on_demand",
    homeNodeId: "node-1",
    authorityNodeId: "node-1",
    advertiseScope: "local",
    ...input,
  };
}

function testEndpoint(input: Partial<AgentEndpoint> = {}): AgentEndpoint {
  return {
    id: "endpoint-1",
    agentId: "agent-1",
    nodeId: "node-1",
    harness: "codex",
    transport: "tmux",
    state: "idle",
    sessionId: "session-1",
    metadata: {},
    ...input,
  };
}

function testConversation(input: Partial<ConversationDefinition> = {}): ConversationDefinition {
  return {
    id: "conversation-1",
    kind: "direct",
    title: "Agent One",
    visibility: "workspace",
    shareMode: "local",
    authorityNodeId: "node-1",
    participantIds: ["operator", "agent-1"],
    metadata: {},
    ...input,
  };
}

function testSnapshot(input: {
  agents?: Record<string, AgentDefinition>;
  endpoints?: Record<string, AgentEndpoint>;
  conversations?: Record<string, ConversationDefinition>;
  messages?: Record<string, MessageRecord>;
} = {}): RuntimeSnapshot {
  return {
    nodes: {},
    actors: {},
    agents: input.agents ?? {},
    endpoints: input.endpoints ?? {},
    conversations: input.conversations ?? {},
    bindings: {},
    messages: input.messages ?? {},
    readCursors: {},
    invocations: {},
    flights: {},
    collaborationRecords: {},
  };
}

function createHarness(input: {
  resolution?: InvocationResolution;
  conversation?: ConversationDefinition;
  conversationForRequest?: (
    request: { requesterId: string; targetAgentId?: string; channel?: string },
  ) => ConversationDefinition;
  snapshot?: RuntimeSnapshot;
  isOperatorTarget?: (payload: ScoutDeliverRequest) => boolean;
  isScoutTarget?: (payload: ScoutDeliverRequest) => boolean;
  now?: number;
} = {}) {
  const agent = testAgent();
  const endpoint = testEndpoint();
  const conversation = input.conversation ?? testConversation();
  const snapshot = input.snapshot ?? testSnapshot({
    agents: { [agent.id]: agent },
    endpoints: { [endpoint.id]: endpoint },
    conversations: { [conversation.id]: conversation },
  });
  const ensuredActors: string[] = [];
  const conversationsRequested: Array<{ requesterId: string; targetAgentId?: string; channel?: string }> = [];
  const postedMessages: MessageRecord[] = [];
  const acceptedInvocations: InvocationRequest[] = [];
  const dispatchedInvocations: InvocationRequest[] = [];
  const recordedDispatches: Array<{ envelope: ScoutDispatchEnvelope; requesterId?: string }> = [];
  const operatorIssues: Array<{
    kind: "unassigned_scout" | "rejected" | "unavailable";
    requestId: string;
    requesterId: string;
    requesterNodeId: string;
    targetLabel: string;
    detail: string;
  }> = [];
  let idCounter = 0;

  const service = new BrokerDeliveryAcceptanceService({
    nodeId: "node-1",
    operatorActorId: "operator",
    runtimeSnapshot: () => snapshot,
    createId: (prefix) => `${prefix}-${++idCounter}`,
    syncRegisteredLocalAgentsIfChanged: async () => {},
    metadataStringValue: (metadata, key) => {
      const value = metadata?.[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    },
    messageRefCandidateForRouteTarget: () => null,
    resolveBrokerMessageRef: () => null,
    async ensureBrokerActorForDelivery(actorId) {
      ensuredActors.push(actorId);
    },
    async ensureBrokerDeliveryConversation(request) {
      conversationsRequested.push(request);
      return input.conversationForRequest?.(request) ?? conversation;
    },
    brokerRouteKind: (conversationInput) => conversationInput.kind === "direct" ? "dm" : "channel",
    messageVisibilityForConversation: (conversationInput) => conversationInput?.visibility ?? "workspace",
    brokerActorDisplayName: (_snapshot, actorId) => actorId === agent.id ? agent.displayName : actorId,
    brokerTargetLabel: (agentInput) => agentInput.selector ?? agentInput.handle ?? agentInput.id,
    homeEndpointForAgent: (snapshotInput, agentId) =>
      Object.values(snapshotInput.endpoints).find((candidate) => candidate.agentId === agentId) ?? null,
    titleCaseName: (value) => value.slice(0, 1).toUpperCase() + value.slice(1),
    buildBrokerReturnAddressForActor: (_snapshot, actorId, options) => buildScoutReturnAddress({
      actorId,
      handle: actorId,
      conversationId: options?.conversationId,
      replyToMessageId: options?.replyToMessageId,
      sessionId: options?.sessionId,
    }),
    isOperatorDeliveryTarget: input.isOperatorTarget ?? (() => false),
    isLocalScoutProductTarget: input.isScoutTarget ?? (() => false),
    onlineConversationNotifyTargets: () => ["agent-1"],
    resolveBrokerDeliveryTargetWithImplicitProjectAgent: async () =>
      input.resolution ?? { kind: "resolved", agent },
    async recordScoutDispatch(envelope, options) {
      recordedDispatches.push({ envelope, requesterId: options?.requesterId });
      const record: ScoutDispatchRecord = {
        id: `dispatch-${recordedDispatches.length}`,
        requesterId: options?.requesterId,
        ...envelope,
      };
      return { record };
    },
    describeUnavailableDeliveryTarget: () => null,
    buildUnavailableDispatchEnvelope: () => {
      throw new Error("unexpected unavailable dispatch");
    },
    recordDeliveryWorkItemIfNeeded: async () => ({
      record: null,
    }),
    deliveryWorkItemResolutionForTell: () => ({ record: null }),
    async postConversationMessage(message) {
      postedMessages.push(message);
      return { ok: true };
    },
    async acceptInvocation(invocation) {
      acceptedInvocations.push(invocation);
      const flight: FlightRecord = {
        id: "flight-1",
        invocationId: invocation.id,
        requesterId: invocation.requesterId,
        targetAgentId: invocation.targetAgentId,
        state: "waking",
        startedAt: input.now ?? 10_000,
      };
      return flight;
    },
    async dispatchAcceptedInvocation(invocation) {
      dispatchedInvocations.push(invocation);
    },
    queueOperatorDeliveryIssue: (issue) => operatorIssues.push(issue),
    now: () => input.now ?? 10_000,
  });

  return {
    acceptedInvocations,
    conversationsRequested,
    dispatchedInvocations,
    ensuredActors,
    operatorIssues,
    postedMessages,
    recordedDispatches,
    service,
  };
}

describe("BrokerDeliveryAcceptanceService", () => {
  test("routes channel tells without creating an invocation", async () => {
    const conversation = testConversation({
      id: "channel.shared",
      kind: "channel",
      title: "Shared",
      participantIds: ["operator", "agent-1"],
    });
    const harness = createHarness({ conversation, now: 12_000 });

    const result = await harness.service.accept({
      id: "deliver-1",
      body: "hello channel",
      intent: "tell",
      target: { kind: "channel", channel: "shared" },
      caller: { actorId: "operator", nodeId: "node-1" },
    });

    expect(result.kind).toBe("delivery");
    expect(result.accepted).toBe(true);
    expect(result.routeKind).toBe("channel");
    expect(harness.acceptedInvocations).toEqual([]);
    expect(harness.dispatchedInvocations).toEqual([]);
    expect(harness.postedMessages).toHaveLength(1);
    expect(harness.postedMessages[0]).toEqual(expect.objectContaining({
      id: "msg-1",
      conversationId: "channel.shared",
      body: "hello channel",
      audience: expect.objectContaining({
        notify: ["agent-1"],
        reason: "conversation_visibility",
      }),
      metadata: expect.objectContaining({
        relayChannel: "shared",
        relayMessageId: "msg-1",
      }),
    }));
  });

  test("resolved consult posts a message and dispatches an invocation", async () => {
    const harness = createHarness({ now: 20_000 });

    const result = await harness.service.accept({
      id: "deliver-2",
      body: "please investigate",
      intent: "consult",
      targetAgentId: "agent-1",
      caller: { actorId: "operator", nodeId: "node-1" },
      messageMetadata: { source: "test" },
      labels: ["urgent", "urgent"],
    });

    expect(result.kind).toBe("delivery");
    expect(result.accepted).toBe(true);
    expect(result.receipt).toEqual(expect.objectContaining({
      requestId: "deliver-2",
      targetAgentId: "agent-1",
      targetLabel: "@agent-one",
      conversationId: "conversation-1",
      messageId: "msg-1",
      flightId: "flight-1",
    }));
    expect(harness.postedMessages[0]).toEqual(expect.objectContaining({
      id: "msg-1",
      actorId: "operator",
      body: "please investigate",
      mentions: [{ actorId: "agent-1", label: "@agent-one" }],
      metadata: expect.objectContaining({
        labels: ["urgent"],
        relayTarget: "agent-1",
        relayMessageId: "msg-1",
      }),
    }));
    expect(harness.acceptedInvocations).toHaveLength(1);
    expect(harness.acceptedInvocations[0]).toEqual(expect.objectContaining({
      id: "inv-2",
      action: "consult",
      targetAgentId: "agent-1",
      task: "please investigate",
      conversationId: "conversation-1",
      messageId: "msg-1",
      metadata: expect.objectContaining({
        source: "test",
        labels: ["urgent"],
        relayTarget: "agent-1",
      }),
    }));
    expect(harness.dispatchedInvocations).toEqual(harness.acceptedInvocations);
  });

  test("preserves requested fork execution when accepting a consult", async () => {
    const harness = createHarness({ now: 21_000 });

    const result = await harness.service.accept({
      id: "deliver-fork",
      body: "continue from the prior run",
      intent: "consult",
      targetAgentId: "agent-1",
      caller: { actorId: "operator", nodeId: "node-1" },
      execution: {
        harness: "codex",
        model: "gpt-5.5",
        reasoningEffort: "high",
        session: "fork",
        forkFromSessionId: "session-source-1",
      },
    });

    expect(result.kind).toBe("delivery");
    expect(harness.acceptedInvocations).toHaveLength(1);
    expect(harness.acceptedInvocations[0]?.execution).toEqual({
      harness: "codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
      session: "fork",
      forkFromSessionId: "session-source-1",
    });
  });

  test("channel consult posts a canonical channel message and broker pointer DM", async () => {
    const channelConversation = testConversation({
      id: "channel.xterm-super-component",
      kind: "channel",
      title: "xterm-super-component",
      visibility: "workspace",
      participantIds: ["operator", "agent-1"],
    });
    const directConversation = testConversation({
      id: "dm.operator.agent-1",
      kind: "direct",
      title: "Agent One",
      visibility: "private",
      participantIds: ["operator", "agent-1"],
    });
    const harness = createHarness({
      conversation: channelConversation,
      conversationForRequest: (request) => request.channel ? channelConversation : directConversation,
      now: 40_000,
    });

    const result = await harness.service.accept({
      id: "deliver-channel-1",
      body: "@agent-one please take pass 2",
      intent: "consult",
      targetAgentId: "agent-1",
      channel: "xterm-super-component",
      caller: { actorId: "operator", nodeId: "node-1" },
      messageMetadata: { source: "test" },
      invocationMetadata: { source: "test" },
    });

    expect(result.kind).toBe("delivery");
    expect(result.accepted).toBe(true);
    expect(result.conversation.id).toBe("channel.xterm-super-component");
    expect(harness.conversationsRequested).toEqual([
      { requesterId: "operator", targetAgentId: "agent-1", channel: "xterm-super-component" },
      { requesterId: "operator", targetAgentId: "agent-1" },
    ]);
    expect(harness.postedMessages).toHaveLength(2);

    const [canonical, pointer] = harness.postedMessages;
    expect(canonical).toEqual(expect.objectContaining({
      id: "msg-1",
      conversationId: "channel.xterm-super-component",
      body: "@agent-one please take pass 2",
      audience: expect.objectContaining({
        notify: ["agent-1"],
        reason: "mention",
      }),
      metadata: expect.objectContaining({
        relayChannel: "xterm-super-component",
        relayTarget: "agent-1",
        relayMessageId: "msg-1",
        returnAddress: expect.objectContaining({
          conversationId: "channel.xterm-super-component",
          replyToMessageId: "msg-1",
        }),
      }),
    }));

    expect(pointer).toEqual(expect.objectContaining({
      id: "msg-2",
      conversationId: "dm.operator.agent-1",
      actorId: "operator",
      class: "status",
      mentions: [{ actorId: "agent-1", label: "@agent-one" }],
      audience: {
        notify: ["agent-1"],
        reason: "direct_message",
      },
      metadata: expect.objectContaining({
        source: "broker-channel-attention",
        brokerGenerated: true,
        attentionKind: "channel_pointer",
        relayChannel: "dm",
        relayTarget: "agent-1",
        relayTargetIds: ["agent-1"],
        relayMessageId: "msg-2",
        channelPointer: expect.objectContaining({
          channel: "xterm-super-component",
          conversationId: "channel.xterm-super-component",
          messageId: "msg-1",
          intent: "consult",
          targetAgentId: "agent-1",
        }),
        returnAddress: expect.objectContaining({
          conversationId: "channel.xterm-super-component",
          replyToMessageId: "msg-1",
        }),
      }),
    }));
    expect(pointer!.body).toContain("Reply in #xterm-super-component.");
    expect(pointer!.body).not.toContain("please take pass 2");

    expect(harness.acceptedInvocations).toHaveLength(1);
    expect(harness.acceptedInvocations[0]).toEqual(expect.objectContaining({
      conversationId: "channel.xterm-super-component",
      messageId: "msg-1",
      task: "@agent-one please take pass 2",
      metadata: expect.objectContaining({
        relayChannel: "xterm-super-component",
        relayTarget: "agent-1",
        returnAddress: expect.objectContaining({
          conversationId: "channel.xterm-super-component",
          replyToMessageId: "msg-1",
        }),
      }),
    }));
  });

  test("unresolved targets record a dispatch and operator issue", async () => {
    const harness = createHarness({
      resolution: { kind: "unknown", label: "@missing" },
      now: 30_000,
    });

    const result = await harness.service.accept({
      id: "deliver-3",
      body: "hello?",
      intent: "consult",
      targetLabel: "@missing",
      caller: { actorId: "remote-agent", nodeId: "node-remote" },
    });

    expect(result).toEqual(expect.objectContaining({
      kind: "rejected",
      accepted: false,
      reason: "unknown_target",
      rejection: expect.objectContaining({
        id: "dispatch-1",
        kind: "unknown",
        askedLabel: "@missing",
        requesterId: "remote-agent",
      }),
    }));
    expect(harness.recordedDispatches).toEqual([
      expect.objectContaining({
        envelope: expect.objectContaining({
          kind: "unknown",
          askedLabel: "@missing",
        }),
        requesterId: "remote-agent",
      }),
    ]);
    expect(harness.operatorIssues).toEqual([
      expect.objectContaining({
        kind: "rejected",
        requestId: "deliver-3",
        requesterId: "remote-agent",
        requesterNodeId: "node-remote",
        targetLabel: "@missing",
      }),
    ]);
    expect(harness.postedMessages).toEqual([]);
    expect(harness.acceptedInvocations).toEqual([]);
  });
});
