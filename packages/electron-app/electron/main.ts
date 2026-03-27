import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import electron from "electron";
import type { MenuItemConstructorOptions } from "electron";

import {
  buildDesktopShellState,
  controlBroker,
  getAgentConfig,
  restartAgent,
  sendRelayMessage,
  setVoiceRepliesEnabled,
  toggleVoiceCapture,
  updateAgentConfig,
} from "./openscout-runtime.js";
import type {
  BrokerControlAction,
  RestartAgentInput,
  SendRelayMessageInput,
  UpdateAgentConfigInput,
} from "../src/lib/openscout-desktop.js";
import { relayVoiceBridgeService } from "./voice-bridge-service.js";

const {
  BrowserWindow,
  Menu,
  app,
  ipcMain,
  shell,
} = electron;

type StartedAppServer = {
  port: number;
  close: () => Promise<void>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.resolve(__dirname, "preload.cjs");

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let appServer: StartedAppServer | null = null;

function resolveProductName() {
  return process.env.OPENSCOUT_PRODUCT_NAME?.trim() || app.getName() || "OpenScout";
}

function getStartUrl(port?: number) {
  const explicitUrl = process.env.ELECTRON_START_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  if (!port) {
    throw new Error("Desktop start URL requires a server port when ELECTRON_START_URL is not set.");
  }

  return `http://127.0.0.1:${port}`;
}

async function ensureAppServer() {
  if (process.env.ELECTRON_START_URL?.trim()) {
    return null;
  }

  if (appServer) {
    return appServer;
  }

  const serverModuleUrl = pathToFileURL(path.resolve(__dirname, "..", "index.js")).href;
  const serverModule = (await import(serverModuleUrl)) as {
    startAppServer: (options?: { host?: string; port?: number; log?: boolean }) => Promise<StartedAppServer>;
  };

  appServer = await serverModule.startAppServer({
    host: "127.0.0.1",
    port: 0,
    log: false,
  });

  return appServer;
}

async function createMainWindow() {
  const server = await ensureAppServer();
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    title: resolveProductName(),
    backgroundColor: "#F9F9F8",
    frame: !isMac,
    titleBarStyle: isMac ? "hidden" : "default",
    trafficLightPosition: isMac ? { x: -100, y: -100 } : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;

  await window.loadURL(getStartUrl(server?.port));

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  return window;
}

function createAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: resolveProductName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("openscout:get-app-info", async () => ({
  productName: resolveProductName(),
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  platform: process.platform,
}));

ipcMain.handle("openscout:get-shell-state", async () =>
  buildDesktopShellState({
    productName: resolveProductName(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
  }),
);

ipcMain.handle("openscout:refresh-shell-state", async () =>
  buildDesktopShellState({
    productName: resolveProductName(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
  }),
);

ipcMain.handle("openscout:get-agent-config", async (_event, agentId: string) =>
  getAgentConfig(agentId),
);

ipcMain.handle("openscout:update-agent-config", async (_event, input: UpdateAgentConfigInput) =>
  updateAgentConfig(input),
);

ipcMain.handle("openscout:restart-agent", async (_event, input: RestartAgentInput) =>
  restartAgent(
    {
      productName: resolveProductName(),
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
    },
    input,
  ),
);

ipcMain.handle("openscout:send-relay-message", async (_event, input: SendRelayMessageInput) =>
  sendRelayMessage(
    {
      productName: resolveProductName(),
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
    },
    input,
  ),
);

ipcMain.handle("openscout:control-broker", async (_event, action: BrokerControlAction) =>
  controlBroker(
    {
      productName: resolveProductName(),
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
    },
    action,
  ),
);

ipcMain.handle("openscout:toggle-voice-capture", async () =>
  toggleVoiceCapture({
    productName: resolveProductName(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
  }),
);

ipcMain.handle("openscout:set-voice-replies-enabled", async (_event, enabled: boolean) =>
  setVoiceRepliesEnabled(
    {
      productName: resolveProductName(),
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
    },
    enabled,
  ),
);

app.whenReady().then(async () => {
  createAppMenu();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    await appServer?.close();
    await relayVoiceBridgeService.shutdown();
    app.quit();
  }
});

app.on("before-quit", async () => {
  await appServer?.close();
  await relayVoiceBridgeService.shutdown();
});
