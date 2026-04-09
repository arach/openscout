export {
  configureScoutKeepAliveHost,
  shutdownScoutKeepAliveManager,
} from "./app/electron/keep-alive.ts";
export { createScoutDesktopAppInfo } from "./app/desktop/index.ts";
export { createScoutElectronIpcServices, registerScoutElectronIpcHandlers } from "./app/electron/ipc.ts";
export { normalizeScoutElectronVoiceState } from "./app/electron/voice.ts";
export { resolveScoutElectronStartUrl, SCOUT_ELECTRON_DEFAULT_WINDOW } from "./app/electron/config.ts";
