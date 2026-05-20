import type { AgentHarness, ScoutAgentCard, ScoutPermissionProfile } from "@openscout/protocol";

import {
  inferLocalAgentBinding,
  listLocalAgents,
  restartAllLocalAgents,
  startLocalAgent,
  stopAllLocalAgents,
  stopLocalAgent,
  type LocalAgentBinding,
  type ScoutLocalAgentStatus,
} from "./local-agents.js";
import { buildScoutAgentCard } from "./scout-agent-cards.js";

export type ScoutAgentStatus = ScoutLocalAgentStatus;

export type CreateScoutAgentCardInput = {
  projectPath: string;
  agentName?: string;
  displayName?: string;
  harness?: AgentHarness;
  model?: string;
  reasoningEffort?: string;
  permissionProfile?: ScoutPermissionProfile | string;
  currentDirectory?: string;
  createdById?: string;
};

export type UpScoutAgentInput = {
  projectPath: string;
  agentName?: string;
  harness?: AgentHarness;
  currentDirectory?: string;
  cwdOverride?: string;
  model?: string;
  reasoningEffort?: string;
  permissionProfile?: ScoutPermissionProfile | string;
  branch?: string;
};

export type ScoutAgentServiceBrokerContext = {
  node: {
    id: string;
  };
};

export type ScoutLocalAgentBindingSyncResult = {
  binding: LocalAgentBinding;
  brokerRegistered: boolean;
};

export type ScoutPeerSessionResult = {
  sourceId: string;
  conversation: {
    id: string;
  };
};

export type ScoutAgentServiceDeps<TBroker extends ScoutAgentServiceBrokerContext> = {
  loadScoutBrokerContext: () => Promise<TBroker | null>;
  registerScoutLocalAgentBinding: (input: {
    agentId: string;
    broker?: TBroker | null;
  }) => Promise<ScoutLocalAgentBindingSyncResult | null>;
  openScoutPeerSession: (input: {
    sourceId: string;
    targetId: string;
    currentDirectory?: string;
  }) => Promise<ScoutPeerSessionResult>;
  localAgents?: {
    listLocalAgents?: typeof listLocalAgents;
    restartAllLocalAgents?: typeof restartAllLocalAgents;
    startLocalAgent?: typeof startLocalAgent;
    stopAllLocalAgents?: typeof stopAllLocalAgents;
    stopLocalAgent?: typeof stopLocalAgent;
    inferLocalAgentBinding?: typeof inferLocalAgentBinding;
  };
};

export function createScoutAgentService<TBroker extends ScoutAgentServiceBrokerContext>(
  deps: ScoutAgentServiceDeps<TBroker>,
) {
  const localAgents = {
    listLocalAgents: deps.localAgents?.listLocalAgents ?? listLocalAgents,
    restartAllLocalAgents: deps.localAgents?.restartAllLocalAgents ?? restartAllLocalAgents,
    startLocalAgent: deps.localAgents?.startLocalAgent ?? startLocalAgent,
    stopAllLocalAgents: deps.localAgents?.stopAllLocalAgents ?? stopAllLocalAgents,
    stopLocalAgent: deps.localAgents?.stopLocalAgent ?? stopLocalAgent,
    inferLocalAgentBinding: deps.localAgents?.inferLocalAgentBinding ?? inferLocalAgentBinding,
  };

  return {
    async loadScoutAgentStatuses(input: {
      currentDirectory?: string;
    } = {}): Promise<ScoutAgentStatus[]> {
      return localAgents.listLocalAgents({
        currentDirectory: input.currentDirectory,
      });
    },

    async upScoutAgent(input: UpScoutAgentInput): Promise<ScoutAgentStatus> {
      const status = await localAgents.startLocalAgent(input);
      // Synchronously register the endpoint with the broker so the agent is
      // immediately routable without waiting on the broker's background sync.
      await deps.registerScoutLocalAgentBinding({ agentId: status.agentId }).catch(() => {});
      return status;
    },

    async downScoutAgent(agentId: string): Promise<ScoutAgentStatus | null> {
      return localAgents.stopLocalAgent(agentId);
    },

    async downAllScoutAgents(input: {
      currentDirectory?: string;
    } = {}): Promise<ScoutAgentStatus[]> {
      return localAgents.stopAllLocalAgents(input);
    },

    async restartScoutAgents(input: {
      currentDirectory?: string;
    } = {}): Promise<ScoutAgentStatus[]> {
      return localAgents.restartAllLocalAgents(input);
    },

    async createScoutAgentCard(input: CreateScoutAgentCardInput): Promise<ScoutAgentCard> {
      const status = await localAgents.startLocalAgent({
        projectPath: input.projectPath,
        agentName: input.agentName,
        displayName: input.displayName,
        harness: input.harness,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        permissionProfile: input.permissionProfile,
        currentDirectory: input.currentDirectory,
        // Card creation should publish a routable identity, not make this
        // short-lived caller the owner of a long-running harness session.
        ensureOnline: false,
      });
      const currentDirectory = input.currentDirectory ?? input.projectPath;
      const broker = await deps.loadScoutBrokerContext();
      const syncResult = await deps.registerScoutLocalAgentBinding({
        agentId: status.agentId,
        broker,
      });

      const binding = syncResult?.binding
        ?? await localAgents.inferLocalAgentBinding(
          status.agentId,
          broker?.node.id ?? process.env.OPENSCOUT_NODE_ID ?? "local",
        );
      if (!binding) {
        throw new Error(`Agent ${status.agentId} did not expose an addressable binding.`);
      }

      let inboxConversationId: string | undefined;
      let createdById = input.createdById?.trim() || undefined;
      if (broker && createdById && createdById !== binding.agent.id) {
        const session = await deps.openScoutPeerSession({
          sourceId: createdById,
          targetId: binding.agent.id,
          currentDirectory,
        });
        inboxConversationId = session.conversation.id;
        createdById = session.sourceId;
      }

      return buildScoutAgentCard(binding, {
        currentDirectory,
        createdById,
        brokerRegistered: syncResult?.brokerRegistered ?? false,
        inboxConversationId,
      });
    },
  };
}
