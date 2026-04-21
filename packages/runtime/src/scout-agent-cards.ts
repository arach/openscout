import {
  buildScoutReturnAddress,
  type ScoutAgentCard,
  type ScoutAgentProvider,
  type ScoutAgentSkill,
  type ScoutSecurityScheme,
  type ScoutSupportedInterface,
} from "@openscout/protocol";

import type { LocalAgentBinding } from "./local-agents.js";

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function metadataStringArray(metadata: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return next.length > 0 ? next : undefined;
}

function metadataStringMatrix(metadata: Record<string, unknown> | undefined, key: string): string[][] | undefined {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next = value
    .filter((entry): entry is unknown[] => Array.isArray(entry))
    .map((entry) => entry.filter((item): item is string => typeof item === "string" && item.trim().length > 0))
    .filter((entry) => entry.length > 0);
  return next.length > 0 ? next : undefined;
}

function metadataRecord(metadata: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = metadata?.[key];
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function metadataRecordArray(
  metadata: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown>[] | undefined {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next = value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && !Array.isArray(entry) && typeof entry === "object");
  return next.length > 0 ? next : undefined;
}

export function buildScoutAgentCard(
  binding: LocalAgentBinding,
  options: {
    currentDirectory?: string;
    createdAt?: number;
    createdById?: string;
    brokerRegistered?: boolean;
    inboxConversationId?: string;
    replyToMessageId?: string;
  } = {},
): ScoutAgentCard {
  const projectRoot = binding.endpoint.projectRoot
    ?? metadataString(binding.agent.metadata, "projectRoot")
    ?? binding.endpoint.cwd
    ?? process.cwd();
  const currentDirectory = options.currentDirectory?.trim() || projectRoot;
  const handle = binding.agent.handle?.trim() || binding.agent.definitionId;
  const selector = binding.agent.selector?.trim() || metadataString(binding.agent.metadata, "selector");
  const defaultSelector = binding.agent.defaultSelector?.trim() || metadataString(binding.agent.metadata, "defaultSelector");
  const branch = metadataString(binding.agent.metadata, "branch") || metadataString(binding.endpoint.metadata, "branch");
  const description = metadataString(binding.agent.metadata, "description");
  const version = metadataString(binding.agent.metadata, "version");
  const documentationUrl = metadataString(binding.agent.metadata, "documentationUrl")
    || metadataString(binding.agent.metadata, "docsUrl");
  const provider = metadataRecord(binding.agent.metadata, "provider") as ScoutAgentProvider | undefined;
  const skills = metadataRecordArray(binding.agent.metadata, "skills") as ScoutAgentSkill[] | undefined;
  const defaultInputModes = metadataStringArray(binding.agent.metadata, "defaultInputModes");
  const defaultOutputModes = metadataStringArray(binding.agent.metadata, "defaultOutputModes");
  const supportedInterfaces = metadataRecordArray(
    binding.agent.metadata,
    "supportedInterfaces",
  ) as ScoutSupportedInterface[] | undefined;
  const securitySchemes = metadataRecord(
    binding.agent.metadata,
    "securitySchemes",
  ) as Record<string, ScoutSecurityScheme> | undefined;
  const securityRequirements = metadataStringMatrix(binding.agent.metadata, "securityRequirements");

  return {
    id: binding.agent.id,
    agentId: binding.agent.id,
    definitionId: binding.agent.definitionId,
    displayName: binding.agent.displayName,
    ...(description ? { description } : {}),
    ...(provider ? { provider } : {}),
    ...(version ? { version } : {}),
    ...(documentationUrl ? { documentationUrl } : {}),
    ...(skills ? { skills } : {}),
    ...(defaultInputModes ? { defaultInputModes } : {}),
    ...(defaultOutputModes ? { defaultOutputModes } : {}),
    ...(supportedInterfaces ? { supportedInterfaces } : {}),
    ...(securitySchemes ? { securitySchemes } : {}),
    ...(securityRequirements ? { securityRequirements } : {}),
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
    returnAddress: buildScoutReturnAddress({
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
