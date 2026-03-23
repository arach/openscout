import type { DeliveryTransport, MetadataMap, ScoutId } from "./common.js";
import type { InvocationRequest } from "./invocations.js";
import type { MessageRecord } from "./messages.js";

export interface SubscriptionRequest {
  actorId: ScoutId;
  conversationIds?: ScoutId[];
  flightIds?: ScoutId[];
  eventKinds?: string[];
}

export interface PostMessageCommand {
  kind: "conversation.post";
  message: MessageRecord;
}

export interface InvokeAgentCommand {
  kind: "agent.invoke";
  invocation: InvocationRequest;
}

export interface EnsureAwakeCommand {
  kind: "agent.ensure_awake";
  agentId: ScoutId;
  requesterId: ScoutId;
  reason: string;
  metadata?: MetadataMap;
}

export interface SubscribeCommand {
  kind: "stream.subscribe";
  subscription: SubscriptionRequest;
  transport: Extract<DeliveryTransport, "local_socket" | "websocket">;
}

export type ControlCommand =
  | PostMessageCommand
  | InvokeAgentCommand
  | EnsureAwakeCommand
  | SubscribeCommand;
