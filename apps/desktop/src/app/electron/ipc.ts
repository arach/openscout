import type { UpdateScoutPhonePreparationInput } from "../desktop/index.ts";
import {
  createScoutHostServices,
  type CreateScoutHostServicesInput,
  type ScoutHostServices,
} from "../host/scout-host-services.ts";
import type { ScoutElectronUpdateAgentConfigInput } from "./agent-config.ts";
import type {
  ScoutElectronBrokerControlAction,
  ScoutElectronCreateAgentInput,
  ScoutElectronRestartAgentInput,
  ScoutElectronSendRelayMessageInput,
} from "./broker-actions.ts";
import { SCOUT_ELECTRON_CHANNELS, type ScoutElectronChannelName } from "./channels.ts";
import type {
  ReadScoutLogSourceInput,
  SubmitScoutFeedbackReportInput,
} from "./diagnostics.ts";
import type {
  AcquireScoutKeepAliveLeaseInput,
  ReleaseScoutKeepAliveLeaseInput,
} from "./keep-alive.ts";
import type {
  DecideScoutPairingApprovalInput,
  ScoutPairingControlAction,
  UpdateScoutPairingConfigInput,
} from "./pairing.ts";
import type {
  RunOnboardingCommandInput,
  UpdateAppSettingsInput,
} from "./settings.ts";

export type ScoutElectronIpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

export type ScoutElectronIpcRegistrar = (
  channel: ScoutElectronChannelName,
  handler: ScoutElectronIpcHandler,
) => void;

export type ScoutElectronIpcServices = ScoutHostServices;

export function createScoutElectronIpcServices(
  input: CreateScoutHostServicesInput = {},
): ScoutElectronIpcServices {
  return createScoutHostServices(input);
}

export function registerScoutElectronIpcHandlers(
  register: ScoutElectronIpcRegistrar,
  services: ScoutElectronIpcServices,
): void {
  register(SCOUT_ELECTRON_CHANNELS.getAppInfo, () => services.getAppInfo());
  register(SCOUT_ELECTRON_CHANNELS.getServicesState, () => services.getServicesState());
  register(SCOUT_ELECTRON_CHANNELS.getHomeState, () => services.getHomeState());
  register(SCOUT_ELECTRON_CHANNELS.getShellState, () => services.getShellState());
  register(SCOUT_ELECTRON_CHANNELS.refreshShellState, () => services.refreshShellState());
  register(SCOUT_ELECTRON_CHANNELS.getAppSettings, () => services.getAppSettings());
  register(SCOUT_ELECTRON_CHANNELS.refreshSettingsInventory, () => services.refreshSettingsInventory());
  register(SCOUT_ELECTRON_CHANNELS.updateAppSettings, (_event, input) =>
    services.updateAppSettings(input as UpdateAppSettingsInput));
  register(SCOUT_ELECTRON_CHANNELS.retireProject, (_event, projectRoot) =>
    services.retireProject(String(projectRoot)));
  register(SCOUT_ELECTRON_CHANNELS.restoreProject, (_event, projectRoot) =>
    services.restoreProject(String(projectRoot)));
  register(SCOUT_ELECTRON_CHANNELS.runOnboardingCommand, (_event, input) =>
    services.runOnboardingCommand(input as RunOnboardingCommandInput));
  register(SCOUT_ELECTRON_CHANNELS.skipOnboarding, () => services.skipOnboarding());
  register(SCOUT_ELECTRON_CHANNELS.restartOnboarding, () => services.restartOnboarding());
  register(SCOUT_ELECTRON_CHANNELS.getAgentConfig, (_event, agentId) =>
    services.getAgentConfig(String(agentId)));
  register(SCOUT_ELECTRON_CHANNELS.updateAgentConfig, (_event, input) =>
    services.updateAgentConfig(input as ScoutElectronUpdateAgentConfigInput));
  register(SCOUT_ELECTRON_CHANNELS.createAgent, (_event, input) =>
    services.createAgent(input as ScoutElectronCreateAgentInput));
  register(SCOUT_ELECTRON_CHANNELS.pickDirectory, () => services.pickDirectory());
  register(SCOUT_ELECTRON_CHANNELS.reloadApp, () => services.reloadApp());
  register(SCOUT_ELECTRON_CHANNELS.quitApp, () => services.quitApp());
  register(SCOUT_ELECTRON_CHANNELS.revealPath, (_event, filePath) =>
    services.revealPath(String(filePath)));
  register(SCOUT_ELECTRON_CHANNELS.getPhonePreparation, () => services.getPhonePreparation());
  register(SCOUT_ELECTRON_CHANNELS.updatePhonePreparation, (_event, input) =>
    services.updatePhonePreparation(input as UpdateScoutPhonePreparationInput));
  register(SCOUT_ELECTRON_CHANNELS.getPairingState, () => services.getPairingState());
  register(SCOUT_ELECTRON_CHANNELS.refreshPairingState, () => services.refreshPairingState());
  register(SCOUT_ELECTRON_CHANNELS.controlPairingService, (_event, action) =>
    services.controlPairingService(action as ScoutPairingControlAction));
  register(SCOUT_ELECTRON_CHANNELS.updatePairingConfig, (_event, input) =>
    services.updatePairingConfig(input as UpdateScoutPairingConfigInput));
  register(SCOUT_ELECTRON_CHANNELS.decidePairingApproval, (_event, input) =>
    services.decidePairingApproval(input as DecideScoutPairingApprovalInput));
  register(SCOUT_ELECTRON_CHANNELS.restartAgent, (_event, input) =>
    services.restartAgent(input as ScoutElectronRestartAgentInput));
  register(SCOUT_ELECTRON_CHANNELS.sendRelayMessage, (_event, input) =>
    services.sendRelayMessage(input as ScoutElectronSendRelayMessageInput));
  register(SCOUT_ELECTRON_CHANNELS.controlBroker, (_event, action) =>
    services.controlBroker(action as ScoutElectronBrokerControlAction));
  register(SCOUT_ELECTRON_CHANNELS.getKeepAliveState, () => services.getKeepAliveState());
  register(SCOUT_ELECTRON_CHANNELS.acquireKeepAliveLease, (_event, input) =>
    services.acquireKeepAliveLease(input as AcquireScoutKeepAliveLeaseInput));
  register(SCOUT_ELECTRON_CHANNELS.releaseKeepAliveLease, (_event, input) =>
    services.releaseKeepAliveLease(input as ReleaseScoutKeepAliveLeaseInput));
  register(SCOUT_ELECTRON_CHANNELS.getAgentSession, (_event, agentId) =>
    services.getAgentSession(String(agentId)));
  register(SCOUT_ELECTRON_CHANNELS.openAgentSession, (_event, agentId) =>
    services.openAgentSession(String(agentId)));
  register(SCOUT_ELECTRON_CHANNELS.toggleVoiceCapture, () => services.toggleVoiceCapture());
  register(SCOUT_ELECTRON_CHANNELS.setVoiceRepliesEnabled, (_event, enabled) =>
    services.setVoiceRepliesEnabled(Boolean(enabled)));
  register(SCOUT_ELECTRON_CHANNELS.getLogCatalog, () => services.getLogCatalog());
  register(SCOUT_ELECTRON_CHANNELS.getBrokerInspector, () => services.getBrokerInspector());
  register(SCOUT_ELECTRON_CHANNELS.getFeedbackBundle, () => services.getFeedbackBundle());
  register(SCOUT_ELECTRON_CHANNELS.submitFeedbackReport, (_event, input) =>
    services.submitFeedbackReport(input as SubmitScoutFeedbackReportInput));
  register(SCOUT_ELECTRON_CHANNELS.readLogSource, (_event, input) =>
    services.readLogSource(input as ReadScoutLogSourceInput));
}
