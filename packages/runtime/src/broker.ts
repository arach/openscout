import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  CollaborationEvent,
  CollaborationRecord,
  ControlCommand,
  ControlEvent,
  ConversationBinding,
  ConversationDefinition,
  DeliveryIntent,
  DeliveryTargetKind,
  DeliveryTransport,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
  NodeDefinition,
  ScoutId,
} from "@openscout/protocol";
import {
  assertValidCollaborationEvent,
  assertValidCollaborationRecord,
} from "@openscout/protocol";

import { planMessageDeliveries, type DeliveryRoute } from "./planner.js";
import {
  createRuntimeRegistrySnapshot,
  type RuntimeRegistrySnapshot,
} from "./registry.js";
import type { ControlRuntime } from "./service.js";

function createRuntimeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toTargetKind(actor?: ActorIdentity): DeliveryTargetKind {
  if (!actor) return "participant";
  if (actor.kind === "agent") return "agent";
  if (actor.kind === "device") return "device";
  if (actor.kind === "bridge") return "bridge";
  return "participant";
}

function defaultTransportForActor(actor?: ActorIdentity): DeliveryTransport {
  if (!actor) return "local_socket";

  switch (actor.kind) {
    case "bridge":
      return "webhook";
    case "device":
      return "local_socket";
    case "agent":
      return "local_socket";
    default:
      return "local_socket";
  }
}

function resolveParticipantRoutes(
  registry: RuntimeRegistrySnapshot,
  participantIds: ScoutId[],
  localNodeId?: ScoutId,
): DeliveryRoute[] {
  const routes: DeliveryRoute[] = [];

  for (const participantId of participantIds) {
    const actor = registry.actors[participantId];
    const agent = registry.agents[participantId];
    const targetIdentity = actor ?? agent;
    const endpoints = Object.values(registry.endpoints).filter((endpoint) => (
      endpoint.agentId === participantId && endpoint.state !== "offline"
    ));
    const endpoint = endpoints.sort((lhs, rhs) => {
      const lhsRank = lhs.transport === "codex_app_server"
        ? 0
        : lhs.transport === "claude_stream_json"
          ? 1
          : lhs.transport === "tmux"
            ? 2
            : lhs.transport === "local_socket"
              ? 3
              : 4;
      const rhsRank = rhs.transport === "codex_app_server"
        ? 0
        : rhs.transport === "claude_stream_json"
          ? 1
          : rhs.transport === "tmux"
            ? 2
            : rhs.transport === "local_socket"
              ? 3
              : 4;
      return lhsRank - rhsRank;
    })[0];

    if (!endpoint) {
      if (agent?.authorityNodeId && agent.authorityNodeId !== localNodeId) {
        routes.push({
          targetId: participantId,
          nodeId: agent.authorityNodeId,
          targetKind: toTargetKind(targetIdentity),
          transport: defaultTransportForActor(targetIdentity),
          speechEnabled: false,
        });
      } else if (agent) {
        routes.push({
          targetId: participantId,
          nodeId: agent.authorityNodeId ?? localNodeId,
          targetKind: toTargetKind(targetIdentity),
          transport: defaultTransportForActor(targetIdentity),
          speechEnabled: false,
        });
      }

      continue;
    }

    routes.push({
      targetId: participantId,
      nodeId: endpoint?.nodeId ?? agent?.authorityNodeId,
      targetKind: toTargetKind(targetIdentity),
      transport: endpoint?.transport ?? defaultTransportForActor(targetIdentity),
      speechEnabled: Boolean(
        actor?.kind === "device" ||
        endpoints.some((candidate) => candidate.transport === "local_socket" || candidate.transport === "websocket"),
      ),
    });
  }

  return routes;
}

function shouldBridgeMessageToBinding(
  binding: ConversationBinding,
  message: MessageRecord,
): boolean {
  if (binding.platform !== "telegram") {
    return true;
  }

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
    : "operator";
  const allowedActorIds = Array.isArray(binding.metadata?.allowedActorIds)
    ? binding.metadata.allowedActorIds.map((entry) => String(entry).trim()).filter(Boolean)
    : [];

  if (outboundMode === "all") {
    return true;
  }

  if (outboundMode === "allowlist") {
    return allowedActorIds.includes(message.actorId);
  }

  return message.actorId === operatorId;
}

function resolveBindingRoutes(
  bindings: ConversationBinding[],
  message: MessageRecord,
): DeliveryRoute[] {
  return bindings
    .filter((binding) => shouldBridgeMessageToBinding(binding, message))
    .map((binding) => ({
    targetId: binding.id,
    targetKind: "bridge",
    transport: binding.platform === "telegram"
      ? "telegram"
      : binding.platform === "discord"
        ? "discord"
        : "webhook",
    bindingId: binding.id,
    }));
}

function activeEndpointsForAgent(
  registry: RuntimeRegistrySnapshot,
  agentId: ScoutId,
  nodeId?: ScoutId,
  harness?: AgentEndpoint["harness"],
): AgentEndpoint[] {
  return Object.values(registry.endpoints).filter((endpoint) => {
    if (endpoint.agentId !== agentId) return false;
    if (endpoint.state === "offline") return false;
    if (nodeId && endpoint.nodeId !== nodeId) return false;
    if (harness && endpoint.harness !== harness) return false;
    return true;
  });
}

export class InMemoryControlRuntime implements ControlRuntime {
  private readonly registry: RuntimeRegistrySnapshot;

  private readonly listeners = new Set<(event: ControlEvent) => void>();

  private readonly eventBuffer: ControlEvent[] = [];

  private readonly localNodeId?: ScoutId;

  constructor(
    initial: Partial<RuntimeRegistrySnapshot> = {},
    options: { localNodeId?: ScoutId } = {},
  ) {
    this.registry = createRuntimeRegistrySnapshot(initial);
    this.localNodeId = options.localNodeId;
  }

  snapshot(): RuntimeRegistrySnapshot {
    return createRuntimeRegistrySnapshot({
      nodes: { ...this.registry.nodes },
      actors: { ...this.registry.actors },
      agents: { ...this.registry.agents },
      endpoints: { ...this.registry.endpoints },
      conversations: { ...this.registry.conversations },
      bindings: { ...this.registry.bindings },
      messages: { ...this.registry.messages },
      flights: { ...this.registry.flights },
      collaborationRecords: { ...this.registry.collaborationRecords },
    });
  }

  recentEvents(limit = 100): ControlEvent[] {
    return this.eventBuffer.slice(-limit);
  }

  subscribe(listener: (event: ControlEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispatch(command: ControlCommand): Promise<void> {
    switch (command.kind) {
      case "node.upsert":
        await this.upsertNode(command.node);
        return;
      case "actor.upsert":
        await this.upsertActor(command.actor);
        return;
      case "agent.upsert":
        await this.upsertAgent(command.agent);
        return;
      case "agent.endpoint.upsert":
        await this.upsertEndpoint(command.endpoint);
        return;
      case "conversation.upsert":
        await this.upsertConversation(command.conversation);
        return;
      case "binding.upsert":
        await this.upsertBinding(command.binding);
        return;
      case "collaboration.upsert":
        await this.upsertCollaboration(command.record);
        return;
      case "collaboration.event.append":
        await this.appendCollaborationEvent(command.event);
        return;
      case "conversation.post":
        await this.postMessage(command.message);
        return;
      case "agent.invoke":
        await this.invokeAgent(command.invocation);
        return;
      case "agent.ensure_awake":
        this.emit({
          id: createRuntimeId("evt"),
          kind: "flight.updated",
          ts: Date.now(),
          actorId: command.requesterId,
          nodeId: this.localNodeId,
          payload: {
            flight: {
              id: createRuntimeId("flt"),
              invocationId: command.agentId,
              requesterId: command.requesterId,
              targetAgentId: command.agentId,
              state: "waking",
              summary: command.reason,
            },
          },
        });
        return;
      case "stream.subscribe":
        return;
      default: {
        const exhaustive: never = command;
        return exhaustive;
      }
    }
  }

  async upsertNode(node: NodeDefinition): Promise<void> {
    this.registry.nodes[node.id] = node;
    this.emit({
      id: createRuntimeId("evt"),
      kind: "node.upserted",
      ts: Date.now(),
      actorId: node.id,
      nodeId: node.id,
      payload: { node },
    });
  }

  async upsertActor(actor: ActorIdentity): Promise<void> {
    this.registry.actors[actor.id] = {
      id: actor.id,
      kind: actor.kind,
      displayName: actor.displayName,
      handle: actor.handle,
      labels: actor.labels,
      metadata: actor.metadata,
    };
    this.emit({
      id: createRuntimeId("evt"),
      kind: "actor.registered",
      ts: Date.now(),
      actorId: actor.id,
      nodeId: this.localNodeId,
      payload: { actor },
    });
  }

  async upsertAgent(agent: AgentDefinition): Promise<void> {
    if (!this.registry.actors[agent.id]) {
      this.registry.actors[agent.id] = {
        id: agent.id,
        kind: agent.kind,
        displayName: agent.displayName,
        handle: agent.handle,
        labels: agent.labels,
        metadata: agent.metadata,
      };
    }
    this.registry.agents[agent.id] = agent;
    this.emit({
      id: createRuntimeId("evt"),
      kind: "agent.registered",
      ts: Date.now(),
      actorId: agent.id,
      nodeId: agent.authorityNodeId,
      payload: { agent },
    });
  }

  async upsertEndpoint(endpoint: AgentEndpoint): Promise<void> {
    this.registry.endpoints[endpoint.id] = endpoint;
    this.emit({
      id: createRuntimeId("evt"),
      kind: "agent.endpoint.upserted",
      ts: Date.now(),
      actorId: endpoint.agentId,
      nodeId: endpoint.nodeId,
      payload: { endpoint },
    });
  }

  async upsertConversation(conversation: ConversationDefinition): Promise<void> {
    this.registry.conversations[conversation.id] = conversation;
    this.emit({
      id: createRuntimeId("evt"),
      kind: "conversation.upserted",
      ts: Date.now(),
      actorId: "system",
      nodeId: conversation.authorityNodeId,
      payload: { conversation },
    });
  }

  async upsertBinding(binding: ConversationBinding): Promise<void> {
    this.registry.bindings[binding.id] = binding;
    this.emit({
      id: createRuntimeId("evt"),
      kind: "binding.upserted",
      ts: Date.now(),
      actorId: "system",
      nodeId: this.localNodeId,
      payload: { binding },
    });
  }

  async upsertCollaboration(record: CollaborationRecord): Promise<void> {
    assertValidCollaborationRecord(record);
    this.registry.collaborationRecords[record.id] = record;
    this.emit({
      id: createRuntimeId("evt"),
      kind: "collaboration.upserted",
      ts: Date.now(),
      actorId: record.createdById,
      nodeId: this.localNodeId,
      payload: { record },
    });
  }

  async appendCollaborationEvent(event: CollaborationEvent): Promise<void> {
    const record = this.registry.collaborationRecords[event.recordId];
    if (!record) {
      throw new Error(`unknown collaboration record: ${event.recordId}`);
    }

    assertValidCollaborationEvent(event, record);
    this.emit({
      id: createRuntimeId("evt"),
      kind: "collaboration.event.appended",
      ts: Date.now(),
      actorId: event.actorId,
      nodeId: this.localNodeId,
      payload: { event },
    });
  }

  async upsertFlight(flight: FlightRecord): Promise<void> {
    this.registry.flights[flight.id] = flight;
    this.emit({
      id: createRuntimeId("evt"),
      kind: "flight.updated",
      ts: Date.now(),
      actorId: flight.requesterId,
      nodeId: this.localNodeId,
      payload: { flight },
    });
  }

  async postMessage(
    message: MessageRecord,
    options: { localOnly?: boolean } = {},
  ): Promise<DeliveryIntent[]> {
    const conversation = this.registry.conversations[message.conversationId];
    if (!conversation) {
      throw new Error(`unknown conversation: ${message.conversationId}`);
    }

    this.registry.messages[message.id] = message;

    const bindingRoutes = resolveBindingRoutes(
      Object.values(this.registry.bindings).filter((binding) => binding.conversationId === conversation.id),
      message,
    );
    const participantRoutes = options.localOnly
      ? resolveParticipantRoutes(this.registry, conversation.participantIds, this.localNodeId)
        .filter((route) => !route.nodeId || route.nodeId === this.localNodeId)
      : resolveParticipantRoutes(this.registry, conversation.participantIds, this.localNodeId);
    const deliveries = planMessageDeliveries({
      localNodeId: this.localNodeId,
      message,
      conversation,
      participantRoutes,
      bindingRoutes: options.localOnly ? [] : bindingRoutes,
    });

    this.emit({
      id: createRuntimeId("evt"),
      kind: "message.posted",
      ts: Date.now(),
      actorId: message.actorId,
      nodeId: message.originNodeId,
      payload: { message },
    });

    for (const delivery of deliveries) {
      this.emit({
        id: createRuntimeId("evt"),
        kind: "delivery.planned",
        ts: Date.now(),
        actorId: message.actorId,
        nodeId: message.originNodeId,
        payload: { delivery },
      });
    }

    return deliveries;
  }

  async invokeAgent(invocation: InvocationRequest): Promise<FlightRecord> {
    const targetAgent = this.registry.agents[invocation.targetAgentId];
    if (!targetAgent) {
      throw new Error(`unknown agent: ${invocation.targetAgentId}`);
    }

    const targetEndpoints = activeEndpointsForAgent(
      this.registry,
      invocation.targetAgentId,
      targetAgent.authorityNodeId,
      invocation.execution?.harness,
    );
    const isLocalAuthority = !this.localNodeId || targetAgent.authorityNodeId === this.localNodeId;
    const startedAt = Date.now();

    let state: FlightRecord["state"] = invocation.ensureAwake ? "waking" : "queued";
    let summary: string | undefined;
    let error: string | undefined;
    let completedAt: number | undefined;

    if (isLocalAuthority) {
      if (targetEndpoints.length == 0 && !invocation.ensureAwake) {
        state = "failed";
        summary = `${targetAgent.displayName} is not runnable yet.`;
        error = `No runnable endpoint is registered for agent ${targetAgent.id}. The broker can store the invocation, but nothing on this node can execute it yet.`;
        completedAt = startedAt;
      } else if (targetEndpoints.length == 0) {
        state = "waking";
        summary = invocation.execution?.harness
          ? `${targetAgent.displayName} waking on ${invocation.execution.harness}.`
          : `${targetAgent.displayName} waking.`;
      } else {
        state = "queued";
        summary = `${targetAgent.displayName} queued for local execution.`;
      }
    }

    const flight: FlightRecord = {
      id: createRuntimeId("flt"),
      invocationId: invocation.id,
      requesterId: invocation.requesterId,
      targetAgentId: invocation.targetAgentId,
      state,
      summary,
      error,
      startedAt,
      completedAt,
      metadata: invocation.metadata,
    };

    this.registry.flights[flight.id] = flight;

    this.emit({
      id: createRuntimeId("evt"),
      kind: "invocation.requested",
      ts: Date.now(),
      actorId: invocation.requesterId,
      nodeId: invocation.requesterNodeId,
      payload: { invocation },
    });

    this.emit({
      id: createRuntimeId("evt"),
      kind: "flight.updated",
      ts: Date.now(),
      actorId: invocation.requesterId,
      nodeId: targetAgent.authorityNodeId,
      payload: { flight },
    });

    return flight;
  }

  private emit(event: ControlEvent): void {
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > 500) {
      this.eventBuffer.shift();
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createInMemoryControlRuntime(
  initial: Partial<RuntimeRegistrySnapshot> = {},
  options: { localNodeId?: ScoutId } = {},
): InMemoryControlRuntime {
  return new InMemoryControlRuntime(initial, options);
}
