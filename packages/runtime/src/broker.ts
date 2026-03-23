import type {
  ActorIdentity,
  ControlCommand,
  ControlEvent,
  ConversationBinding,
  DeliveryIntent,
  DeliveryTargetKind,
  DeliveryTransport,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
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
    const endpoints = Object.values(registry.endpoints).filter((endpoint) => endpoint.agentId === participantId);
    const endpoint = endpoints[0];

    return {
      targetId: participantId,
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

  constructor(initial: Partial<RuntimeRegistrySnapshot> = {}) {
    this.registry = createRuntimeRegistrySnapshot(initial);
  }

  snapshot(): RuntimeRegistrySnapshot {
    return createRuntimeRegistrySnapshot({
      actors: { ...this.registry.actors },
      agents: { ...this.registry.agents },
      endpoints: { ...this.registry.endpoints },
      conversations: { ...this.registry.conversations },
      bindings: { ...this.registry.bindings },
      messages: { ...this.registry.messages },
      flights: { ...this.registry.flights },
    });
  }

  subscribe(listener: (event: ControlEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispatch(command: ControlCommand): Promise<void> {
    switch (command.kind) {
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
      payload: { message },
    });

    for (const delivery of deliveries) {
      this.emit({
        id: createRuntimeId("evt"),
        kind: "delivery.planned",
        ts: Date.now(),
        actorId: message.actorId,
        payload: { delivery },
      });
    }

    return deliveries;
  }

  async invokeAgent(invocation: InvocationRequest): Promise<FlightRecord> {
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
      payload: { invocation },
    });

    this.emit({
      id: createRuntimeId("evt"),
      kind: "flight.updated",
      ts: Date.now(),
      actorId: invocation.requesterId,
      payload: { flight },
    });

    return flight;
  }

  private emit(event: ControlEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createInMemoryControlRuntime(
  initial: Partial<RuntimeRegistrySnapshot> = {},
): InMemoryControlRuntime {
  return new InMemoryControlRuntime(initial);
}
