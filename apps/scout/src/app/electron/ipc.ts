import type {
  ScoutDesktopAppInfo,
  ScoutDesktopShellState,
  ScoutPhonePreparationState,
  UpdateScoutPhonePreparationInput,
} from "../desktop/index.ts";
import {
  getScoutElectronAgentConfig,
  updateScoutElectronAgentConfig,
  type ScoutElectronAgentConfigState,
  type ScoutElectronUpdateAgentConfigInput,
} from "./agent-config.ts";
import {
  controlScoutElectronBroker,
  restartScoutElectronAgent,
  sendScoutElectronRelayMessage,
  type ScoutElectronBrokerControlAction,
  type ScoutElectronRestartAgentInput,
  type ScoutElectronSendRelayMessageInput,
} from "./broker-actions.ts";
import type {
  ScoutPairingControlAction,
  ScoutPairingState,
  UpdateScoutPairingConfigInput,
} from "./pairing.ts";
import {
  getScoutElectronAgentSession,
  openScoutElectronAgentSession,
  type ScoutElectronAgentSessionHost,
  type ScoutElectronAgentSessionInspector,
} from "./agent-session.ts";
import {
  getScoutElectronBrokerInspector,
  getScoutElectronLogCatalog,
  readScoutElectronLogSource,
} from "./diagnostics.ts";
import type {
  ReadScoutLogSourceInput,
  ScoutDesktopBrokerInspector,
  ScoutDesktopLogCatalog,
  ScoutDesktopLogContent,
} from "./diagnostics.ts";
import {
  controlScoutElectronPairingService,
  getScoutElectronPairingState,
  refreshScoutElectronPairingState,
  updateScoutElectronPairingConfig,
} from "./pairing.ts";
import {
  getScoutElectronAppSettings,
  restoreScoutElectronProject,
  retireScoutElectronProject,
  restartScoutElectronOnboarding,
  runScoutElectronOnboardingCommand,
  skipScoutElectronOnboarding,
  updateScoutElectronAppSettings,
  type AppSettingsState,
  type OnboardingCommandResult,
  type RunOnboardingCommandInput,
  type ScoutElectronSettingsService,
  type UpdateAppSettingsInput,
} from "./settings.ts";
import {
  pickScoutElectronDirectory,
  quitScoutElectronApp,
  revealScoutElectronPath,
  type ScoutElectronHostServices,
} from "./host.ts";
import {
  getScoutElectronAppInfo,
  getScoutElectronPhonePreparation,
  getScoutElectronShellState,
  refreshScoutElectronShellState,
  setScoutElectronVoiceRepliesEnabled,
  toggleScoutElectronVoiceCapture,
  updateScoutElectronPhonePreparation,
  type ScoutElectronVoiceService,
} from "./service.ts";
import { SCOUT_ELECTRON_CHANNELS, type ScoutElectronChannelName } from "./channels.ts";

export type ScoutElectronIpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

export type ScoutElectronIpcRegistrar = (
  channel: ScoutElectronChannelName,
  handler: ScoutElectronIpcHandler,
) => void;

export type ScoutElectronIpcServices = {
  getAppInfo: () => Promise<ScoutDesktopAppInfo> | ScoutDesktopAppInfo;
  getShellState: () => Promise<ScoutDesktopShellState>;
  refreshShellState: () => Promise<ScoutDesktopShellState>;
  getAppSettings: () => Promise<AppSettingsState>;
  updateAppSettings: (input: UpdateAppSettingsInput) => Promise<AppSettingsState>;
  retireProject: (projectRoot: string) => Promise<AppSettingsState>;
  restoreProject: (projectRoot: string) => Promise<AppSettingsState>;
  runOnboardingCommand: (input: RunOnboardingCommandInput) => Promise<OnboardingCommandResult>;
  skipOnboarding: () => Promise<AppSettingsState>;
  restartOnboarding: () => Promise<AppSettingsState>;
  getAgentConfig: (agentId: string) => Promise<ScoutElectronAgentConfigState>;
  updateAgentConfig: (input: ScoutElectronUpdateAgentConfigInput) => Promise<ScoutElectronAgentConfigState>;
  pickDirectory: () => Promise<string | null>;
  quitApp: () => Promise<boolean>;
  revealPath: (filePath: string) => Promise<boolean>;
  getPhonePreparation: () => Promise<ScoutPhonePreparationState>;
  updatePhonePreparation: (input: UpdateScoutPhonePreparationInput) => Promise<ScoutPhonePreparationState>;
  getPairingState: () => Promise<ScoutPairingState>;
  refreshPairingState: () => Promise<ScoutPairingState>;
  controlPairingService: (action: ScoutPairingControlAction) => Promise<ScoutPairingState>;
  updatePairingConfig: (input: UpdateScoutPairingConfigInput) => Promise<ScoutPairingState>;
  restartAgent: (input: ScoutElectronRestartAgentInput) => Promise<ScoutDesktopShellState>;
  sendRelayMessage: (input: ScoutElectronSendRelayMessageInput) => Promise<ScoutDesktopShellState>;
  controlBroker: (action: ScoutElectronBrokerControlAction) => Promise<ScoutDesktopShellState>;
  getAgentSession: (agentId: string) => Promise<ScoutElectronAgentSessionInspector>;
  openAgentSession: (agentId: string) => Promise<boolean>;
  toggleVoiceCapture: () => Promise<ScoutDesktopShellState>;
  setVoiceRepliesEnabled: (enabled: boolean) => Promise<ScoutDesktopShellState>;
  getLogCatalog: () => Promise<ScoutDesktopLogCatalog>;
  getBrokerInspector: () => Promise<ScoutDesktopBrokerInspector>;
  readLogSource: (input: ReadScoutLogSourceInput) => Promise<ScoutDesktopLogContent>;
};

export function createScoutElectronIpcServices(input: {
  currentDirectory?: string;
  appInfo?: ScoutDesktopAppInfo;
  voice?: ScoutElectronVoiceService;
  settings?: ScoutElectronSettingsService;
  agentSessionHost?: ScoutElectronAgentSessionHost;
  host?: ScoutElectronHostServices;
} = {}): ScoutElectronIpcServices {
  const currentDirectory = input.currentDirectory ?? process.cwd();
  const appInfo = input.appInfo;
  const voice = input.voice;
  const settings = input.settings ?? {};
  const agentSessionHost = input.agentSessionHost;
  const host = input.host ?? {};

  return {
    getAppInfo: () => getScoutElectronAppInfo(appInfo ?? {}),
    getShellState: () => getScoutElectronShellState({ currentDirectory, appInfo, voice }),
    refreshShellState: () => refreshScoutElectronShellState({ currentDirectory, appInfo, voice }),
    getAppSettings: () => getScoutElectronAppSettings(currentDirectory, settings),
    updateAppSettings: (nextInput) => updateScoutElectronAppSettings(nextInput, currentDirectory, settings),
    retireProject: (projectRoot) => retireScoutElectronProject(projectRoot, currentDirectory, settings),
    restoreProject: (projectRoot) => restoreScoutElectronProject(projectRoot, currentDirectory, settings),
    runOnboardingCommand: (nextInput) => runScoutElectronOnboardingCommand(nextInput, currentDirectory),
    skipOnboarding: () => skipScoutElectronOnboarding(currentDirectory, settings),
    restartOnboarding: () => restartScoutElectronOnboarding(currentDirectory, settings),
    getAgentConfig: (agentId) => getScoutElectronAgentConfig(agentId),
    updateAgentConfig: (nextInput) => updateScoutElectronAgentConfig(nextInput),
    pickDirectory: () => pickScoutElectronDirectory(host),
    quitApp: () => quitScoutElectronApp(host),
    revealPath: (filePath) => revealScoutElectronPath(filePath, host),
    getPhonePreparation: () => getScoutElectronPhonePreparation(currentDirectory),
    updatePhonePreparation: (nextState) => updateScoutElectronPhonePreparation(nextState, currentDirectory),
    getPairingState: () => getScoutElectronPairingState(currentDirectory),
    refreshPairingState: () => refreshScoutElectronPairingState(currentDirectory),
    controlPairingService: (action) => controlScoutElectronPairingService(action, currentDirectory),
    updatePairingConfig: (input) => updateScoutElectronPairingConfig(input, currentDirectory),
    restartAgent: async (nextInput) => {
      await restartScoutElectronAgent(nextInput, { currentDirectory, appInfo });
      return refreshScoutElectronShellState({ currentDirectory, appInfo, voice });
    },
    sendRelayMessage: async (nextInput) => {
      await sendScoutElectronRelayMessage(nextInput, { currentDirectory, appInfo });
      return refreshScoutElectronShellState({ currentDirectory, appInfo, voice });
    },
    controlBroker: async (action) => {
      await controlScoutElectronBroker(action, {
        currentDirectory,
        appInfo,
        telegram: {
          refreshConfiguration: settings.refreshTelegramConfiguration,
        },
      });
      return refreshScoutElectronShellState({ currentDirectory, appInfo, voice });
    },
    getAgentSession: (agentId) => getScoutElectronAgentSession(agentId),
    openAgentSession: (agentId) => openScoutElectronAgentSession(agentId, agentSessionHost),
    toggleVoiceCapture: () => toggleScoutElectronVoiceCapture({ currentDirectory, appInfo, voice }),
    setVoiceRepliesEnabled: (enabled) => setScoutElectronVoiceRepliesEnabled(enabled, { currentDirectory, appInfo, voice }),
    getLogCatalog: () => getScoutElectronLogCatalog(currentDirectory),
    getBrokerInspector: () => getScoutElectronBrokerInspector(),
    readLogSource: (input) => readScoutElectronLogSource(input, currentDirectory),
  };
}

export function registerScoutElectronIpcHandlers(
  register: ScoutElectronIpcRegistrar,
  services: ScoutElectronIpcServices,
): void {
  register(SCOUT_ELECTRON_CHANNELS.getAppInfo, () => services.getAppInfo());
  register(SCOUT_ELECTRON_CHANNELS.getShellState, () => services.getShellState());
  register(SCOUT_ELECTRON_CHANNELS.refreshShellState, () => services.refreshShellState());
  register(SCOUT_ELECTRON_CHANNELS.getAppSettings, () => services.getAppSettings());
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
  register(SCOUT_ELECTRON_CHANNELS.pickDirectory, () => services.pickDirectory());
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
  register(SCOUT_ELECTRON_CHANNELS.restartAgent, (_event, input) =>
    services.restartAgent(input as ScoutElectronRestartAgentInput));
  register(SCOUT_ELECTRON_CHANNELS.sendRelayMessage, (_event, input) =>
    services.sendRelayMessage(input as ScoutElectronSendRelayMessageInput));
  register(SCOUT_ELECTRON_CHANNELS.controlBroker, (_event, action) =>
    services.controlBroker(action as ScoutElectronBrokerControlAction));
  register(SCOUT_ELECTRON_CHANNELS.getAgentSession, (_event, agentId) =>
    services.getAgentSession(String(agentId)));
  register(SCOUT_ELECTRON_CHANNELS.openAgentSession, (_event, agentId) =>
    services.openAgentSession(String(agentId)));
  register(SCOUT_ELECTRON_CHANNELS.toggleVoiceCapture, () => services.toggleVoiceCapture());
  register(SCOUT_ELECTRON_CHANNELS.setVoiceRepliesEnabled, (_event, enabled) =>
    services.setVoiceRepliesEnabled(Boolean(enabled)));
  register(SCOUT_ELECTRON_CHANNELS.getLogCatalog, () => services.getLogCatalog());
  register(SCOUT_ELECTRON_CHANNELS.getBrokerInspector, () => services.getBrokerInspector());
  register(SCOUT_ELECTRON_CHANNELS.readLogSource, (_event, input) =>
    services.readLogSource(input as ReadScoutLogSourceInput));
}
