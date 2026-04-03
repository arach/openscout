import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type OpenScoutSupportPaths = {
  supportDirectory: string;
  logsDirectory: string;
  appLogsDirectory: string;
  brokerLogsDirectory: string;
  runtimeDirectory: string;
  catalogDirectory: string;
  relayAgentsDirectory: string;
  settingsPath: string;
  harnessCatalogPath: string;
  relayAgentsRegistryPath: string;
  relayHubDirectory: string;
  controlHome: string;
  desktopStatusPath: string;
  workspaceStatePath: string;
  cutoverMarkerPath: string;
};

const OPENSCOUT_RPC_CUTOVER_MARKER = "rpc-runtime-cutover-v1";

export function resolveOpenScoutSupportPaths(): OpenScoutSupportPaths {
  const home = homedir();
  const supportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY
    ?? join(home, "Library", "Application Support", "OpenScout");
  const logsDirectory = join(supportDirectory, "logs");
  const runtimeDirectory = join(supportDirectory, "runtime");
  const catalogDirectory = join(supportDirectory, "catalog");

  return {
    supportDirectory,
    logsDirectory,
    appLogsDirectory: join(logsDirectory, "app"),
    brokerLogsDirectory: join(logsDirectory, "broker"),
    runtimeDirectory,
    catalogDirectory,
    relayAgentsDirectory: join(runtimeDirectory, "agents"),
    settingsPath: join(supportDirectory, "settings.json"),
    harnessCatalogPath: join(catalogDirectory, "harness-catalog.json"),
    relayAgentsRegistryPath: join(supportDirectory, "relay-agents.json"),
    relayHubDirectory: process.env.OPENSCOUT_RELAY_HUB
      ?? join(home, ".openscout", "relay"),
    controlHome: process.env.OPENSCOUT_CONTROL_HOME
      ?? join(home, ".openscout", "control-plane"),
    desktopStatusPath: join(supportDirectory, "agent-status.json"),
    workspaceStatePath: join(supportDirectory, "workspace-state.json"),
    cutoverMarkerPath: join(supportDirectory, OPENSCOUT_RPC_CUTOVER_MARKER),
  };
}

export function relayAgentRuntimeDirectory(agentId: string): string {
  return join(resolveOpenScoutSupportPaths().relayAgentsDirectory, agentId);
}

export function relayAgentLogsDirectory(agentId: string): string {
  return join(relayAgentRuntimeDirectory(agentId), "logs");
}

export function ensureOpenScoutCleanSlateSync(): void {
  const paths = resolveOpenScoutSupportPaths();
  if (existsSync(paths.cutoverMarkerPath)) {
    return;
  }

  rmSync(paths.supportDirectory, { recursive: true, force: true });
  rmSync(paths.controlHome, { recursive: true, force: true });
  rmSync(paths.relayHubDirectory, { recursive: true, force: true });

  mkdirSync(paths.supportDirectory, { recursive: true });
  writeFileSync(paths.cutoverMarkerPath, `${Date.now()}\n`, "utf8");
}
