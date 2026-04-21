import { buildRelayReturnAddress, type RelayAgentCard } from "@openscout/protocol";

import type { LocalAgentBinding } from "./local-agents.js";

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function buildRelayAgentCard(
  binding: LocalAgentBinding,
  options: {
    currentDirectory?: string;
    createdAt?: number;
    createdById?: string;
    brokerRegistered?: boolean;
    inboxConversationId?: string;
    replyToMessageId?: string;
  } = {},
): RelayAgentCard {
  const projectRoot = binding.endpoint.projectRoot
    ?? metadataString(binding.agent.metadata, "projectRoot")
    ?? binding.endpoint.cwd
    ?? process.cwd();
  const currentDirectory = options.currentDirectory?.trim() || projectRoot;
  const handle = binding.agent.handle?.trim() || binding.agent.definitionId;
  const selector = binding.agent.selector?.trim() || metadataString(binding.agent.metadata, "selector");
  const defaultSelector = binding.agent.defaultSelector?.trim() || metadataString(binding.agent.metadata, "defaultSelector");
  const branch = metadataString(binding.agent.metadata, "branch") || metadataString(binding.endpoint.metadata, "branch");

  return {
    id: binding.agent.id,
    agentId: binding.agent.id,
    definitionId: binding.agent.definitionId,
    displayName: binding.agent.displayName,
    handle,
    ...(selector ? { selector } : {}),
    ...(defaultSelector ? { defaultSelector } : {}),
    projectName: metadataString(binding.agent.metadata, "project") || metadataString(binding.actor.metadata, "project"),
    projectRoot,
    currentDirectory,
    harness: binding.endpoint.harness,
    transport: binding.endpoint.transport,
    ...(binding.endpoint.sessionId ? { sessionId: binding.endpoint.sessionId } : {}),
    ...(branch ? { branch } : {}),
    createdAt: options.createdAt ?? Date.now(),
    ...(options.createdById?.trim() ? { createdById: options.createdById.trim() } : {}),
    brokerRegistered: options.brokerRegistered ?? false,
    ...(options.inboxConversationId?.trim() ? { inboxConversationId: options.inboxConversationId.trim() } : {}),
    returnAddress: buildRelayReturnAddress({
      actorId: binding.agent.id,
      handle,
      displayName: binding.agent.displayName,
      selector,
      defaultSelector,
      conversationId: options.inboxConversationId,
      replyToMessageId: options.replyToMessageId,
      nodeId: binding.endpoint.nodeId,
      projectRoot,
      sessionId: binding.endpoint.sessionId,
      metadata: {
        transport: binding.endpoint.transport,
      },
    }),
    metadata: {
      actorId: binding.actor.id,
      endpointId: binding.endpoint.id,
      wakePolicy: binding.agent.wakePolicy,
    },
  };
}
