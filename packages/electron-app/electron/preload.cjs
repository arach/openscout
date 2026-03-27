const { contextBridge, ipcRenderer } = require("electron");

const openScoutDesktop = {
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke("openscout:get-app-info"),
  getShellState: () => ipcRenderer.invoke("openscout:get-shell-state"),
  refreshShellState: () => ipcRenderer.invoke("openscout:refresh-shell-state"),
  sendRelayMessage: (input) => ipcRenderer.invoke("openscout:send-relay-message", input),
  controlBroker: (action) => ipcRenderer.invoke("openscout:control-broker", action),
  toggleVoiceCapture: () => ipcRenderer.invoke("openscout:toggle-voice-capture"),
  setVoiceRepliesEnabled: (enabled) => ipcRenderer.invoke("openscout:set-voice-replies-enabled", enabled),
};

contextBridge.exposeInMainWorld("openScoutDesktop", openScoutDesktop);
