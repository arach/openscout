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
  managedInstallsPath: string;
  statuslineDirectory: string;
  claudeStatuslineScriptPath: string;
  claudeStatuslineLatestPath: string;
  claudeStatuslineHistoryPath: string;
  relayHubDirectory: string;
  controlHome: string;
  knowledgeDirectory: string;
  knowledgeQmdDirectory: string;
  knowledgeSqlitePath: string;
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
  const controlHome = process.env.OPENSCOUT_CONTROL_HOME
    ?? join(home, ".openscout", "control-plane");
  const knowledgeDirectory = join(controlHome, "knowledge");

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
    managedInstallsPath: join(supportDirectory, "managed-installs.json"),
    statuslineDirectory: join(runtimeDirectory, "statusline"),
    claudeStatuslineScriptPath: join(runtimeDirectory, "statusline", "claude-statusline-capture.sh"),
    claudeStatuslineLatestPath: join(runtimeDirectory, "statusline", "claude-latest.json"),
    claudeStatuslineHistoryPath: join(runtimeDirectory, "statusline", "claude-history.jsonl"),
    relayHubDirectory: process.env.OPENSCOUT_RELAY_HUB
      ?? join(home, ".openscout", "relay"),
    controlHome,
    knowledgeDirectory,
    knowledgeQmdDirectory: join(knowledgeDirectory, "qmd"),
    knowledgeSqlitePath: join(knowledgeDirectory, "knowledge.sqlite"),
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
