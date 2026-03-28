const { contextBridge, ipcRenderer } = require("electron");

const openScoutDesktop = {
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke("openscout:get-app-info"),
  getShellState: () => ipcRenderer.invoke("openscout:get-shell-state"),
  refreshShellState: () => ipcRenderer.invoke("openscout:refresh-shell-state"),
  getAppSettings: () => ipcRenderer.invoke("openscout:get-app-settings"),
  updateAppSettings: (input) => ipcRenderer.invoke("openscout:update-app-settings", input),
  getAgentConfig: (agentId) => ipcRenderer.invoke("openscout:get-agent-config", agentId),
  updateAgentConfig: (input) => ipcRenderer.invoke("openscout:update-agent-config", input),
  restartAgent: (input) => ipcRenderer.invoke("openscout:restart-agent", input),
  sendRelayMessage: (input) => ipcRenderer.invoke("openscout:send-relay-message", input),
  controlBroker: (action) => ipcRenderer.invoke("openscout:control-broker", action),
  getLogCatalog: () => ipcRenderer.invoke("openscout:get-log-catalog"),
  getBrokerInspector: () => ipcRenderer.invoke("openscout:get-broker-inspector"),
  readLogSource: (input) => ipcRenderer.invoke("openscout:read-log-source", input),
  toggleVoiceCapture: () => ipcRenderer.invoke("openscout:toggle-voice-capture"),
  setVoiceRepliesEnabled: (enabled) => ipcRenderer.invoke("openscout:set-voice-replies-enabled", enabled),
};

contextBridge.exposeInMainWorld("openScoutDesktop", openScoutDesktop);
