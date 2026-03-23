import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
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
): DeliveryRoute[] {
  return participantIds.map((participantId) => {
    const actor = registry.actors[participantId];
    const agent = registry.agents[participantId];
    const endpoints = Object.values(registry.endpoints).filter((endpoint) => endpoint.agentId === participantId);
    const endpoint = endpoints[0];

    return {
      targetId: participantId,
      nodeId: endpoint?.nodeId ?? agent?.authorityNodeId,
      targetKind: toTargetKind(actor),
      transport: endpoint?.transport ?? defaultTransportForActor(actor),
      speechEnabled: Boolean(
        actor?.kind === "device" ||
        endpoints.some((candidate) => candidate.transport === "local_socket" || candidate.transport === "websocket"),
      ),
    };
  });
}

function resolveBindingRoutes(
  bindings: ConversationBinding[],
): DeliveryRoute[] {
  return bindings.map((binding) => ({
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

  async postMessage(message: MessageRecord): Promise<DeliveryIntent[]> {
    const conversation = this.registry.conversations[message.conversationId];
    if (!conversation) {
      throw new Error(`unknown conversation: ${message.conversationId}`);
    }

    this.registry.messages[message.id] = message;

    const bindingRoutes = resolveBindingRoutes(
      Object.values(this.registry.bindings).filter((binding) => binding.conversationId === conversation.id),
    );
    const deliveries = planMessageDeliveries({
      localNodeId: this.localNodeId,
      message,
      conversation,
      participantRoutes: resolveParticipantRoutes(this.registry, conversation.participantIds),
      bindingRoutes,
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

    const flight: FlightRecord = {
      id: createRuntimeId("flt"),
      invocationId: invocation.id,
      requesterId: invocation.requesterId,
      targetAgentId: invocation.targetAgentId,
      state: invocation.ensureAwake ? "waking" : "queued",
      startedAt: Date.now(),
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
