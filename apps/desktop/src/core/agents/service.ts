import {
  createScoutAgentService,
  type CreateScoutAgentCardInput,
  type ScoutAgentStatus,
  type UpdateScoutAgentCardInput,
  type UpScoutAgentInput,
} from "@openscout/runtime/control-plane-agents";

import {
  loadScoutBrokerContext,
  openScoutPeerSession,
  registerScoutLocalAgentBinding,
  retireScoutLocalAgentBinding,
} from "../broker/service.ts";

const scoutAgentService = createScoutAgentService({
  loadScoutBrokerContext,
  openScoutPeerSession,
  registerScoutLocalAgentBinding,
  retireScoutLocalAgentBinding,
});

export type {
  CreateScoutAgentCardInput,
  ScoutAgentStatus,
  UpdateScoutAgentCardInput,
  UpScoutAgentInput,
};

export const {
  createScoutAgentCard,
  downAllScoutAgents,
  downScoutAgent,
  loadScoutAgentStatuses,
  retireScoutAgentCard,
  restartScoutAgents,
  updateScoutAgentCard,
  upScoutAgent,
} = scoutAgentService;
