import {
  SCOUT_DISPATCHER_AGENT_ID,
  type AgentDefinition,
  type AgentEndpoint,
  type ConversationDefinition,
  type FlightRecord,
  type InvocationRequest,
  type MessageAttachment,
  type MessageRecord,
  type ScoutDeliverRequest,
  type ScoutDeliverResponse,
  type ScoutDeliverRouteKind,
  type ScoutDispatchEnvelope,
  type ScoutDispatchRecord,
  type ScoutDispatchUnavailableTarget,
  type ScoutReturnAddress,
} from "@openscout/protocol";

import {
  buildDeliveryReceipt,
  callerContextForDelivery,
  executionWithRouteParams,
  normalizeScoutLabels,
  projectPathRouteTarget,
  remediationForDispatch,
  type InvocationResolution,
} from "./broker-delivery-routing.js";
import type { DeliveryWorkItemResolution } from "./broker-work-item-store.js";
import {
  askedLabelForRouteTarget,
  buildDispatchEnvelope,
  routeChannelForTarget,
  type BrokerRouteTargetInput,
  type RuntimeSnapshot,
} from "./scout-dispatcher.js";
import { describeUnavailableSessionEndpoint } from "./broker-endpoint-selection.js";
import { sessionActorAlias } from "./session-alias.js";

type EnsureBrokerDeliveryConversationInput = {
  requesterId: string;
  targetAgentId?: string;
  channel?: string;
};

type OperatorDeliveryIssueKind = "unassigned_scout" | "rejected" | "unavailable";

type OperatorDeliveryIssueInput = {
  kind: OperatorDeliveryIssueKind;
  requestId: string;
  requesterId: string;
  requesterNodeId: string;
  targetLabel: string;
  detail: string;
};

export type BrokerDeliveryAcceptanceServiceOptions = {
  nodeId: string;
  operatorActorId: string;
  runtimeSnapshot: () => RuntimeSnapshot;
  createId: (prefix: string) => string;
  syncRegisteredLocalAgentsIfChanged: (reason: string) => Promise<void>;
  metadataStringValue: (metadata: Record<string, unknown> | undefined, key: string) => string | null;
  messageRefCandidateForRouteTarget: (payload: BrokerRouteTargetInput) => string | null;
  resolveBrokerMessageRef: (snapshot: RuntimeSnapshot, ref: string) => MessageRecord | null;
  ensureBrokerActorForDelivery: (actorId: string) => Promise<void>;
  ensureBrokerDeliveryConversation: (
    input: EnsureBrokerDeliveryConversationInput,
  ) => Promise<ConversationDefinition>;
  brokerRouteKind: (
    conversation: Pick<ConversationDefinition, "id" | "kind" | "metadata">,
  ) => ScoutDeliverRouteKind;
  messageVisibilityForConversation: (
    conversation?: ConversationDefinition,
  ) => MessageRecord["visibility"];
  brokerActorDisplayName: (snapshot: RuntimeSnapshot, actorId: string) => string;
  brokerTargetLabel: (agent: AgentDefinition) => string;
  homeEndpointForAgent: (snapshot: RuntimeSnapshot, agentId: string) => AgentEndpoint | null;
  titleCaseName: (value: string) => string;
  buildBrokerReturnAddressForActor: (
    snapshot: RuntimeSnapshot,
    actorId: string,
    options?: {
      conversationId?: string;
      replyToMessageId?: string;
      sessionId?: string;
    },
  ) => ScoutReturnAddress;
  isOperatorDeliveryTarget: (payload: BrokerRouteTargetInput) => boolean;
  isLocalScoutProductTarget: (payload: BrokerRouteTargetInput) => boolean;
  onlineConversationNotifyTargets: (
    conversation: ConversationDefinition,
    requesterId: string,
  ) => string[];
  resolveBrokerDeliveryTargetWithImplicitProjectAgent: (
    input: BrokerRouteTargetInput & {
      execution?: InvocationRequest["execution"];
      projectAgent?: ScoutDeliverRequest["projectAgent"];
    },
    options: {
      requesterId?: string;
      currentDirectory?: string;
      reason: string;
    },
  ) => Promise<InvocationResolution>;
  createCardlessProjectSession?: (input: {
    projectPath: string;
    execution?: InvocationRequest["execution"];
    projectAgent?: ScoutDeliverRequest["projectAgent"];
    requesterId: string;
    createdAt: number;
  }) => Promise<Extract<InvocationResolution, { kind: "resolved_session" }>>;
  recordScoutDispatch: (
    envelope: ScoutDispatchEnvelope,
    options?: {
      invocationId?: string;
      conversationId?: string;
      requesterId?: string;
    },
  ) => Promise<{ record: ScoutDispatchRecord }>;
  describeUnavailableDeliveryTarget: (
    snapshot: RuntimeSnapshot,
    agent: AgentDefinition,
    targetSessionId?: string,
  ) => ScoutDispatchUnavailableTarget | null;
  buildUnavailableDispatchEnvelope: (
    askedLabel: string,
    unavailable: ScoutDispatchUnavailableTarget,
  ) => ScoutDispatchEnvelope;
  recordDeliveryWorkItemIfNeeded: (input: {
    payload: ScoutDeliverRequest;
    requestId: string;
    requesterId: string;
    targetAgentId: string;
    conversationId: string;
    createdAt: number;
  }) => Promise<DeliveryWorkItemResolution>;
  deliveryWorkItemResolutionForTell: (payload: ScoutDeliverRequest) => DeliveryWorkItemResolution;
  postConversationMessage: (message: MessageRecord) => Promise<unknown>;
  acceptInvocation: (invocation: InvocationRequest) => Promise<FlightRecord>;
  dispatchAcceptedInvocation: (invocation: InvocationRequest) => Promise<void>;
  queueOperatorDeliveryIssue: (input: OperatorDeliveryIssueInput) => void;
  warn?: (message: string, detail?: unknown) => void;
  now?: () => number;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }
}

function normalizeDeliveryAttachments(
  attachments: ScoutDeliverRequest["attachments"],
  createId: (prefix: string) => string,
): MessageAttachment[] | undefined {
  if (!attachments?.length) {
    return undefined;
  }
  const normalized: MessageAttachment[] = [];
  for (const attachment of attachments) {
    const mediaType = attachment?.mediaType?.trim();
    const url = attachment?.url?.trim();
    const blobKey = attachment?.blobKey?.trim();
    if (!mediaType || (!url && !blobKey)) {
      continue;
    }
    normalized.push({
      id: attachment.id?.trim() || createId("att"),
      mediaType,
      fileName: attachment.fileName?.trim() || undefined,
      url: url || undefined,
      blobKey: blobKey || undefined,
      metadata: attachment.metadata,
    });
  }
  return normalized.length > 0 ? normalized : undefined;
}

export class BrokerDeliveryAcceptanceService {
  constructor(private readonly options: BrokerDeliveryAcceptanceServiceOptions) {}

  async accept(
    payload: ScoutDeliverRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<ScoutDeliverResponse> {
    throwIfAborted(options.signal);
    await this.options.syncRegisteredLocalAgentsIfChanged("delivery");
    throwIfAborted(options.signal);
    const requestId = payload.id?.trim() || this.options.createId("deliver");
    const createdAt = typeof payload.createdAt === "number" && Number.isFinite(payload.createdAt)
      ? payload.createdAt
      : this.now();
    const { requesterId, requesterNodeId } = callerContextForDelivery(payload, {
      operatorActorId: this.options.operatorActorId,
      nodeId: this.options.nodeId,
    });
    const askedLabel = askedLabelForRouteTarget(payload);
    const execution = executionWithRouteParams(payload);
    const deliveryChannel = routeChannelForTarget(payload) ?? payload.channel?.trim();
    const attachments = normalizeDeliveryAttachments(payload.attachments, this.options.createId);
    const targetSessionId =
      payload.target?.kind === "session_id"
        ? payload.target.sessionId.trim()
        : payload.targetSessionId?.trim()
        || payload.execution?.targetSessionId?.trim()
        || this.options.metadataStringValue(payload.invocationMetadata, "targetSessionId")
        || this.options.metadataStringValue(payload.messageMetadata, "targetSessionId")
        || undefined;
    const replyToSessionId =
      payload.replyToSessionId?.trim()
      || this.options.metadataStringValue(payload.invocationMetadata, "replyToSessionId")
      || this.options.metadataStringValue(payload.messageMetadata, "replyToSessionId")
      || undefined;
    const labels = normalizeScoutLabels(payload.labels);
    const typedChannelTarget = payload.target?.kind === "channel" || payload.target?.kind === "broadcast";
    const hasAgentTarget = Boolean(
      payload.target?.kind === "agent_id"
        || payload.target?.kind === "agent_label"
        || payload.target?.kind === "session_id"
        || payload.target?.kind === "project_path",
    ) || (!payload.target && Boolean(payload.targetSessionId?.trim() || payload.targetAgentId?.trim() || payload.targetLabel?.trim()));

    const messageRef = this.options.messageRefCandidateForRouteTarget(payload);
    const replyTarget = messageRef
      ? this.options.resolveBrokerMessageRef(this.options.runtimeSnapshot(), messageRef)
      : null;
    throwIfAborted(options.signal);
    if (replyTarget) {
      await this.options.ensureBrokerActorForDelivery(requesterId);
      await this.options.ensureBrokerActorForDelivery(replyTarget.actorId);
      const snapshot = this.options.runtimeSnapshot();
      const conversation = snapshot.conversations[replyTarget.conversationId];
      if (conversation) {
        const messageId = this.options.createId("msg");
        const routeKind = this.options.brokerRouteKind(conversation);
        const notifyTargets = replyTarget.actorId !== requesterId ? [replyTarget.actorId] : [];
        const message: MessageRecord = {
          id: messageId,
          conversationId: conversation.id,
          actorId: requesterId,
          originNodeId: requesterNodeId,
          class: conversation.kind === "system" ? "system" : "agent",
          body: payload.body.trim(),
      ...(attachments ? { attachments } : {}),
          replyToMessageId: replyTarget.id,
          ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
          audience: {
            reason: "thread_reply",
            ...(notifyTargets.length > 0 ? { notify: notifyTargets } : {}),
          },
          visibility: this.options.messageVisibilityForConversation(conversation),
          policy: "durable",
          createdAt,
          metadata: {
            ...(payload.messageMetadata ?? {}),
            ...(labels.length ? { labels } : {}),
            relayChannel: conversation.kind === "direct" ? "dm" : conversation.id.replace(/^channel\./, ""),
            relayMessageId: messageId,
            relayTarget: replyTarget.actorId,
            relayTargetIds: notifyTargets,
            returnAddress: this.options.buildBrokerReturnAddressForActor(snapshot, requesterId, {
              conversationId: conversation.id,
              replyToMessageId: messageId,
              sessionId: replyToSessionId,
            }),
          },
        };
        await this.options.postConversationMessage(message);
        throwIfAborted(options.signal);
        return {
          kind: "delivery",
          accepted: true,
          routeKind,
          receipt: buildDeliveryReceipt({
            requestId,
            routeKind,
            requesterId,
            requesterNodeId,
            targetLabel: `ref:${replyTarget.id}`,
            conversationId: conversation.id,
            messageId,
          }),
          conversation,
          message,
        };
      }
    }

    if (this.options.isOperatorDeliveryTarget(payload)) {
      await this.options.ensureBrokerActorForDelivery(requesterId);
      await this.options.ensureBrokerActorForDelivery(this.options.operatorActorId);
      const conversation = await this.options.ensureBrokerDeliveryConversation({
        requesterId,
        targetAgentId: this.options.operatorActorId,
        channel: deliveryChannel,
      });
      const snapshot = this.options.runtimeSnapshot();
      const messageId = this.options.createId("msg");
      const routeKind = this.options.brokerRouteKind(conversation);
      const notifyTargets = requesterId !== this.options.operatorActorId ? [this.options.operatorActorId] : [];
      const message: MessageRecord = {
        id: messageId,
        conversationId: conversation.id,
        actorId: requesterId,
        originNodeId: requesterNodeId,
        class: conversation.kind === "system" ? "system" : "agent",
        body: payload.body.trim(),
      ...(attachments ? { attachments } : {}),
        ...(payload.replyToMessageId?.trim() ? { replyToMessageId: payload.replyToMessageId.trim() } : {}),
        mentions: [{ actorId: this.options.operatorActorId, label: "@operator" }],
        ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
        audience: {
          reason: conversation.kind === "direct" ? "direct_message" : "mention",
          ...(notifyTargets.length > 0 ? { notify: notifyTargets } : {}),
        },
        visibility: this.options.messageVisibilityForConversation(conversation),
        policy: "durable",
        createdAt,
        metadata: {
          ...(payload.messageMetadata ?? {}),
          ...(labels.length ? { labels } : {}),
          relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
          relayTarget: this.options.operatorActorId,
          relayTargetIds: notifyTargets,
          relayMessageId: messageId,
          returnAddress: this.options.buildBrokerReturnAddressForActor(snapshot, requesterId, {
            conversationId: conversation.id,
            replyToMessageId: messageId,
            sessionId: replyToSessionId,
          }),
        },
      };
      await this.options.postConversationMessage(message);
      throwIfAborted(options.signal);
      return {
        kind: "delivery",
        accepted: true,
        routeKind,
        receipt: buildDeliveryReceipt({
          requestId,
          routeKind,
          requesterId,
          requesterNodeId,
          targetAgentId: this.options.operatorActorId,
          targetLabel: "@operator",
          conversationId: conversation.id,
          messageId,
        }),
        conversation,
        message,
        targetAgentId: this.options.operatorActorId,
      };
    }

    if (this.options.isLocalScoutProductTarget(payload)) {
      await this.options.ensureBrokerActorForDelivery(requesterId);
      await this.options.ensureBrokerActorForDelivery(SCOUT_DISPATCHER_AGENT_ID);
      const conversation = await this.options.ensureBrokerDeliveryConversation({
        requesterId,
        targetAgentId: SCOUT_DISPATCHER_AGENT_ID,
        channel: deliveryChannel,
      });
      const snapshot = this.options.runtimeSnapshot();
      const messageId = this.options.createId("msg");
      const routeKind = this.options.brokerRouteKind(conversation);
      const message: MessageRecord = {
        id: messageId,
        conversationId: conversation.id,
        actorId: requesterId,
        originNodeId: requesterNodeId,
        class: conversation.kind === "system" ? "system" : "agent",
        body: payload.body.trim(),
      ...(attachments ? { attachments } : {}),
        ...(payload.replyToMessageId?.trim() ? { replyToMessageId: payload.replyToMessageId.trim() } : {}),
        mentions: [{ actorId: SCOUT_DISPATCHER_AGENT_ID, label: "@scout" }],
        ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
        audience: {
          notify: [],
          reason: conversation.kind === "direct" ? "direct_message" : "mention",
        },
        visibility: this.options.messageVisibilityForConversation(conversation),
        policy: "durable",
        createdAt,
        metadata: {
          ...(payload.messageMetadata ?? {}),
          ...(labels.length ? { labels } : {}),
          relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
          relayTarget: SCOUT_DISPATCHER_AGENT_ID,
          relayTargetIds: [SCOUT_DISPATCHER_AGENT_ID],
          relayMessageId: messageId,
          returnAddress: this.options.buildBrokerReturnAddressForActor(snapshot, requesterId, {
            conversationId: conversation.id,
            replyToMessageId: messageId,
            sessionId: replyToSessionId,
          }),
        },
      };
      await this.options.postConversationMessage(message);
      throwIfAborted(options.signal);
      this.options.queueOperatorDeliveryIssue({
        kind: "unassigned_scout",
        requestId,
        requesterId,
        requesterNodeId,
        targetLabel: askedLabel || "Scout",
        detail: `${this.options.titleCaseName(requesterId)} sent a request to Scout, but no operator session accepted it.`,
      });
      return {
        kind: "delivery",
        accepted: true,
        routeKind,
        receipt: buildDeliveryReceipt({
          requestId,
          routeKind,
          requesterId,
          requesterNodeId,
          targetAgentId: SCOUT_DISPATCHER_AGENT_ID,
          targetLabel: "Scout",
          conversationId: conversation.id,
          messageId,
        }),
        conversation,
        message,
        targetAgentId: SCOUT_DISPATCHER_AGENT_ID,
      };
    }

    if (deliveryChannel && (typedChannelTarget || !hasAgentTarget) && payload.intent === "tell") {
      await this.options.ensureBrokerActorForDelivery(requesterId);
      const conversation = await this.options.ensureBrokerDeliveryConversation({
        requesterId,
        channel: deliveryChannel,
      });
      const snapshot = this.options.runtimeSnapshot();
      const messageId = this.options.createId("msg");
      const routeKind = this.options.brokerRouteKind(conversation);
      const notifyTargets = conversation.kind === "direct"
        ? []
        : this.options.onlineConversationNotifyTargets(conversation, requesterId);
      const message: MessageRecord = {
        id: messageId,
        conversationId: conversation.id,
        actorId: requesterId,
        originNodeId: requesterNodeId,
        class: conversation.kind === "system" ? "system" : "agent",
        body: payload.body.trim(),
      ...(attachments ? { attachments } : {}),
        ...(payload.replyToMessageId?.trim() ? { replyToMessageId: payload.replyToMessageId.trim() } : {}),
        ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
        audience: {
          reason: conversation.kind === "direct" ? "direct_message" : "conversation_visibility",
          ...(notifyTargets.length > 0 ? { notify: notifyTargets } : {}),
        },
        visibility: this.options.messageVisibilityForConversation(conversation),
        policy: "durable",
        createdAt,
        metadata: {
          ...(payload.messageMetadata ?? {}),
          ...(labels.length ? { labels } : {}),
          relayChannel: deliveryChannel,
          relayMessageId: messageId,
          returnAddress: this.options.buildBrokerReturnAddressForActor(snapshot, requesterId, {
            conversationId: conversation.id,
            replyToMessageId: messageId,
            sessionId: replyToSessionId,
          }),
        },
      };
      await this.options.postConversationMessage(message);
      throwIfAborted(options.signal);
      return {
        kind: "delivery",
        accepted: true,
        routeKind,
        receipt: buildDeliveryReceipt({
          requestId,
          routeKind,
          requesterId,
          requesterNodeId,
          targetLabel: deliveryChannel,
          conversationId: conversation.id,
          messageId,
        }),
        conversation,
        message,
      };
    }

    const projectPath = projectPathRouteTarget(payload);
    const shouldCreateCardlessProjectSession =
      Boolean(projectPath)
      && payload.intent === "consult"
      && !targetSessionId
      && (execution?.session ?? "new") === "new"
      && Boolean(this.options.createCardlessProjectSession);
    const resolved = shouldCreateCardlessProjectSession
      ? await this.options.createCardlessProjectSession!({
          projectPath: projectPath!,
          execution,
          projectAgent: payload.projectAgent,
          requesterId,
          createdAt,
        })
      : await this.options.resolveBrokerDeliveryTargetWithImplicitProjectAgent({
          ...payload,
          execution,
        }, {
          requesterId,
          currentDirectory: projectPath,
          reason: "project delivery target",
        });
    throwIfAborted(options.signal);

    if (resolved.kind !== "resolved" && resolved.kind !== "resolved_session") {
      const { record } = await this.options.recordScoutDispatch(
        buildDispatchEnvelope(
          resolved,
          askedLabel,
          this.options.nodeId,
          this.options.runtimeSnapshot(),
          { homeEndpointFor: this.options.homeEndpointForAgent },
        ),
        {
          requesterId,
        },
      );
      throwIfAborted(options.signal);
      this.options.queueOperatorDeliveryIssue({
        kind: "rejected",
        requestId,
        requesterId,
        requesterNodeId,
        targetLabel: askedLabel || "Scout",
        detail: `Scout could not route ${askedLabel || "the requested target"} from ${this.options.titleCaseName(requesterId)}: ${record.detail}`,
      });
      return {
        kind: "rejected",
        accepted: false,
        reason: resolved.kind === "ambiguous"
          ? "ambiguous_target"
          : resolved.kind === "unknown"
          ? "unknown_target"
          : askedLabel.trim().length > 0
          ? "invalid_target"
          : "missing_target",
        rejection: record,
        remediation: remediationForDispatch(record),
      };
    }

    // SCO-070: a cardless session resolves to an endpoint, not an agent card.
    // Read identity/label off `target`; branch availability on endpoint state.
    const target = resolved.kind === "resolved"
      ? {
          actorId: resolved.agent.id,
          label: this.options.brokerTargetLabel(resolved.agent),
          endpoint: undefined as AgentEndpoint | undefined,
        }
      : {
          actorId: resolved.session.actorId,
          label: resolved.session.label,
          endpoint: resolved.session.endpoint as AgentEndpoint | undefined,
        };
    const receiptSessionId = targetSessionId
      ?? (resolved.kind === "resolved_session" ? resolved.session.sessionId : undefined);

    const unavailable = resolved.kind === "resolved"
      ? this.options.describeUnavailableDeliveryTarget(
          this.options.runtimeSnapshot(),
          resolved.agent,
          targetSessionId,
        )
      : describeUnavailableSessionEndpoint(resolved.session.endpoint);
    if (unavailable) {
      const targetLabel = askedLabel || target.label;
      const { record } = await this.options.recordScoutDispatch(
        this.options.buildUnavailableDispatchEnvelope(targetLabel, unavailable),
        {
          requesterId,
        },
      );
      throwIfAborted(options.signal);
      this.options.queueOperatorDeliveryIssue({
        kind: "unavailable",
        requestId,
        requesterId,
        requesterNodeId,
        targetLabel,
        detail: `Scout could not reach ${targetLabel} for ${this.options.titleCaseName(requesterId)}: ${record.detail}`,
      });
      return {
        kind: "question",
        accepted: false,
        question: record,
        remediation: remediationForDispatch(record),
      };
    }

    await this.options.ensureBrokerActorForDelivery(requesterId);
    const conversation = await this.options.ensureBrokerDeliveryConversation({
      requesterId,
      targetAgentId: target.actorId,
      channel: deliveryChannel,
    });
    const workResolution = payload.intent === "consult"
      ? await this.options.recordDeliveryWorkItemIfNeeded({
          payload,
          requestId,
          requesterId,
          targetAgentId: target.actorId,
          conversationId: conversation.id,
          createdAt,
        })
      : this.options.deliveryWorkItemResolutionForTell(payload);
    throwIfAborted(options.signal);
    const workRecord = workResolution.record;
    const collaborationRecordId = workResolution.collaborationRecordId;
    const snapshot = this.options.runtimeSnapshot();
    const messageId = this.options.createId("msg");
    const targetLabel = target.label;
    const routeKind = this.options.brokerRouteKind(conversation);
    const message: MessageRecord = {
      id: messageId,
      conversationId: conversation.id,
      actorId: requesterId,
      originNodeId: requesterNodeId,
      class: conversation.kind === "system" ? "system" : "agent",
      body: payload.body.trim(),
      ...(attachments ? { attachments } : {}),
      ...(payload.replyToMessageId?.trim() ? { replyToMessageId: payload.replyToMessageId.trim() } : {}),
      mentions: [{ actorId: target.actorId, label: targetLabel }],
      ...(payload.speechText?.trim() ? { speech: { text: payload.speechText.trim() } } : {}),
      audience: {
        notify: [target.actorId],
        reason: conversation.kind === "direct" ? "direct_message" : "mention",
      },
      visibility: this.options.messageVisibilityForConversation(conversation),
      policy: "durable",
      createdAt,
      metadata: {
        ...(payload.messageMetadata ?? {}),
        ...(labels.length ? { labels } : {}),
        ...(targetSessionId ? { targetSessionId } : {}),
        requesterDisplayName: this.options.brokerActorDisplayName(snapshot, requesterId),
        targetDisplayName: this.options.brokerActorDisplayName(snapshot, target.actorId),
        relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
        relayTarget: target.actorId,
        relayTargetIds: [target.actorId],
        relayMessageId: messageId,
        ...(collaborationRecordId ? { collaborationRecordId, workId: collaborationRecordId } : {}),
        returnAddress: this.options.buildBrokerReturnAddressForActor(snapshot, requesterId, {
          conversationId: conversation.id,
          replyToMessageId: messageId,
          sessionId: replyToSessionId,
        }),
      },
    };
    await this.options.postConversationMessage(message);
    throwIfAborted(options.signal);

    const shouldDispatchTargetTurn =
      payload.intent === "consult"
      || (payload.intent === "tell"
        && conversation.kind === "direct"
        && payload.ensureAwake !== false);

    if (!shouldDispatchTargetTurn) {
      const receipt = buildDeliveryReceipt({
        requestId,
        routeKind,
        requesterId,
        requesterNodeId,
        targetAgentId: target.actorId,
        targetSessionId: receiptSessionId,
        targetLabel,
        conversationId: conversation.id,
        messageId,
      });
      return {
        kind: "delivery",
        accepted: true,
        routeKind,
        receipt,
        conversation,
        message,
        targetAgentId: target.actorId,
        ...(receiptSessionId ? { targetSessionId: receiptSessionId } : {}),
        ...(workRecord?.kind === "work_item" ? { workItem: workRecord } : {}),
      };
    }

    const invocationMetadata = {
      ...(typeof payload.messageMetadata?.source === "string" && payload.invocationMetadata?.source === undefined
        ? { source: payload.messageMetadata.source }
        : {}),
      ...(payload.invocationMetadata ?? {}),
      ...(targetSessionId ? { targetSessionId } : {}),
      ...(payload.intent === "tell" && payload.invocationMetadata?.sourceIntent === undefined
        ? { sourceIntent: "direct_message" }
        : {}),
    };
    const baseInvocationExecution = execution ?? {};
    const invocationExecution = {
      ...baseInvocationExecution,
      session: targetSessionId ? "existing" as const : "new" as const,
      ...(targetSessionId ? { targetSessionId } : {}),
    };
    const invocation: InvocationRequest = {
      id: this.options.createId("inv"),
      requesterId,
      requesterNodeId,
      targetAgentId: target.actorId,
      action: payload.intent === "tell" ? "wake" : "consult",
      task: payload.body.trim(),
      ...(collaborationRecordId ? { collaborationRecordId } : {}),
      conversationId: conversation.id,
      messageId,
      ...(Object.keys(invocationExecution).length > 0 ? { execution: invocationExecution } : {}),
      ensureAwake: payload.ensureAwake ?? true,
      stream: false,
      createdAt,
      ...(labels.length ? { labels } : {}),
      metadata: {
        ...invocationMetadata,
        ...(labels.length ? { labels } : {}),
        ...(targetSessionId ? { targetSessionId } : {}),
        requesterDisplayName: this.options.brokerActorDisplayName(snapshot, requesterId),
        targetDisplayName: this.options.brokerActorDisplayName(snapshot, target.actorId),
        relayChannel: deliveryChannel || (conversation.kind === "direct" ? "dm" : "shared"),
        relayTarget: target.actorId,
        ...(collaborationRecordId ? { collaborationRecordId, workId: collaborationRecordId } : {}),
        returnAddress: this.options.buildBrokerReturnAddressForActor(snapshot, requesterId, {
          conversationId: conversation.id,
          replyToMessageId: messageId,
          sessionId: replyToSessionId,
        }),
      },
    };
    const flight = await this.options.acceptInvocation(invocation);
    throwIfAborted(options.signal);
    const bindingRef = flight.id.slice(-8);
    const sessionAlias = sessionActorAlias(snapshot, target.actorId) ?? undefined;
    this.options.dispatchAcceptedInvocation(invocation).catch((error) => {
      this.options.warn?.(`[openscout-runtime] background dispatch failed for invocation ${invocation.id}:`, error);
    });
    return {
      kind: "delivery",
      accepted: true,
      routeKind,
      receipt: buildDeliveryReceipt({
        requestId,
        routeKind,
        requesterId,
        requesterNodeId,
        targetAgentId: target.actorId,
        targetSessionId: receiptSessionId,
        targetLabel,
        sessionAlias,
        bindingRef,
        conversationId: conversation.id,
        messageId,
        flightId: flight.id,
      }),
      conversation,
      message,
      targetAgentId: target.actorId,
      ...(receiptSessionId ? { targetSessionId: receiptSessionId } : {}),
      ...(sessionAlias ? { sessionAlias } : {}),
      bindingRef,
      flight,
      ...(workRecord?.kind === "work_item" ? { workItem: workRecord } : {}),
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
