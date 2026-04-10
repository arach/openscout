import type {
  ScoutDesktopAppInfo,
  ScoutDesktopHomeState,
  ScoutDesktopMessagesWorkspaceState,
  ScoutDesktopServicesState,
  ScoutDesktopShellPatch,
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
  createScoutElectronAgent,
  controlScoutElectronBroker,
  restartScoutElectronAgent,
  sendScoutElectronRelayMessage,
  type ScoutElectronBrokerControlAction,
  type ScoutElectronCreateAgentInput,
  type ScoutElectronCreateAgentResult,
  type ScoutElectronRestartAgentInput,
  type ScoutElectronSendRelayMessageInput,
} from "./broker-actions.ts";
import {
  getScoutElectronFeedbackBundle,
  getScoutElectronBrokerInspector,
  getScoutElectronLogCatalog,
  readScoutElectronLogSource,
  submitScoutElectronFeedbackReport,
  type ReadScoutLogSourceInput,
  type ScoutDesktopBrokerInspector,
  type ScoutDesktopFeedbackBundle,
  type ScoutDesktopFeedbackSubmission,
  type ScoutDesktopLogCatalog,
  type ScoutDesktopLogContent,
  type SubmitScoutFeedbackReportInput,
} from "./diagnostics.ts";
import {
  pickScoutHostDirectory,
  reloadScoutHostApp,
  quitScoutHostApp,
  revealScoutHostPath,
  type ScoutHostNativeServices,
} from "./native-host.ts";
import {
  acquireScoutKeepAliveLease,
  getScoutKeepAliveState,
  releaseScoutKeepAliveLease,
  type AcquireScoutKeepAliveLeaseInput,
  type ReleaseScoutKeepAliveLeaseInput,
  type ScoutKeepAliveLease,
  type ScoutKeepAliveState,
} from "./keep-alive.ts";
import type {
  DecideScoutPairingApprovalInput,
  ScoutPairingControlAction,
  ScoutPairingState,
  UpdateScoutPairingConfigInput,
} from "./pairing.ts";
import {
  controlScoutElectronPairingService,
  decideScoutElectronPairingApproval,
  getScoutElectronPairingState,
  refreshScoutElectronPairingState,
  updateScoutElectronPairingConfig,
} from "./pairing.ts";
import {
  getScoutElectronAgentSession,
  openScoutElectronAgentSession,
  type ScoutElectronAgentSessionHost,
  type ScoutElectronAgentSessionInspector,
} from "./agent-session.ts";
import {
  getScoutElectronAppInfo,
  getScoutElectronHomeState,
  getScoutElectronMessagesWorkspaceState,
  getScoutElectronServicesState,
  getScoutElectronPhonePreparation,
  getScoutElectronShellState,
  refreshScoutElectronShellState,
  setScoutElectronVoiceRepliesEnabled,
  toggleScoutElectronVoiceCapture,
  updateScoutElectronPhonePreparation,
  type ScoutElectronVoiceService,
} from "./service.ts";
import {
  getScoutElectronAppSettings,
  refreshScoutElectronAppSettingsInventory,
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

export type CreateScoutHostServicesInput = {
  currentDirectory?: string;
  appInfo?: ScoutDesktopAppInfo;
  voice?: ScoutElectronVoiceService;
  settings?: ScoutElectronSettingsService;
  agentSessionHost?: ScoutElectronAgentSessionHost;
  host?: ScoutHostNativeServices;
};

export type AppInfoServices = {
  getAppInfo: () => Promise<ScoutDesktopAppInfo> | ScoutDesktopAppInfo;
};

export type DesktopStateServices = {
  getServicesState: () => Promise<ScoutDesktopServicesState>;
  getHomeState: () => Promise<ScoutDesktopHomeState>;
  getMessagesWorkspaceState: () => Promise<ScoutDesktopMessagesWorkspaceState>;
  getShellState: () => Promise<ScoutDesktopShellState>;
  refreshShellState: () => Promise<ScoutDesktopShellState>;
};

export type SettingsAdminServices = {
  getAppSettings: () => Promise<AppSettingsState>;
  refreshSettingsInventory: () => Promise<AppSettingsState>;
  updateAppSettings: (input: UpdateAppSettingsInput) => Promise<AppSettingsState>;
  retireProject: (projectRoot: string) => Promise<AppSettingsState>;
  restoreProject: (projectRoot: string) => Promise<AppSettingsState>;
  runOnboardingCommand: (input: RunOnboardingCommandInput) => Promise<OnboardingCommandResult>;
  skipOnboarding: () => Promise<AppSettingsState>;
  restartOnboarding: () => Promise<AppSettingsState>;
  getAgentConfig: (agentId: string) => Promise<ScoutElectronAgentConfigState>;
  updateAgentConfig: (input: ScoutElectronUpdateAgentConfigInput) => Promise<ScoutElectronAgentConfigState>;
  createAgent: (input: ScoutElectronCreateAgentInput) => Promise<ScoutElectronCreateAgentResult>;
  getPhonePreparation: () => Promise<ScoutPhonePreparationState>;
  updatePhonePreparation: (input: UpdateScoutPhonePreparationInput) => Promise<ScoutPhonePreparationState>;
};

export type NativeHostServices = {
  pickDirectory: () => Promise<string | null>;
  reloadApp: () => Promise<boolean>;
  quitApp: () => Promise<boolean>;
  revealPath: (filePath: string) => Promise<boolean>;
};

export type PairingServices = {
  getPairingState: () => Promise<ScoutPairingState>;
  refreshPairingState: () => Promise<ScoutPairingState>;
  controlPairingService: (action: ScoutPairingControlAction) => Promise<ScoutPairingState>;
  updatePairingConfig: (input: UpdateScoutPairingConfigInput) => Promise<ScoutPairingState>;
  decidePairingApproval: (input: DecideScoutPairingApprovalInput) => Promise<ScoutPairingState>;
};

export type RelayActivityServices = {
  restartAgent: (input: ScoutElectronRestartAgentInput) => Promise<ScoutDesktopShellState>;
  sendRelayMessage: (input: ScoutElectronSendRelayMessageInput) => Promise<ScoutDesktopShellPatch>;
  getKeepAliveState: () => Promise<ScoutKeepAliveState> | ScoutKeepAliveState;
  acquireKeepAliveLease: (input: AcquireScoutKeepAliveLeaseInput) => Promise<ScoutKeepAliveLease> | ScoutKeepAliveLease;
  releaseKeepAliveLease: (input: ReleaseScoutKeepAliveLeaseInput) => Promise<boolean> | boolean;
  getAgentSession: (agentId: string) => Promise<ScoutElectronAgentSessionInspector>;
  openAgentSession: (agentId: string) => Promise<boolean>;
  toggleVoiceCapture: () => Promise<ScoutDesktopShellState>;
  setVoiceRepliesEnabled: (enabled: boolean) => Promise<ScoutDesktopShellState>;
};

export type BrokerAdminServices = {
  controlBroker: (action: ScoutElectronBrokerControlAction) => Promise<ScoutDesktopShellState>;
};

export type DiagnosticsServices = {
  getLogCatalog: () => Promise<ScoutDesktopLogCatalog>;
  getBrokerInspector: () => Promise<ScoutDesktopBrokerInspector>;
  getFeedbackBundle: () => Promise<ScoutDesktopFeedbackBundle>;
  submitFeedbackReport: (input: SubmitScoutFeedbackReportInput) => Promise<ScoutDesktopFeedbackSubmission>;
  readLogSource: (input: ReadScoutLogSourceInput) => Promise<ScoutDesktopLogContent>;
};

export type ScoutHostServices = AppInfoServices
  & DesktopStateServices
  & SettingsAdminServices
  & NativeHostServices
  & PairingServices
  & RelayActivityServices
  & BrokerAdminServices
  & DiagnosticsServices;

function resolveCurrentDirectory(input?: string): string {
  return input ?? process.cwd();
}

export function createAppInfoServices(
  input: CreateScoutHostServicesInput = {},
): AppInfoServices {
  const appInfo = input.appInfo;
  return {
    getAppInfo: () => appInfo ?? getScoutElectronAppInfo(),
  };
}

export function createDesktopStateServices(
  input: CreateScoutHostServicesInput = {},
): DesktopStateServices {
  const currentDirectory = resolveCurrentDirectory(input.currentDirectory);
  const appInfo = input.appInfo;
  const voice = input.voice;

  return {
    getServicesState: () => getScoutElectronServicesState({ currentDirectory, appInfo, voice }),
    getHomeState: () => getScoutElectronHomeState({ currentDirectory, appInfo, voice }),
    getMessagesWorkspaceState: () => getScoutElectronMessagesWorkspaceState({ currentDirectory, appInfo, voice }),
    getShellState: () => getScoutElectronShellState({ currentDirectory, appInfo, voice }),
    refreshShellState: () => refreshScoutElectronShellState({ currentDirectory, appInfo, voice }),
  };
}

export function createSettingsAdminServices(
  input: CreateScoutHostServicesInput = {},
): SettingsAdminServices {
  const currentDirectory = resolveCurrentDirectory(input.currentDirectory);
  const appInfo = input.appInfo;
  const settings = input.settings ?? {};

  return {
    getAppSettings: () => getScoutElectronAppSettings(currentDirectory, settings),
    refreshSettingsInventory: () => refreshScoutElectronAppSettingsInventory(currentDirectory, settings),
    updateAppSettings: (nextInput) => updateScoutElectronAppSettings(nextInput, currentDirectory, settings),
    retireProject: (projectRoot) => retireScoutElectronProject(projectRoot, currentDirectory, settings),
    restoreProject: (projectRoot) => restoreScoutElectronProject(projectRoot, currentDirectory, settings),
    runOnboardingCommand: (nextInput) => runScoutElectronOnboardingCommand(nextInput, currentDirectory),
    skipOnboarding: () => skipScoutElectronOnboarding(currentDirectory, settings),
    restartOnboarding: () => restartScoutElectronOnboarding(currentDirectory, settings),
    getAgentConfig: (agentId) => getScoutElectronAgentConfig(agentId),
    updateAgentConfig: (nextInput) => updateScoutElectronAgentConfig(nextInput),
    createAgent: (nextInput) => createScoutElectronAgent(nextInput, { currentDirectory, appInfo }),
    getPhonePreparation: () => getScoutElectronPhonePreparation(currentDirectory),
    updatePhonePreparation: (nextInput) => updateScoutElectronPhonePreparation(nextInput, currentDirectory),
  };
}

export function createNativeHostServices(
  input: CreateScoutHostServicesInput = {},
): NativeHostServices {
  const host = input.host ?? {};

  return {
    pickDirectory: () => pickScoutHostDirectory(host),
    reloadApp: () => reloadScoutHostApp(host),
    quitApp: () => quitScoutHostApp(host),
    revealPath: (filePath) => revealScoutHostPath(filePath, host),
  };
}

export function createPairingServices(
  input: CreateScoutHostServicesInput = {},
): PairingServices {
  const currentDirectory = resolveCurrentDirectory(input.currentDirectory);

  return {
    getPairingState: () => getScoutElectronPairingState(currentDirectory),
    refreshPairingState: () => refreshScoutElectronPairingState(currentDirectory),
    controlPairingService: (action) => controlScoutElectronPairingService(action, currentDirectory),
    updatePairingConfig: (nextInput) => updateScoutElectronPairingConfig(nextInput, currentDirectory),
    decidePairingApproval: (nextInput) => decideScoutElectronPairingApproval(nextInput, currentDirectory),
  };
}

export function createRelayActivityServices(
  input: CreateScoutHostServicesInput = {},
): RelayActivityServices {
  const currentDirectory = resolveCurrentDirectory(input.currentDirectory);
  const appInfo = input.appInfo;
  const voice = input.voice;
  const agentSessionHost = input.agentSessionHost;

  return {
    restartAgent: async (nextInput) => {
      await restartScoutElectronAgent(nextInput, { currentDirectory, appInfo });
      return refreshScoutElectronShellState({ currentDirectory, appInfo, voice });
    },
    sendRelayMessage: (nextInput) => sendScoutElectronRelayMessage(nextInput, { currentDirectory, appInfo }),
    getKeepAliveState: () => getScoutKeepAliveState(),
    acquireKeepAliveLease: (nextInput) => acquireScoutKeepAliveLease(nextInput),
    releaseKeepAliveLease: (nextInput) => releaseScoutKeepAliveLease(nextInput.leaseId),
    getAgentSession: (agentId) => getScoutElectronAgentSession(agentId),
    openAgentSession: (agentId) => openScoutElectronAgentSession(agentId, agentSessionHost),
    toggleVoiceCapture: () => toggleScoutElectronVoiceCapture({ currentDirectory, appInfo, voice }),
    setVoiceRepliesEnabled: (enabled) => setScoutElectronVoiceRepliesEnabled(enabled, { currentDirectory, appInfo, voice }),
  };
}

export function createBrokerAdminServices(
  input: CreateScoutHostServicesInput = {},
): BrokerAdminServices {
  const currentDirectory = resolveCurrentDirectory(input.currentDirectory);
  const appInfo = input.appInfo;
  const voice = input.voice;
  const settings = input.settings ?? {};

  return {
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
  };
}

export function createDiagnosticsServices(
  input: CreateScoutHostServicesInput = {},
): DiagnosticsServices {
  const currentDirectory = resolveCurrentDirectory(input.currentDirectory);

  return {
    getLogCatalog: () => getScoutElectronLogCatalog(currentDirectory),
    getBrokerInspector: () => getScoutElectronBrokerInspector(),
    getFeedbackBundle: () => getScoutElectronFeedbackBundle(currentDirectory),
    submitFeedbackReport: (nextInput) => submitScoutElectronFeedbackReport(nextInput, currentDirectory),
    readLogSource: (nextInput) => readScoutElectronLogSource(nextInput, currentDirectory),
  };
}

export function createScoutHostServices(
  input: CreateScoutHostServicesInput = {},
): ScoutHostServices {
  return {
    ...createAppInfoServices(input),
    ...createDesktopStateServices(input),
    ...createSettingsAdminServices(input),
    ...createNativeHostServices(input),
    ...createPairingServices(input),
    ...createRelayActivityServices(input),
    ...createBrokerAdminServices(input),
    ...createDiagnosticsServices(input),
  };
}
