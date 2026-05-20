import {
  createScoutAgentService,
  type CreateScoutAgentCardInput,
  type ScoutAgentStatus,
  type UpScoutAgentInput,
} from "@openscout/runtime/control-plane-agents";

import {
  loadScoutBrokerContext,
  openScoutPeerSession,
  registerScoutLocalAgentBinding,
} from "../broker/service.ts";

const scoutAgentService = createScoutAgentService({
  loadScoutBrokerContext,
  openScoutPeerSession,
  registerScoutLocalAgentBinding,
});

export type {
  CreateScoutAgentCardInput,
  ScoutAgentStatus,
  UpScoutAgentInput,
};

export const {
  createScoutAgentCard,
  downAllScoutAgents,
  downScoutAgent,
  loadScoutAgentStatuses,
  restartScoutAgents,
  upScoutAgent,
} = scoutAgentService;
