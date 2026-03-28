import { homedir } from "node:os";
import { join } from "node:path";

export type OpenScoutSupportPaths = {
  supportDirectory: string;
  logsDirectory: string;
  appLogsDirectory: string;
  brokerLogsDirectory: string;
  runtimeDirectory: string;
  relayAgentsDirectory: string;
  settingsPath: string;
  relayAgentsRegistryPath: string;
  relayHubDirectory: string;
  controlHome: string;
  desktopStatusPath: string;
  workspaceStatePath: string;
};

export function resolveOpenScoutSupportPaths(): OpenScoutSupportPaths {
  const home = homedir();
  const supportDirectory = join(home, "Library", "Application Support", "OpenScout");
  const logsDirectory = join(supportDirectory, "logs");
  const runtimeDirectory = join(supportDirectory, "runtime");

  return {
    supportDirectory,
    logsDirectory,
    appLogsDirectory: join(logsDirectory, "app"),
    brokerLogsDirectory: join(logsDirectory, "broker"),
    runtimeDirectory,
    relayAgentsDirectory: join(runtimeDirectory, "agents"),
    settingsPath: join(supportDirectory, "settings.json"),
    relayAgentsRegistryPath: join(supportDirectory, "relay-agents.json"),
    relayHubDirectory: process.env.OPENSCOUT_RELAY_HUB
      ?? join(home, ".openscout", "relay"),
    controlHome: process.env.OPENSCOUT_CONTROL_HOME
      ?? join(home, ".openscout", "control-plane"),
    desktopStatusPath: join(supportDirectory, "agent-status.json"),
    workspaceStatePath: join(supportDirectory, "workspace-state.json"),
  };
}

export function relayAgentRuntimeDirectory(agentId: string): string {
  return join(resolveOpenScoutSupportPaths().relayAgentsDirectory, agentId);
}

export function relayAgentLogsDirectory(agentId: string): string {
  return join(relayAgentRuntimeDirectory(agentId), "logs");
}
