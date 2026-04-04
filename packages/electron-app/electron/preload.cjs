const { contextBridge, ipcRenderer } = require("electron");

const SCOUT_CHANNELS = {
  getAppInfo: "scout:get-app-info",
  getShellState: "scout:get-shell-state",
  refreshShellState: "scout:refresh-shell-state",
  getAppSettings: "scout:get-app-settings",
  updateAppSettings: "scout:update-app-settings",
  retireProject: "scout:retire-project",
  restoreProject: "scout:restore-project",
  runOnboardingCommand: "scout:run-onboarding-command",
  skipOnboarding: "scout:skip-onboarding",
  restartOnboarding: "scout:restart-onboarding",
  getAgentConfig: "scout:get-agent-config",
  updateAgentConfig: "scout:update-agent-config",
  pickDirectory: "scout:pick-directory",
  quitApp: "scout:quit-app",
  revealPath: "scout:reveal-path",
  getPhonePreparation: "scout:get-phone-preparation",
  updatePhonePreparation: "scout:update-phone-preparation",
  getPairingState: "scout:get-pairing-state",
  refreshPairingState: "scout:refresh-pairing-state",
  controlPairingService: "scout:control-pairing-service",
  updatePairingConfig: "scout:update-pairing-config",
  restartAgent: "scout:restart-agent",
  sendRelayMessage: "scout:send-relay-message",
  controlBroker: "scout:control-broker",
  getAgentSession: "scout:get-agent-session",
  openAgentSession: "scout:open-agent-session",
  toggleVoiceCapture: "scout:toggle-voice-capture",
  setVoiceRepliesEnabled: "scout:set-voice-replies-enabled",
  getLogCatalog: "scout:get-log-catalog",
  getBrokerInspector: "scout:get-broker-inspector",
  readLogSource: "scout:read-log-source",
  openKnowledgeBase: "scout:open-knowledge-base",
};

const scoutDesktop = {
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke(SCOUT_CHANNELS.getAppInfo),
  getShellState: () => ipcRenderer.invoke(SCOUT_CHANNELS.getShellState),
  refreshShellState: () => ipcRenderer.invoke(SCOUT_CHANNELS.refreshShellState),
  getAppSettings: () => ipcRenderer.invoke(SCOUT_CHANNELS.getAppSettings),
  updateAppSettings: (input) => ipcRenderer.invoke(SCOUT_CHANNELS.updateAppSettings, input),
  retireProject: (projectRoot) => ipcRenderer.invoke(SCOUT_CHANNELS.retireProject, projectRoot),
  restoreProject: (projectRoot) => ipcRenderer.invoke(SCOUT_CHANNELS.restoreProject, projectRoot),
  runOnboardingCommand: (input) => ipcRenderer.invoke(SCOUT_CHANNELS.runOnboardingCommand, input),
  skipOnboarding: () => ipcRenderer.invoke(SCOUT_CHANNELS.skipOnboarding),
  restartOnboarding: () => ipcRenderer.invoke(SCOUT_CHANNELS.restartOnboarding),
  pickDirectory: () => ipcRenderer.invoke(SCOUT_CHANNELS.pickDirectory),
  quitApp: () => ipcRenderer.invoke(SCOUT_CHANNELS.quitApp),
  getPhonePreparation: () => ipcRenderer.invoke(SCOUT_CHANNELS.getPhonePreparation),
  updatePhonePreparation: (input) => ipcRenderer.invoke(SCOUT_CHANNELS.updatePhonePreparation, input),
  getAgentConfig: (agentId) => ipcRenderer.invoke(SCOUT_CHANNELS.getAgentConfig, agentId),
  updateAgentConfig: (input) => ipcRenderer.invoke(SCOUT_CHANNELS.updateAgentConfig, input),
  restartAgent: (input) => ipcRenderer.invoke(SCOUT_CHANNELS.restartAgent, input),
  sendRelayMessage: (input) => ipcRenderer.invoke(SCOUT_CHANNELS.sendRelayMessage, input),
  controlBroker: (action) => ipcRenderer.invoke(SCOUT_CHANNELS.controlBroker, action),
  getLogCatalog: () => ipcRenderer.invoke(SCOUT_CHANNELS.getLogCatalog),
  getBrokerInspector: () => ipcRenderer.invoke(SCOUT_CHANNELS.getBrokerInspector),
  readLogSource: (input) => ipcRenderer.invoke(SCOUT_CHANNELS.readLogSource, input),
  onOpenKnowledgeBase: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const handler = () => callback();
    ipcRenderer.on(SCOUT_CHANNELS.openKnowledgeBase, handler);
    return () => {
      ipcRenderer.removeListener(SCOUT_CHANNELS.openKnowledgeBase, handler);
    };
  },
  getPairingState: () => ipcRenderer.invoke(SCOUT_CHANNELS.getPairingState),
  refreshPairingState: () => ipcRenderer.invoke(SCOUT_CHANNELS.refreshPairingState),
  controlPairingService: (action) => ipcRenderer.invoke(SCOUT_CHANNELS.controlPairingService, action),
  updatePairingConfig: (input) => ipcRenderer.invoke(SCOUT_CHANNELS.updatePairingConfig, input),
  getAgentSession: (agentId) => ipcRenderer.invoke(SCOUT_CHANNELS.getAgentSession, agentId),
  openAgentSession: (agentId) => ipcRenderer.invoke(SCOUT_CHANNELS.openAgentSession, agentId),
  toggleVoiceCapture: () => ipcRenderer.invoke(SCOUT_CHANNELS.toggleVoiceCapture),
  setVoiceRepliesEnabled: (enabled) => ipcRenderer.invoke(SCOUT_CHANNELS.setVoiceRepliesEnabled, enabled),
  revealPath: (filePath) => ipcRenderer.invoke(SCOUT_CHANNELS.revealPath, filePath),
};

contextBridge.exposeInMainWorld("scoutDesktop", scoutDesktop);
