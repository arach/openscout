import {
  listLocalAgents,
  restartAllLocalAgents,
  startLocalAgent,
  stopAllLocalAgents,
  stopLocalAgent,
  type ScoutLocalAgentStatus,
} from "@openscout/runtime/local-agents";
import type { AgentHarness } from "@openscout/protocol";

export type ScoutAgentStatus = ScoutLocalAgentStatus;

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
}): Promise<ScoutAgentStatus> {
  return startLocalAgent(input);
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
