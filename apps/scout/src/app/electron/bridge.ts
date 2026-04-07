import type {
  ScoutDesktopAppInfo,
  ScoutDesktopShellPatch,
  ScoutDesktopShellState,
  ScoutPhonePreparationState,
  UpdateScoutPhonePreparationInput,
} from "../desktop/index.ts";
import type {
  ScoutElectronAgentConfigState,
  ScoutElectronUpdateAgentConfigInput,
} from "./agent-config.ts";
import type {
  ScoutElectronCreateAgentInput,
  ScoutElectronCreateAgentResult,
  ScoutElectronBrokerControlAction,
  ScoutElectronRestartAgentInput,
  ScoutElectronSendRelayMessageInput,
} from "./broker-actions.ts";
import type {
  AcquireScoutKeepAliveLeaseInput,
  ReleaseScoutKeepAliveLeaseInput,
  ScoutKeepAliveLease,
  ScoutKeepAliveState,
} from "./keep-alive.ts";
import type {
  DecideScoutPairingApprovalInput,
  ScoutPairingControlAction,
  ScoutPairingState,
  UpdateScoutPairingConfigInput,
} from "./pairing.ts";
import type {
  AppSettingsState,
  OnboardingCommandResult,
  RunOnboardingCommandInput,
  UpdateAppSettingsInput,
} from "./settings.ts";
import type {
  ScoutDesktopFeedbackBundle,
  ScoutDesktopFeedbackSubmission,
  ReadScoutLogSourceInput,
  SubmitScoutFeedbackReportInput,
  ScoutDesktopBrokerInspector,
  ScoutDesktopLogCatalog,
  ScoutDesktopLogContent,
} from "./diagnostics.ts";
import type { ScoutElectronAgentSessionInspector } from "./agent-session.ts";
import type { ScoutElectronVoiceState } from "./voice.ts";
import { SCOUT_ELECTRON_CHANNELS } from "./channels.ts";

export type ScoutElectronInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export type ScoutElectronBridge = {
  isDesktop: boolean;
  getAppInfo: () => Promise<ScoutDesktopAppInfo>;
  getShellState: () => Promise<ScoutDesktopShellState>;
  refreshShellState: () => Promise<ScoutDesktopShellState>;
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
  pickDirectory: () => Promise<string | null>;
  reloadApp: () => Promise<boolean>;
  quitApp: () => Promise<boolean>;
  revealPath: (filePath: string) => Promise<boolean>;
  getPhonePreparation: () => Promise<ScoutPhonePreparationState>;
  updatePhonePreparation: (input: UpdateScoutPhonePreparationInput) => Promise<ScoutPhonePreparationState>;
  getPairingState: () => Promise<ScoutPairingState>;
  refreshPairingState: () => Promise<ScoutPairingState>;
  controlPairingService: (action: ScoutPairingControlAction) => Promise<ScoutPairingState>;
  updatePairingConfig: (input: UpdateScoutPairingConfigInput) => Promise<ScoutPairingState>;
  decidePairingApproval: (input: DecideScoutPairingApprovalInput) => Promise<ScoutPairingState>;
  restartAgent: (input: ScoutElectronRestartAgentInput) => Promise<ScoutDesktopShellState>;
  sendRelayMessage: (input: ScoutElectronSendRelayMessageInput) => Promise<ScoutDesktopShellPatch>;
  controlBroker: (action: ScoutElectronBrokerControlAction) => Promise<ScoutDesktopShellState>;
  getKeepAliveState: () => Promise<ScoutKeepAliveState>;
  acquireKeepAliveLease: (input: AcquireScoutKeepAliveLeaseInput) => Promise<ScoutKeepAliveLease>;
  releaseKeepAliveLease: (input: ReleaseScoutKeepAliveLeaseInput) => Promise<boolean>;
  getAgentSession: (agentId: string) => Promise<ScoutElectronAgentSessionInspector>;
  openAgentSession: (agentId: string) => Promise<boolean>;
  toggleVoiceCapture: () => Promise<ScoutDesktopShellState>;
  setVoiceRepliesEnabled: (enabled: boolean) => Promise<ScoutDesktopShellState>;
  getLogCatalog: () => Promise<ScoutDesktopLogCatalog>;
  getBrokerInspector: () => Promise<ScoutDesktopBrokerInspector>;
  getFeedbackBundle: () => Promise<ScoutDesktopFeedbackBundle>;
  submitFeedbackReport: (input: SubmitScoutFeedbackReportInput) => Promise<ScoutDesktopFeedbackSubmission>;
  readLogSource: (input: ReadScoutLogSourceInput) => Promise<ScoutDesktopLogContent>;
  onOpenKnowledgeBase?: (callback: () => void) => () => void;
};

export function createScoutElectronBridge(invoke: ScoutElectronInvoke): ScoutElectronBridge {
  return {
    isDesktop: true,
    getAppInfo: () => invoke(SCOUT_ELECTRON_CHANNELS.getAppInfo) as Promise<ScoutDesktopAppInfo>,
    getShellState: () => invoke(SCOUT_ELECTRON_CHANNELS.getShellState) as Promise<ScoutDesktopShellState>,
    refreshShellState: () => invoke(SCOUT_ELECTRON_CHANNELS.refreshShellState) as Promise<ScoutDesktopShellState>,
    getAppSettings: () => invoke(SCOUT_ELECTRON_CHANNELS.getAppSettings) as Promise<AppSettingsState>,
    refreshSettingsInventory: () => invoke(
      SCOUT_ELECTRON_CHANNELS.refreshSettingsInventory,
    ) as Promise<AppSettingsState>,
    updateAppSettings: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.updateAppSettings,
      input,
    ) as Promise<AppSettingsState>,
    retireProject: (projectRoot) => invoke(
      SCOUT_ELECTRON_CHANNELS.retireProject,
      projectRoot,
    ) as Promise<AppSettingsState>,
    restoreProject: (projectRoot) => invoke(
      SCOUT_ELECTRON_CHANNELS.restoreProject,
      projectRoot,
    ) as Promise<AppSettingsState>,
    runOnboardingCommand: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.runOnboardingCommand,
      input,
    ) as Promise<OnboardingCommandResult>,
    skipOnboarding: () => invoke(SCOUT_ELECTRON_CHANNELS.skipOnboarding) as Promise<AppSettingsState>,
    restartOnboarding: () => invoke(SCOUT_ELECTRON_CHANNELS.restartOnboarding) as Promise<AppSettingsState>,
    getAgentConfig: (agentId) => invoke(
      SCOUT_ELECTRON_CHANNELS.getAgentConfig,
      agentId,
    ) as Promise<ScoutElectronAgentConfigState>,
    updateAgentConfig: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.updateAgentConfig,
      input,
    ) as Promise<ScoutElectronAgentConfigState>,
    createAgent: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.createAgent,
      input,
    ) as Promise<ScoutElectronCreateAgentResult>,
    pickDirectory: () => invoke(SCOUT_ELECTRON_CHANNELS.pickDirectory) as Promise<string | null>,
    reloadApp: () => invoke(SCOUT_ELECTRON_CHANNELS.reloadApp) as Promise<boolean>,
    quitApp: () => invoke(SCOUT_ELECTRON_CHANNELS.quitApp) as Promise<boolean>,
    revealPath: (filePath) => invoke(
      SCOUT_ELECTRON_CHANNELS.revealPath,
      filePath,
    ) as Promise<boolean>,
    getPhonePreparation: () => invoke(SCOUT_ELECTRON_CHANNELS.getPhonePreparation) as Promise<ScoutPhonePreparationState>,
    updatePhonePreparation: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.updatePhonePreparation,
      input,
    ) as Promise<ScoutPhonePreparationState>,
    getPairingState: () => invoke(SCOUT_ELECTRON_CHANNELS.getPairingState) as Promise<ScoutPairingState>,
    refreshPairingState: () => invoke(SCOUT_ELECTRON_CHANNELS.refreshPairingState) as Promise<ScoutPairingState>,
    controlPairingService: (action) => invoke(
      SCOUT_ELECTRON_CHANNELS.controlPairingService,
      action,
    ) as Promise<ScoutPairingState>,
    updatePairingConfig: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.updatePairingConfig,
      input,
    ) as Promise<ScoutPairingState>,
    decidePairingApproval: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.decidePairingApproval,
      input,
    ) as Promise<ScoutPairingState>,
    restartAgent: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.restartAgent,
      input,
    ) as Promise<ScoutDesktopShellState>,
    sendRelayMessage: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.sendRelayMessage,
      input,
    ) as Promise<ScoutDesktopShellPatch>,
    controlBroker: (action) => invoke(
      SCOUT_ELECTRON_CHANNELS.controlBroker,
      action,
    ) as Promise<ScoutDesktopShellState>,
    getKeepAliveState: () => invoke(
      SCOUT_ELECTRON_CHANNELS.getKeepAliveState,
    ) as Promise<ScoutKeepAliveState>,
    acquireKeepAliveLease: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.acquireKeepAliveLease,
      input,
    ) as Promise<ScoutKeepAliveLease>,
    releaseKeepAliveLease: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.releaseKeepAliveLease,
      input,
    ) as Promise<boolean>,
    getAgentSession: (agentId) => invoke(
      SCOUT_ELECTRON_CHANNELS.getAgentSession,
      agentId,
    ) as Promise<ScoutElectronAgentSessionInspector>,
    openAgentSession: (agentId) => invoke(
      SCOUT_ELECTRON_CHANNELS.openAgentSession,
      agentId,
    ) as Promise<boolean>,
    toggleVoiceCapture: () => invoke(
      SCOUT_ELECTRON_CHANNELS.toggleVoiceCapture,
    ) as Promise<ScoutDesktopShellState>,
    setVoiceRepliesEnabled: (enabled) => invoke(
      SCOUT_ELECTRON_CHANNELS.setVoiceRepliesEnabled,
      enabled,
    ) as Promise<ScoutDesktopShellState>,
    getLogCatalog: () => invoke(
      SCOUT_ELECTRON_CHANNELS.getLogCatalog,
    ) as Promise<ScoutDesktopLogCatalog>,
    getBrokerInspector: () => invoke(
      SCOUT_ELECTRON_CHANNELS.getBrokerInspector,
    ) as Promise<ScoutDesktopBrokerInspector>,
    getFeedbackBundle: () => invoke(
      SCOUT_ELECTRON_CHANNELS.getFeedbackBundle,
    ) as Promise<ScoutDesktopFeedbackBundle>,
    submitFeedbackReport: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.submitFeedbackReport,
      input,
    ) as Promise<ScoutDesktopFeedbackSubmission>,
    readLogSource: (input) => invoke(
      SCOUT_ELECTRON_CHANNELS.readLogSource,
      input,
    ) as Promise<ScoutDesktopLogContent>,
  };
}
