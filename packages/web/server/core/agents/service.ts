import {
  inferLocalAgentBinding,
  listLocalAgents,
  restartAllLocalAgents,
  startLocalAgent,
  stopAllLocalAgents,
  stopLocalAgent,
  type ScoutLocalAgentStatus,
} from "@openscout/runtime/local-agents";
import { buildRelayAgentCard } from "@openscout/runtime/relay-agent-cards";
import type { AgentHarness, RelayAgentCard } from "@openscout/protocol";

import {
  loadScoutBrokerContext,
  openScoutPeerSession,
  registerScoutLocalAgentBinding,
} from "../broker/service.ts";

export type ScoutAgentStatus = ScoutLocalAgentStatus;

export type CreateScoutAgentCardInput = {
  projectPath: string;
  agentName?: string;
  harness?: AgentHarness;
  currentDirectory?: string;
  createdById?: string;
};

export async function loadScoutAgentStatuses(input: {
  currentDirectory?: string;
} = {}): Promise<ScoutAgentStatus[]> {
  return listLocalAgents({
    currentDirectory: input.currentDirectory,
  });
}

export async function upScoutAgent(input: {
  projectPath: string;
  agentName?: string;
  harness?: AgentHarness;
  currentDirectory?: string;
  cwdOverride?: string;
  model?: string;
  branch?: string;
}): Promise<ScoutAgentStatus> {
  const status = await startLocalAgent(input);
  // Synchronously register the endpoint with the broker so the agent is
  // immediately routable (don't rely on the broker's async background sync).
  await registerScoutLocalAgentBinding({ agentId: status.agentId }).catch(() => {});
  return status;
}

export async function downScoutAgent(agentId: string): Promise<ScoutAgentStatus | null> {
  return stopLocalAgent(agentId);
}

export async function downAllScoutAgents(input: {
  currentDirectory?: string;
} = {}): Promise<ScoutAgentStatus[]> {
  return stopAllLocalAgents(input);
}

export async function restartScoutAgents(input: {
  currentDirectory?: string;
} = {}): Promise<ScoutAgentStatus[]> {
  return restartAllLocalAgents(input);
}

export async function createScoutAgentCard(input: CreateScoutAgentCardInput): Promise<RelayAgentCard> {
  const status = await startLocalAgent(input);
  const currentDirectory = input.currentDirectory ?? input.projectPath;
  const broker = await loadScoutBrokerContext();
  const syncResult = await registerScoutLocalAgentBinding({
    agentId: status.agentId,
    broker,
  });

  const binding = syncResult?.binding
    ?? await inferLocalAgentBinding(status.agentId, broker?.node.id ?? process.env.OPENSCOUT_NODE_ID ?? "local");
  if (!binding) {
    throw new Error(`Agent ${status.agentId} did not expose a relay binding.`);
  }

  let inboxConversationId: string | undefined;
  let createdById = input.createdById?.trim() || undefined;
  if (broker && createdById && createdById !== binding.agent.id) {
    const session = await openScoutPeerSession({
      sourceId: createdById,
      targetId: binding.agent.id,
      currentDirectory,
    });
    inboxConversationId = session.conversation.id;
    createdById = session.sourceId;
  }

  return buildRelayAgentCard(binding, {
    currentDirectory,
    createdById,
    brokerRegistered: syncResult?.brokerRegistered ?? false,
    inboxConversationId,
  });
}
